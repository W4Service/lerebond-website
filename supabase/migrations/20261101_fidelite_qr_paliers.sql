-- Fidélité, v2 (demandes du 31/10/2026) :
--   1. les cadeaux sont valables à toute heure (plus de condition « heures creuses ») ;
--   2. chaque e-mail porte un QR code : scanné par le staff, il ouvre la fiche complète
--      du client (admin/client/?j=<jeton>) : réservations, cadeaux, passages en caisse,
--      offre en cours (bouton « utilisé ») ;
--   3. chaque e-mail montre l'échelle des paliers : celui qui vient d'être validé et son
--      cadeau, les suivants en grisé avec le nombre de réservations qu'il reste.
-- Le moteur ne fait que préparer les données (`messages.donnees`) ; la mise en page de
-- l'e-mail (échelle, QR) est faite par le workflow n8n.

ALTER TABLE fidelite.messages ADD COLUMN IF NOT EXISTS donnees jsonb;

INSERT INTO fidelite.config (cle, valeur, description) VALUES
    ('noms_terrains', '{"3119": "Padel 1", "3120": "Padel 2", "3121": "Padel 3", "3122": "Five"}', 'nom affiché de chaque resource_id')
ON CONFLICT (cle) DO NOTHING;

-- Le dernier palier (fin du tunnel) a un nom pour l'échelle.
UPDATE fidelite.paliers SET libelle = 'Joueur régulier du Rebond' WHERE fin AND libelle IS NULL;

UPDATE fidelite.templates SET corps =
    E'Montre ce QR code au bar (ou donne ton code {code}) pour profiter de ton cadeau.\n\n—\nLe Rebond · 403 rue de l''Europe, 60400 Noyon\nNe plus recevoir ces messages : {lien_desinscription}'
WHERE code = 'pied' AND canal = 'email';
UPDATE fidelite.templates SET corps = 'Code {code} à montrer au bar. STOP au {numero_stop}'
WHERE code = 'pied' AND canal = 'sms';

