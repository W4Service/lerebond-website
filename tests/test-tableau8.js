// Tableau direct de 8 équipes : quarts, demies, finale, et matchs de classement
// pour toutes les équipes.
//
// Guide de la compétition padel, III.4 — Constitution des tableaux :
//   « Seules les TS 1 et 2 sont placées de part et d'autre du Tableau (TS 1 en
//     bas du tableau). Toutes les autres paires sont placées par tirage au sort.
//     - Tirage au sort pour placement des TS 3 et 4
//     - Tirage au sort pour placement des TS 5 à 8 (ou groupe 5 à 8 si
//       uniquement 4 TS) »
//
// Guide, I.2 / cahier des charges :
//   « les matchs de classement sont obligatoires : chaque paire doit avoir, au
//     minimum, 3 matchs programmés. »
var fs = require('fs');
var T = require('../js/tournoi-tirage.js');
var ko = 0;
function check(n, c) { console.log((c ? '  ok   ' : '  FAIL ') + n); if (!c) ko++; }

var src = fs.readFileSync('../js/tournoi-admin.js', 'utf8');
var srcPrint = fs.readFileSync('../js/tournoi-print.js', 'utf8');
var srcTV = fs.readFileSync('../js/tournoi-tirage-tv.js', 'utf8');

function eq8() {
    var a = [];
    for (var i = 1; i <= 8; i++) a.push({ id: 'E' + i, nom: 'TS' + i });
    return a;
}
function tableauDe(positions) {
    var t = new Array(8);
    Object.keys(positions).forEach(function (id) { t[positions[id]] = id; });
    return t;
}

console.log('=== TS 1 et 2 : placement d\'office, de part et d\'autre ===');
console.log('  « Seules les TS 1 et 2 sont placées de part et d\'autre du Tableau');
console.log('    (TS 1 en bas du tableau) »');
var okOffice = true, okMoities = true, okUnique = true, okRejeu = true;
var posTS3 = {}, posTS1 = {};
for (var s = 0; s < 400; s++) {
    var r = T.preparerTirageTableau({ equipes: eq8(), nbTS: 4, seed: s });
    var p = r.positions;
    posTS1[p.E1] = true;
    posTS3[p.E3] = true;
    if (p.E1 !== 7) okOffice = false;          // TS1 en bas
    if (p.E2 !== 0) okMoities = false;         // TS2 à l'autre extrémité
    if ((p.E3 < 4) === (p.E4 < 4)) okMoities = false;  // TS3/TS4 séparées
    if (Object.keys(p).length !== 8) okUnique = false;
    var vus = {};
    Object.keys(p).forEach(function (id) { vus[p[id]] = (vus[p[id]] || 0) + 1; });
    if (Object.keys(vus).length !== 8) okUnique = false;
    if (!T.verifierTirageTableau({ equipes: eq8(), nbTS: 4, seed: s }, p)) okRejeu = false;
}
check('TS 1 toujours en bas du tableau (position 7)', okOffice && Object.keys(posTS1).length === 1);
check('TS 2 toujours à l\'autre extrémité (position 0)', okMoities);
check('aucune collision de position sur 400 tirages', okUnique);

console.log('\n=== TS 3 et 4 : tirées au sort, une par moitié ===');
// Elles ne doivent croiser TS1/TS2 qu'en demi-finale : une dans chaque moitié.
check('TS 3 et TS 4 jamais dans la même moitié', okMoities);
check('la position de TS 3 varie selon le tirage', Object.keys(posTS3).length > 1);
check('elle reste dans les places prévues (3 ou 4)',
      Object.keys(posTS3).sort().join(',') === '3,4');

console.log('\n=== Un tirage se rejoue à l\'identique ===');
// Chapitre I : un tableau affiché ne peut plus être modifié. La graine permet
// de prouver qu'un tirage contesté n'a pas été refait.
check('même graine, mêmes positions', okRejeu);
var a1 = T.preparerTirageTableau({ equipes: eq8(), nbTS: 4, seed: 7 });
var a2 = T.preparerTirageTableau({ equipes: eq8(), nbTS: 4, seed: 8 });
check('deux graines donnent deux tableaux différents',
      tableauDe(a1.positions).join() !== tableauDe(a2.positions).join());
