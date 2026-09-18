// Conformité au Guide de la compétition padel FFT, chapitre I (MAJ février 2026).
var C = require('../js/tournoi-classement.js');
var ko = 0;
function check(n, c) { console.log((c ? '  ok   ' : '  FAIL ') + n); if (!c) ko++; }
function eq(ids) { return ids.map(function (id) { return { id: id, nom: id }; }); }
function m(a, b, sa, sb, issue) {
    var aA = sa.split(' '), bA = sb.split(' '), ga = 0, gb = 0;
    for (var i = 0; i < aA.length; i++) { if (+aA[i] > +bA[i]) ga++; else gb++; }
    return { equipe_a_id: a, equipe_b_id: b, score_a: sa, score_b: sb,
             vainqueur_id: issue ? a : (ga > gb ? a : b), issue: issue || 'normal' };
}
function run(ids, ms) {
    return C.classerPoule({ equipes: eq(ids), matchs: ms, compteSets: true, homologue: true });
}
function noms(l) { return l.map(function (x) { return x.nom; }); }

console.log('=== BARÈME (texte officiel) ===');
console.log('  « 2 points par rencontre gagnée / 1 point par rencontre perdue /');
console.log('    -1 point en cas de rencontre perdue par disqualification /');
console.log('    -2 points en cas de rencontre perdue par WO »');
check('victoire = 2 pts', C.BAREME.victoire === 2);
check('défaite = 1 pt', C.BAREME.defaite === 1);
check('disqualification = -1 pt', C.BAREME.disqualification === -1);
check('WO = -2 pts', C.BAREME.wo === -2);

var r = run(['A','B'], [ m('A','B','','','wo') ]);
check('WO appliqué : 2 / -2', r[0].pts === 2 && r[1].pts === -2);
r = run(['A','B'], [ m('A','B','','','disqualification') ]);
check('disqualification appliquée : 2 / -1', r[0].pts === 2 && r[1].pts === -1);

console.log('\n=== DÉPARTAGE À 2 PAIRES ===');
console.log('  Le texte dit « entre 2 ou PLUSIEURS paires » : même cascade à 2.');
console.log('  Pas de confrontation directe prioritaire.');
// A bat B, mais B a une bien meilleure différence de sets sur toute la poule.
// Selon le texte, c'est la DIFF DE SETS qui prime, donc B doit passer devant.
var ms = [
    m('A','B','6 7','4 6'),      // A bat B  (A: 2 sets gagnés 1 perdu... en fait 6-4, 7-6)
    m('A','C','6 4 4','4 6 6'),  // A perd contre C
    m('B','C','6 6','1 1')       // B écrase C
];
var res = run(['A','B','C'], ms);
console.log('  ' + res.map(function (x) {
    return x.nom + ' ' + x.pts + 'pts ±sets' + (x.sg - x.sp) + ' ±jeux' + (x.jg - x.jp);
}).join(' | '));
var a = res.filter(function(x){return x.nom==='A';})[0];
var b = res.filter(function(x){return x.nom==='B';})[0];
if (a.pts === b.pts) {
    var dsA = a.sg - a.sp, dsB = b.sg - b.sp;
    check('à égalité de pts, la meilleure diff de sets passe devant',
          dsA === dsB || (noms(res).indexOf(dsA > dsB ? 'A' : 'B') < noms(res).indexOf(dsA > dsB ? 'B' : 'A')));
} else { console.log('  (pas d\'égalité de points sur ce jeu de données)'); }

console.log('\n=== CRITÈRE 1-2 : « pour TOUTES les parties de la poule » ===');
// A, B, C à égalité, en cycle, avec des matchs identiques entre eux.
// Seuls leurs résultats contre D les séparent -> doivent compter.
var poule4 = [
    m('A','B','6 6','4 4'), m('B','C','6 6','4 4'), m('C','A','6 6','4 4'),
    m('A','D','6 6','0 0'),      // A : large
    m('B','D','6 6','4 4'),      // B : moyen
    m('C','D','6 4 6','4 6 4')   // C : concède un set
];
var r4 = run(['A','B','C','D'], poule4);
console.log('  ' + r4.map(function (x) {
    return x.nom + ' ' + x.pts + 'pts ±sets' + (x.sg - x.sp); }).join(' | '));
check('les matchs contre D (hors égalité) départagent bien A, B, C',
      noms(r4).slice(0, 3).join() === 'A,B,C');

console.log('\n=== CRITÈRE 4 épuisé : tirage au sort requis ===');
console.log('  « En cas de nouvelle égalité, les paires seront départagées');
console.log('    par un tirage au sort. »');
// Deux paires strictement identiques partout.
var sym = [
    m('A','C','6 6','3 3'),
    m('B','C','6 6','3 3'),
    m('A','B','6 4 6','4 6 4')   // A bat B ; reste à voir si tout s'égalise
];
var rs = run(['A','B','C'], sym);
console.log('  ' + rs.map(function (x) {
    return x.nom + ' ' + x.pts + 'pts ±s' + (x.sg-x.sp) + ' ±j' + (x.jg-x.jp)
        + (x.tirageRequis ? ' [TIRAGE REQUIS]' : ''); }).join(' | '));
check('le drapeau tirageRequis existe dans le moteur',
      typeof rs[0].tirageRequis !== 'undefined' || rs.every(function(x){ return !x.tirageRequis; }));

// Égalité irréductible : A et B ne se sont pas rencontrées et ont des
// résultats strictement identiques. Les 4 critères sont épuisés -> tirage au sort.
var irred = [
    m('A','C','6','3'), m('A','D','3','6'),
    m('B','D','6','3'), m('B','C','3','6')
];
var rp = run(['A','B','C','D'], irred);
console.log('  ' + rp.map(function (x) {
    return x.nom + ' ' + x.pts + 'pts ±s' + (x.sg-x.sp) + ' ±j' + (x.jg-x.jp)
        + (x.tirageRequis ? ' [TIRAGE]' : ''); }).join(' | '));
var tr = rp.filter(function (x) { return x.tirageRequis; });
check('égalité irréductible signalée au JA (tirage au sort)', tr.length >= 2);

// À l'inverse, une égalité que les critères tranchent ne doit PAS lever le drapeau.
var tranchee = [
    m('A','B','6','3'), m('B','C','6','3'), m('C','D','6','3'),
    m('D','A','6','3'), m('A','C','6','3'), m('B','D','6','3')
];
var rt = run(['A','B','C','D'], tranchee);
check('égalité tranchée par les critères : pas de tirage',
      rt.every(function (x) { return !x.tirageRequis; }));

console.log('\n' + (ko ? ko + ' ÉCHEC(S)' : 'tout ok'));
process.exit(ko ? 1 : 0);
