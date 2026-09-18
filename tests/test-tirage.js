// Tirage au sort — conformité au Guide de la compétition padel FFT, chapitre I.
//   « Lors de la constitution des poules, 2 TS par poule sont obligatoires. »
//   « le tirage au sort doit être réalisé devant témoins »  -> d'où la graine
//     conservée, qui permet de rejouer et vérifier un tirage contesté.
var T = require('../js/tournoi-tirage.js');
var ko = 0;
function check(n, c) { console.log((c ? '  ok   ' : '  FAIL ') + n); if (!c) ko++; }
function eq(n) {
    var out = [];
    for (var i = 1; i <= n; i++) out.push({ id: 'p' + i, nom: 'Paire ' + i });
    return out;
}

console.log('=== Déterminisme : une graine rejoue le même tirage ===');
var opts = { equipes: eq(12), nbPoules: 3, nbTS: 6, nbHorsPoule: 0,
             taillePoules: [4, 4, 4], seed: 424242 };
var t1 = T.preparerTirage(opts);
var t2 = T.preparerTirage(opts);
check('deux tirages de même graine sont identiques',
      JSON.stringify(t1.placements) === JSON.stringify(t2.placements));
var t3 = T.preparerTirage(Object.assign({}, opts, { seed: 999 }));
check('une graine différente donne un autre tirage',
      JSON.stringify(t1.placements) !== JSON.stringify(t3.placements));
check('un tirage se vérifie a posteriori', T.verifierTirage(opts, t1.placements));
check('un placement falsifié est détecté', (function () {
    var faux = Object.assign({}, t1.placements);
    faux[Object.keys(faux)[0]] = (faux[Object.keys(faux)[0]] + 1) % 3;
    return !T.verifierTirage(opts, faux);
})());

console.log('\n=== 2 TS par poule (règle FFT) ===');
// 3 poules -> 6 TS, placées d'office, 2 par poule.
var parPoule = {};
t1.etapes.filter(function (e) { return e.type === 'tete_de_serie'; })
    .forEach(function (e) { parPoule[e.poule] = (parPoule[e.poule] || 0) + 1; });
console.log('  TS par poule : ' + JSON.stringify(parPoule));
check('2 têtes de série dans chaque poule',
      [0, 1, 2].every(function (p) { return parPoule[p] === 2; }));
check('les TS ne sont PAS tirées au sort',
      t1.etapes.filter(function (e) { return e.type === 'tete_de_serie'; })
        .every(function (e) { return e.tire === false; }));
check('les autres paires sont tirées au sort',
      t1.etapes.filter(function (e) { return e.type === 'tirage'; })
        .every(function (e) { return e.tire === true; }));

console.log('\n=== Répartition des TS : TS1 et TS2 dans des poules différentes ===');
var ts = t1.etapes.filter(function (e) { return e.type === 'tete_de_serie'; });
console.log('  ' + ts.map(function (e) {
    return 'TS' + e.rang_ts + '->' + String.fromCharCode(65 + e.poule); }).join('  '));
check('TS1 et TS2 séparées', ts[0].poule !== ts[1].poule);
check('TS1, TS2, TS3 dans 3 poules distinctes',
      new Set([ts[0].poule, ts[1].poule, ts[2].poule]).size === 3);

console.log('\n=== Poules complètes et sans débordement ===');
var tailles = {};
Object.keys(t1.placements).forEach(function (id) {
    var p = t1.placements[id];
    if (p !== null) tailles[p] = (tailles[p] || 0) + 1;
});
console.log('  tailles obtenues : ' + JSON.stringify(tailles));
check('3 poules de 4', [0, 1, 2].every(function (p) { return tailles[p] === 4; }));
check('les 12 paires sont placées', Object.keys(t1.placements).length === 12);

console.log('\n=== Format à TS exemptées de poule (4 TS + 2 poules de 3) ===');
var ex = T.preparerTirage({ equipes: eq(10), nbPoules: 2, nbTS: 4, nbHorsPoule: 4,
                            taillePoules: [3, 3], seed: 7 });
var exempt = ex.etapes.filter(function (e) { return e.type === 'exempte'; });
check('4 paires exemptées de poule', exempt.length === 4);
check('ce sont les 4 mieux classées',
      exempt.map(function (e) { return e.equipe_id; }).join() === 'p1,p2,p3,p4');
check('les exemptées ne sont pas tirées au sort',
      exempt.every(function (e) { return e.tire === false && e.poule === null; }));
var enPoule = Object.keys(ex.placements).filter(function (k) { return ex.placements[k] !== null; });
check('les 6 autres sont en poule', enPoule.length === 6);

console.log('\n=== Les étapes sont jouables dans l\'ordre ===');
check('chaque étape porte un motif lisible',
      t1.etapes.every(function (e) { return typeof e.motif === 'string' && e.motif.length > 0; }));
check('chaque étape nomme la paire',
      t1.etapes.every(function (e) { return !!e.nom && !!e.equipe_id; }));
check('toutes les paires apparaissent une fois', t1.etapes.length === 12);

console.log('\n' + (ko ? ko + ' ÉCHEC(S)' : 'tout ok'));
process.exit(ko ? 1 : 0);
