-- Classement FFT tenu à jour automatiquement depuis Ten'Up (workflow n8n
-- « Le Rebond — Classement FFT (Ten'Up) »).
--
-- Ten'Up expose une API publique de recherche de classement
-- (POST tenup.fft.fr/api/back/public/v2/classements/recherche) : recherche exacte
-- par nom + prénom, ou par identifiant FFT (idCrm), qui ne change pas d'un mois à
-- l'autre. On ne recopie PAS le classement national (≈ 180 000 joueurs, extraction
-- substantielle de la base FFT) : on interroge uniquement les joueurs qui passent
-- par le club, au fil de l'eau, et on garde le résultat en cache dans fft_classement.
--
-- Statut d'un joueur vis-à-vis du classement (joueurs.fft_statut) :
--   'classe'      rattaché à un classé, identifié par fft_id_crm
--   'homonymes'   plusieurs classés portent ce nom : à trancher dans l'admin
--   'non_classe'  aucun classé à ce nom ce mois-ci
--   NULL          jamais vérifié

-- ----- Cache du classement : colonnes renvoyées par Ten'Up -----
ALTER TABLE fft_classement
    ADD COLUMN IF NOT EXISTS id_crm               bigint,
    ADD COLUMN IF NOT EXISTS evolution            integer,
    ADD COLUMN IF NOT EXISTS meilleur_classement  integer,
    ADD COLUMN IF NOT EXISTS comite               text,
    ADD COLUMN IF NOT EXISTS age_sportif          integer,
    ADD COLUMN IF NOT EXISTS source               text NOT NULL DEFAULT 'import',
    ADD COLUMN IF NOT EXISTS maj_le               timestamptz NOT NULL DEFAULT now();

-- Une ligne par joueur et par mois : sert de cible aux mises à jour Ten'Up.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_fft_classement_mois_genre_crm
    ON fft_classement (mois, genre, id_crm) WHERE id_crm IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fft_classement_crm ON fft_classement (id_crm) WHERE id_crm IS NOT NULL;

-- ----- Joueurs du club -----
ALTER TABLE joueurs
    ADD COLUMN IF NOT EXISTS fft_id_crm      bigint,
    ADD COLUMN IF NOT EXISTS fft_statut      text,
    ADD COLUMN IF NOT EXISTS fft_club        text,
    ADD COLUMN IF NOT EXISTS fft_verifie_le  timestamptz;

ALTER TABLE joueurs DROP CONSTRAINT IF EXISTS joueurs_fft_statut_check;
ALTER TABLE joueurs ADD CONSTRAINT joueurs_fft_statut_check
    CHECK (fft_statut IS NULL OR fft_statut IN ('classe', 'homonymes', 'non_classe'));

CREATE UNIQUE INDEX IF NOT EXISTS uniq_joueurs_fft_id_crm
    ON joueurs (fft_id_crm) WHERE fft_id_crm IS NOT NULL;

-- ----- Écriture d'un lot de classés renvoyés par Ten'Up -----
-- p_lignes : tableau de joueurs au format Ten'Up
--   [{"idCrm":…, "classement":…, "points":…, "nom":…, "prenom":…, "sexe":"H"|"F",
--     "club":…, "ligue":…, "comite":…, "nationalite":…, "evolution":…,
--     "meilleurClassement":…, "nombreTournoisJoues":…, "ageSportif":…, "assimilation":…}]
-- Upsert par (mois, genre, idCrm). Les joueurs anonymes (nom null) sont ignorés.
-- Renvoie le nombre de lignes écrites.
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
    SELECT p_mois, l->>'sexe', (l->>'classement')::int, l->>'nom', coalesce(l->>'prenom', ''),
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

    -- Le mois devient « disponible » pour la recherche dès qu'on y a au moins un classé.
    INSERT INTO fft_imports (mois, genre, nb_lignes, source)
    SELECT p_mois, s.genre, (SELECT count(*) FROM fft_classement x WHERE x.mois = p_mois AND x.genre = s.genre), 'tenup'
    FROM (SELECT DISTINCT l->>'sexe' AS genre FROM jsonb_array_elements(coalesce(p_lignes, '[]'::jsonb)) l
          WHERE l->>'sexe' IN ('H', 'F')) s
    ON CONFLICT (mois, genre) DO UPDATE SET nb_lignes = EXCLUDED.nb_lignes, importe_le = now();
    RETURN n;
END;
$$;

