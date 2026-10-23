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

    /**
     * Prépare le tirage d'un tableau à élimination directe (sans poules).
     *
     * Guide de la compétition padel, III.4 — Constitution des tableaux :
     *
     *   « Seules les TS 1 et 2 sont placées de part et d'autre du Tableau
     *     (TS 1 en bas du tableau). Toutes les autres paires sont placées par
     *     tirage au sort.
     *     - Tirage au sort pour placement des TS 3 et 4
     *     - Tirage au sort pour placement des TS 5 à 8 (ou groupe 5 à 8 si
     *       uniquement 4 TS) »
     *
     * D'où trois temps, et non un tirage unique : TS1/TS2 placées d'office,
     * puis un tirage pour TS3/TS4, puis un tirage pour le reste. Les deux
     * tirages sont distincts parce qu'ils ne portent pas sur les mêmes places :
     * TS3 et TS4 vont une par moitié libre, le groupe suivant comble le reste.
     *
     * Les positions sont numérotées de 0 à N-1 de haut en bas du tableau. Le
     * quart 1 est {0,1}, le quart 2 {2,3}, etc. « TS 1 en bas » : on lui donne
     * donc la dernière position, et TS2 la première — ils ne peuvent se
     * rencontrer qu'en finale.
     *
     * @param {Object} opts
     *   - equipes : [{id, nom}] triées de la plus forte à la plus faible
     *   - nbTS    : têtes de série placées (2 ou 4 ; 0 = tirage intégral)
     *   - seed    : graine du tirage
     * @returns {{seed, etapes:[], positions:{equipeId: index}}}
     *   etapes : la séquence à jouer à l'écran, dans l'ordre
     */
    function preparerTirageTableau(opts) {
        var equipes = (opts.equipes || []).slice();
        var taille = equipes.length;
        var nbTS = opts.nbTS || 0;
        var seed = (opts.seed == null ? 1 : opts.seed) >>> 0;
        var rng = makeRng(seed);

        var positions = {};
        var etapes = [];
        var libres = [];
        for (var i = 0; i < taille; i++) libres.push(i);

        function occuper(equipe, pos, phase, commentaire) {
            positions[equipe.id] = pos;
            libres = libres.filter(function (p) { return p !== pos; });
            etapes.push({
                phase: phase, equipe: equipe.id, nom: equipe.nom,
                position: pos, quart: Math.floor(pos / 2) + 1,
                commentaire: commentaire
            });
        }

        // --- 1. TS1 et TS2 : placement d'office, aux deux extrémités.
        if (nbTS >= 2 && taille >= 2) {
            occuper(equipes[0], taille - 1, 'ts_office', 'TS 1 — bas du tableau (placement d\'office)');
            occuper(equipes[1], 0, 'ts_office', 'TS 2 — haut du tableau (placement d\'office)');
        }

        // --- 2. TS3 et TS4 : tirage au sort, une par moitié encore sans TS.
        // Elles ne doivent pouvoir croiser TS1/TS2 qu'en demi-finale, donc une
        // dans la moitié haute, une dans la moitié basse — le sort décidant
        // laquelle va où.
        if (nbTS >= 4 && taille >= 4) {
            var milieu = taille / 2;
            // Places candidates : une par moitié, à l'extrémité intérieure du
            // quart encore vide (tableau standard : quart 2 et quart 3).
            var candidates = [milieu - 1, milieu];
            var ordreTS34 = melanger([equipes[2], equipes[3]], rng);
            var placesTS34 = melanger(candidates, rng);
            for (var k = 0; k < 2; k++) {
                occuper(ordreTS34[k], placesTS34[k], 'ts_tirage',
                        'TS ' + (3 + k) + ' — tirée au sort (moitié '
                        + (placesTS34[k] < milieu ? 'haute' : 'basse') + ')');
            }
        }

        // --- 3. Le reste : tirage au sort intégral sur les places libres.
        var restantes = equipes.filter(function (e) { return positions[e.id] == null; });
        var tirees = melanger(restantes, rng);
        var placesTirees = melanger(libres.slice(), rng);
        for (var j = 0; j < tirees.length; j++) {
            occuper(tirees[j], placesTirees[j], 'tirage',
                    'tirée au sort — quart ' + (Math.floor(placesTirees[j] / 2) + 1));
        }

        return { seed: seed, etapes: etapes, positions: positions };
    }

    /**
     * Rejoue un tirage de tableau et vérifie qu'il redonne bien les positions
     * annoncées. Même usage que verifierTirage : pouvoir prouver, graine en
     * main, qu'un tableau contesté n'a pas été forcé.
     */
    function verifierTirageTableau(opts, positionsAttendues) {
        var rejoue = preparerTirageTableau(opts);
        var ids = Object.keys(positionsAttendues);
        if (ids.length !== Object.keys(rejoue.positions).length) return false;
        for (var i = 0; i < ids.length; i++) {
            if (rejoue.positions[ids[i]] !== positionsAttendues[ids[i]]) return false;
        }
        return true;
    }

    var api = {
        preparerTirage: preparerTirage,
        preparerTirageTableau: preparerTirageTableau,
        chapeauxParRang: chapeauxParRang,
        verifierTirage: verifierTirage,
        verifierTirageTableau: verifierTirageTableau,
        melanger: melanger,
        makeRng: makeRng
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.TournoiTirage = api;

})(typeof window !== 'undefined' ? window : globalThis);
