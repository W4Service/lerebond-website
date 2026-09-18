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
     * Méthode « répartition par rang » (Guide de la compétition padel, chapitre I).
     *
     *   « on constitue autant de groupes qu'il y a de rangs ou positions dans les
     *     poules. Exemple : 4 poules de 4 paires ; les 16 paires sont classées par
     *     poids décroissant. Les paires 1 à 4 seront positionnées par tirage au
     *     sort au rang 1, les paires 5 à 8 positionnées par tirage au sort au
     *     rang 2, et ainsi de suite. »
     *
     * Autrement dit : les paires 1 à N (N = nombre de poules) forment le chapeau du
     * rang 1 et sont tirées au sort dans les poules ; les N suivantes forment le
     * chapeau du rang 2, etc. Contrairement au serpentin, l'ordre à l'intérieur d'un
     * chapeau est aléatoire — d'où « de nombreuses combinaisons tout en respectant
     * les forces des paires ».
     *
     * @returns {Array} chapeaux : [[equipe, ...], ...] un tableau par rang
     */
    function chapeauxParRang(equipes, nbPoules) {
        var chapeaux = [];
        for (var i = 0; i < equipes.length; i += nbPoules) {
            chapeaux.push(equipes.slice(i, i + nbPoules));
        }
        return chapeaux;
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
     *   - methode    : 'rang' (défaut, répartition par chapeaux tirés au sort)
     *                  ou 'serpentin' (placement imposé par le classement)
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

        // --- 2. Les têtes de série ---
        // Le règlement traite les TS différemment selon la méthode :
        //
        //   - « répartition par rang » : « les paires 1 à 4 seront positionnées PAR
        //     TIRAGE AU SORT au rang 1 ». Les TS forment le premier chapeau et sont
        //     donc tirées, comme les autres — seule leur poule d'arrivée est incertaine.
        //
        //   - « serpentin » : « positionnées OBLIGATOIREMENT de la manière suivante »,
        //     l'ordre est imposé par le classement. Les TS sont placées d'office.
        //
        // (À ne pas confondre avec la règle des tableaux — « seules les TS 1 et 2 sont
        //  placées de part et d'autre du Tableau » — qui vise les TDL/TEE, pas les poules.)
        var ts = enPoule.slice(0, nbTS);

        if (opts.methode === 'serpentin') {
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
                    motif: 'Tête de série n°' + (i + 1) + ' — placement imposé (serpentin)'
                });
            });
        } else {
            // Répartition par rang : un chapeau par rang de TS, tiré au sort.
            chapeauxParRang(ts, nbPoules).forEach(function (chapeau, iChap) {
                melanger(chapeau, rng).forEach(function (eq) {
                    var rangTS = enPoule.indexOf(eq) + nbHorsPoule + 1;
                    var meilleur = -1, maxLibre = -1;
                    for (var p = 0; p < nbPoules; p++) {
                        if (restant[p] > maxLibre) { maxLibre = restant[p]; meilleur = p; }
                    }
                    placements[eq.id] = meilleur;
                    restant[meilleur]--;
                    etapes.push({
                        type: 'tete_de_serie',
                        equipe_id: eq.id,
                        nom: eq.nom,
                        rang_ts: rangTS,
                        poule: meilleur,
                        chapeau: iChap + 1,
                        tire: true,
                        motif: 'Tête de série n°' + rangTS + ' — tirée au sort (chapeau ' + (iChap + 1) + ')'
                    });
                });
            });
        }

        // --- 3. Les autres paires ---
        // Deux méthodes, toutes deux prévues par le règlement.
        var reste = enPoule.slice(nbTS);

        if (opts.methode === 'serpentin') {
            // Serpentin : « détermine le placement des paires de manière précise ».
            // L'ordre est imposé par le classement (aller-retour en zigzag) ; le
            // tirage au sort n'intervient qu'à poids égal, ce que gère le tri amont.
            reste.forEach(function (eq, i) {
                // On repart du rang courant : les TS ont déjà consommé des places.
                var rang = Math.floor((nbTS + i) / nbPoules);
                var pos = (nbTS + i) % nbPoules;
                var idx = (rang % 2 === 0) ? pos : (nbPoules - 1 - pos);
                // Si la poule visée est pleine (poules de tailles inégales), on
                // bascule sur la poule la plus libre pour ne pas déborder.
                if (restant[idx] <= 0) {
                    var libre = -1, maxL = -1;
                    for (var q = 0; q < nbPoules; q++) {
                        if (restant[q] > maxL) { maxL = restant[q]; libre = q; }
                    }
                    idx = libre;
                }
                placements[eq.id] = idx;
                restant[idx]--;
                etapes.push({
                    type: 'serpentin',
                    equipe_id: eq.id,
                    nom: eq.nom,
                    poule: idx,
                    tire: false,
                    motif: 'Serpentin — placement imposé par le classement'
                });
            });
        } else {
            // Répartition par rang (méthode par défaut) : on constitue un chapeau
            // par rang, et chaque chapeau est tiré au sort dans les poules.
            var chapeaux = chapeauxParRang(reste, nbPoules);
            chapeaux.forEach(function (chapeau, iChap) {
                // Les chapeaux de TS occupent déjà les premiers numéros.
                var numero = Math.ceil(nbTS / nbPoules) + iChap + 1;
                var tire = melanger(chapeau, rng);
                tire.forEach(function (eq) {
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
                        chapeau: numero,
                        tire: true,
                        motif: 'Tirée au sort — chapeau ' + numero
                    });
                });
            });
        }

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
        chapeauxParRang: chapeauxParRang,
        verifierTirage: verifierTirage,
        melanger: melanger,
        makeRng: makeRng
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.TournoiTirage = api;

})(typeof window !== 'undefined' ? window : globalThis);
