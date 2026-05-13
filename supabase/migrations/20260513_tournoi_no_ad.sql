-- Add no_ad flag on tournois.
-- false = avantage classique (jeu décisif au-delà de 40-40, "ad in / ad out")
-- true  = point décisif à 40-40 (no-ad / killer point)
-- Default false to match historical behaviour.

ALTER TABLE tournois
    ADD COLUMN IF NOT EXISTS no_ad boolean NOT NULL DEFAULT false;
