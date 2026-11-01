-- Fidélité : recherche joueur (e-mail en plus) et parcours sur la fiche : envoyé, ouvert, cliqué,
-- parties jouées ou prévues, code utilisé (demande de Gaël, 01/11).

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
                'nb_cadeaux', (SELECT count(*) FROM cadeaux c WHERE c.personne = vp.personne AND c.statut = 'actif'),
                'cadeau', (SELECT jsonb_build_object(
                               'id', c.id, 'code', c.code, 'libelle', c.libelle, 'origine', c.origine,
                               'choix_requis', c.choix_requis, 'valable_du', c.valable_du, 'expire_le', c.expire_le,
                               'pas_encore_valable', v_jour < c.valable_du)
                           FROM cadeaux c WHERE c.personne = vp.personne AND c.statut = 'actif' ORDER BY c.origine = 'campagne', c.cree_le LIMIT 1),
                'dernier_utilise', (SELECT jsonb_build_object('libelle', c.libelle, 'le', c.utilise_le, 'par', c.utilise_par, 'choix', c.choix)
                                    FROM cadeaux c WHERE c.personne = vp.personne AND c.statut = 'utilise'
                                    ORDER BY c.utilise_le DESC LIMIT 1)) AS r
            FROM v_personnes vp
            LEFT JOIN tunnel t ON t.personne = vp.personne
            WHERE (length(chiffres) >= 4 AND ('0' || substr(coalesce(vp.telephone, ''), 4)) LIKE '%' || chiffres || '%')
               OR (length(chiffres) < 4 AND (
                       public.normaliser_identite(coalesce(vp.prenom, '') || ' ' || coalesce(vp.nom, '')) LIKE '%' || public.normaliser_identite(q) || '%'
                    OR public.normaliser_identite(coalesce(vp.nom, '') || ' ' || coalesce(vp.prenom, '')) LIKE '%' || public.normaliser_identite(q) || '%'))
               OR lower(coalesce(vp.email, '')) LIKE '%' || lower(q) || '%'
               OR EXISTS (SELECT 1 FROM cadeaux c WHERE c.personne = vp.personne AND c.code = upper(q))
            LIMIT 20) x), '[]'::jsonb);
END $$;

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
                   FROM cadeaux c WHERE c.personne = v_personne AND c.statut = 'actif' ORDER BY c.origine = 'campagne', c.cree_le LIMIT 1),
        -- Offre du tunnel et offre de campagne peuvent coexister.
        'cadeaux_actifs', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                               'id', c.id, 'code', c.code, 'libelle', c.libelle, 'origine', c.origine,
                               'choix_requis', c.choix_requis, 'valable_du', c.valable_du, 'expire_le', c.expire_le,
                               'pas_encore_valable', v_jour < c.valable_du) ORDER BY c.origine = 'campagne', c.cree_le), '[]')
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
        -- Parcours : ce que le client a fait de chaque message. Partie jouée ou prévue = après
        -- l'envoi et avant la fin de l'offre (la date de réservation n'est pas connue).
        'messages', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                         'type', m.type, 'statut', m.statut, 'cree_le', m.cree_le, 'envoye_le', m.envoye_le, 'sujet', m.sujet,
                         'test', coalesce(m.donnees->>'test', '') = 'true',
                         'ouvert_le', (SELECT min(e.le) FROM evenements e WHERE e.message_id = m.id AND e.type = 'ouverture'),
                         'clic_reserver_le', (SELECT min(e.le) FROM evenements e WHERE e.message_id = m.id AND e.type = 'clic' AND e.lien = 'reserver'),
                         'clic_desinscription_le', (SELECT min(e.le) FROM evenements e WHERE e.message_id = m.id AND e.type = 'clic' AND e.lien = 'desinscription'),
                         'code', k.code, 'code_statut', k.statut, 'code_utilise_le', k.utilise_le,
                         'parties_jouees', (SELECT count(*) FROM parties p WHERE p.personne = v_personne AND p.sport = 'padel' AND p.debut > coalesce(m.envoye_le, m.cree_le)
                                            AND p.fin <= v_maintenant AND (k.expire_le IS NULL OR p.jour <= k.expire_le)),
                         'parties_prevues', (SELECT count(*) FROM parties p WHERE p.personne = v_personne AND p.sport = 'padel' AND p.debut > v_maintenant
                                             AND (k.expire_le IS NULL OR p.jour <= k.expire_le))) ORDER BY m.cree_le DESC), '[]')
                     FROM messages m LEFT JOIN cadeaux k ON k.id = m.cadeau_id WHERE m.personne = v_personne));
END $$;
