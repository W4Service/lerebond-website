-- Fidélité : textes courts des paliers pour l'affichage en escalier (e-mail et fiche
-- client) : « Après la 1re partie » / « Raquettes offertes » / « aux 4 joueurs, à la 2e partie ».

ALTER TABLE fidelite.paliers ADD COLUMN IF NOT EXISTS titre text;
ALTER TABLE fidelite.paliers ADD COLUMN IF NOT EXISTS detail text;

UPDATE fidelite.paliers p SET titre = v.titre, detail = v.detail
FROM (VALUES
    (1, 'Raquettes offertes', 'aux 4 joueurs, à la 2e partie'),
    (2, 'Boisson offerte', 'au réservant, à la 3e partie'),
    (3, 'Pizza ou planche', 'à partager, à la 4e partie'),
    (4, 'Tournée offerte', 'pour l''équipe, à la 5e partie'),
    (5, 'Régulier', 'tu fais partie des habitués du Rebond')) v(rang, titre, detail)
WHERE p.sport = 'padel' AND p.rang = v.rang AND p.titre IS NULL;

CREATE OR REPLACE FUNCTION fidelite.echelle(p_personne text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = fidelite AS $$
    SELECT jsonb_agg(jsonb_build_object(
               'rang', pa.rang,
               'libelle', pa.libelle,
               'titre', coalesce(pa.titre, pa.libelle),
               'detail', pa.detail,
               'fin', pa.fin,
               'etat', CASE WHEN pa.rang < t.palier THEN 'valide'
                            WHEN pa.rang = t.palier THEN 'actuel'
                            ELSE 'a_debloquer' END,
               'manque', greatest(pa.rang - t.palier, 0))
           ORDER BY pa.rang)
    FROM tunnel t JOIN paliers pa ON pa.sport = t.sport
    WHERE t.personne = p_personne
$$;
