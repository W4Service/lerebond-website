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
check('comparaison insensible à la casse', /toLowerCase\(\)/.test(bloc));

console.log('\n=== L\'utilisateur comprend ce qui bloque ===');
check('le message nomme le joueur en conflit',
      bloc.indexOf("' existe déjà '") >= 0 || bloc.indexOf('existe déjà') >= 0);
check('il explique la règle (pas de même nom+prénom)',
      bloc.indexOf('ne peuvent pas porter le même nom') >= 0);
check('il indique combien d\'équipes dépendent de chaque fiche',
      /nbExistant|nbActuel/.test(bloc));
check('il suggère une issue si on ne veut pas fusionner',
      bloc.indexOf('orthographe différente') >= 0);

console.log('\n=== La fusion est proposée et complète ===');
check('les équipes sont rebasculées vers la fiche conservée',
      /joueur_j1_id = existant\.id|patch\.joueur_j1_id = existant\.id/.test(bloc));
check('les deux rôles J1 et J2 sont traités',
      /patch\.joueur_j1_id/.test(bloc) && /patch\.joueur_j2_id/.test(bloc));
check('le doublon est supprimé après bascule',
      /from\('joueurs'\)\.delete\(\)\.eq\('id', joueurId\)/.test(bloc));
check('le cache local est mis à jour',
      /joueurs = joueurs\.filter/.test(bloc));
check('une erreur pendant la bascule interrompt la fusion',
      /Erreur pendant la fusion/.test(bloc));

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

console.log('\n' + (ko ? ko + ' ÉCHEC(S)' : 'tout ok'));
process.exit(ko ? 1 : 0);
