// Vue tableau « multi-chances » (demande du 24/11/2026) : plan des blocs,
// colonnes et numéros M1, M2…, sur le P50 du 24/11 (4 TS + 2 poules de 4)
// au moment où il ne restait qu'un quart en cours. Noms anonymisés.
var V = require('../js/tournoi-bracket-vue.js');
var ko = 0;
function check(n, c) { console.log((c ? '  ok   ' : '  FAIL ') + n); if (!c) ko++; }

var T0 = '2026-11-24T15:54:35+00:00';
function m(id, bracket, ordre, a, b, statut, v, cree) {
    return { id: id, phase: 'finale', bracket: bracket, ordre: ordre, equipe_a_id: a, equipe_b_id: b,
        status: statut, vainqueur_id: v || null, created_at: cree || T0 };
}
var ordreBloc = function (b) {
    if (b === 'principal') return 0;
    if (b === 'consolation_5_8') return 5;
    if (b.indexOf('places_') === 0) return parseInt(b.split('_')[1], 10);
    return 99;
};

// Quarts : q0 en cours, les 3 autres joués. 9-10 et 11-12 en cours.
var reels = [
    m('q0', 'principal', 0, 'TS2', 'E2A', 'en_cours'),
    m('q1', 'principal', 1, 'TS4', 'E2B', 'termine', 'E2B'),
    m('q2', 'principal', 2, 'TS3', 'E1A', 'termine', 'E1A'),
    m('q3', 'principal', 3, 'TS1', 'E1B', 'termine', 'TS1'),
    m('p9', 'places_9_10', 0, 'E3A', 'E3B', 'en_cours'),
    m('p11', 'places_11_12', 0, 'E4A', 'E4B', 'en_cours')
];
// Ce que calculerTourSuivant annonce (format 4ts2p4) : demies Q1/Q2 et Q3/Q4,
// consolation des perdants, puis finale, petite finale, places 5-6 et 7-8.
var projetes = [
    { id: 'projete:0', bracket: 'principal', ordre: 4, equipe_a_id: 'gagnant:q0', equipe_b_id: 'E2B' },
    { id: 'projete:1', bracket: 'principal', ordre: 5, equipe_a_id: 'E1A', equipe_b_id: 'TS1' },
    { id: 'projete:2', bracket: 'consolation_5_8', ordre: 0, equipe_a_id: 'perdant:q0', equipe_b_id: 'TS4' },
    { id: 'projete:3', bracket: 'consolation_5_8', ordre: 1, equipe_a_id: 'TS3', equipe_b_id: 'E1B' },
    { id: 'projete:4', bracket: 'principal', ordre: 6, equipe_a_id: 'gagnant:projete:0', equipe_b_id: 'gagnant:projete:1' },
    { id: 'projete:5', bracket: 'principal', ordre: 7, equipe_a_id: 'perdant:projete:0', equipe_b_id: 'perdant:projete:1' },
    { id: 'projete:6', bracket: 'places_5_6', ordre: 0, equipe_a_id: 'gagnant:projete:2', equipe_b_id: 'gagnant:projete:3' },
    { id: 'projete:7', bracket: 'places_7_8', ordre: 0, equipe_a_id: 'perdant:projete:2', equipe_b_id: 'perdant:projete:3' }
];

console.log('=== Blocs ===');
var plan = V.planMultiChances(reels, projetes, ordreBloc);
var blocs = plan.blocs.map(function (b) { return b.bracket; });
check('4 blocs : principal, 5-8, 9-10, 11-12', blocs.join(',') === 'principal,consolation_5_8,places_9_10,places_11_12');
var p = plan.blocs[0];
check('principal en 3 colonnes (4 / 2 / 2)', p.colonnes.map(function (c) { return c.length; }).join('/') === '4/2/2');
var c58 = plan.blocs[1];
check('places 5-6 et 7-8 rangées avec la consolation', c58.colonnes.length === 2 && c58.colonnes[1].length === 2);

console.log('\n=== Numéros ===');
var num = function (id) { return plan.numero[id]; };
check('quarts M1 à M4 dans l\'ordre', [num('q0'), num('q1'), num('q2'), num('q3')].join(',') === '1,2,3,4');
check('demies M5 et M6', num('projete:0') === 5 && num('projete:1') === 6);
check('consolation M9 et M10', num('projete:2') === 9 && num('projete:3') === 10);
check('9-10 M13, 11-12 M14', num('p9') === 13 && num('p11') === 14);

console.log('\n=== États ===');
var parId = plan.parId;
check('quart en cours', V.etat(parId.q0) === 'en_cours');
check('demie aux 2 équipes connues = « connu »', V.etat(parId['projete:1']) === 'pret');
check('demie qui attend un vainqueur = en attente', V.etat(parId['projete:0']) === 'attente');
check('demie M6 alimentée par M3 et M4', plan.origines['projete:1'].map(function (o) { return o.match.id; }).sort().join(',') === 'q2,q3');

console.log('\n=== Après la vraie création des demies ===');
// Les demies existent en base (créées plus tard) : le tour se déduit des matchs
// joués par chaque équipe, sans jeton.
var T1 = '2026-11-24T21:00:00+00:00';
var reels2 = reels.map(function (x) { return Object.assign({}, x); });
reels2[0].status = 'termine'; reels2[0].vainqueur_id = 'E2A';
reels2.push(m('d0', 'principal', 4, 'E2A', 'E2B', 'en_attente', null, T1));
reels2.push(m('d1', 'principal', 5, 'E1A', 'TS1', 'en_attente', null, T1));
reels2.push(m('c0', 'consolation_5_8', 0, 'TS2', 'TS4', 'en_attente', null, T1));
reels2.push(m('c1', 'consolation_5_8', 1, 'TS3', 'E1B', 'en_attente', null, T1));
var plan2 = V.planMultiChances(reels2, [
    { id: 'projete:0', bracket: 'principal', ordre: 6, equipe_a_id: 'gagnant:d0', equipe_b_id: 'gagnant:d1' }
], ordreBloc);
check('demies en 2e colonne', plan2.blocs[0].colonnes[1].map(function (x) { return x.id; }).join(',') === 'd0,d1');
check('consolation dans son bloc, 1re colonne', plan2.blocs[1].bracket === 'consolation_5_8' && plan2.blocs[1].colonnes[0].length === 2);
check('demies réelles « à lancer »', V.etat(plan2.parId.d0) === 'a_lancer');
check('finale projetée en 3e colonne', plan2.blocs[0].colonnes[2][0].id === 'projete:0');

console.log('\n=== Sans phase finale ===');
check('aucun match de phase finale : pas de vue', V.planMultiChances([], [], ordreBloc) === null);

console.log(ko ? '\n' + ko + ' échec(s)' : '\nTout est bon.');
process.exit(ko ? 1 : 0);
