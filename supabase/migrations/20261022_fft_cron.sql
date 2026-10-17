-- Vérification quotidienne du classement FFT, hébergée chez Supabase (plus sur le Pi).
--
-- pg_cron appelle toutes les heures l'Edge Function « fft-verification », qui traite
-- au plus 50 joueurs pas encore vérifiés pour le dernier classement publié. Quand
-- tout le monde est à jour, l'appel ne fait qu'une requête à Ten'Up et s'arrête.
-- À la sortie d'un classement (1er mardi du mois), ~400 joueurs sont revus en ~8 h.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Verrou : une seule vérification à la fois (une exécution plantée libère au bout de p_duree_s).
CREATE TABLE IF NOT EXISTS fft_taches (
    nom          text PRIMARY KEY,
    verrou_jusqua timestamptz,
    dernier_debut timestamptz,
    dernier_fin   timestamptz
);
ALTER TABLE fft_taches ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION fft_tache_prendre(p_nom text, p_duree_s integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ok boolean;
BEGIN
    INSERT INTO fft_taches (nom) VALUES (p_nom) ON CONFLICT (nom) DO NOTHING;
    UPDATE fft_taches SET verrou_jusqua = now() + make_interval(secs => p_duree_s), dernier_debut = now()
    WHERE nom = p_nom AND (verrou_jusqua IS NULL OR verrou_jusqua < now())
    RETURNING true INTO ok;
    RETURN coalesce(ok, false);
END;
$$;

CREATE OR REPLACE FUNCTION fft_tache_liberer(p_nom text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    UPDATE fft_taches SET verrou_jusqua = NULL, dernier_fin = now() WHERE nom = p_nom
$$;

REVOKE ALL ON FUNCTION fft_tache_prendre(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fft_tache_liberer(text) FROM PUBLIC, anon, authenticated;

-- Appel horaire (à h+05). La fonction est déployée sans vérification de clé
-- (--no-verify-jwt) : elle ne fait que relire des classements publics, et son verrou
-- empêche de la lancer plusieurs fois en parallèle. Aucun secret n'est donc stocké ici.
DO $$
BEGIN
    PERFORM cron.unschedule('fft-verification') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fft-verification');
END $$;
SELECT cron.schedule(
    'fft-verification',
    '5 * * * *',
    $cron$
    SELECT net.http_post(
        url := 'https://vabotavilswqtrevishs.supabase.co/functions/v1/fft-verification',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := '{}'::jsonb,
        timeout_milliseconds := 150000)
    $cron$
);

-- ===================================================================== rappel J-1
-- Chaque jour en fin d'après-midi : rappel aux paires inscrites à un tournoi du
-- lendemain. Une seule fois par inscription.
CREATE OR REPLACE FUNCTION envoyer_rappels_veille()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE i record; n integer := 0; texte text;
BEGIN
    FOR i IN SELECT ins.* FROM inscriptions ins JOIN tournois t ON t.id = ins.tournoi_id
             WHERE ins.statut = 'inscrite' AND t.date = (now() AT TIME ZONE 'Europe/Paris')::date + 1
               AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.inscription_id = ins.id AND n.type = 'rappel') LOOP
        texte := 'Rappel : ' || libelle_tournoi(i.tournoi_id) || ' demain'
              || coalesce(', convocation à ' || to_char(i.convocation_heure AT TIME ZONE 'Europe/Paris', 'HH24"h"MI'), '')
              || '. Un empêchement ? Prévenez-nous depuis votre espace joueur pour libérer la place.';
        PERFORM notifier(i.joueur1_id, 'rappel', 'Votre tournoi, c''est demain !', texte, i.id);
        PERFORM notifier(i.joueur2_id, 'rappel', 'Votre tournoi, c''est demain !', texte, i.id);
        n := n + 1;
    END LOOP;
    RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION envoyer_rappels_veille() FROM PUBLIC, anon, authenticated;

-- pg_cron tourne en UTC : 16 h UTC = 17 h (hiver) / 18 h (été) à Paris. Le second passage
-- à 17 h UTC rattrape un éventuel échec ; un rappel n'est jamais envoyé deux fois.
DO $$
BEGIN
    PERFORM cron.unschedule('rappels-veille') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rappels-veille');
END $$;
SELECT cron.schedule('rappels-veille', '0 16,17 * * *', $cron$ SELECT public.envoyer_rappels_veille() $cron$);
