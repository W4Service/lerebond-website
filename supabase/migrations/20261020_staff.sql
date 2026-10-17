-- Rôle « staff » : seuls les comptes du club peuvent modifier les tournois.
--
-- Jusqu'ici, toute session Supabase connectée (rôle `authenticated`) pouvait écrire
-- dans les tables de tournoi (ex. americano : FOR ALL TO authenticated USING (true)).
-- Or n'importe qui peut créer un compte Supabase avec la clé publique du site : il
-- devenait alors « admin ». On réserve désormais l'écriture aux comptes listés dans
-- `staff`.
--
-- Tous les comptes existant au moment de la migration deviennent staff : l'admin
-- continue de fonctionner sans rien faire. Pour ajouter quelqu'un plus tard :
--   INSERT INTO staff (user_id, email) SELECT id, email FROM auth.users WHERE email = '…';
--
-- Les inscriptions des joueurs (migration suivante) ne passent PAS par des comptes
-- Supabase : chaque joueur reçoit un lien personnel. Le site public ne fait que lire.

CREATE TABLE IF NOT EXISTS staff (
    user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email      text,
    created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_lecture_soi ON staff;
CREATE POLICY staff_lecture_soi ON staff FOR SELECT TO authenticated USING (user_id = auth.uid());

INSERT INTO staff (user_id, email)
SELECT id, email FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

-- Vrai si la session courante est un compte du club. SECURITY DEFINER : lit `staff`
-- sans dépendre de ses propres règles d'accès.
CREATE OR REPLACE FUNCTION est_staff()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (SELECT 1 FROM public.staff WHERE user_id = auth.uid())
$$;
GRANT EXECUTE ON FUNCTION est_staff() TO anon, authenticated;

-- Règles d'accès uniformes sur les tables de tournoi : lecture pour tous (pages
-- publiques, écran TV), écriture pour le staff. Les règles existantes, quelles
-- qu'elles soient, sont remplacées ; elles sont listées dans les NOTICE.
DO $$
DECLARE
    t text;
    p record;
    tables text[] := ARRAY['tournois', 'poules', 'equipes', 'matchs', 'joueurs', 'chronos',
                           'americano_tournois', 'americano_joueurs', 'americano_matchs'];
BEGIN
    FOREACH t IN ARRAY tables LOOP
        IF to_regclass('public.' || t) IS NULL THEN
            RAISE NOTICE 'table % absente : ignorée', t;
            CONTINUE;
        END IF;
        FOR p IN SELECT policyname, cmd, roles::text AS roles FROM pg_policies
                 WHERE schemaname = 'public' AND tablename = t LOOP
            RAISE NOTICE '% : remplace la règle « % » (% pour %)', t, p.policyname, p.cmd, p.roles;
            EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t);
        END LOOP;
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO anon, authenticated USING (true)',
                       t || '_lecture', t);
        EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (est_staff()) WITH CHECK (est_staff())',
                       t || '_staff', t);
    END LOOP;
END $$;

-- Le site lit le calendrier, le staff pilote : l'actualisation des classements est
-- une écriture.
REVOKE EXECUTE ON FUNCTION actualiser_classements_joueurs() FROM authenticated;
CREATE OR REPLACE FUNCTION actualiser_classements_joueurs_staff()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    IF NOT est_staff() THEN RAISE EXCEPTION 'réservé au staff' USING ERRCODE = '42501'; END IF;
    RETURN actualiser_classements_joueurs();
END;
$$;
GRANT EXECUTE ON FUNCTION actualiser_classements_joueurs_staff() TO authenticated;
