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

console.log('\n=== MÉTHODE SERPENTIN (exemple chiffré du règlement) ===');
console.log('  « 4 poules de 4 paires, classées de 1 à 16 :');
console.log('      A    B    C    D');
console.log('      1    2    3    4');
console.log('      8    7    6    5');
console.log('      9   10   11   12');
console.log('     16   15   14   13 »');
var serp = T.preparerTirage({ equipes: eq(16), nbPoules: 4, nbTS: 0, nbHorsPoule: 0,
                              taillePoules: [4, 4, 4, 4], seed: 1, methode: 'serpentin' });
var grille = [[], [], [], []];
Object.keys(serp.placements).forEach(function (id) {
    grille[serp.placements[id]].push(parseInt(id.slice(1), 10));
});
grille.forEach(function (g, i) {
    console.log('  Poule ' + String.fromCharCode(65 + i) + ' : ' + g.join(', '));
});
check('poule A = 1, 8, 9, 16', grille[0].join() === '1,8,9,16');
check('poule B = 2, 7, 10, 15', grille[1].join() === '2,7,10,15');
check('poule C = 3, 6, 11, 14', grille[2].join() === '3,6,11,14');
check('poule D = 4, 5, 12, 13', grille[3].join() === '4,5,12,13');
check('serpentin : placement imposé, pas tiré au sort',
      serp.etapes.every(function (e) { return e.tire === false; }));

console.log('\n=== MÉTHODE RÉPARTITION PAR RANG ===');
console.log('  « les paires 1 à 4 au rang 1 par tirage au sort, 5 à 8 au rang 2... »');
var rang = T.preparerTirage({ equipes: eq(16), nbPoules: 4, nbTS: 0, nbHorsPoule: 0,
                              taillePoules: [4, 4, 4, 4], seed: 12345, methode: 'rang' });
var parChapeau = {};
rang.etapes.forEach(function (e) {
    (parChapeau[e.chapeau] = parChapeau[e.chapeau] || []).push(parseInt(e.equipe_id.slice(1), 10));
});
Object.keys(parChapeau).sort(function (a, b) { return a - b; }).forEach(function (c) {
    console.log('  chapeau ' + c + ' : paires ' + parChapeau[c].sort(function (a, b) { return a - b; }).join(', '));
});
check('chapeau 1 = paires 1 à 4', (parChapeau[1] || []).join() === '1,2,3,4');
check('chapeau 2 = paires 5 à 8', (parChapeau[2] || []).join() === '5,6,7,8');
check('chapeau 3 = paires 9 à 12', (parChapeau[3] || []).join() === '9,10,11,12');
check('chapeau 4 = paires 13 à 16', (parChapeau[4] || []).join() === '13,14,15,16');
check('rang : les paires SONT tirées au sort',
      rang.etapes.every(function (e) { return e.tire === true; }));
// Chaque poule reçoit exactement une paire de chaque chapeau.
var okRepartition = true;
[0, 1, 2, 3].forEach(function (p) {
    var chapeauxDeLaPoule = rang.etapes.filter(function (e) { return e.poule === p; })
        .map(function (e) { return e.chapeau; }).sort();
    if (chapeauxDeLaPoule.join() !== '1,2,3,4') okRepartition = false;
});
check('chaque poule reçoit 1 paire de chaque chapeau', okRepartition);

console.log('\n=== Les 2 méthodes donnent des résultats différents ===');
check('serpentin ≠ répartition par rang',
      JSON.stringify(serp.placements) !== JSON.stringify(rang.placements));

console.log('\n' + (ko ? ko + ' ÉCHEC(S)' : 'tout ok'));
process.exit(ko ? 1 : 0);