-- Échelle des paliers d'une personne : validés, en cours, à débloquer (avec ce qu'il manque).
CREATE OR REPLACE FUNCTION fidelite.echelle(p_personne text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = fidelite AS $$
    SELECT jsonb_agg(jsonb_build_object(
               'rang', pa.rang,
               'libelle', pa.libelle,
               'fin', pa.fin,
               'etat', CASE WHEN pa.rang < t.palier THEN 'valide'
                            WHEN pa.rang = t.palier THEN 'actuel'
                            ELSE 'a_debloquer' END,
               'manque', greatest(pa.rang - t.palier, 0))
           ORDER BY pa.rang)
    FROM tunnel t JOIN paliers pa ON pa.sport = t.sport
    WHERE t.personne = p_personne
$$;

-- Montant « 12,50 € » / « 54,00 » / « -15 € » → numeric ; « None », « - », vide → NULL.
CREATE OR REPLACE FUNCTION fidelite.eur(p text) RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN x ~ '^-?\d+(\.\d+)?$' THEN x::numeric END
    FROM (SELECT regexp_replace(replace(coalesce(p, ''), ',', '.'), '[^0-9.\-]', '', 'g') AS x) y
$$;

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

    INSERT INTO messages (cle, personne, cadeau_id, type, canal, destinataire, sujet, corps, statut, motif, cree_le, donnees)
    VALUES (p_type || ':' || coalesce(p_cadeau::text, p_personne), p_personne, p_cadeau, p_type, v_canal, v_dest,
            rendre(v_sujet, v_vars),
            rendre(v_corps || CASE v_canal WHEN 'email' THEN E'\n\n' ELSE ' ' END || coalesce(pied, ''), v_vars),
            v_statut, v_motif, p_maintenant,
            jsonb_build_object(
                'qr_url', site_url() || '/admin/client/?j=' || p.jeton,
                'code', c.code,
                'cadeau', c.libelle,
                'origine', c.origine,
                'expire_le', c.expire_le,
                'date_limite', date_fr(c.expire_le),
                'palier', (SELECT palier FROM tunnel WHERE personne = p_personne),
                -- Grand retour : le client n'est pas (ou plus) dans le tunnel, pas d'échelle.
                'paliers', CASE WHEN c.origine <> 'grand_retour' THEN echelle(p_personne) END))
    ON CONFLICT (cle) DO NOTHING;
END $$;

-- Moteur : identique, sauf la fin de la condition « heures creuses ».
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
        FOR p IN SELECT jour FROM parties
                 WHERE personne = t.personne AND sport = 'padel' AND fin <= p_maintenant AND jour > t.derniere_partie
                 GROUP BY jour ORDER BY jour LOOP
            IF p.jour <= t.echeance THEN
                -- Revenu à temps : palier suivant. Le cadeau en cours a pu servir (le bar l'a
                -- marqué « utilisé ») ; sinon il n'a pas été réclamé. Valable à toute heure.
                UPDATE cadeaux SET statut = 'expire', motif = 'non réclamé au bar'
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

-- Page bar : + jeton (lien vers la fiche client).
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
                'personne', vp.personne, 'jeton', vp.jeton, 'prenom', vp.prenom, 'nom', vp.nom,
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

-- Fiche client complète (QR code des e-mails, ou lien depuis la page bar). Staff seulement.
-- Les consommations ne sont pas rattachées à un client dans LiveXperience (livex_conso n'a
-- que produit/jour) : on montre les passages en caisse, rapprochés par le nom.
CREATE OR REPLACE FUNCTION public.fidelite_fiche_client(p_jeton uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = fidelite, public AS $$
DECLARE
    v_personne text;
    vp record;
    v_maintenant timestamptz := fidelite.maintenant();
    v_jour date := (fidelite.maintenant() AT TIME ZONE 'Europe/Paris')::date;
    v_noms text[];
BEGIN
    IF NOT public.est_staff() THEN RAISE EXCEPTION 'réservé au staff' USING ERRCODE = '42501'; END IF;
    SELECT personne INTO v_personne FROM clients WHERE jeton = p_jeton;
    IF v_personne IS NULL THEN RAISE EXCEPTION 'Client introuvable (QR code inconnu).'; END IF;
    SELECT * INTO vp FROM v_personnes WHERE personne = v_personne;

    -- « NOM Prénom » et « Prénom NOM » de chaque fiche, normalisés, pour la caisse.
    SELECT array_agg(DISTINCT n) INTO v_noms FROM clients c,
        LATERAL (VALUES (public.normaliser_identite(coalesce(c.nom, '') || ' ' || coalesce(c.prenom, ''))),
                        (public.normaliser_identite(coalesce(c.prenom, '') || ' ' || coalesce(c.nom, '')))) x(n)
    WHERE c.personne = v_personne AND c.nom IS NOT NULL AND c.prenom IS NOT NULL;

    RETURN jsonb_build_object(
        'client', jsonb_build_object(
            'prenom', vp.prenom, 'nom', vp.nom, 'email', vp.email,
            'telephone', CASE WHEN vp.telephone LIKE '+33%' THEN '0' || substr(vp.telephone, 4) ELSE vp.telephone END,
            'relances_ok', vp.relances_ok, 'newsletter_ok', vp.newsletter_ok,
            'fiches_livex', (SELECT jsonb_agg(jsonb_build_object('ref', id_client, 'cree_le', cree_le) ORDER BY id_client)
                             FROM clients WHERE personne = v_personne)),
        'tunnel', (SELECT jsonb_build_object('statut', statut, 'palier', palier, 'groupe', groupe, 'entre_le', entre_le,
                                             'premiere_partie', premiere_partie, 'derniere_partie', derniere_partie,
                                             'echeance', echeance, 'rattrapage_utilise', rattrapage_utilise)
                   FROM tunnel WHERE personne = v_personne),
        'paliers', echelle(v_personne),
        'cadeau', (SELECT jsonb_build_object('id', c.id, 'code', c.code, 'libelle', c.libelle, 'origine', c.origine,
                                             'choix_requis', c.choix_requis, 'valable_du', c.valable_du, 'expire_le', c.expire_le,
                                             'pas_encore_valable', v_jour < c.valable_du)
                   FROM cadeaux c WHERE c.personne = v_personne AND c.statut = 'actif'),
        'cadeaux', (SELECT coalesce(jsonb_agg(jsonb_build_object('code', code, 'libelle', libelle, 'origine', origine,
                                                                 'palier', palier, 'statut', statut, 'motif', motif,
                                                                 'cree_le', cree_le, 'expire_le', expire_le,
                                                                 'utilise_le', utilise_le, 'utilise_par', utilise_par,
                                                                 'choix', choix) ORDER BY cree_le DESC), '[]')
                    FROM cadeaux WHERE personne = v_personne),
        'stats', (SELECT jsonb_build_object(
                      'parties_padel', count(*) FILTER (WHERE sport = 'padel' AND fin <= v_maintenant),
                      'parties_five', count(*) FILTER (WHERE sport = 'five' AND fin <= v_maintenant),
                      'a_venir', count(*) FILTER (WHERE debut > v_maintenant),
                      'premiere', min(jour) FILTER (WHERE fin <= v_maintenant),
                      'derniere', max(jour) FILTER (WHERE fin <= v_maintenant))
                  FROM parties WHERE personne = v_personne),
        'reservations', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                                     'debut', p.debut, 'fin', p.fin, 'sport', p.sport,
                                     'terrain', coalesce(cfg('noms_terrains') ->> p.ressource, p.ressource),
                                     'a_venir', p.debut > v_maintenant,
                                     'prix', fidelite.eur(l.prix), 'paye', fidelite.eur(l.paye)) ORDER BY p.debut DESC), '[]')
                         FROM parties p
                         LEFT JOIN LATERAL (SELECT prix, paye FROM livex.livex_reservations r
                                            WHERE r.id = p.id_resa ORDER BY r._pk DESC LIMIT 1) l ON true
                         WHERE p.personne = v_personne),
        'caisse', (SELECT coalesce(jsonb_agg(x ORDER BY x->>'jour' DESC, x->>'heure' DESC), '[]') FROM (
                       SELECT jsonb_build_object(
                           'jour', pj._jour, 'heure', pj.heure, 'numero', pj.numero, 'description', pj.description,
                           'statut', pj.statut,
                           'montant', coalesce(fidelite.eur(pj.cash), 0) + coalesce(fidelite.eur(pj.cb), 0)
                                    + coalesce(fidelite.eur(pj.cheque), fidelite.eur(pj.chequ), 0)
                                    + coalesce(fidelite.eur(pj.compte), fidelite.eur(pj.compt), 0)
                                    + coalesce(fidelite.eur(pj.fidelite), fidelite.eur(pj.fidel), 0)
                                    + coalesce(fidelite.eur(pj.offert), fidelite.eur(pj.offer), 0)
                                    + coalesce(fidelite.eur(pj.virement), fidelite.eur(pj.virem), 0)
                                    + coalesce(fidelite.eur(pj.web), 0) + coalesce(fidelite.eur(pj.wellpass), 0)
                                    + coalesce(fidelite.eur(pj.abonnement), fidelite.eur(pj.abonn), 0)
                                    + coalesce(fidelite.eur(pj.egym), 0)) AS x
                       FROM livex.livex_paiements_jour pj
                       WHERE public.normaliser_identite(replace(pj.client, chr(160), ' ')) = ANY (v_noms)
                       LIMIT 200) y),
        'messages', (SELECT coalesce(jsonb_agg(jsonb_build_object('type', type, 'statut', statut, 'cree_le', cree_le,
                                                                  'sujet', sujet) ORDER BY cree_le DESC), '[]')
                     FROM messages WHERE personne = v_personne));
END $$;

REVOKE ALL ON FUNCTION public.fidelite_fiche_client(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fidelite_fiche_client(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fidelite_fiche_client(uuid) TO authenticated;
