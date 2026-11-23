-- Imitation minimale de Supabase et des tables de tournoi créées à la main (pas de
-- CREATE TABLE dans les migrations), pour rejouer les migrations utiles sur un Postgres
-- vierge (voir lancer.sh). Les colonnes ajoutées par les migrations ne sont pas ici.
SET client_min_messages = warning;

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
-- Comme Supabase : les rôles du site voient les tables (la RLS fait le tri).
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;

CREATE SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated;

CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('test.uid', true), '')::uuid
$$;

CREATE TABLE public.tournois (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nom         text NOT NULL,
    date        date NOT NULL DEFAULT current_date,
    status      text NOT NULL DEFAULT 'actif',
    homologue   boolean NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.poules (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tournoi_id  uuid REFERENCES public.tournois(id) ON DELETE CASCADE,
    nom         text
);
CREATE TABLE public.equipes (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tournoi_id  uuid REFERENCES public.tournois(id) ON DELETE CASCADE,
    nom         text NOT NULL,
    points_j1   integer,
    points_j2   integer,
    poule_id    uuid REFERENCES public.poules(id) ON DELETE SET NULL
);
CREATE TABLE public.matchs (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tournoi_id  uuid REFERENCES public.tournois(id) ON DELETE CASCADE,
    poule_id    uuid REFERENCES public.poules(id) ON DELETE SET NULL,
    equipe1_id  uuid REFERENCES public.equipes(id) ON DELETE CASCADE,
    equipe2_id  uuid REFERENCES public.equipes(id) ON DELETE CASCADE
);
