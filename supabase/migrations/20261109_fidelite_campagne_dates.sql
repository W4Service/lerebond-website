-- Fidélité : campagne avec la période seule en gras, au format « 01 novembre au 08 novembre
-- 2026 » (demande de Gaël, 31/10/2026). Le prix n'est plus en gras.

-- « 08 novembre 2026 » ; sans l'année quand `p_annee` est faux.
CREATE OR REPLACE FUNCTION fidelite.date_courte(p date, p_annee boolean DEFAULT true) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
    SELECT to_char(p, 'DD') || ' '
        || (ARRAY['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août',
                  'septembre', 'octobre', 'novembre', 'décembre'])[extract(month FROM p)]
        || CASE WHEN p_annee THEN ' ' || extract(year FROM p)::int ELSE '' END
$$;

CREATE OR REPLACE FUNCTION fidelite.campagne_message(p_prenom text, p_jeton uuid, p_code text, p_debut date, p_fin date,
                                                     OUT sujet text, OUT corps text, OUT donnees jsonb)
LANGUAGE plpgsql STABLE SET search_path = fidelite, public AS $$
DECLARE t record; v_pied text; v_vars jsonb; g jsonb := cfg('campagne_5e');
BEGIN
    SELECT * INTO t FROM templates WHERE code = 'campagne_5e' AND canal = 'email';
    SELECT templates.corps INTO v_pied FROM templates WHERE code = 'pied' AND canal = 'email';
    v_pied := CASE WHEN strpos(v_pied, '—') > 0 THEN substr(v_pied, strpos(v_pied, '—')) ELSE v_pied END;
    v_vars := jsonb_build_object(
        'prenom', coalesce(p_prenom, ''),
        -- L'année n'est répétée au début que si la période change d'année.
        'date_debut', date_courte(p_debut, extract(year FROM p_debut) <> extract(year FROM p_fin)),
        'date_limite', date_courte(p_fin),
        'cadeau', g->>'formule', 'code', p_code, 'lien', cfg_txt('lien_reservation'),
        'lien_desinscription', site_url() || '/desinscription/?t=' || p_jeton);
    sujet := rendre(t.sujet, v_vars);
    corps := rendre(t.corps || E'\n\n' || v_pied, v_vars);
    donnees := jsonb_build_object('qr_url', site_url() || '/admin/client/?j=' || p_jeton, 'code', p_code,
                                  'cadeau', g->>'libelle', 'origine', 'campagne',
                                  'expire_le', p_fin, 'date_limite', date_courte(p_fin));
END $$;

UPDATE fidelite.templates
SET corps = E'Salut {prenom},\n\n**Du {date_debut} au {date_limite} inclus**, la partie de padel au Rebond est à 5 € par joueur et par heure, pour toi et ton équipe.\n\nComment en profiter :\n1. Réserve ton terrain en ligne comme d''habitude, avec ton empreinte bancaire.\n2. À ton arrivée, présente ce QR code (ou ton code {code}) à l''accueil : la réduction est faite sur place.\n\nPassé le {date_limite}, le code ne fonctionne plus.\n\nRéserve ici : {lien}'
WHERE code = 'campagne_5e' AND canal = 'email';
