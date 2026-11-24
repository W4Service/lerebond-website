-- Correctif à appliquer AVANT 20261121_profil_annuaire_messagerie.sql (qui le vérifie).
--
-- Faille : nom et prénom sont publics (la table joueurs est lisible par tous) et
-- joueur_pour_inscription retrouve un joueur existant par nom + prénom (ou id FFT).
-- chercher_partenaire et inscrire_paire renvoyaient alors au navigateur le lien personnel
-- de ce joueur, et l'ON CONFLICT remplaçait son e-mail et son téléphone par ceux saisis.
-- N'importe qui obtenait ainsi le lien d'un autre joueur (et, avec le lot 1, ses messages).
--   1. joueur_pour_inscription ne remplace plus jamais une coordonnée déjà connue
--      (elle complète seulement les champs vides).
--   2. chercher_partenaire et inscrire_paire ne renvoient le lien que pour une fiche créée
--      par l'appel lui-même ; pour un joueur déjà connu, il part seulement par e-mail
--      (notifier, comme avant). Le JS gère « lien » absent.
--   3. staff_regenerer_lien(joueur) : révoque un lien compromis (nouveau jeton).
--   4. Un premier e-mail saisi pour un joueur déjà connu (sans e-mail jusque-là) n'est PAS
--      enregistré : il est mis de côté (joueurs_contacts.email_propose) et le club est alerté.
--      Sinon le lien de ce joueur partirait aussitôt à une adresse saisie par n'importe qui.
--      staff_valider_email(joueur) l'enregistre et envoie le lien à cette adresse.
--   5. Une adresse e-mail mal formée est refusée (22023).
-- Les fonctions sont reprises à l'identique de leur dernière version (20261021, 20261024,
-- 20261023), seules les lignes ci-dessus changent. Rejouable sans effet de bord.

-- Adresse saisie en ligne pour un joueur déjà connu, en attente de validation par le club.
ALTER TABLE joueurs_contacts ADD COLUMN IF NOT EXISTS email_propose text;

