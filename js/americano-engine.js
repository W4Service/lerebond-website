/* ============================================
   AMERICANO ENGINE
   Génération de la grille de tours + calcul du classement.
   Aucun DOM, aucune dépendance : testable en isolation (Node ou navigateur).
   ============================================ */
(function (root) {
    'use strict';

    // Poids de la fonction de coût (cf. spécification)
    var W_PARTENAIRE = 10;  // avoir déjà été partenaire
    var W_ADVERSAIRE = 3;   // avoir déjà été adversaire
    var W_REPOS      = 20;  // déséquilibre de repos

    var TIRAGES_PAR_TOUR = 4000;

    /* ---------- utilitaires ---------- */

    function shuffle(arr, rng) {
        var a = arr.slice();
        for (var i = a.length - 1; i > 0; i--) {
            var j = Math.floor(rng() * (i + 1));
            var t = a[i]; a[i] = a[j]; a[j] = t;
        }
        return a;
    }

    // RNG déterministe (mulberry32) : une même seed regénère la même grille.
    function makeRng(seed) {
        var s = seed >>> 0;
        return function () {
            s = (s + 0x6D2B79F5) >>> 0;
            var t = Math.imul(s ^ (s >>> 15), 1 | s);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function matriceVide(n) {
        var m = [];
        for (var i = 0; i < n; i++) {
            var row = [];
            for (var j = 0; j < n; j++) row.push(0);
            m.push(row);
        }
        return m;
    }

    /**
     * Nombre de joueurs qui jouent à un tour donné.
     * Places = 4 × terrains, plafonné par le nombre de groupes de 4 possibles.
     */
    function placesParTour(nbJoueurs, nbTerrains) {
        return Math.min(4 * nbTerrains, 4 * Math.floor(nbJoueurs / 4));
    }

    /**
     * Choisit les joueurs au repos pour un tour.
     * File rotative : repos prioritaire à ceux qui ont le plus joué.
     * Garantit que l'écart max de tours joués ne dépasse jamais 1, puisque
     * l'on retire toujours les joueurs les plus avancés en nombre de matchs.
     */
    function choisirRepos(nbJoueurs, places, toursJoues, dernierRepos, rng) {
        var nbRepos = nbJoueurs - places;
        if (nbRepos <= 0) return [];

        var ids = [];
        for (var i = 0; i < nbJoueurs; i++) ids.push(i);

        // Ordre : plus de tours joués d'abord ; à égalité, celui qui s'est
        // reposé le moins récemment passe en dernier (équité) ; puis aléatoire.
        ids = shuffle(ids, rng);
        ids.sort(function (a, b) {
            if (toursJoues[b] !== toursJoues[a]) return toursJoues[b] - toursJoues[a];
            return dernierRepos[a] - dernierRepos[b];
        });

        return ids.slice(0, nbRepos).sort(function (a, b) { return a - b; });
    }

    /**
     * Coût d'un découpage en matchs.
     * quatuors : liste de [a1,a2,b1,b2]
     */
    function coutTour(quatuors, matPart, matAdv) {
        var cout = 0;
        for (var k = 0; k < quatuors.length; k++) {
            var q = quatuors[k];
            var a1 = q[0], a2 = q[1], b1 = q[2], b2 = q[3];
            // Partenaires
            cout += W_PARTENAIRE * matPart[a1][a2];
            cout += W_PARTENAIRE * matPart[b1][b2];
            // Adversaires (4 croisements)
            cout += W_ADVERSAIRE * (matAdv[a1][b1] + matAdv[a1][b2] + matAdv[a2][b1] + matAdv[a2][b2]);
        }
        return cout;
    }

    /**
     * Génère la grille complète d'un tournoi.
     * @param {number} nbJoueurs
     * @param {number} nbTerrains
     * @param {number} nbTours
     * @param {number} [seed]
     * @returns {Array} tours : [{ tour, matchs:[{terrain,a1,a2,b1,b2}], repos:[idx] }]
     *          Les indices renvoyés sont les index joueurs 0..N-1.
     */
    function genererGrille(nbJoueurs, nbTerrains, nbTours, seed) {
        var rng = makeRng(typeof seed === 'number' ? seed : (Date.now() & 0x7fffffff));

        var places = placesParTour(nbJoueurs, nbTerrains);
        if (places < 4) return [];

        var nbMatchs = places / 4;

        var matPart = matriceVide(nbJoueurs);
        var matAdv  = matriceVide(nbJoueurs);
        var toursJoues = [];
        var dernierRepos = [];
        var i;
        for (i = 0; i < nbJoueurs; i++) { toursJoues.push(0); dernierRepos.push(-1); }

        var grille = [];

        for (var t = 1; t <= nbTours; t++) {
            var repos = choisirRepos(nbJoueurs, places, toursJoues, dernierRepos, rng);
            var reposSet = {};
            for (i = 0; i < repos.length; i++) reposSet[repos[i]] = true;

            var actifs = [];
            for (i = 0; i < nbJoueurs; i++) if (!reposSet[i]) actifs.push(i);

            // Pénalité de repos : un joueur en retard de tours joués ne doit pas
            // se retrouver au repos. choisirRepos le garantit déjà, mais on
            // conserve le terme de coût pour départager les tirages.
            var minJoues = Math.min.apply(null, toursJoues);
            var penaliteRepos = 0;
            for (i = 0; i < repos.length; i++) {
                penaliteRepos += W_REPOS * (toursJoues[repos[i]] - minJoues);
            }

            // Plusieurs milliers de tirages, on garde le meilleur.
            var meilleur = null;
            var meilleurCout = Infinity;

            for (var essai = 0; essai < TIRAGES_PAR_TOUR; essai++) {
                var melange = shuffle(actifs, rng);
                var quatuors = [];
                for (var m = 0; m < nbMatchs; m++) {
                    var base = m * 4;
                    quatuors.push([melange[base], melange[base + 1], melange[base + 2], melange[base + 3]]);
                }
                var c = coutTour(quatuors, matPart, matAdv);
                if (c < meilleurCout) {
                    meilleurCout = c;
                    meilleur = quatuors;
                    if (c === 0) break; // impossible de faire mieux
                }
            }

            // Mise à jour des matrices et des compteurs
            var matchs = [];
            for (var k = 0; k < meilleur.length; k++) {
                var q = meilleur[k];
                var a1 = q[0], a2 = q[1], b1 = q[2], b2 = q[3];

                matPart[a1][a2]++; matPart[a2][a1]++;
                matPart[b1][b2]++; matPart[b2][b1]++;
                var pairsAdv = [[a1, b1], [a1, b2], [a2, b1], [a2, b2]];
                for (var p = 0; p < pairsAdv.length; p++) {
                    var x = pairsAdv[p][0], y = pairsAdv[p][1];
                    matAdv[x][y]++; matAdv[y][x]++;
                }
                toursJoues[a1]++; toursJoues[a2]++; toursJoues[b1]++; toursJoues[b2]++;

                matchs.push({ terrain: k + 1, a1: a1, a2: a2, b1: b1, b2: b2 });
            }
            for (i = 0; i < repos.length; i++) dernierRepos[repos[i]] = t;

            grille.push({ tour: t, matchs: matchs, repos: repos, cout: meilleurCout + penaliteRepos });
        }

        return grille;
    }

    /**
     * Classement individuel.
     * @param {Array} joueurs  [{id, nom, ordre}]
     * @param {Array} matchs   [{tour, a1_id,a2_id,b1_id,b2_id, score_a, score_b, valide}]
     * @returns {{lignes:Array, memeNombreDeTours:boolean}}
     *   lignes triées ; chaque ligne : {id, nom, points, encaisses, diff, victoires,
     *   toursJoues, moyenne}
     */
    function calculerClassement(joueurs, matchs) {
        var stats = {};
        joueurs.forEach(function (j) {
            stats[j.id] = {
                id: j.id, nom: j.nom, points: 0, encaisses: 0,
                victoires: 0, toursJoues: 0
            };
        });

        matchs.forEach(function (m) {
            if (!m.valide) return;
            if (m.score_a === null || m.score_b === null ||
                m.score_a === undefined || m.score_b === undefined) return;

            var equipeA = [m.a1_id, m.a2_id];
            var equipeB = [m.b1_id, m.b2_id];

            equipeA.forEach(function (id) {
                var s = stats[id]; if (!s) return;
                s.points += m.score_a;
                s.encaisses += m.score_b;
                s.toursJoues++;
                if (m.score_a > m.score_b) s.victoires++;
            });
            equipeB.forEach(function (id) {
                var s = stats[id]; if (!s) return;
                s.points += m.score_b;
                s.encaisses += m.score_a;
                s.toursJoues++;
                if (m.score_b > m.score_a) s.victoires++;
            });
        });

        var lignes = Object.keys(stats).map(function (id) {
            var s = stats[id];
            s.diff = s.points - s.encaisses;
            s.moyenne = s.toursJoues > 0 ? s.points / s.toursJoues : 0;
            return s;
        });

        // Tous les joueurs ont-ils disputé le même nombre de tours ?
        var joues = lignes.map(function (l) { return l.toursJoues; });
        var memeNombreDeTours = joues.length === 0 ||
            (Math.max.apply(null, joues) === Math.min.apply(null, joues));

        // Si les tours joués diffèrent, on classe sur la MOYENNE par tour.
        lignes.sort(function (a, b) {
            if (memeNombreDeTours) {
                if (b.points !== a.points) return b.points - a.points;
            } else {
                if (b.moyenne !== a.moyenne) return b.moyenne - a.moyenne;
            }
            if (b.diff !== a.diff) return b.diff - a.diff;
            if (b.victoires !== a.victoires) return b.victoires - a.victoires;
            return a.nom.localeCompare(b.nom, 'fr');
        });

        return { lignes: lignes, memeNombreDeTours: memeNombreDeTours };
    }

    var api = {
        genererGrille: genererGrille,
        calculerClassement: calculerClassement,
        placesParTour: placesParTour,
        POIDS: { partenaire: W_PARTENAIRE, adversaire: W_ADVERSAIRE, repos: W_REPOS }
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.AmericanoEngine = api;

})(typeof window !== 'undefined' ? window : globalThis);
