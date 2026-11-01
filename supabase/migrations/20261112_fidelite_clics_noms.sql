-- Fidélité : liste nominative des clics « Réserver » dans l'admin (demande de Gaël, 01/11).
-- La politique de confidentialité l'annonce depuis ce jour : seuls les clics postérieurs à
-- `clics_nominatifs_depuis` sont listés, sur 90 jours, sans les clients désinscrits.
-- Les ouvertures restent en statistiques globales.

INSERT INTO fidelite.config (cle, valeur, description)
VALUES ('clics_nominatifs_depuis', to_jsonb(now()), 'clics « Réserver » listés par client à partir de cette date (annonce dans la politique de confidentialité)')
ON CONFLICT (cle) DO NOTHING;

CREATE OR REPLACE VIEW fidelite.v_clics_reserver AS
SELECT DISTINCT ON (m.id) m.id AS message_id, m.type, e.le, vp.prenom, vp.nom, vp.email, vp.telephone, vp.jeton,
       coalesce(c.parties > 0, false) AS venu
FROM fidelite.evenements e
JOIN fidelite.messages m ON m.id = e.message_id
JOIN fidelite.v_personnes vp ON vp.personne = m.personne
LEFT JOIN fidelite.v_conversions c ON c.message_id = m.id
WHERE e.type = 'clic' AND e.lien = 'reserver'
  AND coalesce(m.donnees->>'test', '') <> 'true'
  AND vp.relances_ok
  AND e.le >= (fidelite.cfg_txt('clics_nominatifs_depuis'))::timestamptz
  AND e.le > now() - interval '90 days'
ORDER BY m.id, e.le;

CREATE OR REPLACE FUNCTION public.fidelite_clics_reserver() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = fidelite, public AS $$
BEGIN
    IF NOT public.est_staff() THEN RAISE EXCEPTION 'réservé au staff' USING ERRCODE = '42501'; END IF;
    RETURN coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.le DESC)
                     FROM (SELECT * FROM v_clics_reserver ORDER BY le DESC LIMIT 200) x), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.fidelite_clics_reserver() FROM public;
GRANT EXECUTE ON FUNCTION public.fidelite_clics_reserver() TO authenticated;
