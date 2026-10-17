// n8n — Code « Vérifier sur Ten'Up » (tâche quotidienne, une exécution pour tout le lot)
// Entrée : les joueurs renvoyés par fft_joueurs_a_verifier(mois, limite).
// Pour chacun : recherche par identifiant FFT s'il est connu, sinon par nom + prénom.
//   1 classé trouvé  → 'classe'      (on retient son identifiant FFT)
//   plusieurs        → 'homonymes'   (à trancher dans l'admin, les candidats vont en cache)
//   aucun            → 'non_classe'
// Une requête toutes les 0,8 s, et arrêt à 230 s : le node Code est coupé à 300 s ;
// ce qui reste est repris le lendemain.
const API = 'https://tenup.fft.fr/api/back/public/v2/classements/recherche';
const UA = 'LeRebondNoyon/1.0 (+https://le-rebond.fr)';
const PAUSE_MS = 800, BUDGET_MS = 230000;
const helpers = this.helpers;
const pause = ms => new Promise(r => setTimeout(r, ms));

async function tenup(corps) {
    try {
        return await helpers.httpRequest({
            method: 'POST', url: API, json: true, timeout: 15000,
            headers: { 'User-Agent': UA, Accept: 'application/json' },
            body: Object.assign({ pratique: 'PADEL' }, corps)
        });
    } catch (e) {
        // Selon la version de n8n, le code HTTP n'est pas au même endroit (AxiosError, NodeApiError…).
        const code = Number(e.httpCode || e.statusCode || e.status
            || (e.response && (e.response.status || e.response.statusCode))
            || (e.cause && (e.cause.status || (e.cause.response && e.cause.response.status)))
            || (String(e.message).match(/status code (\d{3})/) || [])[1]);
        if (code === 400) return { joueurs: [] };
        throw e;
    }
}

const debut = Date.now();
const mois = $('Mois du classement').first().json.mois;
const resultats = [], lignes = [];
let interrompu = false;

for (const item of $input.all()) {
    if (Date.now() - debut > BUDGET_MS) { interrompu = true; break; }
    const j = item.json;
    const genres = (j.genre === 'H' || j.genre === 'F') ? [j.genre] : ['H', 'F'];
    let trouves = [];
    for (const sexe of genres) {
        const corps = j.fft_id_crm ? { sexe, idCrm: Number(j.fft_id_crm) } : { sexe, nom: j.nom, prenom: j.prenom };
        const r = await tenup(corps);
        await pause(PAUSE_MS);
        trouves = (r.joueurs || []).filter(x => x.utilisateurRecherche && x.nom).map(x => Object.assign({}, x, { sexe }));
        if (trouves.length) break;
    }
    lignes.push(...trouves);
    if (trouves.length === 1) {
        const t = trouves[0];
        resultats.push({ joueur_id: j.id, statut: 'classe', id_crm: t.idCrm, rang: t.classement,
                         points: t.points, genre: t.sexe, club: t.club });
    } else {
        resultats.push({ joueur_id: j.id, statut: trouves.length > 1 ? 'homonymes' : 'non_classe' });
    }
}

return [{ json: { mois, resultats, lignes, verifies: resultats.length, interrompu,
                  duree_s: Math.round((Date.now() - debut) / 1000) } }];
