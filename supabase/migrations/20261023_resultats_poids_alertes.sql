-- Résultats et podiums, poids des non classés, alertes pour le staff.
--
-- 1. Résultats : la place finale de chaque paire est enregistrée à la clôture
--    (equipes.place_finale) ; le site affiche podiums et classements, l'espace
--    joueur ses places et ses points FFT.
-- 2. Poids d'une paire (Guide de la compétition, chapitre II) :
--    - un joueur non classé compte comme « dernier classé + nombre d'ex aequo à ce
--      rang + 1 » (exemple officiel : 25 joueurs au 13 000e rang → NC = 13 026) ;
--    - une joueuse dans un tableau messieurs compte avec son équivalent masculin
--      (sinon une 50e dame pèserait comme un 50e homme et deviendrait tête de série).
-- 3. Alertes staff : un e-mail au club à chaque inscription, désinscription par un
--    joueur, ou absence annoncée après une convocation.

-- ===================================================================== 1. résultats

ALTER TABLE equipes  ADD COLUMN IF NOT EXISTS place_finale integer;
ALTER TABLE tournois ADD COLUMN IF NOT EXISTS resultats_le timestamptz;
ALTER TABLE equipes DROP CONSTRAINT IF EXISTS equipes_place_finale_check;
ALTER TABLE equipes ADD CONSTRAINT equipes_place_finale_check CHECK (place_finale IS NULL OR place_finale > 0);

-- ===================================================================== 2. poids

