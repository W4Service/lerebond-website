// Un tournoi loisir ne doit rien se voir imposer du règlement FFT.
// Le réglage « Homologué FFT » du tournoi commande, pas le format retenu.
var fs = require('fs');
var src = fs.readFileSync('../js/tournoi-admin.js', 'utf8');
var C = require('../js/tournoi-classement.js');
var ko = 0;
function check(n, c) { console.log((c ? '  ok   ' : '  FAIL ') + n); if (!c) ko++; }
function extraire(nom) {
    var i = src.indexOf('function ' + nom + '(');
    if (i < 0) throw new Error('introuvable : ' + nom);
    var j = src.indexOf('{', i), d = 0, k = j;
    do { if (src[k] === '{') d++; else if (src[k] === '}') d--; k++; } while (d > 0);
    return src.slice(i, k);
}

console.log('=== Le barème FFT ne s\'applique qu\'en homologué ===');
function eq(ids) { return ids.map(function (id) { return { id: id, nom: id }; }); }
function m(a, b, sa, sb) {
    return { equipe_a_id: a, equipe_b_id: b, score_a: sa, score_b: sb,
             vainqueur_id: parseInt(sa, 10) > parseInt(sb, 10) ? a : b, issue: 'normal' };
}
var ms = [ m('A','B','6','3'), m('A','C','6','2'), m('B','C','6','4') ];
var loisir = C.classerPoule({ equipes: eq(['A','B','C']), matchs: ms, compteSets: true, homologue: false });
var homo   = C.classerPoule({ equipes: eq(['A','B','C']), matchs: ms, compteSets: true, homologue: true });
console.log('  loisir    : ' + loisir.map(function (l) { return l.nom + ' ' + l.v + 'V'; }).join(', '));
console.log('  homologué : ' + homo.map(function (l) { return l.nom + ' ' + l.pts + 'pts'; }).join(', '));
check('loisir : tri par victoires, pas de points', loisir[0].v === 2);
check('homologué : barème appliqué', homo[0].pts === 4);

console.log('\n=== Repos : rien d\'imposé en loisir ===');
var reposApplicable = new Function('currentTournoi',
    extraire('reposReglementaireMin') + '\n' + extraire('reposApplicableMin')
    + '\nreturn reposApplicableMin();');
check('loisir, format C : aucun repos imposé',
      reposApplicable({ homologue: false, format_score: 'format_c' }) === null);
check('homologué, format C : 30 min imposées',
      reposApplicable({ homologue: true, format_score: 'format_c' }) === 30);
check('loisir + valeur saisie par le JA : sa valeur est respectée',
      reposApplicable({ homologue: false, format_score: 'format_c', repos_min_minutes: 20 }) === 20);
check('homologué + valeur saisie : la saisie prime aussi',
      reposApplicable({ homologue: true, format_score: 'format_a', repos_min_minutes: 45 }) === 45);

console.log('\n=== Têtes de série : liées au tournoi, pas au format ===');
check('le calcul des TS lit currentTournoi.homologue',
      /var homologue = !!\(currentTournoi && currentTournoi\.homologue\);\s*\n\s*var nbTS = \(homologue && format\.homologable\)/.test(src));
check('le badge FFT est masqué en loisir',
      /if \(!currentTournoi \|\| !currentTournoi\.homologue\) return null;/.test(src));
check('la règle de minuit ne vise que l\'homologué',
      /currentTournoi\.homologue && new Date\(\)\.getHours\(\) === 0/.test(src));

console.log('\n' + (ko ? ko + ' ÉCHEC(S)' : 'tout ok'));
process.exit(ko ? 1 : 0);
