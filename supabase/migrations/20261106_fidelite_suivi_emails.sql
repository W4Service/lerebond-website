-- Fidélité : ouvertures et clics des e-mails (demande de Gaël, 31/10/2026).
--
-- Ouverture : image invisible (1 px) servie par n8n (/webhook/rebond-ouverture?m=<message>),
--   qui appelle fidelite.noter_ouverture. Chiffre approximatif : l'app Mail d'Apple charge
--   les images de tous les e-mails reçus (gonfle), Outlook les bloque parfois (sous-estime).
--   Affichée seulement en statistiques par type d'e-mail, jamais client par client.
-- Clic : les liens passent par le site (le-rebond.fr/r/?m=<message>&l=<lien>), qui appelle
--   public.fidelite_clic puis redirige. Le lien de désinscription mène directement à sa page,
--   qui note le clic. Fiable : relié au message, donc aux conversions.

CREATE TABLE IF NOT EXISTS fidelite.evenements (
    id          bigserial PRIMARY KEY,
    message_id  uuid NOT NULL REFERENCES fidelite.messages(id) ON DELETE CASCADE,
    type        text NOT NULL CHECK (type IN ('ouverture', 'clic')),
    lien        text,                  -- clic : 'reserver' ou 'desinscription'
    le          timestamptz NOT NULL DEFAULT now(),
    agent       text                   -- user-agent (repérer les préchargements d'images)
);
CREATE INDEX IF NOT EXISTS idx_fid_evenements_message ON fidelite.evenements (message_id, type);

-- Au plus 20 événements par message et par type : un lien partagé ou un robot ne remplit pas la table.
CREATE OR REPLACE FUNCTION fidelite.noter_evenement(p_message text, p_type text, p_lien text, p_agent text)
RETURNS boolean LANGUAGE plpgsql SET search_path = fidelite AS $$
DECLARE v_id uuid;
BEGIN
    IF coalesce(p_message, '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN false; END IF;
    SELECT id INTO v_id FROM messages WHERE id = p_message::uuid;
    IF v_id IS NULL OR (SELECT count(*) FROM evenements WHERE message_id = v_id AND type = p_type) >= 20 THEN
        RETURN false;
    END IF;
    INSERT INTO evenements (message_id, type, lien, agent) VALUES (v_id, p_type, p_lien, left(p_agent, 300));
    RETURN true;
END $$;

-- Appelée par le workflow n8n « Le Rebond — Fidélité (ouvertures) » (credential Postgres).
CREATE OR REPLACE FUNCTION fidelite.noter_ouverture(p_message text, p_agent text DEFAULT NULL) RETURNS boolean
LANGUAGE sql SET search_path = fidelite AS $$
    SELECT noter_evenement(p_message, 'ouverture', NULL, p_agent)
$$;

-- Appelée sans compte par la page /r/ du site (et /desinscription/) : note le clic et rend
-- l'adresse où rediriger. Seuls les liens connus sont acceptés (pas de redirection ouverte).
CREATE OR REPLACE FUNCTION public.fidelite_clic(p_message text, p_lien text, p_agent text DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = fidelite, public AS $$
BEGIN
    IF p_lien NOT IN ('reserver', 'desinscription') THEN RETURN fidelite.cfg_txt('lien_reservation'); END IF;
    PERFORM fidelite.noter_evenement(p_message, 'clic', p_lien, p_agent);
    RETURN fidelite.cfg_txt('lien_reservation');
END $$;
REVOKE ALL ON FUNCTION public.fidelite_clic(text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.fidelite_clic(text, text, text) TO anon, authenticated;

-- Par type d'e-mail : envoyés (aperçus compris en mode test), ouverts, cliqués, convertis.
CREATE OR REPLACE VIEW fidelite.v_suivi_emails AS
WITH m AS (
    SELECT m.id, m.type,
           EXISTS (SELECT 1 FROM fidelite.evenements e WHERE e.message_id = m.id AND e.type = 'ouverture') AS ouvert,
           EXISTS (SELECT 1 FROM fidelite.evenements e WHERE e.message_id = m.id AND e.type = 'clic' AND e.lien = 'reserver') AS clic,
           coalesce((SELECT c.parties > 0 FROM fidelite.v_conversions c WHERE c.message_id = m.id), false) AS converti
    FROM fidelite.messages m
    WHERE m.canal = 'email' AND (m.statut = 'envoye' OR m.apercu_envoye_le IS NOT NULL))
SELECT type,
       count(*)                                  AS envoyes,
       count(*) FILTER (WHERE ouvert)            AS ouverts,
       round(100.0 * count(*) FILTER (WHERE ouvert) / nullif(count(*), 0), 1) AS pct_ouverture,
       count(*) FILTER (WHERE clic)              AS cliques,
       round(100.0 * count(*) FILTER (WHERE clic) / nullif(count(*), 0), 1)   AS pct_clic,
       count(*) FILTER (WHERE clic AND converti) AS cliques_convertis,
       count(*) FILTER (WHERE converti)          AS convertis
FROM m GROUP BY type;

-- Clics par lien (nombre de messages, pas de clics répétés).
CREATE OR REPLACE VIEW fidelite.v_suivi_liens AS
SELECT m.type, e.lien, count(DISTINCT e.message_id) AS messages, count(*) AS clics
FROM fidelite.evenements e JOIN fidelite.messages m ON m.id = e.message_id
WHERE e.type = 'clic'
GROUP BY m.type, e.lien;

CREATE OR REPLACE FUNCTION public.fidelite_tableau() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = fidelite, public AS $$
BEGIN
    IF NOT public.est_staff() THEN RAISE EXCEPTION 'réservé au staff' USING ERRCODE = '42501'; END IF;
    RETURN jsonb_build_object(
        'config', (SELECT jsonb_object_agg(cle, valeur) FROM config
                   WHERE cle IN ('dry_run', 'date_lancement', 'pourcentage_temoin', 'canaux_actifs')),
        'paliers', (SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY groupe), '[]') FROM v_suivi_paliers v),
        'cadeaux', (SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY origine, palier), '[]') FROM v_suivi_cadeaux v),
        'conversions', (SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.messages DESC), '[]') FROM v_suivi_conversions v),
        -- Total par offre : l'annonce et son rappel portent sur la même offre, une seule conversion.
        'conversions_total', (SELECT jsonb_build_object(
                                  'offres', count(*),
                                  'conversions', count(*) FILTER (WHERE parties > 0),
                                  'pct_conversion', round(100.0 * count(*) FILTER (WHERE parties > 0) / nullif(count(*), 0), 1),
                                  'parties', coalesce(sum(parties), 0),
                                  'ca', coalesce(sum(ca), 0),
                                  'cadeaux_utilises', count(*) FILTER (WHERE cadeau_utilise))
                              FROM (SELECT DISTINCT ON (cadeau_id) cadeau_id, parties, ca, cadeau_utilise
                                    FROM v_conversions ORDER BY cadeau_id, envoye_le) o),
        'effet', (SELECT jsonb_build_object(
                      'cibles', c.entres, 'temoins', t.entres,
                      'pct_cibles', c.pct_2e_partie, 'pct_temoins', t.pct_2e_partie,
                      'retours_en_plus', round((coalesce(c.pct_2e_partie, 0) - coalesce(t.pct_2e_partie, 0)) / 100.0 * c.entres))
                  FROM (SELECT * FROM v_suivi_paliers WHERE groupe = 'cible') c
                  FULL JOIN (SELECT * FROM v_suivi_paliers WHERE groupe = 'temoin') t ON true),
        'emails', (SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.envoyes DESC), '[]') FROM v_suivi_emails v),
        'emails_total', (SELECT jsonb_build_object(
                             'envoyes', coalesce(sum(envoyes), 0), 'ouverts', coalesce(sum(ouverts), 0),
                             'cliques', coalesce(sum(cliques), 0), 'cliques_convertis', coalesce(sum(cliques_convertis), 0),
                             'pct_ouverture', round(100.0 * sum(ouverts) / nullif(sum(envoyes), 0), 1),
                             'pct_clic', round(100.0 * sum(cliques) / nullif(sum(envoyes), 0), 1))
                         FROM v_suivi_emails),
        'liens', (SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.messages DESC), '[]') FROM v_suivi_liens v),
        'inscrits_newsletter', (SELECT count(*) FROM v_personnes WHERE newsletter_ok),
        'messages', (SELECT coalesce(jsonb_agg(x ORDER BY x->>'cree_le' DESC), '[]') FROM (
            SELECT jsonb_build_object('cree_le', m.cree_le, 'type', m.type, 'statut', m.statut, 'motif', m.motif,
                                      'canal', m.canal, 'destinataire', m.destinataire, 'sujet', m.sujet,
                                      'corps', m.corps, 'prenom', vp.prenom, 'nom', vp.nom) AS x
            FROM messages m LEFT JOIN v_personnes vp ON vp.personne = m.personne
            ORDER BY m.cree_le DESC LIMIT 300) y));
END $$;