check('le déroulé public annonce les 3 temps du tirage',
      a1.etapes.filter(function (e) { return e.phase === 'ts_office'; }).length === 2
      && a1.etapes.filter(function (e) { return e.phase === 'ts_tirage'; }).length === 2
      && a1.etapes.filter(function (e) { return e.phase === 'tirage'; }).length === 4);

console.log('\n=== Tournoi loisir : aucune tête de série ===');
var libre = T.preparerTirageTableau({ equipes: eq8(), nbTS: 0, seed: 3 });
check('les 8 équipes sont tirées', libre.etapes.length === 8
      && libre.etapes.every(function (e) { return e.phase === 'tirage'; }));
check('toutes les positions sont occupées',
      tableauDe(libre.positions).filter(Boolean).length === 8);

console.log('\n=== Le tableau est créé en quarts, dans l\'ordre du tirage ===');
check('le format existe et n\'exige aucune poule',
      /id: 'tableau_8'/.test(src) && /compo: \{ poules: \[\], horsPoule: 8 \}/.test(src));
check('il s\'applique à 8 équipes sans poules',
      /function isConfigTableau8\(\) \{\s*\n\s*return poules\.length === 0 && equipes\.length === 8;/.test(src));
check('il est homologable', /id: 'tableau_8'[\s\S]{0,700}?homologable: true/.test(src));
check('4 quarts sont créés', /for \(var q = 0; q < 4; q\+\+\)/.test(src)
      && /equipe_a_id: ordre8\[q \* 2\],/.test(src));
check('un tirage incohérent fait échouer la création', /Tirage incohérent/.test(src));
check('le tirage du tableau a son propre déroulé',
      /async function lancerTirageTableau/.test(src));
check('la graine est enregistrée pour pouvoir rejouer le tirage',
      /lancerTirageTableau[\s\S]*?tirage_seed: seed/.test(src));
check('4 TS en homologué, aucune en loisir',
      /var nbTS = homologue \? 4 : 0;/.test(src));

console.log('\n=== Demies Q1/Q2 et Q3/Q4, pas Q1/Q4 ===');
// Le seeding générique croise les quarts opposés. Ici le tableau est déjà
// ordonné par le tirage : croiser à nouveau ferait se rencontrer TS1 et TS2
// en demie au lieu de la finale.
check('une branche dédiée existe pour le tableau de 8',
      /lastRound\.length === 4 && isConfigTableau8\(\)/.test(src));
var brancheIdx = src.indexOf("lastRound.length === 4 && isConfigTableau8()");
var branche = src.slice(brancheIdx, brancheIdx + 2600);
check('demie 1 = vainqueurs des quarts 1 et 2',
      /equipe_a_id: lastRound\[0\]\.vainqueur_id,\s*\n\s*equipe_b_id: lastRound\[1\]\.vainqueur_id/.test(branche));
check('demie 2 = vainqueurs des quarts 3 et 4',
      /equipe_a_id: lastRound\[2\]\.vainqueur_id,\s*\n\s*equipe_b_id: lastRound\[3\]\.vainqueur_id/.test(branche));
check('les 4 perdants de quart partent en consolation',
      /bracket: 'consolation_5_8'/.test(branche));

console.log('\n=== Chaque équipe a 3 matchs et une place unique ===');
console.log('  « les matchs de classement sont obligatoires : chaque paire doit');
console.log('    avoir, au minimum, 3 matchs programmés »');

// Simulation complète d'un tournoi : on rejoue les 12 matchs et on vérifie
// que le classement final attribue bien 8 places distinctes.
function extraireFn(nom, source) {
    var i = source.indexOf('function ' + nom + '(');
    if (i < 0) throw new Error('introuvable : ' + nom);
    var j = source.indexOf('{', i), d = 0, k = j;
    do { if (source[k] === '{') d++; else if (source[k] === '}') d--; k++; } while (d > 0);
    return source.slice(i, k);
}
var findEq = function (equipes, id) { return equipes.find(function (e) { return e.id === id; }); };
var computeClassementFinal = new Function('findEq', 'return ' + extraireFn('computeClassementFinal', srcPrint))(findEq);

// Tableau tiré : positions 0..7. Le plus fort de chaque match gagne (ordre E1 > E2 > ...).
var tirage = T.preparerTirageTableau({ equipes: eq8(), nbTS: 4, seed: 42 });
var tbl = tableauDe(tirage.positions);
var force = function (id) { return parseInt(id.slice(1), 10); };   // E1 le plus fort
var plusFort = function (a, b) { return force(a) < force(b) ? a : b; };
var plusFaible = function (a, b) { return force(a) < force(b) ? b : a; };

var ms = [], ordre = 0;
function match(bracket, a, b) {
    var m = { phase: 'finale', bracket: bracket, ordre: ordre++,
              equipe_a_id: a, equipe_b_id: b, status: 'termine',
              vainqueur_id: plusFort(a, b) };
    ms.push(m);
    return m;
}
// Quarts (ordre du tableau)
var q = [];
for (var i = 0; i < 4; i++) q.push(match('principal', tbl[i * 2], tbl[i * 2 + 1]));
// Demies Q1/Q2 et Q3/Q4
var d1 = match('principal', q[0].vainqueur_id, q[1].vainqueur_id);
var d2 = match('principal', q[2].vainqueur_id, q[3].vainqueur_id);
// Finale + petite finale
match('principal', d1.vainqueur_id, d2.vainqueur_id);
match('principal', plusFaible(d1.equipe_a_id, d1.equipe_b_id), plusFaible(d2.equipe_a_id, d2.equipe_b_id));
// Consolation : demies entre perdants de quart, puis 5-6 et 7-8
var perdant = function (m) { return plusFaible(m.equipe_a_id, m.equipe_b_id); };
var c1 = match('consolation_5_8', perdant(q[0]), perdant(q[1]));
var c2 = match('consolation_5_8', perdant(q[2]), perdant(q[3]));
match('places_5_6', c1.vainqueur_id, c2.vainqueur_id);
match('places_7_8', perdant(c1), perdant(c2));

check('12 matchs au total', ms.length === 12);
var parEquipe = {};
ms.forEach(function (m) {
    parEquipe[m.equipe_a_id] = (parEquipe[m.equipe_a_id] || 0) + 1;
    parEquipe[m.equipe_b_id] = (parEquipe[m.equipe_b_id] || 0) + 1;
});
check('les 8 équipes jouent', Object.keys(parEquipe).length === 8);
check('chacune joue exactement 3 matchs (minimum réglementaire)',
      Object.keys(parEquipe).every(function (k) { return parEquipe[k] === 3; }));

var equipesObj = eq8();
var cl = computeClassementFinal(ms, equipesObj);
var rangs = cl.map(function (x) { return x.place; });
check('8 places sont attribuées', cl.length === 8);
check('les places vont de 1 à 8 sans trou ni doublon',
      rangs.join(',') === '1,2,3,4,5,6,7,8');
check('aucune place vide', cl.every(function (x) { return !!x.nom; }));
// Le plus fort gagne chaque match : le classement doit suivre la force.
check('le tableau respecte la force des paires (TS1 gagne, TS2 finaliste)',
      cl[0].nom === 'TS1' && cl[1].nom === 'TS2');
check('TS 1 et TS 2 ne se rencontrent qu\'en finale',
      ms.slice(0, 6).every(function (m) {
          var ids = [m.equipe_a_id, m.equipe_b_id];
          return !(ids.indexOf('E1') >= 0 && ids.indexOf('E2') >= 0);
      }));

console.log('\n=== Le podium n\'est pas faussé par les quarts ===');
// computeClassementFinal lisait principal[0] et [1] comme les demies. Avec un
// tableau démarrant en quarts, ce sont les quarts : le podium était faux.
check('les demies sont lues après les quarts',
      /if \(principal\.length >= 8\) principal = principal\.slice\(4\);/.test(srcPrint));

console.log('\n=== L\'ecran TV montre le tableau se remplir ===');
// Tirage « devant temoins » : le public doit voir les cases se remplir, et
// celles qui restent a tirer.
check('une grille de tableau est rendue', /TirageTV\.prototype\.grilleTableau/.test(srcTV));
check('les etats du tirage de tableau sont pris en charge',
      /if \(etat\.tableau\) \{/.test(srcTV));
check('le commentaire du tirage est affiche', /etat\.commentaire/.test(srcTV));
check('les cases encore vides restent visibles',
      /tirage-tv-poule-eq--vide/.test(srcTV));
check('les quarts sont regroupes', /'Quart ' \+ q/.test(srcTV));
check('la case vide a un style', /\.tirage-tv-poule-eq--vide/.test(
      fs.readFileSync('../css/tournoi.css', 'utf8')));

console.log(ko === 0 ? '\nTous les tests passent.' : '\n' + ko + ' test(s) en échec.');
process.exit(ko === 0 ? 0 : 1);
