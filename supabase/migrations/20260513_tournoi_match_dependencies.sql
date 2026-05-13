-- Add dependency columns to matchs so we can pre-generate matches whose
-- teams are resolved later from the result of another match (e.g. GM1/PM2).
--
-- equipe_a_source_ordre / equipe_b_source_ordre : ordre of the source match in the same poule
-- equipe_a_source_type  / equipe_b_source_type  : 'gagnant' | 'perdant'
--
-- When the source match is finished, the dependent match's equipe_a_id / equipe_b_id
-- is filled in from the source match's vainqueur / loser.

ALTER TABLE matchs
    ADD COLUMN IF NOT EXISTS equipe_a_source_ordre integer,
    ADD COLUMN IF NOT EXISTS equipe_a_source_type  text CHECK (equipe_a_source_type IN ('gagnant', 'perdant')),
    ADD COLUMN IF NOT EXISTS equipe_b_source_ordre integer,
    ADD COLUMN IF NOT EXISTS equipe_b_source_type  text CHECK (equipe_b_source_type IN ('gagnant', 'perdant'));

-- Helpful index when the resolver looks up dependents of a finished match
CREATE INDEX IF NOT EXISTS idx_matchs_source_ordre
    ON matchs (tournoi_id, poule_id, equipe_a_source_ordre);
CREATE INDEX IF NOT EXISTS idx_matchs_source_ordre_b
    ON matchs (tournoi_id, poule_id, equipe_b_source_ordre);
