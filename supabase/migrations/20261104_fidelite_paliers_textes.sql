-- Fidélité : détails des paliers sans « à la Ne partie » (déroutant à côté de l'étiquette
-- du palier) ; l'escalier dit lui-même ce qu'il reste à jouer.
UPDATE fidelite.paliers p SET detail = v.detail
FROM (VALUES
    (1, 'aux 4 joueurs'),
    (2, 'au réservant'),
    (3, 'à partager'),
    (4, 'pour l''équipe')) v(rang, detail)
WHERE p.sport = 'padel' AND p.rang = v.rang;
