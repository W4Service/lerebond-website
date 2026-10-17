-- Calendrier public des tournois.
--
-- Jusqu'ici, un tournoi n'existait dans Supabase que le jour J (status 'actif'),
-- et le calendrier public était tenu à la main dans data/events.json. On permet
-- désormais de planifier les tournois à l'avance :
--
--   status = 'planifie' : tournoi annoncé, pas encore lancé. Les requêtes existantes
--                         (admin, client, impression) ne lisent que 'actif', 'cloture'
--                         et 'archive' : un tournoi planifié ne les perturbe pas.
--   « Lancer » un tournoi planifié le jour J le passe en 'actif' (cf. js/tournoi-planning.js).
--
-- Le calendrier public lit la vue tournois_calendrier, qui n'expose que les
-- tournois marqués publie = true.

ALTER TABLE tournois
    ADD COLUMN IF NOT EXISTS heure_debut       time,
    ADD COLUMN IF NOT EXISTS heure_fin         time,
    ADD COLUMN IF NOT EXISTS categorie         text,
    ADD COLUMN IF NOT EXISTS genre             text,
    ADD COLUMN IF NOT EXISTS nb_equipes_max    integer,
    ADD COLUMN IF NOT EXISTS nb_inscrits       integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS prix_par_joueur   numeric(6,2),
    ADD COLUMN IF NOT EXISTS description       text,
    ADD COLUMN IF NOT EXISTS lien_inscription  text,
    ADD COLUMN IF NOT EXISTS juge_arbitre      text,
    ADD COLUMN IF NOT EXISTS publie            boolean NOT NULL DEFAULT false;

-- categorie : niveau FFT du tournoi, ou 'loisir' pour un tournoi non homologué.
ALTER TABLE tournois DROP CONSTRAINT IF EXISTS tournois_categorie_check;
ALTER TABLE tournois ADD CONSTRAINT tournois_categorie_check
    CHECK (categorie IS NULL OR categorie IN
        ('P25', 'P50', 'P100', 'P250', 'P500', 'P1000', 'P1500', 'P2000', 'loisir'));

ALTER TABLE tournois DROP CONSTRAINT IF EXISTS tournois_genre_check;
ALTER TABLE tournois ADD CONSTRAINT tournois_genre_check
    CHECK (genre IS NULL OR genre IN ('messieurs', 'dames', 'mixte'));

ALTER TABLE tournois DROP CONSTRAINT IF EXISTS tournois_capacite_check;
ALTER TABLE tournois ADD CONSTRAINT tournois_capacite_check
    CHECK ((nb_equipes_max IS NULL OR nb_equipes_max > 0) AND nb_inscrits >= 0);

CREATE INDEX IF NOT EXISTS idx_tournois_calendrier
    ON tournois (date) WHERE publie;

-- Vue publique. inscrits = le plus grand des deux compteurs :
--   - nb_inscrits, tenu à la main tant que les inscriptions passent par l'appli mobile ;
--   - le nombre d'équipes réellement saisies dans l'admin.
-- security_invoker : la vue applique les droits (RLS) de l'appelant sur tournois et
-- equipes, que la page publique lit déjà avec la clé anon.
CREATE OR REPLACE VIEW tournois_calendrier
WITH (security_invoker = true) AS
SELECT
    t.id,
    t.nom,
    t.date,
    t.heure_debut,
    t.heure_fin,
    t.categorie,
    t.genre,
    t.homologue,
    t.nb_equipes_max,
    GREATEST(t.nb_inscrits, COALESCE(e.nb, 0))::integer AS inscrits,
    (t.nb_equipes_max IS NOT NULL
        AND GREATEST(t.nb_inscrits, COALESCE(e.nb, 0)) >= t.nb_equipes_max) AS complet,
    t.prix_par_joueur,
    t.description,
    t.lien_inscription,
    t.juge_arbitre,
    t.status
FROM tournois t
LEFT JOIN (
    SELECT tournoi_id, count(*) AS nb FROM equipes GROUP BY tournoi_id
) e ON e.tournoi_id = t.id
WHERE t.publie
  AND t.status IN ('planifie', 'actif', 'cloture')
  AND t.date IS NOT NULL;

GRANT SELECT ON tournois_calendrier TO anon, authenticated;
