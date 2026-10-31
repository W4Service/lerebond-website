-- Scénarios du moteur fidélité. Chaque scénario repart de zéro, crée des clients et des
-- réservations LiveXperience, puis rejoue le calcul quotidien jour par jour (10 h, Paris).
-- Lancement fixé au lundi 2 novembre 2026, dry-run, sans groupe témoin sauf mention.
SET client_min_messages = warning;
CREATE SCHEMA t;

CREATE TABLE t.resultats (n serial, nom text, ok boolean, detail text);
CREATE FUNCTION t.check(p_nom text, p_ok boolean, p_detail text DEFAULT NULL) RETURNS void
LANGUAGE sql AS $$ INSERT INTO t.resultats (nom, ok, detail) VALUES (p_nom, coalesce(p_ok, false), p_detail) $$;

CREATE FUNCTION t.a(d date, h text DEFAULT '10:00') RETURNS timestamptz
LANGUAGE sql IMMUTABLE AS $$ SELECT (d + h::time) AT TIME ZONE 'Europe/Paris' $$;
CREATE FUNCTION t.jour(d date) RETURNS jsonb LANGUAGE sql AS $$ SELECT fidelite.calculer(t.a(d)) $$;
CREATE FUNCTION t.simuler(du date, au date) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    FOR d IN 0..(au - du) LOOP PERFORM t.jour(du + d); END LOOP;
END $$;

CREATE FUNCTION t.reset() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    TRUNCATE livex.livex_clients, livex.livex_reservations;
    TRUNCATE fidelite.messages, fidelite.cadeaux, fidelite.tunnel, fidelite.clients,
             fidelite.consentements, fidelite.parties CASCADE;
    UPDATE fidelite.config SET valeur = 'true' WHERE cle = 'dry_run';
    UPDATE fidelite.config SET valeur = '"2026-11-02"' WHERE cle = 'date_lancement';
    UPDATE fidelite.config SET valeur = '0' WHERE cle = 'pourcentage_temoin';
    PERFORM set_config('fidelite.maintenant', '', false);
    PERFORM set_config('test.uid', '', false);
END $$;

CREATE FUNCTION t.client(p_ref text, p_prenom text, p_tel text DEFAULT NULL, p_mail text DEFAULT '') RETURNS void
LANGUAGE sql AS $$
    INSERT INTO livex.livex_clients (ref, origine, nom, prenom, cree_le, type_client, mail, telephone)
    VALUES (p_ref, 'Club', 'TEST' || p_ref, upper(p_prenom), '2026/11/01', 'Joueur',
            CASE WHEN p_mail = '' THEN lower(p_prenom) || p_ref || '@exemple.fr' ELSE p_mail END,
            coalesce(p_tel, '06000' || lpad(p_ref, 5, '0')))
$$;

CREATE SEQUENCE t.resa;
CREATE FUNCTION t.partie(p_ref text, p_debut text, p_ressource text DEFAULT '3119', p_minutes integer DEFAULT 90)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_id text := 'R' || nextval('t.resa');
BEGIN
    INSERT INTO livex.livex_reservations (id, type_resa, title, resource_id, start, "end", id_client, _jour)
    VALUES (v_id, 'reservation', 'TEST ' || p_ref || E'\n\n0600000000', p_ressource, p_debut,
            to_char(p_debut::timestamp + make_interval(mins => p_minutes), 'YYYY-MM-DD HH24:MI'),
            p_ref, left(p_debut, 10));
    RETURN v_id;
END $$;

-- Date locale de création du message d'un type, NULL s'il n'existe pas.
CREATE FUNCTION t.msg_jour(p_personne text, p_type text) RETURNS date LANGUAGE sql AS $$
    SELECT min((cree_le AT TIME ZONE 'Europe/Paris')::date) FROM fidelite.messages WHERE personne = p_personne AND type = p_type
$$;
CREATE FUNCTION t.nb_msg(p_personne text, p_type text DEFAULT NULL) RETURNS integer LANGUAGE sql AS $$
    SELECT count(*)::int FROM fidelite.messages WHERE personne = p_personne AND (p_type IS NULL OR type = p_type)
