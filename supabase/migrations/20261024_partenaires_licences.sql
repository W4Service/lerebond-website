-- Recherche de partenaire et demandes de licence.
--
-- 1. Recherche de partenaire : un joueur sans binôme se signale sur un tournoi. Les
--    autres voient son prénom, l'initiale de son nom, son classement et son message
--    (jamais ses coordonnées). « Proposer de jouer ensemble » lui envoie les
--    coordonnées de celui qui propose ; ils s'inscrivent ensuite normalement.
--    Dès qu'il est inscrit au tournoi, sa recherche se ferme toute seule.
-- 2. Demande de licence : formulaire en ligne ; le club recontacte le joueur pour le
--    règlement et crée la licence sur Ten'Up. Données réservées au staff.

-- ===================================================================== 1. partenaires

CREATE TABLE IF NOT EXISTS recherches_partenaire (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tournoi_id uuid NOT NULL REFERENCES tournois(id) ON DELETE CASCADE,
    joueur_id  uuid NOT NULL REFERENCES joueurs(id) ON DELETE CASCADE,
    message    text,
    statut     text NOT NULL DEFAULT 'active' CHECK (statut IN ('active', 'trouve', 'retiree')),
    cree_le    timestamptz NOT NULL DEFAULT now(),
    maj_le     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_recherche_active
    ON recherches_partenaire (tournoi_id, joueur_id) WHERE statut = 'active';

CREATE TABLE IF NOT EXISTS propositions_partenaire (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    recherche_id uuid NOT NULL REFERENCES recherches_partenaire(id) ON DELETE CASCADE,
    joueur_id    uuid NOT NULL REFERENCES joueurs(id) ON DELETE CASCADE,
    message      text,
    cree_le      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE recherches_partenaire   ENABLE ROW LEVEL SECURITY;
ALTER TABLE propositions_partenaire ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['recherches_partenaire', 'propositions_partenaire'] LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_staff', t);
        EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO authenticated USING (est_staff()) WITH CHECK (est_staff())', t || '_staff', t);
    END LOOP;
END $$;

-- Liste publique : prénom + initiale, classement, message. Pas de coordonnées.
CREATE OR REPLACE FUNCTION partenaires_recherches(p_tournoi uuid)
RETURNS TABLE (id uuid, prenom text, initiale text, genre char(1), fft_rang integer, fft_club text, message text, depuis timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT r.id, j.prenom, upper(left(j.nom, 1)) || '.', j.genre, j.fft_rang, j.fft_club, r.message, r.cree_le
    FROM recherches_partenaire r
    JOIN joueurs j ON j.id = r.joueur_id
    JOIN tournois t ON t.id = r.tournoi_id
    WHERE r.tournoi_id = p_tournoi AND r.statut = 'active' AND t.publie AND t.status = 'planifie'
    ORDER BY r.cree_le
$$;

CREATE OR REPLACE FUNCTION nb_recherches_partenaire(p_tournoi uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT count(*)::integer FROM recherches_partenaire WHERE tournoi_id = p_tournoi AND statut = 'active'
$$;

-- Se signaler comme cherchant un partenaire. p_joueur : {nom, prenom, email, telephone, id_crm, genre}.
CREATE OR REPLACE FUNCTION chercher_partenaire(p_tournoi uuid, p_joueur jsonb, p_message text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE t record; v_j uuid; v_id uuid; motif text; r record;
BEGIN
    SELECT * INTO t FROM tournois WHERE id = p_tournoi;
    IF NOT FOUND OR NOT t.publie OR t.status <> 'planifie' OR t.date < current_date THEN
        RAISE EXCEPTION 'Ce tournoi n''est pas ouvert' USING ERRCODE = '22023';
    END IF;
    IF nullif(trim(p_joueur->>'email'), '') IS NULL OR nullif(trim(p_joueur->>'telephone'), '') IS NULL THEN
        RAISE EXCEPTION 'E-mail et téléphone obligatoires : c''est par là qu''on vous transmet les propositions' USING ERRCODE = '22023';
    END IF;
    v_j := joueur_pour_inscription(p_joueur);
    IF EXISTS (SELECT 1 FROM inscriptions i WHERE i.tournoi_id = p_tournoi AND i.statut IN ('inscrite', 'liste_attente')
               AND v_j IN (i.joueur1_id, i.joueur2_id)) THEN
        RAISE EXCEPTION 'Vous êtes déjà inscrit·e à ce tournoi' USING ERRCODE = '23505';
    END IF;
    IF t.homologue THEN
        SELECT fft_rang AS rang, genre INTO r FROM joueurs WHERE id = v_j;
        motif := fft_motif_inegibilite(t.categorie, t.genre, r.rang, coalesce(r.genre, p_joueur->>'genre'));
        IF motif IS NOT NULL THEN RAISE EXCEPTION '%', motif USING ERRCODE = '22023'; END IF;
    END IF;
    INSERT INTO recherches_partenaire (tournoi_id, joueur_id, message)
    VALUES (p_tournoi, v_j, nullif(left(trim(p_message), 300), ''))
    ON CONFLICT (tournoi_id, joueur_id) WHERE statut = 'active'
    DO UPDATE SET message = EXCLUDED.message, maj_le = now()
    RETURNING id INTO v_id;
    PERFORM notifier(v_j, 'partenaire', 'Recherche de partenaire enregistrée',
        'Vous apparaissez dans la liste des joueurs qui cherchent un partenaire pour le ' || libelle_tournoi(p_tournoi)
        || '. Vous serez prévenu·e dès qu''un joueur vous propose de jouer ensemble.', NULL);
    RETURN jsonb_build_object('recherche', v_id,
        'lien', site_url() || '/espace-joueur/?j=' || (SELECT jeton FROM joueurs_contacts WHERE joueur_id = v_j));
END;
$$;

-- Proposer de jouer avec quelqu'un : ses coordonnées vous sont transmises… et inversement.
CREATE OR REPLACE FUNCTION proposer_partenaire(p_recherche uuid, p_joueur jsonb, p_message text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE r record; v_j uuid; c record; texte text; email_p text;
BEGIN
    SELECT * INTO r FROM recherches_partenaire WHERE id = p_recherche AND statut = 'active';
    IF NOT FOUND THEN RAISE EXCEPTION 'Cette recherche n''est plus active' USING ERRCODE = '22023'; END IF;
    IF nullif(trim(p_joueur->>'email'), '') IS NULL OR nullif(trim(p_joueur->>'telephone'), '') IS NULL THEN
        RAISE EXCEPTION 'E-mail et téléphone obligatoires : ils sont transmis au joueur pour qu''il vous recontacte' USING ERRCODE = '22023';
    END IF;
    email_p := lower(trim(p_joueur->>'email'));
    -- Anti-abus : au plus 5 propositions par quart d'heure pour une même adresse.
    IF (SELECT count(*) FROM propositions_partenaire p JOIN joueurs_contacts k ON k.joueur_id = p.joueur_id
        WHERE lower(k.email) = email_p AND p.cree_le > now() - interval '15 minutes') >= 5 THEN
        RAISE EXCEPTION 'Trop de propositions d''un coup : réessayez dans quelques minutes' USING ERRCODE = '54000';
    END IF;
    v_j := joueur_pour_inscription(p_joueur);
    IF v_j = r.joueur_id THEN RAISE EXCEPTION 'C''est votre propre recherche' USING ERRCODE = '22023'; END IF;
    INSERT INTO propositions_partenaire (recherche_id, joueur_id, message)
    VALUES (p_recherche, v_j, nullif(left(trim(p_message), 300), ''));
    SELECT * INTO c FROM joueurs_contacts WHERE joueur_id = v_j;
    texte := nom_joueur(v_j)
        || coalesce(' (' || (SELECT to_char(fft_rang, 'FM999999') || 'e FFT' FROM joueurs WHERE id = v_j AND fft_rang IS NOT NULL) || ')', ' (non classé·e)')
        || ' propose de jouer avec vous au ' || libelle_tournoi(r.tournoi_id) || '.'
        || coalesce(E'\nSon message : ' || nullif(trim(p_message), ''), '')
        || E'\nContactez-le/la : ' || coalesce(c.telephone, '') || ' · ' || coalesce(c.email, '')
        || E'\nPuis inscrivez votre paire : ' || site_url() || '/tournois/inscription/?t=' || r.tournoi_id;
    PERFORM notifier(r.joueur_id, 'partenaire', 'Un joueur vous propose de jouer ensemble', texte, NULL);
    PERFORM notifier(v_j, 'partenaire', 'Proposition envoyée',
        'Votre proposition a été transmise à ' || nom_joueur(r.joueur_id) || ' pour le ' || libelle_tournoi(r.tournoi_id)
        || '. Il/elle a reçu vos coordonnées et va vous recontacter.', NULL);
END;
$$;

-- Retirer sa recherche depuis l'espace joueur.
CREATE OR REPLACE FUNCTION retirer_recherche(p_jeton uuid, p_recherche uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE recherches_partenaire r SET statut = 'retiree', maj_le = now()
    FROM joueurs_contacts c
    WHERE r.id = p_recherche AND c.jeton = p_jeton AND c.joueur_id = r.joueur_id AND r.statut = 'active';
    IF NOT FOUND THEN RAISE EXCEPTION 'Lien invalide pour cette recherche' USING ERRCODE = '42501'; END IF;
END;
$$;

-- Inscrit au tournoi = partenaire trouvé : la recherche se ferme.
CREATE OR REPLACE FUNCTION fermer_recherches_inscrits()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE recherches_partenaire SET statut = 'trouve', maj_le = now()
    WHERE tournoi_id = NEW.tournoi_id AND statut = 'active' AND joueur_id IN (NEW.joueur1_id, NEW.joueur2_id);
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_inscriptions_ferme_recherches ON inscriptions;
CREATE TRIGGER trg_inscriptions_ferme_recherches AFTER INSERT ON inscriptions
    FOR EACH ROW EXECUTE FUNCTION fermer_recherches_inscrits();

-- ===================================================================== 2. licences

CREATE TABLE IF NOT EXISTS demandes_licence (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    prenom          text NOT NULL,
    nom             text NOT NULL,
    sexe            char(1) NOT NULL CHECK (sexe IN ('H', 'F')),
    date_naissance  date NOT NULL,
    nationalite     text,
    email           text NOT NULL,
    telephone       text NOT NULL,
    adresse         text,
    code_postal     text,
    ville           text,
    message         text,
    statut          text NOT NULL DEFAULT 'nouvelle' CHECK (statut IN ('nouvelle', 'traitee', 'annulee')),
    cree_le         timestamptz NOT NULL DEFAULT now(),
    traitee_le      timestamptz
);
ALTER TABLE demandes_licence ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS demandes_licence_staff ON demandes_licence;
CREATE POLICY demandes_licence_staff ON demandes_licence FOR ALL TO authenticated USING (est_staff()) WITH CHECK (est_staff());

CREATE OR REPLACE FUNCTION demander_licence(p jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; naissance date;
BEGIN
    IF nullif(trim(p->>'prenom'), '') IS NULL OR nullif(trim(p->>'nom'), '') IS NULL
       OR nullif(trim(p->>'email'), '') IS NULL OR nullif(trim(p->>'telephone'), '') IS NULL
       OR p->>'sexe' NOT IN ('H', 'F') OR nullif(p->>'date_naissance', '') IS NULL THEN
        RAISE EXCEPTION 'Prénom, nom, sexe, date de naissance, e-mail et téléphone sont obligatoires' USING ERRCODE = '22023';
    END IF;
    naissance := (p->>'date_naissance')::date;
    IF naissance > current_date - interval '5 years' OR naissance < date '1920-01-01' THEN
        RAISE EXCEPTION 'Date de naissance invalide' USING ERRCODE = '22023';
    END IF;
    -- Anti-abus : une demande par adresse et par heure.
    IF EXISTS (SELECT 1 FROM demandes_licence WHERE lower(email) = lower(trim(p->>'email')) AND cree_le > now() - interval '1 hour') THEN
        RAISE EXCEPTION 'Une demande a déjà été envoyée avec cette adresse : le club vous recontacte' USING ERRCODE = '54000';
    END IF;
    INSERT INTO demandes_licence (prenom, nom, sexe, date_naissance, nationalite, email, telephone, adresse, code_postal, ville, message)
    VALUES (trim(p->>'prenom'), trim(p->>'nom'), p->>'sexe', naissance, nullif(trim(p->>'nationalite'), ''),
            lower(trim(p->>'email')), trim(p->>'telephone'), nullif(trim(p->>'adresse'), ''),
            nullif(trim(p->>'code_postal'), ''), nullif(trim(p->>'ville'), ''), nullif(left(trim(p->>'message'), 500), ''))
    RETURNING id INTO v_id;
    INSERT INTO notifications (canal, destinataire, sujet, corps, type)
    VALUES ('email', lower(trim(p->>'email')), 'Votre demande de licence FFT',
            'Bonjour ' || trim(p->>'prenom') || E',\n\nNous avons bien reçu votre demande de licence FFT. '
            || E'Le club vous recontacte rapidement pour le règlement et la création de votre licence sur Ten''Up.\n\nLe Rebond — 09 60 35 42 05',
            'licence');
    PERFORM alerter_staff('Demande de licence — ' || trim(p->>'prenom') || ' ' || trim(p->>'nom'),
        trim(p->>'prenom') || ' ' || trim(p->>'nom') || ' (' || to_char(naissance, 'DD/MM/YYYY') || ') demande une licence FFT. '
        || 'Contact : ' || trim(p->>'telephone') || ' · ' || lower(trim(p->>'email')), NULL);
END;
$$;

-- ===================================================================== droits
REVOKE ALL ON FUNCTION fermer_recherches_inscrits() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION partenaires_recherches(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION nb_recherches_partenaire(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION chercher_partenaire(uuid, jsonb, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION proposer_partenaire(uuid, jsonb, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION retirer_recherche(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION demander_licence(jsonb) TO anon, authenticated;

-- ===================================================================== espace joueur
-- Ajoute « mes recherches de partenaire » à l'espace joueur (fonction enveloppe pour ne
-- pas réécrire espace_joueur).
CREATE OR REPLACE FUNCTION espace_joueur_recherches(p_jeton uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'tournoi', t.nom, 'tournoi_id', t.id, 'date', t.date,
               'message', r.message, 'propositions', (SELECT count(*) FROM propositions_partenaire p WHERE p.recherche_id = r.id))
           ORDER BY t.date), '[]'::jsonb)
    FROM recherches_partenaire r JOIN tournois t ON t.id = r.tournoi_id
    JOIN joueurs_contacts c ON c.joueur_id = r.joueur_id
    WHERE c.jeton = p_jeton AND r.statut = 'active' AND t.date >= current_date
$$;
GRANT EXECUTE ON FUNCTION espace_joueur_recherches(uuid) TO anon, authenticated;

-- ===================================================================== calendrier
-- Nombre de joueurs qui cherchent un partenaire (colonne ajoutée en fin de vue).
CREATE OR REPLACE VIEW tournois_calendrier WITH (security_invoker = true) AS
SELECT
    t.id, t.nom, t.date, t.heure_debut, t.heure_fin, t.categorie, t.genre, t.homologue, t.nb_equipes_max,
    GREATEST(t.nb_inscrits, COALESCE(e.nb, 0))::integer AS inscrits,
    (t.nb_equipes_max IS NOT NULL AND GREATEST(t.nb_inscrits, COALESCE(e.nb, 0)) >= t.nb_equipes_max) AS complet,
    nb_liste_attente(t.id) AS liste_attente,
    (t.inscription_en_ligne AND NOT t.inscriptions_fermees AND t.status = 'planifie'
        AND (t.date_limite_inscription IS NULL OR now() <= t.date_limite_inscription)) AS inscription_ouverte,
    t.prix_par_joueur, t.description, t.lien_inscription, t.juge_arbitre, t.status,
    nb_recherches_partenaire(t.id) AS cherchent_partenaire
FROM tournois t
LEFT JOIN (SELECT tournoi_id, count(*) AS nb FROM equipes GROUP BY tournoi_id) e ON e.tournoi_id = t.id
WHERE t.publie AND t.status IN ('planifie', 'actif', 'cloture') AND t.date IS NOT NULL;
GRANT SELECT ON tournois_calendrier TO anon, authenticated;
