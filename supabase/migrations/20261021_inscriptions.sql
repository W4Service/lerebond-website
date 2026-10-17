-- Inscriptions en ligne, liste d'attente, convocations et espace joueur.
--
-- Pas de compte à créer : chaque joueur reçoit un lien personnel (jeton) vers son
-- espace (/espace-joueur/?j=…). Toutes les actions publiques passent par des
-- fonctions SECURITY DEFINER qui vérifient ce jeton ; les tables elles-mêmes ne sont
-- pas lisibles par le site public (coordonnées privées).
--
-- Cycle d'une inscription :
--   inscrite       une place lui est réservée : une équipe est créée dans le tournoi
--   liste_attente  tournoi complet ; position = ordre d'arrivée. Une place qui se
--                  libère est donnée automatiquement à la première de la liste.
--   annulee        désinscrite (par un joueur ou le staff) ; libère sa place
--   refusee        refusée par le staff
--
-- Les messages à envoyer (e-mail, SMS) sont déposés dans `notifications` ; un
-- workflow n8n les envoie et les marque envoyés. S'il est arrêté, ils attendent.

-- ===================================================================== réglages

ALTER TABLE tournois
    ADD COLUMN IF NOT EXISTS inscription_en_ligne   boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS inscriptions_fermees   boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS date_limite_inscription timestamptz;

-- Seuils FFT d'accès aux tournois : « interdit au top N ». Un joueur classé dans
-- les N premiers ne peut pas s'inscrire dans la catégorie. Valeurs AS 2027 (depuis
-- le 01/09/2026, Guide de la compétition padel, chapitre III) ; modifiables ici.
CREATE TABLE IF NOT EXISTS fft_seuils (
    categorie   text    NOT NULL,
    genre       char(1) NOT NULL CHECK (genre IN ('H', 'F')),
    interdit_top integer,                -- NULL = pas de limite
    PRIMARY KEY (categorie, genre)
);
INSERT INTO fft_seuils (categorie, genre, interdit_top) VALUES
    ('P25',  'H', 30000), ('P25',  'F', 3000),
    ('P50',  'H', 10000), ('P50',  'F', 1000),
    ('P100', 'H', 5000),  ('P100', 'F', 500),
    ('P250', 'H', 1000),  ('P250', 'F', 100),
    ('P500', 'H', NULL),  ('P500', 'F', NULL),
    ('P1000','H', NULL),  ('P1000','F', NULL),
    ('P1500','H', NULL),  ('P1500','F', NULL),
    ('P2000','H', NULL),  ('P2000','F', NULL)
ON CONFLICT (categorie, genre) DO NOTHING;
ALTER TABLE fft_seuils ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fft_seuils_lecture ON fft_seuils;
CREATE POLICY fft_seuils_lecture ON fft_seuils FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS fft_seuils_staff ON fft_seuils;
CREATE POLICY fft_seuils_staff ON fft_seuils FOR ALL TO authenticated USING (est_staff()) WITH CHECK (est_staff());

-- Une joueuse dans un tableau messieurs : son rang est converti en équivalent
-- masculin (table d'équivalence FFT, chapitre II « Classements – Barèmes &
-- Assimilations », MAJ février 2026, p. 4). Dans un tableau mixte, chacun est jugé
-- dans son propre classement. NB : au-delà du 3 000e rang la table officielle monte à
-- +55 000 / +70 000 / +90 000 (Padelac applique +50 000 partout, à tort).
CREATE OR REPLACE FUNCTION fft_rang_equivalent_messieurs(p_rang integer)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN p_rang IS NULL THEN NULL
        WHEN p_rang <= 10   THEN p_rang + 400
        WHEN p_rang <= 30   THEN p_rang + 1000
        WHEN p_rang <= 60   THEN p_rang + 2000
        WHEN p_rang <= 100  THEN p_rang + 3500
        WHEN p_rang <= 200  THEN p_rang + 10000
        WHEN p_rang <= 500  THEN p_rang + 15000
        WHEN p_rang <= 1000 THEN p_rang + 25000
        WHEN p_rang <= 2000 THEN p_rang + 35000
        WHEN p_rang <= 3000 THEN p_rang + 45000
        WHEN p_rang <= 5000 THEN p_rang + 55000
        WHEN p_rang <= 10000 THEN p_rang + 70000
        ELSE p_rang + 90000 END
$$;

-- 12345 → « 12 345 » (indépendant de la langue du serveur).
CREATE OR REPLACE FUNCTION nombre_fr(n integer) RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT regexp_replace(n::text, '(\d)(?=(\d{3})+$)', '\1 ', 'g')
$$;

