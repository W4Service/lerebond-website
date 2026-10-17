// Calendrier des tournois + rattachement au classement FFT.
var fs = require('fs');
var ko = 0;
function check(n, c) { console.log((c ? '  ok   ' : '  FAIL ') + n); if (!c) ko++; }
var admin = fs.readFileSync('../js/tournoi-admin.js', 'utf8');
var planning = fs.readFileSync('../js/tournoi-planning.js', 'utf8');
var page = fs.readFileSync('../js/tournois-calendrier.js', 'utf8');
var sqlFft = fs.readFileSync('../supabase/migrations/20261017_fft_classement.sql', 'utf8');
var sqlCal = fs.readFileSync('../supabase/migrations/20261017_tournois_calendrier.sql', 'utf8');

console.log('=== Recherche FFT : même normalisation que l\'admin ===');
global.window = {};
require('../js/fft-recherche.js');
var F = window.FFTRecherche;
check('accents, casse et espaces ignorés', F.normaliser('  Gaël   DUPÓNT ') === 'gael dupont');
check('pas de requête sous 3 caractères', F.LONGUEUR_MIN === 3);
check('affichage prénom puis nom', F.nomAffiche({ prenom: 'Julie', nom: 'DUPONT' }) === 'Julie DUPONT');

console.log('\n=== Admin : le classement alimente le poids de paire ===');
check('le RANG (pas les points) pré-remplit points_j1/j2',
      /points_j1: rangFFT\(j1Id\)/.test(admin) && /return j && j\.fft_rang != null \? j\.fft_rang : null/.test(admin));
check('le choix FFT est enregistré sur la fiche joueur avant l\'insertion de l\'équipe',
      admin.indexOf('await enregistrerChoixFFT(j1Id') < admin.indexOf("points_j1: rangFFT(j1Id)"));
check('les suggestions sont branchées AVANT « Entrée = ajouter l\'équipe »',
      admin.indexOf("brancherSuggestionsFFT('j2'") < admin.indexOf("inpPrenom2.addEventListener('keydown'"));
check('retoucher le nom annule le choix FFT', /if \(c && !memeJoueur\(inpPrenom\.value, inpNom\.value, c\.prenom, c\.nom\)\)/.test(admin));
check('« Reprendre » ne remplace jamais une valeur saisie',
      /if \(eq\.points_j1 == null && r1 != null\)/.test(admin));
check('le champ de saisie parle de classement, pas de points', /Classement FFT \(rang\) de/.test(admin));

console.log('\n=== SQL : rapprochement prudent ===');
check('par nom seulement s\'il n\'y a pas d\'homonyme', /k\.nb = 1/.test(sqlFft));
check('recherche limitée au dernier mois importé', /max\(i\.mois\)/.test(sqlFft));
check('le calendrier public n\'expose que les tournois publiés', /WHERE t\.publie/.test(sqlCal));
check('les archivés ne sortent pas', /status IN \('planifie', 'actif', 'cloture'\)/.test(sqlCal));

console.log('\n=== Planning ===');
check('un tournoi planifié n\'est pas « actif »', /status: 'planifie'/.test(planning));
check('lancer clôture l\'actif en cours avant de basculer',
      planning.indexOf("status: 'cloture'") < planning.indexOf("update({ status: 'actif'"));
check('une catégorie P… classe aux classements FFT', /mode_classement: homologue \? 'fft' : 'niveau'/.test(planning));

console.log('\n=== Page publique ===');
check('seuls les tournois à venir', /\.gte\('date', aujourdhui\(\)\)/.test(page));
check('le club reste visible pour départager les homonymes', /j\.genre === 'F' \? 'Dames' : 'Messieurs', j\.club/.test(page));

