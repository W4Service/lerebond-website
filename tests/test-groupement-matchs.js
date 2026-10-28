// Regroupement des matchs de poule dans l'admin.
// Les matchs sont groupés par poule, pas par terrain : changer le terrain d'un
// match ne doit pas le déplacer de section.
var fs = require('fs');
var src = fs.readFileSync('../js/tournoi-admin.js', 'utf8');
var ko = 0;
function check(n, c) { console.log((c ? '  ok   ' : '  FAIL ') + n); if (!c) ko++; }

// Rejoue le bloc de regroupement de renderMatchsSection, hors DOM.
function grouper(poules, matchsPoule) {
    var i = src.indexOf('var parPoule = {};');
    var j = src.indexOf('clesOrdonnees.forEach');
    if (i < 0 || j < 0) throw new Error('bloc de regroupement introuvable');
    var parPoule, clesOrdonnees;
    eval(src.slice(i, j));
    return { parPoule: parPoule, cles: clesOrdonnees };
}

function ids(liste) {
    return liste.slice()
        .sort(function (a, b) { return a.ordre - b.ordre; })
        .map(function (m) { return m.id; });
}

// Poules volontairement dans le désordre : l'affichage suit `ordre`.
var poules = [
    { id: 'P2', nom: 'Poule B', ordre: 1, terrain: 2 },
    { id: 'P1', nom: 'Poule A', ordre: 0, terrain: 1 }
];

console.log('=== Les matchs d\'une poule restent groupés, quels que soient les terrains ===');
// Les 3 matchs de la poule A sont sur 3 terrains différents.
var matchs = [
    { id: 'm1', poule_id: 'P1', ordre: 2, terrain: 3 },
    { id: 'm2', poule_id: 'P2', ordre: 0, terrain: 1 },
    { id: 'm3', poule_id: 'P1', ordre: 0, terrain: 1 },
    { id: 'm5', poule_id: 'P1', ordre: 1, terrain: 2 }
];
var r = grouper(poules, matchs);
check('une section par poule', r.cles.length === 2);
check('les 3 matchs de la poule A sont ensemble', ids(r.parPoule['P1']).join(',') === 'm3,m5,m1');
check('le match de la poule B est seul', ids(r.parPoule['P2']).join(',') === 'm2');

console.log('\n=== Changer un terrain ne change pas le regroupement ===');
var avant = grouper(poules, matchs);
// Même jeu de matchs, tous sur le même terrain.
var memeTerrain = matchs.map(function (m) {
    return { id: m.id, poule_id: m.poule_id, ordre: m.ordre, terrain: 1 };
});
var apres = grouper(poules, memeTerrain);
check('mêmes sections', avant.cles.join(',') === apres.cles.join(','));
check('même contenu pour la poule A',
    ids(avant.parPoule['P1']).join(',') === ids(apres.parPoule['P1']).join(','));
check('même contenu pour la poule B',
    ids(avant.parPoule['P2']).join(',') === ids(apres.parPoule['P2']).join(','));

console.log('\n=== Ordre des sections : par `ordre` de poule ===');
check('Poule A (ordre 0) avant Poule B (ordre 1)', apres.cles[0] === 'P1' && apres.cles[1] === 'P2');

console.log('\n=== Matchs sans poule : une section à la fin ===');
var avecHorsPoule = matchs.concat([{ id: 'm4', poule_id: null, ordre: 0, terrain: 2 }]);
var rh = grouper(poules, avecHorsPoule);
check('3 sections', rh.cles.length === 3);
check('la section « sans » est la dernière', rh.cles[rh.cles.length - 1] === 'sans');
check('elle contient le match hors poule', ids(rh.parPoule['sans']).join(',') === 'm4');

console.log('\n=== Une poule sans match ne crée pas de section vide ===');
var seulePouleA = [{ id: 'm3', poule_id: 'P1', ordre: 0, terrain: 1 }];
var rs = grouper(poules, seulePouleA);
check('une seule section', rs.cles.length === 1);
check('c\'est la poule A', rs.cles[0] === 'P1');

console.log('\n=== Les matchs sont triés par `ordre` dans chaque section ===');
var desordre = [
    { id: 'z', poule_id: 'P1', ordre: 5, terrain: 1 },
    { id: 'a', poule_id: 'P1', ordre: 1, terrain: 1 },
    { id: 'm', poule_id: 'P1', ordre: 3, terrain: 1 }
];
var rd = grouper(poules, desordre);
check('ordre croissant', ids(rd.parPoule['P1']).join(',') === 'a,m,z');

console.log('\n=== Le regroupement par terrain a bien disparu ===');
check('plus de byTerrain dans l\'admin', src.indexOf('var byTerrain') < 0);
check('regroupement sur poule_id', src.indexOf("m.poule_id || 'sans'") > 0);

console.log('');
if (ko) { console.log(ko + ' test(s) en échec.'); process.exit(1); }
console.log('tout ok');
