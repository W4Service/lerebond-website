/* ============================================
   TABLEAU DE 16 À ENTRÉES ÉCHELONNÉES

   28 matchs, classement complet de 1 à 16, chaque paire jouant au moins 3
   matchs — le minimum imposé par le Guide de la compétition padel (I.2 :
   « Quelle que soit la formule sportive choisie, 3 matchs minimum doivent être
   programmés pour chaque paire »), qui nomme aussi le « tableau à entrées
   échelonnées » parmi les formules possibles.

   Entrées échelonnées : les paires ne commencent pas toutes au même tour.
     - positions 1 à 8   : entrent en 16es
     - positions 9 à 12  : entrent en 8es, face aux vainqueurs des 16es
     - positions 13 à 16 : entrent en quarts, face aux vainqueurs des 8es
   Les meilleures paires occupent les dernières positions : elles sont donc
   exemptées des premiers tours, conformément au principe d'exemption des
   meilleures paires.

   Tout perdant repart dans un tableau de classement de son niveau, jusqu'à sa
   place exacte : personne ne sort du tournoi sans être classé.

   Aucun DOM, aucun réseau : testable en isolation.
   ============================================ */
(function (root) {
    'use strict';

    // Les 28 matchs. `a` et `b` désignent soit une position d'entrée
    // (['T', n]), soit le gagnant/perdant d'un autre match (['W'|'L', id]).
    // `place` : match de classement, le vainqueur prend cette place, le perdant
    // la suivante.
    var MATCHS = [
        // Tableau principal
        { id: 'H1', lib: '16e de finale 1', bracket: 'principal',  a: ['T', 1],  b: ['T', 2] },
        { id: 'H2', lib: '16e de finale 2', bracket: 'principal',  a: ['T', 3],  b: ['T', 4] },
        { id: 'H3', lib: '16e de finale 3', bracket: 'principal',  a: ['T', 5],  b: ['T', 6] },
        { id: 'H4', lib: '16e de finale 4', bracket: 'principal',  a: ['T', 7],  b: ['T', 8] },
        { id: 'O1', lib: '8e de finale 1',  bracket: 'principal',  a: ['W', 'H1'], b: ['T', 9] },
        { id: 'O2', lib: '8e de finale 2',  bracket: 'principal',  a: ['W', 'H2'], b: ['T', 10] },
        { id: 'O3', lib: '8e de finale 3',  bracket: 'principal',  a: ['W', 'H3'], b: ['T', 11] },
        { id: 'O4', lib: '8e de finale 4',  bracket: 'principal',  a: ['W', 'H4'], b: ['T', 12] },
        { id: 'Q1', lib: 'Quart 1',         bracket: 'principal',  a: ['W', 'O1'], b: ['T', 13] },
        { id: 'Q2', lib: 'Quart 2',         bracket: 'principal',  a: ['W', 'O2'], b: ['T', 14] },
        { id: 'Q3', lib: 'Quart 3',         bracket: 'principal',  a: ['W', 'O3'], b: ['T', 15] },
        { id: 'Q4', lib: 'Quart 4',         bracket: 'principal',  a: ['W', 'O4'], b: ['T', 16] },
        { id: 'S1', lib: 'Demi-finale 1',   bracket: 'principal',  a: ['W', 'Q1'], b: ['W', 'Q2'] },
        { id: 'S2', lib: 'Demi-finale 2',   bracket: 'principal',  a: ['W', 'Q3'], b: ['W', 'Q4'] },
        { id: 'F',  lib: 'Finale',          bracket: 'places_1_2', a: ['W', 'S1'], b: ['W', 'S2'], place: 1 },
        { id: 'P3', lib: 'Match 3e place',  bracket: 'places_3_4', a: ['L', 'S1'], b: ['L', 'S2'], place: 3 },

        // Classement 5-8 : les perdants de quart
        { id: 'C5a', lib: 'Classement 5-8 A', bracket: 'consolation_5_8', a: ['L', 'Q1'], b: ['L', 'Q2'] },
        { id: 'C5b', lib: 'Classement 5-8 B', bracket: 'consolation_5_8', a: ['L', 'Q3'], b: ['L', 'Q4'] },
        { id: 'P5',  lib: 'Match 5e place',   bracket: 'places_5_6', a: ['W', 'C5a'], b: ['W', 'C5b'], place: 5 },
        { id: 'P7',  lib: 'Match 7e place',   bracket: 'places_7_8', a: ['L', 'C5a'], b: ['L', 'C5b'], place: 7 },

        // Classement 9-12 : les perdants des 8es
        { id: 'C9a', lib: 'Classement 9-12 A', bracket: 'consolation_9_12', a: ['L', 'O1'], b: ['L', 'O2'] },
        { id: 'C9b', lib: 'Classement 9-12 B', bracket: 'consolation_9_12', a: ['L', 'O3'], b: ['L', 'O4'] },
        { id: 'P9',  lib: 'Match 9e place',    bracket: 'places_9_10',  a: ['W', 'C9a'], b: ['W', 'C9b'], place: 9 },
        { id: 'P11', lib: 'Match 11e place',   bracket: 'places_11_12', a: ['L', 'C9a'], b: ['L', 'C9b'], place: 11 },

        // Classement 13-16 : les perdants des 16es
        { id: 'C13a', lib: 'Classement 13-16 A', bracket: 'consolation_13_16', a: ['L', 'H1'], b: ['L', 'H2'] },
        { id: 'C13b', lib: 'Classement 13-16 B', bracket: 'consolation_13_16', a: ['L', 'H3'], b: ['L', 'H4'] },
        { id: 'P13',  lib: 'Match 13e place',    bracket: 'places_13_14', a: ['W', 'C13a'], b: ['W', 'C13b'], place: 13 },
        { id: 'P15',  lib: 'Match 15e place',    bracket: 'places_15_16', a: ['L', 'C13a'], b: ['L', 'C13b'], place: 15 }
    ];

    // Ordre de priorité de programmation : chaque tour de classement suit le
    // tour du tableau principal dont il dépend, pour que les équipes éliminées
    // n'attendent pas la fin du tournoi pour jouer leur match de classement.
    var PRIORITE = ('H1,H2,H3,H4,C13a,O1,O2,C13b,O3,O4,C9a,Q1,Q2,P15,Q3,Q4,'
                  + 'P13,C9b,C5a,C5b,S1,S2,P9,P11,P3,P5,P7,F').split(',');

    function parId() {
        var m = {};
        MATCHS.forEach(function (x) { m[x.id] = x; });
        return m;
    }

    // Matchs dont dépend un match donné.
    function dependances(match) {
        return [match.a, match.b]
            .filter(function (s) { return s[0] === 'W' || s[0] === 'L'; })
            .map(function (s) { return s[1]; });
    }

    /**
     * Programme les 28 matchs sur des créneaux et des terrains.
     *
     * Algorithme glouton : créneau par créneau, on place les matchs prêts dans
     * l'ordre de priorité, tant qu'il reste un terrain libre.
     *
     * « Prêt » = tous les matchs dont il dépend ont eu lieu au moins
     * `reposCreneaux + 1` créneaux plus tôt. Avec reposCreneaux = 1, un match
     * dépendant d'un match du créneau 0 ne peut pas être placé avant le
     * créneau 2 : l'équipe qui enchaîne a un créneau de pause. Sans ça, elle
     * jouerait deux matchs d'affilée.
     *
     * La finale est sortie de la boucle et placée seule sur le dernier créneau :
     * c'est le match qu'on veut voir, on ne le met pas en concurrence avec un
     * match de classement.
     *
     * @param {Object} opts { nbTerrains, reposCreneaux }
     * @returns {Object} id -> { creneau, terrain }
     */
    function programmer(opts) {
        opts = opts || {};
        var nbTerrains = opts.nbTerrains || 3;
        var repos = opts.reposCreneaux == null ? 1 : opts.reposCreneaux;
        var ecart = repos + 1;   // créneaux minimum entre un match et sa dépendance
        var index = parId();

        var creneau = {}, terrain = {};
        var reste = PRIORITE.filter(function (id) { return id !== 'F'; });

        // Borne de sécurité : sans elle, une dépendance circulaire (erreur de
        // saisie dans MATCHS) ferait tourner la boucle indéfiniment.
        for (var s = 0; s < 100 && reste.length; s++) {
            var poses = [];
            for (var i = 0; i < reste.length && poses.length < nbTerrains; i++) {
                var id = reste[i];
                var pret = dependances(index[id]).every(function (d) {
                    return creneau[d] != null && creneau[d] <= s - ecart;
                });
                if (pret) poses.push(id);
            }
            poses.forEach(function (id, k) { creneau[id] = s; terrain[id] = k + 1; });
            reste = reste.filter(function (id) { return poses.indexOf(id) < 0; });
        }
        if (reste.length) throw new Error('programmation impossible : ' + reste.join(','));

        var dernier = Math.max.apply(null, Object.keys(creneau).map(function (k) { return creneau[k]; }));
        var minFinale = Math.max(creneau.S1, creneau.S2) + ecart;
        creneau.F = Math.max(dernier + 1, minFinale);
        terrain.F = 1;

        var out = {};
        Object.keys(creneau).forEach(function (id) {
            out[id] = { creneau: creneau[id], terrain: terrain[id] };
        });
        return out;
    }

    /**
     * Construit les 28 matchs prêts à être écrits en base.
     *
     * @param {Array} ordre  16 identifiants d'équipe, de la position 1 à 16
     * @param {Object} opts  { nbTerrains, reposCreneaux }
     * @returns {Array} [{ ref, lib, bracket, ordre, creneau, terrain,
     *                     equipe_a_id, equipe_b_id, srcA, srcB, place }]
     *   srcA/srcB : { ref, type } quand l'équipe vient d'un autre match.
     *   `ref` est l'identifiant interne (H1, C5a…), à traduire en id de match
     *   une fois les lignes insérées.
     */
    function construire(ordre, opts) {
        if (!ordre || ordre.length !== 16) {
            throw new Error('il faut exactement 16 équipes, reçu ' + (ordre ? ordre.length : 0));
        }
        var vus = {};
        ordre.forEach(function (id) {
            if (!id) throw new Error('position vide dans l\'ordre des équipes');
            if (vus[id]) throw new Error('équipe en double dans l\'ordre : ' + id);
            vus[id] = true;
        });

        var plan = programmer(opts);
        var face = function (src) {
            if (src[0] === 'T') return { equipe: ordre[src[1] - 1] };
            return { src: { ref: src[1], type: src[0] === 'W' ? 'gagnant' : 'perdant' } };
        };

        return MATCHS.map(function (m, i) {
            var A = face(m.a), B = face(m.b);
            return {
                ref: m.id,
                lib: m.lib,
                bracket: m.bracket,
                ordre: i,
                creneau: plan[m.id].creneau,
                terrain: plan[m.id].terrain,
                equipe_a_id: A.equipe || null,
                equipe_b_id: B.equipe || null,
                srcA: A.src || null,
                srcB: B.src || null,
                place: m.place || null
            };
        });
    }

    /**
     * Heure de convocation de chaque équipe : son premier match moins le délai.
     * @returns {Array} [{ position, creneau, minutesAvantDebut }]
     */
    function convocations(opts) {
        opts = opts || {};
        var avance = opts.minutesAvance == null ? 15 : opts.minutesAvance;
        var dureeMatch = opts.dureeMatch || 45;
        var plan = programmer(opts);

        var premier = {};
        MATCHS.forEach(function (m) {
            [m.a, m.b].forEach(function (s) {
                if (s[0] !== 'T') return;
                var pos = s[1];
                var c = plan[m.id].creneau;
                if (premier[pos] == null || c < premier[pos]) premier[pos] = c;
            });
        });

        var out = [];
        for (var pos = 1; pos <= 16; pos++) {
            out.push({
                position: pos,
                creneau: premier[pos],
                minutesAvantDebut: premier[pos] * dureeMatch - avance
            });
        }
        return out;
    }

    // Libellé de provenance, tant que l'équipe n'est pas connue : « Vainqueur
    // 16e de finale 1 », « Perdant Quart 2 ». Afficher « ? » n'apprendrait rien
    // au joueur qui cherche son prochain match sur le planning.
    function libelleProvenance(ref, type) {
        var index = parId();
        var m = index[ref];
        if (!m) return '?';
        return (type === 'gagnant' ? 'Vainqueur ' : 'Perdant ') + m.lib;
    }

    var api = {
        MATCHS: MATCHS,
        PRIORITE: PRIORITE,
        construire: construire,
        programmer: programmer,
        convocations: convocations,
        dependances: dependances,
        libelleProvenance: libelleProvenance
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.TournoiTableau16 = api;

})(typeof window !== 'undefined' ? window : globalThis);
