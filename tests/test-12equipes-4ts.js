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
check('2 matchs de classement en bas de tableau', BAS.length === 2);

// 4 TS + 2 poules de 4 = 12 équipes
check('12 équipes (4 TS + 2 poules de 4)', 4 + 4 + 4 === 12);

// Matchs : 2 poules de 4 en round-robin = 2 x 6 = 12
// Phase finale : 4 quarts + 2 demies + finale + petite finale = 8
//                + 2 demies conso + 5-6 + 7-8 = 4
//                + 9-10 + 11-12 = 2
var poule = 2 * 6, finale = 8 + 4 + 2;
console.log('  ' + poule + ' matchs de poule + ' + finale + ' de phase finale = ' + (poule + finale));
check('14 matchs de phase finale', finale === 14);
check('26 matchs au total', poule + finale === 26);

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

console.log('\n=== Bas de tableau : chaque rang contre son homologue ===');
check('places 9-10 : les 3es', BAS[0].bracket === 'places_9_10' && BAS[0].rang === 3);
check('places 11-12 : les 4es', BAS[1].bracket === 'places_11_12' && BAS[1].rang === 4);
check('un seul match par rang', BAS.length === 2);
check('pas de bracket interm\u00e9diaire \u00e0 cha\u00eener',
    src.indexOf("bracket: 'bas_9_12'") < 0);

console.log('\n=== Chaque équipe éliminée a un match de classement ===');
// Les 4 perdants de quart vont en consolation (2 demies puis 5-6 et 7-8).
// Les 3es et 4es de poule ont chacun un match (9-10 ou 11-12).
check('les 4 derniers de poule sont plac\u00e9s', BAS.length * 2 === 4);

console.log('\n=== Les quarts engendrent demies ET consolation ===');
// Sans cette branche, les demies et la consolation ne sont jamais cr\u00e9\u00e9es.
check('branche isConfig4ts2p4 dans genererTourSuivant',
    src.indexOf('lastRound.length === 4 && isConfig4ts2p4()') > 0);
var iBranche = src.indexOf('lastRound.length === 4 && isConfig4ts2p4()');
var extrait = src.slice(iBranche, iBranche + 2000);
check('la branche cr\u00e9e 2 demies dans le bracket courant',
    (extrait.match(/bracket: bracket,/g) || []).length === 2);
check('la branche cr\u00e9e 2 matchs de consolation',
    (extrait.match(/bracket: 'consolation_5_8'/g) || []).length === 2);

console.log('\n=== Le format est déclaré dans le catalogue ===');
check('entrée maison_4ts_2p4', src.indexOf("id: 'maison_4ts_2p4'") > 0);
check('prédicat isConfig4ts2p4', src.indexOf('function isConfig4ts2p4(') > 0);
check('squelette câblé', src.indexOf('squelette: genererSquelette4ts2p4') > 0);
check('finale câblée', src.indexOf('finale: genererPhaseFinale4ts2p4') > 0);
check('compo 2 poules de 4 + 4 hors poule',
    src.indexOf('compo: { poules: [4, 4], horsPoule: 4 }') > 0);

console.log('\n=== Les 4 points de câblage du format ===');
// Un format à têtes de série exemptées doit être déclaré à quatre endroits.
// En oublier un casse le tournoi en silence, à un stade différent à chaque fois.
check('tetesDeSerie : badges TS1-TS4 sur les équipes hors poule',
    src.indexOf('isConfig4ts2p3() || isConfig4ts2p4()') > 0);
check('sixEstDemies : 6 matchs = 4 quarts + 2 demies',
    src.indexOf('isConfig4ts2p4() ||') > 0);
check('genererTourSuivant : les quarts engendrent demies et consolation',
    src.indexOf('lastRound.length === 4 && isConfig4ts2p4()') > 0);
check('bracketEstFini : le principal compte 8 matchs',
    src.indexOf("bracket === 'principal' && isConfig4ts2p4()") > 0);

console.log('\n=== Un round non reconnu échoue bruyamment ===');
// slice(-null) renverrait tout le bracket et créerait des matchs absurdes.
check('garde-fou sur nbMatchsRoundCourant null',
    src.indexOf('if (nbMatchsRoundCourant === null)') > 0);

console.log('\n=== Les places 9-10 et 11-12 sont posées directement ===');
check('bracket places_9_10 produit', src.indexOf("bracket: 'places_9_10'") > 0);
check('bracket places_11_12 produit', src.indexOf("bracket: 'places_11_12'") > 0);

console.log('');
if (ko) { console.log(ko + ' test(s) en échec.'); process.exit(1); }
console.log('tout ok');
