-- Outils de juge-arbitre : paramètres de temps et traçabilité du tirage au sort.
--
-- 1) Paramètres de temps, par tournoi.
--    Les valeurs réglementaires varient selon le type d'épreuve (P25, P100, P250...)
--    et selon le format de match retenu : elles sont donc réglées par le JA dans
--    l'admin, et non figées dans le code.
--      repos_min_minutes    : repos minimum dû à une paire entre 2 matchs
--      duree_match_minutes  : durée estimée d'un match, pour la projection horaire
--                             (NULL = estimation déduite du format de score)
ALTER TABLE tournois
    ADD COLUMN IF NOT EXISTS repos_min_minutes   integer,
    ADD COLUMN IF NOT EXISTS duree_match_minutes integer;

ALTER TABLE tournois
    DROP CONSTRAINT IF EXISTS tournois_repos_min_check,
    DROP CONSTRAINT IF EXISTS tournois_duree_match_check;
ALTER TABLE tournois
    ADD CONSTRAINT tournois_repos_min_check
        CHECK (repos_min_minutes IS NULL OR repos_min_minutes BETWEEN 0 AND 240),
    ADD CONSTRAINT tournois_duree_match_check
        CHECK (duree_match_minutes IS NULL OR duree_match_minutes BETWEEN 5 AND 300);

-- 2) Tirage au sort : on conserve la graine et l'horodatage.
--    Un tirage contesté doit pouvoir être rejoué à l'identique : la graine suffit
--    à régénérer exactement la même séquence (cf. js/tournoi-tirage.js).
--      tirage_seed    : graine du générateur pseudo-aléatoire
--      tirage_at      : date/heure du tirage
--      tirage_ordre   : ordre de sortie des équipes, tel que tiré (JSON)
ALTER TABLE tournois
    ADD COLUMN IF NOT EXISTS tirage_seed  bigint,
    ADD COLUMN IF NOT EXISTS tirage_at    timestamptz,
    ADD COLUMN IF NOT EXISTS tirage_ordre jsonb;

-- 3) Diffusion du tirage vers l'écran TV.
--    L'admin écrit l'état courant, la page TV le lit en temps réel.
--      tirage_live : { etat: 'idle'|'roue'|'resultat', equipe_id, poule_id, ... }
ALTER TABLE tournois
    ADD COLUMN IF NOT EXISTS tirage_live jsonb;
