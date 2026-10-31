-- Fidélité : campagne « partie à 5 € par joueur » et pause du rattrapage / grand retour
-- (demande de Gaël, 31/10/2026).
--
-- - Rattrapage (J+14) et grand retour (J+60) désactivés pour l'instant (`rattrapage_actif`,
--   `grand_retour_actif`) : le client sort du tunnel à la fin de sa fenêtre.
-- - Campagne lancée depuis l'admin, envoyée aux clients joignables par e-mail (non désinscrits)
--   sans aucune réservation (padel ou five, passée ou à venir) depuis 60 jours, plus les
--   adresses de l'équipe (`toujours`) : 5 € la partie par joueur, pour le client et son
--   équipe, sur la période choisie, sur présentation du QR code ou du code à l'accueil.
--   Réservation en ligne avec l'empreinte bancaire ; la réduction est faite sur place. Hors
--   période, le code ne marche plus. Elle part dès le clic, à toute heure et même en mode
--   test, et ne compte pas dans le plafond d'un message par semaine.
-- - L'offre de campagne vit à côté de celle du tunnel : jamais remplacée par lui.

INSERT INTO fidelite.config (cle, valeur, description) VALUES
    ('rattrapage_actif', 'false', 'relance J+14 (rattrapage) : false = désactivée, le client sort du tunnel'),
    ('grand_retour_actif', 'false', 'grand retour J+60 : false = désactivé'),
    ('campagne_5e', '{"libelle": "Partie à 5 € par joueur", "formule": "la partie de padel à 5 € par joueur, pour toi et ton équipe", "inactivite_jours": 60, "toujours": ["gael.poujol@wepe.fr", "damien.esponde@wepe.fr", "benjamin.wuilmot@wepe.fr"]}',
        'campagne lancée depuis l''admin : cadeau, clients sans réservation depuis N jours, adresses toujours incluses (équipe)')
ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur, description = EXCLUDED.description;

-- Rattrapages et grands retours pas encore partis : retenus, et leurs offres closes.
UPDATE fidelite.messages SET statut = 'bloque', motif = 'offre désactivée'
WHERE type IN ('rattrapage', 'grand_retour')
  AND (statut = 'a_envoyer' OR (statut = 'simule' AND apercu_envoye_le IS NULL));
UPDATE fidelite.cadeaux SET statut = 'expire', motif = 'offre désactivée'
WHERE statut = 'actif' AND origine IN ('rattrapage', 'grand_retour');

ALTER TABLE fidelite.messages DROP CONSTRAINT IF EXISTS messages_type_check;
ALTER TABLE fidelite.messages ADD CONSTRAINT messages_type_check
    CHECK (type IN ('annonce', 'retour', 'rappel', 'rattrapage', 'grand_retour', 'campagne'));
ALTER TABLE fidelite.cadeaux DROP CONSTRAINT IF EXISTS cadeaux_origine_check;
ALTER TABLE fidelite.cadeaux ADD CONSTRAINT cadeaux_origine_check
    CHECK (origine IN ('palier', 'retour', 'rattrapage', 'grand_retour', 'campagne'));

CREATE TABLE IF NOT EXISTS fidelite.campagnes (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lancee_le      timestamptz NOT NULL DEFAULT now(),
    lancee_par     text,
    expire_le      date NOT NULL,
    destinataires  integer NOT NULL
);
ALTER TABLE fidelite.cadeaux ADD COLUMN IF NOT EXISTS campagne_id uuid REFERENCES fidelite.campagnes(id);

-- Une offre du tunnel active par client, plus éventuellement une offre de campagne.
DROP INDEX IF EXISTS fidelite.idx_fid_cadeau_actif;
CREATE UNIQUE INDEX idx_fid_cadeau_actif ON fidelite.cadeaux (personne) WHERE statut = 'actif' AND origine <> 'campagne';
CREATE UNIQUE INDEX IF NOT EXISTS idx_fid_cadeau_campagne_actif ON fidelite.cadeaux (personne) WHERE statut = 'actif' AND origine = 'campagne';

