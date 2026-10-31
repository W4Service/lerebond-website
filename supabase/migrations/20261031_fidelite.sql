-- Tunnel de bienvenue (fidélité) : chaque retour rapide d'un nouveau joueur de padel
-- débloque un cadeau pour sa partie suivante. Cahier des charges :
-- ~/Documents/Code/n8n/Padel/prompt-claude-code-tunnel-rebond.md
--
-- Tout vit dans le schéma `fidelite` (non exposé par l'API) :
--   - la source = les tables LiveXperience `livex.livex_clients` / `livex.livex_reservations`,
--     remplies chaque nuit par le script de wepepc (veille → J+30, chaque jour remplacé :
--     une réservation annulée disparaît) ; `synchroniser()` les recopie ici ;
--   - `calculer()` est le moteur : il fait avancer chaque client et dépose les messages
--     dans `messages`. Il ne fait aucun envoi : le workflow n8n lit les « a_envoyer ».
--   - en dry-run (config `dry_run`), les messages sont « simule » et ne partent jamais.
-- Le site n'accède qu'à quelques fonctions `public.fidelite_*` (page bar, désinscription,
-- tableau de suivi), réservées au staff sauf la désinscription (jeton personnel).
--
-- V1 : padel seulement (le five est exclu du tunnel), e-mail seulement (les SMS sont
-- prévus mais `canaux_actifs` ne contient que « email »).

CREATE SCHEMA IF NOT EXISTS fidelite;
REVOKE ALL ON SCHEMA fidelite FROM PUBLIC;
REVOKE ALL ON SCHEMA fidelite FROM anon, authenticated;

-- ===================================================================== configuration

CREATE TABLE IF NOT EXISTS fidelite.config (
    cle         text PRIMARY KEY,
    valeur      jsonb NOT NULL,
    description text
);

INSERT INTO fidelite.config (cle, valeur, description) VALUES
    ('dry_run', 'true', 'true = les messages sont générés (statut simule) mais jamais envoyés'),
    ('date_lancement', 'null', 'AAAA-MM-JJ : seuls les clients dont la 1re réservation est postérieure entrent dans le tunnel (null = personne)'),
    ('ressources_padel', '["3119", "3120", "3121"]', 'resource_id LiveXperience des pistes de padel'),
    ('ressources_five', '["3122"]', 'resource_id du five (compte dans l''historique, pas dans le tunnel)'),
    ('clients_exclus', '["146"]', 'comptes internes (146 = DIRECTION)'),
    ('heures_creuses', '{"semaine": [["09:00", "12:00"], ["14:00", "17:00"], ["22:30", "24:00"]], "weekend": [["09:00", "12:00"], ["14:00", "17:00"], ["22:30", "24:00"]]}',
        'plages HC (heure de début de partie), week-end = samedi et dimanche'),
    ('fenetre_jours', '7', 'jours pour revenir après une partie'),
    ('rattrapage_jours', '14', 'relance de rattrapage, une seule fois par client'),
    ('grand_retour_jours', '60', 'inactivité déclenchant le grand retour'),
    ('grand_retour_validite_jours', '21', 'validité du cadeau grand retour'),
    ('grand_retour_intervalle_jours', '365', '1 grand retour par client sur cette durée'),
    ('grand_retour_max_par_jour', '40', 'grands retours créés au plus par jour (étale le lancement)'),
    ('pourcentage_temoin', '10', '% de nouveaux clients sans aucun message (mesure de l''effet)'),
    ('sel_temoin', '"rebond-2026"', 'change le tirage du groupe témoin'),
    ('plafond_jours', '7', '1 message par client sur cette durée, tous canaux (le rappel J+5 de la même offre est toléré)'),
    ('envoi_heure_debut', '10', 'heure locale minimale d''envoi'),
    ('envoi_heure_fin', '19', 'heure locale à partir de laquelle on n''envoie plus'),
    ('canaux_actifs', '["email"]', 'canaux branchés (ajouter "sms" quand une passerelle Le Rebond existe)'),
    ('canaux_par_type', '{"annonce": ["sms", "email"], "retour": ["sms", "email"], "rappel": ["sms", "email"], "rattrapage": ["email"], "grand_retour": ["email"]}',
        'canal préféré par type de message, parmi les canaux actifs'),
    ('newsletter', '{"jour_semaine": 2, "rang": 1}', 'newsletter : 1er mardi du mois (jour ISO 1 = lundi) ; compte dans le plafond'),
    ('lien_reservation', '"https://lerebond.mymobileapp.fr/"', 'lien {lien} des messages'),
    ('expediteur', '"contact@le-rebond.fr"', 'boîte Microsoft 365 qui envoie les e-mails (workflow n8n)'),
    ('numero_stop', '""', 'numéro {numero_stop} des SMS'),
    ('cadeau_grand_retour', '{"libelle": "Pizza ou planche à partager + raquettes offertes", "formule": "une pizza ou une planche à partager, et les raquettes offertes pour toute l''équipe", "choix_requis": true}',
        'cadeau du grand retour')
ON CONFLICT (cle) DO NOTHING;

CREATE OR REPLACE FUNCTION fidelite.cfg(p_cle text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = fidelite AS $$
    SELECT valeur FROM fidelite.config WHERE cle = p_cle
$$;
CREATE OR REPLACE FUNCTION fidelite.cfg_int(p_cle text) RETURNS integer
LANGUAGE sql STABLE SET search_path = fidelite AS $$
    SELECT (valeur #>> '{}')::integer FROM fidelite.config WHERE cle = p_cle
$$;
CREATE OR REPLACE FUNCTION fidelite.cfg_txt(p_cle text) RETURNS text
LANGUAGE sql STABLE SET search_path = fidelite AS $$
    SELECT valeur #>> '{}' FROM fidelite.config WHERE cle = p_cle
$$;

-- Paliers : `rang` = nombre de parties jouées dans le tunnel. Le cadeau du rang N
-- s'applique à la partie N+1. Le rang marqué `fin` fait passer le client « régulier ».
CREATE TABLE IF NOT EXISTS fidelite.paliers (
    sport        text NOT NULL,
    rang         integer NOT NULL,
    libelle      text,                   -- affiché au bar
    formule      text,                   -- {cadeau} dans les messages
    choix_requis boolean NOT NULL DEFAULT false,   -- pizza ou planche : le bar note le choix
    fin          boolean NOT NULL DEFAULT false,
    PRIMARY KEY (sport, rang)
);
INSERT INTO fidelite.paliers (sport, rang, libelle, formule, choix_requis, fin) VALUES
    ('padel', 1, 'Raquettes offertes aux 4 joueurs', 'la location de raquettes offerte pour toute l''équipe', false, false),
    ('padel', 2, 'Boisson offerte au réservant', 'ta boisson offerte', false, false),
    ('padel', 3, 'Pizza ou planche à partager', 'une pizza ou une planche à partager après le match', true, false),
    ('padel', 4, 'Tournée pour l''équipe', 'la tournée offerte pour l''équipe', false, false),
    ('padel', 5, NULL, NULL, false, true)
ON CONFLICT (sport, rang) DO NOTHING;

-- Modèles : variables {prenom} {date_limite} {cadeau} {code} {lien} {lien_desinscription}
-- {heures_creuses} {jours_restants} {numero_stop}. `pied` est ajouté à chaque message du canal.
CREATE TABLE IF NOT EXISTS fidelite.templates (
    code   text NOT NULL,
    canal  text NOT NULL CHECK (canal IN ('email', 'sms')),
    sujet  text,
    corps  text NOT NULL,
    PRIMARY KEY (code, canal)
);
INSERT INTO fidelite.templates (code, canal, sujet, corps) VALUES
    ('annonce_1', 'sms', NULL, 'Salut {prenom}, merci d''être venu au Rebond ! Reviens jouer d''ici le {date_limite} : raquettes offertes pour toute l''équipe. Réserve ici : {lien}'),
    ('annonce_2', 'sms', NULL, '2 parties en une semaine, bravo {prenom} ! Prochaine partie avant le {date_limite} : ta boisson est offerte. {lien}'),
    ('annonce_3', 'sms', NULL, 'Jamais 2 sans 3 ! Reviens avant le {date_limite} : une pizza ou une planche à partager vous attend après le match. {lien}'),
    ('annonce_4', 'sms', NULL, '4 parties, t''es des nôtres {prenom} ! La prochaine avant le {date_limite} : la tournée est pour nous. {lien}'),
    ('retour', 'sms', NULL, 'Content de te revoir {prenom} ! Reviens jouer d''ici le {date_limite} : {cadeau}. {lien}'),
    ('rappel', 'sms', NULL, '{prenom}, plus que {jours_restants} pour profiter de {cadeau}. Il reste des créneaux : {lien}'),
    ('pied', 'sms', NULL, 'Valable en heures creuses ({heures_creuses}). STOP au {numero_stop}'),

    ('annonce_1', 'email', 'Tes raquettes sont offertes pour la prochaine partie',
     E'Salut {prenom},\n\nMerci d''être venu jouer au Rebond ! Reviens d''ici le {date_limite} : la location de raquettes est offerte pour toute l''équipe.\n\nRéserve ton prochain créneau : {lien}'),
    ('annonce_2', 'email', 'Ta boisson est offerte à la prochaine partie',
     E'2 parties en une semaine, bravo {prenom} !\n\nJoue ta prochaine partie avant le {date_limite} : ta boisson est offerte.\n\nRéserve ici : {lien}'),
    ('annonce_3', 'email', 'Pizza ou planche offerte après ton prochain match',
     E'Jamais 2 sans 3, {prenom} !\n\nReviens avant le {date_limite} : une pizza ou une planche à partager vous attend après le match.\n\nRéserve ici : {lien}'),
    ('annonce_4', 'email', 'La prochaine tournée est pour nous',
     E'4 parties, t''es des nôtres {prenom} !\n\nLa prochaine avant le {date_limite} : la tournée est pour nous.\n\nRéserve ici : {lien}'),
    ('retour', 'email', 'Content de te revoir au Rebond',
     E'Content de te revoir sur les pistes, {prenom} !\n\nReviens jouer d''ici le {date_limite} : {cadeau}.\n\nRéserve ici : {lien}'),
    ('rappel', 'email', 'Plus que {jours_restants} pour ton cadeau',
     E'{prenom}, plus que {jours_restants} pour profiter de {cadeau}.\n\nIl reste des créneaux : {lien}'),
    ('rattrapage', 'email', '{prenom}, on t''a gardé ton cadeau',
     E'Salut {prenom},\n\nÇa fait deux semaines qu''on ne t''a pas vu sur les pistes ! On te garde ton cadeau : {cadeau}, pour une partie jouée d''ici le {date_limite}.\n\nRéserve ton créneau : {lien}\n\nÀ très vite au Rebond !'),
    ('grand_retour', 'email', 'Les pistes du Rebond t''attendent',
     E'Salut {prenom},\n\nÇa fait un moment qu''on ne t''a pas vu ! Pour ton retour, on t''offre {cadeau}.\n\nValable pour une partie jouée d''ici le {date_limite}. Réserve ici : {lien}\n\nOn a hâte de te revoir !'),
    ('pied', 'email', NULL,
     E'Valable pour une partie commencée en heures creuses ({heures_creuses}). Ton code à donner au bar : {code}\n\n—\nLe Rebond · 403 rue de l''Europe, 60400 Noyon\nNe plus recevoir ces messages : {lien_desinscription}')
ON CONFLICT (code, canal) DO NOTHING;

-- ===================================================================== données

-- Clients LiveXperience (ref = « ID CLIENT »). `personne` regroupe les fiches en double
-- (même téléphone ou même e-mail) sous la plus petite ref : c'est l'identité du tunnel.
CREATE TABLE IF NOT EXISTS fidelite.clients (
    id_client     text PRIMARY KEY,
    personne      text NOT NULL,
    prenom        text,
    nom           text,
    email         text,
    telephone     text,                  -- E.164
    cree_le       date,
    jeton         uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,   -- lien de désinscription
    relances_ok   boolean NOT NULL DEFAULT true,    -- intérêt légitime (client existant), retrait à tout moment
    newsletter_ok boolean NOT NULL DEFAULT false,   -- consentement explicite
    maj_le        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fid_clients_personne ON fidelite.clients (personne);

-- Historique des consentements (preuve) ; l'état courant est dans `clients`.
CREATE TABLE IF NOT EXISTS fidelite.consentements (
    id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    personne  text NOT NULL,
    type      text NOT NULL CHECK (type IN ('relances', 'newsletter')),
    valeur    boolean NOT NULL,
    source    text NOT NULL,             -- lien_email, stop_sms, staff
    le        timestamptz NOT NULL DEFAULT now()
);

-- Parties (copie de livex, refaite à chaque calcul). Annulée = absente de livex.
CREATE TABLE IF NOT EXISTS fidelite.parties (
    id_resa    text PRIMARY KEY,
    personne   text NOT NULL,
    id_client  text NOT NULL,
    ressource  text NOT NULL,
    sport      text NOT NULL CHECK (sport IN ('padel', 'five')),
    debut      timestamptz NOT NULL,
    fin        timestamptz NOT NULL,
    jour       date NOT NULL,            -- date locale du début
    hc         boolean NOT NULL          -- commence en heures creuses
);
CREATE INDEX IF NOT EXISTS idx_fid_parties_personne ON fidelite.parties (personne, jour);

-- État du tunnel, une ligne par personne entrée.
CREATE TABLE IF NOT EXISTS fidelite.tunnel (
    personne           text PRIMARY KEY,
    sport              text NOT NULL DEFAULT 'padel',
    entre_le           timestamptz NOT NULL,
    premiere_partie    date NOT NULL,
    groupe             text NOT NULL CHECK (groupe IN ('cible', 'temoin')),
    palier             integer NOT NULL,          -- parties jouées dans le tunnel
    derniere_partie    date NOT NULL,
    echeance           date NOT NULL,             -- dernier jour pour revenir
    rattrapage_utilise boolean NOT NULL DEFAULT false,
    statut             text NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif', 'regulier', 'decroche')),
    maj_le             timestamptz NOT NULL DEFAULT now()
);

-- Cadeaux : nominatifs, code unique, usage unique, une seule offre active par personne.
CREATE TABLE IF NOT EXISTS fidelite.cadeaux (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code         text NOT NULL UNIQUE,
    personne     text NOT NULL,
    origine      text NOT NULL CHECK (origine IN ('palier', 'retour', 'rattrapage', 'grand_retour')),
    palier       integer,
    libelle      text NOT NULL,
    formule      text NOT NULL,
    choix_requis boolean NOT NULL DEFAULT false,
    valable_du   date NOT NULL,
    expire_le    date NOT NULL,          -- inclus
    statut       text NOT NULL DEFAULT 'actif'
                 CHECK (statut IN ('actif', 'utilise', 'expire', 'perdu_hp', 'remplace')),
    motif        text,
    choix        text CHECK (choix IN ('pizza', 'planche')),
    cree_le      timestamptz NOT NULL DEFAULT now(),
    utilise_le   timestamptz,
    utilise_par  text
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fid_cadeau_actif ON fidelite.cadeaux (personne) WHERE statut = 'actif';

-- Journal des messages = file d'envoi. `cle` empêche de générer deux fois le même message.
CREATE TABLE IF NOT EXISTS fidelite.messages (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cle          text NOT NULL UNIQUE,
    personne     text NOT NULL,
    cadeau_id    uuid REFERENCES fidelite.cadeaux(id) ON DELETE CASCADE,
    type         text NOT NULL CHECK (type IN ('annonce', 'retour', 'rappel', 'rattrapage', 'grand_retour')),
    canal        text CHECK (canal IN ('email', 'sms')),
    destinataire text,
    sujet        text,
    corps        text,
    statut       text NOT NULL CHECK (statut IN ('simule', 'a_envoyer', 'envoye', 'echec', 'bloque')),
    motif        text,
    tentatives   integer NOT NULL DEFAULT 0,
    erreur       text,
    cree_le      timestamptz NOT NULL DEFAULT now(),
    envoye_le    timestamptz
);
CREATE INDEX IF NOT EXISTS idx_fid_messages_personne ON fidelite.messages (personne, cree_le);
CREATE INDEX IF NOT EXISTS idx_fid_messages_a_envoyer ON fidelite.messages (cree_le) WHERE statut = 'a_envoyer';

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['config', 'paliers', 'templates', 'clients', 'consentements',
                             'parties', 'tunnel', 'cadeaux', 'messages'] LOOP
        EXECUTE format('ALTER TABLE fidelite.%I ENABLE ROW LEVEL SECURITY', t);
    END LOOP;
END $$;

-- Coordonnées d'une personne : la fiche principale d'abord, puis les doublons.
CREATE OR REPLACE VIEW fidelite.v_personnes AS
SELECT personne,
       (array_agg(prenom ORDER BY id_client = personne DESC, prenom IS NULL))[1]       AS prenom,
       (array_agg(nom ORDER BY id_client = personne DESC, nom IS NULL))[1]             AS nom,
       (array_agg(email ORDER BY email IS NULL, id_client = personne DESC))[1]         AS email,
       (array_agg(telephone ORDER BY telephone IS NULL, id_client = personne DESC))[1] AS telephone,
       (array_agg(jeton ORDER BY id_client = personne DESC))[1]                        AS jeton,
       bool_and(relances_ok)   AS relances_ok,
       bool_and(newsletter_ok) AS newsletter_ok
FROM fidelite.clients
GROUP BY personne;

-- ===================================================================== outils

-- Téléphone français en E.164 ; NULL si inexploitable (ex. « +336257154 », trop court).
CREATE OR REPLACE FUNCTION fidelite.tel_e164(p text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE c text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
BEGIN
    IF btrim(coalesce(p, '')) LIKE '+%' THEN
        RETURN CASE WHEN c ~ '^33[1-9]\d{8}$' OR (length(c) BETWEEN 11 AND 15 AND c !~ '^33') THEN '+' || c END;
    END IF;
    IF c ~ '^0[1-9]\d{8}$' THEN RETURN '+33' || substr(c, 2); END IF;
    IF c ~ '^[1-9]\d{8}$' THEN RETURN '+33' || c; END IF;          -- 0 initial perdu à la saisie
    IF c ~ '^0033[1-9]\d{8}$' THEN RETURN '+' || substr(c, 3); END IF;
    IF c ~ '^33[1-9]\d{8}$' THEN RETURN '+' || c; END IF;
    RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION fidelite.email_normalise(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN lower(btrim(p)) ~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' THEN lower(btrim(p)) END
$$;

-- Horloge des fonctions du site : now(), sauf si les tests fixent `fidelite.maintenant`.
CREATE OR REPLACE FUNCTION fidelite.maintenant() RETURNS timestamptz
LANGUAGE sql STABLE AS $$
    SELECT coalesce(nullif(current_setting('fidelite.maintenant', true), '')::timestamptz, now())
$$;

-- Plages HC du jour (semaine ou week-end), en minutes depuis minuit.
CREATE OR REPLACE FUNCTION fidelite.plages_hc(p_jour date)
RETURNS TABLE (debut integer, fin integer)
LANGUAGE sql STABLE SET search_path = fidelite AS $$
    SELECT split_part(p->>0, ':', 1)::int * 60 + split_part(p->>0, ':', 2)::int,
           split_part(p->>1, ':', 1)::int * 60 + split_part(p->>1, ':', 2)::int
    FROM jsonb_array_elements(cfg('heures_creuses') ->
         CASE WHEN extract(isodow FROM p_jour) IN (6, 7) THEN 'weekend' ELSE 'semaine' END) p
$$;

CREATE OR REPLACE FUNCTION fidelite.est_heure_creuse(p_debut timestamptz) RETURNS boolean
LANGUAGE sql STABLE SET search_path = fidelite AS $$
    WITH l AS (SELECT p_debut AT TIME ZONE 'Europe/Paris' AS t)
    SELECT EXISTS (
        SELECT 1 FROM l, plages_hc(l.t::date) h
        WHERE extract(hour FROM l.t) * 60 + extract(minute FROM l.t) >= h.debut
          AND extract(hour FROM l.t) * 60 + extract(minute FROM l.t) < h.fin)
$$;

CREATE OR REPLACE FUNCTION fidelite.minutes_hc(p_jour date) RETURNS integer
LANGUAGE sql STABLE SET search_path = fidelite AS $$
    SELECT coalesce(sum(fin - debut), 0)::int FROM plages_hc(p_jour)
$$;

-- '09:00' → 9h, '22:30' → 22h30, '24:00' → 0h
CREATE OR REPLACE FUNCTION fidelite.heure_fr(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
    SELECT (split_part(p, ':', 1)::int % 24) || 'h' || coalesce(nullif(split_part(p, ':', 2), '00'), '')
$$;

-- « 9h–12h, 14h–17h, 22h30–0h » (+ le week-end s'il diffère).
CREATE OR REPLACE FUNCTION fidelite.texte_heures_creuses() RETURNS text
LANGUAGE sql STABLE SET search_path = fidelite AS $$
    WITH f AS (
        SELECT k, string_agg(heure_fr(p->>0) || '–' || heure_fr(p->>1), ', ' ORDER BY o) AS txt
        FROM (VALUES ('semaine'), ('weekend')) v(k),
             jsonb_array_elements(cfg('heures_creuses') -> k) WITH ORDINALITY e(p, o)
        GROUP BY k)
    SELECT CASE WHEN s.txt = w.txt THEN s.txt ELSE 'en semaine ' || s.txt || ' ; le week-end ' || w.txt END
    FROM f s, f w WHERE s.k = 'semaine' AND w.k = 'weekend'
$$;

CREATE OR REPLACE FUNCTION fidelite.date_fr(p date) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
    SELECT (ARRAY['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'])[extract(isodow FROM p)]
        || ' ' || extract(day FROM p)::int
        || CASE WHEN extract(day FROM p) = 1 THEN 'er' ELSE '' END || ' '
        || (ARRAY['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août',
                  'septembre', 'octobre', 'novembre', 'décembre'])[extract(month FROM p)]
$$;

-- Le jour est-il un jour de newsletter (ex. 1er mardi du mois) ?
CREATE OR REPLACE FUNCTION fidelite.est_jour_newsletter(p date) RETURNS boolean
LANGUAGE sql STABLE SET search_path = fidelite AS $$
    SELECT extract(isodow FROM p) = (cfg('newsletter')->>'jour_semaine')::int
       AND (extract(day FROM p)::int - 1) / 7 + 1 = (cfg('newsletter')->>'rang')::int
$$;

-- Tirage reproductible du groupe témoin.
CREATE OR REPLACE FUNCTION fidelite.groupe_de(p_personne text) RETURNS text
LANGUAGE sql STABLE SET search_path = fidelite AS $$
    SELECT CASE WHEN abs(hashtext(cfg_txt('sel_temoin') || ':' || p_personne)) % 100 < cfg_int('pourcentage_temoin')
                THEN 'temoin' ELSE 'cible' END
$$;

CREATE OR REPLACE FUNCTION fidelite.nouveau_code() RETURNS text
LANGUAGE plpgsql SET search_path = fidelite AS $$
DECLARE
    alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   -- sans 0/O, 1/I/L
    b bytea;
    c text;
BEGIN
    LOOP
        b := uuid_send(gen_random_uuid());
        c := 'RB-';
        FOR i IN 0..4 LOOP
            c := c || substr(alphabet, 1 + get_byte(b, i) % length(alphabet), 1);
        END LOOP;
        EXIT WHEN NOT EXISTS (SELECT 1 FROM cadeaux WHERE code = c);
    END LOOP;
    RETURN c;
END $$;

CREATE OR REPLACE FUNCTION fidelite.rendre(p_texte text, p_vars jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE r record; t text := p_texte;
BEGIN
    IF t IS NULL THEN RETURN NULL; END IF;
    FOR r IN SELECT key, value FROM jsonb_each_text(p_vars) LOOP
        t := replace(t, '{' || r.key || '}', coalesce(r.value, ''));
    END LOOP;
    RETURN regexp_replace(t, ' +,', ',', 'g');     -- « Salut , » quand le prénom manque
END $$;

-- ===================================================================== synchronisation

-- Recopie clients et parties depuis livex. Idempotente : les fiches sont mises à jour
-- (sans toucher aux consentements ni au jeton), les parties entièrement refaites.
CREATE OR REPLACE FUNCTION fidelite.synchroniser() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = fidelite, public AS $$
DECLARE n_clients integer; n_parties integer;
BEGIN
    INSERT INTO clients (id_client, personne, prenom, nom, email, telephone, cree_le, maj_le)
    SELECT DISTINCT ON (l.ref)
           l.ref, l.ref,
           nullif(initcap(lower(btrim(l.prenom))), ''),
           nullif(upper(btrim(l.nom)), ''),
           email_normalise(l.mail),
           tel_e164(l.telephone),
           CASE WHEN l.cree_le ~ '^\d{4}/\d{2}/\d{2}$' THEN to_date(l.cree_le, 'YYYY/MM/DD') END,
           now()
    FROM livex.livex_clients l
    WHERE l.ref ~ '^\d+$'
      AND NOT l.ref IN (SELECT jsonb_array_elements_text(cfg('clients_exclus')))
    ORDER BY l.ref, l._pk DESC
    ON CONFLICT (id_client) DO UPDATE SET
        prenom = EXCLUDED.prenom, nom = EXCLUDED.nom, email = EXCLUDED.email,
        telephone = EXCLUDED.telephone, cree_le = EXCLUDED.cree_le, maj_le = now();
    GET DIAGNOSTICS n_clients = ROW_COUNT;

    -- Dédoublonnage : même téléphone ou même e-mail → plus petite ref.
    WITH t AS (SELECT telephone, min(id_client::bigint) m FROM clients WHERE telephone IS NOT NULL GROUP BY 1),
         e AS (SELECT email, min(id_client::bigint) m FROM clients WHERE email IS NOT NULL GROUP BY 1),
         p AS (SELECT c.id_client, least(c.id_client::bigint, t.m, e.m)::text AS personne
               FROM clients c LEFT JOIN t USING (telephone) LEFT JOIN e USING (email))
    UPDATE clients c SET personne = p.personne
    FROM p WHERE p.id_client = c.id_client AND c.personne <> p.personne;

    DELETE FROM parties;
    INSERT INTO parties (id_resa, personne, id_client, ressource, sport, debut, fin, jour, hc)
    SELECT DISTINCT ON (r.id)
           r.id, c.personne, r.id_client, r.resource_id,
           CASE WHEN r.resource_id IN (SELECT jsonb_array_elements_text(cfg('ressources_padel'))) THEN 'padel' ELSE 'five' END,
           r.start::timestamp AT TIME ZONE 'Europe/Paris',
           r."end"::timestamp AT TIME ZONE 'Europe/Paris',
           r.start::timestamp::date,
           est_heure_creuse(r.start::timestamp AT TIME ZONE 'Europe/Paris')
    FROM livex.livex_reservations r
    JOIN clients c ON c.id_client = r.id_client
    WHERE r.type_resa = 'reservation'
      AND r.start ~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}' AND r."end" ~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}'
      AND r.resource_id IN (SELECT jsonb_array_elements_text(cfg('ressources_padel') || cfg('ressources_five')))
      AND coalesce(r.title, '') NOT ILIKE 'DIRECTION%'
    ORDER BY r.id, r._pk DESC;
    GET DIAGNOSTICS n_parties = ROW_COUNT;

    RETURN jsonb_build_object('clients', n_clients, 'parties', n_parties);
END $$;

-- ===================================================================== moteur

CREATE OR REPLACE FUNCTION fidelite.partie_a_venir(p_personne text, p_maintenant timestamptz) RETURNS boolean
LANGUAGE sql STABLE SET search_path = fidelite AS $$
    SELECT EXISTS (SELECT 1 FROM parties WHERE personne = p_personne AND sport = 'padel' AND debut > p_maintenant)
$$;

-- Plafond : aucun message (envoyé, à envoyer ou simulé) ni newsletter sur les
-- `plafond_jours` derniers jours. `p_annonce_de` = le rappel ne compte pas l'annonce
-- de sa propre offre (annonce + rappel = un seul envoi).
CREATE OR REPLACE FUNCTION fidelite.plafond_ok(p_personne text, p_maintenant timestamptz, p_annonce_de uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql STABLE SET search_path = fidelite AS $$
    WITH j AS (SELECT (p_maintenant AT TIME ZONE 'Europe/Paris')::date AS jour, cfg_int('plafond_jours') AS n)
    SELECT NOT EXISTS (
               SELECT 1 FROM messages m, j
               WHERE m.personne = p_personne
                 AND m.statut IN ('simule', 'a_envoyer', 'envoye')
                 AND (m.cree_le AT TIME ZONE 'Europe/Paris')::date > j.jour - j.n
                 AND NOT (p_annonce_de IS NOT NULL AND m.cadeau_id = p_annonce_de AND m.type IN ('annonce', 'retour')))
       AND NOT EXISTS (
               SELECT 1 FROM j, v_personnes p, generate_series(j.jour - j.n + 1, j.jour, interval '1 day') d
               WHERE p.personne = p_personne AND p.newsletter_ok AND est_jour_newsletter(d::date))
$$;

-- Ouvre une offre (et remplace celle en cours : une seule offre active).
CREATE OR REPLACE FUNCTION fidelite.ouvrir_cadeau(p_personne text, p_origine text, p_palier integer,
                                                  p_du date, p_au date, p_maintenant timestamptz)
RETURNS uuid
LANGUAGE plpgsql SET search_path = fidelite AS $$
DECLARE v_id uuid; v_libelle text; v_formule text; v_choix boolean;
BEGIN
    IF p_origine = 'grand_retour' THEN
        SELECT g->>'libelle', g->>'formule', (g->>'choix_requis')::boolean INTO v_libelle, v_formule, v_choix
        FROM (SELECT cfg('cadeau_grand_retour') g) x;
    ELSE
        SELECT libelle, formule, choix_requis INTO v_libelle, v_formule, v_choix
        FROM paliers WHERE sport = 'padel' AND rang = p_palier;
    END IF;
    IF v_libelle IS NULL THEN RETURN NULL; END IF;
    UPDATE cadeaux SET statut = 'remplace', motif = 'nouvelle offre'
    WHERE personne = p_personne AND statut = 'actif';
    INSERT INTO cadeaux (code, personne, origine, palier, libelle, formule, choix_requis, valable_du, expire_le, cree_le)
    VALUES (nouveau_code(), p_personne, p_origine, p_palier, v_libelle, v_formule, v_choix, p_du, p_au, p_maintenant)
    RETURNING id INTO v_id;
    RETURN v_id;
END $$;

-- Dépose un message dans le journal (simulé en dry-run). Ne fait rien s'il existe déjà.
CREATE OR REPLACE FUNCTION fidelite.deposer_message(p_personne text, p_type text, p_template text,
                                                    p_cadeau uuid, p_maintenant timestamptz)
RETURNS void
LANGUAGE plpgsql SET search_path = fidelite, public AS $$
DECLARE
    p record; c record; v_sujet text; v_corps text; pied text;
    v_jour date := (p_maintenant AT TIME ZONE 'Europe/Paris')::date;
    v_canal text; v_dest text; v_statut text; v_motif text; v_vars jsonb; v_reste integer;
BEGIN
    SELECT * INTO p FROM v_personnes WHERE personne = p_personne;
    SELECT * INTO c FROM cadeaux WHERE id = p_cadeau;

    -- Premier canal préféré pour ce type, branché, et pour lequel on a une coordonnée.
    SELECT k INTO v_canal
    FROM jsonb_array_elements_text(cfg('canaux_par_type') -> p_type) WITH ORDINALITY x(k, o)
    WHERE k IN (SELECT jsonb_array_elements_text(cfg('canaux_actifs')))
      AND CASE k WHEN 'email' THEN p.email ELSE p.telephone END IS NOT NULL
    ORDER BY o LIMIT 1;
    v_dest := CASE v_canal WHEN 'email' THEN p.email WHEN 'sms' THEN p.telephone END;

    IF NOT coalesce(p.relances_ok, false) THEN v_statut := 'bloque'; v_motif := 'désinscrit des relances';
    ELSIF v_canal IS NULL THEN v_statut := 'bloque'; v_motif := 'aucune coordonnée pour les canaux actifs';
    ELSIF cfg('dry_run') = 'true'::jsonb THEN v_statut := 'simule';
    ELSE v_statut := 'a_envoyer';
    END IF;

    IF v_canal IS NOT NULL THEN
        SELECT sujet, corps INTO v_sujet, v_corps FROM templates WHERE code = p_template AND canal = v_canal;
        SELECT corps INTO pied FROM templates WHERE code = 'pied' AND canal = v_canal;
        v_reste := c.expire_le - v_jour + 1;
        v_vars := jsonb_build_object(
            'prenom', coalesce(p.prenom, ''),
            'date_limite', date_fr(c.expire_le),
            'cadeau', c.formule,
            'code', c.code,
            'lien', cfg_txt('lien_reservation'),
            'lien_desinscription', site_url() || '/desinscription/?t=' || p.jeton,
            'heures_creuses', texte_heures_creuses(),
            'jours_restants', v_reste || CASE WHEN v_reste > 1 THEN ' jours' ELSE ' jour' END,
            'numero_stop', cfg_txt('numero_stop'));
    END IF;

    INSERT INTO messages (cle, personne, cadeau_id, type, canal, destinataire, sujet, corps, statut, motif, cree_le)
    VALUES (p_type || ':' || coalesce(p_cadeau::text, p_personne), p_personne, p_cadeau, p_type, v_canal, v_dest,
            rendre(v_sujet, v_vars),
            rendre(v_corps || CASE v_canal WHEN 'email' THEN E'\n\n' ELSE ' ' END || coalesce(pied, ''), v_vars),
            v_statut, v_motif, p_maintenant)
    ON CONFLICT (cle) DO NOTHING;
END $$;

-- Le moteur. À lancer une fois par jour (pg_cron) ; peut être relancé sans effet de bord.
-- `p_maintenant` permet de rejouer une date (tests, rattrapage).
CREATE OR REPLACE FUNCTION fidelite.calculer(p_maintenant timestamptz DEFAULT now()) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = fidelite, public AS $$
DECLARE
    v_jour        date := (p_maintenant AT TIME ZONE 'Europe/Paris')::date;
    v_lancement   date := nullif(cfg_txt('date_lancement'), '')::date;
    v_fenetre     integer := cfg_int('fenetre_jours');
    v_rattrapage  integer := cfg_int('rattrapage_jours');
    v_gr_jours    integer := cfg_int('grand_retour_jours');
    v_gr_validite integer := cfg_int('grand_retour_validite_jours');
    v_gr_interv   integer := cfg_int('grand_retour_intervalle_jours');
    v_fin         integer := (SELECT min(rang) FROM paliers WHERE sport = 'padel' AND fin);
    t record; p record; c record; g record;
    v_cadeau uuid;
    n jsonb := '{"entrees": 0, "retours": 0, "rattrapages": 0, "decroches": 0, "reguliers": 0, "grands_retours": 0}';
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('fidelite.calculer'));
    PERFORM synchroniser();

    -- 1. Entrées : 1re partie de padel jouée depuis le lancement, aucune réservation avant.
    IF v_lancement IS NOT NULL THEN
        INSERT INTO tunnel (personne, entre_le, premiere_partie, groupe, palier, derniere_partie, echeance)
        SELECT f.personne, p_maintenant, f.jour, groupe_de(f.personne), 1, f.jour, f.jour + v_fenetre
        FROM (SELECT personne, min(jour) AS jour FROM parties
              WHERE sport = 'padel' AND fin <= p_maintenant GROUP BY personne) f
        WHERE f.jour >= v_lancement
          AND NOT EXISTS (SELECT 1 FROM parties h WHERE h.personne = f.personne AND h.jour < v_lancement)
          AND NOT EXISTS (SELECT 1 FROM tunnel x WHERE x.personne = f.personne);
        FOR t IN SELECT * FROM tunnel WHERE entre_le = p_maintenant LOOP
            n := jsonb_set(n, '{entrees}', to_jsonb((n->>'entrees')::int + 1));
            IF t.groupe = 'cible' AND t.echeance >= v_jour THEN
                PERFORM ouvrir_cadeau(t.personne, 'palier', 1, t.premiere_partie + 1, t.echeance, p_maintenant);
            END IF;
        END LOOP;
    END IF;

    -- 2. Progression, partie par partie (une par jour).
    FOR t IN SELECT * FROM tunnel WHERE statut = 'actif' ORDER BY personne LOOP
        FOR p IN SELECT jour, bool_or(hc) AS hc FROM parties
                 WHERE personne = t.personne AND sport = 'padel' AND fin <= p_maintenant AND jour > t.derniere_partie
                 GROUP BY jour ORDER BY jour LOOP
            IF p.jour <= t.echeance THEN
                -- Revenu à temps : palier suivant. Le cadeau en cours a pu servir (le bar l'a
                -- marqué « utilisé ») ; sinon il est perdu, en heures pleines ou non réclamé.
                UPDATE cadeaux SET statut = CASE WHEN p.hc THEN 'expire' ELSE 'perdu_hp' END,
                                   motif = CASE WHEN p.hc THEN 'non réclamé au bar' ELSE 'retour en heures pleines' END
                WHERE personne = t.personne AND statut = 'actif' AND origine <> 'grand_retour';
                t.palier := t.palier + 1;
                n := jsonb_set(n, '{retours}', to_jsonb((n->>'retours')::int + 1));
                v_cadeau := NULL;
                IF t.palier >= v_fin THEN
                    t.statut := 'regulier';
                    n := jsonb_set(n, '{reguliers}', to_jsonb((n->>'reguliers')::int + 1));
                ELSIF t.groupe = 'cible' AND p.jour + v_fenetre >= v_jour THEN
                    v_cadeau := ouvrir_cadeau(t.personne, 'palier', t.palier, p.jour + 1, p.jour + v_fenetre, p_maintenant);
                END IF;
            ELSE
                -- Revenu après la fenêtre : le palier ne change pas, nouvelle fenêtre et
                -- même cadeau (nouveau code) à partir de cette partie.
                UPDATE cadeaux SET statut = 'expire', motif = 'fenêtre dépassée'
                WHERE personne = t.personne AND statut = 'actif' AND origine <> 'grand_retour';
                IF t.groupe = 'cible' AND p.jour + v_fenetre >= v_jour THEN
                    PERFORM ouvrir_cadeau(t.personne, 'retour', t.palier, p.jour + 1, p.jour + v_fenetre, p_maintenant);
                END IF;
            END IF;
            t.derniere_partie := p.jour;
            t.echeance := p.jour + v_fenetre;
            EXIT WHEN t.statut <> 'actif';
        END LOOP;

        -- Fenêtre écoulée sans partie à venir : rattrapage (une fois) puis décrochage.
        IF t.statut = 'actif' AND v_jour > t.echeance AND NOT partie_a_venir(t.personne, p_maintenant) THEN
            IF NOT t.rattrapage_utilise THEN
                IF v_jour >= t.derniere_partie + v_rattrapage
                   AND (t.groupe = 'temoin' OR plafond_ok(t.personne, p_maintenant)) THEN
                    t.rattrapage_utilise := true;
                    t.echeance := v_jour + v_fenetre - 1;
                    n := jsonb_set(n, '{rattrapages}', to_jsonb((n->>'rattrapages')::int + 1));
                    IF t.groupe = 'cible' THEN
                        v_cadeau := ouvrir_cadeau(t.personne, 'rattrapage', t.palier, v_jour, t.echeance, p_maintenant);
                        PERFORM deposer_message(t.personne, 'rattrapage', 'rattrapage', v_cadeau, p_maintenant);
                    END IF;
                END IF;
            ELSE
                t.statut := 'decroche';
                n := jsonb_set(n, '{decroches}', to_jsonb((n->>'decroches')::int + 1));
            END IF;
        END IF;

        UPDATE tunnel SET palier = t.palier, derniere_partie = t.derniere_partie, echeance = t.echeance,
                          rattrapage_utilise = t.rattrapage_utilise, statut = t.statut, maj_le = p_maintenant
        WHERE personne = t.personne;
    END LOOP;

    -- Offres arrivées à échéance.
    UPDATE cadeaux SET statut = 'expire', motif = 'date dépassée' WHERE statut = 'actif' AND expire_le < v_jour;

    -- 3. Annonce (J+1, toujours) : dès le lendemain de la partie, si le plafond le permet.
    FOR c IN SELECT * FROM cadeaux
             WHERE statut = 'actif' AND origine IN ('palier', 'retour') AND v_jour BETWEEN valable_du AND expire_le
               AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.cadeau_id = cadeaux.id AND m.type IN ('annonce', 'retour'))
             ORDER BY cree_le LOOP
        IF plafond_ok(c.personne, p_maintenant) THEN
            PERFORM deposer_message(c.personne, CASE c.origine WHEN 'palier' THEN 'annonce' ELSE 'retour' END,
                                    CASE c.origine WHEN 'palier' THEN 'annonce_' || c.palier ELSE 'retour' END,
                                    c.id, p_maintenant);
        END IF;
    END LOOP;

    -- 4. Rappel (J+5) : rien de réservé, au moins un jour devant soi, 3 jours après l'annonce.
    FOR c IN SELECT cadeaux.*, a.cree_le AS annonce_le FROM cadeaux
             JOIN messages a ON a.cadeau_id = cadeaux.id AND a.type IN ('annonce', 'retour')
                            AND a.statut IN ('simule', 'a_envoyer', 'envoye')
             WHERE cadeaux.statut = 'actif' AND origine IN ('palier', 'retour')
               AND v_jour >= valable_du + 4 AND v_jour < expire_le
               AND v_jour >= (a.cree_le AT TIME ZONE 'Europe/Paris')::date + 3
               AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.cadeau_id = cadeaux.id AND m.type = 'rappel') LOOP
        IF NOT partie_a_venir(c.personne, p_maintenant) AND plafond_ok(c.personne, p_maintenant, c.id) THEN
            PERFORM deposer_message(c.personne, 'rappel', 'rappel', c.id, p_maintenant);
        END IF;
    END LOOP;

    -- 5. Grand retour : sans partie de padel depuis 60 jours, une fois par an. Au plus
    -- `grand_retour_max_par_jour`, les plus récemment partis d'abord (au lancement,
    -- ~250 clients sont concernés : on étale plutôt que d'envoyer d'un coup).
    FOR g IN SELECT x.personne FROM (
                 SELECT personne, max(jour) AS derniere FROM parties
                 WHERE sport = 'padel' AND fin <= p_maintenant GROUP BY personne) x
             JOIN v_personnes vp ON vp.personne = x.personne
             WHERE x.derniere <= v_jour - v_gr_jours
               AND vp.relances_ok AND vp.email IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM tunnel WHERE personne = x.personne AND statut = 'actif')
               AND NOT EXISTS (SELECT 1 FROM cadeaux WHERE personne = x.personne AND origine = 'grand_retour'
                               AND cree_le > p_maintenant - make_interval(days => v_gr_interv))
             ORDER BY x.derniere DESC, x.personne LOOP
        EXIT WHEN (n->>'grands_retours')::int >= cfg_int('grand_retour_max_par_jour');
        IF groupe_de(g.personne) = 'cible' AND NOT partie_a_venir(g.personne, p_maintenant)
           AND plafond_ok(g.personne, p_maintenant) THEN
            v_cadeau := ouvrir_cadeau(g.personne, 'grand_retour', NULL, v_jour, v_jour + v_gr_validite - 1, p_maintenant);
            PERFORM deposer_message(g.personne, 'grand_retour', 'grand_retour', v_cadeau, p_maintenant);
            n := jsonb_set(n, '{grands_retours}', to_jsonb((n->>'grands_retours')::int + 1));
        END IF;
    END LOOP;

    RETURN n || jsonb_build_object('jour', v_jour, 'dry_run', cfg('dry_run'),
        'messages_du_jour', (SELECT count(*) FROM messages WHERE cree_le = p_maintenant));
END $$;

-- Repart de zéro (fin du dry-run, ou nouveau dry-run) : efface le tunnel, les offres et les
-- messages simulés, fixe la date de lancement. Refusé dès qu'un vrai message existe.
CREATE OR REPLACE FUNCTION fidelite.reinitialiser(p_lancement date, p_reel boolean) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = fidelite AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM messages WHERE statut IN ('a_envoyer', 'envoye', 'echec')) THEN
        RAISE EXCEPTION 'des messages réels existent déjà : réinitialisation refusée';
    END IF;
    DELETE FROM messages;
    DELETE FROM cadeaux;
    DELETE FROM tunnel;
    UPDATE config SET valeur = to_jsonb(p_lancement::text) WHERE cle = 'date_lancement';
    UPDATE config SET valeur = to_jsonb(NOT p_reel) WHERE cle = 'dry_run';
    RETURN CASE WHEN p_reel THEN 'envoi réel' ELSE 'dry-run' END || ', lancement le ' || p_lancement;
END $$;

-- Envoi autorisé maintenant ? (10h–19h, pas de SMS le dimanche, jamais en dry-run)
CREATE OR REPLACE FUNCTION fidelite.envoi_autorise(p_canal text, p_maintenant timestamptz DEFAULT now()) RETURNS boolean
LANGUAGE sql STABLE SET search_path = fidelite AS $$
    WITH l AS (SELECT p_maintenant AT TIME ZONE 'Europe/Paris' AS t)
    SELECT cfg('dry_run') = 'false'::jsonb
       AND extract(hour FROM l.t) >= cfg_int('envoi_heure_debut')
       AND extract(hour FROM l.t) < cfg_int('envoi_heure_fin')
       AND NOT (p_canal = 'sms' AND extract(isodow FROM l.t) = 7)
    FROM l
$$;

-- ===================================================================== suivi

CREATE OR REPLACE VIEW fidelite.v_suivi_paliers AS
SELECT t.groupe,
       count(*)                                        AS entres,
       count(*) FILTER (WHERE palier >= 2)             AS palier_2,
       count(*) FILTER (WHERE palier >= 3)             AS palier_3,
       count(*) FILTER (WHERE palier >= 4)             AS palier_4,
       count(*) FILTER (WHERE statut = 'regulier')     AS reguliers,
       count(*) FILTER (WHERE statut = 'decroche')     AS decroches,
       count(*) FILTER (WHERE statut = 'actif')        AS actifs,
       round(100.0 * count(*) FILTER (WHERE palier >= 2) / nullif(count(*), 0), 1) AS pct_2e_partie,
       -- Comparaison témoin : parties de padel jouées dans les 30 jours après la 1re.
       round(avg((SELECT count(DISTINCT jour) FROM fidelite.parties p
                  WHERE p.personne = t.personne AND p.sport = 'padel'
                    AND p.jour > t.premiere_partie AND p.jour <= t.premiere_partie + 30
                    AND p.fin <= now())), 2) AS parties_30j_moy
FROM fidelite.tunnel t
GROUP BY t.groupe;

CREATE OR REPLACE VIEW fidelite.v_suivi_cadeaux AS
SELECT origine, palier, libelle,
       count(*)                                     AS crees,
       count(*) FILTER (WHERE statut = 'utilise')   AS utilises,
       count(*) FILTER (WHERE statut = 'actif')     AS actifs,
       count(*) FILTER (WHERE statut = 'expire')    AS expires,
       count(*) FILTER (WHERE statut = 'perdu_hp')  AS perdus_hp,
       count(*) FILTER (WHERE statut = 'remplace')  AS remplaces,
       round(100.0 * count(*) FILTER (WHERE statut = 'utilise')
             / nullif(count(*) FILTER (WHERE statut <> 'actif'), 0), 1) AS pct_utilises
FROM fidelite.cadeaux
GROUP BY origine, palier, libelle;

-- Remplissage des heures creuses du padel, par semaine (12 dernières), par demi-heure.
CREATE OR REPLACE VIEW fidelite.v_suivi_heures_creuses AS
WITH s AS (
    SELECT date_trunc('week', p.jour)::date AS semaine, fidelite.est_heure_creuse(d) AS hc
    FROM fidelite.parties p,
         generate_series(p.debut, p.fin - interval '30 minutes', interval '30 minutes') d
    WHERE p.sport = 'padel' AND p.jour >= current_date - 84 AND p.jour <= current_date),
cap AS (
    SELECT date_trunc('week', d)::date AS semaine,
           sum(fidelite.minutes_hc(d::date)) / 60.0
               * jsonb_array_length(fidelite.cfg('ressources_padel')) AS heures_hc_dispo
    FROM generate_series(current_date - 84, current_date, interval '1 day') d
    GROUP BY 1)
SELECT cap.semaine,
       round(coalesce(count(*) FILTER (WHERE s.hc), 0) / 2.0, 1)     AS heures_hc_reservees,
       round(cap.heures_hc_dispo, 1)                                  AS heures_hc_dispo,
       round(100.0 * coalesce(count(*) FILTER (WHERE s.hc), 0) / 2.0 / nullif(cap.heures_hc_dispo, 0), 1) AS pct_hc,
       round(coalesce(count(*) FILTER (WHERE NOT s.hc), 0) / 2.0, 1) AS heures_hp_reservees
FROM cap LEFT JOIN s USING (semaine)
GROUP BY cap.semaine, cap.heures_hc_dispo
ORDER BY cap.semaine;

-- ===================================================================== accès depuis le site

-- Page bar : recherche par nom, téléphone ou code → offre active.
CREATE OR REPLACE FUNCTION public.fidelite_bar_recherche(p_q text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = fidelite, public AS $$
DECLARE
    q text := btrim(coalesce(p_q, ''));
    chiffres text := regexp_replace(q, '\D', '', 'g');
    v_jour date := (fidelite.maintenant() AT TIME ZONE 'Europe/Paris')::date;
BEGIN
    IF NOT public.est_staff() THEN RAISE EXCEPTION 'réservé au staff' USING ERRCODE = '42501'; END IF;
    IF length(q) < 2 THEN RETURN '[]'::jsonb; END IF;
    RETURN coalesce((
        SELECT jsonb_agg(r ORDER BY r->>'nom', r->>'prenom') FROM (
            SELECT jsonb_build_object(
                'personne', vp.personne, 'prenom', vp.prenom, 'nom', vp.nom,
                'telephone', CASE WHEN vp.telephone LIKE '+33%' THEN '0' || substr(vp.telephone, 4) ELSE vp.telephone END,
                'tunnel', CASE WHEN t.personne IS NULL THEN NULL
                               ELSE jsonb_build_object('statut', t.statut, 'palier', t.palier, 'groupe', t.groupe) END,
                'cadeau', (SELECT jsonb_build_object(
                               'id', c.id, 'code', c.code, 'libelle', c.libelle, 'origine', c.origine,
                               'choix_requis', c.choix_requis, 'valable_du', c.valable_du, 'expire_le', c.expire_le,
                               'pas_encore_valable', v_jour < c.valable_du)
                           FROM cadeaux c WHERE c.personne = vp.personne AND c.statut = 'actif'),
                'dernier_utilise', (SELECT jsonb_build_object('libelle', c.libelle, 'le', c.utilise_le, 'par', c.utilise_par, 'choix', c.choix)
                                    FROM cadeaux c WHERE c.personne = vp.personne AND c.statut = 'utilise'
                                    ORDER BY c.utilise_le DESC LIMIT 1)) AS r
            FROM v_personnes vp
            LEFT JOIN tunnel t ON t.personne = vp.personne
            WHERE (length(chiffres) >= 4 AND ('0' || substr(coalesce(vp.telephone, ''), 4)) LIKE '%' || chiffres || '%')
               OR (length(chiffres) < 4 AND (
                       public.normaliser_identite(coalesce(vp.prenom, '') || ' ' || coalesce(vp.nom, '')) LIKE '%' || public.normaliser_identite(q) || '%'
                    OR public.normaliser_identite(coalesce(vp.nom, '') || ' ' || coalesce(vp.prenom, '')) LIKE '%' || public.normaliser_identite(q) || '%'))
               OR EXISTS (SELECT 1 FROM cadeaux c WHERE c.personne = vp.personne AND c.code = upper(q))
            LIMIT 20) x), '[]'::jsonb);
END $$;

-- Infos affichées en tête de la page bar.
CREATE OR REPLACE FUNCTION public.fidelite_bar_contexte() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = fidelite, public AS $$
BEGIN
    IF NOT public.est_staff() THEN RAISE EXCEPTION 'réservé au staff' USING ERRCODE = '42501'; END IF;
    RETURN jsonb_build_object('heures_creuses', texte_heures_creuses(),
                              'maintenant_hc', est_heure_creuse(fidelite.maintenant()),
                              'dry_run', cfg('dry_run'));
END $$;

CREATE OR REPLACE FUNCTION public.fidelite_bar_utiliser(p_cadeau uuid, p_choix text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = fidelite, public AS $$
DECLARE c record; v_jour date := (fidelite.maintenant() AT TIME ZONE 'Europe/Paris')::date;
BEGIN
    IF NOT public.est_staff() THEN RAISE EXCEPTION 'réservé au staff' USING ERRCODE = '42501'; END IF;
    SELECT * INTO c FROM cadeaux WHERE id = p_cadeau FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cadeau introuvable.'; END IF;
    IF c.statut <> 'actif' THEN RAISE EXCEPTION 'Ce cadeau n''est plus utilisable (%).', c.statut; END IF;
    IF v_jour < c.valable_du THEN RAISE EXCEPTION 'Ce cadeau est valable à partir du %.', date_fr(c.valable_du); END IF;
    IF v_jour > c.expire_le THEN RAISE EXCEPTION 'Ce cadeau a expiré le %.', date_fr(c.expire_le); END IF;
    IF c.choix_requis AND coalesce(p_choix, '') NOT IN ('pizza', 'planche') THEN
        RAISE EXCEPTION 'Indique le choix : pizza ou planche.';
    END IF;
    UPDATE cadeaux SET statut = 'utilise', utilise_le = fidelite.maintenant(), choix = CASE WHEN c.choix_requis THEN p_choix END,
                       utilise_par = (SELECT email FROM public.staff WHERE user_id = auth.uid())
    WHERE id = p_cadeau;
    RETURN jsonb_build_object('ok', true, 'libelle', c.libelle, 'code', c.code);
END $$;

-- Désinscription / préférences, par le jeton du lien des e-mails (sans compte).
CREATE OR REPLACE FUNCTION public.fidelite_preferences(p_jeton uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = fidelite, public AS $$
    SELECT jsonb_build_object('prenom', vp.prenom, 'relances', vp.relances_ok, 'newsletter', vp.newsletter_ok)
    FROM clients c JOIN v_personnes vp ON vp.personne = c.personne
    WHERE c.jeton = p_jeton
$$;

CREATE OR REPLACE FUNCTION public.fidelite_consentement(p_jeton uuid, p_relances boolean DEFAULT NULL,
                                                        p_newsletter boolean DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = fidelite, public AS $$
DECLARE v_personne text;
BEGIN
    SELECT personne INTO v_personne FROM clients WHERE jeton = p_jeton;
    IF v_personne IS NULL THEN RAISE EXCEPTION 'Lien invalide.'; END IF;
    IF p_relances IS NOT NULL THEN
        UPDATE clients SET relances_ok = p_relances WHERE personne = v_personne;
        INSERT INTO consentements (personne, type, valeur, source) VALUES (v_personne, 'relances', p_relances, 'lien_email');
    END IF;
    IF p_newsletter IS NOT NULL THEN
        UPDATE clients SET newsletter_ok = p_newsletter WHERE personne = v_personne;
        INSERT INTO consentements (personne, type, valeur, source) VALUES (v_personne, 'newsletter', p_newsletter, 'lien_email');
    END IF;
    RETURN public.fidelite_preferences(p_jeton);
END $$;

-- Tableau de suivi (staff) : indicateurs + derniers messages (relecture du dry-run).
CREATE OR REPLACE FUNCTION public.fidelite_tableau() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = fidelite, public AS $$
BEGIN
    IF NOT public.est_staff() THEN RAISE EXCEPTION 'réservé au staff' USING ERRCODE = '42501'; END IF;
    RETURN jsonb_build_object(
        'config', (SELECT jsonb_object_agg(cle, valeur) FROM config
                   WHERE cle IN ('dry_run', 'date_lancement', 'pourcentage_temoin', 'canaux_actifs')),
        'paliers', (SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY groupe), '[]') FROM v_suivi_paliers v),
        'cadeaux', (SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY origine, palier), '[]') FROM v_suivi_cadeaux v),
        'heures_creuses', (SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY semaine), '[]') FROM v_suivi_heures_creuses v),
        'inscrits_newsletter', (SELECT count(*) FROM v_personnes WHERE newsletter_ok),
        'messages', (SELECT coalesce(jsonb_agg(x ORDER BY x->>'cree_le' DESC), '[]') FROM (
            SELECT jsonb_build_object('cree_le', m.cree_le, 'type', m.type, 'statut', m.statut, 'motif', m.motif,
                                      'canal', m.canal, 'destinataire', m.destinataire, 'sujet', m.sujet,
                                      'corps', m.corps, 'prenom', vp.prenom, 'nom', vp.nom) AS x
            FROM messages m LEFT JOIN v_personnes vp ON vp.personne = m.personne
            ORDER BY m.cree_le DESC LIMIT 300) y));
END $$;

REVOKE ALL ON FUNCTION public.fidelite_bar_recherche(text), public.fidelite_bar_contexte(),
    public.fidelite_bar_utiliser(uuid, text), public.fidelite_tableau(),
    public.fidelite_preferences(uuid), public.fidelite_consentement(uuid, boolean, boolean) FROM PUBLIC;
-- Supabase accorde par défaut l'exécution des fonctions de `public` à anon : on la retire
-- aux fonctions du staff (qui vérifient aussi est_staff()).
REVOKE EXECUTE ON FUNCTION public.fidelite_bar_recherche(text), public.fidelite_bar_contexte(),
    public.fidelite_bar_utiliser(uuid, text), public.fidelite_tableau() FROM anon;
GRANT EXECUTE ON FUNCTION public.fidelite_bar_recherche(text), public.fidelite_bar_contexte(),
    public.fidelite_bar_utiliser(uuid, text), public.fidelite_tableau() TO authenticated;
GRANT EXECUTE ON FUNCTION public.fidelite_preferences(uuid), public.fidelite_consentement(uuid, boolean, boolean)
    TO anon, authenticated;

-- ===================================================================== planification

-- Calcul quotidien. pg_cron est en UTC : 8 h et 9 h UTC couvrent 10 h à Paris été comme
-- hiver ; le second passage ne produit rien de nouveau (messages à clé unique). Les
-- messages créés avant 10 h attendent : n8n n'envoie qu'entre 10 h et 19 h.
DO $$
BEGIN
    PERFORM cron.unschedule('fidelite-calcul') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fidelite-calcul');
END $$;
SELECT cron.schedule('fidelite-calcul', '0 8,9 * * *', $cron$ SELECT fidelite.calculer() $cron$);
