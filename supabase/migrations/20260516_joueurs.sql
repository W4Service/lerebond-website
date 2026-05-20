-- Table 'joueurs' pour pouvoir suivre un joueur sur plusieurs tournois.
-- Chaque équipe référence 2 joueurs.

CREATE TABLE IF NOT EXISTS joueurs (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nom         text NOT NULL,
    prenom      text NOT NULL,
    points_fft  integer,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT joueurs_points_fft_check CHECK (points_fft IS NULL OR points_fft >= 0)
);

-- Recherche rapide nom+prenom (sans accent / insensible casse via lower())
CREATE INDEX IF NOT EXISTS idx_joueurs_nom_prenom_lower
    ON joueurs (lower(nom), lower(prenom));

-- Anti-doublons stricts (même nom+prenom écrits pareil)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_joueurs_nom_prenom
    ON joueurs (lower(nom), lower(prenom));

ALTER TABLE equipes
    ADD COLUMN IF NOT EXISTS joueur_j1_id uuid REFERENCES joueurs(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS joueur_j2_id uuid REFERENCES joueurs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_equipes_joueur_j1 ON equipes (joueur_j1_id);
CREATE INDEX IF NOT EXISTS idx_equipes_joueur_j2 ON equipes (joueur_j2_id);

-- Le champ equipes.nom reste pour rétro-compat (tournois clôturés sans joueurs liés).
-- Pour les nouvelles équipes, on calcule l'affichage côté UI à partir des 2 joueurs.
-- On peut donc relâcher la contrainte NOT NULL si elle existait :
ALTER TABLE equipes ALTER COLUMN nom DROP NOT NULL;
