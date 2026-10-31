-- Fidélité : le tunnel passe en réel (demande de Gaël, 01/11). Tout client qui joue au padel
-- à partir du lancement entre au palier 1, qu'il soit nouveau ou non, et reçoit un e-mail le
-- lendemain de chaque partie (paliers 1 à 4) : les annonces ne sont plus soumises au plafond
-- d'un message par semaine (le rappel J+5 l'est toujours).

-- Moteur : identique (20261107), sauf l'entrée et l'annonce.
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

    -- 1. Entrées : 1re partie de padel jouée depuis le lancement, nouveau client ou non.
    IF v_lancement IS NOT NULL THEN
        INSERT INTO tunnel (personne, entre_le, premiere_partie, groupe, palier, derniere_partie, echeance)
        SELECT f.personne, p_maintenant, f.jour, groupe_de(f.personne), 1, f.jour, f.jour + v_fenetre
        FROM (SELECT personne, min(jour) AS jour FROM parties
              WHERE sport = 'padel' AND fin <= p_maintenant AND jour >= v_lancement GROUP BY personne) f
        WHERE NOT EXISTS (SELECT 1 FROM tunnel x WHERE x.personne = f.personne);
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
                WHERE personne = t.personne AND statut = 'actif' AND origine NOT IN ('grand_retour', 'campagne');
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
                WHERE personne = t.personne AND statut = 'actif' AND origine NOT IN ('grand_retour', 'campagne');
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
            -- Rattrapage désactivé (`rattrapage_actif` = false) : décrochage direct.
            IF NOT t.rattrapage_utilise AND cfg('rattrapage_actif') IS DISTINCT FROM 'false'::jsonb THEN
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

    -- 3. Annonce (J+1, toujours) : le lendemain de chaque partie, hors plafond.
    FOR c IN SELECT * FROM cadeaux
             WHERE statut = 'actif' AND origine IN ('palier', 'retour') AND v_jour BETWEEN valable_du AND expire_le
               AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.cadeau_id = cadeaux.id AND m.type IN ('annonce', 'retour'))
             ORDER BY cree_le LOOP
        PERFORM deposer_message(c.personne, CASE c.origine WHEN 'palier' THEN 'annonce' ELSE 'retour' END,
                                CASE c.origine WHEN 'palier' THEN 'annonce_' || c.palier ELSE 'retour' END,
                                c.id, p_maintenant);
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
        EXIT WHEN cfg('grand_retour_actif') = 'false'::jsonb
               OR (n->>'grands_retours')::int >= cfg_int('grand_retour_max_par_jour');
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

-- Passage en réel : efface le tunnel simulé (les campagnes restent), lancement aujourd'hui,
-- dry_run = false, plus d'aperçus à `email_test`. Premier calcul demain 9h, envois dès 10h.
SELECT fidelite.reinitialiser('2026-11-01', true);
