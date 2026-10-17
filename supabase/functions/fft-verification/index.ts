// Edge Function « fft-verification » : revérifie le classement FFT des joueurs du club sur Ten'Up.
//
// Appelée toutes les heures par pg_cron (migration 20261022_fft_cron.sql). À chaque appel :
//   1. lit le mois du dernier classement publié sur Ten'Up ;
//   2. prend au plus 50 joueurs pas encore vérifiés pour ce mois (fft_joueurs_a_verifier),
//      ceux engagés dans un tournoi en premier ;
//   3. cherche chacun par identifiant FFT s'il est connu, sinon par nom + prénom
//      (1 classé → 'classe', plusieurs → 'homonymes', aucun → 'non_classe') ;
//   4. enregistre le tout (fft_enregistrer_tenup + fft_appliquer_verifications).
// Un verrou en base empêche deux exécutions simultanées. Remplace la tâche n8n du Pi.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const API = 'https://tenup.fft.fr/api/back/public/v2/classements/recherche';
const UA = 'LeRebondNoyon/1.0 (+https://le-rebond.fr)';
const LOT = 50, PAUSE_MS = 800, BUDGET_MS = 110_000;   // Edge Function : 150 s maximum
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Joueur = Record<string, unknown> & { sexe?: string };

async function tenup(corps: Record<string, unknown>): Promise<{ joueurs?: Joueur[]; referentiels?: { datesClassement?: string[] } }> {
    const r = await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Accept: 'application/json', 'User-Agent': UA },
        body: JSON.stringify({ pratique: 'PADEL', ...corps }),
        signal: AbortSignal.timeout(12000),
    });
    if (r.status === 400) return { joueurs: [] };   // personne de classé à ce nom
    if (!r.ok) throw new Error(`Ten'Up ${r.status}`);
    return await r.json();
}

Deno.serve(async () => {
    const debut = Date.now();
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const json = (c: unknown, s = 200) => new Response(JSON.stringify(c), { status: s, headers: { 'content-type': 'application/json' } });

    const { data: verrou, error: errVerrou } = await db.rpc('fft_tache_prendre', { p_nom: 'verification', p_duree_s: 150 });
    if (errVerrou) return json({ erreur: errVerrou.message }, 500);
    if (!verrou) return json({ ignore: 'une vérification est déjà en cours' });

    try {
        // Mois du dernier classement : petite requête (une page de l'Oise, dames).
        const ref = await tenup({ sexe: 'F', page: 1, codeLigue: 56, codesComites: ['5660'], afficheReferentiels: true });
        const mois = ref.referentiels?.datesClassement?.[0];
        if (!mois) throw new Error("Mois du classement introuvable dans la réponse Ten'Up");

        const { data: joueurs, error } = await db.rpc('fft_joueurs_a_verifier', { p_mois: mois, p_limite: LOT });
        if (error) throw new Error(error.message);
        if (!joueurs?.length) return json({ mois, verifies: 0 });

        const resultats: Record<string, unknown>[] = [];
        const lignes: Joueur[] = [];
        for (const j of joueurs as { id: string; nom: string; prenom: string; genre: string | null; fft_id_crm: number | null }[]) {
            if (Date.now() - debut > BUDGET_MS) break;
            const genres = j.genre === 'H' || j.genre === 'F' ? [j.genre] : ['H', 'F'];
            let trouves: Joueur[] = [];
            for (const sexe of genres) {
                const corps = j.fft_id_crm ? { sexe, idCrm: Number(j.fft_id_crm) } : { sexe, nom: j.nom, prenom: j.prenom };
                const r = await tenup(corps);
                await pause(PAUSE_MS);
                trouves = (r.joueurs ?? []).filter((x) => x.utilisateurRecherche && x.nom).map((x) => ({ ...x, sexe }));
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

        const e1 = await db.rpc('fft_enregistrer_tenup', { p_mois: mois, p_lignes: lignes });
        if (e1.error) throw new Error(e1.error.message);
        const e2 = await db.rpc('fft_appliquer_verifications', { p_mois: mois, p_resultats: resultats });
        if (e2.error) throw new Error(e2.error.message);
        return json({ mois, verifies: resultats.length, bilan: e2.data, duree_s: Math.round((Date.now() - debut) / 1000) });
    } catch (e) {
        console.error(String(e));
        return json({ erreur: String(e) }, 502);
    } finally {
        await db.rpc('fft_tache_liberer', { p_nom: 'verification' });
    }
});
