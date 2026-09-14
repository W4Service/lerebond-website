-- Tournois homologués FFT : barème de points en poule + saisie WO / disqualification.
--
-- 1) tournois.homologue
--    false (défaut) : classement de poule trié comme avant (victoires > ±sets > ±jeux)
--    true           : barème officiel FFT
--                       2 pts victoire
--                       1 pt  défaite
--                      -1 pt  défaite par disqualification
--                      -2 pts défaite par WO
--                     + départage officiel (cf. js/tournoi-classement.js)
--
-- 2) matchs.issue
--    'normal' (défaut) : match joué jusqu'au bout, score renseigné
--    'wo'              : le perdant ne s'est pas présenté / a abandonné avant
--    'disqualification': le perdant a été disqualifié
--    Dans les deux derniers cas, vainqueur_id reste obligatoire ; score_a/score_b
--    peuvent être vides (aucun set / jeu n'est alors compté au départage).

ALTER TABLE tournois
    ADD COLUMN IF NOT EXISTS homologue boolean NOT NULL DEFAULT false;

ALTER TABLE matchs
    ADD COLUMN IF NOT EXISTS issue text NOT NULL DEFAULT 'normal';

ALTER TABLE matchs
    DROP CONSTRAINT IF EXISTS matchs_issue_check;
ALTER TABLE matchs
    ADD CONSTRAINT matchs_issue_check
        CHECK (issue IN ('normal', 'wo', 'disqualification'));
