-- Nuit du 2 au 3/11/2026 : Ten'Up mettait en ligne le classement de novembre et répondait
-- « personne » à toutes les recherches. fft-verification a alors marqué des classés 'non_classe'
-- et effacé leur rang. On remet à vérifier les fiches touchées (rien d'autre n'est modifié) :
-- la vérification horaire leur rend leur classement de novembre.
UPDATE joueurs
SET fft_verifie_le = NULL
WHERE fft_statut <> 'classe'
  AND fft_verifie_le >= '2026-11-03 00:00+00'
  AND fft_verifie_le <  '2026-11-03 10:00+00';
