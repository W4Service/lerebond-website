/* ============================================
   TOURNOI PRINT (page imprimable / PDF)
   ============================================ */
(function () {
    var supa = window.LeRebondSupa;
    if (!supa) { document.getElementById('content').textContent = 'Erreur Supabase'; return; }

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

    function formatLabel(f) {
        switch (f) {
            case 'format_a': return 'Format A · 3 sets de 6 jeux';
            case 'format_b': return 'Format B · 2 sets de 6 jeux + super TB';
            case 'format_c': return 'Format C · 2 sets de 4 jeux + super TB';
            case 'format_d': return 'Format D · 1 set de 9 jeux';
            case 'format_e': return 'Format E · super TB à 10';
            case 'americano': return 'Americano';
            case 'libre': return 'Libre';
        }
        return f || '';
    }

    function placeholderLabel(sourceOrdre, sourceType, sourcePouleId, poules) {
        if (!sourceType) return '?';
        if (sourceType === 'gagnant') return 'GM' + (sourceOrdre + 1);
        if (sourceType === 'perdant') return 'PM' + (sourceOrdre + 1);
        if (sourceType === 'rang_poule') {
            var rangs = { 1: '1er', 2: '2e', 3: '3e', 4: '4e', 5: '5e' };
            var p = poules.find(function (x) { return x.id === sourcePouleId; });
            return (rangs[sourceOrdre] || (sourceOrdre + 'e')) + ' ' + (p ? p.nom : '?');
        }
        if (sourceType === 'meilleur_2e') return 'Meilleur 2e';
        if (sourceType === 'autres_2es') return 'Autre 2e';
        return '?';
    }

    function eqName(eq) { return eq ? eq.nom : null; }
    function findEq(equipes, id) { return equipes.find(function (e) { return e.id === id; }); }

    function eqLabel(m, side, equipes, poules) {
        var id = side === 'a' ? m.equipe_a_id : m.equipe_b_id;
        if (id) {
            var e = findEq(equipes, id);
            return e ? e.nom : '?';
        }
        var sOrdre = side === 'a' ? m.equipe_a_source_ordre : m.equipe_b_source_ordre;
        var sType = side === 'a' ? m.equipe_a_source_type : m.equipe_b_source_type;
        var sPouleId = side === 'a' ? m.equipe_a_source_poule_id : m.equipe_b_source_poule_id;
        return placeholderLabel(sOrdre, sType, sPouleId, poules);
    }

    function bracketLabel(b) {
        if (b === 'principal') return '🏆 Tableau principal';
        if (b === 'places_5_6') return 'Match places 5-6';
        if (b === 'places_7_8') return 'Match places 7-8';
        if (b === 'places_9_10') return 'Match places 9-10';
        if (b === 'places_11_12') return 'Match places 11-12';
        if (b === 'rang_2') return 'Places 5-6';
        if (b === 'rang_3') return 'Places 7-9';
        if (b === 'rang_4') return 'Places 10-12';
        return b || 'Phase finale';
    }

    function computeClassementFinal(matchs, equipes) {
        var byBracket = {};
        matchs.filter(function (m) { return m.phase === 'finale'; }).forEach(function (m) {
            (byBracket[m.bracket] = byBracket[m.bracket] || []).push(m);
        });
        Object.keys(byBracket).forEach(function (k) {
            byBracket[k].sort(function (a, b) { return a.ordre - b.ordre; });
        });
        var nomFor = function (id) {
            if (!id) return null;
            var e = findEq(equipes, id);
            return e ? e.nom : null;
        };
        var winnerOf = function (m) {
            if (!m || m.status !== 'termine' || !m.vainqueur_id) return null;
            return m.vainqueur_id;
        };
        var loserOf = function (m) {
            if (!m || m.status !== 'termine' || !m.vainqueur_id) return null;
            return m.vainqueur_id === m.equipe_a_id ? m.equipe_b_id : m.equipe_a_id;
        };
        var places = [];
        var principal = byBracket['principal'] || [];
        if (principal.length >= 4) {
            var demi1 = principal[0], demi2 = principal[1];
            var finaleMatch = null, petiteFinale = null;
            for (var i = 2; i < principal.length; i++) {
                var m = principal[i];
                var hasWinners = m.equipe_a_id && m.equipe_b_id && demi1.vainqueur_id && demi2.vainqueur_id
                    && (m.equipe_a_id === demi1.vainqueur_id || m.equipe_a_id === demi2.vainqueur_id)
                    && (m.equipe_b_id === demi1.vainqueur_id || m.equipe_b_id === demi2.vainqueur_id);
                if (hasWinners) finaleMatch = m; else petiteFinale = m;
            }
            places.push({ place: 1, nom: nomFor(winnerOf(finaleMatch)) });
            places.push({ place: 2, nom: nomFor(loserOf(finaleMatch)) });
            places.push({ place: 3, nom: nomFor(winnerOf(petiteFinale)) });
            places.push({ place: 4, nom: nomFor(loserOf(petiteFinale)) });
        }
        var addSinglePair = function (k, w, l) {
            var b = byBracket[k]; var m = b && b[0];
            places.push({ place: w, nom: nomFor(winnerOf(m)) });
            places.push({ place: l, nom: nomFor(loserOf(m)) });
        };
        if (byBracket['places_5_6']) addSinglePair('places_5_6', 5, 6);
        if (byBracket['places_7_8']) addSinglePair('places_7_8', 7, 8);
        if (byBracket['places_9_10']) addSinglePair('places_9_10', 9, 10);
        if (byBracket['places_11_12']) addSinglePair('places_11_12', 11, 12);
        places.sort(function (a, b) { return a.place - b.place; });
        return places;
    }

    async function load() {
        var wantedId = getParam('t');
        var tournoi = null;
        if (wantedId) {
            var r = await supa.from('tournois').select('*').eq('id', wantedId).maybeSingle();
            tournoi = r.data;
        }
        if (!tournoi) {
            // fallback : tournoi actif
            var ra = await supa.from('tournois').select('*').eq('status', 'actif').order('created_at', { ascending: false }).limit(1);
            tournoi = ra.data && ra.data[0];
        }
        if (!tournoi) {
            document.getElementById('content').innerHTML = '<p class="empty">Aucun tournoi à imprimer.</p>';
            return;
        }
        var [resP, resE, resM] = await Promise.all([
            supa.from('poules').select('*').eq('tournoi_id', tournoi.id).order('ordre'),
            supa.from('equipes').select('*').eq('tournoi_id', tournoi.id).order('nom'),
            supa.from('matchs').select('*').eq('tournoi_id', tournoi.id).order('ordre')
        ]);
        render(tournoi, resP.data || [], resE.data || [], resM.data || []);
    }

    function render(tournoi, poules, equipes, matchs) {
        var c = document.getElementById('content');
        c.innerHTML = '';

        // === En-tête (titre + meta à gauche, QR code à droite) ===
        var headerRow = el('div', { class: 'header-row' });
        var headerInfo = el('div', { class: 'header-info' });
        headerInfo.appendChild(el('h1', null, tournoi.nom));
        var metaParts = [];
        if (tournoi.date) metaParts.push('📅 ' + tournoi.date);
        metaParts.push('🏟️ ' + tournoi.nb_terrains + ' terrain' + (tournoi.nb_terrains > 1 ? 's' : ''));
        var f = formatLabel(tournoi.format_score);
        if (f) metaParts.push('🎾 ' + f);
        if (tournoi.no_ad) metaParts.push('No-ad');
        if (tournoi.mode_classement === 'fft') metaParts.push('FFT');
        headerInfo.appendChild(el('p', { class: 'meta' }, metaParts.join(' · ')));
        headerRow.appendChild(headerInfo);

        // QR code (si lib disponible)
        if (window.QRCode) {
            var qrBlock = el('div', { class: 'qr-block' });
            var qrImg = el('div', { class: 'qr-img' });
            qrBlock.appendChild(qrImg);
            qrBlock.appendChild(el('div', { class: 'qr-caption' }, 'Scanner pour suivre le tournoi en direct'));
            headerRow.appendChild(qrBlock);
            try {
                new QRCode(qrImg, {
                    text: window.location.origin + '/live/tournoi/',
                    width: 140, height: 140,
                    colorDark: '#680920', colorLight: '#ffffff',
                    correctLevel: QRCode.CorrectLevel.M
                });
            } catch (err) { console.error(err); }
        }

        c.appendChild(headerRow);

        // === Poules ===
        if (poules.length > 0) {
            c.appendChild(el('h2', null, 'Poules & équipes'));
            var grid = el('div', { class: 'poules-grid' });
            poules.slice().sort(function (a, b) { return a.ordre - b.ordre; }).forEach(function (p) {
                var pd = el('div', { class: 'poule' });
                pd.appendChild(el('h3', null, p.nom));
                if (p.terrain) pd.appendChild(el('div', { class: 'poule-terrain' }, '🏟️ Terrain ' + p.terrain));
                var eqs = equipes.filter(function (e) { return e.poule_id === p.id; })
                    .sort(function (a, b) { return a.nom.localeCompare(b.nom); });
                var ul = el('ul', { class: 'poule-equipes' });
                if (eqs.length === 0) {
                    ul.appendChild(el('li', null, '— aucune équipe —'));
                } else {
                    eqs.forEach(function (eq) {
                        var li = el('li');
                        li.appendChild(document.createTextNode(eq.nom));
                        // Affiche niveau ou poids FFT
                        if (tournoi.mode_classement === 'fft' && (eq.points_j1 != null || eq.points_j2 != null)) {
                            var sum = (eq.points_j1 || 0) + (eq.points_j2 || 0);
                            li.appendChild(el('span', { class: 'niveau' }, '(' + sum + ' pts)'));
                        } else if (eq.niveau != null) {
                            li.appendChild(el('span', { class: 'niveau' }, '(niv. ' + eq.niveau + ')'));
                        }
                        ul.appendChild(li);
                    });
                }
                pd.appendChild(ul);
                grid.appendChild(pd);
            });
            c.appendChild(grid);
        }

        // === Matchs de poule ===
        var matchsPoule = matchs.filter(function (m) { return m.phase === 'poule'; });
        if (matchsPoule.length > 0) {
            c.appendChild(el('h2', null, 'Matchs de poule'));
            var sec = el('div', { class: 'matchs-section' });
            // Une table par poule
            poules.slice().sort(function (a, b) { return a.ordre - b.ordre; }).forEach(function (p) {
                var ms = matchsPoule.filter(function (m) { return m.poule_id === p.id; })
                    .sort(function (a, b) { return a.ordre - b.ordre; });
                if (ms.length === 0) return;
                var box = el('div', { class: 'matchs-bracket' });
                box.appendChild(el('h3', null, p.nom));
                box.appendChild(buildMatchTable(ms, equipes, poules));
                sec.appendChild(box);
            });
            c.appendChild(sec);
        }

        // === Phase finale ===
        var matchsFinale = matchs.filter(function (m) { return m.phase === 'finale'; });
        if (matchsFinale.length > 0) {
            c.appendChild(el('h2', null, 'Phase finale'));
            var byBracket = {};
            matchsFinale.forEach(function (m) { (byBracket[m.bracket] = byBracket[m.bracket] || []).push(m); });
            var order = function (b) {
                if (b === 'principal') return 0;
                if (b === 'places_5_6') return 5;
                if (b === 'places_7_8') return 7;
                if (b === 'places_9_10') return 9;
                if (b === 'places_11_12') return 11;
                if (b && b.indexOf('rang_') === 0) return parseInt(b.split('_')[1], 10);
                return 99;
            };
            Object.keys(byBracket).sort(function (a, b) { return order(a) - order(b); }).forEach(function (bk) {
                var box = el('div', { class: 'matchs-bracket' });
                box.appendChild(el('h3', null, bracketLabel(bk)));
                box.appendChild(buildMatchTable(byBracket[bk].sort(function (a, b) { return a.ordre - b.ordre; }), equipes, poules));
                c.appendChild(box);
            });

            // === Classement final ===
            var classement = computeClassementFinal(matchs, equipes);
            if (classement.length > 0) {
                var cf = el('div', { class: 'classement-final' });
                cf.appendChild(el('h3', null, '🥇 Classement final'));
                var t = el('table');
                classement.forEach(function (p) {
                    var tr = el('tr');
                    tr.appendChild(el('td', { class: 'rank' }, '#' + p.place));
                    tr.appendChild(el('td', null, p.nom || '— en attente —'));
                    t.appendChild(tr);
                });
                cf.appendChild(t);
                c.appendChild(cf);
            }
        }
    }

    function buildMatchTable(ms, equipes, poules) {
        var t = el('table', { class: 'matchs' });
        var head = el('tr');
        ['#', 'Équipe A', 'Score', 'Équipe B', 'Terrain', 'Statut'].forEach(function (h) {
            head.appendChild(el('th', null, h));
        });
        t.appendChild(head);
        ms.forEach(function (m) {
            var row = el('tr', { class: m.status });
            row.appendChild(el('td', null, String(m.ordre + 1)));
            row.appendChild(el('td', null, eqLabel(m, 'a', equipes, poules)));
            var scoreText = '—';
            if (m.score_a || m.score_b) {
                scoreText = (m.score_a || '?') + ' / ' + (m.score_b || '?');
            }
            row.appendChild(el('td', { class: 'score' }, scoreText));
            row.appendChild(el('td', null, eqLabel(m, 'b', equipes, poules)));
            row.appendChild(el('td', { class: 'terrain' }, m.terrain ? 'T' + m.terrain : '—'));
            var statusTxt = m.status === 'termine' ? '✓ joué'
                : m.status === 'en_cours' ? '● en cours' : '○ à jouer';
            row.appendChild(el('td', null, statusTxt));
            t.appendChild(row);
        });
        return t;
    }

    load();
})();
