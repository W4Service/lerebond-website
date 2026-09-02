-- ============================================================
-- Tournoi AMERICANO (paires tournantes, classement individuel)
-- Indépendant du tournoi équipes/poules existant.
-- ============================================================

CREATE TABLE IF NOT EXISTS americano_tournois (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nom             text NOT NULL,
    date            date NOT NULL DEFAULT current_date,
    nb_terrains     integer NOT NULL DEFAULT 3,
    nb_tours        integer NOT NULL DEFAULT 6,
    format_match    text NOT NULL DEFAULT 'points',   -- 'points' | 'temps'
    points_cible    integer NOT NULL DEFAULT 16,
    duree_tour_min  integer NOT NULL DEFAULT 14,
    tour_courant    integer NOT NULL DEFAULT 1,
    status          text NOT NULL DEFAULT 'en_cours', -- 'en_cours' | 'termine'
    -- Grille complète (matchs + repos) calculée à la création, figée ensuite.
    grille          jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT americano_format_check   CHECK (format_match IN ('points','temps')),
    CONSTRAINT americano_status_check   CHECK (status IN ('en_cours','termine')),
    CONSTRAINT americano_terrains_check CHECK (nb_terrains BETWEEN 1 AND 3),
    CONSTRAINT americano_tours_check    CHECK (nb_tours BETWEEN 1 AND 30)
);

CREATE TABLE IF NOT EXISTS americano_joueurs (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tournoi_id  uuid NOT NULL REFERENCES americano_tournois(id) ON DELETE CASCADE,
    nom         text NOT NULL,
    ordre       integer NOT NULL,          -- index stable 0..N-1 utilisé par la grille
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_americano_joueurs_tournoi
    ON americano_joueurs (tournoi_id, ordre);

CREATE TABLE IF NOT EXISTS americano_matchs (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tournoi_id  uuid NOT NULL REFERENCES americano_tournois(id) ON DELETE CASCADE,
    tour        integer NOT NULL,
    terrain     integer NOT NULL,
    -- 4 joueurs : équipe A = a1+a2, équipe B = b1+b2
    a1_id       uuid NOT NULL REFERENCES americano_joueurs(id) ON DELETE CASCADE,
    a2_id       uuid NOT NULL REFERENCES americano_joueurs(id) ON DELETE CASCADE,
    b1_id       uuid NOT NULL REFERENCES americano_joueurs(id) ON DELETE CASCADE,
    b2_id       uuid NOT NULL REFERENCES americano_joueurs(id) ON DELETE CASCADE,
    score_a     integer,
    score_b     integer,
    valide      boolean NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT americano_score_a_check CHECK (score_a IS NULL OR score_a >= 0),
    CONSTRAINT americano_score_b_check CHECK (score_b IS NULL OR score_b >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_americano_match_tour_terrain
    ON americano_matchs (tournoi_id, tour, terrain);

CREATE INDEX IF NOT EXISTS idx_americano_matchs_tournoi_tour
    ON americano_matchs (tournoi_id, tour);
