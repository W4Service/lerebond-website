-- Scénarios du profil joueur, de l'annuaire et de la messagerie (migration 20261121).
-- Les appels se font avec le rôle `anon`, comme le site public ; les vérifications sur
-- les tables privées passent par des fonctions t.* SECURITY DEFINER.
SET client_min_messages = warning;
CREATE SCHEMA t;
GRANT USAGE ON SCHEMA t TO anon, authenticated;

CREATE TABLE t.resultats (n serial, nom text, ok boolean, detail text);
CREATE FUNCTION t.check(p_nom text, p_ok boolean, p_detail text DEFAULT NULL) RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$ INSERT INTO t.resultats (nom, ok, detail) VALUES (p_nom, coalesce(p_ok, false), p_detail) $$;

-- Exécute une requête avec le rôle courant ; renvoie « code : message » ou NULL si elle passe.
CREATE FUNCTION t.erreur(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE p_sql;
    RETURN NULL;
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE || ' : ' || SQLERRM;
END $$;

CREATE TABLE t.joueurs (cle text PRIMARY KEY, id uuid, jeton uuid);
CREATE FUNCTION t.id(p_cle text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT id FROM t.joueurs WHERE cle = p_cle $$;
CREATE FUNCTION t.j(p_cle text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT jeton FROM t.joueurs WHERE cle = p_cle $$;
-- Référence opaque (ce que voient les autres joueurs) ; NULL tant que le joueur n'a ni profil ni message.
CREATE FUNCTION t.ref(p_cle text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT ref FROM public.joueurs_refs WHERE joueur_id = t.id(p_cle)
$$;
CREATE FUNCTION t.tous_ids() RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT array_agg(id::text) FROM public.joueurs $$;
CREATE FUNCTION t.email(p_cle text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT email FROM public.joueurs_contacts WHERE joueur_id = t.id(p_cle)
$$;
CREATE FUNCTION t.notif_partenaire(p_cle text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT destinataire FROM public.notifications WHERE type IN ('partenaire', 'inscription') AND joueur_id = t.id(p_cle) AND canal = 'email'
    ORDER BY cree_le DESC LIMIT 1
$$;
CREATE FUNCTION t.jeton_de(p_nom text, p_prenom text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT c.jeton FROM public.joueurs j JOIN public.joueurs_contacts c ON c.joueur_id = j.id WHERE j.nom = p_nom AND j.prenom = p_prenom
$$;
CREATE FUNCTION t.nb_signalements() RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT count(*)::int FROM public.joueurs_signalements $$;
CREATE FUNCTION t.remplir_signalements(p_n integer) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
    INSERT INTO public.joueurs_signalements (joueur_id, signale_id, motif)
    SELECT t.id('p4'), t.id('p5'), 'bruit' FROM generate_series(1, p_n)
$$;

CREATE FUNCTION t.joueur(p_cle text, p_prenom text, p_nom text, p_genre char(1), p_rang integer DEFAULT NULL,
                         p_crm bigint DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v uuid;
BEGIN
    INSERT INTO public.joueurs (nom, prenom, genre, fft_rang, fft_id_crm)
    VALUES (p_nom, p_prenom, p_genre, p_rang, p_crm) RETURNING id INTO v;
    INSERT INTO public.joueurs_contacts (joueur_id, email, telephone)
    VALUES (v, lower(p_prenom) || '.' || lower(p_nom) || '@exemple.fr', '0611' || lpad((random() * 999999)::int::text, 6, '0'));
    INSERT INTO t.joueurs VALUES (p_cle, v, (SELECT jeton FROM public.joueurs_contacts WHERE joueur_id = v));
    RETURN v;
END $$;

-- Profil posé directement (le parcours par enregistrer_profil est testé à part).
CREATE FUNCTION t.profil(p_cle text, p_ouvert boolean, p_cote text DEFAULT NULL, p_niveau smallint DEFAULT NULL,
                         p_dispos text[] DEFAULT '{}', p_pres text DEFAULT NULL, p_maj timestamptz DEFAULT now())
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
    INSERT INTO public.joueurs_profils (joueur_id, cote, niveau_declare, dispos, presentation, ouvert, maj_le)
    VALUES (t.id(p_cle), p_cote, p_niveau, p_dispos, p_pres, p_ouvert, p_maj)
    ON CONFLICT (joueur_id) DO UPDATE SET cote = EXCLUDED.cote, niveau_declare = EXCLUDED.niveau_declare,
        dispos = EXCLUDED.dispos, presentation = EXCLUDED.presentation, ouvert = EXCLUDED.ouvert, maj_le = EXCLUDED.maj_le
$$;

CREATE FUNCTION t.reset() RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    TRUNCATE public.messages, public.joueurs_blocages, public.joueurs_signalements, public.notifications;
END $$;

CREATE FUNCTION t.nb_notif(p_cle text, p_canal text DEFAULT 'email') RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT count(*)::int FROM public.notifications WHERE type = 'message' AND joueur_id = t.id(p_cle) AND canal = p_canal
$$;
CREATE FUNCTION t.derniere_notif(p_cle text) RETURNS record LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT sujet, corps FROM public.notifications WHERE type = 'message' AND joueur_id = t.id(p_cle) AND canal = 'email'
    ORDER BY cree_le DESC LIMIT 1
$$;
CREATE FUNCTION t.sujet_notif(p_cle text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT sujet FROM public.notifications WHERE type = 'message' AND joueur_id = t.id(p_cle) AND canal = 'email'
    ORDER BY cree_le DESC LIMIT 1
$$;
CREATE FUNCTION t.corps_notif(p_cle text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT corps FROM public.notifications WHERE type = 'message' AND joueur_id = t.id(p_cle) AND canal = 'email'
    ORDER BY cree_le DESC LIMIT 1
$$;
CREATE FUNCTION t.vieillir_notifs(p_minutes integer) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
    UPDATE public.notifications SET cree_le = cree_le - make_interval(mins => p_minutes)
$$;
CREATE FUNCTION t.vieillir_messages(p_minutes integer) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
    UPDATE public.messages SET cree_le = cree_le - make_interval(mins => p_minutes)
$$;
CREATE FUNCTION t.nb_messages(p_de text, p_a text) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT count(*)::int FROM public.messages WHERE de_joueur = t.id(p_de) AND a_joueur = t.id(p_a)
$$;
CREATE FUNCTION t.texte_dernier(p_de text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT texte FROM public.messages WHERE de_joueur = t.id(p_de) ORDER BY cree_le DESC LIMIT 1
$$;
CREATE FUNCTION t.alertes() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT string_agg(destinataire || ' | ' || sujet || ' | ' || corps, E'\n---\n') FROM public.notifications WHERE type = 'alerte_staff'
$$;
CREATE FUNCTION t.nb_alertes() RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT count(*)::int FROM public.notifications WHERE type = 'alerte_staff'
$$;
-- Toutes les coordonnées connues (pour vérifier qu'aucune sortie publique n'en contient).
CREATE FUNCTION t.coordonnees() RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT array_agg(x) FROM (SELECT email AS x FROM public.joueurs_contacts UNION ALL SELECT telephone FROM public.joueurs_contacts
                              UNION ALL SELECT jeton::text FROM public.joueurs_contacts) s
$$;

-- ===================================================================== jeu d'essai
DO $$
DECLARE t1 uuid; t2 uuid; t3 uuid;
BEGIN
    PERFORM t.joueur('marc',  'Marc',  'Durand',  'H', 5000);
    PERFORM t.joueur('alice', 'Alice', 'Martin',  'F', 1200, 111);
    PERFORM t.joueur('bruno', 'Bruno', 'Petit',   'H');
    PERFORM t.joueur('chloe', 'Chloé', 'Bernard', 'F', 3000);
    PERFORM t.joueur('david', 'David', 'Roux',    'H', 8000);
    PERFORM t.joueur('emma',  'Emma',  'Leroy',   'F', 900);
    PERFORM t.joueur('fabien','Fabien','Morel',   'H', 2500);
    FOR i IN 1..6 LOOP PERFORM t.joueur('p' || i, 'Pierre' || i, 'Test' || i, 'H', 10000 + i); END LOOP;

    PERFORM t.profil('marc',  true,  'droite', NULL, '{semaine_soir}', 'Joueur du mardi soir', now() - interval '5 days');
    PERFORM t.profil('alice', true,  'gauche', NULL, '{weekend_matin}', 'Revers solide, dispo le week-end', now() - interval '2 days');
    PERFORM t.profil('bruno', true,  'droite', 4::smallint, '{semaine_soir,semaine_midi}', 'Débutant motivé', now() - interval '1 day');
    PERFORM t.profil('chloe', false, 'les_deux', NULL, '{}', 'Profil fermé', now());
    PERFORM t.profil('emma',  true,  'les_deux', NULL, '{weekend_apres_midi}', NULL, now() - interval '3 days');
    PERFORM t.profil('fabien',true,  'gauche', NULL, '{}', NULL, now() - interval '4 days');
    FOR i IN 1..6 LOOP PERFORM t.profil('p' || i, true, NULL, NULL, '{}', NULL, now() - interval '10 days'); END LOOP;

    -- tournois joués au club : alice 2 (dont une victoire), le planifié ne compte pas
    INSERT INTO tournois (nom, date, status) VALUES ('P100 Automne', '2026-10-10', 'cloture') RETURNING id INTO t1;
    INSERT INTO tournois (nom, date, status) VALUES ('P25 du jeudi', '2026-11-12', 'actif') RETURNING id INTO t2;
    INSERT INTO tournois (nom, date, status) VALUES ('P250 Hiver', '2026-12-20', 'planifie') RETURNING id INTO t3;
    INSERT INTO equipes (tournoi_id, nom, joueur_j1_id, joueur_j2_id, place_finale) VALUES
        (t1, 'A/B', t.id('alice'), t.id('bruno'), 1),
        (t2, 'A/M', t.id('alice'), t.id('marc'), 3),
        (t3, 'A/D', t.id('alice'), t.id('david'), NULL);
    INSERT INTO fft_classement (mois, genre, rang, nom, prenom, points, id_crm) VALUES
        ('2026-10-01', 'F', 1400, 'MARTIN', 'Alice', 300, 111),
        ('2026-11-01', 'F', 1200, 'MARTIN', 'Alice', 350, 111);

    -- marc bloque fabien ; emma bloque marc
    INSERT INTO joueurs_blocages (joueur_id, bloque_id) VALUES (t.id('marc'), t.id('fabien')), (t.id('emma'), t.id('marc'));
END $$;

-- À partir d'ici : rôle du site public.
SET ROLE anon;

-- ===================================================================== lien
DO $$
DECLARE faux text := quote_literal(gen_random_uuid()); q text; e text; ok boolean := true; bilan text := '';
BEGIN
    FOREACH q IN ARRAY ARRAY[
        'SELECT mon_profil(' || faux || ')',
        'SELECT enregistrer_profil(' || faux || ', ''{"ouvert":true}'')',
        'SELECT supprimer_profil(' || faux || ')',
        'SELECT * FROM annuaire_joueurs(' || faux || ')',
        'SELECT fiche_joueur(' || faux || ', ' || quote_literal(t.ref('alice')) || ')',
        'SELECT envoyer_message(' || faux || ', ' || quote_literal(t.ref('alice')) || ', ''Salut'')',
        'SELECT mes_conversations(' || faux || ')',
        'SELECT conversation(' || faux || ', ' || quote_literal(t.ref('alice')) || ')',
        'SELECT bloquer_joueur(' || faux || ', ' || quote_literal(t.ref('alice')) || ', true)',
        'SELECT signaler_joueur(' || faux || ', ' || quote_literal(t.ref('alice')) || ', ''motif'')'] LOOP
        e := t.erreur(q);
        IF e IS NULL OR e NOT LIKE '42501 : Lien inconnu ou expiré%' THEN ok := false; bilan := bilan || q || ' → ' || coalesce(e, 'passe') || '; '; END IF;
    END LOOP;
    PERFORM t.check('jeton faux refusé par les 10 fonctions (42501 « Lien inconnu ou expiré »)', ok, nullif(bilan, ''));
    PERFORM t.check('jeton NULL refusé', t.erreur('SELECT * FROM annuaire_joueurs(NULL)') LIKE '42501%');
END $$;

-- ===================================================================== droits
DO $$
DECLARE tb text; e text; ok boolean := true; bilan text := '';
BEGIN
    FOREACH tb IN ARRAY ARRAY['joueurs_profils', 'messages', 'joueurs_blocages', 'joueurs_signalements', 'joueurs_refs'] LOOP
        e := t.erreur('SELECT * FROM ' || tb);
        IF e IS NULL OR e NOT LIKE '42501%' THEN ok := false; bilan := bilan || tb || ' : ' || coalesce(e, 'lisible') || '; '; END IF;
        e := t.erreur('INSERT INTO ' || tb || ' DEFAULT VALUES');
        IF e IS NULL OR e NOT LIKE '42501%' THEN ok := false; bilan := bilan || tb || ' (écriture) : ' || coalesce(e, 'acceptée') || '; '; END IF;
    END LOOP;
    PERFORM t.check('anon : ni lecture ni écriture sur les 5 nouvelles tables (dont joueurs_refs)', ok, nullif(bilan, ''));
    PERFORM t.check('anon : outils internes fermés (joueur_du_jeton, carte_joueur, conversation_existe, blocage_entre, prenom_initiale)',
        t.erreur('SELECT joueur_du_jeton(' || quote_literal(t.j('marc')) || ')') LIKE '42501 : permission denied%'
        AND t.erreur('SELECT carte_joueur(' || quote_literal(t.ref('marc')) || ')') LIKE '42501 : permission denied%'
        AND t.erreur('SELECT conversation_existe(' || quote_literal(t.ref('marc')) || ', ' || quote_literal(t.ref('alice')) || ')') LIKE '42501 : permission denied%'
        AND t.erreur('SELECT blocage_entre(' || quote_literal(t.ref('marc')) || ', ' || quote_literal(t.ref('alice')) || ')') LIKE '42501 : permission denied%'
        AND t.erreur('SELECT prenom_initiale(' || quote_literal(t.ref('marc')) || ')') LIKE '42501 : permission denied%'
        AND t.erreur('SELECT joueur_de_ref(' || quote_literal(t.ref('marc')) || ')') LIKE '42501 : permission denied%'
        AND t.erreur('SELECT lien_si_nouveau(' || quote_literal(t.ref('marc')) || ')') LIKE '42501 : permission denied%'
        AND t.erreur('SELECT staff_regenerer_lien(' || quote_literal(t.ref('marc')) || ')') LIKE '42501%');
    PERFORM t.check('un identifiant joueurs.id n''est pas accepté (référence opaque seulement)',
        t.erreur('SELECT envoyer_message(' || quote_literal(t.j('marc')) || ', ' || quote_literal(t.id('alice')) || ', ''Salut'')') LIKE '22023 : Joueur introuvable%'
        AND t.erreur('SELECT fiche_joueur(' || quote_literal(t.j('marc')) || ', ' || quote_literal(t.id('alice')) || ')') LIKE '22023 : Joueur introuvable%');
END $$;

RESET ROLE;
-- Compte connecté mais pas staff : la RLS ne laisse rien voir ; le staff voit tout.
DO $$
DECLARE u_staff uuid := gen_random_uuid(); u_autre uuid := gen_random_uuid(); n_autre int; n_staff int;
BEGIN
    INSERT INTO auth.users VALUES (u_staff, 'staff@exemple.fr'), (u_autre, 'autre@exemple.fr');
    INSERT INTO staff (user_id, email) VALUES (u_staff, 'staff@exemple.fr');
    PERFORM set_config('test.uid', u_autre::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO n_autre FROM joueurs_profils;
    RESET ROLE;
    PERFORM set_config('test.uid', u_staff::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO n_staff FROM joueurs_profils;
    RESET ROLE;
    PERFORM t.check('authenticated non staff : 0 profil visible ; staff : tous', n_autre = 0 AND n_staff = 12,
                    n_autre || ' / ' || n_staff);
END $$;
SET ROLE anon;

-- ===================================================================== profil
DO $$
DECLARE r jsonb; e text;
BEGIN
    r := mon_profil(t.j('david'));
    PERFORM t.check('mon_profil sans profil : profil NULL, prénom et non lus', r->'profil' = 'null'::jsonb AND r->>'prenom' = 'David' AND (r->>'non_lus')::int = 0, r::text);

    r := enregistrer_profil(t.j('david'), '{"cote":"gauche","niveau_declare":"5","dispos":["weekend_matin","semaine_midi","weekend_matin"],"presentation":"  Bonjour  "}');
    PERFORM t.check('enregistrer_profil : décoché par défaut (opt-in)', (r->'profil'->>'ouvert')::boolean = false, r::text);
    PERFORM t.check('enregistrer_profil : dispos sans doublon, dans l''ordre de la semaine',
        r->'profil'->'dispos' = '["semaine_midi","weekend_matin"]'::jsonb, r->'profil'->>'dispos');
    PERFORM t.check('enregistrer_profil : présentation nettoyée, niveau 5', r->'profil'->>'presentation' = 'Bonjour' AND (r->'profil'->>'niveau_declare')::int = 5);
    PERFORM t.check('profil fermé : absent de l''annuaire',
        NOT EXISTS (SELECT 1 FROM annuaire_joueurs(t.j('marc')) a WHERE a.ref = t.ref('david')));

    r := enregistrer_profil(t.j('david'), jsonb_build_object('ouvert', true, 'cote', 'les_deux', 'presentation', repeat('x', 400)));
    PERFORM t.check('présentation tronquée à 300 caractères', char_length(r->'profil'->>'presentation') = 300);
    PERFORM t.check('profil ouvert : présent dans l''annuaire',
        EXISTS (SELECT 1 FROM annuaire_joueurs(t.j('marc')) a WHERE a.ref = t.ref('david')));

    e := t.erreur('SELECT enregistrer_profil(' || quote_literal(t.j('david')) || ', ''{"cote":"milieu"}'')');
    PERFORM t.check('côté invalide refusé (22023)', e LIKE '22023 : Côté invalide%', e);
    e := t.erreur('SELECT enregistrer_profil(' || quote_literal(t.j('david')) || ', ''{"niveau_declare":9}'')');
    PERFORM t.check('niveau 9 refusé (22023)', e LIKE '22023 : Niveau déclaré invalide%', e);
    e := t.erreur('SELECT enregistrer_profil(' || quote_literal(t.j('david')) || ', ''{"niveau_declare":"2.5"}'')');
    PERFORM t.check('niveau non entier refusé (22023)', e LIKE '22023%', e);
    e := t.erreur('SELECT enregistrer_profil(' || quote_literal(t.j('david')) || ', ''{"dispos":["la_nuit"]}'')');
    PERFORM t.check('disponibilité inconnue refusée (22023)', e LIKE '22023 : Disponibilité inconnue : la_nuit%', e);
    e := t.erreur('SELECT enregistrer_profil(' || quote_literal(t.j('david')) || ', ''{"dispos":"semaine_soir"}'')');
    PERFORM t.check('dispos hors tableau refusées (22023)', e LIKE '22023%', e);
    e := t.erreur('SELECT enregistrer_profil(' || quote_literal(t.j('david')) || ', ''{"ouvert":"oui"}'')');
    PERFORM t.check('ouvert non booléen refusé (22023)', e LIKE '22023%', e);
    e := t.erreur('SELECT enregistrer_profil(' || quote_literal(t.j('david')) || ', ''[1]'')');
    PERFORM t.check('profil non objet refusé (22023)', e LIKE '22023 : Profil invalide%', e);

    PERFORM supprimer_profil(t.j('david'));
    PERFORM t.check('supprimer_profil : plus de profil, absent de l''annuaire',
        mon_profil(t.j('david'))->'profil' = 'null'::jsonb
        AND NOT EXISTS (SELECT 1 FROM annuaire_joueurs(t.j('marc')) a WHERE a.ref = t.ref('david')));
END $$;

-- ===================================================================== annuaire
DO $$
DECLARE ids uuid[]; a record; e text;
BEGIN
    SELECT array_agg(x.ref) INTO ids FROM annuaire_joueurs(t.j('marc')) x;
    PERFORM t.check('annuaire : les profils ouverts (alice, bruno, p1..p6)',
        ids @> ARRAY[t.ref('alice'), t.ref('bruno'), t.ref('p1'), t.ref('p6')] AND cardinality(ids) = 8, cardinality(ids)::text);
    PERFORM t.check('annuaire : pas soi-même', NOT t.ref('marc') = ANY (ids));
    PERFORM t.check('annuaire : pas les profils fermés ni les joueurs sans profil', NOT t.ref('chloe') = ANY (ids) AND NOT t.ref('david') = ANY (ids));
    PERFORM t.check('annuaire : pas celui que j''ai bloqué', NOT t.ref('fabien') = ANY (ids));
    PERFORM t.check('annuaire : pas celle qui m''a bloqué', NOT t.ref('emma') = ANY (ids));
    PERFORM t.check('annuaire d''emma : marc (qu''elle a bloqué) n''y est pas',
        NOT EXISTS (SELECT 1 FROM annuaire_joueurs(t.j('emma')) x WHERE x.ref = t.ref('marc')));
    PERFORM t.check('annuaire de fabien : marc (qui l''a bloqué) n''y est pas',
        NOT EXISTS (SELECT 1 FROM annuaire_joueurs(t.j('fabien')) x WHERE x.ref = t.ref('marc')));
    PERFORM t.check('annuaire visible par un joueur sans profil (david)',
        (SELECT count(*) FROM annuaire_joueurs(t.j('david'))) >= 8);

    SELECT x.ref INTO a FROM annuaire_joueurs(t.j('marc')) x LIMIT 1;
    PERFORM t.check('tri : profil mis à jour le plus récemment d''abord (bruno)', a.ref = t.ref('bruno'));

    SELECT * INTO a FROM annuaire_joueurs(t.j('marc')) x WHERE x.ref = t.ref('alice');
    PERFORM t.check('carte : prénom + initiale du nom', a.prenom = 'Alice' AND a.initiale = 'M.', a.prenom || ' ' || a.initiale);
    PERFORM t.check('carte : tournois joués au club (2, le planifié ne compte pas), meilleure place 1',
        a.nb_tournois = 2 AND a.meilleure_place = 1, a.nb_tournois || ' / ' || a.meilleure_place);
    PERFORM t.check('carte : rang FFT, côté, dispos, présentation',
        a.fft_rang = 1200 AND a.cote = 'gauche' AND a.dispos = '{weekend_matin}' AND a.presentation LIKE 'Revers%');

    PERFORM t.check('filtre genre F → alice seule',
        (SELECT array_agg(x.ref) FROM annuaire_joueurs(t.j('marc'), '{"genre":"F"}') x) = ARRAY[t.ref('alice')]);
    PERFORM t.check('filtre côté droite → bruno',
        (SELECT array_agg(x.ref) FROM annuaire_joueurs(t.j('marc'), '{"cote":"droite"}') x) = ARRAY[t.ref('bruno')]);
    PERFORM t.check('filtre disponibilité semaine_midi → bruno',
        (SELECT array_agg(x.ref) FROM annuaire_joueurs(t.j('marc'), '{"dispo":"semaine_midi"}') x) = ARRAY[t.ref('bruno')]);
    PERFORM t.check('filtre rang FFT max 2000 → alice',
        (SELECT array_agg(x.ref) FROM annuaire_joueurs(t.j('marc'), '{"rang_max":2000}') x) = ARRAY[t.ref('alice')]);
    PERFORM t.check('filtre niveau min 3 → bruno',
        (SELECT array_agg(x.ref) FROM annuaire_joueurs(t.j('marc'), '{"niveau_min":"3"}') x) = ARRAY[t.ref('bruno')]);
    PERFORM t.check('filtre texte sans accents ni casse (« WEEK-END ») → alice',
        (SELECT array_agg(x.ref) FROM annuaire_joueurs(t.j('marc'), '{"texte":"WEEK-END"}') x) = ARRAY[t.ref('alice')]);
    PERFORM t.check('filtre texte accentué (« débutant ») → bruno ; « debutant » aussi',
        (SELECT array_agg(x.ref) FROM annuaire_joueurs(t.j('marc'), '{"texte":"débutant"}') x) = ARRAY[t.ref('bruno')]
        AND (SELECT array_agg(x.ref) FROM annuaire_joueurs(t.j('marc'), '{"texte":"debutant"}') x) = ARRAY[t.ref('bruno')]);
    PERFORM t.check('filtre texte « % » : pas de joker', NOT EXISTS (SELECT 1 FROM annuaire_joueurs(t.j('marc'), '{"texte":"%"}')));
    PERFORM t.check('filtres vides = pas de filtre', (SELECT count(*) FROM annuaire_joueurs(t.j('marc'), '{"genre":"","cote":null,"texte":"  "}')) = 8);
    e := t.erreur('SELECT * FROM annuaire_joueurs(' || quote_literal(t.j('marc')) || ', ''{"rang_max":"abc"}'')');
    PERFORM t.check('filtre rang invalide refusé (22023)', e LIKE '22023%', e);
    e := t.erreur('SELECT * FROM annuaire_joueurs(' || quote_literal(t.j('marc')) || ', ''{"genre":"X"}'')');
    PERFORM t.check('filtre genre invalide refusé (22023)', e LIKE '22023%', e);
END $$;

-- ===================================================================== fiche
DO $$
DECLARE f jsonb; e text;
BEGIN
    f := fiche_joueur(t.j('marc'), t.ref('alice'));
    PERFORM t.check('fiche d''un profil ouvert : historique des tournois au club (2)', jsonb_array_length(f->'tournois') = 2
        AND f->'tournois'->0->>'tournoi' = 'P25 du jeudi' AND (f->'tournois'->1->>'place')::int = 1, f->>'tournois');
    PERFORM t.check('fiche : évolution du classement (2 mois)', jsonb_array_length(f->'historique_classement') = 2
        AND (f->'historique_classement'->1->>'rang')::int = 1200);
    PERFORM t.check('fiche : même contenu que l''annuaire', f->>'prenom' = 'Alice' AND f->>'initiale' = 'M.' AND (f->>'nb_tournois')::int = 2);
    PERFORM t.check('fiche : pas de nom de famille complet, ni identifiant FFT, ni licence',
        NOT f ? 'nom' AND NOT f ? 'fft_id_crm' AND NOT f ? 'licence' AND position('Martin' IN f::text) = 0);
    e := t.erreur('SELECT fiche_joueur(' || quote_literal(t.j('marc')) || ', ' || quote_literal(t.ref('chloe')) || ')');
    PERFORM t.check('fiche d''un profil fermé sans conversation : refusée (42501)', e LIKE '42501 : Ce profil n''est pas visible%', e);
    e := t.erreur('SELECT fiche_joueur(' || quote_literal(t.j('marc')) || ', ' || quote_literal(t.ref('emma')) || ')');
    PERFORM t.check('fiche d''une joueuse qui m''a bloqué : refusée', e LIKE '42501%', e);
    e := t.erreur('SELECT fiche_joueur(' || quote_literal(t.j('marc')) || ', ' || quote_literal(t.ref('david')) || ')');
    PERFORM t.check('fiche d''un joueur sans profil : refusée', e LIKE '42501%', e);
END $$;

-- ===================================================================== messages : qui peut écrire à qui
DO $$
DECLARE e text; r jsonb;
BEGIN
    PERFORM t.reset();
    e := t.erreur('SELECT envoyer_message(' || quote_literal(t.j('marc')) || ', ' || quote_literal(t.ref('chloe')) || ', ''On joue ?'')');
    PERFORM t.check('message vers un profil fermé, sans conversation : refusé (22023)', e LIKE '22023 : Ce joueur n''est pas ouvert aux propositions%', e);
    e := t.erreur('SELECT envoyer_message(' || quote_literal(t.j('marc')) || ', ' || quote_literal(t.ref('david')) || ', ''On joue ?'')');
    PERFORM t.check('message vers un joueur sans profil : refusé', e LIKE '22023 : Ce joueur n''est pas ouvert%', e);

    r := envoyer_message(t.j('chloe'), t.ref('marc'), 'Salut Marc, partant pour dimanche ?');
    PERFORM t.check('chloé (fermée) écrit à marc (ouvert) : accepté', r ? 'id');
    e := t.erreur('SELECT envoyer_message(' || quote_literal(t.j('marc')) || ', ' || quote_literal(t.ref('chloe')) || ', ''Oui !'')');
    PERFORM t.check('marc répond à chloé (fermée) dans la conversation existante : accepté', e IS NULL, e);
    PERFORM t.check('fiche de chloé visible pour marc une fois la conversation ouverte',
        t.erreur('SELECT fiche_joueur(' || quote_literal(t.j('marc')) || ', ' || quote_literal(t.ref('chloe')) || ')') IS NULL);

    -- alice ferme son profil après avoir écrit : marc peut toujours lui répondre
    PERFORM envoyer_message(t.j('marc'), t.ref('alice'), 'Bonjour Alice');
    PERFORM supprimer_profil(t.j('alice'));
    e := t.erreur('SELECT envoyer_message(' || quote_literal(t.j('alice')) || ', ' || quote_literal(t.ref('marc')) || ', ''Avec plaisir'')');
    PERFORM t.check('alice (profil supprimé) répond à marc : accepté', e IS NULL, e);
    e := t.erreur('SELECT envoyer_message(' || quote_literal(t.j('marc')) || ', ' || quote_literal(t.ref('alice')) || ', ''Super'')');
    PERFORM t.check('marc écrit encore à alice (profil supprimé, conversation existante) : accepté', e IS NULL, e);
    PERFORM t.check('alice a disparu de l''annuaire', NOT EXISTS (SELECT 1 FROM annuaire_joueurs(t.j('marc')) x WHERE x.ref = t.ref('alice')));
    PERFORM t.profil('alice', true, 'gauche', NULL, '{weekend_matin}', 'Revers solide, dispo le week-end', now() - interval '2 days');

    -- p3 ferme son profil sans avoir répondu : marc ne peut plus lui écrire ; p3 peut lui répondre
    PERFORM envoyer_message(t.j('marc'), t.ref('p3'), 'Une partie samedi ?');
    PERFORM t.profil('p3', false);
    e := t.erreur('SELECT envoyer_message(' || quote_literal(t.j('marc')) || ', ' || quote_literal(t.ref('p3')) || ', ''Alors ?'')');
    PERFORM t.check('B ferme son profil sans répondre : A ne peut plus lui écrire (22023)', e LIKE '22023 : Ce joueur n''est pas ouvert%', e);
    e := t.erreur('SELECT envoyer_message(' || quote_literal(t.j('p3')) || ', ' || quote_literal(t.ref('marc')) || ', ''Oui, samedi'')');
    PERFORM t.check('… mais B (fermé) peut répondre à A', e IS NULL, e);
    e := t.erreur('SELECT envoyer_message(' || quote_literal(t.j('marc')) || ', ' || quote_literal(t.ref('p3')) || ', ''Top'')');
    PERFORM t.check('… et une fois que B a répondu, A peut continuer', e IS NULL, e);
    PERFORM t.profil('p3', true, NULL, NULL, '{}', NULL, now() - interval '10 days');

    e := t.erreur('SELECT envoyer_message(' || quote_literal(t.j('marc')) || ', ' || quote_literal(t.ref('marc')) || ', ''Moi'')');
    PERFORM t.check('message à soi-même refusé', e LIKE '22023 : Vous ne pouvez pas vous écrire%', e);
    e := t.erreur('SELECT envoyer_message(' || quote_literal(t.j('marc')) || ', ' || quote_literal(t.ref('bruno')) || ', ''   '')');
    PERFORM t.check('message vide refusé', e LIKE '22023 : Le message est vide%', e);
    e := t.erreur('SELECT envoyer_message(' || quote_literal(t.j('marc')) || ', ' || quote_literal(t.ref('bruno')) || ', E''\n\t \r\n'')');
    PERFORM t.check('message fait seulement de retours à la ligne / tabulations : refusé (vide)', e LIKE '22023 : Le message est vide%', e);
    e := t.erreur('SELECT envoyer_message(' || quote_literal(t.j('marc')) || ', ' || quote_literal(gen_random_uuid()) || ', ''Hé'')');
    PERFORM t.check('destinataire inconnu refusé', e LIKE '22023 : Joueur introuvable%', e);
    PERFORM envoyer_message(t.j('marc'), t.ref('bruno'), E'\n\t ' || repeat('a', 1500) || E' \n');
    PERFORM t.check('message tronqué à 1000 caractères, blancs retirés', char_length(t.texte_dernier('marc')) = 1000
        AND left(t.texte_dernier('marc'), 1) = 'a');
    PERFORM envoyer_message(t.j('marc'), t.ref('bruno'), E'Ligne 1\n\nLigne 2\n');
    PERFORM t.check('retours à la ligne intérieurs gardés, finaux retirés', t.texte_dernier('marc') = E'Ligne 1\n\nLigne 2');
END $$;

-- ===================================================================== blocage
SELECT t.reset() \gset
RESET ROLE;
INSERT INTO joueurs_blocages (joueur_id, bloque_id) VALUES (t.id('marc'), t.id('fabien')), (t.id('emma'), t.id('marc'));
SET ROLE anon;
DO $$
DECLARE e text;
BEGIN
    e := t.erreur('SELECT envoyer_message(' || quote_literal(t.j('marc')) || ', ' || quote_literal(t.ref('emma')) || ', ''Salut'')');
    PERFORM t.check('emma m''a bloqué : envoi refusé', e LIKE '22023 : Ce joueur ne reçoit pas vos messages%', e);
    e := t.erreur('SELECT envoyer_message(' || quote_literal(t.j('marc')) || ', ' || quote_literal(t.ref('fabien')) || ', ''Salut'')');
    PERFORM t.check('j''ai bloqué fabien : envoi refusé', e LIKE '22023 : Vous avez bloqué ce joueur%', e);
    e := t.erreur('SELECT envoyer_message(' || quote_literal(t.j('fabien')) || ', ' || quote_literal(t.ref('marc')) || ', ''Salut'')');
    PERFORM t.check('fabien (que j''ai bloqué) ne peut pas m''écrire', e LIKE '22023 : Ce joueur ne reçoit pas vos messages%', e);

    -- blocage en cours de conversation
    PERFORM envoyer_message(t.j('marc'), t.ref('bruno'), 'Partie jeudi ?');
    PERFORM envoyer_message(t.j('bruno'), t.ref('marc'), 'Ok');
    PERFORM bloquer_joueur(t.j('bruno'), t.ref('marc'), true);
    PERFORM bloquer_joueur(t.j('bruno'), t.ref('marc'), true);   -- deux fois : sans erreur
    e := t.erreur('SELECT envoyer_message(' || quote_literal(t.j('marc')) || ', ' || quote_literal(t.ref('bruno')) || ', ''Alors ?'')');
    PERFORM t.check('blocage pendant une conversation : la réponse est refusée', e LIKE '22023 : Ce joueur ne reçoit pas vos messages%', e);
    e := t.erreur('SELECT fiche_joueur(' || quote_literal(t.j('marc')) || ', ' || quote_literal(t.ref('bruno')) || ')');
    PERFORM t.check('B bloque A après échange : fiche_joueur(A → B) refusée (42501)', e LIKE '42501 : Ce profil n''est pas visible%', e);
    e := t.erreur('SELECT fiche_joueur(' || quote_literal(t.j('bruno')) || ', ' || quote_literal(t.ref('marc')) || ')');
    PERFORM t.check('… et fiche_joueur(B → A) aussi', e LIKE '42501%', e);
    PERFORM t.check('mes_conversations de bruno : marc marqué bloqué',
        (SELECT (x->>'bloque')::boolean FROM jsonb_array_elements(mes_conversations(t.j('bruno'))) x
         WHERE x->>'ref' = t.ref('marc')::text));
    PERFORM bloquer_joueur(t.j('bruno'), t.ref('marc'), false);
    e := t.erreur('SELECT envoyer_message(' || quote_literal(t.j('marc')) || ', ' || quote_literal(t.ref('bruno')) || ', ''Alors ?'')');
    PERFORM t.check('déblocage : l''envoi repasse', e IS NULL, e);
    PERFORM t.check('déblocage : la fiche redevient visible',
        t.erreur('SELECT fiche_joueur(' || quote_literal(t.j('marc')) || ', ' || quote_literal(t.ref('bruno')) || ')') IS NULL);
    e := t.erreur('SELECT bloquer_joueur(' || quote_literal(t.j('marc')) || ', ' || quote_literal(t.ref('marc')) || ', true)');
    PERFORM t.check('se bloquer soi-même refusé', e LIKE '22023%', e);
END $$;

-- ===================================================================== anti-abus
DO $$
DECLARE e text;
BEGIN
    PERFORM t.reset();
    FOR i IN 1..30 LOOP PERFORM envoyer_message(t.j('marc'), t.ref('bruno'), 'Message ' || i); END LOOP;
    e := t.erreur('SELECT envoyer_message(' || quote_literal(t.j('marc')) || ', ' || quote_literal(t.ref('bruno')) || ', ''Encore'')');
    PERFORM t.check('anti-abus : 31e message dans l''heure refusé (54000)', e LIKE '54000 : Trop de messages%', e);
    PERFORM t.check('anti-abus : les 30 premiers sont passés', t.nb_messages('marc', 'bruno') = 30);
    PERFORM t.vieillir_messages(61);
    e := t.erreur('SELECT envoyer_message(' || quote_literal(t.j('marc')) || ', ' || quote_literal(t.ref('bruno')) || ', ''Encore'')');
    PERFORM t.check('anti-abus : une heure plus tard, ça repasse', e IS NULL, e);
END $$;

DO $$
DECLARE e text;
BEGIN
    PERFORM t.reset();
    -- p1 a ouvert la conversation avec marc : elle ne compte pas dans son quota
    PERFORM envoyer_message(t.j('p1'), t.ref('marc'), 'Salut, une partie ?');
END $$;
DO $$
DECLARE e text;
BEGIN
    PERFORM t.vieillir_messages(1);
    FOR i IN 2..6 LOOP PERFORM envoyer_message(t.j('marc'), t.ref('p' || i), 'Bonjour'); END LOOP;
    e := t.erreur('SELECT envoyer_message(' || quote_literal(t.j('marc')) || ', ' || quote_literal(t.ref('alice')) || ', ''Bonjour'')');
    PERFORM t.check('anti-abus : 6e nouvelle conversation en 24 h refusée (54000)', e LIKE '54000 : Vous avez déjà contacté 5 nouveaux joueurs%', e);
    e := t.erreur('SELECT envoyer_message(' || quote_literal(t.j('marc')) || ', ' || quote_literal(t.ref('p2')) || ', ''Et sinon ?'')');
    PERFORM t.check('anti-abus : continuer une conversation reste possible', e IS NULL, e);
    e := t.erreur('SELECT envoyer_message(' || quote_literal(t.j('marc')) || ', ' || quote_literal(t.ref('p1')) || ', ''Oui !'')');
    PERFORM t.check('anti-abus : répondre à une conversation ouverte par l''autre reste possible', e IS NULL, e);
    e := t.erreur('SELECT envoyer_message(' || quote_literal(t.j('alice')) || ', ' || quote_literal(t.ref('marc')) || ', ''Salut'')');
    PERFORM t.check('anti-abus : le quota est par expéditeur (alice peut écrire à marc)', e IS NULL, e);
END $$;

-- ===================================================================== notification
DO $$
DECLARE s text; c text;
BEGIN
    PERFORM t.reset();
    PERFORM envoyer_message(t.j('marc'), t.ref('bruno'), 'Partie jeudi 19h ?' || E'\n' || 'Terrain 2');
    PERFORM envoyer_message(t.j('marc'), t.ref('bruno'), 'Je réserve');
    PERFORM envoyer_message(t.j('alice'), t.ref('bruno'), 'Moi aussi je suis là');
    PERFORM t.check('notification : un seul e-mail pour 3 messages en 30 min', t.nb_notif('bruno') = 1, t.nb_notif('bruno')::text);
    s := t.sujet_notif('bruno'); c := t.corps_notif('bruno');
    PERFORM t.check('notification : sujet « Nouveau message de Marc D. »', s = 'Nouveau message de Marc D.', s);
    PERFORM t.check('notification : texte, extrait sur une ligne, lien vers l''espace joueur',
        c LIKE 'Marc D. t''a écrit : « Partie jeudi 19h ? Terrain 2 » Réponds depuis ton espace joueur, rubrique Messages.%'
        AND c LIKE '%https://le-rebond.fr/espace-joueur/?j=' || t.j('bruno') || '%', c);
    PERFORM t.check('notification : pas d''e-mail ni de téléphone de l''expéditeur',
        position('marc.durand@' IN c) = 0 AND position('Durand' IN c) = 0);
    PERFORM t.check('notification : pas de notification pour l''expéditeur', t.nb_notif('marc') = 0);
END $$;
DO $$
DECLARE c text;
BEGIN
    PERFORM t.vieillir_notifs(31);
    PERFORM envoyer_message(t.j('marc'), t.ref('bruno'), repeat('b', 300));
    PERFORM t.check('notification : 31 min plus tard, un nouvel e-mail', t.nb_notif('bruno') = 2, t.nb_notif('bruno')::text);
    c := t.corps_notif('bruno');
    PERFORM t.check('notification : extrait limité à 200 caractères + « … »', position('« ' || repeat('b', 200) || '… »' IN c) > 0);
END $$;

-- ===================================================================== lecture
DO $$
DECLARE r jsonb; l jsonb;
BEGIN
    PERFORM t.reset();
    PERFORM envoyer_message(t.j('marc'), t.ref('bruno'), 'Un');
    PERFORM envoyer_message(t.j('marc'), t.ref('bruno'), 'Deux');
    PERFORM envoyer_message(t.j('alice'), t.ref('bruno'), 'Coucou');
END $$;
DO $$
DECLARE r jsonb; l jsonb;
BEGIN
    PERFORM t.check('non lus : 3 dans mon_profil', (mon_profil(t.j('bruno'))->>'non_lus')::int = 3);
    l := mes_conversations(t.j('bruno'));
    PERFORM t.check('mes_conversations : une entrée par interlocuteur', jsonb_array_length(l) = 2, l::text);
    PERFORM t.check('mes_conversations : non lus par interlocuteur, dernier message, de_moi',
        (SELECT (x->>'non_lus')::int = 2 AND x->'dernier'->>'extrait' IN ('Un', 'Deux') AND NOT (x->'dernier'->>'de_moi')::boolean
                AND x->>'prenom' = 'Marc' AND x->>'initiale' = 'D.'
         FROM jsonb_array_elements(l) x WHERE x->>'ref' = t.ref('marc')::text));
    r := conversation(t.j('bruno'), t.ref('marc'));
    PERFORM t.check('conversation : les 2 messages, reçus (de_moi = false)', jsonb_array_length(r->'messages') = 2
        AND NOT (r->'messages'->0->>'de_moi')::boolean, r::text);
    PERFORM t.check('conversation : interlocuteur prénom + initiale', r->'avec'->>'prenom' = 'Marc' AND r->'avec'->>'initiale' = 'D.');
END $$;
DO $$
DECLARE r jsonb;
BEGIN
    PERFORM t.check('conversation : les reçus sont marqués lus (reste 1 non lu, celui d''alice)',
        (mon_profil(t.j('bruno'))->>'non_lus')::int = 1);
    r := conversation(t.j('marc'), t.ref('bruno'));
    PERFORM t.check('conversation côté expéditeur : de_moi = true, lu_le renseigné',
        (r->'messages'->0->>'de_moi')::boolean AND r->'messages'->0->>'lu_le' IS NOT NULL);
    PERFORM t.check('conversation côté expéditeur : ne marque pas lus les messages de l''autre',
        (mon_profil(t.j('bruno'))->>'non_lus')::int = 1);
    PERFORM t.check('conversation vide avec un joueur sans échange : liste vide',
        jsonb_array_length(conversation(t.j('marc'), t.ref('p3'))->'messages') = 0);
END $$;

-- ===================================================================== signalement
DO $$
DECLARE e text; a text;
BEGIN
    PERFORM t.reset();
    e := t.erreur('SELECT signaler_joueur(' || quote_literal(t.j('marc')) || ', ' || quote_literal(t.ref('bruno')) || ', ''  '')');
    PERFORM t.check('signalement sans motif refusé', e LIKE '22023 : Indiquez le motif%', e);
    PERFORM signaler_joueur(t.j('marc'), t.ref('bruno'), 'Messages insistants');
    a := t.alertes();
    PERFORM t.check('signalement : le club est alerté avec les noms et le motif',
        a LIKE 'contact@le-rebond.fr | [Tournois] Signalement annuaire | Marc Durand signale Bruno Petit%Motif : « Messages insistants »%', a);
    PERFORM signaler_joueur(t.j('marc'), t.ref('alice'), 'Spam');
    PERFORM signaler_joueur(t.j('marc'), t.ref('p1'), 'Spam');
    e := t.erreur('SELECT signaler_joueur(' || quote_literal(t.j('marc')) || ', ' || quote_literal(t.ref('p2')) || ', ''Spam'')');
    PERFORM t.check('anti-abus : 4e signalement du jour refusé (54000)', e LIKE '54000%', e);
    PERFORM t.check('anti-abus : 3 alertes seulement', t.nb_alertes() = 3);
    e := t.erreur('SELECT signaler_joueur(' || quote_literal(t.j('alice')) || ', ' || quote_literal(t.ref('chloe')) || ', ''Spam'')');
    PERFORM t.check('signaler un joueur fermé sans échange : refusé (22023)', e LIKE '22023 : Vous ne pouvez signaler qu''un joueur de l''annuaire%', e);
    PERFORM t.remplir_signalements(17);   -- 20 signalements dans l'heure sur le site
    PERFORM signaler_joueur(t.j('alice'), t.ref('bruno'), 'Insultes');
    PERFORM t.check('plafond global : au-delà de 20 par heure, enregistré sans e-mail au club',
        t.nb_signalements() = 21 AND t.nb_alertes() = 3, t.nb_signalements() || ' / ' || t.nb_alertes());
END $$;

-- ===================================================================== aucune coordonnée en sortie
DO $$
DECLARE sortie text; c text; fuite text := '';
BEGIN
    PERFORM t.reset();
    PERFORM envoyer_message(t.j('marc'), t.ref('bruno'), 'Salut');
    PERFORM envoyer_message(t.j('bruno'), t.ref('marc'), 'Re');
    sortie := concat_ws(' ',
        mon_profil(t.j('marc'))::text,
        enregistrer_profil(t.j('marc'), '{"ouvert":true,"cote":"droite"}')::text,
        (SELECT jsonb_agg(to_jsonb(x))::text FROM annuaire_joueurs(t.j('marc')) x),
        (SELECT jsonb_agg(to_jsonb(x))::text FROM annuaire_joueurs(t.j('bruno')) x),
        fiche_joueur(t.j('marc'), t.ref('alice'))::text,
        fiche_joueur(t.j('marc'), t.ref('bruno'))::text,
        fiche_joueur(t.j('bruno'), t.ref('marc'))::text,
        envoyer_message(t.j('marc'), t.ref('bruno'), 'Ok')::text,
        mes_conversations(t.j('marc'))::text,
        mes_conversations(t.j('bruno'))::text,
        conversation(t.j('marc'), t.ref('bruno'))::text);
    FOREACH c IN ARRAY t.coordonnees() LOOP
        IF position(c IN sortie) > 0 THEN fuite := fuite || c || ' '; END IF;
    END LOOP;
    PERFORM t.check('aucune sortie publique ne contient d''e-mail, de téléphone ni de jeton',
        fuite = '' AND position('@' IN sortie) = 0, nullif(fuite, ''));
    PERFORM t.check('aucune sortie ne contient les clés email / telephone',
        position('"email"' IN sortie) = 0 AND position('"telephone"' IN sortie) = 0);
    fuite := '';
    FOREACH c IN ARRAY t.tous_ids() LOOP
        IF position(c IN sortie) > 0 THEN fuite := fuite || c || ' '; END IF;
    END LOOP;
    PERFORM t.check('aucune sortie publique ne contient un identifiant joueurs.id (seulement des références)',
        fuite = '' AND position('"joueur_id"' IN sortie) = 0, nullif(fuite, ''));
END $$;

-- ===================================================================== e-mail : liens neutralisés
DO $$
DECLARE c text; s text;
BEGIN
    PERFORM t.reset();
    PERFORM envoyer_message(t.j('marc'), t.ref('alice'),
        'Va voir https://le-rebond.fr/espace-joueur/?j=11111111-2222-3333-4444-555555555555 ou www.exemple.fr, ou le-rebond.fr/joueurs/');
    c := t.corps_notif('alice');
    PERFORM t.check('extrait : les liens deviennent [lien] (pas de faux bouton « Ouvrir mon espace joueur »)',
        position('11111111-2222' IN c) = 0 AND position('www.exemple' IN c) = 0 AND position('le-rebond.fr/joueurs' IN c) = 0
        AND c LIKE 'Marc D. t''a écrit : « Va voir [lien] ou [lien] ou [lien] »%'
        AND c LIKE '%https://le-rebond.fr/espace-joueur/?j=' || t.j('alice') || '%', c);
    PERFORM t.joueur('pirate', 'https://le-rebond.fr/espace-joueur/?j=abc', 'Zorro', 'H');
    PERFORM envoyer_message(t.j('pirate'), t.ref('bruno'), 'Salut');
    s := t.sujet_notif('bruno');
    PERFORM t.check('prénom piégé : borné et sans lien dans le sujet et le texte',
        s = 'Nouveau message de [lien] Z.' AND t.corps_notif('bruno') LIKE '[lien] Z. t''a écrit%', s);
END $$;

-- ===================================================================== correctif : liens personnels
RESET ROLE;
INSERT INTO tournois (nom, date, status, publie) VALUES ('P25 ouvert', current_date + 7, 'planifie', true);
SET ROLE anon;
DO $$
DECLARE r jsonb; v_t uuid := (SELECT id FROM tournois WHERE nom = 'P25 ouvert');
BEGIN
    PERFORM t.reset();
    -- Un inconnu se fait passer pour Marc Durand (nom et prénom publics) avec son propre e-mail.
    r := chercher_partenaire(v_t, '{"nom":"Durand","prenom":"Marc","email":"pirate@evil.fr","telephone":"0700000000"}');
    PERFORM t.check('chercher_partenaire pour un joueur déjà connu : pas de lien renvoyé au navigateur',
        r ? 'recherche' AND r->'lien' = 'null'::jsonb, r::text);
    PERFORM t.check('… e-mail du joueur inchangé, la confirmation part à sa vraie adresse',
        t.email('marc') = 'marc.durand@exemple.fr' AND t.notif_partenaire('marc') = 'marc.durand@exemple.fr',
        t.email('marc') || ' / ' || coalesce(t.notif_partenaire('marc'), '-'));
    r := chercher_partenaire(v_t, '{"nom":"Neuf","prenom":"Jean","email":"jean.neuf@exemple.fr","telephone":"0612345678"}');
    PERFORM t.check('chercher_partenaire pour un joueur nouveau : son lien est renvoyé',
        r->>'lien' = 'https://le-rebond.fr/espace-joueur/?j=' || t.jeton_de('Neuf', 'Jean'), r::text);

    r := inscrire_paire(v_t, '{"nom":"Martin","prenom":"Alice","email":"pirate@evil.fr","telephone":"0700000000"}',
                             '{"nom":"Frais","prenom":"Paul","telephone":"0611111111"}');
    PERFORM t.check('inscrire_paire avec un joueur 1 déjà connu : pas de lien, e-mail inchangé',
        r ? 'inscription' AND r->'lien' = 'null'::jsonb AND t.email('alice') = 'alice.martin@exemple.fr', r::text || ' ' || t.email('alice'));
    r := inscrire_paire(v_t, '{"nom":"Nouvelle","prenom":"Lea","email":"lea@exemple.fr","telephone":"0622222222"}',
                             '{"nom":"Petit","prenom":"Bruno","email":"pirate@evil.fr"}');
    PERFORM t.check('inscrire_paire avec un joueur 1 nouveau : son lien est renvoyé ; e-mail du partenaire connu inchangé',
        r->>'lien' = 'https://le-rebond.fr/espace-joueur/?j=' || t.jeton_de('Nouvelle', 'Lea') AND t.email('bruno') = 'bruno.petit@exemple.fr',
        r::text || ' ' || t.email('bruno'));
END $$;

RESET ROLE;
DO $$
DECLARE ancien uuid := t.j('p6'); lien text; e text;
BEGIN
    PERFORM set_config('test.uid', (SELECT user_id::text FROM staff WHERE email = 'staff@exemple.fr'), true);
    SET LOCAL ROLE authenticated;
    lien := staff_regenerer_lien(t.id('p6'));
    RESET ROLE;
    PERFORM t.check('staff_regenerer_lien : nouveau lien', lien LIKE 'https://le-rebond.fr/espace-joueur/?j=%'
        AND lien <> 'https://le-rebond.fr/espace-joueur/?j=' || ancien, lien);
    SET LOCAL ROLE anon;
    e := t.erreur('SELECT mon_profil(' || quote_literal(ancien) || ')');
    PERFORM t.check('… l''ancien lien ne marche plus', e LIKE '42501 : Lien inconnu ou expiré%', e);
    PERFORM t.check('… le nouveau marche', (mon_profil(split_part(lien, '?j=', 2)::uuid)->>'prenom') = 'Pierre6');
    RESET ROLE;
END $$;

RESET ROLE;
\pset footer off
SELECT CASE WHEN ok THEN 'ok  ' ELSE 'FAIL' END AS " ", nom AS "scénario", coalesce(detail, '') AS "détail"
FROM t.resultats ORDER BY n;
SELECT count(*) FILTER (WHERE ok) || ' ok, ' || count(*) FILTER (WHERE NOT ok) || ' échec(s)' AS bilan FROM t.resultats;
