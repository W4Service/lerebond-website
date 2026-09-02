-- ============================================================
-- DIAGNOSTIC Americano — à exécuter dans l'éditeur SQL Supabase.
-- Répond à : « pourquoi le chrono ne part pas sur les écrans TV ? »
-- ============================================================

-- 1) Les colonnes du chrono existent-elles ?
--    Attendu : 3 lignes (chrono_status, chrono_restant, tour_demarre_a).
--    Si vide  -> la migration 20260902_americano_chrono.sql n'est pas passée.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'americano_tournois'
  AND column_name IN ('tour_demarre_a', 'chrono_status', 'chrono_restant')
ORDER BY column_name;

-- 2) Quelles policies existent sur les 3 tables ?
--    Attendu pour americano_tournois : une policy SELECT (anon)
--    ET une policy d'écriture couvrant UPDATE pour authenticated.
--    cmd = ALL couvre INSERT/UPDATE/DELETE ; cmd = INSERT ne couvre QUE l'insert.
SELECT tablename,
       policyname,
       cmd,
       roles,
       qual        AS using_clause,
       with_check  AS with_check_clause
FROM pg_policies
WHERE tablename IN ('americano_tournois', 'americano_joueurs', 'americano_matchs')
ORDER BY tablename, cmd, policyname;

-- 3) RLS est-il actif sur les 3 tables ?
SELECT relname AS table_name, relrowsecurity AS rls_active
FROM pg_class
WHERE relname IN ('americano_tournois', 'americano_joueurs', 'americano_matchs');

-- 4) État actuel du chrono du dernier tournoi.
SELECT nom, tour_courant, status, chrono_status, tour_demarre_a, duree_tour_min
FROM americano_tournois
ORDER BY created_at DESC
LIMIT 1;
