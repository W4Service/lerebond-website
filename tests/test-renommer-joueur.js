// Renommer un joueur vers un nom déjà pris : la base refuse (index unique sur
// nom+prénom). L'admin doit l'expliquer et proposer la fusion, pas afficher
// l'erreur SQL brute.
var fs = require('fs');
var src = fs.readFileSync('../js/tournoi-admin.js', 'utf8');
var ko = 0;
function check(n, c) { console.log((c ? '  ok   ' : '  FAIL ') + n); if (!c) ko++; }

var i = src.indexOf('async function renommerJoueur');
var bloc = src.slice(i, src.indexOf('\n    }\n', i));

console.log('=== Le conflit est détecté avant d\'écrire ===');
check('recherche d\'un homonyme dans la liste', /var existant = joueurs\.find/.test(bloc));
check('la fiche en cours est exclue de la recherche', /x\.id !== joueurId/.test(bloc));
check('la comparaison passe par memeJoueur (casse, accents, espaces)',
      /memeJoueur\(x\.prenom, x\.nom, nouveauPrenom, nouveauNom\)/.test(bloc));

console.log('\n=== L\'utilisateur comprend ce qui bloque ===');
check('le message nomme le joueur en conflit',
      bloc.indexOf("' existe déjà '") >= 0 || bloc.indexOf('existe déjà') >= 0);
check('il explique la règle (pas de même nom+prénom)',
      bloc.indexOf('ne peuvent pas porter le même nom') >= 0);
check('il indique combien d\'équipes dépendent de chaque fiche',
      /nbExistant|nbActuel/.test(bloc));
check('il propose de distinguer les deux fiches',
      bloc.indexOf('DISTINGUER') >= 0);

console.log('\n=== La fusion est proposée et complète ===');
// La bascule est factorisée dans basculerEquipes(), partagée avec l'annuaire.
check('les équipes sont rebasculées vers la fiche conservée',
      /basculerEquipes\(joueurId, existant\.id\)/.test(bloc));
var blocBasc = (function () {
    var i = src.indexOf('async function basculerEquipes');
    var j = src.indexOf('{', i), d = 0, k = j;
    do { if (src[k] === '{') d++; else if (src[k] === '}') d--; k++; } while (d > 0);
    return src.slice(i, k);
})();
check('les deux rôles J1 et J2 sont traités',
      /patch\.joueur_j1_id = versId/.test(blocBasc) && /patch\.joueur_j2_id = versId/.test(blocBasc));
check('le doublon est supprimé après bascule',
      /from\('joueurs'\)\.delete\(\)\.eq\('id', joueurId\)/.test(bloc));
check('le cache local est mis à jour',
      /joueurs = joueurs\.filter/.test(bloc));
check('une erreur pendant la bascule interrompt la fusion',
      /Erreur pendant la fusion/.test(blocBasc) && /return false;/.test(blocBasc));

console.log('\n=== Filet de sécurité si le doublon échappe au contrôle local ===');
check('l\'erreur SQL de doublon est reconnue',
      /uniq_joueurs_nom_prenom\|duplicate key/.test(bloc));
check('elle est traduite en message lisible',
      bloc.indexOf('Choisis une autre orthographe') >= 0);

console.log('\n=== Simulation de la détection ===');
function detecte(joueurs, joueurId, prenom, nom) {
    return joueurs.find(function (x) {
        return x.id !== joueurId
            && (x.nom || '').toLowerCase() === nom.toLowerCase()
            && (x.prenom || '').toLowerCase() === prenom.toLowerCase();
    });
}
var liste = [
    { id: '1', prenom: 'Gaël', nom: 'Poujol' },
    { id: '2', prenom: 'Thomas', nom: 'Wuilmot' }
];
check('renommer vers un nom libre : pas de conflit',
      !detecte(liste, '1', 'Gaël', 'Martin'));
check('renommer vers un nom pris : conflit détecté',
      !!detecte(liste, '1', 'Thomas', 'Wuilmot'));
check('casse différente : conflit détecté quand même',
      !!detecte(liste, '1', 'THOMAS', 'wuilmot'));
check('se renommer soi-même : pas de conflit',
      !detecte(liste, '1', 'Gaël', 'Poujol'));

console.log('\n=== Accents, casse et espaces : comparés comme en base ===');
function extraireFn(nom) {
    var i = src.indexOf('function ' + nom + '(');
    var j = src.indexOf('{', i), d = 0, k = j;
    do { if (src[k] === '{') d++; else if (src[k] === '}') d--; k++; } while (d > 0);
    return src.slice(i, k);
}
var normBloc = extraireFn('normaliserIdentite');
var memeBloc = extraireFn('memeJoueur');
var meme = new Function(normBloc + '\n' + memeBloc + '\nreturn memeJoueur;')();

check('les accents sont ignorés : Gaël = Gael',
      meme('Gaël', 'Poujol', 'Gael', 'Poujol'));
check('la casse est ignorée : THOMAS = thomas',
      meme('THOMAS', 'Wuilmot', 'thomas', 'wuilmot'));
check('les espaces en trop sont ignorés',
      meme('Thomas ', ' Wuilmot', 'Thomas', 'Wuilmot'));
check('les espaces internes multiples sont réduits',
      meme('Jean  Pierre', 'Durand', 'Jean Pierre', 'Durand'));
check('deux joueurs réellement différents restent distincts',
      !meme('Gaël', 'Poujol', 'Thomas', 'Wuilmot'));
check('un prénom proche ne suffit pas à confondre',
      !meme('Gaël', 'Poujol', 'Gaëlle', 'Poujol'));

console.log('\n=== La création utilise la même comparaison ===');
check('le rattachement d\'un joueur existant passe par memeJoueur',
      /var match = joueurs\.find\(function \(j\) \{\s*\n\s*return memeJoueur/.test(src));

console.log('\n' + (ko ? ko + ' ÉCHEC(S)' : 'tout ok'));
process.exit(ko ? 1 : 0);
