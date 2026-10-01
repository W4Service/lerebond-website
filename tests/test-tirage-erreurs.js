// Le tirage doit échouer bruyamment, pas en silence : une colonne manquante en base
// laissait le déroulé se poursuivre, l'écran TV vide et l'admin figé jusqu'au
// rechargement.
var fs = require('fs');
var src = fs.readFileSync('../js/tournoi-admin.js', 'utf8');
var ko = 0;
function check(n, c) { console.log((c ? '  ok   ' : '  FAIL ') + n); if (!c) ko++; }

console.log('=== L\'écriture de l\'état du tirage remonte ses erreurs ===');
var i = src.indexOf('async function publierEtatTirage');
var bloc = src.slice(i, src.indexOf('\n    }', i));
check('publierEtatTirage teste res.error', /res\.error/.test(bloc));
check('publierEtatTirage lève une erreur', /throw new Error/.test(bloc));
check('le message cite la cause', /écriture du tirage impossible/.test(bloc));

console.log('\n=== Contrôle préalable des colonnes ===');
check('une vérification existe avant le tirage', /async function verifierColonnesTirage/.test(src));
var j = src.indexOf('async function verifierColonnesTirage');
var blocV = src.slice(j, src.indexOf('\n    }', j));
check('elle interroge les 4 colonnes du tirage',
      /tirage_live.*tirage_seed.*tirage_at.*tirage_ordre/.test(blocV));
check('elle nomme la migration à passer',
      /20260918_tournoi_ja\.sql/.test(blocV));
check('elle propose la composition directe comme repli',
      /Composition directe/.test(blocV));
check('lancerTirage l\'appelle avant de commencer',
      /if \(!\(await verifierColonnesTirage\(\)\)\) return;/.test(src));

console.log('\n=== Retour visuel pendant le déroulé ===');
check('un panneau de suivi existe', /function panneauTirage/.test(src));
check('il est ouvert au lancement', /var suivi = panneauTirage\(\);/.test(src));
check('il est mis à jour à chaque étape', /suivi\.maj\('Tirage en cours'/.test(src));
check('il se ferme quoi qu\'il arrive (finally)',
      /} finally \{\s*\n\s*suivi\.fermer\(\);/.test(src));

console.log('\n=== Une erreur est montrée à l\'utilisateur ===');
var k = src.indexOf("} catch (err) {", src.indexOf('async function lancerTirage'));
var blocC = src.slice(k, k + 600);
check('l\'échec déclenche une alerte lisible', /alert\('Le tirage a échoué/.test(blocC));
check('il précise que rien n\'a été réparti', blocC.indexOf('pas été réparties') >= 0);
check('le nettoyage TV ne masque pas l\'erreur d\'origine',
      /try \{ await publierEtatTirage\(null\); \} catch/.test(blocC));

console.log('\n' + (ko ? ko + ' ÉCHEC(S)' : 'tout ok'));
process.exit(ko ? 1 : 0);
