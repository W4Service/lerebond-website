// Tableau de 16 à entrées échelonnées, avec classement complet de 1 à 16.
//
// Guide de la compétition padel, I.2 — Les formules sportives :
//   « Il existe une multitude de formules possibles [...] tableau à entrées
//     échelonnées [...] Aussi, toutes les paires seront classées en fonction de
//     leur rang obtenu à l'issue du Tournoi.
//     Quelle que soit la formule sportive choisie, 3 matchs minimum doivent
//     être programmés pour chaque paire. »
//
// Cahier des charges :
//   « Pour tous les types de tournois, les matchs de classement sont
//     obligatoires : chaque paire doit avoir, au minimum, 3 matchs programmés. »
var fs = require('fs');
var T16 = require('../js/tournoi-tableau16.js');
var ko = 0;
function check(n, c) { console.log((c ? '  ok   ' : '  FAIL ') + n); if (!c) ko++; }

var src = fs.readFileSync('../js/tournoi-admin.js', 'utf8');
var srcPrint = fs.readFileSync('../js/tournoi-print.js', 'utf8');
var sql = fs.readFileSync('../supabase/migrations/20261026_tableau_source_match.sql', 'utf8');

console.log('=== 28 matchs, et chaque équipe entre une seule fois ===');
check('28 matchs définis', T16.MATCHS.length === 28);
var entrees = {};
var doubleEntree = false;
T16.MATCHS.forEach(function (m) {
    [m.a, m.b].forEach(function (s) {
        if (s[0] !== 'T') return;
        if (entrees[s[1]]) doubleEntree = true;
        entrees[s[1]] = m.id;
    });
});
check('les 16 positions entrent dans le tableau', Object.keys(entrees).length === 16);
check('aucune position n\'entre deux fois', !doubleEntree);
// Entrées échelonnées : 8 en 16es, 4 en 8es, 4 en quarts.
var tour = function (p) { return entrees[p].charAt(0); };
var en16 = [1,2,3,4,5,6,7,8].every(function (p) { return tour(p) === 'H'; });
var en8  = [9,10,11,12].every(function (p) { return tour(p) === 'O'; });
var enQ  = [13,14,15,16].every(function (p) { return tour(p) === 'Q'; });
check('positions 1-8 entrent en 16es', en16);
check('positions 9-12 entrent en 8es', en8);
check('positions 13-16 entrent en quarts', enQ);

console.log('\n=== Les places 1 à 16 sont toutes attribuées ===');
var placesDeclarees = T16.MATCHS.filter(function (m) { return m.place; })
    .map(function (m) { return [m.place, m.place + 1]; })
    .reduce(function (a, b) { return a.concat(b); }, [])
    .sort(function (a, b) { return a - b; });
var attendu = []; for (var i = 1; i <= 16; i++) attendu.push(i);
check('8 matchs de classement, 16 places', placesDeclarees.length === 16);
check('places 1 à 16 sans trou ni doublon', placesDeclarees.join(',') === attendu.join(','));

console.log('\n=== Tournoi complet simulé : 3 matchs minimum par équipe ===');
console.log('  « 3 matchs minimum doivent être programmés pour chaque paire »');
// On joue les 28 matchs : la paire la mieux placée (plus petit numéro) gagne.
var ordre = [];
for (var k = 1; k <= 16; k++) ordre.push('E' + k);
var plan = T16.construire(ordre, { nbTerrains: 3, reposCreneaux: 1 });
var parRef = {};
plan.forEach(function (m) { parRef[m.ref] = m; });
var resultat = {};
function force(id) { return parseInt(id.slice(1), 10); }
function resoudre(ref, type) {
    if (!resultat[ref]) jouer(ref);
    return type === 'gagnant' ? resultat[ref].w : resultat[ref].l;
}
function jouer(ref) {
    if (resultat[ref]) return;
    var m = parRef[ref];
    var A = m.equipe_a_id || resoudre(m.srcA.ref, m.srcA.type);
    var B = m.equipe_b_id || resoudre(m.srcB.ref, m.srcB.type);
    var w = force(A) < force(B) ? A : B;
    resultat[ref] = { a: A, b: B, w: w, l: w === A ? B : A };
}
Object.keys(parRef).forEach(jouer);

