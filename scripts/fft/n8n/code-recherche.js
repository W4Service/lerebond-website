// n8n — Code « Recherche Ten'Up » (webhook GET /webhook/rebond-fft)
// Paramètres : nom + prenom, OU q (« Julien Dupont » / « Dupont Julien »), genre facultatif (H|F).
// Ten'Up ne trouve que le nom + prénom EXACTS (casse et accents ignorés) : on essaie
// les deux découpages possibles de q. Au plus 4 appels par recherche.
const API = 'https://tenup.fft.fr/api/back/public/v2/classements/recherche';
const UA = 'LeRebondNoyon/1.0 (+https://le-rebond.fr)';
const helpers = this.helpers;

async function tenup(corps) {
    try {
        return await helpers.httpRequest({
            method: 'POST', url: API, json: true, timeout: 15000,
            headers: { 'User-Agent': UA, Accept: 'application/json' },
            body: Object.assign({ pratique: 'PADEL' }, corps)
        });
    } catch (e) {
        // 400 = « recherche impossible avec ces paramètres » : personne de classé à ce nom.
        // Selon la version de n8n, le code HTTP n'est pas au même endroit (AxiosError, NodeApiError…).
        const code = Number(e.httpCode || e.statusCode || e.status
            || (e.response && (e.response.status || e.response.statusCode))
            || (e.cause && (e.cause.status || (e.cause.response && e.cause.response.status)))
            || (String(e.message).match(/status code (\d{3})/) || [])[1]);
        if (code === 400) return { joueurs: [] };
        throw e;
    }
}

const p = ($input.first().json.query) || {};
const propre = s => String(s || '').trim().replace(/\s+/g, ' ').slice(0, 60);
let paires = [];
if (p.nom && p.prenom) {
    paires.push([propre(p.nom), propre(p.prenom)]);
} else if (p.q) {
    const mots = propre(p.q).split(' ');
    if (mots.length >= 2) {
        paires.push([mots.slice(1).join(' '), mots[0]]);                      // « Julien Dupont »
        paires.push([mots.slice(0, -1).join(' '), mots[mots.length - 1]]);    // « Dupont Julien »
    }
}
paires = paires.filter((x, i, t) => x[0].length >= 2 && x[1].length >= 2
    && t.findIndex(y => y[0] === x[0] && y[1] === x[1]) === i);
const genres = (p.genre === 'H' || p.genre === 'F') ? [p.genre] : ['H', 'F'];

let mois = null;
const joueurs = [];
for (const [nom, prenom] of paires) {
    for (const sexe of genres) {
        const r = await tenup({ sexe, nom, prenom });
        if (r.referentiels && r.referentiels.datesClassement) mois = r.referentiels.datesClassement[0];
        (r.joueurs || [])
            .filter(j => j.utilisateurRecherche && j.nom)     // nom null = joueur anonyme sur Ten'Up
            .forEach(j => joueurs.push(Object.assign({}, j, { sexe })));
    }
    if (joueurs.length) break;
}

return [{ json: {
    mois,
    joueurs: joueurs.map(j => ({
        rang: j.classement, nom: j.nom, prenom: j.prenom, points: j.points, genre: j.sexe,
        club: j.club, ligue: j.ligue, comite: j.comite, id_crm: j.idCrm, mois
    })),
    brut: joueurs
} }];
