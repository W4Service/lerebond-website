-- Profil joueur, annuaire de partenaires et messagerie, sans mot de passe.
--
-- L'identité est le lien personnel de l'espace joueur (joueurs_contacts.jeton) : chaque
-- fonction publique prend ce jeton en premier paramètre et le résout en joueur, sinon
-- « Lien inconnu ou expiré ».
--   - Profil : côté, niveau déclaré (non classés), disponibilités, présentation, et la
--     case « ouvert aux propositions », décochée par défaut (RGPD : opt-in).
--   - Annuaire : seulement les profils ouverts, visible seulement par un joueur qui a
--     un lien valide, jamais par le public. Prénom + initiale du nom, jamais d'e-mail
--     ni de téléphone.
--   - Messagerie : on écrit à un joueur ouvert ; il peut toujours répondre, même après
--     avoir fermé son profil. Blocage, signalement au club, anti-abus, et au plus un
--     e-mail « nouveau message » par destinataire toutes les 30 minutes.
--   - Identifiants : les fonctions ne renvoient ni n'acceptent jamais joueurs.id (la table
--     joueurs est lisible par tous, avec nom complet et licence) mais une référence opaque
--     (joueurs_refs.ref), créée automatiquement avec le profil ou le premier message.
-- Les tables sont privées (staff) : `joueurs` est lisible par tous, rien de privé n'y va.
-- Prérequis : 20261121_correctif_liens_inscription.sql (vérifié ci-dessous).
-- Rejouable sans effet de bord.

DO $$
BEGIN
    IF to_regprocedure('lien_si_nouveau(uuid)') IS NULL THEN
        RAISE EXCEPTION 'Appliquez d''abord 20261121_correctif_liens_inscription.sql' USING ERRCODE = '22023';
    END IF;
END $$;

-- ===================================================================== données

