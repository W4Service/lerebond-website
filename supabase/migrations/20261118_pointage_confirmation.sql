-- Pointage : confirmation de présence et téléphone des joueurs (admin seulement).

-- 1. Confirmation de présence par joueur, avant le pointage sur place :
--    le joueur a confirmé qu'il vient (SMS, appel, message), sans être encore arrivé.
ALTER TABLE equipes
    ADD COLUMN IF NOT EXISTS confirme_j1 boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS confirme_j2 boolean NOT NULL DEFAULT false;

-- 2. Téléphone des joueurs d'un tournoi, pour les appeler depuis le pointage.
--    Ten'Up ne fournit aucun numéro : on prend, dans l'ordre,
--      a) l'inscription en ligne (joueurs_contacts),
--      b) la fiche LiveXperience du même numéro de licence (com.tournoi_participants),
--      c) la fiche LiveXperience au même nom + prénom, seulement si un seul numéro
--         correspond (homonymes : rien plutôt qu'un mauvais numéro).
--    Staff uniquement : le site public n'y a jamais accès.
CREATE OR REPLACE FUNCTION telephones_tournoi(p_tournoi uuid)
RETURNS TABLE (joueur_id uuid, telephone text, source text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, com
AS $$
BEGIN
    IF NOT est_staff() THEN
        RAISE EXCEPTION 'réservé au staff' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    WITH js AS (
        SELECT DISTINCT j.id, j.licence, normaliser_identite(j.nom) AS nom, normaliser_identite(j.prenom) AS prenom
        FROM equipes e
        JOIN joueurs j ON j.id IN (e.joueur_j1_id, e.joueur_j2_id)
        WHERE e.tournoi_id = p_tournoi
    ),
    par_contact AS (
        SELECT js.id, c.telephone, 'inscription'::text AS source, 1 AS prio
        FROM js JOIN joueurs_contacts c ON c.joueur_id = js.id
        WHERE nullif(btrim(c.telephone), '') IS NOT NULL
    ),
    par_licence AS (
        SELECT DISTINCT ON (js.id) js.id, p.telephone, 'LiveXperience'::text, 2
        FROM js JOIN com.tournoi_participants p
          ON ltrim(regexp_replace(p.licence, '\D', '', 'g'), '0') = ltrim(regexp_replace(js.licence, '\D', '', 'g'), '0')
        WHERE nullif(btrim(js.licence), '') IS NOT NULL AND nullif(btrim(p.telephone), '') IS NOT NULL
        ORDER BY js.id, p.date DESC
    ),
    par_nom AS (
        SELECT js.id, min(p.telephone) AS telephone, 'LiveXperience (nom)'::text, 3
        FROM js JOIN com.tournoi_participants p
          ON normaliser_identite(p.nom) = js.nom AND normaliser_identite(p.prenom) = js.prenom
        WHERE nullif(btrim(p.telephone), '') IS NOT NULL
        GROUP BY js.id
        HAVING count(DISTINCT regexp_replace(p.telephone, '\D', '', 'g')) = 1
    )
    SELECT DISTINCT ON (x.id) x.id, x.telephone, x.source
    FROM (SELECT * FROM par_contact UNION ALL SELECT * FROM par_licence UNION ALL SELECT * FROM par_nom) x
    ORDER BY x.id, x.prio;
END;
$$;

REVOKE ALL ON FUNCTION telephones_tournoi(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION telephones_tournoi(uuid) TO authenticated;
