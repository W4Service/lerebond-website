// Format 13 équipes : 4 TS exemptées + 3 poules de 3 (demande du 08/11/2026).
// 1ers de poule + meilleur 2e en quarts contre les TS, consolation 5-8,
// autres 2es aux places 9-10, triangulaire des 3es aux places 11-13.
var fs = require('fs');
var src = fs.readFileSync('../js/tournoi-admin.js', 'utf8');
var client = fs.readFileSync('../js/tournoi-client.js', 'utf8');
var ko = 0;
function check(n, c) { console.log((c ? '  ok   ' : '  FAIL ') + n); if (!c) ko++; }
function extraireTable(nom) {
    var i = src.indexOf('var ' + nom + ' = [');
    if (i < 0) throw new Error('introuvable : ' + nom);
    var j = src.indexOf('[', i), d = 0, k = j;
    do { if (src[k] === '[') d++; else if (src[k] === ']') d--; k++; } while (d > 0);
    return new Function('return ' + src.slice(j, k) + ';')();
}
var Q = extraireTable('QUARTS_4TS_3P3');

console.log('=== Quarts ===');
check('4 quarts', Q.length === 4);
check('TS 1,2,3,4 une fois chacune', Q.map(function (q) { return q.ts; }).sort().join(',') === '1,2,3,4');
var iTS1 = Q.findIndex(function (q) { return q.ts === 1; }), iTS2 = Q.findIndex(function (q) { return q.ts === 2; });
check('TS1 et TS2 aux deux bouts (finale seulement)', (iTS1 === 0 && iTS2 === 3) || (iTS1 === 3 && iTS2 === 0));
check('meilleur 2e contre TS1', Q[iTS1].src === 'meilleur_2e');
check('les 3 premiers de poule (A, B, C) une fois chacun',
    Q.filter(function (q) { return q.poule != null; }).map(function (q) { return q.poule; }).sort().join(',') === '0,1,2');

console.log('\n=== Comptes ===');
var poule = 3 * 3, finale = 4 + 2 + 2 + 2 + 2 + 1 + 3; // quarts, demies, finale+pf, conso, 5-6/7-8, 9-10, triangulaire
check('16 matchs de phase finale', finale === 16);
check('25 matchs au total', poule + finale === 25);
check('13 équipes', 4 + 9 === 13);

console.log('\n=== Branchements ===');
check('format au catalogue avec compo 3x3 + 4 hors poule', /id: 'maison_4ts_3p3'[\s\S]{0,700}compo: \{ poules: \[3, 3, 3\], horsPoule: 4 \}/.test(src));
check('quarts → demies + consolation (même branche que 2 poules de 3)', src.indexOf('lastRound.length === 4 && (isConfig4ts2p3() || isConfig4ts3p3())') > 0);
check('6 matchs = demies jouées', /sixEstDemies = [^;]*isConfig4ts3p3\(\)/.test(src));
check('fin du tableau principal à 8 matchs', src.indexOf("bracket === 'principal' && (isConfig4ts2p3() || isConfig4ts3p3())") > 0);
check('têtes de série = équipes hors poule', src.indexOf('isConfig4ts2p3() || isConfig4ts3p3() || isConfig4ts2p4()') > 0);
check('places 9-10 : autres 2es', /places_9_10', 0, 4\), 'a', 'autres_2es'/.test(src));
check('triangulaire 3es places 11-13 (3 matchs)', /places_11_13', i, 5 \+ i\)/.test(src) && src.indexOf('[[0, 1], [0, 2], [1, 2]]') > 0);
check('classement admin : places_11_13 à partir de 11', src.indexOf("{ key: 'places_11_13', start: 11 }") > 0);
check('classement public : places_11_13 à partir de 11', client.indexOf("{ key: 'places_11_13', start: 11 }") > 0);

console.log(ko ? '\n' + ko + ' échec(s)' : '\nTout est bon.');
process.exit(ko ? 1 : 0);
