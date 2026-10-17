// Edge Function « fft-recherche » : recherche d'un joueur dans le classement padel FFT, en direct sur Ten'Up.
//
// Appelée par le site (js/fft-recherche.js) quand le cache fft_classement ne connaît pas le joueur.
// Ten'Up n'autorise pas les appels depuis un autre site (pas de CORS) : il faut passer par un serveur.
// Hébergée chez Supabase plutôt que sur n8n : la recherche ne dépend pas du Pi.
//
// Corps : { q: "Prénom Nom" } ou { nom, prenom }, genre facultatif ("H" | "F").
// Ten'Up ne trouve que le nom + prénom complets (casse et accents ignorés) : on essaie les deux
// découpages de q, hommes puis dames si le genre n'est pas donné. Au plus 4 appels.
// Les classés trouvés sont mis en cache (fft_enregistrer_tenup), sauf les joueurs anonymes.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const API = 'https://tenup.fft.fr/api/back/public/v2/classements/recherche';
const UA = 'LeRebondNoyon/1.0 (+https://le-rebond.fr)';
const ORIGINES = ['https://le-rebond.fr', 'https://www.le-rebond.fr'];

function cors(origine: string | null) {
    return {
        'Access-Control-Allow-Origin': origine && ORIGINES.includes(origine) ? origine : ORIGINES[0],
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Vary': 'Origin',
    };
}

type Joueur = Record<string, unknown> & { sexe?: string };

async function tenup(corps: Record<string, unknown>): Promise<{ joueurs?: Joueur[]; referentiels?: { datesClassement?: string[] } }> {
    const r = await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Accept: 'application/json', 'User-Agent': UA },
        body: JSON.stringify({ pratique: 'PADEL', ...corps }),
        signal: AbortSignal.timeout(12000),
    });
    // 400 = « recherche impossible avec ces paramètres » : personne de classé à ce nom.
    if (r.status === 400) return { joueurs: [] };
    if (!r.ok) throw new Error(`Ten'Up ${r.status}`);
    return await r.json();
}

const propre = (s: unknown) => String(s ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);

Deno.serve(async (req) => {
    const entetes = cors(req.headers.get('Origin'));
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: entetes });
    const repondre = (corps: unknown, status = 200) =>
        new Response(JSON.stringify(corps), { status, headers: { ...entetes, 'content-type': 'application/json' } });

    let p: Record<string, unknown> = {};
    try { p = await req.json(); } catch { /* corps vide */ }

    let paires: [string, string][] = [];
    if (p.nom && p.prenom) {
        paires.push([propre(p.nom), propre(p.prenom)]);
    } else if (p.q) {
        const mots = propre(p.q).split(' ');
        if (mots.length >= 2) {
            paires.push([mots.slice(1).join(' '), mots[0]]);                    // « Julien Dupont »
            paires.push([mots.slice(0, -1).join(' '), mots[mots.length - 1]]);  // « Dupont Julien »
        }
    }
    paires = paires.filter((x, i, t) => x[0].length >= 2 && x[1].length >= 2
        && t.findIndex((y) => y[0] === x[0] && y[1] === x[1]) === i);
    if (!paires.length) return repondre({ mois: null, joueurs: [] });
    const genres = p.genre === 'H' || p.genre === 'F' ? [p.genre as string] : ['H', 'F'];

    let mois: string | null = null;
    const trouves: Joueur[] = [];
    try {
        for (const [nom, prenom] of paires) {
            for (const sexe of genres) {
                const r = await tenup({ sexe, nom, prenom });
                if (r.referentiels?.datesClassement?.length) mois = r.referentiels.datesClassement[0];
                (r.joueurs ?? [])
                    .filter((j) => j.utilisateurRecherche && j.nom)   // nom null = joueur anonyme sur Ten'Up
                    .forEach((j) => trouves.push({ ...j, sexe }));
            }
            if (trouves.length) break;
        }
    } catch (e) {
        return repondre({ erreur: "Classement Ten'Up indisponible", detail: String(e) }, 502);
    }

    // Mise en cache : ne bloque pas la réponse en cas d'échec.
    if (mois && trouves.length) {
        try {
            const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
            const { error } = await admin.rpc('fft_enregistrer_tenup', { p_mois: mois, p_lignes: trouves });
            if (error) console.error('cache', error.message);
        } catch (e) { console.error('cache', String(e)); }
    }

    return repondre({
        mois,
        joueurs: trouves.map((j) => ({
            rang: j.classement, nom: j.nom, prenom: j.prenom, points: j.points, genre: j.sexe,
            club: j.club, ligue: j.ligue, comite: j.comite, id_crm: j.idCrm, mois,
        })),
    });
});
