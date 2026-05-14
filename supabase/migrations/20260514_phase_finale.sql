-- Add a 'bracket' column to matchs so we can group phase-finale matches by tier
-- (principal, 2es non-qualifiés, 3es, 4es...).
-- The existing 'phase' column accepts free text; phase='finale' marks any
-- post-pools match. The bracket column gives more granular labeling.

ALTER TABLE matchs
    ADD COLUMN IF NOT EXISTS bracket text;

-- Cache useful for "all finale matches of this tournament, by tier"
CREATE INDEX IF NOT EXISTS idx_matchs_bracket
    ON matchs (tournoi_id, phase, bracket);