console.log('\n=== Ten\'Up en direct (réseau simulé) ===');
var sqlTenup = fs.readFileSync('../supabase/migrations/20261018_fft_tenup.sql', 'utf8');
check('les joueurs anonymes sur Ten\'Up ne sont pas stockés', /nullif\(btrim\(l->>'nom'\), ''\) IS NOT NULL/.test(sqlTenup));
check('dernier classement connu PAR joueur (pas le dernier mois global)',
      /DISTINCT ON \(c\.genre, coalesce\(c\.id_crm::text, c\.recherche\)\)/.test(sqlTenup));
check('les fonctions d\'écriture n8n sont fermées au site public',
      /REVOKE ALL ON FUNCTION fft_enregistrer_tenup\(date, jsonb\) FROM PUBLIC, anon, authenticated/.test(sqlTenup));
var sqlDoublons = fs.readFileSync('../supabase/migrations/20261019_fft_tenup_doublons.sql', 'utf8');
check('un classé présent deux fois dans un lot n\'est écrit qu\'une fois',
      /DISTINCT ON \(l->>'sexe', \(l->>'idCrm'\)::bigint\)/.test(sqlDoublons));
check('deux fiches de la même personne ne se disputent pas l\'identifiant FFT', /PARTITION BY r\.id_crm/.test(sqlDoublons));
check('l\'admin retient l\'identifiant FFT du joueur choisi', /patch\.fft_id_crm = choix\.id_crm/.test(admin));
check('direct seulement avec prénom ET nom', F.rechercheDirectePossible('dupont julien') && !F.rechercheDirectePossible('dupont'));

var appels = [];
var reponseDirecte = { data: { mois: '2026-10-06', joueurs: [
    { rang: 22770, nom: 'POUJOL', prenom: 'Gael', genre: 'H', club: 'LE REBOND', id_crm: 8546867885 }] }, error: null };
function fauxSupa(lignes, echec) {
    return {
        rpc: async function () { return { data: lignes, error: null }; },
        functions: { invoke: async function (nom, o) {
            appels.push(nom + ' ' + JSON.stringify(o.body));
            return echec ? { data: null, error: new Error('injoignable') } : reponseDirecte;
        } }
    };
}

(async function () {
    var r1 = await F.rechercherPartout(fauxSupa([]), 'Gael Poujol', {});
    check('cache vide + nom complet → Ten\'Up interrogé', appels.length === 1 && r1.length === 1 && r1[0].direct === true);
    check('le genre demandé est transmis', (await F.rechercherPartout(fauxSupa([]), 'Gael Poujol', { genre: 'H' }), /"genre":"H"/.test(appels[1])));
    check('passe par l\'Edge Function, pas par le Pi', /^fft-recherche /.test(appels[0]));
    appels = [];
    var r4 = await F.rechercherPartout(fauxSupa([], true), 'Damien Esponde', {});
    check('Ten\'Up injoignable → signalé, pas « aucun classé »', r4.length === 0 && r4.directIndisponible === true);
    appels = [];
    var r2 = await F.rechercherPartout(fauxSupa([{ rang: 22770, nom: 'POUJOL', prenom: 'Gaël', genre: 'H', id_crm: 8546867885 }]), 'gael poujol', {});
    check('déjà en cache sous ce nom exact → pas d\'appel Ten\'Up', appels.length === 0 && r2.length === 1);
    appels = [];
    var r3 = await F.rechercherPartout(fauxSupa([{ rang: 9, nom: 'POUJOLAT', prenom: 'Gaelle', genre: 'F', id_crm: 1 }]), 'gael poujol', {});
    check('cache approchant mais pas exact → Ten\'Up, résultats fusionnés', appels.length === 1 && r3.length === 2);
    appels = [];
    await F.rechercherPartout(fauxSupa([]), 'poujol', {});
    check('un seul mot → jamais d\'appel Ten\'Up', appels.length === 0);

    console.log(ko ? '\n' + ko + ' échec(s)' : '\nTout est vert.');
    process.exit(ko ? 1 : 0);
})();