$$;
CREATE FUNCTION t.erreur(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE p_sql;
    RETURN NULL;
EXCEPTION WHEN OTHERS THEN
    RETURN SQLERRM;
END $$;

-- ===================================================================== outils
DO $$ BEGIN
    PERFORM t.check('tél. 06 12 34 56 78 → +33612345678', fidelite.tel_e164('06 12 34 56 78') = '+33612345678');
    PERFORM t.check('tél. 0 initial perdu (631091997) → +33631091997', fidelite.tel_e164(' 631091997') = '+33631091997');
    PERFORM t.check('tél. tronqué (+336257154) → NULL', fidelite.tel_e164('+336257154') IS NULL);
    PERFORM t.check('tél. « x » → NULL', fidelite.tel_e164('x') IS NULL);
    PERFORM t.check('heures creuses : mardi 10 h oui, 12 h non, 19 h non, 22 h 30 oui, 23 h 59 oui',
        fidelite.est_heure_creuse(t.a('2026-11-03', '10:00')) AND NOT fidelite.est_heure_creuse(t.a('2026-11-03', '12:00'))
        AND NOT fidelite.est_heure_creuse(t.a('2026-11-03', '19:00')) AND fidelite.est_heure_creuse(t.a('2026-11-03', '22:30'))
        AND fidelite.est_heure_creuse(t.a('2026-11-03', '23:59')));
    PERFORM t.check('texte des heures creuses', fidelite.texte_heures_creuses() = '9h–12h, 14h–17h, 22h30–0h',
                    fidelite.texte_heures_creuses());
    PERFORM t.check('newsletter : 1er mardi (3/11 oui, 10/11 non, 1/12 oui)',
        fidelite.est_jour_newsletter('2026-11-03') AND NOT fidelite.est_jour_newsletter('2026-11-10')
        AND fidelite.est_jour_newsletter('2026-12-01'));
    PERFORM t.check('montants : « 12,50 € » → 12.5, « -15 € » → -15, « - » et « None » → NULL',
        fidelite.eur('12,50 €') = 12.5 AND fidelite.eur('-15 €') = -15 AND fidelite.eur('-') IS NULL AND fidelite.eur('None') IS NULL);
    PERFORM t.check('date en français', fidelite.date_fr('2026-11-09') = 'lundi 9 novembre'
                    AND fidelite.date_fr('2026-12-01') = 'mardi 1er décembre');
END $$;

-- ===================================================================== 1. retour en heures creuses
DO $$
DECLARE g1 uuid; m record; f jsonb;
BEGIN
    PERFORM t.reset();
    PERFORM t.client('1001', 'alice');
    PERFORM t.partie('1001', '2026-11-02 10:00');
    PERFORM t.partie('1001', '2026-11-05 10:00');
    PERFORM t.simuler('2026-11-02', '2026-11-04');
    PERFORM t.check('1. entrée dans le tunnel au lendemain de la 1re partie',
        (SELECT palier = 1 AND groupe = 'cible' AND echeance = '2026-11-09' FROM fidelite.tunnel WHERE personne = '1001'));
    SELECT id INTO g1 FROM fidelite.cadeaux WHERE personne = '1001' AND statut = 'actif';
    PERFORM t.check('1. cadeau palier 1 = raquettes, valable du 3 au 9/11',
        (SELECT libelle LIKE 'Raquettes%' AND valable_du = '2026-11-03' AND expire_le = '2026-11-09' FROM fidelite.cadeaux WHERE id = g1));
    SELECT * INTO m FROM fidelite.messages WHERE personne = '1001' AND type = 'annonce';
    PERFORM t.check('1. annonce J+1 en dry-run (simule), par e-mail', m.statut = 'simule' AND m.canal = 'email'
                    AND (m.cree_le AT TIME ZONE 'Europe/Paris')::date = '2026-11-03');
    PERFORM t.check('1. texte : prénom, date limite, lien, code, QR, désinscription, plus d''horaires',
        m.corps LIKE 'Salut Alice,%' AND m.corps LIKE '%au Rebond !%' AND m.corps LIKE '%d''ici le lundi 9 novembre%' AND m.corps LIKE '%lerebond.mymobileapp.fr%'
        AND m.corps LIKE '%' || (SELECT code FROM fidelite.cadeaux WHERE id = g1) || '%'
        AND m.corps LIKE '%QR code%' AND m.corps NOT LIKE '%heures creuses%' AND m.corps LIKE '%/desinscription/?t=%', m.corps);
    PERFORM t.check('1. QR code : lien vers la fiche client',
        m.donnees->>'qr_url' = 'https://le-rebond.fr/admin/client/?j=' || (SELECT jeton FROM fidelite.clients WHERE id_client = '1001'));
    PERFORM t.check('1. échelle : palier 1 en cours, palier 2 à 1 réservation, régulier à 4',
        m.donnees->'paliers'->0->>'etat' = 'actuel' AND m.donnees->'paliers'->1->>'etat' = 'a_debloquer'
        AND (m.donnees->'paliers'->1->>'manque')::int = 1 AND (m.donnees->'paliers'->4->>'manque')::int = 4
        AND m.donnees->'paliers'->4->>'libelle' = 'Joueur régulier du Rebond', m.donnees::text);
    PERFORM t.check('1. échelle : titres courts et détails pour l''escalier',
        (SELECT donnees->'paliers'->0->>'titre' = 'Raquettes offertes' AND donnees->'paliers'->0->>'detail' = 'aux 4 joueurs'
                AND donnees->'paliers'->4->>'titre' = 'Régulier'
         FROM fidelite.messages WHERE personne = '1001' AND type = 'annonce' ORDER BY cree_le LIMIT 1)
        OR fidelite.echelle('1001')->0->>'titre' = 'Raquettes offertes');

    -- Le bar valide le cadeau pendant la partie du jeudi.
    INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-000000000001', 'bar@le-rebond.fr');
    INSERT INTO public.staff VALUES ('00000000-0000-0000-0000-000000000001', 'bar@le-rebond.fr') ON CONFLICT DO NOTHING;
    PERFORM set_config('test.uid', '00000000-0000-0000-0000-000000000001', false);
    PERFORM set_config('fidelite.maintenant', t.a('2026-11-05', '11:30')::text, false);
    PERFORM t.check('1. bar : recherche par prénom', jsonb_array_length(public.fidelite_bar_recherche('alic')) = 1);
    PERFORM t.check('1. bar : recherche par téléphone', (public.fidelite_bar_recherche('0600001001')->0->>'personne') = '1001');
    PERFORM t.check('1. bar : recherche par code',
        (public.fidelite_bar_recherche((SELECT code FROM fidelite.cadeaux WHERE id = g1))->0->'cadeau'->>'id')::uuid = g1);
    PERFORM t.check('1. bar : cadeau utilisé', (public.fidelite_bar_utiliser(g1)->>'ok')::boolean);
    PERFORM t.check('1. bar : second usage refusé',
        t.erreur(format('SELECT public.fidelite_bar_utiliser(%L)', g1)) LIKE '%plus utilisable%');
    PERFORM set_config('test.uid', '', false);
    PERFORM t.check('1. bar : refusé hors staff', t.erreur('SELECT public.fidelite_bar_recherche(''alice'')') LIKE '%staff%');
    PERFORM set_config('fidelite.maintenant', '', false);

    PERFORM t.simuler('2026-11-05', '2026-11-12');
    PERFORM t.check('1. retour en HC : palier 2', (SELECT palier FROM fidelite.tunnel WHERE personne = '1001') = 2);
    PERFORM t.check('1. le cadeau utilisé le reste', (SELECT statut FROM fidelite.cadeaux WHERE id = g1) = 'utilise');
    PERFORM t.check('1. nouveau cadeau : boisson',
        (SELECT libelle FROM fidelite.cadeaux WHERE personne = '1001' AND statut = 'actif') LIKE 'Boisson%');
    PERFORM t.check('1. plafond : la 2e annonce attend 7 jours après la 1re (le 10/11, pas le 6/11)',
        (SELECT max((cree_le AT TIME ZONE 'Europe/Paris')::date) FROM fidelite.messages WHERE personne = '1001' AND type = 'annonce') = '2026-11-10');
    PERFORM t.check('1. échelle de la 2e annonce : palier 1 validé, palier 2 en cours',
        (SELECT donnees->'paliers'->0->>'etat' = 'valide' AND donnees->'paliers'->1->>'etat' = 'actuel' AND (donnees->>'palier')::int = 2
         FROM fidelite.messages WHERE personne = '1001' AND type = 'annonce' ORDER BY cree_le DESC LIMIT 1));

    -- Fiche client (QR code) : réservations, cadeaux, passages en caisse rapprochés par le nom.
    INSERT INTO livex.livex_paiements_jour (numero, heure, client, description, statut, cb, _jour)
    VALUES ('4585', '20:43', 'Test1001' || chr(160) || 'Alice', 'Nouvelle commande', 'Validé', '12,50', '2026-11-05'),
           ('4586', '21:00', 'Autre' || chr(160) || 'Client', 'Nouvelle commande', 'Validé', '9,00', '2026-11-05');
    PERFORM set_config('test.uid', '00000000-0000-0000-0000-000000000001', false);
    PERFORM set_config('fidelite.maintenant', t.a('2026-11-12', '11:00')::text, false);
    SELECT public.fidelite_fiche_client((SELECT jeton FROM fidelite.clients WHERE id_client = '1001')) INTO f;
    PERFORM t.check('1. fiche : 2 réservations, 2 parties de padel',
        jsonb_array_length(f->'reservations') = 2 AND (f->'stats'->>'parties_padel')::int = 2, f->>'stats');
    PERFORM t.check('1. fiche : cadeaux (utilisé + en cours) et offre active',
        jsonb_array_length(f->'cadeaux') = 2 AND f->'cadeau'->>'libelle' LIKE 'Boisson%');
    PERFORM t.check('1. fiche : passage en caisse de 12,50 € retrouvé par le nom (et pas celui d''un autre)',
        jsonb_array_length(f->'caisse') = 1 AND (f->'caisse'->0->>'montant')::numeric = 12.5, f->>'caisse');
    PERFORM set_config('test.uid', '', false);
    PERFORM t.check('1. fiche : refusée hors staff',
        t.erreur(format('SELECT public.fidelite_fiche_client(%L)', (SELECT jeton FROM fidelite.clients WHERE id_client = '1001'))) LIKE '%staff%');
    PERFORM set_config('fidelite.maintenant', '', false);
END $$;

-- ===================================================================== 2. retour en heures pleines (valable à toute heure)
DO $$ BEGIN
    PERFORM t.reset();
    PERFORM t.client('1002', 'bruno');
    PERFORM t.partie('1002', '2026-11-02 10:00');
    PERFORM t.partie('1002', '2026-11-04 19:00');
    PERFORM t.simuler('2026-11-02', '2026-11-06');
    PERFORM t.check('2. retour en heures pleines : le palier avance',
        (SELECT palier FROM fidelite.tunnel WHERE personne = '1002') = 2);
    PERFORM t.check('2. pas de perte en heures pleines : non réclamé = expiré, jamais perdu_hp',
        (SELECT statut FROM fidelite.cadeaux WHERE personne = '1002' AND palier = 1) = 'expire'
        AND NOT EXISTS (SELECT 1 FROM fidelite.cadeaux WHERE statut = 'perdu_hp'));
    PERFORM t.check('2. le cadeau du palier 2 est ouvert',
        EXISTS (SELECT 1 FROM fidelite.cadeaux WHERE personne = '1002' AND palier = 2 AND statut = 'actif'));
END $$;

-- ===================================================================== 3-4. pas de retour, rappel, rattrapage, double rattrapage
DO $$ BEGIN
    PERFORM t.reset();
    PERFORM t.client('1003', 'chloé');
    PERFORM t.partie('1003', '2026-11-02 14:00');
    PERFORM t.simuler('2026-11-02', '2026-11-16');
    PERFORM t.check('3. rappel J+5 envoyé le 7/11 (annonce + rappel tolérés dans la semaine)',
        t.msg_jour('1003', 'rappel') = '2026-11-07');
    PERFORM t.check('3. rappel : « plus que 3 jours » (le 7, offre jusqu''au 9 inclus)',
        (SELECT corps LIKE '%plus que 3 jours%' FROM fidelite.messages WHERE personne = '1003' AND type = 'rappel'));
    PERFORM t.check('3. pas revenu : palier inchangé, cadeau expiré',
        (SELECT palier FROM fidelite.tunnel WHERE personne = '1003') = 1
        AND (SELECT statut FROM fidelite.cadeaux WHERE personne = '1003' AND origine = 'palier') = 'expire');
    PERFORM t.check('3. rattrapage J+14 le 16/11, même cadeau, 7 jours',
        t.msg_jour('1003', 'rattrapage') = '2026-11-16'
        AND (SELECT libelle LIKE 'Raquettes%' AND valable_du = '2026-11-16' AND expire_le = '2026-11-22'
             FROM fidelite.cadeaux WHERE personne = '1003' AND origine = 'rattrapage'));
    PERFORM t.partie('1003', '2026-11-18 10:00');
    PERFORM t.simuler('2026-11-17', '2026-11-19');
    PERFORM t.check('3. revenu pendant le rattrapage : palier 2',
        (SELECT palier = 2 AND rattrapage_utilise AND statut = 'actif' FROM fidelite.tunnel WHERE personne = '1003'));
    UPDATE livex.livex_reservations SET prix = '48' WHERE id_client = '1003' AND start = '2026-11-18 10:00';
    PERFORM t.jour('2026-11-19');     -- recopie le prix dans la base fidélité
    PERFORM set_config('fidelite.maintenant', t.a('2026-11-19')::text, false);
    PERFORM t.check('3. conversions : le rattrapage a converti (1 partie, 48 €), pas l''annonce ni le rappel',
        (SELECT conversions = 1 AND parties = 1 AND ca = 48 FROM fidelite.v_suivi_conversions WHERE type = 'rattrapage')
        AND (SELECT conversions = 0 FROM fidelite.v_suivi_conversions WHERE type = 'annonce')
        AND (SELECT conversions = 0 FROM fidelite.v_suivi_conversions WHERE type = 'rappel'));
    PERFORM set_config('fidelite.maintenant', '', false);
    PERFORM t.simuler('2026-11-20', '2026-12-15');
    PERFORM t.check('4. second rattrapage refusé (un seul par client)', t.nb_msg('1003', 'rattrapage') = 1);
    PERFORM t.check('4. fenêtre suivante manquée → décroché', (SELECT statut FROM fidelite.tunnel WHERE personne = '1003') = 'decroche');
END $$;

-- ===================================================================== 5. pas revenu après le rattrapage
DO $$ BEGIN
    PERFORM t.reset();
    PERFORM t.client('1005', 'david');
    PERFORM t.partie('1005', '2026-11-02 10:00');
    PERFORM t.simuler('2026-11-02', '2026-11-22');
    PERFORM t.check('5. encore actif le dernier jour du rattrapage (22/11)', (SELECT statut FROM fidelite.tunnel WHERE personne = '1005') = 'actif');
    PERFORM t.jour('2026-11-23');
    PERFORM t.check('5. décroché le 23/11', (SELECT statut FROM fidelite.tunnel WHERE personne = '1005') = 'decroche');
    PERFORM t.check('5. plus aucune offre active', NOT EXISTS (SELECT 1 FROM fidelite.cadeaux WHERE personne = '1005' AND statut = 'actif'));
END $$;

-- ===================================================================== 6. plafond hebdo et newsletter
DO $$ BEGIN
    PERFORM t.reset();
    PERFORM t.client('1006', 'emma');
    PERFORM t.client('1016', 'félix');
    PERFORM t.partie('1006', '2026-11-30 10:00');
    PERFORM t.partie('1016', '2026-11-30 10:00');
    PERFORM t.jour('2026-11-29');      -- crée les fiches
    UPDATE fidelite.clients SET newsletter_ok = true WHERE id_client = '1006';
    PERFORM t.simuler('2026-11-30', '2026-12-09');
    PERFORM t.check('6. inscrit à la newsletter du 1er/12 : pas d''annonce dans la semaine', t.nb_msg('1006') = 0);
    PERFORM t.check('6. non inscrit : annonce le 1er/12', t.msg_jour('1016', 'annonce') = '2026-12-01');
    PERFORM t.check('6. idempotence : rejouer un jour ne crée rien',
        (SELECT count(*) FROM fidelite.messages) = (SELECT count(*) FROM fidelite.messages WHERE fidelite.calculer(t.a('2026-12-03')) IS NOT NULL)
        AND (SELECT count(*) FROM fidelite.messages) = 2);
END $$;

-- ===================================================================== 7. groupe témoin
DO $$ BEGIN
    PERFORM t.reset();
    UPDATE fidelite.config SET valeur = '100' WHERE cle = 'pourcentage_temoin';
    PERFORM t.client('1007', 'gaston');
    PERFORM t.partie('1007', '2026-11-02 10:00');
    PERFORM t.partie('1007', '2026-11-05 10:00');
    PERFORM t.simuler('2026-11-02', '2026-11-30');
    PERFORM t.check('7. témoin : suivi dans le tunnel (palier 2)',
        (SELECT groupe = 'temoin' AND palier = 2 FROM fidelite.tunnel WHERE personne = '1007'));
    PERFORM t.check('7. témoin : aucun message, aucun cadeau',
        t.nb_msg('1007') = 0 AND NOT EXISTS (SELECT 1 FROM fidelite.cadeaux WHERE personne = '1007'));
    PERFORM t.check('7. témoin : rattrapage virtuel puis décroché',
        (SELECT rattrapage_utilise AND statut = 'decroche' FROM fidelite.tunnel WHERE personne = '1007'));
    UPDATE fidelite.config SET valeur = '10' WHERE cle = 'pourcentage_temoin';
    PERFORM t.check('7. tirage à 10 % : entre 5 et 15 % sur 1 000 clients',
        (SELECT count(*) FILTER (WHERE fidelite.groupe_de(g::text) = 'temoin') FROM generate_series(1, 1000) g) BETWEEN 50 AND 150);
END $$;

-- ===================================================================== 8. grand retour, une fois par an ; 11. client existant
DO $$
DECLARE g uuid;
BEGIN
    PERFORM t.reset();
    PERFORM t.client('1008', 'hélène');
    PERFORM t.client('1018', 'igor');
    PERFORM t.partie('1008', '2026-08-01 10:00');
    PERFORM t.partie('1018', '2026-10-20 10:00');
    PERFORM t.partie('1018', '2026-11-03 10:00');
    PERFORM t.simuler('2026-11-02', '2026-11-05');
    PERFORM t.check('11. client existant au lancement : hors tunnel', NOT EXISTS (SELECT 1 FROM fidelite.tunnel WHERE personne = '1018'));
    PERFORM t.check('11. client existant : aucun message', t.nb_msg('1018') = 0);
    PERFORM t.check('8. grand retour (inactif depuis le 1/08) le 2/11', t.msg_jour('1008', 'grand_retour') = '2026-11-02');
    SELECT id INTO g FROM fidelite.cadeaux WHERE personne = '1008' AND origine = 'grand_retour';
    PERFORM t.check('8. cadeau grand retour valable 21 jours, choix pizza/planche',
        (SELECT valable_du = '2026-11-02' AND expire_le = '2026-11-22' AND choix_requis FROM fidelite.cadeaux WHERE id = g));

    INSERT INTO public.staff VALUES ('00000000-0000-0000-0000-000000000002', 'bar2@le-rebond.fr') ON CONFLICT DO NOTHING;
    PERFORM set_config('test.uid', '00000000-0000-0000-0000-000000000002', false);
    PERFORM set_config('fidelite.maintenant', t.a('2026-11-05', '15:00')::text, false);
    PERFORM t.check('14. bar : pizza ou planche obligatoire',
        t.erreur(format('SELECT public.fidelite_bar_utiliser(%L)', g)) LIKE '%pizza ou planche%');
    PERFORM t.check('14. bar : utilisé avec le choix « planche »', (public.fidelite_bar_utiliser(g, 'planche')->>'ok')::boolean);
    PERFORM t.check('14. bar : choix et membre du staff enregistrés',
        (SELECT choix = 'planche' AND utilise_par = 'bar2@le-rebond.fr' FROM fidelite.cadeaux WHERE id = g));
    PERFORM set_config('fidelite.maintenant', '', false);
    PERFORM set_config('test.uid', '', false);

    PERFORM t.simuler('2026-11-06', '2026-12-31');
    PERFORM t.check('8. pas de second grand retour dans l''année', t.nb_msg('1008', 'grand_retour') = 1);
    PERFORM t.jour('2027-11-03');
    PERFORM t.check('8. nouveau grand retour un an plus tard', t.nb_msg('1008', 'grand_retour') = 2);
END $$;

-- ===================================================================== 8 bis. grands retours étalés
DO $$ BEGIN
    PERFORM t.reset();
    UPDATE fidelite.config SET valeur = '2' WHERE cle = 'grand_retour_max_par_jour';
    PERFORM t.client('1031', 'ugo');
    PERFORM t.client('1032', 'vera');
    PERFORM t.client('1033', 'willy');
    PERFORM t.partie('1031', '2026-06-01 10:00');
    PERFORM t.partie('1032', '2026-08-01 10:00');
    PERFORM t.partie('1033', '2026-07-01 10:00');
    PERFORM t.jour('2026-11-02');
    PERFORM t.check('8 bis. au plus 2 grands retours par jour, les plus récemment partis d''abord',
        (SELECT string_agg(personne, ',' ORDER BY personne) FROM fidelite.messages WHERE type = 'grand_retour') = '1032,1033');
    PERFORM t.jour('2026-11-03');
    PERFORM t.check('8 bis. le reste le lendemain', t.msg_jour('1031', 'grand_retour') = '2026-11-03');
    UPDATE fidelite.config SET valeur = '40' WHERE cle = 'grand_retour_max_par_jour';
END $$;

-- ===================================================================== 9. annulation d'une réservation
DO $$
DECLARE r text;
BEGIN
    PERFORM t.reset();
    PERFORM t.client('1009', 'julie');
    PERFORM t.partie('1009', '2026-11-02 10:00');
    r := t.partie('1009', '2026-11-08 10:00');
    PERFORM t.simuler('2026-11-02', '2026-11-07');
    PERFORM t.check('9. partie réservée à venir : pas de rappel', t.nb_msg('1009', 'rappel') = 0);
    DELETE FROM livex.livex_reservations WHERE id = r;     -- annulée : disparaît au sync suivant
    PERFORM t.simuler('2026-11-08', '2026-11-10');
    PERFORM t.check('9. après l''annulation : rappel le 8/11', t.msg_jour('1009', 'rappel') = '2026-11-08');
    PERFORM t.check('9. la partie annulée ne compte pas', (SELECT palier FROM fidelite.tunnel WHERE personne = '1009') = 1);
END $$;

-- ===================================================================== 10. five vs padel
DO $$ BEGIN
    PERFORM t.reset();
    PERFORM t.client('1010', 'karim');
    PERFORM t.client('1011', 'léa');
    PERFORM t.client('1012', 'marc');
    PERFORM t.partie('1010', '2026-11-02 10:00', '3122');
    PERFORM t.partie('1010', '2026-11-04 10:00', '3122');
    PERFORM t.partie('1011', '2026-11-02 10:00');
    PERFORM t.partie('1011', '2026-11-05 10:00', '3122');
    PERFORM t.partie('1012', '2026-10-15 19:00', '3122');
    PERFORM t.partie('1012', '2026-11-03 10:00');
    PERFORM t.simuler('2026-11-02', '2026-11-08');
    PERFORM t.check('10. five uniquement : hors tunnel, aucun message',
        NOT EXISTS (SELECT 1 FROM fidelite.tunnel WHERE personne = '1010') AND t.nb_msg('1010') = 0);
    PERFORM t.check('10. une partie de five ne fait pas avancer le padel', (SELECT palier FROM fidelite.tunnel WHERE personne = '1011') = 1);
    PERFORM t.check('10. déjà venu au five avant le lancement : pas nouveau', NOT EXISTS (SELECT 1 FROM fidelite.tunnel WHERE personne = '1012'));
END $$;

-- ===================================================================== 12. dry-run puis réel ; 13. désinscription
DO $$
DECLARE j uuid;
BEGIN
    PERFORM t.reset();
    PERFORM t.check('12. aperçu en dry-run : e-mail vers l''adresse de test, 10 h–19 h',
        fidelite.apercu_autorise('email', t.a('2026-11-03', '10:30')) AND NOT fidelite.apercu_autorise('email', t.a('2026-11-03', '20:00'))
        AND NOT fidelite.apercu_autorise('sms', t.a('2026-11-03', '10:30')));
    PERFORM t.check('12. passage en réel', fidelite.reinitialiser('2026-11-02', true) LIKE 'envoi réel%');
    PERFORM t.check('12. le passage en réel coupe la redirection vers l''adresse de test',
        fidelite.cfg_txt('email_test') = '' AND NOT fidelite.apercu_autorise('email', t.a('2026-11-03', '10:30')));
    PERFORM t.client('1013', 'nina');
    PERFORM t.client('1014', 'oscar', 'x', NULL);
    PERFORM t.client('1019', 'paul');
    PERFORM t.partie('1013', '2026-11-02 10:00');
    PERFORM t.partie('1014', '2026-11-02 10:00');
    PERFORM t.partie('1019', '2026-11-02 10:00');
    PERFORM t.jour('2026-11-02');
    SELECT jeton INTO j FROM fidelite.clients WHERE id_client = '1013';
    PERFORM t.check('13. préférences lisibles par le jeton', (public.fidelite_preferences(j)->>'relances')::boolean);
    PERFORM public.fidelite_consentement(j, false);
    PERFORM t.check('13. désinscription des relances tracée',
        (SELECT count(*) FROM fidelite.consentements WHERE personne = '1013' AND type = 'relances' AND NOT valeur) = 1
        AND NOT (public.fidelite_preferences(j)->>'relances')::boolean);
    PERFORM t.check('13. jeton inconnu refusé', t.erreur(format('SELECT public.fidelite_consentement(%L, false)', gen_random_uuid())) LIKE '%invalide%');
    PERFORM t.jour('2026-11-03');
    PERFORM t.check('12. en réel : message « a_envoyer »', (SELECT statut FROM fidelite.messages WHERE personne = '1019') = 'a_envoyer');
    PERFORM t.check('13. désinscrit : message bloqué', (SELECT statut = 'bloque' AND motif LIKE 'désinscrit%' FROM fidelite.messages WHERE personne = '1013'));
    PERFORM t.check('13. sans e-mail : message bloqué (aucune coordonnée)',
        (SELECT statut = 'bloque' AND motif LIKE 'aucune coordonnée%' FROM fidelite.messages WHERE personne = '1014'));
    PERFORM public.fidelite_consentement(j, NULL, true);
    PERFORM t.check('13. inscription newsletter séparée des relances',
        (public.fidelite_preferences(j)->>'newsletter')::boolean AND NOT (public.fidelite_preferences(j)->>'relances')::boolean);
    PERFORM t.check('13. le cadeau reste visible au bar même sans message',
        EXISTS (SELECT 1 FROM fidelite.cadeaux WHERE personne = '1013' AND statut = 'actif'));
    PERFORM t.check('12. envoi : 10 h 30 oui, 9 h 59 non, 19 h non',
        fidelite.envoi_autorise('email', t.a('2026-11-03', '10:30')) AND NOT fidelite.envoi_autorise('email', t.a('2026-11-03', '09:59'))
        AND NOT fidelite.envoi_autorise('email', t.a('2026-11-03', '19:00')));
    PERFORM t.check('12. pas de SMS le dimanche, e-mail oui',
        NOT fidelite.envoi_autorise('sms', t.a('2026-11-08', '11:00')) AND fidelite.envoi_autorise('email', t.a('2026-11-08', '11:00')));
    PERFORM t.check('12. réinitialisation refusée une fois des messages réels créés',
        t.erreur('SELECT fidelite.reinitialiser(''2026-11-02'', false)') LIKE '%refusée%');
    UPDATE fidelite.config SET valeur = 'true' WHERE cle = 'dry_run';
    PERFORM t.check('12. en dry-run, n8n n''envoie jamais', NOT fidelite.envoi_autorise('email', t.a('2026-11-03', '10:30')));
END $$;

-- ===================================================================== 15. retour tardif ; 16. régulier ; 17. doublons
DO $$ BEGIN
    PERFORM t.reset();
    PERFORM t.client('1015', 'quentin');
    PERFORM t.partie('1015', '2026-11-02 10:00');
    PERFORM t.partie('1015', '2026-11-12 10:00');
    PERFORM t.simuler('2026-11-02', '2026-11-13');
    PERFORM t.check('15. revenu après la fenêtre : palier inchangé', (SELECT palier FROM fidelite.tunnel WHERE personne = '1015') = 1);
    PERFORM t.check('15. nouvelle offre « retour » et message le 13/11',
        EXISTS (SELECT 1 FROM fidelite.cadeaux WHERE personne = '1015' AND origine = 'retour' AND statut = 'actif'
                AND expire_le = '2026-11-19')
        AND t.msg_jour('1015', 'retour') = '2026-11-13');

    PERFORM t.client('1017', 'rose');
    PERFORM t.partie('1017', '2026-11-02 10:00');
    PERFORM t.partie('1017', '2026-11-04 10:00');
    PERFORM t.partie('1017', '2026-11-06 10:00');
    PERFORM t.partie('1017', '2026-11-08 10:00');
    PERFORM t.partie('1017', '2026-11-10 10:00');
    PERFORM t.partie('1017', '2026-11-10 14:00');     -- 2 parties le même jour = 1
    PERFORM t.simuler('2026-11-02', '2026-11-11');
    PERFORM t.check('16. 5e partie : régulier, plus de cadeau',
        (SELECT statut = 'regulier' AND palier = 5 FROM fidelite.tunnel WHERE personne = '1017')
        AND NOT EXISTS (SELECT 1 FROM fidelite.cadeaux WHERE personne = '1017' AND statut = 'actif'));

    PERFORM t.client('1020', 'sam', '06 12 34 56 78');
    PERFORM t.client('1021', 'sam', '0612345678', 'autre@exemple.fr');
    PERFORM t.partie('1021', '2026-11-12 10:00');
    PERFORM t.jour('2026-11-13');
    PERFORM t.check('17. doublon (même téléphone) : une seule personne, la plus petite ref',
        (SELECT personne FROM fidelite.clients WHERE id_client = '1021') = '1020'
        AND EXISTS (SELECT 1 FROM fidelite.tunnel WHERE personne = '1020'));
END $$;

-- ===================================================================== suivi
DO $$ BEGIN
    INSERT INTO public.staff VALUES ('00000000-0000-0000-0000-000000000003', 'gerant@le-rebond.fr') ON CONFLICT DO NOTHING;
    PERFORM set_config('test.uid', '00000000-0000-0000-0000-000000000003', false);
    PERFORM t.check('suivi : tableau lisible par le staff (paliers, conversions, effet, messages)',
        jsonb_typeof(public.fidelite_tableau()->'paliers') = 'array' AND jsonb_typeof(public.fidelite_tableau()->'messages') = 'array'
        AND jsonb_typeof(public.fidelite_tableau()->'conversions') = 'array'
        AND jsonb_typeof(public.fidelite_tableau()->'conversions_total') = 'object'
        AND public.fidelite_tableau() ? 'effet' AND NOT public.fidelite_tableau() ? 'heures_creuses');
    PERFORM set_config('test.uid', '', false);
    PERFORM t.check('cron : calcul planifié à 8 h et 9 h UTC',
        (SELECT schedule FROM cron.job WHERE jobname = 'fidelite-calcul') = '0 8,9 * * *');
END $$;

\pset footer off
SELECT CASE WHEN ok THEN 'ok  ' ELSE 'FAIL' END AS " ", nom AS "scénario", coalesce(detail, '') AS "détail"
FROM t.resultats ORDER BY n;
SELECT count(*) FILTER (WHERE ok) || ' ok, ' || count(*) FILTER (WHERE NOT ok) || ' échec(s)' AS bilan FROM t.resultats;
