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
        // L'heure d'abord : c'est l'information qu'on cherche sur un tableau
        // affiché au mur, avant le terrain.
        var h = opts.heureDe ? opts.heureDe(m) : null;
        if (h) pied.push(h);
        if (m.terrain) pied.push('T' + m.terrain);
        if (places || m.place_vainqueur) {
            pied.push('places ' + (places || (m.place_vainqueur + '-' + (m.place_vainqueur + 1))));
        }
        if (pied.length) c.appendChild(el('div', 'bracket-pied', pied.join(' · ')));

        return c;
    }

    /* ============================================
       VUE MULTI-CHANCES (tous les formats)

       Comme la feuille « Formule Multi-Chances » : un bloc par ensemble de
       places (1-4, 5-8, 9-10…), les tours en colonnes, chaque match numéroté
       M1, M2… pour que « Vainqueur M3 » se lise d'un coup d'œil.

       Reçoit les vrais matchs de phase finale ET les matchs « projetés » :
       ceux que l'admin créera aux tours suivants, calculés par la même règle
       que la génération réelle. Une équipe encore inconnue d'un match projeté
       est un jeton « gagnant:<id du match> » ou « perdant:<id du match> ».
       ============================================ */

    function jeton(id) {
        if (typeof id !== 'string') return null;
        var i = id.indexOf(':');
        if (i < 0) return null;
        var type = id.slice(0, i);
        if (type !== 'gagnant' && type !== 'perdant') return null;
        return { type: type, matchId: id.slice(i + 1) };
    }

    function estEquipe(id) { return !!id && !jeton(id); }

    // Plan de la vue : blocs, colonnes, numéros. Fonction pure (testée seule).
    //   matchs    : vrais matchs de phase finale
    //   projetes  : matchs à venir ({ id, bracket, ordre, equipe_a_id, equipe_b_id })
    //   ordreBloc : (bracket) => nombre, la première place jouée dans ce bracket
    function planMultiChances(matchs, projetes, ordreBloc) {
        var tous = matchs.filter(function (m) { return m.phase === 'finale'; })
            .concat((projetes || []).map(function (p) {
                var c = {}; for (var k in p) c[k] = p[k];
                c.projete = true;
                return c;
            }));
        if (!tous.length) return null;
        var parId = {};
        tous.forEach(function (m) { parId[m.id] = m; });
        ordreBloc = ordreBloc || function () { return 99; };

        // Le match qui a envoyé une équipe dans m : le jeton, la source
        // déclarée (tableau créé d'avance), sinon le dernier match joué
        // par cette équipe avant m.
        var avant = function (x, m) {
            if (m.projete && !x.projete) return true;
            if (x.projete || m.projete) return false;
            return (x.created_at || '') < (m.created_at || '');
        };
        var origines = function (m) {
            var res = [];
            ['a', 'b'].forEach(function (side) {
                var id = m['equipe_' + side + '_id'];
                var j = jeton(id);
                if (j && parId[j.matchId]) { res.push({ match: parId[j.matchId], type: j.type, side: side }); return; }
                var src = m['equipe_' + side + '_source_match_id'];
                if (!id && src && parId[src]) {
                    res.push({ match: parId[src], type: m['equipe_' + side + '_source_type'] === 'perdant' ? 'perdant' : 'gagnant', side: side });
                    return;
                }
                if (!estEquipe(id)) return;
                var dernier = null;
                tous.forEach(function (x) {
                    if (x === m || !avant(x, m)) return;
                    if (x.equipe_a_id !== id && x.equipe_b_id !== id) return;
                    if (!dernier || (x.created_at || '') > (dernier.created_at || '')) dernier = x;
                });
                if (dernier) res.push({ match: dernier, type: dernier.vainqueur_id === id ? 'gagnant' : 'perdant', side: side });
            });
            return res;
        };
        var orig = {};
        tous.forEach(function (m) { orig[m.id] = origines(m); });

        var prof = {};
        var profondeur = function (m, pile) {
            if (prof[m.id] != null) return prof[m.id];
            pile = pile || {};
            if (pile[m.id]) return 0; // garde-fou : jamais de boucle
            pile[m.id] = true;
            var p = 0;
            orig[m.id].forEach(function (o) { p = Math.max(p, profondeur(o.match, pile) + 1); });
            prof[m.id] = p;
            return p;
        };
        tous.forEach(function (m) { profondeur(m); });

        // Un bracket alimenté par un seul autre bracket de classement le
        // prolonge (consolation 5-8 → places 5-6 et 7-8) : même bloc.
        var brackets = [];
        tous.forEach(function (m) { if (brackets.indexOf(m.bracket) < 0) brackets.push(m.bracket); });
        var parent = {};
        brackets.forEach(function (b) {
            if (b === 'principal') return;
            var sources = [];
            tous.forEach(function (m) {
                if (m.bracket !== b) return;
                orig[m.id].forEach(function (o) {
                    if (sources.indexOf(o.match.bracket) < 0) sources.push(o.match.bracket);
                });
            });
            if (sources.length === 1 && sources[0] !== b && sources[0] !== 'principal') parent[b] = sources[0];
        });
        var racine = function (b) {
            var vus = {};
            while (parent[b] && !vus[b]) { vus[b] = true; b = parent[b]; }
            return b;
        };

        var blocs = {};
        tous.forEach(function (m) {
            var r = racine(m.bracket);
            (blocs[r] = blocs[r] || { bracket: r, matchs: [] }).matchs.push(m);
        });
        var listeBlocs = Object.keys(blocs).map(function (k) { return blocs[k]; })
            .sort(function (a, b) { return ordreBloc(a.bracket) - ordreBloc(b.bracket); });

        var numero = {};
        var n = 0;
        listeBlocs.forEach(function (bl) {
            var min = Infinity;
            bl.matchs.forEach(function (m) { min = Math.min(min, prof[m.id]); });
            var cols = [];
            bl.matchs.forEach(function (m) {
                var c = prof[m.id] - min;
                (cols[c] = cols[c] || []).push(m);
            });
            bl.colonnes = cols.filter(Boolean).map(function (ms) {
                return ms.sort(function (a, b) {
                    if (a.bracket !== b.bracket) return ordreBloc(a.bracket) - ordreBloc(b.bracket);
                    return (a.ordre || 0) - (b.ordre || 0);
                });
            });
            bl.colonnes.forEach(function (ms) { ms.forEach(function (m) { numero[m.id] = ++n; }); });
        });

        return { blocs: listeBlocs, numero: numero, origines: orig, parId: parId };
    }

    var TOURS_PRINCIPAL = ['Finale', 'Demi-finales', 'Quarts', '8es de finale', '16es de finale'];

    function titreColonne(bloc, i) {
        if (bloc.bracket === 'principal') {
            var t = TOURS_PRINCIPAL[bloc.colonnes.length - 1 - i];
            if (i === bloc.colonnes.length - 1 && bloc.colonnes[i].length === 2) return 'Finale · petite finale';
            return t || ('Tour ' + (i + 1));
        }
        return 'Tour ' + (i + 1);
    }

    // État d'un match pour la vue : ce qu'on doit en faire maintenant.
    function etat(m) {
        if (m.status === 'termine') return 'termine';
        if (m.status === 'en_cours') return 'en_cours';
        var deux = estEquipe(m.equipe_a_id) && estEquipe(m.equipe_b_id);
        if (!m.projete && deux) return 'a_lancer';
        if (m.projete && deux) return 'pret';
        return 'attente';
    }

    // Matchs dont dépend m et qui ne sont pas encore joués : « après M3 ».
    function attendus(plan, m) {
        return plan.origines[m.id]
            .filter(function (o) { return o.match.status !== 'termine'; })
            .map(function (o) { return 'M' + plan.numero[o.match.id]; })
            .filter(function (v, i, t) { return t.indexOf(v) === i; });
    }

    function libelleEtat(plan, m) {
        var e = etat(m);
        var t = m.terrain ? ' · T' + m.terrain : '';
        if (e === 'termine') return 'terminé';
        if (e === 'en_cours') return 'en cours' + t;
        if (e === 'a_lancer') return 'à lancer' + t;
        var att = attendus(plan, m);
        if (e === 'pret') return 'connu · créé après ' + (att.join(', ') || 'le tour en cours');
        return att.length ? 'après ' + att.join(' et ') : 'à venir';
    }

    function nomCote(plan, m, side, opts) {
        var id = m['equipe_' + side + '_id'];
        if (estEquipe(id)) return { nom: opts.nomEquipe(id), connu: true };
        var j = jeton(id);
        if (!j) {
            var src = m['equipe_' + side + '_source_match_id'];
            if (src && plan.numero[src]) {
                j = { type: m['equipe_' + side + '_source_type'] === 'perdant' ? 'perdant' : 'gagnant', matchId: src };
            }
        }
        if (j && plan.numero[j.matchId]) {
            return { nom: (j.type === 'gagnant' ? 'Vainqueur M' : 'Perdant M') + plan.numero[j.matchId], connu: false };
        }
        return { nom: opts.libelleVide ? opts.libelleVide(m, side) : 'à venir', connu: false };
    }

    function carteMC(plan, m, opts) {
        var e = etat(m);
        var c = el('div', 'bracket-match bracket-match--' + e + (m.projete ? ' bracket-match--projete' : ''));
        if (opts.onMatch && !m.projete) {
            c.className += ' bracket-match--clic';
            c.addEventListener('click', function () { opts.onMatch(m); });
        }
        var tete = el('div', 'bracket-tete');
        var num = 'M' + plan.numero[m.id];
        // Un match de places seul dans sa colonne (5-6, 7-8…) dit lesquelles.
        if (m.bracket && m.bracket.indexOf('places_') === 0) {
            num += ' · places ' + m.bracket.replace('places_', '').split('_').join('-');
        }
        tete.appendChild(el('span', 'bracket-num', num));
        tete.appendChild(el('span', 'bracket-etat bracket-etat--' + e, libelleEtat(plan, m)));
        c.appendChild(tete);

        var gagnant = m.vainqueur_id;
        ['a', 'b'].forEach(function (side) {
            var id = m['equipe_' + side + '_id'];
            var nc = nomCote(plan, m, side, opts);
            var ligne = el('div', 'bracket-equipe'
                + (gagnant && id === gagnant ? ' bracket-equipe--gagnant' : '')
                + (gagnant && estEquipe(id) && id !== gagnant ? ' bracket-equipe--perdant' : '')
                + (nc.connu ? '' : ' bracket-equipe--attente'));
            ligne.appendChild(el('span', 'bracket-nom', nc.nom));
            var score = side === 'a' ? m.score_a : m.score_b;
            if (score != null && score !== '') ligne.appendChild(el('span', 'bracket-score', String(score)));
            c.appendChild(ligne);
        });

        var h = !m.projete && opts.heureDe ? opts.heureDe(m) : null;
        if (h && e !== 'termine') c.appendChild(el('div', 'bracket-pied', h));
        return c;
    }

    /**
     * @param {Object} opts
     *   - matchs, projetes, ordreBloc : voir planMultiChances
     *   - nomEquipe(id), libelleVide(match, side), libelleBracket(bracket)
     *   - heureDe(match), onMatch(match) : optionnels
     * @returns {HTMLElement|null}
     */
    function rendreMultiChances(opts) {
        var plan = planMultiChances(opts.matchs || [], opts.projetes || [], opts.ordreBloc);
        if (!plan) return null;
        var wrap = el('div', 'bracket-vue bracket-vue--mc');

        // Ce qu'il faut faire maintenant, avant le tableau complet.
        var tousMatchs = [];
        plan.blocs.forEach(function (bl) { bl.colonnes.forEach(function (ms) { tousMatchs = tousMatchs.concat(ms); }); });
        var rang = { en_cours: 0, a_lancer: 1, pret: 2 };
        var prochains = tousMatchs.filter(function (m) { return rang[etat(m)] != null; })
            .sort(function (a, b) { return rang[etat(a)] - rang[etat(b)] || plan.numero[a.id] - plan.numero[b.id]; });
        if (prochains.length) {
            var sec = el('div', 'bracket-bloc bracket-prochains');
            sec.appendChild(el('h4', 'bracket-bloc-titre', '▶ En cours et prochains matchs'));
            var g = el('div', 'bracket-prochains-grille');
            prochains.forEach(function (m) { g.appendChild(carteMC(plan, m, opts)); });
            sec.appendChild(g);
            if (prochains.some(function (m) { return etat(m) === 'pret'; })) {
                sec.appendChild(el('p', 'bracket-note',
                    '« Connu » : les deux équipes sont qualifiées, mais l\'admin ne crée ce match ' +
                    'qu\'une fois tous les matchs du tour précédent saisis.'));
            }
            wrap.appendChild(sec);
        }

        plan.blocs.forEach(function (bl) {
            var section = el('div', 'bracket-bloc');
            section.appendChild(el('h4', 'bracket-bloc-titre',
                opts.libelleBracket ? opts.libelleBracket(bl.bracket) : bl.bracket));
            var grille = el('div', 'bracket-grille bracket-grille--mc');
            bl.colonnes.forEach(function (ms, i) {
                var col = el('div', 'bracket-colonne');
                col.appendChild(el('div', 'bracket-colonne-titre', titreColonne(bl, i)));
                var corps = el('div', 'bracket-colonne-corps');
                ms.forEach(function (m) { corps.appendChild(carteMC(plan, m, opts)); });
                col.appendChild(corps);
                grille.appendChild(col);
            });
            section.appendChild(grille);
            wrap.appendChild(section);
        });
        return wrap;
    }

    var api = {
        rendre: rendre, COLONNES_16: COLONNES_16, COLONNES_CLASSEMENT_16: COLONNES_CLASSEMENT_16,
        planMultiChances: planMultiChances, rendreMultiChances: rendreMultiChances, etat: etat
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.TournoiBracketVue = api;

})(typeof window !== 'undefined' ? window : globalThis);
