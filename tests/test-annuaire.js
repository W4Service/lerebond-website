// Annuaire des joueurs : voir, renommer, fusionner, supprimer — sans passer par SQL.
var fs = require('fs');
var src = fs.readFileSync('../js/tournoi-admin.js', 'utf8');
var ko = 0;
function check(n, c) { console.log((c ? '  ok   ' : '  FAIL ') + n); if (!c) ko++; }
function extraireFn(nom) {
    var i = src.indexOf('function ' + nom + '(');
    if (i < 0) throw new Error('introuvable : ' + nom);
    var j = src.indexOf('{', i), d = 0, k = j;
    do { if (src[k] === '{') d++; else if (src[k] === '}') d--; k++; } while (d > 0);
    return src.slice(i, k);
}

console.log('=== L\'annuaire existe et couvre toute la base ===');
check('une section annuaire est rendue', /function renderAnnuaireSection/.test(src));
check('elle est branchée dans le rendu', /root\.appendChild\(renderAnnuaireSection\(\)\)/.test(src));
var bloc = extraireFn('renderAnnuaireSection');
check('elle liste joueurs (tous), pas les équipes du tournoi',
      /joueurs\.filter/.test(bloc) && /joueurs\.length/.test(bloc));
check('un filtre de recherche est proposé', /annuaireFiltre/.test(bloc));
check('repliée par défaut pour ne pas encombrer', /var annuaireReplie = true;/.test(src));

console.log('\n=== Les doublons sont signalés ===');
check('les identités sont regroupées pour repérer les doublons',
      /var parIdentite = \{\}/.test(bloc));
check('le regroupement utilise la normalisation', /normaliserIdentite\(j\.prenom\)/.test(bloc));
check('une fiche en double est marquée visuellement',
      /annuaire-ligne--double/.test(bloc) && /fiche en double/.test(bloc));

console.log('\n=== Les trois actions sont disponibles ===');
check('renommer', /onclick: function \(\) \{ renommerJoueur\(j\.id\); \}/.test(bloc));
check('fusionner', /onclick: function \(\) \{ fusionnerJoueur\(j\.id\); \}/.test(bloc));
check('supprimer', /onclick: function \(\) \{ supprimerJoueur\(j\.id\); \}/.test(bloc));
check('le nombre d\'équipes par fiche est affiché', /aucune équipe|équipe' \+/.test(bloc));

console.log('\n=== Fusion : les équipes sont préservées ===');
var blocF = extraireFn('fusionnerJoueur');
check('la fusion existe', blocF.length > 0);
check('elle propose d\'abord les homonymes', /var homonymes = joueurs\.filter/.test(blocF));
check('elle bascule les équipes avant de supprimer',
      blocF.indexOf('basculerEquipes') < blocF.indexOf("delete().eq('id', joueurId)"));
check('elle demande confirmation', /confirm\(/.test(blocF));
var blocB = extraireFn('basculerEquipes');
check('la bascule traite J1 et J2',
      /patch\.joueur_j1_id = versId/.test(blocB) && /patch\.joueur_j2_id = versId/.test(blocB));
check('une erreur interrompt la bascule', /return false;/.test(blocB));

console.log('\n=== Suppression : l\'utilisateur est prévenu du risque ===');
var blocS = extraireFn('supprimerJoueur');
check('elle compte les équipes concernées', /var usage = equipes\.filter/.test(blocS));
check('elle avertit si des équipes en dépendent',
      blocS.indexOf('Elles perdront ce joueur') >= 0);
check('elle oriente vers la fusion dans ce cas',
      blocS.indexOf('Fusionner') >= 0);
check('elle signale le risque sur les autres tournois',
      blocS.indexOf('autre tournoi') >= 0);
check('elle demande confirmation', /confirm\(msg\)/.test(blocS));

console.log('\n=== Renommage : trois issues, dont forcer la distinction ===');
var blocR = extraireFn('renommerJoueur');
check('le conflit propose 3 options', /Tape 1, 2 ou 3/.test(blocR));
check('option 1 : fusionner', blocR.indexOf('FUSIONNER') >= 0);
check('option 2 : distinguer avec un suffixe', blocR.indexOf('DISTINGUER') >= 0);
check('le suffixe est demandé puis appliqué',
      /nouveauPrenom = nouveauPrenom \+ ' ' \+ suffixe;/.test(blocR));
check('distinguer laisse ensuite passer l\'écriture', /existant = null;/.test(blocR));

console.log('\n' + (ko ? ko + ' ÉCHEC(S)' : 'tout ok'));
process.exit(ko ? 1 : 0);