-- ----- Joueurs à (re)vérifier pour un mois de classement donné -----
-- Ceux qui n'ont jamais été vérifiés, ou pas depuis la sortie de ce classement.
-- Les joueurs engagés dans un tournoi passent en premier.
CREATE OR REPLACE FUNCTION fft_joueurs_a_verifier(p_mois date, p_limite integer DEFAULT 150)
RETURNS TABLE (id uuid, nom text, prenom text, genre char(1), fft_id_crm bigint)
LANGUAGE sql STABLE
SET search_path = public
AS $$
    SELECT j.id, j.nom, j.prenom, j.genre, j.fft_id_crm
    FROM joueurs j
    WHERE j.fft_verifie_le IS NULL
       OR j.fft_verifie_le < p_mois
       OR (j.fft_statut = 'classe' AND (j.fft_mois IS NULL OR j.fft_mois < p_mois))
    ORDER BY (SELECT max(t.date) FROM equipes e JOIN tournois t ON t.id = e.tournoi_id
              WHERE e.joueur_j1_id = j.id OR e.joueur_j2_id = j.id) DESC NULLS LAST,
             j.fft_verifie_le NULLS FIRST
    LIMIT LEAST(GREATEST(p_limite, 1), 500)
$$;

-- ----- Application des résultats de vérification -----
-- p_resultats : [{"joueur_id":…, "statut":"classe"|"homonymes"|"non_classe",
--                 "id_crm":…, "rang":…, "points":…, "genre":"H"|"F", "club":…}]
-- Renvoie {"classe": n, "homonymes": n, "non_classe": n}.
CREATE OR REPLACE FUNCTION fft_appliquer_verifications(p_mois date, p_resultats jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    UPDATE joueurs j SET
        fft_statut     = r->>'statut',
        fft_id_crm     = CASE WHEN r->>'statut' = 'classe' THEN (r->>'id_crm')::bigint ELSE j.fft_id_crm END,
        fft_rang       = CASE WHEN r->>'statut' = 'classe' THEN (r->>'rang')::int ELSE NULL END,
        fft_points     = CASE WHEN r->>'statut' = 'classe' THEN (r->>'points')::int ELSE NULL END,
        fft_club       = CASE WHEN r->>'statut' = 'classe' THEN r->>'club' ELSE j.fft_club END,
        fft_mois       = CASE WHEN r->>'statut' = 'classe' THEN p_mois ELSE j.fft_mois END,
        genre          = coalesce(j.genre, r->>'genre'),
        fft_verifie_le = now(),
        updated_at     = now()
    FROM jsonb_array_elements(coalesce(p_resultats, '[]'::jsonb)) r
    WHERE j.id = (r->>'joueur_id')::uuid
      AND r->>'statut' IN ('classe', 'homonymes', 'non_classe')
      -- un identifiant déjà porté par une autre fiche (doublon) n'est pas réattribué
      AND (r->>'statut' <> 'classe' OR NOT EXISTS (
            SELECT 1 FROM joueurs x WHERE x.fft_id_crm = (r->>'id_crm')::bigint AND x.id <> j.id));

    RETURN (SELECT jsonb_object_agg(s, n) FROM (
        SELECT r->>'statut' AS s, count(*) AS n
        FROM jsonb_array_elements(coalesce(p_resultats, '[]'::jsonb)) r GROUP BY 1) t);
END;
$$;

-- ----- Rattachement manuel depuis l'admin (choix parmi des homonymes) -----
-- L'identifiant FFT prime ensuite sur le nom pour les mises à jour suivantes.
CREATE OR REPLACE FUNCTION actualiser_classements_joueurs()
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
    n_crm integer; n_licence integer; n_nom integer; n_homonymes integer; n_total integer;
BEGIN
    -- Dernier classement connu de CHAQUE classé : avec Ten'Up, un nouveau mois se
    -- remplit au fil des vérifications, il ne remplace pas d'un coup le précédent.
    CREATE TEMP TABLE _dernier ON COMMIT DROP AS
    SELECT DISTINCT ON (c.genre, coalesce(c.id_crm::text, c.recherche)) c.*
    FROM fft_classement c
    ORDER BY c.genre, coalesce(c.id_crm::text, c.recherche), c.mois DESC;

    -- 1. identifiant FFT : sûr, insensible aux changements d'orthographe
    UPDATE joueurs j SET
        fft_rang = c.rang, fft_points = c.points, fft_mois = c.mois, fft_club = c.club,
        fft_statut = 'classe', genre = coalesce(j.genre, c.genre), updated_at = now()
    FROM _dernier c
    WHERE j.fft_id_crm IS NOT NULL AND c.id_crm = j.fft_id_crm;
    GET DIAGNOSTICS n_crm = ROW_COUNT;

    -- 2. licence
    UPDATE joueurs j SET
        fft_rang = c.rang, fft_points = c.points, fft_mois = c.mois,
        genre = coalesce(j.genre, c.genre), updated_at = now()
    FROM _dernier c
    WHERE j.fft_id_crm IS NULL AND j.licence IS NOT NULL AND c.licence = j.licence;
    GET DIAGNOSTICS n_licence = ROW_COUNT;

    -- 3. nom, seulement sans homonyme
    WITH candidats AS (
        SELECT j.id AS joueur_id, c.rang, c.points, c.mois, c.genre, c.id_crm, c.club,
               count(*) OVER (PARTITION BY j.id) AS nb
        FROM joueurs j
        JOIN _dernier c ON c.recherche = normaliser_identite(j.prenom || ' ' || j.nom)
                       AND (j.genre IS NULL OR c.genre = j.genre)
        WHERE j.fft_id_crm IS NULL
          AND (j.licence IS NULL OR NOT EXISTS (SELECT 1 FROM _dernier x WHERE x.licence = j.licence))
    )
    UPDATE joueurs j SET
        fft_rang = k.rang, fft_points = k.points, fft_mois = k.mois, fft_club = coalesce(k.club, j.fft_club),
        fft_id_crm = CASE WHEN k.id_crm IS NOT NULL
                           AND NOT EXISTS (SELECT 1 FROM joueurs x WHERE x.fft_id_crm = k.id_crm)
                          THEN k.id_crm ELSE j.fft_id_crm END,
        fft_statut = 'classe',
        genre = coalesce(j.genre, k.genre), updated_at = now()
    FROM candidats k
    WHERE k.joueur_id = j.id AND k.nb = 1;
    GET DIAGNOSTICS n_nom = ROW_COUNT;

    SELECT count(*) INTO n_homonymes FROM (
        SELECT j.id
        FROM joueurs j
        JOIN _dernier c ON c.recherche = normaliser_identite(j.prenom || ' ' || j.nom)
                       AND (j.genre IS NULL OR c.genre = j.genre)
        WHERE j.fft_id_crm IS NULL
          AND (j.licence IS NULL OR NOT EXISTS (SELECT 1 FROM _dernier x WHERE x.licence = j.licence))
        GROUP BY j.id HAVING count(*) > 1
    ) h;

    SELECT count(*) INTO n_total FROM joueurs;

    RETURN jsonb_build_object(
        'par_licence', n_crm + n_licence,
        'par_nom', n_nom,
        'homonymes', n_homonymes,
        'non_trouves', GREATEST(n_total - n_crm - n_licence - n_nom - n_homonymes, 0)
    );
END;
$$;

-- La recherche renvoie aussi l'identifiant FFT et le comité (choix d'un homonyme).
DROP FUNCTION IF EXISTS rechercher_joueurs_fft(text, text, integer);
CREATE FUNCTION rechercher_joueurs_fft(q text, p_genre text DEFAULT NULL, p_limite integer DEFAULT 10)
RETURNS TABLE (
    rang integer, nom text, prenom text, points integer, genre char(1),
    ligue text, club text, licence text, mois date, id_crm bigint, comite text
)
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
    WITH mots AS (
        SELECT array_agg(m ORDER BY length(m) DESC) AS liste
        FROM unnest(string_to_array(normaliser_identite(q), ' ')) AS m
        WHERE length(m) >= 2
    ),
    trouves AS (
        -- dernier classement connu de chaque classé (cf. actualiser_classements_joueurs)
        SELECT DISTINCT ON (c.genre, coalesce(c.id_crm::text, c.recherche))
               c.rang, c.nom, c.prenom, c.points, c.genre, c.ligue, c.club, c.licence, c.mois,
               c.id_crm, c.comite, c.recherche
        FROM fft_classement c CROSS JOIN mots
        WHERE mots.liste IS NOT NULL
          AND (p_genre IS NULL OR c.genre = p_genre)
          AND c.recherche LIKE '%' || mots.liste[1] || '%'
          AND c.recherche LIKE ALL (SELECT '%' || m || '%' FROM unnest(mots.liste) AS m)
          AND c.mois >= (SELECT max(mois) FROM fft_imports) - interval '12 months'
        ORDER BY c.genre, coalesce(c.id_crm::text, c.recherche), c.mois DESC
    )
    SELECT t.rang, t.nom, t.prenom, t.points, t.genre, t.ligue, t.club, t.licence, t.mois, t.id_crm, t.comite
    FROM trouves t
    ORDER BY extensions.similarity(t.recherche, normaliser_identite(q)) DESC, t.rang
    LIMIT LEAST(GREATEST(p_limite, 1), 50)
$$;
GRANT EXECUTE ON FUNCTION rechercher_joueurs_fft(text, text, integer) TO anon, authenticated;

-- Écritures réservées au workflow n8n (connexion Postgres directe) ; l'admin
-- garde l'actualisation locale.
REVOKE ALL ON FUNCTION fft_enregistrer_tenup(date, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fft_appliquer_verifications(date, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fft_joueurs_a_verifier(date, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION actualiser_classements_joueurs() TO authenticated;
