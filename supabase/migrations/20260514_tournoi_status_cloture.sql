-- Extend tournois.status to support a 'cloture' state.
-- actif    : tournoi en cours, modifiable
-- cloture  : tournoi terminé, visible côté client (historique), non modifiable
-- archive  : tournoi caché côté client, conservé en base pour restauration

-- Drop any existing check (legacy), then add the new one if a constraint existed.
ALTER TABLE tournois
    DROP CONSTRAINT IF EXISTS tournois_status_check;

-- Only add the constraint if you want to enforce values. Leave commented if your
-- schema currently has status as free text and you'd rather keep it that way.
-- ALTER TABLE tournois
--     ADD CONSTRAINT tournois_status_check
--         CHECK (status IN ('actif', 'cloture', 'archive'));
