-- Imitation minimale de Supabase et des tables LiveXperience, pour tester la migration
-- fidélité sur un Postgres vierge (voir lancer.sh).
SET client_min_messages = warning;

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;

CREATE SCHEMA extensions;
CREATE EXTENSION unaccent WITH SCHEMA extensions;

CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('test.uid', true), '')::uuid
$$;

CREATE TABLE public.staff (user_id uuid PRIMARY KEY, email text);
CREATE FUNCTION public.est_staff() RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM public.staff WHERE user_id = auth.uid())
$$;
CREATE FUNCTION public.site_url() RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'https://le-rebond.fr' $$;
CREATE FUNCTION public.normaliser_identite(txt text) RETURNS text LANGUAGE sql IMMUTABLE
SET search_path = extensions, public AS $$
    SELECT btrim(regexp_replace(lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(txt, ''))), '\s+', ' ', 'g'))
$$;

CREATE SCHEMA cron;
CREATE TABLE cron.job (jobname text PRIMARY KEY, schedule text, command text);
CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE sql AS $$
    INSERT INTO cron.job VALUES (n, s, c) ON CONFLICT (jobname) DO UPDATE SET schedule = s, command = c RETURNING 1::bigint
$$;
CREATE FUNCTION cron.unschedule(n text) RETURNS boolean LANGUAGE sql AS $$
    DELETE FROM cron.job WHERE jobname = n RETURNING true
$$;

-- Mêmes colonnes (toutes en texte) que les tables remplies par le script de wepepc.
CREATE SCHEMA livex;
CREATE TABLE livex.livex_clients (
    _pk bigint GENERATED ALWAYS AS IDENTITY, _scraped_at timestamptz DEFAULT now(),
    ref text, origine text, nom text, prenom text, cree_le text, type_client text,
    mail text, telephone text, credits text, niveau text, web_app text);
CREATE TABLE livex.livex_reservations (
    _pk bigint GENERATED ALWAYS AS IDENTITY, _scraped_at timestamptz DEFAULT now(),
    id text, id_centre text, type_resa text, open text, all_day text, title text, resource_id text,
    start text, "end" text, id_client text, prix text, paye text, caution text, public text,
    date_reservation text, date_resa text, _jour text);
CREATE TABLE livex.livex_paiements_jour (
    _pk bigint GENERATED ALWAYS AS IDENTITY, _scraped_at timestamptz DEFAULT now(),
    numero text, heure text, client text, col_4 text, id_resa text, description text, statut text,
    abonn text, cash text, cb text, chequ text, compt text, egym text, fidel text, offer text, virem text,
    web text, _jour text, abonnement text, cheque text, compte text, fidelite text, offert text, virement text, wellpass text);
