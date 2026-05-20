-- Marqueur "match retour" pour les round-robins aller-retour.
-- Les matchs de poule générés via genererMatchsRetour() sont marqués is_retour=true.
-- Le classement (computeClassement) prend tous les matchs poule terminés, donc aller+retour cumulés.

ALTER TABLE matchs
    ADD COLUMN IF NOT EXISTS is_retour boolean NOT NULL DEFAULT false;