CREATE TABLE IF NOT EXISTS joueurs_profils (
    joueur_id      uuid PRIMARY KEY REFERENCES joueurs(id) ON DELETE CASCADE,
    cote           text CHECK (cote IN ('droite', 'gauche', 'les_deux')),
    niveau_declare smallint CHECK (niveau_declare BETWEEN 1 AND 8),   -- 1 Débutant … 8 Expert (non classés)
    dispos         text[] NOT NULL DEFAULT '{}'
                   CHECK (dispos <@ ARRAY['semaine_midi', 'semaine_soir', 'weekend_matin', 'weekend_apres_midi']::text[]),
    presentation   text CHECK (char_length(presentation) <= 300),
    ouvert         boolean NOT NULL DEFAULT false,                    -- visible dans l'annuaire
    cree_le        timestamptz NOT NULL DEFAULT now(),
    maj_le         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_joueurs_profils_ouverts ON joueurs_profils (maj_le DESC) WHERE ouvert;

CREATE TABLE IF NOT EXISTS messages (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    de_joueur  uuid NOT NULL REFERENCES joueurs(id) ON DELETE CASCADE,
    a_joueur   uuid NOT NULL REFERENCES joueurs(id) ON DELETE CASCADE,
    texte      text NOT NULL CHECK (char_length(texte) BETWEEN 1 AND 1000 AND texte !~ '^\s|\s$'),
    cree_le    timestamptz NOT NULL DEFAULT now(),
    lu_le      timestamptz,
    CONSTRAINT messages_pas_a_soi CHECK (de_joueur <> a_joueur)
);
CREATE INDEX IF NOT EXISTS idx_messages_recus ON messages (a_joueur, lu_le);
CREATE INDEX IF NOT EXISTS idx_messages_conversation
    ON messages (least(de_joueur, a_joueur), greatest(de_joueur, a_joueur), cree_le);
CREATE INDEX IF NOT EXISTS idx_messages_envoyes ON messages (de_joueur, cree_le);

CREATE TABLE IF NOT EXISTS joueurs_blocages (
    joueur_id  uuid NOT NULL REFERENCES joueurs(id) ON DELETE CASCADE,   -- celui qui bloque
    bloque_id  uuid NOT NULL REFERENCES joueurs(id) ON DELETE CASCADE,
    cree_le    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (joueur_id, bloque_id),
    CONSTRAINT joueurs_blocages_pas_soi CHECK (joueur_id <> bloque_id)
);

-- Trace des signalements (anti-abus : 3 par jour et par joueur ; le club est alerté par e-mail).
CREATE TABLE IF NOT EXISTS joueurs_signalements (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    joueur_id  uuid NOT NULL REFERENCES joueurs(id) ON DELETE CASCADE,   -- celui qui signale
    signale_id uuid NOT NULL REFERENCES joueurs(id) ON DELETE CASCADE,
    motif      text NOT NULL,
    cree_le    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_joueurs_signalements_auteur ON joueurs_signalements (joueur_id, cree_le);
CREATE INDEX IF NOT EXISTS idx_joueurs_signalements_date ON joueurs_signalements (cree_le);

-- Référence opaque d'un joueur, seule visible des autres joueurs (jamais joueurs.id).
CREATE TABLE IF NOT EXISTS joueurs_refs (
    joueur_id  uuid PRIMARY KEY REFERENCES joueurs(id) ON DELETE CASCADE,
    ref        uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE
);

ALTER TABLE joueurs_profils      ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages             ENABLE ROW LEVEL SECURITY;
ALTER TABLE joueurs_blocages     ENABLE ROW LEVEL SECURITY;
ALTER TABLE joueurs_signalements ENABLE ROW LEVEL SECURITY;
ALTER TABLE joueurs_refs         ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['joueurs_profils', 'messages', 'joueurs_blocages', 'joueurs_signalements', 'joueurs_refs'] LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_staff', t);
        EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO authenticated USING (est_staff()) WITH CHECK (est_staff())', t || '_staff', t);
        -- Le site public ne passe que par les fonctions ci-dessous.
        EXECUTE format('REVOKE ALL ON TABLE %I FROM anon', t);
    END LOOP;
END $$;

-- Une référence pour tout joueur qui a un profil ou un message (créée à la volée).
CREATE OR REPLACE FUNCTION trg_joueurs_refs()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF TG_TABLE_NAME = 'messages' THEN
        INSERT INTO joueurs_refs (joueur_id) VALUES (NEW.de_joueur), (NEW.a_joueur) ON CONFLICT DO NOTHING;
    ELSE
        INSERT INTO joueurs_refs (joueur_id) VALUES (NEW.joueur_id) ON CONFLICT DO NOTHING;
    END IF;
    RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_joueurs_profils_ref ON joueurs_profils;
CREATE TRIGGER trg_joueurs_profils_ref AFTER INSERT ON joueurs_profils FOR EACH ROW EXECUTE FUNCTION trg_joueurs_refs();
DROP TRIGGER IF EXISTS trg_messages_ref ON messages;
CREATE TRIGGER trg_messages_ref AFTER INSERT ON messages FOR EACH ROW EXECUTE FUNCTION trg_joueurs_refs();
INSERT INTO joueurs_refs (joueur_id)
SELECT joueur_id FROM joueurs_profils UNION SELECT de_joueur FROM messages UNION SELECT a_joueur FROM messages
ON CONFLICT DO NOTHING;

-- ===================================================================== outils (internes)

-- Lien personnel → joueur. Refuse un lien inconnu.
CREATE OR REPLACE FUNCTION joueur_du_jeton(p_jeton uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v uuid;
BEGIN
    SELECT joueur_id INTO v FROM joueurs_contacts WHERE jeton = p_jeton;
    IF v IS NULL THEN RAISE EXCEPTION 'Lien inconnu ou expiré' USING ERRCODE = '42501'; END IF;
    RETURN v;
END;
$$;

-- Référence opaque → joueur. Refuse une référence inconnue (dont un joueurs.id).
CREATE OR REPLACE FUNCTION joueur_de_ref(p_ref uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v uuid;
BEGIN
    SELECT joueur_id INTO v FROM joueurs_refs WHERE ref = p_ref;
    IF v IS NULL THEN RAISE EXCEPTION 'Joueur introuvable' USING ERRCODE = '22023'; END IF;
    RETURN v;
END;
$$;

-- « Prénom I. » : ce que les autres joueurs voient d'un nom (prénom borné à 30 caractères).
CREATE OR REPLACE FUNCTION prenom_initiale(p_joueur uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT left(trim(prenom), 30) || ' ' || upper(left(trim(nom), 1)) || '.' FROM joueurs WHERE id = p_joueur
$$;

-- Texte saisi par un joueur et repris dans un e-mail du club : les liens sont neutralisés
-- (la mise en page n8n change toute adresse le-rebond.fr en bouton « Ouvrir mon espace joueur »).
CREATE OR REPLACE FUNCTION sans_liens(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
    SELECT regexp_replace(p, '(https?://|www\.)\S*|\S*le-rebond\.fr\S*', '[lien]', 'gi')
$$;

CREATE OR REPLACE FUNCTION conversation_existe(p_a uuid, p_b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (SELECT 1 FROM messages
                   WHERE least(de_joueur, a_joueur) = least(p_a, p_b)
                     AND greatest(de_joueur, a_joueur) = greatest(p_a, p_b))
$$;

CREATE OR REPLACE FUNCTION blocage_entre(p_a uuid, p_b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (SELECT 1 FROM joueurs_blocages
                   WHERE (joueur_id = p_a AND bloque_id = p_b) OR (joueur_id = p_b AND bloque_id = p_a))
$$;

-- Carte d'un joueur telle que l'annuaire la montre : jamais de coordonnées.
CREATE OR REPLACE FUNCTION carte_joueur(p_joueur uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT jsonb_build_object(
        'ref', r.ref, 'prenom', j.prenom, 'initiale', upper(left(j.nom, 1)) || '.', 'genre', j.genre,
        'fft_rang', j.fft_rang, 'niveau_declare', p.niveau_declare, 'cote', p.cote,
        'dispos', coalesce(to_jsonb(p.dispos), '[]'::jsonb), 'presentation', p.presentation,
        'ouvert', coalesce(p.ouvert, false),
        'nb_tournois', s.nb, 'meilleure_place', s.meilleure, 'maj_le', p.maj_le)
    FROM joueurs j
    JOIN joueurs_refs r ON r.joueur_id = j.id
    LEFT JOIN joueurs_profils p ON p.joueur_id = j.id
    CROSS JOIN LATERAL (
        SELECT count(*)::int AS nb, min(e.place_finale)::int AS meilleure
        FROM equipes e JOIN tournois t ON t.id = e.tournoi_id
        WHERE j.id IN (e.joueur_j1_id, e.joueur_j2_id) AND t.status IN ('actif', 'cloture')) s
    WHERE j.id = p_joueur
$$;

-- ===================================================================== profil

CREATE OR REPLACE FUNCTION mon_profil(p_jeton uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_moi uuid := joueur_du_jeton(p_jeton); p record; j record;
BEGIN
    SELECT prenom, fft_rang INTO j FROM joueurs WHERE id = v_moi;
    SELECT * INTO p FROM joueurs_profils WHERE joueur_id = v_moi;
    RETURN jsonb_build_object(
        'prenom', j.prenom,
        'fft_rang', j.fft_rang,
        'profil', CASE WHEN p.joueur_id IS NULL THEN NULL ELSE jsonb_build_object(
            'cote', p.cote, 'niveau_declare', p.niveau_declare, 'dispos', to_jsonb(p.dispos),
            'presentation', p.presentation, 'ouvert', p.ouvert, 'maj_le', p.maj_le) END,
        'non_lus', (SELECT count(*)::int FROM messages WHERE a_joueur = v_moi AND lu_le IS NULL));
END;
$$;

CREATE OR REPLACE FUNCTION enregistrer_profil(p_jeton uuid, p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_moi uuid := joueur_du_jeton(p_jeton);
    v_cote text; v_niveau smallint; v_dispos text[] := '{}'; v_pres text; v_ouvert boolean;
    v_permis text[] := ARRAY['semaine_midi', 'semaine_soir', 'weekend_matin', 'weekend_apres_midi'];
    d text;
BEGIN
    IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
        RAISE EXCEPTION 'Profil invalide' USING ERRCODE = '22023';
    END IF;
    v_cote := nullif(trim(p->>'cote'), '');
    IF v_cote IS NOT NULL AND v_cote NOT IN ('droite', 'gauche', 'les_deux') THEN
        RAISE EXCEPTION 'Côté invalide : droite, gauche ou les deux' USING ERRCODE = '22023';
    END IF;
    IF nullif(trim(p->>'niveau_declare'), '') IS NOT NULL THEN
        IF trim(p->>'niveau_declare') !~ '^[1-8]$' THEN
            RAISE EXCEPTION 'Niveau déclaré invalide : de 1 (débutant) à 8 (expert)' USING ERRCODE = '22023';
        END IF;
        v_niveau := trim(p->>'niveau_declare')::smallint;
    END IF;
    IF p ? 'dispos' AND jsonb_typeof(p->'dispos') <> 'null' THEN
        IF jsonb_typeof(p->'dispos') <> 'array' THEN
            RAISE EXCEPTION 'Disponibilités invalides' USING ERRCODE = '22023';
        END IF;
        FOR d IN SELECT jsonb_array_elements_text(p->'dispos') LOOP
            IF NOT d = ANY (v_permis) THEN
                RAISE EXCEPTION 'Disponibilité inconnue : %', left(d, 40) USING ERRCODE = '22023';
            END IF;
        END LOOP;
        -- sans doublon, dans l'ordre de la semaine
        SELECT coalesce(array_agg(x ORDER BY array_position(v_permis, x)), '{}') INTO v_dispos
        FROM (SELECT DISTINCT jsonb_array_elements_text(p->'dispos') AS x) s;
    END IF;
    v_pres := nullif(left(trim(p->>'presentation'), 300), '');
    IF p ? 'ouvert' AND jsonb_typeof(p->'ouvert') NOT IN ('boolean', 'null') THEN
        RAISE EXCEPTION 'Choix « annuaire » invalide' USING ERRCODE = '22023';
    END IF;
    v_ouvert := coalesce((p->>'ouvert')::boolean, false);

    INSERT INTO joueurs_profils (joueur_id, cote, niveau_declare, dispos, presentation, ouvert)
    VALUES (v_moi, v_cote, v_niveau, v_dispos, v_pres, v_ouvert)
    ON CONFLICT (joueur_id) DO UPDATE SET
        cote = EXCLUDED.cote, niveau_declare = EXCLUDED.niveau_declare, dispos = EXCLUDED.dispos,
        presentation = EXCLUDED.presentation, ouvert = EXCLUDED.ouvert, maj_le = now();
    RETURN mon_profil(p_jeton);
END;
$$;

-- Supprime le profil : le joueur disparaît de l'annuaire (ses conversations restent).
CREATE OR REPLACE FUNCTION supprimer_profil(p_jeton uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    DELETE FROM joueurs_profils WHERE joueur_id = joueur_du_jeton(p_jeton);
END;
$$;

-- ===================================================================== annuaire

-- Profils ouverts, hors soi-même et hors blocages (dans un sens ou l'autre).
-- Filtres optionnels : genre (H|F), cote (droite|gauche|les_deux ; un joueur « les deux »
-- répond aux deux côtés), dispo (une valeur), rang_max, niveau_min, texte (prénom, présentation).
CREATE OR REPLACE FUNCTION annuaire_joueurs(p_jeton uuid, p_filtres jsonb DEFAULT '{}')
RETURNS TABLE (ref uuid, prenom text, initiale text, genre char(1), fft_rang integer,
               niveau_declare smallint, cote text, dispos text[], presentation text,
               nb_tournois integer, meilleure_place integer, maj_le timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
    v_moi uuid := joueur_du_jeton(p_jeton);
    f jsonb := coalesce(p_filtres, '{}'::jsonb);
    v_genre text; v_cote text; v_dispo text; v_rang int; v_niveau int; v_texte text;
BEGIN
    IF jsonb_typeof(f) <> 'object' THEN RAISE EXCEPTION 'Filtres invalides' USING ERRCODE = '22023'; END IF;
    v_genre := nullif(trim(f->>'genre'), '');
    v_cote  := nullif(trim(f->>'cote'), '');
    v_dispo := nullif(trim(f->>'dispo'), '');
    IF v_genre IS NOT NULL AND v_genre NOT IN ('H', 'F') THEN
        RAISE EXCEPTION 'Filtre genre invalide' USING ERRCODE = '22023';
    END IF;
    IF v_cote IS NOT NULL AND v_cote NOT IN ('droite', 'gauche', 'les_deux') THEN
        RAISE EXCEPTION 'Filtre côté invalide' USING ERRCODE = '22023';
    END IF;
    IF v_dispo IS NOT NULL AND v_dispo NOT IN ('semaine_midi', 'semaine_soir', 'weekend_matin', 'weekend_apres_midi') THEN
        RAISE EXCEPTION 'Filtre disponibilité invalide' USING ERRCODE = '22023';
    END IF;
    IF nullif(trim(f->>'rang_max'), '') IS NOT NULL THEN
        IF trim(f->>'rang_max') !~ '^[0-9]{1,7}$' THEN
            RAISE EXCEPTION 'Filtre classement invalide' USING ERRCODE = '22023';
        END IF;
        v_rang := trim(f->>'rang_max')::int;
    END IF;
    IF nullif(trim(f->>'niveau_min'), '') IS NOT NULL THEN
        IF trim(f->>'niveau_min') !~ '^[1-8]$' THEN
            RAISE EXCEPTION 'Filtre niveau invalide' USING ERRCODE = '22023';
        END IF;
        v_niveau := trim(f->>'niveau_min')::int;
    END IF;
    v_texte := nullif(normaliser_identite(left(f->>'texte', 50)), '');

    RETURN QUERY
    SELECT r.ref, j.prenom, upper(left(j.nom, 1)) || '.', j.genre, j.fft_rang,
           p.niveau_declare, p.cote, p.dispos, p.presentation, s.nb, s.meilleure, p.maj_le
    FROM joueurs_profils p
    JOIN joueurs j ON j.id = p.joueur_id
    JOIN joueurs_refs r ON r.joueur_id = p.joueur_id
    CROSS JOIN LATERAL (
        SELECT count(*)::int AS nb, min(e.place_finale)::int AS meilleure
        FROM equipes e JOIN tournois t ON t.id = e.tournoi_id
        WHERE j.id IN (e.joueur_j1_id, e.joueur_j2_id) AND t.status IN ('actif', 'cloture')) s
    WHERE p.ouvert
      AND p.joueur_id <> v_moi
      AND NOT blocage_entre(v_moi, p.joueur_id)
      AND (v_genre IS NULL OR j.genre = v_genre)
      AND (v_cote IS NULL OR p.cote = v_cote OR p.cote = 'les_deux' OR (v_cote = 'les_deux' AND p.cote IS NOT NULL))
      AND (v_dispo IS NULL OR v_dispo = ANY (p.dispos))
      AND (v_rang IS NULL OR j.fft_rang <= v_rang)
      AND (v_niveau IS NULL OR p.niveau_declare >= v_niveau)
      AND (v_texte IS NULL OR strpos(normaliser_identite(j.prenom || ' ' || coalesce(p.presentation, '')), v_texte) > 0)
    ORDER BY p.maj_le DESC
    LIMIT 200;
END;
$$;

-- Fiche détaillée (p_joueur = référence opaque) : profil ouvert, ou interlocuteur d'une
-- conversation existante ; jamais en cas de blocage, dans un sens ou l'autre.
CREATE OR REPLACE FUNCTION fiche_joueur(p_jeton uuid, p_joueur uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_moi uuid := joueur_du_jeton(p_jeton); v_j uuid := joueur_de_ref(p_joueur); v_crm bigint;
BEGIN
    IF NOT (v_j = v_moi
            OR (NOT blocage_entre(v_moi, v_j)
                AND (conversation_existe(v_moi, v_j)
                     OR EXISTS (SELECT 1 FROM joueurs_profils WHERE joueur_id = v_j AND ouvert)))) THEN
        RAISE EXCEPTION 'Ce profil n''est pas visible' USING ERRCODE = '42501';
    END IF;
    SELECT fft_id_crm INTO v_crm FROM joueurs WHERE id = v_j;
    RETURN carte_joueur(v_j) || jsonb_build_object(
        'bloque', EXISTS (SELECT 1 FROM joueurs_blocages WHERE joueur_id = v_moi AND bloque_id = v_j),
        'conversation', conversation_existe(v_moi, v_j),
        'tournois', coalesce((
            SELECT jsonb_agg(x ORDER BY (x->>'date') DESC) FROM (
                SELECT jsonb_build_object('date', t.date, 'tournoi', t.nom, 'place', e.place_finale) AS x
                FROM equipes e JOIN tournois t ON t.id = e.tournoi_id
                WHERE v_j IN (e.joueur_j1_id, e.joueur_j2_id) AND t.status IN ('actif', 'cloture')
                ORDER BY t.date DESC LIMIT 30) s), '[]'::jsonb),
        'historique_classement', coalesce((
            SELECT jsonb_agg(jsonb_build_object('mois', h.mois, 'rang', h.rang, 'points', h.points) ORDER BY h.mois)
            FROM fft_classement h WHERE v_crm IS NOT NULL AND h.id_crm = v_crm), '[]'::jsonb));
END;
$$;

-- ===================================================================== messagerie

CREATE OR REPLACE FUNCTION envoyer_message(p_jeton uuid, p_dest uuid, p_texte text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_moi uuid := joueur_du_jeton(p_jeton);
    v_dest uuid := joueur_de_ref(p_dest);
    v_texte text;
    v_conv boolean; v_nom text; v_extrait text; m record;
BEGIN
    -- Un envoi à la fois par expéditeur : les plafonds tiennent même sous une salve d'appels.
    PERFORM pg_advisory_xact_lock(hashtext('msg:' || v_moi));
    -- Blancs (espaces, retours à la ligne, tabulations) retirés en tête et en fin.
    v_texte := regexp_replace(left(coalesce(p_texte, ''), 2000), '^\s+|\s+$', '', 'g');
    v_texte := regexp_replace(left(v_texte, 1000), '\s+$', '');
    IF v_dest = v_moi THEN
        RAISE EXCEPTION 'Vous ne pouvez pas vous écrire à vous-même' USING ERRCODE = '22023';
    END IF;
    IF v_texte = '' THEN
        RAISE EXCEPTION 'Le message est vide' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM joueurs_blocages WHERE joueur_id = v_moi AND bloque_id = v_dest) THEN
        RAISE EXCEPTION 'Vous avez bloqué ce joueur : débloquez-le pour lui écrire' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM joueurs_blocages WHERE joueur_id = v_dest AND bloque_id = v_moi) THEN
        RAISE EXCEPTION 'Ce joueur ne reçoit pas vos messages' USING ERRCODE = '22023';
    END IF;
    -- On écrit à un joueur ouvert ; à un joueur fermé, seulement pour lui répondre (il m'a écrit).
    IF NOT EXISTS (SELECT 1 FROM messages WHERE de_joueur = v_dest AND a_joueur = v_moi)
       AND NOT EXISTS (SELECT 1 FROM joueurs_profils WHERE joueur_id = v_dest AND ouvert) THEN
        RAISE EXCEPTION 'Ce joueur n''est pas ouvert aux propositions' USING ERRCODE = '22023';
    END IF;
    v_conv := conversation_existe(v_moi, v_dest);

    -- anti-abus : 30 messages par heure, 5 nouvelles conversations par 24 h
    IF (SELECT count(*) FROM messages WHERE de_joueur = v_moi AND cree_le > now() - interval '1 hour') >= 30 THEN
        RAISE EXCEPTION 'Trop de messages en peu de temps : réessayez dans une heure' USING ERRCODE = '54000';
    END IF;
    IF NOT v_conv AND (
        SELECT count(*) FROM (
            SELECT DISTINCT ON (least(de_joueur, a_joueur), greatest(de_joueur, a_joueur)) de_joueur AS auteur, cree_le
            FROM messages WHERE v_moi IN (de_joueur, a_joueur)
            ORDER BY least(de_joueur, a_joueur), greatest(de_joueur, a_joueur), cree_le) premiers
        WHERE auteur = v_moi AND cree_le > now() - interval '24 hours') >= 5 THEN
        RAISE EXCEPTION 'Vous avez déjà contacté 5 nouveaux joueurs aujourd''hui : réessayez demain' USING ERRCODE = '54000';
    END IF;

    INSERT INTO messages (de_joueur, a_joueur, texte) VALUES (v_moi, v_dest, v_texte) RETURNING id, cree_le INTO m;

    -- au plus un e-mail « nouveau message » par destinataire toutes les 30 minutes
    PERFORM pg_advisory_xact_lock(hashtext('notif-msg:' || v_dest));
    IF NOT EXISTS (SELECT 1 FROM notifications WHERE type = 'message' AND joueur_id = v_dest
                   AND cree_le > now() - interval '30 minutes') THEN
        v_nom := sans_liens(prenom_initiale(v_moi));
        v_extrait := sans_liens(regexp_replace(v_texte, '\s+', ' ', 'g'));
        v_extrait := CASE WHEN char_length(v_extrait) > 200 THEN left(v_extrait, 200) || '…' ELSE v_extrait END;
        PERFORM notifier(v_dest, 'message', 'Nouveau message de ' || v_nom,
            v_nom || ' t''a écrit : « ' || v_extrait || ' » Réponds depuis ton espace joueur, rubrique Messages.');
    END IF;
    RETURN jsonb_build_object('id', m.id, 'cree_le', m.cree_le);
END;
$$;

-- Une entrée par interlocuteur, la plus récente d'abord.
CREATE OR REPLACE FUNCTION mes_conversations(p_jeton uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_moi uuid := joueur_du_jeton(p_jeton);
BEGIN
    RETURN coalesce((
        SELECT jsonb_agg(jsonb_build_object(
                   'ref', r.ref, 'prenom', j.prenom, 'initiale', upper(left(j.nom, 1)) || '.',
                   'dernier', jsonb_build_object('extrait', left(d.texte, 120), 'date', d.cree_le, 'de_moi', d.de_joueur = v_moi),
                   'non_lus', (SELECT count(*)::int FROM messages n WHERE n.a_joueur = v_moi AND n.de_joueur = j.id AND n.lu_le IS NULL),
                   'bloque', EXISTS (SELECT 1 FROM joueurs_blocages b WHERE b.joueur_id = v_moi AND b.bloque_id = j.id))
               ORDER BY d.cree_le DESC)
        FROM (SELECT DISTINCT ON (CASE WHEN de_joueur = v_moi THEN a_joueur ELSE de_joueur END)
                     CASE WHEN de_joueur = v_moi THEN a_joueur ELSE de_joueur END AS autre, texte, cree_le, de_joueur
              FROM messages WHERE v_moi IN (de_joueur, a_joueur)
              ORDER BY CASE WHEN de_joueur = v_moi THEN a_joueur ELSE de_joueur END, cree_le DESC) d
        JOIN joueurs j ON j.id = d.autre
        JOIN joueurs_refs r ON r.joueur_id = d.autre), '[]'::jsonb);
END;
$$;

-- Fil d'une conversation (200 derniers messages ; p_avec = référence) ; marque lus ceux reçus.
CREATE OR REPLACE FUNCTION conversation(p_jeton uuid, p_avec uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_moi uuid := joueur_du_jeton(p_jeton); v_avec uuid := joueur_de_ref(p_avec);
BEGIN
    UPDATE messages SET lu_le = now() WHERE a_joueur = v_moi AND de_joueur = v_avec AND lu_le IS NULL;
    RETURN jsonb_build_object(
        'avec', jsonb_build_object('ref', p_avec, 'prenom', (SELECT prenom FROM joueurs WHERE id = v_avec),
                                   'initiale', (SELECT upper(left(nom, 1)) || '.' FROM joueurs WHERE id = v_avec)),
        'bloque', EXISTS (SELECT 1 FROM joueurs_blocages WHERE joueur_id = v_moi AND bloque_id = v_avec),
        'messages', coalesce((
            SELECT jsonb_agg(jsonb_build_object('id', m.id, 'de_moi', m.de_joueur = v_moi, 'texte', m.texte,
                                                'cree_le', m.cree_le, 'lu_le', m.lu_le) ORDER BY m.cree_le, m.id)
            FROM (SELECT * FROM messages
                  WHERE least(de_joueur, a_joueur) = least(v_moi, v_avec)
                    AND greatest(de_joueur, a_joueur) = greatest(v_moi, v_avec)
                  ORDER BY cree_le DESC LIMIT 200) m), '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION bloquer_joueur(p_jeton uuid, p_joueur uuid, p_bloquer boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_moi uuid := joueur_du_jeton(p_jeton); v_j uuid := joueur_de_ref(p_joueur);
BEGIN
    IF v_j = v_moi THEN RAISE EXCEPTION 'Vous ne pouvez pas vous bloquer vous-même' USING ERRCODE = '22023'; END IF;
    IF coalesce(p_bloquer, true) THEN
        INSERT INTO joueurs_blocages (joueur_id, bloque_id) VALUES (v_moi, v_j) ON CONFLICT DO NOTHING;
    ELSE
        DELETE FROM joueurs_blocages WHERE joueur_id = v_moi AND bloque_id = v_j;
    END IF;
END;
$$;

-- Signalement au club : seulement un joueur de l'annuaire ou avec qui on a échangé.
-- 3 par jour et par joueur ; au-delà de 20 par heure sur tout le site, on enregistre sans
-- e-mail (le club les retrouve dans joueurs_signalements).
CREATE OR REPLACE FUNCTION signaler_joueur(p_jeton uuid, p_joueur uuid, p_motif text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_moi uuid := joueur_du_jeton(p_jeton);
    v_j uuid := joueur_de_ref(p_joueur);
    v_motif text := nullif(left(trim(p_motif), 500), '');
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('signalements'));
    IF v_j = v_moi THEN RAISE EXCEPTION 'Vous ne pouvez pas vous signaler vous-même' USING ERRCODE = '22023'; END IF;
    IF NOT (conversation_existe(v_moi, v_j) OR EXISTS (SELECT 1 FROM joueurs_profils WHERE joueur_id = v_j AND ouvert)) THEN
        RAISE EXCEPTION 'Vous ne pouvez signaler qu''un joueur de l''annuaire ou avec qui vous avez échangé' USING ERRCODE = '22023';
    END IF;
    IF v_motif IS NULL THEN RAISE EXCEPTION 'Indiquez le motif du signalement' USING ERRCODE = '22023'; END IF;
    IF (SELECT count(*) FROM joueurs_signalements WHERE joueur_id = v_moi AND cree_le > now() - interval '24 hours') >= 3 THEN
        RAISE EXCEPTION 'Trop de signalements aujourd''hui : contactez directement le club' USING ERRCODE = '54000';
    END IF;
    INSERT INTO joueurs_signalements (joueur_id, signale_id, motif) VALUES (v_moi, v_j, v_motif);
    IF (SELECT count(*) FROM joueurs_signalements WHERE cree_le > now() - interval '1 hour') <= 20 THEN
        PERFORM alerter_staff('Signalement annuaire',
            nom_joueur(v_moi) || ' signale ' || nom_joueur(v_j) || E' depuis l''annuaire des joueurs.\n\nMotif : « '
            || v_motif || E' »\n\nLes échanges sont dans la table messages, le signalement dans joueurs_signalements.', NULL);
    END IF;
END;
$$;

-- ===================================================================== droits
REVOKE ALL ON FUNCTION joueur_du_jeton(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION joueur_de_ref(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION prenom_initiale(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION sans_liens(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION trg_joueurs_refs() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION conversation_existe(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION blocage_entre(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION carte_joueur(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION mon_profil(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION enregistrer_profil(uuid, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION supprimer_profil(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION annuaire_joueurs(uuid, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION fiche_joueur(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION envoyer_message(uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION mes_conversations(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION conversation(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION bloquer_joueur(uuid, uuid, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION signaler_joueur(uuid, uuid, text) TO anon, authenticated;