CREATE OR REPLACE FUNCTION fidelite.plafond_ok(p_personne text, p_maintenant timestamptz, p_annonce_de uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql STABLE SET search_path = fidelite AS $$
    WITH j AS (SELECT (p_maintenant AT TIME ZONE 'Europe/Paris')::date AS jour, cfg_int('plafond_jours') AS n)
    SELECT NOT EXISTS (
               SELECT 1 FROM messages m, j
               WHERE m.personne = p_personne
                 AND m.statut IN ('simule', 'a_envoyer', 'envoye')
                 AND m.type <> 'campagne'
                 AND (m.cree_le AT TIME ZONE 'Europe/Paris')::date > j.jour - j.n
                 AND NOT (p_annonce_de IS NOT NULL AND m.cadeau_id = p_annonce_de AND m.type IN ('annonce', 'retour')))
       AND NOT EXISTS (
               SELECT 1 FROM j, v_personnes p, generate_series(j.jour - j.n + 1, j.jour, interval '1 day') d
               WHERE p.personne = p_personne AND p.newsletter_ok AND est_jour_newsletter(d::date))
$$;

-- Ouvre une offre du tunnel (et remplace celle du tunnel en cours, pas celle de campagne).
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
    WHERE personne = p_personne AND statut = 'actif' AND origine <> 'campagne';
    INSERT INTO cadeaux (code, personne, origine, palier, libelle, formule, choix_requis, valable_du, expire_le, cree_le)
    VALUES (nouveau_code(), p_personne, p_origine, p_palier, v_libelle, v_formule, v_choix, p_du, p_au, p_maintenant)
    RETURNING id INTO v_id;
    RETURN v_id;
END $$;

-- Lancement réel : les campagnes déjà envoyées aux clients sont gardées (et ne bloquent pas).
CREATE OR REPLACE FUNCTION fidelite.reinitialiser(p_lancement date, p_reel boolean) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = fidelite AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM messages WHERE statut IN ('a_envoyer', 'envoye', 'echec') AND type <> 'campagne') THEN
        RAISE EXCEPTION 'des messages réels existent déjà : réinitialisation refusée';
    END IF;
    DELETE FROM messages WHERE type <> 'campagne';
    DELETE FROM cadeaux WHERE origine <> 'campagne';
    DELETE FROM tunnel;
    UPDATE config SET valeur = to_jsonb(p_lancement::text) WHERE cle = 'date_lancement';
    UPDATE config SET valeur = to_jsonb(NOT p_reel) WHERE cle = 'dry_run';
    IF p_reel THEN
        UPDATE config SET valeur = '""' WHERE cle = 'email_test';
    END IF;
    RETURN CASE WHEN p_reel THEN 'envoi réel' ELSE 'dry-run' END || ', lancement le ' || p_lancement;
END $$;

-- Workflow d'envoi : une campagne (ou son test) part dès qu'elle est lancée, à toute heure
-- et même en dry-run : c'est le clic dans l'admin qui décide.
CREATE OR REPLACE FUNCTION fidelite.campagne_autorisee(p_donnees jsonb, p_maintenant timestamptz DEFAULT now()) RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT true $$;

-- Moteur : identique (20261101), sauf rattrapage / grand retour désactivables et offre de
-- campagne jamais remplacée par le tunnel.
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

-- Recherche et fiche : un client peut avoir deux offres (tunnel + campagne).
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
        'messages', (SELECT coalesce(jsonb_agg(jsonb_build_object('type', type, 'statut', statut, 'cree_le', cree_le,
                                                                  'sujet', sujet) ORDER BY cree_le DESC), '[]')
                     FROM messages WHERE personne = v_personne));
END $$;

INSERT INTO fidelite.templates (code, canal, sujet, corps) VALUES
    ('campagne_5e', 'email', '{prenom}, le padel à 5 € par joueur jusqu''au {date_limite}',
     E'Salut {prenom},\n\nDu {date_debut} au {date_limite} inclus, la partie de padel au Rebond est à 5 € par joueur, pour toi et ton équipe.\n\nComment en profiter :\n1. Réserve ton terrain en ligne comme d''habitude, avec ton empreinte bancaire.\n2. À ton arrivée, présente ce QR code (ou ton code {code}) à l''accueil : la réduction est faite sur place.\n\nPassé le {date_limite}, le code ne fonctionne plus.\n\nRéserve ici : {lien}')
