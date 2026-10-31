-- Fidélité : mode aperçu. Pendant le dry-run, les messages simulés sont envoyés à
-- l'adresse `email_test` (et jamais aux clients), avec le vrai destinataire dans l'objet.
-- Le passage en réel (reinitialiser(…, true)) vide `email_test`.

ALTER TABLE fidelite.messages ADD COLUMN IF NOT EXISTS apercu_envoye_le timestamptz;

INSERT INTO fidelite.config (cle, valeur, description) VALUES
    ('email_test', '"gael.poujol@wepe.fr"', 'dry-run : les messages simulés sont envoyés à cette adresse ("" = aucun envoi)')
ON CONFLICT (cle) DO NOTHING;

-- Envoi d'un aperçu autorisé maintenant ? (dry-run, adresse de test, e-mail, 10 h–19 h)
CREATE OR REPLACE FUNCTION fidelite.apercu_autorise(p_canal text, p_maintenant timestamptz DEFAULT now()) RETURNS boolean
LANGUAGE sql STABLE SET search_path = fidelite AS $$
    WITH l AS (SELECT p_maintenant AT TIME ZONE 'Europe/Paris' AS t)
    SELECT cfg('dry_run') = 'true'::jsonb
       AND coalesce(cfg_txt('email_test'), '') <> ''
       AND p_canal = 'email'
       AND extract(hour FROM l.t) >= cfg_int('envoi_heure_debut')
       AND extract(hour FROM l.t) < cfg_int('envoi_heure_fin')
    FROM l
$$;

CREATE OR REPLACE FUNCTION fidelite.reinitialiser(p_lancement date, p_reel boolean) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = fidelite AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM messages WHERE statut IN ('a_envoyer', 'envoye', 'echec')) THEN
        RAISE EXCEPTION 'des messages réels existent déjà : réinitialisation refusée';
    END IF;
    DELETE FROM messages;
    DELETE FROM cadeaux;
    DELETE FROM tunnel;
    UPDATE config SET valeur = to_jsonb(p_lancement::text) WHERE cle = 'date_lancement';
    UPDATE config SET valeur = to_jsonb(NOT p_reel) WHERE cle = 'dry_run';
    IF p_reel THEN
        UPDATE config SET valeur = '""' WHERE cle = 'email_test';
    END IF;
    RETURN CASE WHEN p_reel THEN 'envoi réel' ELSE 'dry-run' END || ', lancement le ' || p_lancement;
END $$;
