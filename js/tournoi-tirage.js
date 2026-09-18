/* ============================================
   TIRAGE AU SORT
   Placement des têtes de série + tirage des autres paires.
   Déterministe : une même graine régénère exactement le même tirage, ce qui
   permet de rejouer un tirage contesté et de vérifier qu'il n'a pas été forcé.
   Aucun DOM, aucune dépendance réseau : testable en isolation.
   ============================================ */
(function (root) {
    'use strict';

    // RNG déterministe (mulberry32). Math.random() ne convient pas ici : un tirage
    // officiel doit pouvoir être reproduit à l'identique à partir de sa graine.
    function makeRng(seed) {
        var s = seed >>> 0;
        return function () {
            s = (s + 0x6D2B79F5) >>> 0;
            var t = Math.imul(s ^ (s >>> 15), 1 | s);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    // Mélange de Fisher-Yates, piloté par le RNG fourni.
    function melanger(liste, rng) {
        var a = liste.slice();
        for (var i = a.length - 1; i > 0; i--) {
            var j = Math.floor(rng() * (i + 1));
            var t = a[i]; a[i] = a[j]; a[j] = t;
        }
        return a;
    }

    /**
     * Prépare un tirage de poules.
     *
     * Principe du tirage réglementaire :
     *   - les têtes de série ne sont PAS tirées au sort : elles sont placées d'office
     *     selon leur classement, une par poule (TS1 en poule A, TS2 en B, etc.) ;
     *   - les paires restantes sont tirées au sort et réparties dans les poules.
     *
     * @param {Object} opts
     *   - equipes    : [{id, nom}] triées de la plus forte à la plus faible
     *   - nbPoules   : nombre de poules à composer
     *   - nbTS       : nombre de têtes de série placées d'office
     *   - nbHorsPoule: paires exemptées de poule (formats à TS exemptées)
     *   - taillePoules: [n, n, ...] taille cible de chaque poule
     *   - seed       : graine du tirage
     * @returns {{seed, etapes:[], placements:{equipeId: pouleIndex|null}}}
     *   etapes : la séquence à jouer à l'écran, dans l'ordre
     */
    function preparerTirage(opts) {
        var equipes = opts.equipes || [];
        var nbPoules = opts.nbPoules || 0;
        var nbTS = opts.nbTS || 0;
        var nbHorsPoule = opts.nbHorsPoule || 0;
        var tailles = opts.taillePoules || [];
        var seed = typeof opts.seed === 'number' ? opts.seed : (Date.now() & 0x7fffffff);
        var rng = makeRng(seed);

        var etapes = [];
        var placements = {};
        var restant = tailles.slice();          // places encore libres par poule

        // --- 1. Les paires exemptées de poule (têtes de série des formats à TS) ---
        var exemptees = equipes.slice(0, nbHorsPoule);
        exemptees.forEach(function (eq, i) {
            placements[eq.id] = null;
            etapes.push({
                type: 'exempte',
                equipe_id: eq.id,
                nom: eq.nom,
                rang_ts: i + 1,
                poule: null,
                tire: false,
                motif: 'Tête de série n°' + (i + 1) + ' — exemptée de poule'
            });
        });

        var enPoule = equipes.slice(nbHorsPoule);

        // --- 2. Les têtes de série, placées d'office (pas de tirage) ---
        var ts = enPoule.slice(0, nbTS);
        ts.forEach(function (eq, i) {
            var pouleIdx = i % nbPoules;
            placements[eq.id] = pouleIdx;
            restant[pouleIdx]--;
            etapes.push({
                type: 'tete_de_serie',
                equipe_id: eq.id,
                nom: eq.nom,
                rang_ts: nbHorsPoule + i + 1,
                poule: pouleIdx,
                tire: false,
                motif: 'Tête de série n°' + (i + 1) + ' — placée d\'office'
            });
        });

        // --- 3. Les autres paires, tirées au sort ---
        // Chaque paire tirée va dans la poule ayant le plus de places libres, ce qui
        // garantit des poules équilibrées sans rendre le tirage prévisible.
        var autres = melanger(enPoule.slice(nbTS), rng);
        autres.forEach(function (eq) {
            var meilleur = -1, maxLibre = -1;
            for (var p = 0; p < nbPoules; p++) {
                if (restant[p] > maxLibre) { maxLibre = restant[p]; meilleur = p; }
            }
            placements[eq.id] = meilleur;
            restant[meilleur]--;
            etapes.push({
                type: 'tirage',
                equipe_id: eq.id,
                nom: eq.nom,
                poule: meilleur,
                tire: true,
                motif: 'Tirée au sort'
            });
        });

        return { seed: seed, etapes: etapes, placements: placements };
    }

    /**
     * Rejoue un tirage à partir de sa graine et vérifie qu'il redonne le même
     * résultat. Sert à contrôler un tirage contesté.
     * @returns {boolean} true si le tirage rejoué est identique
     */
    function verifierTirage(opts, placementsAttendus) {
        var rejoue = preparerTirage(opts);
        var ids = Object.keys(placementsAttendus);
        if (ids.length !== Object.keys(rejoue.placements).length) return false;
        for (var i = 0; i < ids.length; i++) {
            if (rejoue.placements[ids[i]] !== placementsAttendus[ids[i]]) return false;
        }
        return true;
    }

    var api = {
        preparerTirage: preparerTirage,
        verifierTirage: verifierTirage,
        melanger: melanger,
        makeRng: makeRng
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.TournoiTirage = api;

})(typeof window !== 'undefined' ? window : globalThis);
