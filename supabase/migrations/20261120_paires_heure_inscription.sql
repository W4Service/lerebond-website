-- 22/11/2026 : « Voir les paires » affiche l'heure d'inscription (inscriptions horodatées).
-- Seules les inscriptions en ligne ont une heure fiable ; les paires LiveXperience restent sans heure.
DROP FUNCTION IF EXISTS paires_tournoi(uuid);
CREATE FUNCTION paires_tournoi(p_tournoi uuid)
RETURNS TABLE (statut text, rang_attente integer, joueur1 text, joueur2 text, rang1 integer, rang2 integer, poids integer, pts1 integer, pts2 integer, inscrit_le timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT * FROM (
        SELECT i.statut,
               CASE WHEN i.statut = 'liste_attente' THEN
                   (row_number() OVER (PARTITION BY i.statut ORDER BY i.cree_le))::int END,
               nom_joueur(i.joueur1_id), nom_joueur(i.joueur2_id), i.rang1, i.rang2, i.poids::integer,
               NULL::integer, NULL::integer, i.cree_le
        FROM inscriptions i JOIN tournois t ON t.id = i.tournoi_id
        WHERE i.tournoi_id = p_tournoi AND t.publie AND i.statut IN ('inscrite', 'liste_attente')
        UNION ALL
        SELECT 'inscrite', NULL::integer, l.joueur1, COALESCE(l.joueur2, 'partenaire à confirmer'),
               l.rang1, l.rang2, l.poids, l.pts1, l.pts2, NULL::timestamptz
        FROM livex_paires l JOIN tournois t ON t.id = l.tournoi_id
        WHERE l.tournoi_id = p_tournoi AND t.publie
    ) p ORDER BY 1, 7 NULLS LAST
$$;
GRANT EXECUTE ON FUNCTION paires_tournoi(uuid) TO anon, authenticated;
