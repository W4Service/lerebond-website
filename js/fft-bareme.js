/* ============================================
   BARÈME DES POINTS FFT PADEL (P25 → P250)
   Points gagnés par chaque joueur selon la place finale et le nombre de paires.
   Source : Guide de la compétition padel, chapitre II « Classements – Barèmes &
   Assimilations » (MAJ février 2026), barèmes P25 et P100 ; P50 = P100 × 0,5 et
   P250 = P100 × 2,5, arrondis au supérieur (vérifié sur les tableaux officiels).
   ============================================ */
(function () {
    // Colonnes : 4-8, 9-12, 13-16, 17-20, 21-24, 25-28, 29 paires et plus
    var TRANCHES = [
        { min: 4, max: 8 }, { min: 9, max: 12 }, { min: 13, max: 16 }, { min: 17, max: 20 },
        { min: 21, max: 24 }, { min: 25, max: 28 }, { min: 29, max: Infinity }
    ];
    // Lignes : place 1, 2, 3…
    var P100 = [
        [100, 100, 100, 100, 100, 100, 100], [80, 80, 80, 85, 85, 85, 85], [60, 65, 70, 75, 75, 75, 75],
        [40, 55, 60, 70, 70, 70, 70], [25, 40, 50, 60, 60, 60, 60], [10, 30, 45, 55, 55, 55, 58],
        [5, 20, 40, 50, 50, 50, 56], [1, 10, 30, 45, 45, 45, 54], [0, 5, 25, 35, 38, 38, 45],
        [0, 3, 21, 30, 36, 36, 43], [0, 2, 18, 25, 34, 34, 41], [0, 1, 15, 23, 32, 32, 39],
        [0, 0, 10, 20, 30, 30, 37], [0, 0, 5, 18, 28, 28, 35], [0, 0, 3, 15, 26, 26, 33],
        [0, 0, 1, 12, 24, 24, 31], [0, 0, 0, 10, 20, 20, 27], [0, 0, 0, 5, 18, 18, 26],
        [0, 0, 0, 3, 15, 16, 25], [0, 0, 0, 1, 12, 14, 24], [0, 0, 0, 0, 10, 12, 23],
        [0, 0, 0, 0, 5, 10, 22], [0, 0, 0, 0, 3, 8, 21], [0, 0, 0, 0, 1, 6, 20],
        [0, 0, 0, 0, 0, 4, 17], [0, 0, 0, 0, 0, 3, 15], [0, 0, 0, 0, 0, 2, 13],
        [0, 0, 0, 0, 0, 1, 11], [0, 0, 0, 0, 0, 0, 9], [0, 0, 0, 0, 0, 0, 7],
        [0, 0, 0, 0, 0, 0, 5], [0, 0, 0, 0, 0, 0, 3]
    ];
    var P25 = [
        [25, 25, 25, 25, 25, 25, 25], [20, 20, 20, 22, 22, 22, 22], [15, 16, 17, 19, 19, 19, 19],
        [9, 14, 15, 17, 17, 17, 17], [6, 10, 14, 15, 15, 15, 15], [4, 8, 13, 13, 13, 13, 14],
        [2, 7, 12, 12, 12, 12, 13], [1, 6, 11, 11, 11, 11, 12], [0, 4, 8, 9, 9, 8, 10],
        [0, 3, 7, 8, 8, 7, 9], [0, 2, 6, 7, 7, 6, 8], [0, 1, 5, 6, 6, 5, 7],
        [0, 0, 4, 5, 5, 4, 6], [0, 0, 3, 4, 5, 4, 5], [0, 0, 2, 3, 5, 4, 4],
        [0, 0, 1, 2, 5, 4, 3], [0, 0, 0, 1, 4, 3, 2], [0, 0, 0, 1, 4, 3, 2],
        [0, 0, 0, 1, 3, 3, 2], [0, 0, 0, 1, 3, 3, 2], [0, 0, 0, 0, 2, 2, 2],
        [0, 0, 0, 0, 2, 2, 2], [0, 0, 0, 0, 1, 2, 2], [0, 0, 0, 0, 1, 2, 1],
        [0, 0, 0, 0, 0, 1, 1], [0, 0, 0, 0, 0, 1, 1], [0, 0, 0, 0, 0, 1, 1],
        [0, 0, 0, 0, 0, 1, 1], [0, 0, 0, 0, 0, 0, 1], [0, 0, 0, 0, 0, 0, 1],
        [0, 0, 0, 0, 0, 0, 1], [0, 0, 0, 0, 0, 0, 1]
    ];
    function multiplier(table, k) {
        return table.map(function (l) { return l.map(function (v) { return v ? Math.ceil(v * k) : 0; }); });
    }
    var BAREMES = { P25: P25, P50: multiplier(P100, 0.5), P100: P100, P250: multiplier(P100, 2.5) };

    function colonne(nbEquipes) {
        if (nbEquipes <= 8) return 0;
        for (var i = 0; i < TRANCHES.length; i++) {
            if (nbEquipes >= TRANCHES[i].min && nbEquipes <= TRANCHES[i].max) return i;
        }
        return TRANCHES.length - 1;
    }

    // Points FFT gagnés par CHAQUE joueur de la paire. null si catégorie sans barème connu.
    function points(categorie, place, nbEquipes) {
        var b = BAREMES[categorie];
        if (!b || !place || place < 1 || !nbEquipes || nbEquipes < 2) return null;
        if (place > nbEquipes) return 0;
        var ligne = b[place - 1];
        return ligne ? ligne[colonne(nbEquipes)] : 0;
    }

    // Toutes les places d'un tournoi : [{place, points}]
    function grille(categorie, nbEquipes) {
        var out = [];
        for (var p = 1; p <= nbEquipes; p++) out.push({ place: p, points: points(categorie, p, nbEquipes) });
        return out;
    }

    window.FFTBareme = {
        CATEGORIES: Object.keys(BAREMES),
        points: points,
        grille: grille
    };
})();
