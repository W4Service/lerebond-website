-- Classement FFT padel : copie locale du classement mensuel officiel.
--
-- La FFT publie chaque mois le classement national (hommes / dames). Il n'existe
-- ni API publique ni export tabulaire : scripts/fft/importer_classement.py lit le
-- fichier publié et le charge ici. Interroger Ten'Up en direct est fragile et
-- contraire à ses conditions d'utilisation, on ne le fait pas.
--
-- ATTENTION au vocabulaire : au padel, le « poids » d'une paire est la somme des
-- CLASSEMENTS (rangs) des deux joueurs, pas de leurs points. Le meilleur joueur a
-- le rang 1. C'est le rang qui alimente equipes.points_j1 / points_j2 (cf. comparerForce
-- dans js/tournoi-admin.js, qui trie par total croissant).

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm  WITH SCHEMA extensions;

-- unaccent() n'est pas IMMUTABLE : on l'enveloppe pour pouvoir l'utiliser dans
-- une colonne générée et un index. Même normalisation que normaliserIdentite()
-- côté JS : minuscules, sans accents, espaces simples.
CREATE OR REPLACE FUNCTION normaliser_identite(txt text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = extensions, public
AS $$
    SELECT btrim(regexp_replace(lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(txt, ''))), '\s+', ' ', 'g'))
$$;

CREATE TABLE IF NOT EXISTS fft_classement (
    id           bigserial PRIMARY KEY,
    mois         date    NOT NULL,              -- 1er jour du mois du classement
    genre        char(1) NOT NULL,              -- 'H' | 'F'
    rang         integer NOT NULL,
    nom          text    NOT NULL,
    prenom       text    NOT NULL DEFAULT '',
    points       integer,
    nationalite  text,
    ligue        text,
    club         text,
    licence      text,
    assimile     boolean,
    nb_tournois  integer,
    recherche    text GENERATED ALWAYS AS (normaliser_identite(prenom || ' ' || nom)) STORED,
    CONSTRAINT fft_classement_genre_check CHECK (genre IN ('H', 'F')),
    CONSTRAINT fft_classement_rang_check  CHECK (rang > 0)
);

CREATE INDEX IF NOT EXISTS idx_fft_classement_mois_genre_rang
    ON fft_classement (mois, genre, rang);
