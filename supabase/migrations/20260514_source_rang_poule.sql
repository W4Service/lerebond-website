-- Extend source_type to support 'rang_poule' for the final-phase skeleton
-- generated before pools are finished. The equipe_*_source_ordre column then
-- stores the rank within the source poule (1 = 1er, 2 = 2e, ...).
-- equipe_*_source_poule_id (new) pinpoints which poule the rank refers to.

ALTER TABLE matchs
    DROP CONSTRAINT IF EXISTS matchs_equipe_a_source_type_check,
    DROP CONSTRAINT IF EXISTS matchs_equipe_b_source_type_check;

ALTER TABLE matchs
    ADD CONSTRAINT matchs_equipe_a_source_type_check
        CHECK (equipe_a_source_type IS NULL OR equipe_a_source_type IN ('gagnant', 'perdant', 'rang_poule', 'meilleur_2e', 'autres_2es')),
    ADD CONSTRAINT matchs_equipe_b_source_type_check
        CHECK (equipe_b_source_type IS NULL OR equipe_b_source_type IN ('gagnant', 'perdant', 'rang_poule', 'meilleur_2e', 'autres_2es'));

-- The poule_id columns on matchs are already typed correctly, mirror that type.
-- If your matchs.poule_id is BIGINT/INT instead of UUID, change uuid below.
ALTER TABLE matchs
    ADD COLUMN IF NOT EXISTS equipe_a_source_poule_id uuid,
    ADD COLUMN IF NOT EXISTS equipe_b_source_poule_id uuid;
