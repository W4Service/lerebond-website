-- Add a per-tournament classement mode + per-team FFT points (both players).
-- mode_classement:
--   'niveau' (default) : the admin uses the 1..10 niveau on each team
--   'fft'              : the admin uses individual FFT padel points per player
-- For 'fft' mode, points_j1 + points_j2 give the pair weight (used for the
-- "Répartir par niveau" auto-distribution and a visible weight badge).

ALTER TABLE tournois
    ADD COLUMN IF NOT EXISTS mode_classement text NOT NULL DEFAULT 'niveau';

ALTER TABLE tournois
    DROP CONSTRAINT IF EXISTS tournois_mode_classement_check;
ALTER TABLE tournois
    ADD CONSTRAINT tournois_mode_classement_check
        CHECK (mode_classement IN ('niveau', 'fft'));

ALTER TABLE equipes
    ADD COLUMN IF NOT EXISTS points_j1 integer,
    ADD COLUMN IF NOT EXISTS points_j2 integer;

ALTER TABLE equipes
    DROP CONSTRAINT IF EXISTS equipes_points_j1_check,
    DROP CONSTRAINT IF EXISTS equipes_points_j2_check;
ALTER TABLE equipes
    ADD CONSTRAINT equipes_points_j1_check CHECK (points_j1 IS NULL OR points_j1 >= 0),
    ADD CONSTRAINT equipes_points_j2_check CHECK (points_j2 IS NULL OR points_j2 >= 0);