CREATE INDEX IF NOT EXISTS idx_fft_classement_recherche_trgm
    ON fft_classement USING gin (recherche extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_fft_classement_licence
    ON fft_classement (licence) WHERE licence IS NOT NULL;

-- Journal des imports : sert aussi à savoir quel est le dernier mois disponible
-- par genre, sans balayer les ~140 000 lignes.
CREATE TABLE IF NOT EXISTS fft_imports (
    mois        date    NOT NULL,
    genre       char(1) NOT NULL,
    nb_lignes   integer NOT NULL,
    source      text,
    importe_le  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (mois, genre)
);

-- Données publiques (publiées par la FFT) : lecture ouverte, écriture réservée
-- au script d'import (connexion Postgres directe, hors RLS).
ALTER TABLE fft_classement ENABLE ROW LEVEL SECURITY;
ALTER TABLE fft_imports    ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fft_classement_lecture ON fft_classement;
CREATE POLICY fft_classement_lecture ON fft_classement FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS fft_imports_lecture ON fft_imports;
CREATE POLICY fft_imports_lecture ON fft_imports FOR SELECT TO anon, authenticated USING (true);

-- Rattachement des joueurs du club au classement.
ALTER TABLE joueurs
    ADD COLUMN IF NOT EXISTS licence     text,
    ADD COLUMN IF NOT EXISTS genre       char(1),
    ADD COLUMN IF NOT EXISTS fft_rang    integer,
    ADD COLUMN IF NOT EXISTS fft_points  integer,
    ADD COLUMN IF NOT EXISTS fft_mois    date;

ALTER TABLE joueurs DROP CONSTRAINT IF EXISTS joueurs_genre_check;
ALTER TABLE joueurs ADD CONSTRAINT joueurs_genre_check CHECK (genre IS NULL OR genre IN ('H', 'F'));

CREATE UNIQUE INDEX IF NOT EXISTS uniq_joueurs_licence
    ON joueurs (licence) WHERE licence IS NOT NULL;

-- Recherche d'un joueur dans le dernier classement disponible.
-- Chaque mot saisi doit apparaître (dans n'importe quel ordre) : « dupont jul »
-- trouve « Julien DUPONT ». Le mot le plus long sert de filtre indexé (trigrammes).
CREATE OR REPLACE FUNCTION rechercher_joueurs_fft(q text, p_genre text DEFAULT NULL, p_limite integer DEFAULT 10)
RETURNS TABLE (
    rang integer, nom text, prenom text, points integer, genre char(1),
    ligue text, club text, licence text, mois date
)
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
    WITH mots AS (
        SELECT array_agg(m ORDER BY length(m) DESC) AS liste
        FROM unnest(string_to_array(normaliser_identite(q), ' ')) AS m
        WHERE length(m) >= 2
    ),
    derniers AS (
        SELECT i.genre, max(i.mois) AS mois FROM fft_imports i GROUP BY i.genre
    )
    SELECT c.rang, c.nom, c.prenom, c.points, c.genre, c.ligue, c.club, c.licence, c.mois
    FROM fft_classement c
    JOIN derniers d ON d.genre = c.genre AND d.mois = c.mois
    CROSS JOIN mots
    WHERE mots.liste IS NOT NULL
      AND (p_genre IS NULL OR c.genre = p_genre)
      AND c.recherche LIKE '%' || mots.liste[1] || '%'
      AND c.recherche LIKE ALL (SELECT '%' || m || '%' FROM unnest(mots.liste) AS m)
    ORDER BY extensions.similarity(c.recherche, normaliser_identite(q)) DESC, c.rang
    LIMIT LEAST(GREATEST(p_limite, 1), 50)
$$;

GRANT EXECUTE ON FUNCTION rechercher_joueurs_fft(text, text, integer) TO anon, authenticated;

-- Met à jour le classement de tous les joueurs du club à partir du dernier import.
--   1. joueurs avec licence : rapprochement par licence ;
--   2. sinon : par prénom + nom normalisés, UNIQUEMENT si un seul classé porte ce
--      nom (les homonymes sont comptés et laissés de côté, à trancher à la main).
-- Renvoie {"par_licence": n, "par_nom": n, "homonymes": n, "non_trouves": n}.
CREATE OR REPLACE FUNCTION actualiser_classements_joueurs()
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
    n_licence integer; n_nom integer; n_homonymes integer; n_total integer;
BEGIN
    CREATE TEMP TABLE _dernier ON COMMIT DROP AS
    SELECT c.* FROM fft_classement c
    JOIN (SELECT genre, max(mois) AS mois FROM fft_imports GROUP BY genre) d
      ON d.genre = c.genre AND d.mois = c.mois;

    UPDATE joueurs j SET
        fft_rang = c.rang, fft_points = c.points, fft_mois = c.mois,
        genre = coalesce(j.genre, c.genre), updated_at = now()
    FROM _dernier c
    WHERE j.licence IS NOT NULL AND c.licence = j.licence;
    GET DIAGNOSTICS n_licence = ROW_COUNT;

    WITH candidats AS (
        SELECT j.id AS joueur_id, c.rang, c.points, c.mois, c.genre,
               count(*) OVER (PARTITION BY j.id) AS nb
        FROM joueurs j
        JOIN _dernier c ON c.recherche = normaliser_identite(j.prenom || ' ' || j.nom)
                       AND (j.genre IS NULL OR c.genre = j.genre)
        WHERE j.licence IS NULL OR NOT EXISTS (SELECT 1 FROM _dernier x WHERE x.licence = j.licence)
    )
    UPDATE joueurs j SET
        fft_rang = k.rang, fft_points = k.points, fft_mois = k.mois,
        genre = coalesce(j.genre, k.genre), updated_at = now()
    FROM candidats k
    WHERE k.joueur_id = j.id AND k.nb = 1;
    GET DIAGNOSTICS n_nom = ROW_COUNT;

    SELECT count(*) INTO n_homonymes FROM (
        SELECT j.id
        FROM joueurs j
        JOIN _dernier c ON c.recherche = normaliser_identite(j.prenom || ' ' || j.nom)
                       AND (j.genre IS NULL OR c.genre = j.genre)
        WHERE j.licence IS NULL OR NOT EXISTS (SELECT 1 FROM _dernier x WHERE x.licence = j.licence)
        GROUP BY j.id HAVING count(*) > 1
    ) h;

    SELECT count(*) INTO n_total FROM joueurs;

    RETURN jsonb_build_object(
        'par_licence', n_licence,
        'par_nom', n_nom,
        'homonymes', n_homonymes,
        'non_trouves', n_total - n_licence - n_nom - n_homonymes
    );
END;
$$;

GRANT EXECUTE ON FUNCTION actualiser_classements_joueurs() TO authenticated;
