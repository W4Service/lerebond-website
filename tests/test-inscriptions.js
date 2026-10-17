// Inscriptions en ligne, espace joueur, convocations, barème FFT.
// Valeurs officielles : Guide de la compétition padel, chapitre II (MAJ février 2026).
var fs = require('fs');
var ko = 0;
function check(n, c) { console.log((c ? '  ok   ' : '  FAIL ') + n); if (!c) ko++; }
var sql = fs.readFileSync('../supabase/migrations/20261021_inscriptions.sql', 'utf8');
var staff = fs.readFileSync('../supabase/migrations/20261020_staff.sql', 'utf8');
var cron = fs.readFileSync('../supabase/migrations/20261022_fft_cron.sql', 'utf8');

console.log('=== Barème des points (tableaux officiels P25 et P50) ===');
global.window = {};
require('../js/fft-bareme.js');
var B = window.FFTBareme;
check('P25, 4 à 8 paires : 25-20-15-9-6-4-2-1',
      [1, 2, 3, 4, 5, 6, 7, 8].map(function (p) { return B.points('P25', p, 8); }).join() === '25,20,15,9,6,4,2,1');
check('P50, 4 à 8 paires : 50-40-30-20-13-5-3-1',
      [1, 2, 3, 4, 5, 6, 7, 8].map(function (p) { return B.points('P50', p, 8); }).join() === '50,40,30,20,13,5,3,1');
check('P50, 29 paires et plus, 6e : 29 (arrondi supérieur de 58 × 0,5)', B.points('P50', 6, 30) === 29);
check('P100, 16 paires, 3e : 70', B.points('P100', 3, 16) === 70);
check('P250, vainqueur : 250', B.points('P250', 1, 12) === 250);
check('au-delà du nombre de paires : 0', B.points('P100', 20, 16) === 0);
check('catégorie sans barème : null', B.points('P1000', 1, 16) === null);

console.log('\n=== Accès aux tournois (cuts FFT AS 2027) ===');
check('P100 messieurs interdit au top 5 000', /\('P100', 'H', 5000\)/.test(sql));
check('P100 dames interdit au top 500', /\('P100', 'F', 500\)/.test(sql));
check('P250 dames interdit au top 100', /\('P250', 'F', 100\)/.test(sql));
check('« top N inclus » : le N-ième est interdit', /IF seuil IS NULL OR rang_compare > seuil THEN RETURN NULL/.test(sql));
check('mixte P250 et plus : pas de limite', /p_tableau = 'mixte'[\s\S]{0,120}'P250', 'P500'/.test(sql));
check('équivalence dames → messieurs : +55 000 entre 3 001 et 5 000 (Padelac se trompe ici)',
      /p_rang <= 5000 THEN p_rang \+ 55000/.test(sql));
check('équivalence dames → messieurs : +90 000 au-delà de 10 000', /ELSE p_rang \+ 90000/.test(sql));
check('non classé : toujours éligible', /IF p_rang IS NULL OR p_categorie IS NULL OR p_categorie = 'loisir' THEN RETURN NULL/.test(sql));

console.log('\n=== Inscription ===');
check('le classement vient du cache Ten\'Up, pas du navigateur',
      !/p_j1->>'rang'|p_j2->>'rang'/.test(sql) && /SELECT \* INTO c FROM fft_classement WHERE id_crm = v_crm/.test(sql));
check('un joueur ne peut être que dans une paire par tournoi', /est déjà inscrit·e à ce tournoi/.test(sql));
check('tant que des paires attendent, une nouvelle arrivée passe derrière',
      /OR nb_liste_attente\(p_tournoi\) > 0/.test(sql));
check('une place libérée est donnée à la première de la liste', /ORDER BY cree_le LIMIT GREATEST\(places, 0\)/.test(sql));
check('augmenter la capacité fait avancer la liste', /CREATE TRIGGER trg_tournois_capacite/.test(sql));
check('une inscription crée l\'équipe de l\'admin avec les classements',
      /INSERT INTO equipes \(tournoi_id, nom, joueur_j1_id, joueur_j2_id, points_j1, points_j2\)/.test(sql));
check('désinscription seulement par un des deux joueurs (jeton)', /place_dans_inscription\(p_jeton, p_inscription\)/.test(sql));

console.log('\n=== Données personnelles ===');
check('coordonnées dans une table à part, réservée au staff',
      /CREATE TABLE IF NOT EXISTS joueurs_contacts/.test(sql) && /FOREACH t IN ARRAY ARRAY\['joueurs_contacts', 'inscriptions', 'notifications'\]/.test(sql));
check('la liste publique des paires n\'expose pas les coordonnées',
      /RETURNS TABLE \(statut text, rang_attente integer, joueur1 text, joueur2 text, rang1 integer, rang2 integer, poids integer\)/.test(sql));
check('« lien perdu » ne révèle pas si une adresse est inscrite, et est limité', /cree_le > now\(\) - interval '15 minutes'/.test(sql));
check('les fonctions internes sont fermées au site public',
      /REVOKE ALL ON FUNCTION notifier\(uuid, text, text, text, uuid\) FROM PUBLIC, anon, authenticated/.test(sql));
var esp = fs.readFileSync('../js/espace-joueur.js', 'utf8');
check('le lien personnel est retiré de la barre d\'adresse', /history\.replaceState\(null, '', location\.pathname\)/.test(esp));
var page = fs.readFileSync('../espace-joueur/index.html', 'utf8');
check('l\'espace joueur n\'est pas indexé', /noindex, nofollow/.test(page));

console.log('\n=== Rôle staff ===');
check('les comptes existants deviennent staff', /INSERT INTO staff \(user_id, email\)\s+SELECT id, email FROM auth\.users/.test(staff));
check('écriture réservée au staff sur les tables de tournoi', /FOR ALL TO authenticated USING \(est_staff\(\)\) WITH CHECK \(est_staff\(\)\)/.test(staff));
var admin = fs.readFileSync('../js/chrono-admin.js', 'utf8');
check('un compte non staff est refusé à l\'admin', /refuserNonStaff\(\)/.test(admin));

console.log('\n=== Tâches planifiées (Supabase, plus le Pi) ===');
check('vérification FFT toutes les heures', /cron\.schedule\(\s*'fft-verification',\s*'5 \* \* \* \*'/.test(cron));
check('verrou : une vérification à la fois', /WHERE nom = p_nom AND \(verrou_jusqua IS NULL OR verrou_jusqua < now\(\)\)/.test(cron));
check('rappel la veille, jamais deux fois', /NOT EXISTS \(SELECT 1 FROM notifications n WHERE n\.inscription_id = ins\.id AND n\.type = 'rappel'\)/.test(cron));

console.log(ko ? '\n' + ko + ' échec(s)' : '\nTout est vert.');
process.exit(ko ? 1 : 0);
