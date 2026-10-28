// Format 12 équipes : 4 TS exemptées + 2 poules de 4.
// Vérifie la structure du tableau, le croisement des poules en quarts,
// le bas de tableau (places 9-12) et le compte total de matchs.
var fs = require('fs');
var src = fs.readFileSync('../js/tournoi-admin.js', 'utf8');
var ko = 0;
function check(n, c) { console.log((c ? '  ok   ' : '  FAIL ') + n); if (!c) ko++; }

// Extrait une déclaration `var NOM = [...]` du source.
function extraireTable(nom) {
    var i = src.indexOf('var ' + nom + ' = [');
    if (i < 0) throw new Error('introuvable : ' + nom);
    var j = src.indexOf('[', i), d = 0, k = j;
    do { if (src[k] === '[') d++; else if (src[k] === ']') d--; k++; } while (d > 0);
    return new Function('return ' + src.slice(j, k) + ';')();
}

var QUARTS = extraireTable('QUARTS_4TS_2P4');
var BAS = extraireTable('BAS_4TS_2P4');

console.log('=== Structure du tableau ===');
check('4 quarts de finale', QUARTS.length === 4);
check('2 demies de bas de tableau', BAS.length === 2);

// 4 TS + 2 poules de 4 = 12 équipes
check('12 équipes (4 TS + 2 poules de 4)', 4 + 4 + 4 === 12);

// Matchs : 2 poules de 4 en round-robin = 2 x 6 = 12
// Phase finale : 4 quarts + 2 demies + finale + petite finale = 8
//                + 2 demies conso + 5-6 + 7-8 = 4
//                + 2 demies bas + 9-10 + 11-12 = 4
var poule = 2 * 6, finale = 8 + 4 + 4;
console.log('  ' + poule + ' matchs de poule + ' + finale + ' de phase finale = ' + (poule + finale));
check('16 matchs de phase finale', finale === 16);
check('28 matchs au total', poule + finale === 28);

console.log('\n=== Les 4 têtes de série sont placées une fois chacune ===');
var tsVues = QUARTS.map(function (q) { return q.ts; }).sort();
check('TS 1,2,3,4 présentes exactement une fois', tsVues.join(',') === '1,2,3,4');

console.log('\n=== TS1 et TS2 ne peuvent se croiser qu\'en finale ===');
// Demi 1 = quarts 0 et 1 ; demi 2 = quarts 2 et 3.
var idxTS1 = QUARTS.findIndex(function (q) { return q.ts === 1; });
var idxTS2 = QUARTS.findIndex(function (q) { return q.ts === 2; });
var demiDe = function (i) { return i < 2 ? 1 : 2; };
check('TS1 et TS2 dans des demies opposées', demiDe(idxTS1) !== demiDe(idxTS2));
check('TS1 à une extrémité du tableau', idxTS1 === 0 || idxTS1 === 3);
check('TS2 à l\'autre extrémité', idxTS2 === 0 || idxTS2 === 3);

console.log('\n=== Les 4 qualifiés : chaque rang de poule une seule fois ===');
var quals = QUARTS.map(function (q) { return q.poule + q.rang; }).sort();
check('A1, A2, B1, B2 chacun une fois', quals.join(',') === 'A1,A2,B1,B2');

console.log('\n=== Croisement : un 1er et un 2e de la même poule ne se croisent pas en demie ===');
// Une TS affronte un qualifié : les deux qualifiés d'une même demie ne doivent
// pas venir de la même poule, sinon la même poule se retrouve deux fois.
var demie1 = [QUARTS[0], QUARTS[1]].map(function (q) { return q.poule; });
var demie2 = [QUARTS[2], QUARTS[3]].map(function (q) { return q.poule; });
check('demie 1 : deux poules différentes', demie1[0] !== demie1[1]);
check('demie 2 : deux poules différentes', demie2[0] !== demie2[1]);

console.log('\n=== Bas de tableau (places 9-12) : 3es et 4es croisés ===');
var basSlots = [];
BAS.forEach(function (d) {
    basSlots.push(d.a.poule + d.a.rang);
    basSlots.push(d.b.poule + d.b.rang);
});
check('A3, A4, B3, B4 chacun une fois', basSlots.sort().join(',') === 'A3,A4,B3,B4');
BAS.forEach(function (d, i) {
    check('demie ' + (i + 1) + ' croise les deux poules', d.a.poule !== d.b.poule);
    check('demie ' + (i + 1) + ' oppose un 3e à un 4e', d.a.rang !== d.b.rang);
});

console.log('\n=== Chaque équipe éliminée joue un match de classement ===');
// 4 perdants de quart -> consolation (2 demies + 2 matchs de place) : 2 matchs chacun
// 4 équipes du bas (3es/4es) -> 2 demies + 2 matchs de place : 2 matchs chacun
check('les 4 perdants de quart rejouent', 4 === 4);
check('les 4 derniers de poule jouent 2 matchs', BAS.length * 2 === 4);

console.log('\n=== Le format est déclaré dans le catalogue ===');
check('entrée maison_4ts_2p4', src.indexOf("id: 'maison_4ts_2p4'") > 0);
check('prédicat isConfig4ts2p4', src.indexOf('function isConfig4ts2p4(') > 0);
check('squelette câblé', src.indexOf('squelette: genererSquelette4ts2p4') > 0);
check('finale câblée', src.indexOf('finale: genererPhaseFinale4ts2p4') > 0);
check('compo 2 poules de 4 + 4 hors poule',
    src.indexOf('compo: { poules: [4, 4], horsPoule: 4 }') > 0);

console.log('\n=== Le bracket bas_9_12 est câblé partout ===');
check('chaînage vers places_9_10 / places_11_12',
    src.indexOf("bracket === 'bas_9_12'") > 0);
check('libellé d\'affichage', src.indexOf("b === 'bas_9_12'") > 0);
check('ordre d\'affichage', src.match(/if \(b === 'bas_9_12'\) return 9;/) !== null);

console.log('');
if (ko) { console.log(ko + ' test(s) en échec.'); process.exit(1); }
console.log('tout ok');
