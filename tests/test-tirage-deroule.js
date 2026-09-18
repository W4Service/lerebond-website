// Déroulé complet d'un tirage : ce que voit l'écran TV, étape par étape.
var T = require('../js/tournoi-tirage.js');
var ko = 0;
function check(n, c) { console.log((c ? '  ok   ' : '  FAIL ') + n); if (!c) ko++; }

function eq(n) {
    var out = [];
    for (var i = 1; i <= n; i++) out.push({ id: 'p' + i, nom: 'Paire ' + i });
    return out;
}
// Reproduit instantanePoules() de l'admin.
function instantane(nbPoules, placements, dernier) {
    var out = [];
    for (var i = 0; i < nbPoules; i++) {
        var dedans = Object.keys(placements)
            .filter(function (id) { return placements[id] === i; })
            .map(function (id) { return { nom: id, nouveau: id === dernier }; });
        out.push({ nom: 'Poule ' + String.fromCharCode(65 + i), equipes: dedans });
    }
    return out;
}

console.log('=== Déroulé : 12 paires, 3 poules de 4, 2 TS par poule ===');
var plan = T.preparerTirage({
    equipes: eq(12), nbPoules: 3, nbTS: 6, nbHorsPoule: 0,
    taillePoules: [4, 4, 4], seed: 2026, methode: 'rang'
});
var placements = {};
plan.etapes.forEach(function (et, i) {
    placements[et.equipe_id] = et.poule;
    var tag = et.tire ? '🎲 tirée ' : '📌 placée ';
    console.log('  ' + String(i + 1).padStart(2) + '. ' + tag + et.nom
        + ' -> poule ' + String.fromCharCode(65 + et.poule)
        + '   (' + et.motif + ')');
});
check('12 étapes', plan.etapes.length === 12);
check('les 6 premières sont les TS',
      plan.etapes.slice(0, 6).every(function (e) { return e.type === 'tete_de_serie'; }));
// En répartition par rang, les TS sont tirées au sort elles aussi : « les paires
// 1 à 4 seront positionnées par tirage au sort au rang 1 ».
check('répartition par rang : tout est tiré au sort',
      plan.etapes.every(function (e) { return e.tire === true; }));
check('2 TS par poule malgré le tirage', (function () {
    var c = {};
    plan.etapes.slice(0, 6).forEach(function (e) { c[e.poule] = (c[e.poule] || 0) + 1; });
    return [0, 1, 2].every(function (p) { return c[p] === 2; });
})());

console.log('\n=== Les poules se remplissent progressivement ===');
var partiel = {};
var tailles = [];
plan.etapes.forEach(function (et) {
    partiel[et.equipe_id] = et.poule;
    var snap = instantane(3, partiel, et.equipe_id);
    tailles.push(snap.map(function (p) { return p.equipes.length; }).join('-'));
});
console.log('  progression : ' + tailles.join('  ') );
check('la dernière image montre 3 poules de 4', tailles[tailles.length - 1] === '4-4-4');
var snapFinal = instantane(3, partiel, plan.etapes[plan.etapes.length - 1].equipe_id);
check('la dernière paire est signalée comme nouvelle',
      snapFinal.some(function (p) { return p.equipes.some(function (e) { return e.nouveau; }); }));

console.log('\n=== Aucune poule ne déborde en cours de tirage ===');
var jamaisDepasse = true;
var courant = {};
plan.etapes.forEach(function (et) {
    courant[et.equipe_id] = et.poule;
    var c = instantane(3, courant, null).map(function (p) { return p.equipes.length; });
    if (Math.max.apply(null, c) > 4) jamaisDepasse = false;
});
check('jamais plus de 4 paires dans une poule', jamaisDepasse);

console.log('\n=== Format à TS exemptées : déroulé 4 TS + 2 poules de 3 ===');
var p2 = T.preparerTirage({
    equipes: eq(10), nbPoules: 2, nbTS: 4, nbHorsPoule: 4,
    taillePoules: [3, 3], seed: 55, methode: 'rang'
});
p2.etapes.forEach(function (et, i) {
    console.log('  ' + String(i + 1).padStart(2) + '. '
        + (et.poule == null ? '⭐ exemptée  ' : (et.tire ? '🎲 tirée    ' : '📌 placée    '))
        + et.nom + (et.poule == null ? '' : ' -> poule ' + String.fromCharCode(65 + et.poule)));
});
check('les 4 premières sont exemptées',
      p2.etapes.slice(0, 4).every(function (e) { return e.type === 'exempte' && e.poule === null; }));
check('les 6 autres sont en poule',
      p2.etapes.slice(4).every(function (e) { return e.poule !== null; }));
check('10 étapes au total', p2.etapes.length === 10);

console.log('\n=== Traçabilité : le tirage est rejouable ===');
var opts = { equipes: eq(12), nbPoules: 3, nbTS: 6, nbHorsPoule: 0,
             taillePoules: [4, 4, 4], seed: 2026, methode: 'rang' };
check('rejoué avec la même graine : identique', T.verifierTirage(opts, plan.placements));
check('l\'ordre de sortie est conservable',
      plan.etapes.every(function (e) { return e.equipe_id && e.nom && e.type; }));

console.log('\n' + (ko ? ko + ' ÉCHEC(S)' : 'tout ok'));
process.exit(ko ? 1 : 0);
