/* ============================================
   AMERICANO — Lecture publique (partagé)
   Charge le tournoi en cours et expose un état prêt à afficher.
   Utilisé par la vue joueurs (/live/), la TV (/tv/) et le timer (/tv/timer/).
   Lecture seule : aucune écriture en base.
   ============================================ */
(function (root) {
    'use strict';

    var supa = root.LeRebondSupa;

    var etat = {
        tournoi: null,
        joueurs: [],
        matchs: [],
        chargé: false,
        erreur: null
    };

    var abonnés = [];
    var pollTimer = null;

    function joueurNom(id) {
        for (var i = 0; i < etat.joueurs.length; i++) {
            if (etat.joueurs[i].id === id) return etat.joueurs[i].nom;
        }
        return '?';
    }

    /* Temps restant du tour, recalculé depuis l'état publié par le staff. */
    function chronoRestant() {
        var t = etat.tournoi;
        if (!t) return { restant: 0, total: 0, status: 'idle' };
        var total = (t.duree_tour_min || 0) * 60;
        var st = t.chrono_status || 'idle';

        if (st === 'running' && t.tour_demarre_a) {
            var ecoule = (Date.now() - new Date(t.tour_demarre_a).getTime()) / 1000;
            return { restant: Math.max(0, total - ecoule), total: total, status: 'running' };
        }
        if (st === 'paused') {
            var r = (t.chrono_restant !== null && t.chrono_restant !== undefined) ? t.chrono_restant : total;
            return { restant: Math.max(0, r), total: total, status: 'paused' };
        }
        if (st === 'finished') return { restant: 0, total: total, status: 'finished' };
        return { restant: total, total: total, status: 'idle' };
    }

    /* Matchs du tour courant, enrichis des noms. */
    function matchsDuTourCourant() {
        var t = etat.tournoi;
        if (!t) return [];
        return etat.matchs
            .filter(function (m) { return m.tour === t.tour_courant; })
            .sort(function (a, b) { return a.terrain - b.terrain; })
            .map(function (m) {
                return {
                    id: m.id, terrain: m.terrain,
                    equipeA: [joueurNom(m.a1_id), joueurNom(m.a2_id)],
                    equipeB: [joueurNom(m.b1_id), joueurNom(m.b2_id)],
                    scoreA: m.score_a, scoreB: m.score_b, valide: m.valide
                };
            });
    }

    /* Joueurs au repos sur le tour courant (depuis la grille figée). */
    function reposDuTourCourant() {
        var t = etat.tournoi;
        if (!t || !t.grille) return [];
        var entree = null;
        for (var i = 0; i < t.grille.length; i++) {
            if (t.grille[i].tour === t.tour_courant) entree = t.grille[i];
        }
        if (!entree || !entree.repos) return [];
        return entree.repos.map(function (ordre) {
            for (var j = 0; j < etat.joueurs.length; j++) {
                if (etat.joueurs[j].ordre === ordre) return etat.joueurs[j].nom;
            }
            return '?';
        });
    }

    function classement() {
        if (!root.AmericanoEngine) return { lignes: [], memeNombreDeTours: true };
        return root.AmericanoEngine.calculerClassement(etat.joueurs, etat.matchs);
    }

    /* Prochain tour (pour annoncer "ensuite") */
    function prochainTour() {
        var t = etat.tournoi;
        if (!t || !t.grille) return null;
        var suivant = t.tour_courant + 1;
        if (suivant > t.nb_tours) return null;
        var entree = null;
        for (var i = 0; i < t.grille.length; i++) if (t.grille[i].tour === suivant) entree = t.grille[i];
        if (!entree) return null;
        var parOrdre = {};
        etat.joueurs.forEach(function (j) { parOrdre[j.ordre] = j.nom; });
        return {
            tour: suivant,
            matchs: entree.matchs.map(function (m) {
                return {
                    terrain: m.terrain,
                    equipeA: [parOrdre[m.a1], parOrdre[m.a2]],
                    equipeB: [parOrdre[m.b1], parOrdre[m.b2]]
                };
            }),
            repos: (entree.repos || []).map(function (o) { return parOrdre[o]; })
        };
    }

    async function charger() {
        if (!supa) { etat.erreur = 'Supabase non initialisé'; notifier(); return; }

        var resT = await supa.from('americano_tournois')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(1);

        if (resT.error) { etat.erreur = resT.error.message; notifier(); return; }
        if (!resT.data || !resT.data.length) {
            etat.tournoi = null; etat.joueurs = []; etat.matchs = [];
            etat.chargé = true; etat.erreur = null;
            notifier(); return;
        }

        etat.tournoi = resT.data[0];

        var r = await Promise.all([
            supa.from('americano_joueurs').select('*').eq('tournoi_id', etat.tournoi.id).order('ordre'),
            supa.from('americano_matchs').select('*').eq('tournoi_id', etat.tournoi.id).order('tour').order('terrain')
        ]);
        etat.joueurs = r[0].data || [];
        etat.matchs = r[1].data || [];
        etat.chargé = true;
        etat.erreur = null;
        notifier();
    }

    function notifier() {
        abonnés.forEach(function (fn) {
            try { fn(etat); } catch (e) { console.error('[americano-public]', e); }
        });
    }

    /* Realtime si disponible, sinon polling. On garde le polling en filet
       de sécurité : une TV doit se rattraper même si le socket tombe. */
    function demarrer(intervalMs) {
        charger();

        if (supa && typeof supa.channel === 'function') {
            try {
                supa.channel('americano-public')
                    .on('postgres_changes', { event: '*', schema: 'public', table: 'americano_tournois' }, charger)
                    .on('postgres_changes', { event: '*', schema: 'public', table: 'americano_matchs' }, charger)
                    .subscribe();
            } catch (e) { /* realtime indisponible : le polling suffit */ }
        }

        if (pollTimer) clearInterval(pollTimer);
        pollTimer = setInterval(charger, intervalMs || 10000);
    }

    root.AmericanoPublic = {
        etat: etat,
        demarrer: demarrer,
        recharger: charger,
        onMaj: function (fn) { abonnés.push(fn); },
        chronoRestant: chronoRestant,
        matchsDuTourCourant: matchsDuTourCourant,
        reposDuTourCourant: reposDuTourCourant,
        prochainTour: prochainTour,
        classement: classement,
        joueurNom: joueurNom,
        fmtTemps: function (secs) {
            if (secs < 0) secs = 0;
            var m = Math.floor(secs / 60), s = Math.floor(secs % 60);
            return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
        }
    };

})(typeof window !== 'undefined' ? window : globalThis);
