-- ============================================================
-- RLS du tournoi Americano
--
-- Modèle de sécurité, identique à celui de l'app :
--   - le STAFF (utilisateur connecté) crée et modifie ;
--   - le PUBLIC (clé anon, non connecté) lit seulement, pour que la vue
--     joueurs et les écrans TV fonctionnent sans login.
--
-- À exécuter dans l'éditeur SQL Supabase.
-- ============================================================

ALTER TABLE americano_tournois ENABLE ROW LEVEL SECURITY;
ALTER TABLE americano_joueurs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE americano_matchs   ENABLE ROW LEVEL SECURITY;

-- ---------- Lecture publique (vue joueurs + TV) ----------
DROP POLICY IF EXISTS americano_tournois_select_public ON americano_tournois;
CREATE POLICY americano_tournois_select_public
    ON americano_tournois FOR SELECT
    TO anon, authenticated
    USING (true);

DROP POLICY IF EXISTS americano_joueurs_select_public ON americano_joueurs;
CREATE POLICY americano_joueurs_select_public
    ON americano_joueurs FOR SELECT
    TO anon, authenticated
    USING (true);

DROP POLICY IF EXISTS americano_matchs_select_public ON americano_matchs;
CREATE POLICY americano_matchs_select_public
    ON americano_matchs FOR SELECT
    TO anon, authenticated
    USING (true);

-- ---------- Écriture réservée au staff connecté ----------
-- FOR ALL couvre INSERT / UPDATE / DELETE.
-- WITH CHECK est indispensable : sans lui, les INSERT restent refusés.
DROP POLICY IF EXISTS americano_tournois_write_staff ON americano_tournois;
CREATE POLICY americano_tournois_write_staff
    ON americano_tournois FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS americano_joueurs_write_staff ON americano_joueurs;
CREATE POLICY americano_joueurs_write_staff
    ON americano_joueurs FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS americano_matchs_write_staff ON americano_matchs;
CREATE POLICY americano_matchs_write_staff
    ON americano_matchs FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);
