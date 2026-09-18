// Temps de repos — Guide de la compétition padel FFT, chapitre I (MAJ février 2026),
// section « TEMPS DE REPOS MINIMUM ».
var fs = require('fs');
var src = fs.readFileSync('../js/tournoi-admin.js', 'utf8');
function extraire(nom) {
    var i = src.indexOf('function ' + nom + '(');
    if (i < 0) throw new Error('introuvable : ' + nom);
    var j = src.indexOf('{', i), d = 0, k = j;
    do { if (src[k] === '{') d++; else if (src[k] === '}') d--; k++; } while (d > 0);
    return src.slice(i, k);
}
var ko = 0;
function check(n, c) { console.log((c ? '  ok   ' : '  FAIL ') + n); if (!c) ko++; }

var repos = new Function(extraire('reposReglementaireMin') + '\nreturn reposReglementaireMin;')();

console.log('=== Valeurs réglementaires (texte officiel) ===');
var attendu = {
    'format_a': [90, '1h30 après un match au format A1 ou A2'],
    'format_b': [60, '1h après un match au format B1 ou B2'],
    'format_c': [30, '30 min après un match au format C1 ou C2 et D1 ou D2'],
    'format_d': [30, '30 min après un match au format C1 ou C2 et D1 ou D2'],
    'format_e': [15, '15 min après 3 matchs consécutifs au format E'],
    'format_f': [15, '15 min après un match au format F']
};
Object.keys(attendu).forEach(function (f) {
    var v = repos(f), exp = attendu[f][0];
    check(f + ' -> ' + exp + ' min   « ' + attendu[f][1] + ' »', v === exp);
});
check('format club hors barème : pas de valeur imposée', repos('1set_6jeux') === null);
check('format inconnu : pas de valeur imposée', repos('americano') === null);

console.log('\n=== Contrôle du repos écoulé ===');
// On rejoue la logique de controlerRepos sans le DOM.
function reposEcoule(finishedAt, maintenant) {
    return Math.floor((maintenant - new Date(finishedAt).getTime()) / 60000);
}
var t0 = new Date('2026-09-18T14:00:00Z').getTime();
check('match fini il y a 20 min -> 20',
      reposEcoule('2026-09-18T13:40:00Z', t0) === 20);
check('20 min écoulées < 30 min dues (format C) : en défaut',
      reposEcoule('2026-09-18T13:40:00Z', t0) < repos('format_c'));
check('45 min écoulées >= 30 min dues (format C) : conforme',
      reposEcoule('2026-09-18T13:15:00Z', t0) >= repos('format_c'));
check('45 min écoulées < 60 min dues (format B) : en défaut',
      reposEcoule('2026-09-18T13:15:00Z', t0) < repos('format_b'));
check('2h écoulées >= 1h30 dues (format A) : conforme',
      reposEcoule('2026-09-18T12:00:00Z', t0) >= repos('format_a'));

console.log('\n=== Règles annexes présentes dans le code ===');
check('minuit : interdiction de débuter une rencontre',
      /interdit de faire\s*\+?\s*'?\s*débuter une rencontre après minuit|après minuit/.test(src));
check('dérogation au repos : accord écrit des 4 joueurs',
      /accord ÉCRIT des 4 joueurs|accord écrit des 4 joueurs/i.test(src));
check('le repos est réglable par le JA', /repos_min_minutes/.test(src));
check('comptage des matchs du jour', /matchsJoursMemeJour/.test(src));

console.log('\n' + (ko ? ko + ' ÉCHEC(S)' : 'tout ok'));
process.exit(ko ? 1 : 0);