var cpt = {};
Object.keys(resultat).forEach(function (ref) {
    [resultat[ref].a, resultat[ref].b].forEach(function (t) { cpt[t] = (cpt[t] || 0) + 1; });
});
var nb = Object.keys(cpt).map(function (t) { return cpt[t]; });
check('les 16 équipes jouent', Object.keys(cpt).length === 16);
check('chacune joue au moins 3 matchs', Math.min.apply(null, nb) >= 3);
check('aucune n\'en joue plus de 5', Math.max.apply(null, nb) <= 5);

var classement = {};
plan.forEach(function (m) {
    if (!m.place) return;
    classement[m.place] = resultat[m.ref].w;
    classement[m.place + 1] = resultat[m.ref].l;
});
check('16 places attribuées à l\'arrivée', Object.keys(classement).length === 16);
var toutesDistinctes = {};
Object.keys(classement).forEach(function (p) { toutesDistinctes[classement[p]] = true; });
check('une équipe par place, pas d\'ex æquo', Object.keys(toutesDistinctes).length === 16);

console.log('\n=== Programmation : 3 terrains, repos entre deux matchs ===');
var prog = T16.programmer({ nbTerrains: 3, reposCreneaux: 1 });
var creneaux = Object.keys(prog).map(function (id) { return prog[id].creneau; });
check('les 28 matchs sont programmés', Object.keys(prog).length === 28);
check('11 créneaux utilisés', Math.max.apply(null, creneaux) + 1 === 11);
// Jamais plus de 3 matchs par créneau.
var parCreneau = {};
Object.keys(prog).forEach(function (id) {
    parCreneau[prog[id].creneau] = (parCreneau[prog[id].creneau] || 0) + 1;
});
check('jamais plus de 3 matchs en parallèle',
      Object.keys(parCreneau).every(function (c) { return parCreneau[c] <= 3; }));
check('la finale est seule sur son créneau', parCreneau[prog.F.creneau] === 1);
// Un match ne peut pas précéder celui dont il dépend, et l'équipe qui enchaîne
// a un créneau de pause.
var reposKo = 0;
T16.MATCHS.forEach(function (m) {
    T16.dependances(m).forEach(function (d) {
        if (prog[m.id].creneau - prog[d].creneau < 2) reposKo++;
    });
});
check('2 créneaux au moins entre un match et sa dépendance', reposKo === 0);
// Aucune équipe ne joue deux matchs au même créneau, ni deux d'affilée.
var creneauxParEquipe = {};
Object.keys(resultat).forEach(function (ref) {
    [resultat[ref].a, resultat[ref].b].forEach(function (t) {
        (creneauxParEquipe[t] = creneauxParEquipe[t] || []).push(prog[ref].creneau);
    });
});
var conflit = 0, troisSerre = 0;
Object.keys(creneauxParEquipe).forEach(function (t) {
    var cs = creneauxParEquipe[t].slice().sort(function (a, b) { return a - b; });
    for (var i = 1; i < cs.length; i++) {
        if (cs[i] === cs[i - 1]) conflit++;
        if (cs[i] - cs[i - 1] < 2) troisSerre++;
    }
});
check('aucune équipe sur deux terrains au même créneau', conflit === 0);
check('aucune équipe ne joue deux créneaux de suite', troisSerre === 0);

console.log('\n=== Convocations : premier match moins 15 minutes ===');
var conv = T16.convocations({ nbTerrains: 3, reposCreneaux: 1, dureeMatch: 45, minutesAvance: 15 });
check('16 convocations', conv.length === 16);
// Position 11 entre en 8e-3, programmé au créneau 3 (19h15 si début 17h00).
var c11 = conv.find(function (x) { return x.position === 11; });
var c15 = conv.find(function (x) { return x.position === 15; });
check('position 11 convoquée pour son vrai créneau d\'entrée',
      c11.creneau === prog[entrees[11]].creneau);
check('position 15 convoquée pour son vrai créneau d\'entrée',
      c15.creneau === prog[entrees[15]].creneau);
check('la convocation précède le match de 15 min',
      c11.minutesAvantDebut === c11.creneau * 45 - 15);

