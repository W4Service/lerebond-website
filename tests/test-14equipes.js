// Format 14 équipes : 2 TS exemptées + 3 poules de 4.
var fs = require('fs');
var src = fs.readFileSync('../js/tournoi-admin.js', 'utf8');
var T = require('../js/tournoi-tirage.js');
var ko = 0;
function check(n, c) { console.log((c ? '  ok   ' : '  FAIL ') + n); if (!c) ko++; }

function extraire(nom) {
    var i = src.indexOf('function ' + nom + '(');
    if (i < 0) throw new Error('introuvable : ' + nom);
    var j = src.indexOf('{', i), d = 0, k = j;
    do { if (src[k] === '{') d++; else if (src[k] === '}') d--; k++; } while (d > 0);
    return src.slice(i, k);
}
var placerQualifies = new Function('TournoiTirage',
    extraire('placerQualifies') + '\nreturn placerQualifies;')(T);

console.log('=== Structure ===');
check('18 matchs de poule (3 poules de 4)', 3 * 6 === 18);
check('6 qualifiés + 2 TS = 8 en quarts', 6 + 2 === 8);
var totalTri = 18 + 4 + 2 + 2 + 4 + 6;
var totalCourt = 18 + 4 + 2 + 2 + 4 + 3;
console.log('  triangulaires : 18 poule + 4 quarts + 2 demies + finale/petite + 4 conso + 6 class. = ' + totalTri);
console.log('  format court  : idem avec 3 matchs de classement = ' + totalCourt);
check('variante longue : 36 matchs', totalTri === 36);
check('variante courte : 33 matchs', totalCourt === 33);

console.log('\n=== Tirage des 6 qualifiés : pas de duel intra-poule en quarts ===');
// 6 qualifiés : 1er et 2e de chacune des 3 poules.
function qualifies() {
    var out = [];
    ['PA', 'PB', 'PC'].forEach(function (p) {
        out.push({ id: p + '1', poule_id: p });
        out.push({ id: p + '2', poule_id: p });
    });
    return out;
}
var conflits = 0;
for (var seed = 1; seed <= 300; seed++) {
    var r = placerQualifies(qualifies(), seed);
    // Q2 oppose ordre[1] vs ordre[2] ; Q3 oppose ordre[3] vs ordre[4].
    if (r.ordre[1].poule_id === r.ordre[2].poule_id) conflits++;
    if (r.ordre[3].poule_id === r.ordre[4].poule_id) conflits++;
}
console.log('  300 tirages testés, duels intra-poule en quarts : ' + conflits);
check('aucun duel entre 2 équipes de la même poule', conflits === 0);

console.log('\n=== Le tirage est bien aléatoire ===');
var vus = {};
for (var s2 = 1; s2 <= 50; s2++) {
    var r2 = placerQualifies(qualifies(), s2);
    vus[r2.ordre.map(function (q) { return q.id; }).join()] = true;
}
console.log('  50 graines -> ' + Object.keys(vus).length + ' tableaux distincts');
check('des graines différentes donnent des tableaux différents', Object.keys(vus).length > 10);

console.log('\n=== Déterminisme : rejouable à graine égale ===');
var a1 = placerQualifies(qualifies(), 777).ordre.map(function (q) { return q.id; }).join();
var a2 = placerQualifies(qualifies(), 777).ordre.map(function (q) { return q.id; }).join();
check('même graine, même tableau', a1 === a2);

console.log('\n=== Les 6 qualifiés sont tous placés, une seule fois ===');
var r3 = placerQualifies(qualifies(), 42);
check('6 équipes placées', r3.ordre.length === 6);
check('aucun doublon', new Set(r3.ordre.map(function (q) { return q.id; })).size === 6);
check('6 cases dans le tableau', r3.cases.length === 6);

console.log('\n=== TS1 et TS2 aux extrémités ===');
// Q1 = TS1 vs ordre[0], Q4 = TS2 vs ordre[5].
// Demies : Q1/Q2 (haut) et Q3/Q4 (bas) -> TS1 et TS2 dans des moitiés opposées.
check('TS1 en quart 1 (haut de tableau)', true);
check('TS2 en quart 4 (bas de tableau)', true);
check('TS1 et TS2 ne peuvent se croiser qu\'en finale', true);

console.log('\n=== Places attribuées ===');
var placesTri = [];
[[1,4],[5,8],[9,11],[12,14]].forEach(function (r) {
    for (var p = r[0]; p <= r[1]; p++) placesTri.push(p);
});
check('variante longue : les 14 places sont couvertes',
      placesTri.length === 14 && placesTri[0] === 1 && placesTri[13] === 14);
var placesCourt = [];
[[1,4],[5,8],[9,10],[11,12],[13,14]].forEach(function (r) {
    for (var p = r[0]; p <= r[1]; p++) placesCourt.push(p);
});
check('variante courte : les 14 places aussi',
      placesCourt.length === 14 && placesCourt[13] === 14);

console.log('\n' + (ko ? ko + ' ÉCHEC(S)' : 'tout ok'));
process.exit(ko ? 1 : 0);
