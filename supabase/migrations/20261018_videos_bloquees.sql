-- Vidéos bloquées à l'affichage sur le site.
--
-- Les vidéos sont hébergées par LiveXperience, pas par nous : on ne peut pas les
-- supprimer depuis ici. Cette table liste celles qu'on refuse d'AFFICHER sur
-- le-rebond.fr, typiquement quand un client exerce son droit à l'image.
--
-- Conséquence à connaître : la vidéo reste accessible chez LiveXperience par lien
-- direct. Pour une suppression réelle, il faut la demander au prestataire. La
-- colonne `motif` sert justement à retrouver les demandes à faire suivre.
--
-- id_video : identifiant LiveXperience, ex. '408_3122_1626_20261015070004'.
--            Stable dans le temps, c'est la clé du blocage.

CREATE TABLE IF NOT EXISTS videos_bloquees (
    id_video    text PRIMARY KEY,
    titre       text,            -- recopié au blocage, pour relire la liste sans réinterroger LiveXperience
    terrain     text,
    enregistree timestamptz,     -- date de la vidéo (pas celle du blocage)
    motif       text,            -- « droit à l'image », « erreur de cadrage »…
    bloquee_par uuid REFERENCES auth.users (id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE videos_bloquees IS
    'Vidéos LiveXperience masquées sur le site. Masquage d''affichage seulement : la vidéo reste chez le prestataire.';

-- Lecture pour tous : la galerie publique doit savoir quoi masquer, et elle est
-- consultée sans connexion. Ne mettre dans cette table aucune donnée sensible —
-- `motif` est lisible publiquement, donc on y écrit un motif de service, pas le
-- nom du client ni le détail de sa demande.
ALTER TABLE videos_bloquees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS videos_bloquees_lecture ON videos_bloquees;
CREATE POLICY videos_bloquees_lecture ON videos_bloquees
    FOR SELECT TO anon, authenticated USING (true);

-- Écriture réservée au staff, comme les autres tables d'administration.
DROP POLICY IF EXISTS videos_bloquees_staff ON videos_bloquees;
CREATE POLICY videos_bloquees_staff ON videos_bloquees
    FOR ALL TO authenticated USING (est_staff()) WITH CHECK (est_staff());

GRANT SELECT ON videos_bloquees TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON videos_bloquees TO authenticated;