ON CONFLICT (code, canal) DO UPDATE SET sujet = EXCLUDED.sujet, corps = EXCLUDED.corps;

-- Adresses de l'équipe (config `toujours`) : fiches clients hors LiveXperience (refs 99000000x,
-- jamais touchées par la synchronisation), pour recevoir chaque campagne et ses tests.
INSERT INTO fidelite.clients (id_client, personne, prenom, nom, email) VALUES
    ('990000001', '990000001', 'Gaël', 'POUJOL', 'gael.poujol@wepe.fr'),
    ('990000002', '990000002', 'Damien', 'ESPONDE', 'damien.esponde@wepe.fr'),
    ('990000003', '990000003', 'Benjamin', 'WUILMOT', 'benjamin.wuilmot@wepe.fr')
ON CONFLICT (id_client) DO NOTHING;

-- Destinataires : clients avec un e-mail, non désinscrits des offres, sans aucune réservation
-- (padel ou five) depuis `inactivite_jours` jours ni à venir ; plus, toujours, les adresses
-- de `toujours` (l'équipe), même si elles ont réservé.
CREATE OR REPLACE VIEW fidelite.v_campagne_cibles AS
SELECT vp.personne, vp.prenom, vp.email, vp.jeton FROM fidelite.v_personnes vp
WHERE vp.email LIKE '%_@_%'
  AND (vp.email IN (SELECT jsonb_array_elements_text(fidelite.cfg('campagne_5e') -> 'toujours'))
       OR (vp.relances_ok
           AND NOT EXISTS (SELECT 1 FROM fidelite.parties p
                           WHERE p.personne = vp.personne
                             AND p.jour > (fidelite.maintenant() AT TIME ZONE 'Europe/Paris')::date
                                          - coalesce((fidelite.cfg('campagne_5e')->>'inactivite_jours')::int, 60))));

-- Rédige un e-mail de campagne (le pied commun sans sa phrase « au bar », déjà dans le texte).
DROP FUNCTION IF EXISTS fidelite.campagne_message(text, text, uuid, text, date, timestamptz);
CREATE OR REPLACE FUNCTION fidelite.campagne_message(p_prenom text, p_jeton uuid, p_code text, p_debut date, p_fin date,
                                                     OUT sujet text, OUT corps text, OUT donnees jsonb)
LANGUAGE plpgsql STABLE SET search_path = fidelite, public AS $$
DECLARE t record; v_pied text; v_vars jsonb; g jsonb := cfg('campagne_5e');
BEGIN
    SELECT * INTO t FROM templates WHERE code = 'campagne_5e' AND canal = 'email';
    SELECT templates.corps INTO v_pied FROM templates WHERE code = 'pied' AND canal = 'email';
    v_pied := CASE WHEN strpos(v_pied, '—') > 0 THEN substr(v_pied, strpos(v_pied, '—')) ELSE v_pied END;
    v_vars := jsonb_build_object(
        'prenom', coalesce(p_prenom, ''), 'date_debut', date_fr(p_debut), 'date_limite', date_fr(p_fin),
        'cadeau', g->>'formule', 'code', p_code, 'lien', cfg_txt('lien_reservation'),
        'lien_desinscription', site_url() || '/desinscription/?t=' || p_jeton);
    sujet := rendre(t.sujet, v_vars);
    corps := rendre(t.corps || E'\n\n' || v_pied, v_vars);
    donnees := jsonb_build_object('qr_url', site_url() || '/admin/client/?j=' || p_jeton, 'code', p_code,
                                  'cadeau', g->>'libelle', 'origine', 'campagne',
                                  'expire_le', p_fin, 'date_limite', date_fr(p_fin));
END $$;

-- Période proposée : de demain au même jour de la semaine suivante inclus (8 jours).
CREATE OR REPLACE FUNCTION fidelite.campagne_dates_ok(p_debut date, p_fin date) RETURNS void
LANGUAGE plpgsql STABLE SET search_path = fidelite AS $$
BEGIN
    IF p_debut IS NULL OR p_fin IS NULL THEN RAISE EXCEPTION 'Indique les dates de début et de fin.'; END IF;
    IF p_debut < (fidelite.maintenant() AT TIME ZONE 'Europe/Paris')::date THEN RAISE EXCEPTION 'La date de début est passée.'; END IF;
    IF p_fin < p_debut THEN RAISE EXCEPTION 'La date de fin est avant la date de début.'; END IF;
    IF p_fin - p_debut > 30 THEN RAISE EXCEPTION 'Une campagne dure 31 jours au plus.'; END IF;
END $$;

-- E-mails de test (aucun cadeau, code RB-EXEMPLE), partent tout de suite : aux adresses
-- `toujours` et à l'adresse donnée. Chacun voit son propre QR code.
CREATE OR REPLACE FUNCTION fidelite.campagne_envoyer_test(p_autre text, p_debut date, p_fin date) RETURNS text[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path = fidelite, public AS $$
DECLARE c record; m record; v_dest text[] := '{}';
BEGIN
    PERFORM campagne_dates_ok(p_debut, p_fin);
    FOR c IN SELECT DISTINCT ON (x.email) x.email, vp.personne, coalesce(vp.prenom, '') AS prenom, coalesce(vp.jeton, gen_random_uuid()) AS jeton
             FROM (SELECT jsonb_array_elements_text(cfg('campagne_5e') -> 'toujours') AS email
                   UNION SELECT lower(p_autre) WHERE coalesce(p_autre, '') LIKE '%_@_%') x
             LEFT JOIN v_personnes vp ON vp.email = x.email
             ORDER BY x.email, vp.personne LOOP
        SELECT * INTO m FROM campagne_message(c.prenom, c.jeton, 'RB-EXEMPLE', p_debut, p_fin);
        INSERT INTO messages (cle, personne, type, canal, destinataire, sujet, corps, statut, cree_le, donnees)
        VALUES ('campagne-test:' || gen_random_uuid(), coalesce(c.personne, 'equipe'), 'campagne', 'email', c.email,
                '[TEST] ' || m.sujet, m.corps, 'a_envoyer', fidelite.maintenant(), m.donnees || '{"test": true}');
        v_dest := v_dest || c.email;
    END LOOP;
    RETURN v_dest;
END $$;
REVOKE ALL ON FUNCTION fidelite.campagne_envoyer_test(text, date, date) FROM PUBLIC;

-- Admin : nombre de destinataires, période proposée et campagnes déjà lancées.
CREATE OR REPLACE FUNCTION public.fidelite_campagne_etat() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = fidelite, public AS $$
DECLARE v_jour date := (fidelite.maintenant() AT TIME ZONE 'Europe/Paris')::date;
BEGIN
    IF NOT public.est_staff() THEN RAISE EXCEPTION 'réservé au staff' USING ERRCODE = '42501'; END IF;
    RETURN jsonb_build_object(
        'destinataires', (SELECT count(*) FROM v_campagne_cibles),
        'offre', cfg('campagne_5e'),
        'debut', v_jour + 1, 'fin', v_jour + 8,
        'test_a', (SELECT email FROM public.staff WHERE user_id = auth.uid()),
        'campagnes', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                          'lancee_le', ca.lancee_le, 'lancee_par', ca.lancee_par, 'valable_du', ca.valable_du,
                          'expire_le', ca.expire_le, 'destinataires', ca.destinataires,
                          'envoyes', (SELECT count(*) FROM messages m JOIN cadeaux k ON k.id = m.cadeau_id
                                      WHERE k.campagne_id = ca.id AND m.statut = 'envoye'),
                          'en_attente', (SELECT count(*) FROM messages m JOIN cadeaux k ON k.id = m.cadeau_id
                                         WHERE k.campagne_id = ca.id AND m.statut = 'a_envoyer'),
                          'echecs', (SELECT count(*) FROM messages m JOIN cadeaux k ON k.id = m.cadeau_id
                                     WHERE k.campagne_id = ca.id AND m.statut = 'echec'),
                          'utilises', (SELECT count(*) FROM cadeaux k WHERE k.campagne_id = ca.id AND k.statut = 'utilise'))
                      ORDER BY ca.lancee_le DESC), '[]') FROM campagnes ca));
