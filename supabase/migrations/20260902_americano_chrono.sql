-- ============================================================
-- Chrono partagé du tournoi Americano.
-- Permet aux écrans TV et à la vue publique d'afficher le même
-- décompte que le téléphone du staff : le temps restant est
-- recalculé localement à partir de tour_demarre_a.
-- ============================================================

ALTER TABLE americano_tournois
    ADD COLUMN IF NOT EXISTS tour_demarre_a   timestamptz,
    ADD COLUMN IF NOT EXISTS chrono_status    text NOT NULL DEFAULT 'idle',
    ADD COLUMN IF NOT EXISTS chrono_restant   integer;

-- 'idle'    : pas démarré, affiche la durée pleine du tour
-- 'running' : en cours, restant = duree_tour_min*60 - (now - tour_demarre_a)
-- 'paused'  : en pause, restant = chrono_restant
-- 'finished': terminé, affiche 00:00
ALTER TABLE americano_tournois
    DROP CONSTRAINT IF EXISTS americano_chrono_status_check;
ALTER TABLE americano_tournois
    ADD CONSTRAINT americano_chrono_status_check
    CHECK (chrono_status IN ('idle', 'running', 'paused', 'finished'));
