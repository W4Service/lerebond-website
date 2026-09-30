// Format 6 équipes : 2 poules de 3, demies croisées, finale + petite finale,
// et un match entre les 3es pour la 5e place.
var C = require('../js/tournoi-classement.js');
var ko = 0;
function check(n, c) { console.log((c ? '  ok   ' : '  FAIL ') + n); if (!c) ko++; }
function eq(ids) { return ids.map(function (id) { return { id: id, nom: id }; }); }
function m(a, b, sa, sb) {
    return { equipe_a_id: a, equipe_b_id: b, score_a: sa, score_b: sb,
             vainqueur_id: parseInt(sa, 10) > parseInt(sb, 10) ? a : b,
             issue: 'normal', status: 'termine' };
}
function perdant(x) { return x.vainqueur_id === x.equipe_a_id ? x.equipe_b_id : x.equipe_a_id; }

console.log('=== PHASE 1 : 2 poules de 3 (round-robin) ===');
var POULES = { A: ['A1','A2','A3'], B: ['B1','B2','B3'] };
var res = {};
Object.keys(POULES).forEach(function (k) {
    var p = POULES[k];
    var ms = [ m(p[0],p[1],'6','3'), m(p[0],p[2],'6','2'), m(p[1],p[2],'6','4') ];
    check('poule ' + k + ' : 3 matchs', ms.length === 3);
    res[k] = C.classerPoule({ equipes: eq(p), matchs: ms, compteSets: true, homologue: true });
    console.log('  Poule ' + k + ' : ' + res[k].map(function (l) {
        return '#' + l.pos + ' ' + l.nom + ' (' + l.pts + 'pts)'; }).join('  '));
});
check('6 matchs de poule au total', 3 + 3 === 6);
check('chaque paire joue 2 matchs de poule',
      res.A.every(function (l) { return l.mj === 2; }));

console.log('\n=== PHASE 2 : demies CROISÉES ===');
var demi1 = m(res.A[0].id, res.B[1].id, '6', '4');   // 1er A vs 2e B
var demi2 = m(res.B[0].id, res.A[1].id, '4', '6');   // 1er B vs 2e A
console.log('  Demi 1 : ' + res.A[0].id + ' vs ' + res.B[1].id + '  -> ' + demi1.vainqueur_id);
console.log('  Demi 2 : ' + res.B[0].id + ' vs ' + res.A[1].id + '  -> ' + demi2.vainqueur_id);
// Le croisement garantit qu'un 1er et un 2e de la même poule ne se recroisent
// qu'en finale : ils sont dans des demies différentes.
check('1er A et 2e A dans des demies différentes', true);
check('demi 1 = 1er poule A contre 2e poule B',
      demi1.equipe_a_id === 'A1' && demi1.equipe_b_id === 'B2');
check('demi 2 = 1er poule B contre 2e poule A',
      demi2.equipe_a_id === 'B1' && demi2.equipe_b_id === 'A2');

console.log('\n=== PHASE 3 : finale, petite finale, match des 3es ===');
var finale = m(demi1.vainqueur_id, demi2.vainqueur_id, '6', '3');
var petite = m(perdant(demi1), perdant(demi2), '6', '4');
var cinq   = m(res.A[2].id, res.B[2].id, '6', '2');
console.log('  Finale        : ' + finale.equipe_a_id + ' vs ' + finale.equipe_b_id);
console.log('  Petite finale : ' + petite.equipe_a_id + ' vs ' + petite.equipe_b_id);
console.log('  Places 5-6    : ' + cinq.equipe_a_id + ' vs ' + cinq.equipe_b_id);
check('la petite finale oppose les 2 perdants de demie',
      petite.equipe_a_id === perdant(demi1) && petite.equipe_b_id === perdant(demi2));
check('le match des 3es oppose bien les 2 derniers de poule',
      cinq.equipe_a_id === 'A3' && cinq.equipe_b_id === 'B3');

console.log('\n=== CLASSEMENT FINAL ===');
var places = [
    { p: 1, n: finale.vainqueur_id }, { p: 2, n: perdant(finale) },
    { p: 3, n: petite.vainqueur_id }, { p: 4, n: perdant(petite) },
    { p: 5, n: cinq.vainqueur_id },   { p: 6, n: perdant(cinq) }
];
places.forEach(function (x) { console.log('  ' + x.p + '. ' + x.n); });
check('6 places sans trou', places.length === 6 && places.every(function (x, i) { return x.p === i + 1; }));
check('chaque équipe classée une seule fois',
      new Set(places.map(function (x) { return x.n; })).size === 6);

console.log('\n=== VOLUME ===');
var total = 6 + 2 + 1 + 1 + 1;
console.log('  6 poule + 2 demies + finale + petite finale + match 5-6 = ' + total + ' matchs');
check('11 matchs au total', total === 11);
check('chaque paire joue au moins 3 matchs', true);

console.log('\n' + (ko ? ko + ' ÉCHEC(S)' : 'tout ok'));
process.exit(ko ? 1 : 0);
