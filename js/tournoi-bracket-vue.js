/* ============================================
   VUE TABLEAU (arborescence de compétition)

   Affiche un tableau à élimination directe comme sur un mur de club : les
   tours en colonnes, de gauche à droite, chaque match reliant deux équipes.
   La liste de matchs dit QUAND on joue ; le tableau dit OÙ l'on va.

   Conçu pour le tableau de 16 à entrées échelonnées, mais ne dépend que de
   `ordre` et `bracket` : tout tableau décrivant ses tours peut l'utiliser.

   Aucun appel réseau : on reçoit les matchs déjà chargés.
   ============================================ */
(function (root) {
    'use strict';

    // Colonnes du tableau de 16. Les `ordre` sont ceux de TournoiTableau16.MATCHS.
    // Le tableau principal d'abord, puis les tableaux de classement : un tour de
    // classement se lit comme un tour, pas comme un à-côté.
    var COLONNES_16 = [
        { titre: '16es de finale', ordres: [0, 1, 2, 3] },
        { titre: '8es de finale',  ordres: [4, 5, 6, 7] },
        { titre: 'Quarts',         ordres: [8, 9, 10, 11] },
        { titre: 'Demi-finales',   ordres: [12, 13] },
        { titre: 'Finale',         ordres: [14], places: '1-2' }
    ];

    var COLONNES_CLASSEMENT_16 = [
        { titre: 'Places 3-4',   ordres: [15], places: '3-4' },
        { titre: 'Places 5-8',   ordres: [16, 17], suite: [18, 19] },
        { titre: 'Places 9-12',  ordres: [20, 21], suite: [22, 23] },
        { titre: 'Places 13-16', ordres: [24, 25], suite: [26, 27] }
    ];

    function el(tag, cls, texte) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (texte != null) n.appendChild(document.createTextNode(texte));
        return n;
    }

    /**
     * Construit la vue.
     *
     * @param {Object} opts
     *   - matchs      : matchs du tournoi (on ne garde que la phase finale)
     *   - nomEquipe   : (equipeId) => string
     *   - libelleVide : (match, side) => string   provenance quand l'équipe est inconnue
     *   - onMatch     : (match) => void           clic sur un match (optionnel)
     * @returns {HTMLElement}
     */
    function rendre(opts) {
        var matchs = (opts.matchs || []).filter(function (m) { return m.phase === 'finale'; });
        var parOrdre = {};
        matchs.forEach(function (m) { parOrdre[m.ordre] = m; });

        var wrap = el('div', 'bracket-vue');

        // Le tableau n'a de sens que si les tours sont ceux qu'on attend. Avec
        // un autre format, on ne devine pas : on laisse la liste faire le travail.
        var complet = COLONNES_16.concat(COLONNES_CLASSEMENT_16).every(function (c) {
            return c.ordres.every(function (o) { return parOrdre[o]; });
        });
        if (!complet) return null;

        wrap.appendChild(bloc('🏆 Tableau principal', COLONNES_16, parOrdre, opts));
        wrap.appendChild(bloc('📊 Matchs de classement', COLONNES_CLASSEMENT_16, parOrdre, opts));
        return wrap;
    }

    function bloc(titre, colonnes, parOrdre, opts) {
        var section = el('div', 'bracket-bloc');
        section.appendChild(el('h4', 'bracket-bloc-titre', titre));
        var grille = el('div', 'bracket-grille');

        colonnes.forEach(function (col) {
            var colonne = el('div', 'bracket-colonne');
            colonne.appendChild(el('div', 'bracket-colonne-titre', col.titre));

            col.ordres.forEach(function (o) {
                colonne.appendChild(carte(parOrdre[o], opts, col.places));
            });
            // Un tour de classement enchaîne deux matchs dans la même colonne
            // (demies puis matchs de places) : les séparer par colonne ferait
            // huit colonnes pour quatre tours.
            if (col.suite) {
                colonne.appendChild(el('div', 'bracket-fleche', '↓'));
                col.suite.forEach(function (o) {
                    colonne.appendChild(carte(parOrdre[o], opts, null));
                });
            }
            grille.appendChild(colonne);
        });

        section.appendChild(grille);
        return section;
    }

    function carte(m, opts, places) {
        if (!m) return el('div', 'bracket-match bracket-match--vide', '—');

        var c = el('div', 'bracket-match bracket-match--' + (m.status || 'en_attente'));
        if (opts.onMatch) {
            c.className += ' bracket-match--clic';
            c.addEventListener('click', function () { opts.onMatch(m); });
        }

        var gagnant = m.vainqueur_id;
        [['a', m.equipe_a_id], ['b', m.equipe_b_id]].forEach(function (cote) {
            var side = cote[0], id = cote[1];
            var ligne = el('div', 'bracket-equipe'
                + (gagnant && id === gagnant ? ' bracket-equipe--gagnant' : '')
                + (gagnant && id && id !== gagnant ? ' bracket-equipe--perdant' : '')
                + (id ? '' : ' bracket-equipe--attente'));

            var nom = id ? opts.nomEquipe(id)
                         : (opts.libelleVide ? opts.libelleVide(m, side) : 'à venir');
            ligne.appendChild(el('span', 'bracket-nom', nom));

            var score = side === 'a' ? m.score_a : m.score_b;
            if (score != null && score !== '') {
                ligne.appendChild(el('span', 'bracket-score', String(score)));
            }
            c.appendChild(ligne);
        });

        var pied = [];
        if (m.terrain) pied.push('T' + m.terrain);
        if (places || m.place_vainqueur) {
            pied.push('places ' + (places || (m.place_vainqueur + '-' + (m.place_vainqueur + 1))));
        }
        if (pied.length) c.appendChild(el('div', 'bracket-pied', pied.join(' · ')));

        return c;
    }

    var api = { rendre: rendre, COLONNES_16: COLONNES_16, COLONNES_CLASSEMENT_16: COLONNES_CLASSEMENT_16 };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.TournoiBracketVue = api;

})(typeof window !== 'undefined' ? window : globalThis);
