-- Fidélité : campagne envoyée au rythme de `par_heure` e-mails par heure (100), objet neutre,
-- clients déjà venus jouer d'abord (demande de Gaël après un rejet antispam SFR, 31/10/2026).
-- Un envoi en masse depuis une boîte Microsoft 365 est vu comme du spam : on lisse.

UPDATE fidelite.config SET valeur = valeur || '{"par_heure": 100}' WHERE cle = 'campagne_5e';

UPDATE fidelite.templates SET sujet = 'Le Rebond a une offre pour toi'
WHERE code = 'campagne_5e' AND canal = 'email';

-- Messages de campagne à prendre à ce passage du workflow (toutes les 5 min) : par_heure / 12,
-- sans dépasser par_heure sur l'heure glissante. Tests d'abord, puis clients déjà venus.
CREATE OR REPLACE FUNCTION fidelite.campagne_a_prendre() RETURNS SETOF uuid
LANGUAGE sql STABLE SET search_path = fidelite AS $$
    WITH r AS (SELECT coalesce((cfg('campagne_5e')->>'par_heure')::int, 100) AS n)
    SELECT m.id FROM messages m, r
    WHERE m.type = 'campagne' AND m.statut = 'a_envoyer' AND m.tentatives < 5
    ORDER BY coalesce(m.donnees->>'test', '') = 'true' DESC,
             EXISTS (SELECT 1 FROM parties p WHERE p.personne = m.personne) DESC,
             m.cree_le
    LIMIT (SELECT greatest(0, least(r.n / 12, r.n - (SELECT count(*) FROM messages
                                                     WHERE type = 'campagne' AND envoye_le > now() - interval '1 hour')))
           FROM r)
$$;