-- Un joueur (rang, genre) peut-il jouer ce tournoi (catégorie, tableau) ?
-- NULL si tout va bien, sinon le message à afficher. Non classé = toujours éligible.
CREATE OR REPLACE FUNCTION fft_motif_inegibilite(p_categorie text, p_tableau text, p_rang integer, p_genre char(1))
RETURNS text LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE seuil integer; rang_compare integer := p_rang; genre_seuil char(1);
BEGIN
    IF p_rang IS NULL OR p_categorie IS NULL OR p_categorie = 'loisir' THEN RETURN NULL; END IF;
    IF p_tableau = 'dames' THEN
        genre_seuil := 'F';
    ELSIF p_tableau = 'mixte' THEN
        IF p_categorie IN ('P250', 'P500', 'P1000', 'P1500', 'P2000') THEN RETURN NULL; END IF;
        genre_seuil := coalesce(p_genre, 'H');
    ELSE  -- messieurs
        genre_seuil := 'H';
        IF p_genre = 'F' THEN rang_compare := fft_rang_equivalent_messieurs(p_rang); END IF;
    END IF;
    SELECT interdit_top INTO seuil FROM fft_seuils WHERE categorie = p_categorie AND genre = genre_seuil;
    IF seuil IS NULL OR rang_compare > seuil THEN RETURN NULL; END IF;
    RETURN format('classé·e %s : un %s %s est interdit au top %s', nombre_fr(p_rang),
                  p_categorie, CASE genre_seuil WHEN 'F' THEN 'dames' ELSE 'messieurs' END, nombre_fr(seuil));
END;
$$;
GRANT EXECUTE ON FUNCTION fft_motif_inegibilite(text, text, integer, char) TO anon, authenticated;

-- ===================================================================== données

-- Coordonnées et lien personnel : jamais lisibles par le site public.
CREATE TABLE IF NOT EXISTS joueurs_contacts (
    joueur_id   uuid PRIMARY KEY REFERENCES joueurs(id) ON DELETE CASCADE,
    email       text,
    telephone   text,
    jeton       uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_joueurs_contacts_email ON joueurs_contacts (lower(email));

CREATE TABLE IF NOT EXISTS inscriptions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tournoi_id          uuid NOT NULL REFERENCES tournois(id) ON DELETE CASCADE,
    joueur1_id          uuid NOT NULL REFERENCES joueurs(id),
    joueur2_id          uuid NOT NULL REFERENCES joueurs(id),
    statut              text NOT NULL DEFAULT 'inscrite',
    rang1               integer,      -- classement FFT au moment de l'inscription
    rang2               integer,
    poids               integer,      -- rang1 + rang2 (NULL si un des deux non classé)
    partenaire_confirme boolean NOT NULL DEFAULT false,
    message             text,
    equipe_id           uuid REFERENCES equipes(id) ON DELETE SET NULL,
    convocation_heure   timestamptz,
    convocation_envoyee_le timestamptz,
    presence_j1         boolean,      -- réponse à la convocation (NULL = pas encore)
    presence_j2         boolean,
    cree_le             timestamptz NOT NULL DEFAULT now(),
    maj_le              timestamptz NOT NULL DEFAULT now(),
    annulee_le          timestamptz,
    annulee_par         text,
    CONSTRAINT inscriptions_statut_check CHECK (statut IN ('inscrite', 'liste_attente', 'annulee', 'refusee')),
    CONSTRAINT inscriptions_deux_joueurs CHECK (joueur1_id <> joueur2_id)
);
CREATE INDEX IF NOT EXISTS idx_inscriptions_tournoi ON inscriptions (tournoi_id, statut, cree_le);
CREATE INDEX IF NOT EXISTS idx_inscriptions_j1 ON inscriptions (joueur1_id);
CREATE INDEX IF NOT EXISTS idx_inscriptions_j2 ON inscriptions (joueur2_id);

