/* ============================================
   TEST — prolongation d'une grille existante
   genererGrille(..., historique) reprend après les tours déjà disputés.
   node tests/test-prolongation.js
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

function numeros(grille) {
    return grille.map(function (t) { return t.tour; });
}

/** Nombre de fois où chaque paire a joué ensemble. */
function comptePaires(grille) {
    var c = {};
    grille.forEach(function (t) {
        t.matchs.forEach(function (m) {
            [[m.a1, m.a2], [m.b1, m.b2]].forEach(function (p) {
                var k = Math.min(p[0], p[1]) + '-' + Math.max(p[0], p[1]);
                c[k] = (c[k] || 0) + 1;
            });
        });
    });
    return c;
}

function maxValeur(obj) {
    var vals = Object.keys(obj).map(function (k) { return obj[k]; });
    return vals.length ? Math.max.apply(null, vals) : 0;
}

/* ---------- 1. Numérotation ---------- */
console.log('\n1. La numérotation reprend après l\'historique');
(function () {
    var base = Engine.genererGrille(10, 2, 6, 42);
    verifier('grille initiale 1..6', numeros(base), [1, 2, 3, 4, 5, 6]);

    var suite = Engine.genererGrille(10, 2, 4, 99, base);
    verifier('prolongation 7..10', numeros(suite), [7, 8, 9, 10]);
    verifier('chaque tour ajouté a ses matchs',
        suite.map(function (t) { return t.matchs.length; }), [2, 2, 2, 2]);
})();

/* ---------- 2. Sans historique, comportement inchangé ---------- */
console.log('\n2. Non-régression : appel sans historique');
(function () {
    var a = Engine.genererGrille(12, 3, 5, 7);
    var b = Engine.genererGrille(12, 3, 5, 7);
    verifier('numérotation à partir de 1', numeros(a), [1, 2, 3, 4, 5]);
    verifier('seed identique => grille identique', a, b);

    var vide = Engine.genererGrille(12, 3, 5, 7, []);
    verifier('historique vide équivaut à pas d\'historique', vide, a);
})();

/* ---------- 3. L'historique évite de rejouer les mêmes paires ---------- */
console.log('\n3. Les paires déjà vues sont évitées');
(function () {
    var base = Engine.genererGrille(10, 2, 6, 42);
    var avec = Engine.genererGrille(10, 2, 4, 99, base);
    var sans = Engine.genererGrille(10, 2, 4, 99);

    var repetAvec = maxValeur(comptePaires(base.concat(avec)));
    var repetSans = maxValeur(comptePaires(base.concat(sans)));

    verifier('aucune paire répétée avec historique', repetAvec, 1);
    verifier('l\'historique fait mieux qu\'une régénération à l\'aveugle',
        repetAvec < repetSans, true);
})();

/* ---------- 4. Équité des repos sur l'ensemble ---------- */
console.log('\n4. La rotation des repos reste équilibrée');
(function () {
    // 10 joueurs sur 2 terrains : 8 places, 2 au repos par tour.
    var base = Engine.genererGrille(10, 2, 6, 42);
    var suite = Engine.genererGrille(10, 2, 4, 99, base);

    var repos = {};
    for (var i = 0; i < 10; i++) repos[i] = 0;
    base.concat(suite).forEach(function (t) {
        (t.repos || []).forEach(function (r) { repos[r]++; });
    });

    var vals = Object.keys(repos).map(function (k) { return repos[k]; });
    var ecart = Math.max.apply(null, vals) - Math.min.apply(null, vals);
    verifier('écart de repos ≤ 1 sur les 10 tours', ecart <= 1, true);
    verifier('total des repos cohérent (2 par tour × 10)',
        vals.reduce(function (s, v) { return s + v; }, 0), 20);
})();

/* ---------- 5. Prolongation successive ---------- */
console.log('\n5. Prolonger plusieurs fois de suite');
(function () {
    var g = Engine.genererGrille(8, 2, 3, 1);
    g = g.concat(Engine.genererGrille(8, 2, 2, 2, g));
    g = g.concat(Engine.genererGrille(8, 2, 2, 3, g));
    verifier('numérotation continue 1..7', numeros(g), [1, 2, 3, 4, 5, 6, 7]);
})();

console.log('');
if (echecs > 0) {
    console.log(echecs + ' test(s) en échec.');
    process.exit(1);
}
console.log('Tous les tests passent.');
