-- Correctif de 20261018_fft_tenup.sql : un même classé peut apparaître plusieurs fois
-- dans un lot de vérification.
--   - deux fiches joueurs de la même personne (doublon de l'annuaire) renvoient la
--     même ligne Ten'Up ;
--   - deux listes d'homonymes peuvent se recouvrir.
-- Postgres refuse alors l'upsert (« ON CONFLICT DO UPDATE command cannot affect row a
-- second time ») et, côté joueurs, deux fiches voudraient le même fft_id_crm (unique).

CREATE OR REPLACE FUNCTION fft_enregistrer_tenup(p_mois date, p_lignes jsonb)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE n integer;
BEGIN
    INSERT INTO fft_classement AS c (
        mois, genre, rang, nom, prenom, points, nationalite, ligue, club, assimile,
        nb_tournois, id_crm, evolution, meilleur_classement, comite, age_sportif, source, maj_le)
    SELECT DISTINCT ON (l->>'sexe', (l->>'idCrm')::bigint)       -- une ligne par classé
           p_mois, l->>'sexe', (l->>'classement')::int, l->>'nom', coalesce(l->>'prenom', ''),
           (l->>'points')::int, l->>'nationalite', l->>'ligue', l->>'club', (l->>'assimilation')::boolean,
           (l->>'nombreTournoisJoues')::int, (l->>'idCrm')::bigint, (l->>'evolution')::int,
           (l->>'meilleurClassement')::int, l->>'comite', (l->>'ageSportif')::int, 'tenup', now()
    FROM jsonb_array_elements(coalesce(p_lignes, '[]'::jsonb)) AS l
    WHERE l->>'idCrm' IS NOT NULL AND l->>'classement' IS NOT NULL AND l->>'sexe' IN ('H', 'F')
      -- Joueurs anonymes sur Ten'Up (nom masqué par le joueur) : on respecte ce choix, rien n'est stocké.
      AND nullif(btrim(l->>'nom'), '') IS NOT NULL
    ON CONFLICT (mois, genre, id_crm) WHERE id_crm IS NOT NULL DO UPDATE SET
        rang = EXCLUDED.rang, nom = EXCLUDED.nom, prenom = EXCLUDED.prenom, points = EXCLUDED.points,
        nationalite = EXCLUDED.nationalite, ligue = EXCLUDED.ligue, club = EXCLUDED.club,
        assimile = EXCLUDED.assimile, nb_tournois = EXCLUDED.nb_tournois, evolution = EXCLUDED.evolution,
        meilleur_classement = EXCLUDED.meilleur_classement, comite = EXCLUDED.comite,
        age_sportif = EXCLUDED.age_sportif, source = 'tenup', maj_le = now();
    GET DIAGNOSTICS n = ROW_COUNT;

    INSERT INTO fft_imports (mois, genre, nb_lignes, source)
    SELECT p_mois, s.genre, (SELECT count(*) FROM fft_classement x WHERE x.mois = p_mois AND x.genre = s.genre), 'tenup'
    FROM (SELECT DISTINCT l->>'sexe' AS genre FROM jsonb_array_elements(coalesce(p_lignes, '[]'::jsonb)) l
          WHERE l->>'sexe' IN ('H', 'F')) s
    ON CONFLICT (mois, genre) DO UPDATE SET nb_lignes = EXCLUDED.nb_lignes, importe_le = now();
    RETURN n;
END;
$$;

-- Si plusieurs fiches du lot désignent le même classé, seule la première (ou celle qui
-- porte déjà l'identifiant) le prend ; les autres reçoivent son rang mais pas
-- l'identifiant : ce sont des doublons à fusionner dans l'annuaire.
CREATE OR REPLACE FUNCTION fft_appliquer_verifications(p_mois date, p_resultats jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    WITH r AS (
        SELECT x AS r,
               (x->>'joueur_id')::uuid AS joueur_id,
               CASE WHEN x->>'statut' = 'classe' THEN (x->>'id_crm')::bigint END AS id_crm
        FROM jsonb_array_elements(coalesce(p_resultats, '[]'::jsonb)) x
        WHERE x->>'statut' IN ('classe', 'homonymes', 'non_classe')
    ), attribution AS (
        SELECT r.*,
               -- l'identifiant n'est donné qu'à une fiche : celle qui l'a déjà, sinon la première du lot,
               -- et jamais s'il appartient déjà à une autre fiche hors lot
               (r.id_crm IS NOT NULL
                AND row_number() OVER (PARTITION BY r.id_crm
                        ORDER BY (SELECT j.fft_id_crm = r.id_crm FROM joueurs j WHERE j.id = r.joueur_id) DESC NULLS LAST) = 1
                AND NOT EXISTS (SELECT 1 FROM joueurs x WHERE x.fft_id_crm = r.id_crm
                                AND x.id NOT IN (SELECT joueur_id FROM r))) AS prend_id
        FROM r
    )
    UPDATE joueurs j SET
        fft_statut     = a.r->>'statut',
        fft_id_crm     = CASE WHEN a.prend_id THEN a.id_crm
                              WHEN a.id_crm IS NOT NULL AND j.fft_id_crm = a.id_crm THEN NULL
                              ELSE j.fft_id_crm END,
        fft_rang       = CASE WHEN a.r->>'statut' = 'classe' THEN (a.r->>'rang')::int ELSE NULL END,
        fft_points     = CASE WHEN a.r->>'statut' = 'classe' THEN (a.r->>'points')::int ELSE NULL END,
        fft_club       = CASE WHEN a.r->>'statut' = 'classe' THEN a.r->>'club' ELSE j.fft_club END,
        fft_mois       = CASE WHEN a.r->>'statut' = 'classe' THEN p_mois ELSE j.fft_mois END,
        genre          = coalesce(j.genre, a.r->>'genre'),
        fft_verifie_le = now(),
        updated_at     = now()
    FROM attribution a
    WHERE j.id = a.joueur_id;

    RETURN (SELECT jsonb_object_agg(s, n) FROM (
        SELECT x->>'statut' AS s, count(*) AS n
        FROM jsonb_array_elements(coalesce(p_resultats, '[]'::jsonb)) x GROUP BY 1) t);
END;
$$;

REVOKE ALL ON FUNCTION fft_enregistrer_tenup(date, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fft_appliquer_verifications(date, jsonb) FROM PUBLIC, anon, authenticated;