-- Messages à envoyer (file d'attente). Le workflow n8n d'envoi lit les « a_envoyer ».
CREATE TABLE IF NOT EXISTS notifications (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    canal         text NOT NULL CHECK (canal IN ('email', 'sms')),
    destinataire  text NOT NULL,
    sujet         text,
    corps         text NOT NULL,
    type          text NOT NULL,          -- inscription, invitation, promotion, annulation, convocation, rappel, lien
    inscription_id uuid REFERENCES inscriptions(id) ON DELETE SET NULL,
    joueur_id     uuid REFERENCES joueurs(id) ON DELETE SET NULL,
    statut        text NOT NULL DEFAULT 'a_envoyer' CHECK (statut IN ('a_envoyer', 'envoye', 'echec')),
    tentatives    integer NOT NULL DEFAULT 0,
    erreur        text,
    cree_le       timestamptz NOT NULL DEFAULT now(),
    envoye_le     timestamptz
);
CREATE INDEX IF NOT EXISTS idx_notifications_a_envoyer ON notifications (cree_le) WHERE statut = 'a_envoyer';

ALTER TABLE joueurs_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE inscriptions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications    ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['joueurs_contacts', 'inscriptions', 'notifications'] LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_staff', t);
        EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO authenticated USING (est_staff()) WITH CHECK (est_staff())', t || '_staff', t);
    END LOOP;
END $$;

-- ===================================================================== outils

CREATE OR REPLACE FUNCTION site_url() RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'https://le-rebond.fr' $$;

CREATE OR REPLACE FUNCTION nom_joueur(p_id uuid) RETURNS text LANGUAGE sql STABLE SET search_path = public AS $$
    SELECT trim(coalesce(prenom, '') || ' ' || coalesce(nom, '')) FROM joueurs WHERE id = p_id
$$;

CREATE OR REPLACE FUNCTION libelle_tournoi(p_id uuid) RETURNS text LANGUAGE sql STABLE SET search_path = public AS $$
    SELECT nom || ' du ' || to_char(date, 'DD/MM') || coalesce(' à ' || to_char(heure_debut, 'HH24"h"MI'), '')
    FROM tournois WHERE id = p_id
$$;

-- Dépose un message pour un joueur, sur tous ses canaux connus.
CREATE OR REPLACE FUNCTION notifier(p_joueur uuid, p_type text, p_sujet text, p_texte text, p_inscription uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c record; lien text;
BEGIN
    SELECT * INTO c FROM joueurs_contacts WHERE joueur_id = p_joueur;
    IF NOT FOUND THEN RETURN; END IF;
    lien := site_url() || '/espace-joueur/?j=' || c.jeton;
    IF nullif(trim(c.email), '') IS NOT NULL THEN
        INSERT INTO notifications (canal, destinataire, sujet, corps, type, inscription_id, joueur_id)
        VALUES ('email', trim(c.email), p_sujet,
                p_texte || E'\n\nVotre espace joueur : ' || lien || E'\n\nLe Rebond — 403 rue de l''Europe, 60400 Noyon',
                p_type, p_inscription, p_joueur);
    END IF;
    IF nullif(trim(c.telephone), '') IS NOT NULL THEN
        INSERT INTO notifications (canal, destinataire, corps, type, inscription_id, joueur_id)
        VALUES ('sms', trim(c.telephone), 'Le Rebond : ' || p_texte || ' ' || lien, p_type, p_inscription, p_joueur);
    END IF;
END;
$$;

-- Retrouve ou crée la fiche d'un joueur. Priorité : identifiant FFT, puis nom exact
-- (même normalisation que l'annuaire). Met à jour les coordonnées fournies.
CREATE OR REPLACE FUNCTION joueur_pour_inscription(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
    v_id uuid;
    v_crm bigint := nullif(p->>'id_crm', '')::bigint;
    v_nom text := nullif(trim(p->>'nom'), '');
    v_prenom text := nullif(trim(p->>'prenom'), '');
    c record;
BEGIN
    IF v_nom IS NULL OR v_prenom IS NULL THEN
        RAISE EXCEPTION 'Nom et prénom obligatoires pour chaque joueur' USING ERRCODE = '22023';
    END IF;
    IF v_crm IS NOT NULL THEN
        SELECT id INTO v_id FROM joueurs WHERE fft_id_crm = v_crm;
    END IF;
    IF v_id IS NULL THEN
        SELECT id INTO v_id FROM joueurs
        WHERE normaliser_identite(nom) = normaliser_identite(v_nom)
          AND normaliser_identite(prenom) = normaliser_identite(v_prenom)
        ORDER BY (fft_id_crm IS NOT NULL) DESC LIMIT 1;
    END IF;
    IF v_id IS NULL THEN
        INSERT INTO joueurs (nom, prenom) VALUES (v_nom, v_prenom) RETURNING id INTO v_id;
    END IF;

    -- Classement FFT connu (cache Ten'Up) : on rattache la fiche à l'identifiant.
    IF v_crm IS NOT NULL THEN
        SELECT * INTO c FROM fft_classement WHERE id_crm = v_crm ORDER BY mois DESC LIMIT 1;
        IF FOUND THEN
            UPDATE joueurs SET
                fft_id_crm = CASE WHEN NOT EXISTS (SELECT 1 FROM joueurs x WHERE x.fft_id_crm = v_crm AND x.id <> v_id)
                                  THEN v_crm ELSE fft_id_crm END,
                fft_rang = c.rang, fft_points = c.points, fft_mois = c.mois, fft_club = c.club,
                fft_statut = 'classe', fft_verifie_le = now(), genre = coalesce(genre, c.genre), updated_at = now()
            WHERE id = v_id;
        END IF;
    END IF;
    IF p->>'genre' IN ('H', 'F') THEN
        UPDATE joueurs SET genre = coalesce(genre, p->>'genre') WHERE id = v_id;
    END IF;

    INSERT INTO joueurs_contacts (joueur_id, email, telephone)
    VALUES (v_id, nullif(lower(trim(p->>'email')), ''), nullif(regexp_replace(coalesce(p->>'telephone', ''), '[^0-9+]', '', 'g'), ''))
    ON CONFLICT (joueur_id) DO UPDATE SET
        email = coalesce(EXCLUDED.email, joueurs_contacts.email),
        telephone = coalesce(EXCLUDED.telephone, joueurs_contacts.telephone),
        updated_at = now();
    RETURN v_id;
END;
$$;

-- Crée l'équipe du tournoi correspondant à une inscription (admin jour J).
CREATE OR REPLACE FUNCTION creer_equipe_inscription(p_inscription uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE i record; v_equipe uuid;
BEGIN
    SELECT * INTO i FROM inscriptions WHERE id = p_inscription;
    IF i.equipe_id IS NOT NULL THEN RETURN i.equipe_id; END IF;
    INSERT INTO equipes (tournoi_id, nom, joueur_j1_id, joueur_j2_id, points_j1, points_j2)
    VALUES (i.tournoi_id,
            (SELECT nom FROM joueurs WHERE id = i.joueur1_id) || ' / ' || (SELECT nom FROM joueurs WHERE id = i.joueur2_id),
            i.joueur1_id, i.joueur2_id, i.rang1, i.rang2)
    RETURNING id INTO v_equipe;
    UPDATE inscriptions SET equipe_id = v_equipe, maj_le = now() WHERE id = p_inscription;
    RETURN v_equipe;
END;
$$;

-- Places prises dans un tournoi : équipes saisies (dont celles créées par les
-- inscriptions en ligne), ou le compteur manuel s'il est plus grand (inscriptions
-- encore faites ailleurs). Même calcul que le calendrier public.
CREATE OR REPLACE FUNCTION places_occupees(p_tournoi uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT GREATEST(t.nb_inscrits, (SELECT count(*) FROM equipes e WHERE e.tournoi_id = t.id))::integer
    FROM tournois t WHERE t.id = p_tournoi
$$;

CREATE OR REPLACE FUNCTION nb_liste_attente(p_tournoi uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT count(*)::integer FROM inscriptions WHERE tournoi_id = p_tournoi AND statut = 'liste_attente'
$$;

-- Si une place est libre, la première paire de la liste d'attente la prend.
CREATE OR REPLACE FUNCTION promouvoir_liste_attente(p_tournoi uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t record; places integer; n integer := 0; i record;
BEGIN
    SELECT * INTO t FROM tournois WHERE id = p_tournoi FOR UPDATE;
    IF t.nb_equipes_max IS NULL THEN places := 1000000;
    ELSE places := t.nb_equipes_max - places_occupees(p_tournoi);
    END IF;
    FOR i IN SELECT * FROM inscriptions WHERE tournoi_id = p_tournoi AND statut = 'liste_attente'
             ORDER BY cree_le LIMIT GREATEST(places, 0) LOOP
        UPDATE inscriptions SET statut = 'inscrite', maj_le = now() WHERE id = i.id;
        PERFORM creer_equipe_inscription(i.id);
        PERFORM notifier(i.joueur1_id, 'promotion', 'Une place s''est libérée : vous êtes inscrits !',
            'Bonne nouvelle : une place s''est libérée au ' || libelle_tournoi(p_tournoi) || '. Votre paire avec '
            || nom_joueur(i.joueur2_id) || ' passe de la liste d''attente aux inscrits.', i.id);
        PERFORM notifier(i.joueur2_id, 'promotion', 'Une place s''est libérée : vous êtes inscrits !',
            'Bonne nouvelle : une place s''est libérée au ' || libelle_tournoi(p_tournoi) || '. Votre paire avec '
            || nom_joueur(i.joueur1_id) || ' passe de la liste d''attente aux inscrits.', i.id);
        n := n + 1;
    END LOOP;
    RETURN n;
END;
$$;

-- ===================================================================== actions publiques

-- Inscription d'une paire. p_j1 / p_j2 : {nom, prenom, email, telephone, id_crm, genre}.
-- Le classement n'est PAS pris du navigateur : il vient du cache Ten'Up (id_crm).
CREATE OR REPLACE FUNCTION inscrire_paire(p_tournoi uuid, p_j1 jsonb, p_j2 jsonb, p_message text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
    t record; v_j1 uuid; v_j2 uuid; r1 record; r2 record; motif text;
    v_statut text; v_id uuid; v_position integer; occupees integer; deja text;
BEGIN
    SELECT * INTO t FROM tournois WHERE id = p_tournoi FOR UPDATE;
    IF NOT FOUND OR NOT t.publie OR t.status <> 'planifie' THEN
        RAISE EXCEPTION 'Ce tournoi n''est pas ouvert aux inscriptions' USING ERRCODE = '22023';
    END IF;
    IF NOT t.inscription_en_ligne OR t.inscriptions_fermees
       OR t.date < current_date OR (t.date_limite_inscription IS NOT NULL AND now() > t.date_limite_inscription) THEN
        RAISE EXCEPTION 'Les inscriptions en ligne sont fermées pour ce tournoi' USING ERRCODE = '22023';
    END IF;
    IF nullif(trim(p_j1->>'email'), '') IS NULL OR nullif(trim(p_j1->>'telephone'), '') IS NULL THEN
        RAISE EXCEPTION 'E-mail et téléphone obligatoires pour le joueur qui inscrit la paire' USING ERRCODE = '22023';
    END IF;
    IF nullif(trim(p_j2->>'email'), '') IS NULL AND nullif(trim(p_j2->>'telephone'), '') IS NULL THEN
        RAISE EXCEPTION 'Indiquez l''e-mail ou le téléphone de votre partenaire, pour qu''il confirme' USING ERRCODE = '22023';
    END IF;

    v_j1 := joueur_pour_inscription(p_j1);
    v_j2 := joueur_pour_inscription(p_j2);
    IF v_j1 = v_j2 THEN RAISE EXCEPTION 'Les deux joueurs sont la même personne' USING ERRCODE = '22023'; END IF;

    -- Un joueur ne peut être que dans une paire active par tournoi.
    SELECT nom_joueur(j) INTO deja FROM (VALUES (v_j1), (v_j2)) AS v(j)
    WHERE EXISTS (SELECT 1 FROM inscriptions i WHERE i.tournoi_id = p_tournoi AND i.statut IN ('inscrite', 'liste_attente')
                  AND j IN (i.joueur1_id, i.joueur2_id))
       OR EXISTS (SELECT 1 FROM equipes e WHERE e.tournoi_id = p_tournoi AND j IN (e.joueur_j1_id, e.joueur_j2_id))
    LIMIT 1;
    IF deja IS NOT NULL THEN
        RAISE EXCEPTION '% est déjà inscrit·e à ce tournoi', deja USING ERRCODE = '23505';
    END IF;

    SELECT fft_rang AS rang, genre INTO r1 FROM joueurs WHERE id = v_j1;
    SELECT fft_rang AS rang, genre INTO r2 FROM joueurs WHERE id = v_j2;
    IF t.homologue THEN
        motif := fft_motif_inegibilite(t.categorie, t.genre, r1.rang, coalesce(r1.genre, p_j1->>'genre'));
        IF motif IS NOT NULL THEN RAISE EXCEPTION '% : %', nom_joueur(v_j1), motif USING ERRCODE = '22023'; END IF;
        motif := fft_motif_inegibilite(t.categorie, t.genre, r2.rang, coalesce(r2.genre, p_j2->>'genre'));
        IF motif IS NOT NULL THEN RAISE EXCEPTION '% : %', nom_joueur(v_j2), motif USING ERRCODE = '22023'; END IF;
    END IF;

    occupees := places_occupees(p_tournoi);
    -- Tant que des paires attendent, une nouvelle arrivée passe derrière elles.
    v_statut := CASE WHEN (t.nb_equipes_max IS NOT NULL AND occupees >= t.nb_equipes_max) OR nb_liste_attente(p_tournoi) > 0
                     THEN 'liste_attente' ELSE 'inscrite' END;

    INSERT INTO inscriptions (tournoi_id, joueur1_id, joueur2_id, statut, rang1, rang2, poids, message, partenaire_confirme)
    VALUES (p_tournoi, v_j1, v_j2, v_statut, r1.rang, r2.rang, r1.rang + r2.rang, nullif(trim(p_message), ''), false)
    RETURNING id INTO v_id;
    IF v_statut = 'inscrite' THEN PERFORM creer_equipe_inscription(v_id); END IF;

    v_position := CASE WHEN v_statut = 'liste_attente' THEN
        (SELECT count(*) FROM inscriptions WHERE tournoi_id = p_tournoi AND statut = 'liste_attente'
         AND cree_le <= (SELECT cree_le FROM inscriptions WHERE id = v_id)) END;

    PERFORM notifier(v_j1, 'inscription',
        CASE v_statut WHEN 'inscrite' THEN 'Inscription confirmée' ELSE 'Inscription en liste d''attente' END,
        CASE v_statut WHEN 'inscrite' THEN 'Votre paire avec ' || nom_joueur(v_j2) || ' est inscrite au ' || libelle_tournoi(p_tournoi) || '.'
             ELSE 'Le ' || libelle_tournoi(p_tournoi) || ' est complet : votre paire avec ' || nom_joueur(v_j2)
                  || ' est en liste d''attente (position ' || v_position || '). Vous serez prévenus si une place se libère.' END,
        v_id);
    PERFORM notifier(v_j2, 'invitation', nom_joueur(v_j1) || ' vous a inscrit·e à un tournoi',
        nom_joueur(v_j1) || ' vous a inscrit·e avec lui/elle au ' || libelle_tournoi(p_tournoi)
        || CASE v_statut WHEN 'liste_attente' THEN ' (liste d''attente, position ' || v_position || ')' ELSE '' END
        || '. Merci de confirmer votre participation depuis votre espace joueur.', v_id);

    RETURN jsonb_build_object(
        'inscription', v_id, 'statut', v_statut, 'position', v_position,
        'lien', site_url() || '/espace-joueur/?j=' || (SELECT jeton FROM joueurs_contacts WHERE joueur_id = v_j1));
END;
$$;

-- Le joueur du jeton fait-il partie de cette inscription ? Renvoie 1, 2 ou NULL.
CREATE OR REPLACE FUNCTION place_dans_inscription(p_jeton uuid, p_inscription uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT CASE WHEN c.joueur_id = i.joueur1_id THEN 1 WHEN c.joueur_id = i.joueur2_id THEN 2 END
    FROM inscriptions i, joueurs_contacts c
    WHERE i.id = p_inscription AND c.jeton = p_jeton
$$;

CREATE OR REPLACE FUNCTION confirmer_partenaire(p_jeton uuid, p_inscription uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF place_dans_inscription(p_jeton, p_inscription) IS NULL THEN
        RAISE EXCEPTION 'Lien invalide pour cette inscription' USING ERRCODE = '42501';
    END IF;
    UPDATE inscriptions SET partenaire_confirme = true, maj_le = now() WHERE id = p_inscription;
END;
$$;

-- Désinscription par un des deux joueurs. Libère la place (et promeut la liste d'attente).
CREATE OR REPLACE FUNCTION annuler_inscription(p_jeton uuid, p_inscription uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE place integer; i record; t record; auteur uuid; autre uuid; promus integer;
BEGIN
    place := place_dans_inscription(p_jeton, p_inscription);
    IF place IS NULL THEN RAISE EXCEPTION 'Lien invalide pour cette inscription' USING ERRCODE = '42501'; END IF;
    SELECT * INTO i FROM inscriptions WHERE id = p_inscription FOR UPDATE;
    SELECT * INTO t FROM tournois WHERE id = i.tournoi_id;
    IF i.statut NOT IN ('inscrite', 'liste_attente') THEN RETURN jsonb_build_object('statut', i.statut); END IF;
    IF t.status <> 'planifie' THEN
        RAISE EXCEPTION 'Le tournoi a commencé : prévenez directement le juge-arbitre' USING ERRCODE = '22023';
    END IF;
    auteur := CASE place WHEN 1 THEN i.joueur1_id ELSE i.joueur2_id END;
    autre  := CASE place WHEN 1 THEN i.joueur2_id ELSE i.joueur1_id END;
    UPDATE inscriptions SET statut = 'annulee', annulee_le = now(), annulee_par = nom_joueur(auteur), maj_le = now()
    WHERE id = p_inscription;
    IF i.equipe_id IS NOT NULL THEN
        DELETE FROM equipes WHERE id = i.equipe_id AND poule_id IS NULL;
    END IF;
    PERFORM notifier(autre, 'annulation', 'Désinscription',
        nom_joueur(auteur) || ' a désinscrit votre paire du ' || libelle_tournoi(i.tournoi_id) || '.', p_inscription);
    promus := promouvoir_liste_attente(i.tournoi_id);
    RETURN jsonb_build_object('statut', 'annulee', 'promues', promus);
END;
$$;

-- Réponse à la convocation : le joueur confirme (ou non) sa présence.
CREATE OR REPLACE FUNCTION repondre_convocation(p_jeton uuid, p_inscription uuid, p_present boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE place integer;
BEGIN
    place := place_dans_inscription(p_jeton, p_inscription);
    IF place IS NULL THEN RAISE EXCEPTION 'Lien invalide pour cette inscription' USING ERRCODE = '42501'; END IF;
    IF place = 1 THEN UPDATE inscriptions SET presence_j1 = p_present, maj_le = now() WHERE id = p_inscription;
    ELSE UPDATE inscriptions SET presence_j2 = p_present, maj_le = now() WHERE id = p_inscription; END IF;
END;
$$;

-- Tout ce qu'affiche l'espace joueur.
CREATE OR REPLACE FUNCTION espace_joueur(p_jeton uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE c record; j record;
BEGIN
    SELECT * INTO c FROM joueurs_contacts WHERE jeton = p_jeton;
    IF NOT FOUND THEN RAISE EXCEPTION 'Lien inconnu ou expiré' USING ERRCODE = '42501'; END IF;
    SELECT * INTO j FROM joueurs WHERE id = c.joueur_id;
    RETURN jsonb_build_object(
        'joueur', jsonb_build_object('prenom', j.prenom, 'nom', j.nom, 'genre', j.genre,
            'fft_rang', j.fft_rang, 'fft_points', j.fft_points, 'fft_mois', j.fft_mois, 'fft_club', j.fft_club,
            'fft_statut', j.fft_statut, 'email', c.email, 'telephone', c.telephone),
        -- évolution du classement : mois connus dans le cache (par identifiant FFT)
        'historique_classement', coalesce((
            SELECT jsonb_agg(jsonb_build_object('mois', h.mois, 'rang', h.rang, 'points', h.points) ORDER BY h.mois)
            FROM fft_classement h WHERE j.fft_id_crm IS NOT NULL AND h.id_crm = j.fft_id_crm), '[]'::jsonb),
        'inscriptions', coalesce((
            SELECT jsonb_agg(x ORDER BY (x->>'date'), (x->>'cree_le')) FROM (
                SELECT jsonb_build_object(
                    'id', i.id, 'statut', i.statut, 'cree_le', i.cree_le,
                    'tournoi', t.nom, 'tournoi_id', t.id, 'date', t.date, 'heure_debut', t.heure_debut,
                    'categorie', t.categorie, 'tableau', t.genre, 'tournoi_statut', t.status,
                    'partenaire', nom_joueur(CASE WHEN i.joueur1_id = j.id THEN i.joueur2_id ELSE i.joueur1_id END),
                    'je_suis', CASE WHEN i.joueur1_id = j.id THEN 1 ELSE 2 END,
                    'partenaire_confirme', i.partenaire_confirme, 'poids', i.poids,
                    'position', CASE WHEN i.statut = 'liste_attente' THEN
                        (SELECT count(*) FROM inscriptions w WHERE w.tournoi_id = i.tournoi_id
                           AND w.statut = 'liste_attente' AND w.cree_le <= i.cree_le) END,
                    'convocation_heure', i.convocation_heure,
                    'ma_presence', CASE WHEN i.joueur1_id = j.id THEN i.presence_j1 ELSE i.presence_j2 END) AS x
                FROM inscriptions i JOIN tournois t ON t.id = i.tournoi_id
                WHERE j.id IN (i.joueur1_id, i.joueur2_id)) s), '[]'::jsonb),
        -- tournois joués (équipes, y compris celles saisies dans l'admin)
        'historique', coalesce((
            SELECT jsonb_agg(x ORDER BY (x->>'date') DESC) FROM (
                SELECT jsonb_build_object('tournoi', t.nom, 'tournoi_id', t.id, 'date', t.date,
                    'categorie', t.categorie, 'statut', t.status,
                    'partenaire', nom_joueur(CASE WHEN e.joueur_j1_id = j.id THEN e.joueur_j2_id ELSE e.joueur_j1_id END)) AS x
                FROM equipes e JOIN tournois t ON t.id = e.tournoi_id
                WHERE j.id IN (e.joueur_j1_id, e.joueur_j2_id) AND t.status IN ('actif', 'cloture')) s), '[]'::jsonb),
        -- partenaires habituels, pour se réinscrire en un clic
        'partenaires', coalesce((
            SELECT jsonb_agg(jsonb_build_object('prenom', p.prenom, 'nom', p.nom, 'id_crm', p.fft_id_crm,
                                                'fft_rang', p.fft_rang, 'fois', n) ORDER BY n DESC)
            FROM (SELECT CASE WHEN e.joueur_j1_id = j.id THEN e.joueur_j2_id ELSE e.joueur_j1_id END AS pid, count(*) AS n
                  FROM equipes e WHERE j.id IN (e.joueur_j1_id, e.joueur_j2_id) GROUP BY 1) q
            JOIN joueurs p ON p.id = q.pid), '[]'::jsonb)
    );
END;
$$;

-- « J'ai perdu mon lien » : renvoie le lien à l'adresse indiquée, si elle est connue.
-- Répond toujours pareil : on ne révèle pas quelles adresses sont inscrites.
CREATE OR REPLACE FUNCTION envoyer_mon_lien(p_email text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c record;
BEGIN
    FOR c IN SELECT * FROM joueurs_contacts WHERE lower(email) = lower(trim(p_email)) LIMIT 3 LOOP
        -- au plus un envoi par quart d'heure et par joueur (anti-abus)
        IF NOT EXISTS (SELECT 1 FROM notifications WHERE joueur_id = c.joueur_id AND type = 'lien'
                       AND cree_le > now() - interval '15 minutes') THEN
            INSERT INTO notifications (canal, destinataire, sujet, corps, type, joueur_id)
            VALUES ('email', c.email, 'Votre lien d''espace joueur Le Rebond',
                    'Bonjour ' || nom_joueur(c.joueur_id) || E',\n\nVoici le lien vers votre espace joueur : '
                    || site_url() || '/espace-joueur/?j=' || c.jeton
                    || E'\n\nConservez-le : il donne accès à vos inscriptions.\n\nLe Rebond', 'lien', c.joueur_id);
        END IF;
    END LOOP;
END;
$$;

-- Liste publique des paires d'un tournoi (noms et classements, pas de coordonnées).
CREATE OR REPLACE FUNCTION paires_tournoi(p_tournoi uuid)
RETURNS TABLE (statut text, rang_attente integer, joueur1 text, joueur2 text, rang1 integer, rang2 integer, poids integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT i.statut,
           CASE WHEN i.statut = 'liste_attente' THEN
               (row_number() OVER (PARTITION BY i.statut ORDER BY i.cree_le))::int END,
           nom_joueur(i.joueur1_id), nom_joueur(i.joueur2_id), i.rang1, i.rang2, i.poids
    FROM inscriptions i JOIN tournois t ON t.id = i.tournoi_id
    WHERE i.tournoi_id = p_tournoi AND t.publie AND i.statut IN ('inscrite', 'liste_attente')
    ORDER BY i.statut, i.poids NULLS LAST, i.cree_le
$$;

-- ===================================================================== actions staff

-- Désinscription ou refus par le staff (avec promotion de la liste d'attente).
CREATE OR REPLACE FUNCTION staff_retirer_inscription(p_inscription uuid, p_statut text DEFAULT 'annulee')
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE i record;
BEGIN
    IF NOT est_staff() THEN RAISE EXCEPTION 'réservé au staff' USING ERRCODE = '42501'; END IF;
    IF p_statut NOT IN ('annulee', 'refusee') THEN RAISE EXCEPTION 'statut invalide'; END IF;
    SELECT * INTO i FROM inscriptions WHERE id = p_inscription FOR UPDATE;
    UPDATE inscriptions SET statut = p_statut, annulee_le = now(), annulee_par = 'staff', maj_le = now() WHERE id = p_inscription;
    IF i.equipe_id IS NOT NULL THEN DELETE FROM equipes WHERE id = i.equipe_id AND poule_id IS NULL; END IF;
    PERFORM notifier(i.joueur1_id, 'annulation', 'Inscription annulée',
        'Votre inscription au ' || libelle_tournoi(i.tournoi_id) || ' a été ' ||
        CASE p_statut WHEN 'refusee' THEN 'refusée' ELSE 'annulée' END || ' par le club. Contactez-nous pour toute question.', p_inscription);
    PERFORM notifier(i.joueur2_id, 'annulation', 'Inscription annulée',
        'Votre inscription au ' || libelle_tournoi(i.tournoi_id) || ' a été ' ||
        CASE p_statut WHEN 'refusee' THEN 'refusée' ELSE 'annulée' END || ' par le club. Contactez-nous pour toute question.', p_inscription);
    RETURN CASE WHEN i.statut = 'inscrite' THEN promouvoir_liste_attente(i.tournoi_id) ELSE 0 END;
END;
$$;

-- Convocations : enregistre l'heure de chaque paire et dépose les messages.
-- p_heures : [{"inscription": uuid, "heure": "2026-11-08T09:00:00+01:00"}]
CREATE OR REPLACE FUNCTION staff_envoyer_convocations(p_tournoi uuid, p_heures jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE h record; i record; n integer := 0; texte text;
BEGIN
    IF NOT est_staff() THEN RAISE EXCEPTION 'réservé au staff' USING ERRCODE = '42501'; END IF;
    FOR h IN SELECT (x->>'inscription')::uuid AS id, (x->>'heure')::timestamptz AS heure
             FROM jsonb_array_elements(p_heures) x LOOP
        SELECT * INTO i FROM inscriptions WHERE id = h.id AND tournoi_id = p_tournoi AND statut = 'inscrite';
        IF NOT FOUND OR h.heure IS NULL THEN CONTINUE; END IF;
        UPDATE inscriptions SET convocation_heure = h.heure, convocation_envoyee_le = now(),
               presence_j1 = NULL, presence_j2 = NULL, maj_le = now() WHERE id = i.id;
        texte := 'Convocation ' || libelle_tournoi(p_tournoi) || ' : présentez-vous le '
              || to_char(h.heure AT TIME ZONE 'Europe/Paris', 'DD/MM "à" HH24"h"MI')
              || '. Merci de confirmer votre présence depuis votre espace joueur.';
        PERFORM notifier(i.joueur1_id, 'convocation', 'Votre convocation', texte, i.id);
        PERFORM notifier(i.joueur2_id, 'convocation', 'Votre convocation', texte, i.id);
        n := n + 1;
    END LOOP;
    RETURN n;
END;
$$;

-- Droits : le site public n'a accès qu'aux fonctions ci-dessous.
REVOKE ALL ON FUNCTION notifier(uuid, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION joueur_pour_inscription(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION creer_equipe_inscription(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION promouvoir_liste_attente(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION place_dans_inscription(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION inscrire_paire(uuid, jsonb, jsonb, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION confirmer_partenaire(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION annuler_inscription(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION repondre_convocation(uuid, uuid, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION espace_joueur(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION envoyer_mon_lien(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION paires_tournoi(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION staff_retirer_inscription(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION staff_envoyer_convocations(uuid, jsonb) TO authenticated;

-- ===================================================================== calendrier

-- Le calendrier public indique aussi la liste d'attente et si l'inscription en ligne est ouverte.
DROP VIEW IF EXISTS tournois_calendrier;
CREATE VIEW tournois_calendrier WITH (security_invoker = true) AS
SELECT
    t.id, t.nom, t.date, t.heure_debut, t.heure_fin, t.categorie, t.genre, t.homologue, t.nb_equipes_max,
    GREATEST(t.nb_inscrits, COALESCE(e.nb, 0))::integer AS inscrits,
    (t.nb_equipes_max IS NOT NULL AND GREATEST(t.nb_inscrits, COALESCE(e.nb, 0)) >= t.nb_equipes_max) AS complet,
    nb_liste_attente(t.id) AS liste_attente,
    (t.inscription_en_ligne AND NOT t.inscriptions_fermees AND t.status = 'planifie'
        AND (t.date_limite_inscription IS NULL OR now() <= t.date_limite_inscription)) AS inscription_ouverte,
    t.prix_par_joueur, t.description, t.lien_inscription, t.juge_arbitre, t.status
FROM tournois t
LEFT JOIN (SELECT tournoi_id, count(*) AS nb FROM equipes GROUP BY tournoi_id) e ON e.tournoi_id = t.id
WHERE t.publie AND t.status IN ('planifie', 'actif', 'cloture') AND t.date IS NOT NULL;
GRANT SELECT ON tournois_calendrier TO anon, authenticated;
GRANT EXECUTE ON FUNCTION nb_liste_attente(uuid) TO anon, authenticated;
REVOKE ALL ON FUNCTION places_occupees(uuid) FROM PUBLIC, anon, authenticated;

-- Le staff augmente la capacité d'un tournoi : la liste d'attente avance d'elle-même.
CREATE OR REPLACE FUNCTION tournois_capacite_modifiee()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NEW.status = 'planifie' AND (OLD.nb_equipes_max IS DISTINCT FROM NEW.nb_equipes_max
                                     OR OLD.nb_inscrits IS DISTINCT FROM NEW.nb_inscrits) THEN
        PERFORM promouvoir_liste_attente(NEW.id);
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_tournois_capacite ON tournois;
CREATE TRIGGER trg_tournois_capacite AFTER UPDATE OF nb_equipes_max, nb_inscrits ON tournois
    FOR EACH ROW EXECUTE FUNCTION tournois_capacite_modifiee();
