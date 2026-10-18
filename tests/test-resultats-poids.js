// Résultats et podiums, poids FFT (non classés, dames en messieurs), alertes staff, homonymes.
// Règles : Guide de la compétition padel, chapitre II (MAJ février 2026).
var fs = require('fs');
var ko = 0;
function check(n, c) { console.log((c ? '  ok   ' : '  FAIL ') + n); if (!c) ko++; }
var sql = fs.readFileSync('../supabase/migrations/20261023_resultats_poids_alertes.sql', 'utf8');
var admin = fs.readFileSync('../js/tournoi-admin.js', 'utf8');
var verif = fs.readFileSync('../supabase/functions/fft-verification/index.ts', 'utf8');

console.log('=== Rang d\'un non classé ===');
check('dernier classé + ex aequo à ce rang + 1 (13 000e ×25, 13 024 classés → 13 026)',
      /p_dernier_rang \+ \(p_nb_classes - p_dernier_rang \+ 1\) \+ 1/.test(sql) && 13000 + (13024 - 13000 + 1) + 1 === 13026);
check('calculé une fois par mois et par genre depuis la dernière page Ten\'Up',
      /Math\.ceil\(total \/ 100\)/.test(verif) && /from\('fft_nc'\)\.select\('rang_nc'\)\.eq\('mois', mois\)/.test(verif));

console.log('\n=== Équivalence dames → messieurs (navigateur = base) ===');
global.window = {};
require('../js/fft-recherche.js');
var eq = window.FFTRecherche.rangEquivalentMessieurs;
check('50e dame → 2 050e messieurs', eq(50) === 2050);
check('4 000e dame → 59 000e (palier +55 000)', eq(4000) === 59000);
check('12 000e dame → 102 000e (palier +90 000)', eq(12000) === 102000);
check('même table côté base', /p_rang <= 5000 THEN p_rang \+ 55000/.test(fs.readFileSync('../supabase/migrations/20261021_inscriptions.sql', 'utf8')));

console.log('\n=== Poids de paire ===');
check('une dame en tableau messieurs compte avec son équivalent', /WHEN p_genre = 'F' THEN coalesce\(fft_rang_equivalent_messieurs\(p_rang\), fft_rang_nc\('H'\)\)/.test(sql));
check('mixte : chacun dans son classement', /WHEN p_tableau = 'mixte' THEN coalesce\(p_rang, fft_rang_nc\(coalesce\(p_genre, 'H'\)\)\)/.test(sql));
check('l\'inscription calcule le poids avec ces règles', /fft_rang_pour_poids\(r1\.rang, coalesce\(r1\.genre, p_j1->>'genre'\), t\.genre\)/.test(sql));
check('l\'équipe de l\'admin reçoit les rangs effectifs', /fft_rang_pour_poids\(i\.rang1,/.test(sql));
check('admin : un joueur pas encore vérifié n\'est pas compté comme non classé', /if \(j\.fft_statut !== 'non_classe'\) return null;/.test(admin));
check('admin : équivalence dames en messieurs', /FFTRecherche\.rangEquivalentMessieurs\(j\.fft_rang\)/.test(admin));

console.log('\n=== Résultats ===');
check('place finale enregistrée par équipe', /ADD COLUMN IF NOT EXISTS place_finale integer/.test(sql));
check('à la clôture, les places des matchs deviennent officielles sans écraser une saisie',
      /if \(eq && eq\.place_finale == null\) auto\[p\.equipe_id\] = p\.place;/.test(admin));
check('résultats modifiables après clôture (pas de garde lecture seule)',
      !/async function enregistrerResultats[\s\S]{0,300}guardReadOnly/.test(admin));
check('l\'espace joueur reçoit place et taille du tableau', /'place', e\.place_finale/.test(sql) && /'nb_equipes', \(SELECT count\(\*\)/.test(sql));
var pub = fs.readFileSync('../js/tournois-calendrier.js', 'utf8');
check('le site n\'affiche que les tournois clôturés aux résultats enregistrés', /\.eq\('status', 'cloture'\)\.not\('resultats_le', 'is', null\)/.test(pub));

console.log('\n=== Alertes staff ===');
check('nouvelle inscription', /'Nouvelle inscription'/.test(sql));
check('désinscription par un joueur (pas celles du staff)', /NEW\.annulee_par IS DISTINCT FROM 'staff'/.test(sql));
check('absence annoncée après convocation', /'Absence annoncée — '/.test(sql));
check('adresse modifiable sans toucher au code', /INSERT INTO club_config \(cle, valeur\) VALUES \('email_alertes'/.test(sql));

console.log('\n=== Homonymes ===');
check('l\'annuaire propose de choisir parmi les classés du même nom', /function choisirHomonyme\(j, ligne\)/.test(admin));
check('le choix rattache l\'identifiant FFT', /fft_id_crm: c\.id_crm, fft_rang: c\.rang/.test(admin));
check('les candidats de l\'Oise passent en premier', /\(b\.comite === 'OISE'\) - \(a\.comite === 'OISE'\)/.test(admin));

console.log(ko ? '\n' + ko + ' échec(s)' : '\nTout est vert.');
process.exit(ko ? 1 : 0);
