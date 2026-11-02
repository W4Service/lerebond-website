-- Paires inscrites dans LiveXperience, affichées sur /tournois/ avec leurs points FFT Ten'Up.
--
-- Écrites par ~/liveXperience/sync_site_places.py sur wepepc (toutes les 15 min). Table séparée de
-- « inscriptions » : celle-ci déclenche des e-mails et des alertes, ici on ne fait qu'afficher.
-- Ni téléphone ni e-mail. Lecture publique uniquement via paires_tournoi().
CREATE TABLE IF NOT EXISTS livex_paires (
    tournoi_id uuid    NOT NULL REFERENCES tournois(id) ON DELETE CASCADE,
    lx_id      integer NOT NULL,
    joueur1    text    NOT NULL,
    joueur2    text,
    rang1      integer,
    rang2      integer,
    pts1       integer,
    pts2       integer,
    poids      integer,
    maj_le     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tournoi_id, lx_id)
);
ALTER TABLE livex_paires ENABLE ROW LEVEL SECURITY;

-- Résultats Ten'Up déjà cherchés, pour ne pas interroger la FFT toutes les 15 minutes.
CREATE TABLE IF NOT EXISTS livex_fft_cache (
    cle        text PRIMARY KEY,
    trouve     boolean NOT NULL,
    nom        text,
    prenom     text,
    genre      char(1),
    rang       integer,
    points     integer,
    verifie_le timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE livex_fft_cache ENABLE ROW LEVEL SECURITY;

DROP FUNCTION IF EXISTS paires_tournoi(uuid);
CREATE FUNCTION paires_tournoi(p_tournoi uuid)
RETURNS TABLE (statut text, rang_attente integer, joueur1 text, joueur2 text, rang1 integer, rang2 integer, poids integer, pts1 integer, pts2 integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT * FROM (
        SELECT i.statut,
               CASE WHEN i.statut = 'liste_attente' THEN
                   (row_number() OVER (PARTITION BY i.statut ORDER BY i.cree_le))::int END,
               nom_joueur(i.joueur1_id), nom_joueur(i.joueur2_id), i.rang1, i.rang2, i.poids::integer,
               NULL::integer, NULL::integer
        FROM inscriptions i JOIN tournois t ON t.id = i.tournoi_id
        WHERE i.tournoi_id = p_tournoi AND t.publie AND i.statut IN ('inscrite', 'liste_attente')
        UNION ALL
        SELECT 'inscrite', NULL::integer, l.joueur1, COALESCE(l.joueur2, 'partenaire à confirmer'),
               l.rang1, l.rang2, l.poids, l.pts1, l.pts2
        FROM livex_paires l JOIN tournois t ON t.id = l.tournoi_id
        WHERE l.tournoi_id = p_tournoi AND t.publie
    ) p ORDER BY 1, 7 NULLS LAST
$$;
GRANT EXECUTE ON FUNCTION paires_tournoi(uuid) TO anon, authenticated;
