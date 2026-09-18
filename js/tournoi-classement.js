/* ============================================
   CLASSEMENT DE POULE
   Source unique partagée par l'admin, la page joueurs et la page TV.
   Aucun DOM, aucune dépendance réseau : testable en isolation.
   ============================================ */
(function (root) {
    'use strict';

    // Barème officiel FFT (tournois homologués)
    var PTS_VICTOIRE          = 2;
    var PTS_DEFAITE           = 1;
    var PTS_DISQUALIFICATION  = -1;
    var PTS_WO                = -2;

    var SPLITTER = /[\s,\/;]+/;

    // "6" ou "6(4)" -> 6 ; null/vide/non numérique -> NaN
    function manche(raw) {
        if (raw == null) return NaN;
        var m = String(raw).match(/^(\d+)/);
        return m ? parseInt(m[1], 10) : NaN;
    }

    function decoupeScore(raw) {
        return String(raw == null ? '' : raw).trim().split(SPLITTER).filter(Boolean);
    }

    function statsVides(id, nom) {
        return {
            id: id, nom: nom,
            mj: 0, v: 0, d: 0,
            sg: 0, sp: 0, jg: 0, jp: 0,
            pts: 0
        };
    }

    /**
     * Points marqués par le perdant d'un match selon son issue.
     * Le vainqueur marque toujours PTS_VICTOIRE.
     */
    function pointsPerdant(issue) {
        if (issue === 'wo') return PTS_WO;
        if (issue === 'disqualification') return PTS_DISQUALIFICATION;
        return PTS_DEFAITE;
    }

    /**
     * Agrège les matchs terminés d'une poule.
     * @param {Array} equipesPoule  [{id, nom}] équipes rattachées à la poule
     * @param {Array} matchsPoule   matchs terminés de la poule
     * @param {boolean} compteSets  le format de score comporte-t-il des sets/jeux ?
     * @param {Function} [nomPourId] résout le nom d'une équipe absente de equipesPoule
     * @returns {{stats:Object, confrontations:Object}}
     *   confrontations[idA][idB] = { v, d, sg, sp, jg, jp } du point de vue de idA
     */
    function agreger(equipesPoule, matchsPoule, compteSets, nomPourId) {
        var stats = {};
        var confrontations = {};

        equipesPoule.forEach(function (e) {
            stats[e.id] = statsVides(e.id, e.nom);
        });

        // Une équipe déplacée de poule peut garder un match terminé ici : on lui
        // crée quand même une ligne, sinon des matchs seraient silencieusement ignorés.
        function ajouterOrpheline(eqId) {
            if (!eqId || stats[eqId]) return;
            var nom = nomPourId ? nomPourId(eqId) : null;
            if (!nom) return;
            stats[eqId] = statsVides(eqId, nom);
            stats[eqId].orpheline = true;
        }

        function duel(idA, idB) {
            if (!confrontations[idA]) confrontations[idA] = {};
            if (!confrontations[idA][idB]) {
                confrontations[idA][idB] = { v: 0, d: 0, sg: 0, sp: 0, jg: 0, jp: 0 };
            }
            return confrontations[idA][idB];
        }

        matchsPoule.forEach(function (m) {
            ajouterOrpheline(m.equipe_a_id);
            ajouterOrpheline(m.equipe_b_id);
            var sa = stats[m.equipe_a_id], sb = stats[m.equipe_b_id];
            if (!sa || !sb) return;

            var dAB = duel(sa.id, sb.id);
            var dBA = duel(sb.id, sa.id);

            sa.mj++; sb.mj++;

            var issue = m.issue || 'normal';
            if (m.vainqueur_id === sa.id) {
                sa.v++; sb.d++;
                sa.pts += PTS_VICTOIRE; sb.pts += pointsPerdant(issue);
                dAB.v++; dBA.d++;
            } else if (m.vainqueur_id === sb.id) {
                sb.v++; sa.d++;
                sb.pts += PTS_VICTOIRE; sa.pts += pointsPerdant(issue);
                dBA.v++; dAB.d++;
            }

            // Sur WO / disqualification, aucun set ni jeu n'entre dans le départage :
            // le match n'a pas été joué (ou pas à son terme).
            if (!compteSets || issue !== 'normal') return;

            var aArr = decoupeScore(m.score_a);
            var bArr = decoupeScore(m.score_b);
            var n = Math.min(aArr.length, bArr.length);
            for (var i = 0; i < n; i++) {
                var a = manche(aArr[i]), b = manche(bArr[i]);
                if (isNaN(a) || isNaN(b)) continue;
                sa.jg += a; sa.jp += b;
                sb.jg += b; sb.jp += a;
                dAB.jg += a; dAB.jp += b;
                dBA.jg += b; dBA.jp += a;
                if (a > b)      { sa.sg++; sb.sp++; dAB.sg++; dBA.sp++; }
                else if (b > a) { sb.sg++; sa.sp++; dBA.sg++; dAB.sp++; }
            }
        });

        return { stats: stats, confrontations: confrontations };
    }

    /* ---------- départage ---------- */

    // Somme des sets/jeux d'un groupe d'équipes, restreinte à leurs matchs entre elles.
    function statsEntreEquipes(ids, confrontations) {
        var out = {};
        ids.forEach(function (id) {
            var acc = { sg: 0, sp: 0, jg: 0, jp: 0 };
            var duels = confrontations[id] || {};
            ids.forEach(function (autre) {
                if (autre === id) return;
                var d = duels[autre];
                if (!d) return;
                acc.sg += d.sg; acc.sp += d.sp;
                acc.jg += d.jg; acc.jp += d.jp;
            });
            out[id] = acc;
        });
        return out;
    }

    /**
     * Ordonne un groupe de paires à égalité de points.
     *
     * Guide de la compétition padel FFT, chapitre I (MAJ février 2026),
     * « Etats des résultats et classement des poules » — texte officiel :
     *
     *   « En cas d'égalité de points entre 2 ou plusieurs paires ou équipes, leur
     *     classement est établi en tenant compte, pour toutes les parties de la poule :
     *       • De la différence du nombre de sets gagnés et perdus par chacune d'elles
     *       • Puis, en cas de nouvelle égalité, de la différence du nombre de jeux
     *         gagnés et perdus par chacune d'elles
     *       • Ensuite, en cas de nouvelle égalité par l'application successive des
     *         2 méthodes ci-dessus, aux seuls résultats des parties ayant opposé les
     *         paires ou équipes à départager
     *       • En cas de nouvelle égalité, les paires ou équipes seront départagées
     *         par un tirage au sort. »
     *
     * Deux points que le texte tranche et qu'on applique tels quels :
     *   - la cascade est la MÊME à 2 paires qu'à 3 ou plus : le règlement écrit
     *     « entre 2 ou plusieurs paires » et ne prévoit pas de confrontation
     *     directe prioritaire à 2 ;
     *   - aux étapes 1 et 2 on compte « toutes les parties de la poule », y compris
     *     celles jouées contre des paires hors de l'égalité. Le périmètre n'est
     *     restreint aux paires à départager qu'aux étapes 3 et 4.
     *
     * L'égalité persistante se règle par tirage au sort, qui relève du juge-arbitre :
     * le moteur la signale via le drapeau .tirageRequis plutôt que de la trancher
     * lui-même sur un critère arbitraire.
     *
     * @returns {Array} le groupe ordonné (lignes de stats)
     */
    function departager(groupe, confrontations) {
        if (groupe.length <= 1) return groupe.slice();

        var ids = groupe.map(function (l) { return l.id; });
        var restreint = statsEntreEquipes(ids, confrontations);

        var criteres = [
            function (l) { return l.sg - l.sp; },                          // 1. ±sets, toute la poule
            function (l) { return l.jg - l.jp; },                          // 2. ±jeux, toute la poule
            function (l) { var r = restreint[l.id]; return r.sg - r.sp; }, // 3. ±sets, entre ex æquo
            function (l) { var r = restreint[l.id]; return r.jg - r.jp; }  // 4. ±jeux, entre ex æquo
        ];

        return appliquerCriteres(groupe, criteres, 0);
    }

    /**
     * Applique les critères de départage l'un après l'autre. Chaque critère
     * resegmente le groupe ; les sous-groupes encore à égalité passent au critère
     * suivant. Les paires encore à égalité après les 4 critères sont marquées
     * .tirageRequis : le règlement impose alors un tirage au sort du juge-arbitre.
     */
    function appliquerCriteres(groupe, criteres, idx) {
        if (groupe.length <= 1) return groupe.slice();

        if (idx >= criteres.length) {
            // Départage épuisé : seul un tirage au sort peut trancher (règlement FFT).
            // On garde un ordre stable pour l'affichage, mais on signale le tirage.
            var restant = groupe.slice().sort(function (a, b) {
                return a.nom.localeCompare(b.nom, 'fr');
            });
            restant.forEach(function (l) { l.tirageRequis = true; });
            return restant;
        }

        var critere = criteres[idx];
        var trie = groupe.slice().sort(function (a, b) { return critere(b) - critere(a); });

        var out = [];
        var i = 0;
        while (i < trie.length) {
            var j = i + 1;
            while (j < trie.length && critere(trie[j]) === critere(trie[i])) j++;
            var bloc = trie.slice(i, j);
            if (bloc.length === 1) {
                out.push(bloc[0]);
            } else {
                out = out.concat(appliquerCriteres(bloc, criteres, idx + 1));
            }
            i = j;
        }
        return out;
    }

    /* ---------- API ---------- */

    /**
     * Classement d'une poule.
     * @param {Object} opts
     *   - equipes     : [{id, nom}] équipes de la poule
     *   - matchs      : matchs TERMINÉS de la poule
     *   - compteSets  : le format de score comporte-t-il des sets/jeux ?
     *   - homologue   : appliquer le barème + départage FFT (sinon tri historique)
     *   - nomPourId   : (optionnel) résout le nom d'une équipe hors poule
     * @returns {Array} lignes triées, chacune avec .pos (1 = 1er)
     */
    function classerPoule(opts) {
        var compteSets = !!opts.compteSets;
        var agg = agreger(opts.equipes || [], opts.matchs || [], compteSets, opts.nomPourId);
        var lignes = Object.keys(agg.stats).map(function (k) { return agg.stats[k]; });

        if (!opts.homologue) {
            // Tri historique : victoires > ±sets > ±jeux > nom.
            lignes.sort(function (a, b) {
                if (b.v !== a.v) return b.v - a.v;
                var dsA = a.sg - a.sp, dsB = b.sg - b.sp;
                if (dsB !== dsA) return dsB - dsA;
                var djA = a.jg - a.jp, djB = b.jg - b.jp;
                if (djB !== djA) return djB - djA;
                return a.nom.localeCompare(b.nom, 'fr');
            });
        } else {
            // Barème FFT : on groupe par total de points, puis on départage chaque groupe.
            lignes.sort(function (a, b) { return b.pts - a.pts; });
            var ordonne = [];
            var i = 0;
            while (i < lignes.length) {
                var j = i + 1;
                while (j < lignes.length && lignes[j].pts === lignes[i].pts) j++;
                ordonne = ordonne.concat(departager(lignes.slice(i, j), agg.confrontations));
                i = j;
            }
            lignes = ordonne;
        }

        lignes.forEach(function (l, idx) { l.pos = idx + 1; });
        return lignes;
    }

    var api = {
        classerPoule: classerPoule,
        departager: departager,
        manche: manche,
        BAREME: {
            victoire: PTS_VICTOIRE,
            defaite: PTS_DEFAITE,
            disqualification: PTS_DISQUALIFICATION,
            wo: PTS_WO
        }
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.TournoiClassement = api;

})(typeof window !== 'undefined' ? window : globalThis);
