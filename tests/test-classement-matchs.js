/* ============================================
   TEST — classement alternatif aux points de match
   Barème victoire 3 / nul 1 / défaite 0, repos 1.
   node tests/test-classement-matchs.js
   ============================================ */
'use strict';

var Engine = require('../js/americano-engine.js');

var echecs = 0;
function verifier(libelle, obtenu, attendu) {
    var ok = JSON.stringify(obtenu) === JSON.stringify(attendu);
    if (!ok) {
        echecs++;
        console.log('  ECHEC  ' + libelle);
        console.log('         attendu : ' + JSON.stringify(attendu));
        console.log('         obtenu  : ' + JSON.stringify(obtenu));
    } else {
        console.log('  ok     ' + libelle);
    }
}

function joueurs(noms) {
    return noms.map(function (n, i) { return { id: i + 1, nom: n, ordre: i + 1 }; });
}

function match(tour, a1, a2, b1, b2, sa, sb) {
    return {
        tour: tour, a1_id: a1, a2_id: a2, b1_id: b1, b2_id: b2,
        score_a: sa, score_b: sb, valide: true
    };
}

function totaux(res) {
    var o = {};
    res.lignes.forEach(function (l) { o[l.nom] = l.ptsMatch; });
    return o;
}

/* ---------- 1. Barème de base ---------- */
console.log('\n1. Barème victoire / nul / défaite');
(function () {
    var js = joueurs(['A', 'B', 'C', 'D']);
    var r = Engine.calculerClassementMatchs(js, [
        match(1, 1, 2, 3, 4, 21, 15),   // A,B gagnent
        match(2, 1, 3, 2, 4, 18, 18)    // nul
    ]);
    verifier('victoire 3, défaite 0, nul 1',
        totaux(r), { A: 4, B: 4, C: 1, D: 1 });

    var a = r.lignes.filter(function (l) { return l.nom === 'A'; })[0];
    verifier('compteurs V/N/D de A',
        [a.victoires, a.nuls, a.defaites], [1, 1, 0]);
})();

/* ---------- 2. Le score marqué n'a aucune influence ---------- */
console.log('\n2. Indépendance vis-à-vis des points marqués');
(function () {
    var js = joueurs(['A', 'B', 'C', 'D']);
    var serre = Engine.calculerClassementMatchs(js, [match(1, 1, 2, 3, 4, 21, 20)]);
    var large = Engine.calculerClassementMatchs(js, [match(1, 1, 2, 3, 4, 21, 0)]);
    verifier('une victoire 21-20 vaut une victoire 21-0',
        totaux(serre), totaux(large));
})();

/* ---------- 3. Le joueur au repos marque ses points ---------- */
console.log('\n3. Points de repos');
(function () {
    // 5 joueurs, 1 terrain : un joueur est sur le banc à chaque tour.
    var js = joueurs(['A', 'B', 'C', 'D', 'E']);
    var r = Engine.calculerClassementMatchs(js, [
        match(1, 1, 2, 3, 4, 21, 15)    // E au repos
    ]);
    var e = r.lignes.filter(function (l) { return l.nom === 'E'; })[0];
    verifier('le joueur au repos marque 1 pt', e.ptsMatch, 1);
    verifier('son repos est compté', e.repos, 1);
    verifier('le repos ne compte pas comme un tour joué', e.toursJoues, 0);
    verifier('il passe devant les perdants du tour',
        r.lignes.map(function (l) { return l.nom + ':' + l.ptsMatch; }),
        ['A:3', 'B:3', 'E:1', 'C:0', 'D:0']);
})();

/* ---------- 4. Tour non validé : aucun point de repos ---------- */
console.log('\n4. Un tour non comptabilisé ne distribue pas de repos');
(function () {
    var js = joueurs(['A', 'B', 'C', 'D', 'E']);
    var enAttente = [match(1, 1, 2, 3, 4, 21, 15)];
    enAttente[0].valide = false;
    var r = Engine.calculerClassementMatchs(js, enAttente);
    verifier('aucun point distribué',
        totaux(r), { A: 0, B: 0, C: 0, D: 0, E: 0 });
})();

/* ---------- 5. Ex aequo ---------- */
console.log('\n5. Rangs ex aequo');
(function () {
    var js = joueurs(['A', 'B', 'C', 'D']);
    var r = Engine.calculerClassementMatchs(js, [match(1, 1, 2, 3, 4, 21, 15)]);
    var rangs = r.lignes.map(function (l) { return l.nom + ':' + l.rang; });
    verifier('même total => même rang, puis saut', rangs, ['A:1', 'B:1', 'C:3', 'D:3']);
})();

/* ---------- 6. Le classement aux points de jeu reste intact ---------- */
console.log('\n6. Non-régression du classement existant');
(function () {
    var js = joueurs(['A', 'B', 'C', 'D']);
    var ms = [match(1, 1, 2, 3, 4, 21, 15), match(2, 1, 3, 2, 4, 10, 21)];
    var r = Engine.calculerClassement(js, ms);
    // B 21+21=42, D 15+21=36, A 21+10=31, C 15+10=25
    verifier('tri inchangé sur les points de jeu',
        r.lignes.map(function (l) { return l.nom + ':' + l.points; }),
        ['B:42', 'D:36', 'A:31', 'C:25']);
})();

console.log('');
if (echecs > 0) {
    console.log(echecs + ' test(s) en échec.');
    process.exit(1);
}
console.log('Tous les tests passent.');
