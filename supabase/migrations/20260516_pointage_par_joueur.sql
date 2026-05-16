-- Présence/paiement par joueur (et non par équipe).
-- Les anciennes colonnes present/paye au niveau équipe sont conservées pour rétro-compat
-- mais ne sont plus utilisées par l'UI.

ALTER TABLE equipes
    ADD COLUMN IF NOT EXISTS present_j1 boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS present_j2 boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS paye_j1    boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS paye_j2    boolean NOT NULL DEFAULT false;

-- Reporter les anciens booléens (équipe entière) sur les deux joueurs si présents.
UPDATE equipes SET present_j1 = true, present_j2 = true WHERE present = true;
UPDATE equipes SET paye_j1    = true, paye_j2    = true WHERE paye    = true;
