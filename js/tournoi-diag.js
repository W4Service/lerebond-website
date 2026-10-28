/* ============================================
   TOURNOI DIAG (page de diagnostic, lecture seule)
   Dit ce que l'application voit réellement en base et pourquoi un tour
   suivant est généré ou non. Aucune écriture.
   ============================================ */
(function () {
    var supa = window.LeRebondSupa;
    var content = document.getElementById('content');
    if (!supa) { content.textContent = 'Erreur Supabase'; return; }

    function el(tag, attrs, children) {
        var e = document.createElement(tag);
        if (attrs) Object.keys(attrs).forEach(function (k) {
            if (k === 'class') e.className = attrs[k];
            else if (k === 'html') e.innerHTML = attrs[k];
            else e.setAttribute(k, attrs[k]);
        });
        if (children) {
            (Array.isArray(children) ? children : [children]).forEach(function (c) {
                if (c === null || c === undefined) return;
                if (typeof c === 'string') e.appendChild(document.createTextNode(c));
                else e.appendChild(c);
            });
        }
        return e;
    }

    function getParam(name) {
        var m = (window.location.search || '').match(new RegExp('[?&]' + name + '=([^&]+)'));
        return m ? decodeURIComponent(m[1]) : null;
    }

    function table(entetes, lignes) {
        var t = el('table');
        var tr = el('tr');
        entetes.forEach(function (h) { tr.appendChild(el('th', null, h)); });
        t.appendChild(tr);
        lignes.forEach(function (l) {
            var r = el('tr');
            l.forEach(function (c) {
                if (c && typeof c === 'object' && c.texte !== undefined) {
                    r.appendChild(el('td', { class: c.classe || '' }, c.texte));
                } else {
                    r.appendChild(el('td', null, String(c === null || c === undefined ? '—' : c)));
                }
            });
            t.appendChild(r);
        });
        return t;
    }

    async function load() {
        var id = getParam('t');
        if (!id) { content.innerHTML = '<p class="empty">Paramètre ?t=&lt;id du tournoi&gt; manquant.</p>'; return; }

        var resT = await supa.from('tournois').select('*').eq('id', id).maybeSingle();
        if (resT.error) { content.innerHTML = '<p class="empty">Erreur : ' + resT.error.message + '</p>'; return; }
        if (!resT.data) { content.innerHTML = '<p class="empty">Aucun tournoi avec cet identifiant.</p>'; return; }

        var resP = await supa.from('poules').select('*').eq('tournoi_id', id).order('ordre');
        var resE = await supa.from('equipes').select('*').eq('tournoi_id', id);
        var resM = await supa.from('matchs').select('*').eq('tournoi_id', id).order('ordre');

        render(resT.data, resP.data || [], resE.data || [], resM.data || []);
    }

    function render(tournoi, poules, equipes, matchs) {
        content.innerHTML = '';

        // === Configuration détectée ===
        content.appendChild(el('h2', null, '1. Configuration'));

        var tailles = poules.map(function (p) {
            return equipes.filter(function (e) { return e.poule_id === p.id; }).length;
        });
        var horsPoule = equipes.filter(function (e) { return !e.poule_id; });

        content.appendChild(table(['Donnée', 'Valeur'], [
            ['Tournoi', tournoi.nom],
            ['Phase', tournoi.phase || '—'],
            ['Terrains', tournoi.nb_terrains],
            ['Équipes', equipes.length],
            ['Poules', poules.length + (poules.length ? ' (' + tailles.join(' + ') + ')' : '')],
            ['Hors poule (têtes de série)', horsPoule.length]
        ]));

        // Le prédicat du format 12 équipes, reproduit à l'identique.
        var est4ts2p4 = poules.length === 2
            && tailles.every(function (n) { return n === 4; })
            && horsPoule.length === 4;

        var ligneFormat = est4ts2p4
            ? { texte: 'OUI — format 4 TS + 2 poules de 4', classe: 'ok' }
            : { texte: 'NON', classe: 'ko' };
        content.appendChild(table(['Test', 'Résultat'], [
            ['isConfig4ts2p4()', ligneFormat]
        ]));

        if (!est4ts2p4) {
            var raisons = [];
            if (poules.length !== 2) raisons.push(poules.length + ' poules au lieu de 2');
            else if (!tailles.every(function (n) { return n === 4; })) raisons.push('poules de ' + tailles.join('+') + ' au lieu de 4+4');
            if (horsPoule.length !== 4) raisons.push(horsPoule.length + ' équipes hors poule au lieu de 4');
            content.appendChild(el('div', { class: 'verdict probleme' }, [
                el('h3', null, '⚠ Le format n\'est pas reconnu'),
                el('p', null, raisons.join(' · ')),
                el('p', { class: 'dim' }, 'Tant que isConfig4ts2p4() est faux, aucune des règles '
                    + 'de ce format ne s\'applique : ni les demies, ni la consolation 5-8.')
            ]));
        }

        // === Matchs par bracket ===
        content.appendChild(el('h2', null, '2. Matchs de phase finale, par bracket'));

        var finale = matchs.filter(function (m) { return m.phase === 'finale'; });
        if (finale.length === 0) {
            content.appendChild(el('p', { class: 'empty' }, 'Aucun match de phase finale.'));
        } else {
            var parBracket = {};
            finale.forEach(function (m) {
                (parBracket[m.bracket || '(aucun)'] = parBracket[m.bracket || '(aucun)'] || []).push(m);
            });

            var lignes = Object.keys(parBracket).sort().map(function (bk) {
                var ms = parBracket[bk];
                var termines = ms.filter(function (m) { return m.status === 'termine' && m.vainqueur_id; }).length;
                var pret = ms.filter(function (m) { return m.equipe_a_id && m.equipe_b_id; }).length;
                var connu = ['principal', 'consolation_5_8', 'places_5_6', 'places_7_8',
                    'places_9_10', 'places_11_12', 'places_1_2', 'places_3_4'].indexOf(bk) >= 0;
                return [
                    connu ? bk : { texte: bk + ' ⚠', classe: 'ko' },
                    ms.length,
                    termines + '/' + ms.length,
                    pret + '/' + ms.length
                ];
            });
            content.appendChild(table(['Bracket', 'Matchs', 'Terminés', 'Équipes connues'], lignes));

            // Bracket obsolète encore présent ?
            if (parBracket['bas_9_12']) {
                content.appendChild(el('div', { class: 'verdict probleme' }, [
                    el('h3', null, '⚠ Bracket obsolète « bas_9_12 » en base'),
                    el('p', null, 'Ce tournoi a été généré avant la correction du format. '
                        + 'Ce bracket n\'existe plus dans le code : il n\'a aucune règle, '
                        + 'et il bloque le classement des places 9-12.'),
                    el('p', null, 'Correction : dans l\'admin, « 🔄 Regénérer la phase finale ».')
                ]));
            }

            // === Pourquoi le tour suivant n'est pas généré ===
            content.appendChild(el('h2', null, '3. Enchaînement du tableau principal'));

            var principal = (parBracket['principal'] || []).slice()
                .sort(function (a, b) { return a.ordre - b.ordre; });

            if (principal.length === 0) {
                content.appendChild(el('p', { class: 'empty' }, 'Pas de bracket « principal ».'));
            } else {
                var tousTermines = principal.every(function (m) { return m.status === 'termine' && m.vainqueur_id; });
                var attendu = 8; // 4 quarts + 2 demies + finale + petite finale
                var estFini = principal.length >= attendu && tousTermines;

                // Reproduit la détection du round courant.
                var n = principal.length;
                var round = n === 2 ? 2 : (n === 4 ? 4 : (n === 6 && est4ts2p4 ? 2 : null));

                content.appendChild(table(['Test', 'Valeur'], [
                    ['Matchs dans le bracket', n + ' / ' + attendu + ' attendus'],
                    ['Tous terminés', tousTermines ? { texte: 'oui', classe: 'ok' } : { texte: 'non', classe: 'warn' }],
                    ['bracketEstFini()', estFini ? { texte: 'oui — plus rien à générer', classe: 'warn' } : { texte: 'non', classe: 'ok' }],
                    ['Round courant détecté', round === null
                        ? { texte: 'INDÉTERMINÉ', classe: 'ko' }
                        : round + ' match(s)'],
                    ['Tour suivant générable', (tousTermines && !estFini && round !== null)
                        ? { texte: 'OUI', classe: 'ok' }
                        : { texte: 'NON', classe: 'ko' }]
                ]));

                var v;
                if (!tousTermines) {
                    var reste = principal.filter(function (m) { return m.status !== 'termine' || !m.vainqueur_id; });
                    v = el('div', { class: 'verdict' }, [
                        el('h3', null, 'En attente de résultats'),
                        el('p', null, reste.length + ' match(s) du tableau principal ne sont pas terminés.'),
                        el('p', { class: 'dim' }, 'Le tour suivant se génère automatiquement '
                            + 'dès que le dernier score du round est saisi.')
                    ]);
                } else if (estFini) {
                    v = el('div', { class: 'verdict' }, [
                        el('h3', null, 'Tableau principal terminé'),
                        el('p', null, 'Les 8 matchs sont joués : il n\'y a plus de tour à générer ici.')
                    ]);
                } else if (round === null) {
                    v = el('div', { class: 'verdict probleme' }, [
                        el('h3', null, '⚠ Structure non reconnue'),
                        el('p', null, 'Le bracket compte ' + n + ' matchs, un total que la '
                            + 'détection ne sait pas interpréter (attendu : 4, puis 6).'),
                        el('p', null, 'Correction : « 🔄 Regénérer la phase finale ».')
                    ]);
                } else if (n === 4) {
                    var conso = (parBracket['consolation_5_8'] || []).length;
                    v = el('div', { class: conso ? 'verdict' : 'verdict probleme' }, [
                        el('h3', null, conso ? 'Quarts joués, consolation créée' : '⚠ Quarts joués, consolation manquante'),
                        el('p', null, conso
                            ? 'Les 2 matchs de consolation 5-8 sont en base.'
                            : 'Les quarts sont terminés mais ni les demies ni la consolation '
                              + 'ne sont créées. Saisis à nouveau le dernier score du quart, '
                              + 'ou utilise le bouton de génération du tour suivant.')
                    ]);
                } else {
                    v = el('div', { class: 'verdict' }, [
                        el('h3', null, 'Prêt à générer'),
                        el('p', null, 'Le round courant est complet, le tour suivant peut être créé.')
                    ]);
                }
                content.appendChild(v);
            }

            // === Places 5-8 ===
            content.appendChild(el('h2', null, '4. Matchs des places 5 à 8'));
            var conso58 = parBracket['consolation_5_8'] || [];
            var p56 = parBracket['places_5_6'] || [];
            var p78 = parBracket['places_7_8'] || [];
            content.appendChild(table(['Bracket', 'Présent', 'Détail'], [
                ['consolation_5_8 (2 demies)',
                    conso58.length ? { texte: 'oui', classe: 'ok' } : { texte: 'NON', classe: 'ko' },
                    conso58.length + ' match(s)'],
                ['places_5_6',
                    p56.length ? { texte: 'oui', classe: 'ok' } : { texte: 'non', classe: 'dim' },
                    p56.length ? 'créé' : 'créé après la consolation'],
                ['places_7_8',
                    p78.length ? { texte: 'oui', classe: 'ok' } : { texte: 'non', classe: 'dim' },
                    p78.length ? 'créé' : 'créé après la consolation']
            ]));

            if (conso58.length === 0) {
                content.appendChild(el('div', { class: 'verdict probleme' }, [
                    el('h3', null, '⚠ Les matchs 5-8 ne sont pas en base'),
                    el('p', null, 'Ils sont créés au moment où les 4 quarts sont tous terminés, '
                        + 'en même temps que les demies.'),
                    el('p', null, 'Si tes quarts sont joués et qu\'ils n\'existent toujours pas, '
                        + 'c\'est que le tournoi a été généré avec une version antérieure du code : '
                        + 'utilise « 🔄 Regénérer la phase finale » dans l\'admin.')
                ]));
            }
        }

        content.appendChild(el('p', { class: 'hint' },
            'Copie cette page (ou sa capture) pour la transmettre — tout ce qui est utile y figure.'));
    }

    load();
})();
