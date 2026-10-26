-- Dépendances entre matchs de phase finale, par identifiant de match.
--
-- Datée après 20261020_staff.sql : voir les migrations 20261025_*.
--
-- Pourquoi : les colonnes equipe_*_source_ordre existent déjà, mais désignent un
-- match par son `ordre` À L'INTÉRIEUR D'UNE POULE, et le résolveur côté client
-- ne cherche que des matchs de phase 'poule'. Un tableau à élimination directe
-- a besoin de l'inverse : « le perdant du match X », X étant un autre match de
-- phase finale, sans poule.
--
-- D'où une référence directe par id. Ça permet de créer le tableau ENTIER dès le
-- départ — 28 matchs pour un tableau de 16 à entrées échelonnées — et donc
-- d'imprimer le planning et les convocations avant que le tournoi commence. Sans
-- ça, chaque tour ne peut être créé qu'une fois le précédent joué.
--
-- ON DELETE CASCADE : si le match source disparaît, le match qui en dépend n'a
-- plus de sens. Mieux vaut qu'il disparaisse avec que de rester avec une
-- dépendance pendante qui ne se résoudra jamais.

ALTER TABLE matchs
    ADD COLUMN IF NOT EXISTS equipe_a_source_match_id uuid
        REFERENCES matchs (id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS equipe_b_source_match_id uuid
        REFERENCES matchs (id) ON DELETE CASCADE;

COMMENT ON COLUMN matchs.equipe_a_source_match_id IS
    'Match dont le résultat désigne l''équipe A (avec equipe_a_source_type = gagnant|perdant). Pour les tableaux à élimination directe.';
COMMENT ON COLUMN matchs.equipe_b_source_match_id IS
    'Match dont le résultat désigne l''équipe B (avec equipe_b_source_type = gagnant|perdant).';

-- Le résolveur part d'un match qui vient de se terminer et cherche ceux qui en
-- dépendent : c'est ce sens-là qu'il faut indexer.
CREATE INDEX IF NOT EXISTS idx_matchs_source_match_a
    ON matchs (equipe_a_source_match_id) WHERE equipe_a_source_match_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_matchs_source_match_b
    ON matchs (equipe_b_source_match_id) WHERE equipe_b_source_match_id IS NOT NULL;

-- Place attribuée par un match de classement : le vainqueur prend `place_vainqueur`,
-- le perdant la suivante. Porté par le match plutôt que déduit du nom du bracket,
-- pour que le classement final se lise sans réinterpréter des libellés.
ALTER TABLE matchs
    ADD COLUMN IF NOT EXISTS place_vainqueur integer;

COMMENT ON COLUMN matchs.place_vainqueur IS
    'Match de classement : place finale du vainqueur. Le perdant obtient place_vainqueur + 1.';

-- Créneau de programmation, pour un tableau planifié d'avance.
-- L'heure réelle se calcule à l'affichage depuis l'heure de début du tournoi :
-- décaler le tournoi d'une heure ne doit pas demander de réécrire 28 lignes.
ALTER TABLE matchs
    ADD COLUMN IF NOT EXISTS creneau integer;

COMMENT ON COLUMN matchs.creneau IS
    'Numéro de créneau (0 = premier). Heure = heure_debut + creneau × durée_match.';
