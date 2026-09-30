// Ordre de passage des matchs de poule.
// Une double boucle i<j génère bien toutes les rencontres, mais dans un ordre où
// la première équipe enchaîne tous ses matchs. L'algorithme du cercle les répartit
// en tours où chaque équipe joue au plus une fois.
var fs = require('fs');
var src = fs.readFileSync('../js/tournoi-admin.js', 'utf8');
function extraire(nom) {
    var i = src.indexOf('function ' + nom + '(');
    if (i < 0) throw new Error('introuvable : ' + nom);
    var j = src.indexOf('{', i), d = 0, k = j;
    do { if (src[k] === '{') d++; else if (src[k] === '}') d--; k++; } while (d > 0);
    return src.slice(i, k);
}
var roundRobinSchedule = new Function(extraire('roundRobinSchedule') + '\nreturn roundRobinSchedule;')();
var ko = 0;
function check(n, c) { console.log((c ? '  ok   ' : '  FAIL ') + n); if (!c) ko++; }

function eqs(n) {
    var o = [];
    for (var i = 0; i < n; i++) o.push({ id: String.fromCharCode(65 + i) });
    return o;
}
function aplatir(rounds) {
    var out = [];
    rounds.forEach(function (r) { r.forEach(function (p) { out.push([p[0].id, p[1].id]); }); });
    return out;
}
function enchainements(ordre) {
    var n = 0;
    for (var k = 1; k < ordre.length; k++) {
        if (ordre[k].some(function (x) { return ordre[k - 1].indexOf(x) >= 0; })) n++;
    }
    return n;
}

[3, 4, 5, 6].forEach(function (taille) {
    console.log('\n=== Poule de ' + taille + ' ===');
    var rounds = roundRobinSchedule(eqs(taille));
    var ordre = aplatir(rounds);
    var attendu = taille * (taille - 1) / 2;

    rounds.forEach(function (r, i) {
        var jouent = [];
        r.forEach(function (p) { jouent.push(p[0].id, p[1].id); });
        var repos = eqs(taille).map(function (e) { return e.id; })
            .filter(function (e) { return jouent.indexOf(e) < 0; });
        console.log('  Tour ' + (i + 1) + ' : '
            + r.map(function (p) { return p[0].id + '-' + p[1].id; }).join('  ')
            + (repos.length ? '   (repos : ' + repos.join() + ')' : ''));
    });

    check('toutes les rencontres sont générées (' + attendu + ')', ordre.length === attendu);

    // Chaque paire se rencontre exactement une fois.
    var vues = {};
    var doublon = false;
    ordre.forEach(function (p) {
        var cle = p.slice().sort().join('-');
        if (vues[cle]) doublon = true;
        vues[cle] = true;
    });
    check('aucune rencontre en double', !doublon);

    // Dans un tour, une équipe ne joue qu'une fois.
    var conflit = false;
    rounds.forEach(function (r) {
        var vus = {};
        r.forEach(function (p) {
            [p[0].id, p[1].id].forEach(function (e) {
                if (vus[e]) conflit = true;
                vus[e] = true;
            });
        });
    });
    check('aucune équipe ne joue 2 fois dans le même tour', !conflit);

    // Comparaison avec la double boucle qu'on a remplacée.
    var brut = [];
    var ids = eqs(taille).map(function (e) { return e.id; });
    for (var i = 0; i < ids.length; i++) {
        for (var j = i + 1; j < ids.length; j++) brut.push([ids[i], ids[j]]);
    }
    var eCercle = enchainements(ordre), eBrut = enchainements(brut);
    console.log('  enchaînements immédiats : cercle ' + eCercle + ' / double boucle ' + eBrut);
    check('le cercle enchaîne moins que la double boucle', eCercle <= eBrut);

    // Personne ne doit disputer tous ses matchs d'affilée en début de tableau.
    // Dans une poule de 3 c'est impossible à éviter : 3 matchs, 2 par équipe, donc
    // une équipe joue forcément les 2 premiers. Le test ne vaut qu'à partir de 4.
    if (taille >= 4) {
        var premiers = ordre.slice(0, taille - 1);
        var monopole = ids.some(function (e) {
            return premiers.every(function (p) { return p.indexOf(e) >= 0; });
        });
        check('aucune équipe ne monopolise les premiers matchs', !monopole);
    }
});

console.log('\n=== Le défaut corrigé, sur une poule de 5 ===');
var ids5 = ['A', 'B', 'C', 'D', 'E'];
var brut5 = [];
for (var i = 0; i < 5; i++) for (var j = i + 1; j < 5; j++) brut5.push([ids5[i], ids5[j]]);
var aEnchaine = brut5.slice(0, 4).every(function (p) { return p.indexOf('A') >= 0; });
check('double boucle : A disputait bien les 4 premiers matchs', aEnchaine);
var cercle5 = aplatir(roundRobinSchedule(eqs(5)));
var aEnchaineCercle = cercle5.slice(0, 4).every(function (p) { return p.indexOf('A') >= 0; });
check('cercle : ce n\'est plus le cas', !aEnchaineCercle);

console.log('\n' + (ko ? ko + ' ÉCHEC(S)' : 'tout ok'));
process.exit(ko ? 1 : 0);
