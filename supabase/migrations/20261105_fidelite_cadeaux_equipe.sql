-- Fidélité : nouveaux cadeaux des paliers (demande de Gaël, 31/10) — raquettes et boisson
-- pour toute l'équipe, la planche devient un saucisson, le palier 4 ajoute pizza ou saucisson.

UPDATE fidelite.paliers p SET libelle = v.libelle, formule = v.formule, titre = v.titre,
                              detail = v.detail, choix_requis = v.choix
FROM (VALUES
    (1, 'Raquettes offertes à toute l''équipe', 'les raquettes offertes pour toi et tes coéquipiers',
        'Raquettes offertes', 'pour toi et tes coéquipiers', false),
    (2, 'Boisson offerte à toute l''équipe', 'la boisson offerte pour toi et tes coéquipiers',
        'Boisson offerte', 'pour toi et tes coéquipiers', false),
    (3, 'Pizza ou saucisson offert', 'une pizza ou un saucisson offert',
        'Pizza ou saucisson', 'offert', true),
    (4, 'Tournée + pizza ou saucisson', 'la tournée offerte, plus une pizza ou un saucisson',
        'Tournée offerte', '+ pizza ou saucisson', true)) v(rang, libelle, formule, titre, detail, choix)
WHERE p.sport = 'padel' AND p.rang = v.rang;

UPDATE fidelite.config SET valeur = '{"libelle": "Pizza ou saucisson + raquettes offertes", "formule": "une pizza ou un saucisson, et les raquettes offertes pour toi et tes coéquipiers", "choix_requis": true}'
WHERE cle = 'cadeau_grand_retour';

UPDATE fidelite.templates t SET sujet = v.sujet, corps = v.corps
FROM (VALUES
    ('annonce_1', 'email', 'Tes raquettes sont offertes pour toi et tes coéquipiers',
     E'Salut {prenom},\n\nMerci d''être venu jouer au Rebond ! Reviens d''ici le {date_limite} : les raquettes sont offertes pour toi et tes coéquipiers à ta prochaine partie.\n\nRéserve ton prochain créneau : {lien}'),
    ('annonce_2', 'email', 'Ta boisson est offerte à la prochaine partie',
     E'2 parties en une semaine, bravo {prenom} !\n\nJoue ta prochaine partie avant le {date_limite} : la boisson est offerte pour toi et tes coéquipiers.\n\nRéserve ici : {lien}'),
    ('annonce_3', 'email', 'Pizza ou saucisson offert lors de ta prochaine partie',
     E'Jamais 2 sans 3, {prenom} !\n\nReviens avant le {date_limite} : une pizza ou un saucisson t''est offert lors de ta prochaine partie.\n\nRéserve ici : {lien}'),
    ('annonce_4', 'email', 'Tournée offerte + pizza ou saucisson à ta prochaine partie',
     E'4 parties, t''es des nôtres {prenom} !\n\nLors de ta prochaine partie, avant le {date_limite} : la tournée est offerte, plus une pizza ou un saucisson.\n\nRéserve ici : {lien}'),
    -- « profiter de {cadeau} » donnait « profiter de les raquettes… ».
    ('rappel', 'email', 'Plus que {jours_restants} pour ton cadeau',
     E'{prenom}, plus que {jours_restants} pour profiter de ton cadeau : {cadeau}.\n\nIl reste des créneaux : {lien}'),
    ('rappel', 'sms', NULL, '{prenom}, plus que {jours_restants} pour profiter de ton cadeau : {cadeau}. Il reste des créneaux : {lien}'),
    ('annonce_1', 'sms', NULL, 'Salut {prenom}, merci d''être venu au Rebond ! Reviens jouer d''ici le {date_limite} : raquettes offertes pour toi et tes coéquipiers. Réserve ici : {lien}'),
    ('annonce_2', 'sms', NULL, '2 parties en une semaine, bravo {prenom} ! Prochaine partie avant le {date_limite} : la boisson est offerte pour toi et tes coéquipiers. {lien}'),
    ('annonce_3', 'sms', NULL, 'Jamais 2 sans 3 ! Reviens avant le {date_limite} : une pizza ou un saucisson offert lors de ta prochaine partie. {lien}'),
    ('annonce_4', 'sms', NULL, '4 parties, t''es des nôtres {prenom} ! La prochaine avant le {date_limite} : tournée offerte + une pizza ou un saucisson. {lien}')
) v(code, canal, sujet, corps)
WHERE t.code = v.code AND t.canal = v.canal;

-- Cadeaux encore actifs : ils prennent le nouveau texte de leur palier.
UPDATE fidelite.cadeaux c SET libelle = p.libelle, formule = p.formule, choix_requis = p.choix_requis
FROM fidelite.paliers p
WHERE c.statut = 'actif' AND c.origine <> 'grand_retour' AND p.sport = 'padel' AND p.rang = c.palier;
UPDATE fidelite.cadeaux SET libelle = fidelite.cfg('cadeau_grand_retour')->>'libelle',
                            formule = fidelite.cfg('cadeau_grand_retour')->>'formule'
WHERE statut = 'actif' AND origine = 'grand_retour';

-- Choix au bar : pizza ou saucisson (« planche » reste lisible dans l'historique).
ALTER TABLE fidelite.cadeaux DROP CONSTRAINT IF EXISTS cadeaux_choix_check;
ALTER TABLE fidelite.cadeaux ADD CONSTRAINT cadeaux_choix_check CHECK (choix IN ('pizza', 'saucisson', 'planche'));

CREATE OR REPLACE FUNCTION public.fidelite_bar_utiliser(p_cadeau uuid, p_choix text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = fidelite, public AS $$
DECLARE c record; v_jour date := (fidelite.maintenant() AT TIME ZONE 'Europe/Paris')::date;
BEGIN
    IF NOT public.est_staff() THEN RAISE EXCEPTION 'réservé au staff' USING ERRCODE = '42501'; END IF;
    SELECT * INTO c FROM cadeaux WHERE id = p_cadeau FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cadeau introuvable.'; END IF;
    IF c.statut <> 'actif' THEN RAISE EXCEPTION 'Ce cadeau n''est plus utilisable (%).', c.statut; END IF;
    IF v_jour < c.valable_du THEN RAISE EXCEPTION 'Ce cadeau est valable à partir du %.', date_fr(c.valable_du); END IF;
    IF v_jour > c.expire_le THEN RAISE EXCEPTION 'Ce cadeau a expiré le %.', date_fr(c.expire_le); END IF;
    IF c.choix_requis AND coalesce(p_choix, '') NOT IN ('pizza', 'saucisson') THEN
        RAISE EXCEPTION 'Indique le choix : pizza ou saucisson.';
    END IF;
    UPDATE cadeaux SET statut = 'utilise', utilise_le = fidelite.maintenant(), choix = CASE WHEN c.choix_requis THEN p_choix END,
                       utilise_par = (SELECT email FROM public.staff WHERE user_id = auth.uid())
    WHERE id = p_cadeau;
    RETURN jsonb_build_object('ok', true, 'libelle', c.libelle, 'code', c.code);
END $$;
