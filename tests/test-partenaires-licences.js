// Recherche de partenaire, demandes de licence, double initialisation de l'admin.
var fs = require('fs');
var ko = 0;
function check(n, c) { console.log((c ? '  ok   ' : '  FAIL ') + n); if (!c) ko++; }
var sql = fs.readFileSync('../supabase/migrations/20261024_partenaires_licences.sql', 'utf8');

console.log('=== Recherche de partenaire ===');
check('liste publique : prénom + initiale, sans coordonnées',
      /RETURNS TABLE \(id uuid, prenom text, initiale text, genre char\(1\), fft_rang integer, fft_club text, message text, depuis timestamptz\)/.test(sql));
check('seulement les tournois publiés et à venir', /t\.publie AND t\.status = 'planifie'/.test(sql));
check('les cuts FFT s\'appliquent aussi à la recherche', /motif := fft_motif_inegibilite\(t\.categorie, t\.genre, r\.rang/.test(sql));
check('une proposition transmet les coordonnées par e-mail, jamais à l\'écran', /Contactez-le\/la : /.test(sql));
check('anti-abus : 5 propositions par quart d\'heure et par adresse', /interval '15 minutes'\) >= 5/.test(sql));
check('inscrit au tournoi = recherche fermée', /CREATE TRIGGER trg_inscriptions_ferme_recherches AFTER INSERT ON inscriptions/.test(sql));
check('retirer sa recherche : seulement avec son lien', /c\.jeton = p_jeton AND c\.joueur_id = r\.joueur_id/.test(sql));
check('tables réservées au staff', /ARRAY\['recherches_partenaire', 'propositions_partenaire'\]/.test(sql));
var cal = fs.readFileSync('../js/tournois-calendrier.js', 'utf8');
check('le calendrier propose « Trouver un partenaire »', /tournois\/partenaires\/\?t=/.test(cal));

console.log('\n=== Demandes de licence ===');
check('champs obligatoires contrôlés côté serveur', /Prénom, nom, sexe, date de naissance, e-mail et téléphone sont obligatoires/.test(sql));
check('une demande par adresse et par heure', /cree_le > now\(\) - interval '1 hour'/.test(sql));
check('le club est alerté', /PERFORM alerter_staff\('Demande de licence — '/.test(sql));
check('données réservées au staff', /CREATE POLICY demandes_licence_staff ON demandes_licence FOR ALL TO authenticated USING \(est_staff\(\)\)/.test(sql));
var page = fs.readFileSync('../licence/index.html', 'utf8');
check('consentement explicite avant envoi', /name="accord" required/.test(page));

console.log('\n=== Admin : une seule initialisation ===');
var admin = fs.readFileSync('../js/tournoi-admin.js', 'utf8');
check('un chargement en cours est partagé', /if \(chargementEnCours\) return chargementEnCours;/.test(admin));
check('pas de rechargement moins de 3 s après le précédent', /Date\.now\(\) - dernierChargement < 3000/.test(admin));
var planning = fs.readFileSync('../js/tournoi-planning.js', 'utf8');
check('« Lancer » force la relecture du tournoi', /window\.TournoiAdmin\.reload\(\)/.test(planning));

console.log('\n=== Page Événements : le calendrier est la source des tournois ===');
var ev = fs.readFileSync('../js/events-renderer.js', 'utf8');
check('les tournois planifiés et publiés s\'affichent comme événements', /from\('tournois_calendrier'\)/.test(ev) && /eq\('status', 'planifie'\)/.test(ev));
check('un tournoi aussi saisi dans events.json le même jour n\'apparaît qu\'une fois',
      /!\(e\.category === 'padel' && \/\^tournoi\/\.test\(e\.type \|\| ''\) && datesTournois\[e\.date\]\)/.test(ev));
check('l\'inscription s\'ouvre sur le site, pas dans un nouvel onglet', /ev\.interne && ev\.registration_link/.test(ev));
var pageEv = fs.readFileSync('../evenements/index.html', 'utf8');
check('la page charge le client Supabase avant le rendu',
      pageEv.indexOf('js/supabase-client.js') > 0 && pageEv.indexOf('js/supabase-client.js') < pageEv.indexOf('js/events-renderer.js'));

console.log(ko ? '\n' + ko + ' échec(s)' : '\nTout est vert.');
process.exit(ko ? 1 : 0);
