// Page imprimable : section « matchs à lancer ».
// Vérifie le filtre (ce qui est prêt à jouer) et l'ordre d'affichage.
var fs = require('fs');
var src = fs.readFileSync('../js/tournoi-print.js', 'utf8');
var ko = 0;
function check(n, c) { console.log((c ? '  ok   ' : '  FAIL ') + n); if (!c) ko++; }

// Rejoue le bloc de filtrage de render(), hors DOM.
function trier(matchs) {
    var i = src.indexOf('var aLancer = matchs.filter');
    var j = src.indexOf('if (enCours.length > 0 || aLancer.length > 0)');
    if (i < 0 || j < 0) throw new Error('bloc « à lancer » introuvable');
    var aLancer, enCours;
    eval(src.slice(i, j));
    return { aLancer: aLancer, enCours: enCours };
}

function m(o) {
    return {
        id: o.id, phase: o.phase || 'poule', status: o.status || 'en_attente',
        equipe_a_id: 'equipe_a_id' in o ? o.equipe_a_id : 'A',
        equipe_b_id: 'equipe_b_id' in o ? o.equipe_b_id : 'B',
        terrain: o.terrain, ordre: o.ordre || 0,
        poule_id: o.poule_id, bracket: o.bracket
    };
}

console.log('=== Ne retient que les matchs réellement jouables ===');
var r = trier([
    m({ id: 'pret', terrain: 1 }),
    m({ id: 'joue', status: 'termine', terrain: 1 }),
    m({ id: 'encours', status: 'en_cours', terrain: 1 }),
    m({ id: 'sans-equipes', phase: 'finale', equipe_a_id: null, equipe_b_id: null, terrain: 1 }),
    m({ id: 'moitie', phase: 'finale', equipe_b_id: null, terrain: 1 })
]);
var ids = r.aLancer.map(function (x) { return x.id; });
check('le match prêt est retenu', ids.indexOf('pret') >= 0);
check('un match terminé est exclu', ids.indexOf('joue') < 0);
check('un match en cours n\'est pas « à lancer »', ids.indexOf('encours') < 0);
check('un match sans équipes connues est exclu', ids.indexOf('sans-equipes') < 0);
check('un match à moitié résolu est exclu', ids.indexOf('moitie') < 0);
check('un seul match à lancer', r.aLancer.length === 1);

console.log('\n=== Les matchs en cours sont listés à part ===');
check('1 match en cours', r.enCours.length === 1);
check('c\'est le bon', r.enCours[0].id === 'encours');

console.log('\n=== Ordre : les poules avant la phase finale ===');
var r2 = trier([
    m({ id: 'finale', phase: 'finale', terrain: 1, ordre: 0, bracket: 'principal' }),
    m({ id: 'poule', phase: 'poule', terrain: 5, ordre: 9, poule_id: 'PA' })
]);
check('la poule passe devant, même sur un terrain plus élevé',
    r2.aLancer[0].id === 'poule');

console.log('\n=== À phase égale : tri par terrain, puis par ordre ===');
var r3 = trier([
    m({ id: 't2-o0', terrain: 2, ordre: 0 }),
    m({ id: 't1-o5', terrain: 1, ordre: 5 }),
    m({ id: 't1-o1', terrain: 1, ordre: 1 })
]);
check('terrain croissant puis ordre croissant',
    r3.aLancer.map(function (x) { return x.id; }).join(',') === 't1-o1,t1-o5,t2-o0');

console.log('\n=== Un match sans terrain passe en dernier ===');
var r4 = trier([
    m({ id: 'sans-terrain', terrain: null, ordre: 0 }),
    m({ id: 'avec-terrain', terrain: 3, ordre: 9 })
]);
check('le match sans terrain est après', r4.aLancer[1].id === 'sans-terrain');

console.log('\n=== Aucun match jouable : pas de plantage ===');
var r5 = trier([m({ id: 'joue', status: 'termine', terrain: 1 })]);
check('liste vide', r5.aLancer.length === 0 && r5.enCours.length === 0);

console.log('\n=== Les brackets du format 12 équipes sont étiquetés ===');
check('places_3_4 (petite finale)', src.indexOf("b === 'places_3_4'") > 0);
check('consolation_5_8', src.indexOf("b === 'consolation_5_8'") > 0);
check('places_9_10', src.indexOf("b === 'places_9_10'") > 0);
check('places_11_12', src.indexOf("b === 'places_11_12'") > 0);
check('plus de bracket bas_9_12', src.indexOf('bas_9_12') < 0);

console.log('\n=== La colonne « Phase » et la case vierge sont prévues ===');
check('buildMatchTable accepte avecOrigine',
    src.indexOf('function buildMatchTable(ms, equipes, poules, avecOrigine)') > 0);
check('colonne Phase ajoutée', src.indexOf("'#', 'Phase', 'Équipe A'") > 0);
check('case de score laissée vide', src.indexOf("scoreText = '';") > 0);

console.log('');
if (ko) { console.log(ko + ' test(s) en échec.'); process.exit(1); }
console.log('tout ok');