END $$;

DROP FUNCTION IF EXISTS public.fidelite_campagne_test();
CREATE OR REPLACE FUNCTION public.fidelite_campagne_test(p_debut date, p_fin date) RETURNS text[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path = fidelite, public AS $$
BEGIN
    IF NOT public.est_staff() THEN RAISE EXCEPTION 'réservé au staff' USING ERRCODE = '42501'; END IF;
    RETURN fidelite.campagne_envoyer_test((SELECT email FROM public.staff WHERE user_id = auth.uid()), p_debut, p_fin);
END $$;

ALTER TABLE fidelite.campagnes ADD COLUMN IF NOT EXISTS valable_du date;

-- Admin : lance la campagne pour la période choisie. `p_nombre` = nombre de destinataires
-- affiché à l'écran (évite d'envoyer à une liste qui a changé) ; une par 24 h (double clic).
-- Le code ne marche qu'entre `p_debut` et `p_fin` inclus (contrôlé par fidelite_bar_utiliser).
DROP FUNCTION IF EXISTS public.fidelite_campagne_envoyer(integer);
CREATE OR REPLACE FUNCTION public.fidelite_campagne_envoyer(p_nombre integer, p_debut date, p_fin date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = fidelite, public AS $$
DECLARE v_campagne uuid; v_cadeau uuid; v_code text; c record; m record; n integer := 0;
        g jsonb := cfg('campagne_5e');
        v_maintenant timestamptz := fidelite.maintenant();
BEGIN
    IF NOT public.est_staff() THEN RAISE EXCEPTION 'réservé au staff' USING ERRCODE = '42501'; END IF;
    PERFORM campagne_dates_ok(p_debut, p_fin);
    PERFORM pg_advisory_xact_lock(hashtext('fidelite.campagne'));
    IF EXISTS (SELECT 1 FROM campagnes WHERE lancee_le > v_maintenant - interval '24 hours') THEN
        RAISE EXCEPTION 'Une campagne a déjà été lancée il y a moins de 24 h.';
    END IF;
    IF p_nombre IS DISTINCT FROM (SELECT count(*)::int FROM v_campagne_cibles) THEN
        RAISE EXCEPTION 'Le nombre de destinataires a changé : recharge la page.';
    END IF;
    INSERT INTO campagnes (lancee_le, lancee_par, valable_du, expire_le, destinataires)
    VALUES (v_maintenant, (SELECT email FROM public.staff WHERE user_id = auth.uid()), p_debut, p_fin, p_nombre)
    RETURNING id INTO v_campagne;
    UPDATE cadeaux SET statut = 'remplace', motif = 'nouvelle campagne' WHERE statut = 'actif' AND origine = 'campagne';
    FOR c IN SELECT * FROM v_campagne_cibles ORDER BY personne LOOP
        v_code := nouveau_code();
        INSERT INTO cadeaux (code, personne, origine, libelle, formule, choix_requis, valable_du, expire_le, cree_le, campagne_id)
        VALUES (v_code, c.personne, 'campagne', g->>'libelle', g->>'formule', false, p_debut, p_fin, v_maintenant, v_campagne)
        RETURNING id INTO v_cadeau;
        SELECT * INTO m FROM campagne_message(c.prenom, c.jeton, v_code, p_debut, p_fin);
        INSERT INTO messages (cle, personne, cadeau_id, type, canal, destinataire, sujet, corps, statut, cree_le, donnees)
        VALUES ('campagne:' || v_cadeau, c.personne, v_cadeau, 'campagne', 'email', c.email, m.sujet, m.corps,
                'a_envoyer', v_maintenant, m.donnees || jsonb_build_object('campagne', v_campagne));
        n := n + 1;
    END LOOP;
    RETURN jsonb_build_object('destinataires', n, 'valable_du', p_debut, 'expire_le', p_fin);
END $$;

REVOKE ALL ON FUNCTION public.fidelite_campagne_etat() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fidelite_campagne_test(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fidelite_campagne_envoyer(integer, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fidelite_campagne_etat() TO authenticated;
GRANT EXECUTE ON FUNCTION public.fidelite_campagne_test(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fidelite_campagne_envoyer(integer, date, date) TO authenticated;
