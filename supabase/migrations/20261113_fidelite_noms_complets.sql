-- Fidélité : ouvertures, clics et désinscrits par client dans l'admin (décision de Gaël, 01/11),
-- clics antérieurs compris, sur 90 jours. Les 11 clients qui ont cliqué « Me désinscrire » sur
-- la campagne à 5 € ne reçoivent plus d'e-mails, même sans avoir confirmé sur la page.

UPDATE fidelite.clients SET relances_ok = false, newsletter_ok = false
WHERE personne IN ('204', '1186', '621', '1280', '1432', '1622', '1684', '760', '337', '858', '198');

DELETE FROM fidelite.config WHERE cle = 'clics_nominatifs_depuis';

CREATE OR REPLACE VIEW fidelite.v_clics_reserver AS
SELECT DISTINCT ON (m.id) m.id AS message_id, m.type, e.le, vp.prenom, vp.nom, vp.email, vp.telephone, vp.jeton,
       coalesce(c.parties > 0, false) AS venu
FROM fidelite.evenements e
JOIN fidelite.messages m ON m.id = e.message_id
JOIN fidelite.v_personnes vp ON vp.personne = m.personne
LEFT JOIN fidelite.v_conversions c ON c.message_id = m.id
WHERE e.type = 'clic' AND e.lien = 'reserver'
  AND coalesce(m.donnees->>'test', '') <> 'true'
  AND e.le > now() - interval '90 days'
ORDER BY m.id, e.le;

CREATE OR REPLACE VIEW fidelite.v_ouvertures_noms AS
SELECT DISTINCT ON (m.id) m.id AS message_id, m.type, e.le, vp.prenom, vp.nom, vp.email, vp.telephone, vp.jeton
FROM fidelite.evenements e
JOIN fidelite.messages m ON m.id = e.message_id
JOIN fidelite.v_personnes vp ON vp.personne = m.personne
WHERE e.type = 'ouverture'
  AND coalesce(m.donnees->>'test', '') <> 'true'
  AND e.le > now() - interval '90 days'
ORDER BY m.id, e.le;

CREATE OR REPLACE FUNCTION public.fidelite_ouvertures_noms() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = fidelite, public AS $$
BEGIN
    IF NOT public.est_staff() THEN RAISE EXCEPTION 'réservé au staff' USING ERRCODE = '42501'; END IF;
    RETURN coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.le DESC)
                     FROM (SELECT * FROM v_ouvertures_noms ORDER BY le DESC LIMIT 3000) x), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.fidelite_ouvertures_noms() FROM public;
GRANT EXECUTE ON FUNCTION public.fidelite_ouvertures_noms() TO authenticated;

CREATE OR REPLACE FUNCTION public.fidelite_desinscrits() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = fidelite, public AS $$
BEGIN
    IF NOT public.est_staff() THEN RAISE EXCEPTION 'réservé au staff' USING ERRCODE = '42501'; END IF;
    RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('prenom', prenom, 'nom', nom, 'email', email, 'telephone', telephone, 'jeton', jeton)
                                      ORDER BY nom, prenom)
                     FROM v_personnes WHERE NOT relances_ok), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.fidelite_desinscrits() FROM public;
GRANT EXECUTE ON FUNCTION public.fidelite_desinscrits() TO authenticated;
