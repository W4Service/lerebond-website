-- Fidélité : le suivi montre les conversions générées au lieu du remplissage des heures
-- creuses (demande du 31/10/2026).
--
-- Conversion = le client a reçu un message (ou, en dry-run, un message a été simulé pour
-- lui) et a joué au padel entre ce message et la fin de validité de l'offre. Le CA est le
-- prix LiveXperience des réservations jouées dans cette fenêtre.
-- L'effet réel se lit contre le groupe témoin (aucun message) : retours en plus =
-- (taux de retour ciblés − taux témoins) × nombre de ciblés.

DROP VIEW IF EXISTS fidelite.v_suivi_heures_creuses;

-- Une ligne par message, avec ce qui s'est passé ensuite.
CREATE OR REPLACE VIEW fidelite.v_conversions AS
SELECT m.id AS message_id, m.type, m.personne, m.cadeau_id, m.statut,
       coalesce(m.envoye_le, m.cree_le) AS envoye_le, k.expire_le,
       k.statut = 'utilise' AS cadeau_utilise,
       x.parties, x.ca
FROM fidelite.messages m
JOIN fidelite.cadeaux k ON k.id = m.cadeau_id
CROSS JOIN LATERAL (
    SELECT count(*) AS parties, coalesce(sum(fidelite.eur(l.prix)), 0) AS ca
    FROM fidelite.parties p
    LEFT JOIN LATERAL (SELECT prix FROM livex.livex_reservations r
                       WHERE r.id = p.id_resa ORDER BY r._pk DESC LIMIT 1) l ON true
    WHERE p.personne = m.personne AND p.sport = 'padel'
      AND p.debut > coalesce(m.envoye_le, m.cree_le) AND p.jour <= k.expire_le
      AND p.fin <= fidelite.maintenant()) x
WHERE m.statut IN ('simule', 'envoye');

CREATE OR REPLACE VIEW fidelite.v_suivi_conversions AS
SELECT type,
       count(*)                                        AS messages,
       count(*) FILTER (WHERE parties > 0)             AS conversions,
       round(100.0 * count(*) FILTER (WHERE parties > 0) / nullif(count(*), 0), 1) AS pct_conversion,
       sum(parties)                                    AS parties,
       sum(ca)                                         AS ca,
       count(*) FILTER (WHERE cadeau_utilise)          AS cadeaux_utilises
FROM fidelite.v_conversions
GROUP BY type;

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
        'inscrits_newsletter', (SELECT count(*) FROM v_personnes WHERE newsletter_ok),
        'messages', (SELECT coalesce(jsonb_agg(x ORDER BY x->>'cree_le' DESC), '[]') FROM (
            SELECT jsonb_build_object('cree_le', m.cree_le, 'type', m.type, 'statut', m.statut, 'motif', m.motif,
                                      'canal', m.canal, 'destinataire', m.destinataire, 'sujet', m.sujet,
                                      'corps', m.corps, 'prenom', vp.prenom, 'nom', vp.nom) AS x
            FROM messages m LEFT JOIN v_personnes vp ON vp.personne = m.personne
            ORDER BY m.cree_le DESC LIMIT 300) y));
END $$;
