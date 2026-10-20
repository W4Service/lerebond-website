-- Terrains dont la diffusion en direct est coupée sur le site.
--
-- Complément de videos_bloquees, qui ne porte que sur les replays : un replay a
-- un identifiant de vidéo, un direct n'en a pas. On coupe donc par terrain.
--
-- Usage : quelqu'un ne veut pas être filmé pendant qu'il joue. On coupe le
-- terrain, la carte reste visible mais annoncée comme non diffusée, et le flux
-- n'est pas chargé par le navigateur.
--
-- Ce que ça ne fait pas : la caméra de la borne continue de filmer et de
-- diffuser sur son propre hôte (five.le-rebond.com et consorts). On refuse de
-- l'afficher sur le-rebond.fr, c'est tout. Pour arrêter la captation, il faut
-- agir sur la borne.
--
-- terrain_id : identifiant utilisé par la page live ('wuilhome', 'five',
--              'w4s', 'wepe'), et non le nom affiché, qui peut changer.
--
-- Datée après 20261020_staff.sql : les règles d'accès ci-dessous appellent
-- est_staff(), qui y est créée. Sur une base reconstruite de zéro, les
-- migrations rejouent dans l'ordre des noms — d'où ce numéro.

CREATE TABLE IF NOT EXISTS terrains_bloques (
    terrain_id  text PRIMARY KEY,
    motif       text,            -- « droit à l'image »… lisible publiquement
    bloque_par  uuid REFERENCES auth.users (id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE terrains_bloques IS
    'Terrains dont le direct est masqué sur le site. La borne continue de diffuser de son côté.';

-- Lecture pour tous : la page live est publique et doit savoir quoi ne pas
-- afficher. Comme pour videos_bloquees, `motif` est donc lisible publiquement :
-- on y écrit un motif de service, jamais le nom de la personne concernée.
ALTER TABLE terrains_bloques ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS terrains_bloques_lecture ON terrains_bloques;
CREATE POLICY terrains_bloques_lecture ON terrains_bloques
    FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS terrains_bloques_staff ON terrains_bloques;
CREATE POLICY terrains_bloques_staff ON terrains_bloques
    FOR ALL TO authenticated USING (est_staff()) WITH CHECK (est_staff());

GRANT SELECT ON terrains_bloques TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON terrains_bloques TO authenticated;