-- Lien à renvoyer au navigateur : seulement si la fiche joueur ET ses coordonnées viennent
-- d'être créées dans cette transaction (now() = début de la transaction).
CREATE OR REPLACE FUNCTION lien_si_nouveau(p_joueur uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT site_url() || '/espace-joueur/?j=' || c.jeton
    FROM joueurs j JOIN joueurs_contacts c ON c.joueur_id = j.id
    WHERE j.id = p_joueur AND j.created_at = now() AND c.created_at = now()
$$;

-- Retrouve ou crée la fiche d'un joueur. Priorité : identifiant FFT, puis nom exact
-- (même normalisation que l'annuaire). Complète les coordonnées manquantes, sans jamais
-- remplacer celles déjà connues ; un premier e-mail pour un joueur déjà connu attend la
-- validation du club.
CREATE OR REPLACE FUNCTION joueur_pour_inscription(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
    v_id uuid;
    v_crm bigint := nullif(p->>'id_crm', '')::bigint;
    v_nom text := nullif(trim(p->>'nom'), '');
    v_prenom text := nullif(trim(p->>'prenom'), '');
    c record;
    v_email text := nullif(lower(trim(p->>'email')), '');
    v_propose text;
BEGIN
    IF v_nom IS NULL OR v_prenom IS NULL THEN
        RAISE EXCEPTION 'Nom et prénom obligatoires pour chaque joueur' USING ERRCODE = '22023';
    END IF;
    IF v_email IS NOT NULL AND v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' THEN
        RAISE EXCEPTION 'Adresse e-mail invalide : %', left(v_email, 60) USING ERRCODE = '22023';
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

    -- Premier e-mail pour un joueur déjà connu (importé des tournois, ou partenaire inscrit par
    -- téléphone) : nom et prénom sont publics, l'adresse a pu être saisie par n'importe qui.
    -- Elle n'est pas enregistrée (aucun lien n'y part) mais mise de côté pour le club.
    IF v_email IS NOT NULL AND (SELECT created_at FROM joueurs WHERE id = v_id) < now()
       AND NOT EXISTS (SELECT 1 FROM joueurs_contacts WHERE joueur_id = v_id AND email IS NOT NULL) THEN
        IF NOT EXISTS (SELECT 1 FROM joueurs_contacts WHERE joueur_id = v_id AND email_propose = v_email) THEN
            PERFORM alerter_staff('Adresse à valider pour un joueur existant',
                nom_joueur(v_id) || ' n''a pas d''e-mail connu : l''adresse « ' || left(v_email, 120)
                || E' » vient d''être saisie en ligne. Elle n''est pas enregistrée et ne reçoit rien tant que le club ne l''a pas validée.\n\n'
                || 'Si c''est bien lui, validez-la : SELECT staff_valider_email(''' || v_id || E''');\n'
                || 'Son lien d''espace joueur lui est alors envoyé à cette adresse. Sinon, ne faites rien.', NULL);
        END IF;
        v_propose := v_email;
        v_email := NULL;
    END IF;
    INSERT INTO joueurs_contacts (joueur_id, email, telephone, email_propose)
    VALUES (v_id, v_email, nullif(regexp_replace(coalesce(p->>'telephone', ''), '[^0-9+]', '', 'g'), ''), v_propose)
    ON CONFLICT (joueur_id) DO UPDATE SET
        -- Ne jamais remplacer des coordonnées déjà connues : nom et prénom sont publics,
        -- n'importe qui pourrait sinon détourner les e-mails (et le lien) d'un joueur.
        email = coalesce(joueurs_contacts.email, EXCLUDED.email),
        telephone = coalesce(joueurs_contacts.telephone, EXCLUDED.telephone),
        email_propose = coalesce(EXCLUDED.email_propose, joueurs_contacts.email_propose),
        updated_at = now();
    RETURN v_id;
END;
$$;

-- Se signaler comme cherchant un partenaire (le lien n'est renvoyé que pour une fiche neuve).
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
        'lien', lien_si_nouveau(v_j));
END;
$$;

-- Inscription d'une paire (le lien n'est renvoyé que pour une fiche neuve).
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
        'lien', lien_si_nouveau(v_j1));
END;
$$;

-- Staff : révoque le lien personnel d'un joueur (lien compromis) et renvoie le nouveau.
-- L'ancien lien cesse aussitôt de fonctionner, sur tous les appareils.
CREATE OR REPLACE FUNCTION staff_regenerer_lien(p_joueur uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v uuid;
BEGIN
    IF NOT est_staff() THEN RAISE EXCEPTION 'réservé au staff' USING ERRCODE = '42501'; END IF;
    UPDATE joueurs_contacts SET jeton = gen_random_uuid(), updated_at = now()
    WHERE joueur_id = p_joueur RETURNING jeton INTO v;
    IF v IS NULL THEN RAISE EXCEPTION 'Ce joueur n''a pas de coordonnées enregistrées' USING ERRCODE = '22023'; END IF;
    RETURN site_url() || '/espace-joueur/?j=' || v;
END;
$$;

-- Staff : valide l'adresse saisie en ligne pour un joueur déjà connu (email_propose),
-- l'enregistre et lui envoie son lien d'espace joueur. Renvoie l'adresse validée.
CREATE OR REPLACE FUNCTION staff_valider_email(p_joueur uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v text;
BEGIN
    IF NOT est_staff() THEN RAISE EXCEPTION 'réservé au staff' USING ERRCODE = '42501'; END IF;
    UPDATE joueurs_contacts SET email = email_propose, email_propose = NULL, updated_at = now()
    WHERE joueur_id = p_joueur AND email IS NULL AND email_propose IS NOT NULL RETURNING email INTO v;
    IF v IS NULL THEN RAISE EXCEPTION 'Aucune adresse en attente de validation pour ce joueur' USING ERRCODE = '22023'; END IF;
    PERFORM envoyer_mon_lien(v);
    RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION lien_si_nouveau(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION joueur_pour_inscription(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION chercher_partenaire(uuid, jsonb, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION inscrire_paire(uuid, jsonb, jsonb, text) TO anon, authenticated;
REVOKE ALL ON FUNCTION staff_regenerer_lien(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION staff_regenerer_lien(uuid) TO authenticated;
REVOKE ALL ON FUNCTION staff_valider_email(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION staff_valider_email(uuid) TO authenticated;