console.log('\n=== Garde-fous à la construction ===');
function doitEchouer(nom, fn) {
    var leve = false;
    try { fn(); } catch (e) { leve = true; }
    check(nom, leve);
}
doitEchouer('refuse moins de 16 équipes', function () { T16.construire(['A', 'B']); });
doitEchouer('refuse une équipe en double', function () {
    var o = ordre.slice(); o[5] = o[0]; T16.construire(o);
});
doitEchouer('refuse une position vide', function () {
    var o = ordre.slice(); o[7] = ''; T16.construire(o);
});

console.log('\n=== Dépendances entre matchs de phase finale ===');
// Le résolveur existant ne regardait que les matchs d'une même poule : un
// tableau a besoin de référencer un autre match de phase finale par son id.
check('la migration ajoute la référence par id de match',
      /equipe_a_source_match_id uuid/.test(sql) && /equipe_b_source_match_id uuid/.test(sql));
check('la place du vainqueur est portée par le match', /place_vainqueur integer/.test(sql));
check('le créneau est stocké', /creneau integer/.test(sql));
check('un résolveur de phase finale existe', /async function propagateFinale/.test(src));
check('il ne se limite pas aux poules',
      /propagateFinale[\s\S]*?m\.phase !== 'finale'/.test(src));
check('il résout en cascade', /for \(var tour = 0; tour < 10; tour\+\+\)/.test(src));
check('il est appelé quand un match de phase finale se termine',
      /data\.phase === 'finale' && data\.vainqueur_id\) \{\s*\n\s*await propagateFinale\(\)/.test(src));

console.log('\n=== Création du tableau en base ===');
check('le générateur existe', /async function genererTableau16/.test(src));
check('il écrit les 28 lignes puis pose les liens',
      /Passe 1/.test(src) && /Passe 2/.test(src));
check('il refuse un effectif différent de 16',
      /equipes\.length !== 16/.test(src));
check('un lien non posé est signalé bruyamment',
      /ne se '[\s\S]{0,80}remplira pas automatiquement/.test(src));
check('le format est au catalogue', /id: 'tableau_16'/.test(src));
check('il demande la saisie de l\'ordre', /saisieOrdre: true/.test(src));
check('la saisie refuse les doublons', /ordre16-select--double/.test(src));
check('le format s\'applique à 16 équipes sans poules',
      /function isConfigTableau16\(\) \{\s*\n\s*return poules\.length === 0 && equipes\.length === 16;/.test(src));

console.log('\n=== Classement final lu depuis la base ===');
check('les places sont lues depuis place_vainqueur',
      /m\.place_vainqueur != null/.test(srcPrint));
check('le perdant prend la place suivante',
      /place: m\.place_vainqueur \+ 1/.test(srcPrint));
check('les places déjà calculées ne sont pas réécrites', /dejaVues/.test(srcPrint));

console.log('\n=== Le module est atteint par le bon objet global ===');
// tournoi-admin.js est une IIFE SANS parametre `root` : `root` y est une
// variable locale de render() qui designe un element DOM. Ecrire
// root.TournoiTableau16 levait une ReferenceError et le tableau n'etait
// jamais cree — sans message lisible.
check('le module est lu depuis window, pas depuis root',
      /window\.TournoiTableau16/.test(src) && !/root\.TournoiTableau16/.test(src));
check('aucun autre root.Tournoi* dans tournoi-admin.js',
      !/root\.Tournoi[A-Za-z]/.test(src));
// Garde-fou general : dans ce fichier, `root` ne doit servir qu'au DOM.
var usagesRoot = (src.match(/\broot\.[A-Za-z]+/g) || []);
var nonDom = usagesRoot.filter(function (u) {
    return !/^root\.(innerHTML|appendChild|querySelector|querySelectorAll|classList|style|textContent|removeChild|insertBefore|children|firstChild)/.test(u);
});
check('root ne sert qu\'a manipuler le DOM', nonDom.length === 0);

console.log(ko === 0 ? '\nTous les tests passent.' : '\n' + ko + ' test(s) en échec.');
process.exit(ko === 0 ? 0 : 1);