-- Rang attribué à un non classé, par mois et par genre (calculé par l'Edge Function
-- fft-verification à partir du dernier classé publié sur Ten'Up).
CREATE TABLE IF NOT EXISTS fft_nc (
    mois     date    NOT NULL,
    genre    char(1) NOT NULL CHECK (genre IN ('H', 'F')),
    dernier_rang integer NOT NULL,
    nb_classes   integer NOT NULL,
    rang_nc      integer NOT NULL,
    PRIMARY KEY (mois, genre)
);
ALTER TABLE fft_nc ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fft_nc_lecture ON fft_nc;
CREATE POLICY fft_nc_lecture ON fft_nc FOR SELECT TO anon, authenticated USING (true);

-- p_dernier_rang : rang du dernier classé ; p_nb_classes : nombre total de classés.
-- Ex aequo au dernier rang = nb_classes - dernier_rang + 1 (classement « 1-2-2-4 »).
CREATE OR REPLACE FUNCTION fft_enregistrer_nc(p_mois date, p_genre char(1), p_dernier_rang integer, p_nb_classes integer)
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    INSERT INTO fft_nc (mois, genre, dernier_rang, nb_classes, rang_nc)
    VALUES (p_mois, p_genre, p_dernier_rang, p_nb_classes, p_dernier_rang + (p_nb_classes - p_dernier_rang + 1) + 1)
    ON CONFLICT (mois, genre) DO UPDATE SET dernier_rang = EXCLUDED.dernier_rang,
        nb_classes = EXCLUDED.nb_classes, rang_nc = EXCLUDED.rang_nc
    RETURNING rang_nc
$$;
REVOKE ALL ON FUNCTION fft_enregistrer_nc(date, char, integer, integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION fft_rang_nc(p_genre char(1))
RETURNS integer LANGUAGE sql STABLE SET search_path = public AS $$
    SELECT rang_nc FROM fft_nc WHERE genre = p_genre ORDER BY mois DESC LIMIT 1
$$;
GRANT EXECUTE ON FUNCTION fft_rang_nc(char) TO anon, authenticated;

-- Rang qui compte dans le poids d'une paire, pour un joueur (rang, genre) dans un tableau.
--   messieurs : une dame compte avec son équivalent masculin ; une NC = NC messieurs
--   dames     : classement dames ; NC = NC dames
--   mixte     : chacun dans son classement (pas d'équivalence)
CREATE OR REPLACE FUNCTION fft_rang_pour_poids(p_rang integer, p_genre char(1), p_tableau text)
RETURNS integer LANGUAGE sql STABLE SET search_path = public AS $$
    SELECT CASE
        WHEN p_tableau = 'dames' THEN coalesce(p_rang, fft_rang_nc('F'))
        WHEN p_tableau = 'mixte' THEN coalesce(p_rang, fft_rang_nc(coalesce(p_genre, 'H')))
        WHEN p_genre = 'F' THEN coalesce(fft_rang_equivalent_messieurs(p_rang), fft_rang_nc('H'))
        ELSE coalesce(p_rang, fft_rang_nc('H')) END
$$;
GRANT EXECUTE ON FUNCTION fft_rang_pour_poids(integer, char, text) TO anon, authenticated;

-- Inscription et équipe : le poids suit les règles ci-dessus.
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
    VALUES (p_tournoi, v_j1, v_j2, v_statut, r1.rang, r2.rang,
            fft_rang_pour_poids(r1.rang, coalesce(r1.genre, p_j1->>'genre'), t.genre)
          + fft_rang_pour_poids(r2.rang, coalesce(r2.genre, p_j2->>'genre'), t.genre),
            nullif(trim(p_message), ''), false)
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

CREATE OR REPLACE FUNCTION creer_equipe_inscription(p_inscription uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE i record; v_equipe uuid; v_tableau text;
BEGIN
    SELECT * INTO i FROM inscriptions WHERE id = p_inscription;
    IF i.equipe_id IS NOT NULL THEN RETURN i.equipe_id; END IF;
    SELECT genre INTO v_tableau FROM tournois WHERE id = i.tournoi_id;
    INSERT INTO equipes (tournoi_id, nom, joueur_j1_id, joueur_j2_id, points_j1, points_j2)
    VALUES (i.tournoi_id,
            (SELECT nom FROM joueurs WHERE id = i.joueur1_id) || ' / ' || (SELECT nom FROM joueurs WHERE id = i.joueur2_id),
            i.joueur1_id, i.joueur2_id,
            fft_rang_pour_poids(i.rang1, (SELECT genre FROM joueurs WHERE id = i.joueur1_id), v_tableau),
            fft_rang_pour_poids(i.rang2, (SELECT genre FROM joueurs WHERE id = i.joueur2_id), v_tableau))
    RETURNING id INTO v_equipe;
    UPDATE inscriptions SET equipe_id = v_equipe, maj_le = now() WHERE id = p_inscription;
    RETURN v_equipe;
END;
$$;

-- Espace joueur : place finale dans l'historique.
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
                    'categorie', t.categorie, 'statut', t.status, 'homologue', t.homologue,
                    'place', e.place_finale,
                    'nb_equipes', (SELECT count(*) FROM equipes x WHERE x.tournoi_id = t.id),
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

-- ===================================================================== 3. alertes staff

CREATE TABLE IF NOT EXISTS club_config (
    cle    text PRIMARY KEY,
    valeur text NOT NULL
);
ALTER TABLE club_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS club_config_staff ON club_config;
CREATE POLICY club_config_staff ON club_config FOR ALL TO authenticated USING (est_staff()) WITH CHECK (est_staff());
-- Adresse qui reçoit les alertes (modifiable : UPDATE club_config SET valeur = '…' WHERE cle = 'email_alertes').
INSERT INTO club_config (cle, valeur) VALUES ('email_alertes', 'contact@le-rebond.fr') ON CONFLICT (cle) DO NOTHING;

CREATE OR REPLACE FUNCTION alerter_staff(p_sujet text, p_texte text, p_inscription uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE dest text;
BEGIN
    SELECT valeur INTO dest FROM club_config WHERE cle = 'email_alertes';
    IF nullif(trim(dest), '') IS NULL THEN RETURN; END IF;
    INSERT INTO notifications (canal, destinataire, sujet, corps, type, inscription_id)
    VALUES ('email', trim(dest), '[Tournois] ' || p_sujet,
            p_texte || E'\n\nDétail et contacts : https://le-rebond.fr/live/admin/ (onglet Calendrier → Inscriptions)',
            'alerte_staff', p_inscription);
END;
$$;
REVOKE ALL ON FUNCTION alerter_staff(text, text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION inscriptions_alertes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE paire text; places text;
BEGIN
    paire := nom_joueur(NEW.joueur1_id) || ' / ' || nom_joueur(NEW.joueur2_id);
    IF TG_OP = 'INSERT' THEN
        -- L'équipe de la nouvelle paire est créée juste après l'inscription : on la compte déjà.
        places := (SELECT (places_occupees(NEW.tournoi_id)
                           + CASE WHEN NEW.statut = 'inscrite' AND NEW.equipe_id IS NULL THEN 1 ELSE 0 END)
                          || coalesce('/' || nb_equipes_max, '') FROM tournois WHERE id = NEW.tournoi_id);
        PERFORM alerter_staff(
            CASE NEW.statut WHEN 'inscrite' THEN 'Nouvelle inscription' ELSE 'Nouvelle paire en liste d''attente' END
                || ' — ' || libelle_tournoi(NEW.tournoi_id),
            paire || CASE NEW.statut WHEN 'inscrite' THEN ' s''est inscrite' ELSE ' est en liste d''attente' END
                || ' au ' || libelle_tournoi(NEW.tournoi_id) || ' (' || places || ' équipes, poids '
                || coalesce(NEW.poids::text, 'NC') || ').'
                || coalesce(E'\nMessage : ' || NEW.message, ''),
            NEW.id);
    ELSIF NEW.statut = 'annulee' AND OLD.statut IS DISTINCT FROM 'annulee' AND NEW.annulee_par IS DISTINCT FROM 'staff' THEN
        PERFORM alerter_staff('Désinscription — ' || libelle_tournoi(NEW.tournoi_id),
            coalesce(NEW.annulee_par, 'Un joueur') || ' a désinscrit la paire ' || paire || ' du ' || libelle_tournoi(NEW.tournoi_id)
                || '. La liste d''attente a été mise à jour automatiquement.', NEW.id);
    ELSIF (NEW.presence_j1 IS FALSE AND OLD.presence_j1 IS DISTINCT FROM false)
       OR (NEW.presence_j2 IS FALSE AND OLD.presence_j2 IS DISTINCT FROM false) THEN
        PERFORM alerter_staff('Absence annoncée — ' || libelle_tournoi(NEW.tournoi_id),
            nom_joueur(CASE WHEN NEW.presence_j1 IS FALSE THEN NEW.joueur1_id ELSE NEW.joueur2_id END)
                || ' (paire ' || paire || ') a répondu à sa convocation qu''il/elle ne pourra pas venir.'
                || ' Pensez à désinscrire la paire pour libérer la place.', NEW.id);
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_inscriptions_alertes ON inscriptions;
CREATE TRIGGER trg_inscriptions_alertes AFTER INSERT OR UPDATE OF statut, presence_j1, presence_j2 ON inscriptions
    FOR EACH ROW EXECUTE FUNCTION inscriptions_alertes();
