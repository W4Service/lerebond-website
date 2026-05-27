-- Mode d'affichage de la page TV : 'auto' (défaut, bascule auto poule → finale quand
-- les poules sont terminées), 'poule' (forcer le mode poule), 'finale' (forcer le mode
-- phase finale). Piloté depuis l'admin sur le header du tournoi.

ALTER TABLE tournois
    ADD COLUMN IF NOT EXISTS tv_mode text NOT NULL DEFAULT 'auto';

ALTER TABLE tournois
    DROP CONSTRAINT IF EXISTS tournois_tv_mode_check;
ALTER TABLE tournois
    ADD CONSTRAINT tournois_tv_mode_check CHECK (tv_mode IN ('auto', 'poule', 'finale'));
