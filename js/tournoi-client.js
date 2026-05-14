/* ============================================
   TOURNOI CLIENT (vue publique live)
   ============================================ */
(function () {
    var supa = window.LeRebondSupa;
    if (!supa) { document.getElementById('tournoi-content').textContent = 'Erreur Supabase'; return; }

    var currentTournoi = null;
    var poules = [];
    var equipes = [];
    var matchs = [];

    async function loadAll() {
        var resT = await supa.from('tournois').select('*').eq('status', 'actif').order('created_at', { ascending: false }).limit(1);
        if (!resT.data || resT.data.length === 0) {
            currentTournoi = null;
            render();
            return;
        }
        currentTournoi = resT.data[0];

        var [resP, resE, resM] = await Promise.all([
            supa.from('poules').select('*').eq('tournoi_id', currentTournoi.id).order('ordre'),
            supa.from('equipes').select('*').eq('tournoi_id', currentTournoi.id).order('nom'),
            supa.from('matchs').select('*').eq('tournoi_id', currentTournoi.id).order('ordre')
        ]);
        poules = resP.data || [];
        equipes = resE.data || [];
        matchs = resM.data || [];
        render();
    }

    function subscribe() {
        supa.channel('tournoi-realtime')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'tournois' }, loadAll)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'poules' }, loadAll)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'equipes' }, loadAll)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'matchs' }, loadAll)
            .subscribe();
    }

    function el(tag, attrs, children) {
        var e = document.createElement(tag);
        if (attrs) Object.keys(attrs).forEach(function (k) {
            if (k === 'class') e.className = attrs[k];
            else if (k === 'style') e.style.cssText = attrs[k];
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

    function findEq(id) { return equipes.find(function (e) { return e.id === id; }); }
    function findPoule(id) { return poules.find(function (p) { return p.id === id; }); }

    // Classement en temps réel d'une poule
    var FORMAT_HAS_SETS = {
        format_a: true, format_b: true, format_c: true, format_d: true,
        format_e: false, americano: false, libre: false
    };
    function manche(raw) {
        if (raw == null) return NaN;
        var m = String(raw).match(/^(\d+)/);
        return m ? parseInt(m[1], 10) : NaN;
    }
    function computeClassement(pouleId) {
        var eqs = equipes.filter(function (e) { return e.poule_id === pouleId; });
        var stats = {};
        eqs.forEach(function (e) {
            stats[e.id] = { id: e.id, nom: e.nom, mj: 0, v: 0, d: 0, sg: 0, sp: 0, jg: 0, jp: 0 };
        });
        var fmt = currentTournoi && currentTournoi.format_score;
        var hasSets = FORMAT_HAS_SETS[fmt];

        var matchsPoule = matchs.filter(function (m) {
            return m.poule_id === pouleId && m.phase === 'poule' && m.status === 'termine';
        });
        matchsPoule.forEach(function (m) {
            if (!stats[m.equipe_a_id] || !stats[m.equipe_b_id]) return;
            stats[m.equipe_a_id].mj++; stats[m.equipe_b_id].mj++;
            if (m.vainqueur_id === m.equipe_a_id) { stats[m.equipe_a_id].v++; stats[m.equipe_b_id].d++; }
            else if (m.vainqueur_id === m.equipe_b_id) { stats[m.equipe_b_id].v++; stats[m.equipe_a_id].d++; }
            if (hasSets) {
                var splitter = /[\s,/;]+/;
                var aArr = (m.score_a || '').trim().split(splitter).filter(Boolean);
                var bArr = (m.score_b || '').trim().split(splitter).filter(Boolean);
                var n = Math.min(aArr.length, bArr.length);
                for (var i = 0; i < n; i++) {
                    var a = manche(aArr[i]), b = manche(bArr[i]);
                    if (isNaN(a) || isNaN(b)) continue;
                    stats[m.equipe_a_id].jg += a; stats[m.equipe_a_id].jp += b;
                    stats[m.equipe_b_id].jg += b; stats[m.equipe_b_id].jp += a;
                    if (a > b) { stats[m.equipe_a_id].sg++; stats[m.equipe_b_id].sp++; }
                    else if (b > a) { stats[m.equipe_b_id].sg++; stats[m.equipe_a_id].sp++; }
                }
            }
        });
        var arr = Object.keys(stats).map(function (k) { return stats[k]; });
        arr.sort(function (a, b) {
            if (b.v !== a.v) return b.v - a.v;
            var dsA = a.sg - a.sp, dsB = b.sg - b.sp;
            if (dsB !== dsA) return dsB - dsA;
            var djA = a.jg - a.jp, djB = b.jg - b.jp;
            if (djB !== djA) return djB - djA;
            return a.nom.localeCompare(b.nom);
        });
        arr.forEach(function (s, i) { s.pos = i + 1; });
        return arr;
    }

    function placeholderLabel(sourceOrdre, sourceType) {
        if (sourceOrdre == null || !sourceType) return '?';
        return (sourceType === 'gagnant' ? 'GM' : 'PM') + (sourceOrdre + 1);
    }
    function equipeNomFromMatch(m, side) {
        var id = side === 'a' ? m.equipe_a_id : m.equipe_b_id;
        if (id) {
            var eq = findEq(id);
            return eq ? eq.nom : '?';
        }
        var sOrdre = side === 'a' ? m.equipe_a_source_ordre : m.equipe_b_source_ordre;
        var sType = side === 'a' ? m.equipe_a_source_type : m.equipe_b_source_type;
        return placeholderLabel(sOrdre, sType);
    }

    function formatLabel(f) {
        switch (f) {
            case 'format_a': return 'Format A · 3 sets de 6 jeux';
            case 'format_b': return 'Format B · 2 sets de 6 jeux + super TB';
            case 'format_c': return 'Format C · 2 sets de 4 jeux + super TB';
            case 'format_d': return 'Format D · 1 set de 9 jeux';
            case 'format_e': return 'Format E · super TB à 10';
            case 'americano': return 'Americano';
            case 'libre': return null;
            // Anciens codes (rétro-compat pour tournois déjà créés)
            case '2sets_supertb': return 'Format B · 2 sets de 6 jeux + super TB';
            case '2sets_classique': return '2 sets + 3ᵉ set complet';
            case 'proset_9jeux': return 'Format D · 1 set de 9 jeux';
            case '1set_6jeux': return '1 set en 6 jeux';
            case '1set_4jeux': return '1 set court (4 jeux)';
            case 'supertb_10': return 'Format E · super TB à 10';
            case 'supertb_15': return 'Super tie-break (15 pts)';
        }
        return null;
    }

    function render() {
        var root = document.getElementById('tournoi-content');
        if (!root) return;
        root.innerHTML = '';

        if (!currentTournoi) {
            root.appendChild(el('div', { class: 'live-empty' }, [
                el('div', { class: 'live-empty-icon' }, '🏆'),
                el('h2', { class: 'live-empty-title' }, 'Aucun tournoi en cours'),
                el('p', { class: 'live-empty-text' }, 'Restez connectés, le prochain tournoi sera bientôt annoncé !')
            ]));
            return;
        }

        // Header
        var header = el('div', { class: 'tournoi-live-header' });
        header.appendChild(el('h1', { class: 'tournoi-live-title' }, currentTournoi.nom));
        var sub = '';
        if (currentTournoi.date) sub += '📅 ' + currentTournoi.date;
        var fmt = formatLabel(currentTournoi.format_score);
        if (fmt) sub += (sub ? ' · ' : '') + '🎾 ' + fmt;
        if (currentTournoi.no_ad) sub += (sub ? ' · ' : '') + 'No-ad';
        if (sub) header.appendChild(el('p', { class: 'tournoi-live-subtitle' }, sub));
        root.appendChild(header);

        // Matchs en cours (en haut, mis en avant)
        var enCours = matchs.filter(function (m) { return m.status === 'en_cours'; });
        if (enCours.length > 0) {
            var liveSection = el('div', { class: 'live-matchs-section' });
            liveSection.appendChild(el('h2', { class: 'live-section-title live-section-title--live' }, '🔴 En direct'));
            var grid = el('div', { class: 'live-matchs-grid' });
            enCours.forEach(function (m) { grid.appendChild(renderLiveMatch(m)); });
            liveSection.appendChild(grid);
            root.appendChild(liveSection);
        }

        // Vue par terrain (matchs à venir + résultats)
        var byTerrain = {};
        var maxTerrain = currentTournoi.nb_terrains || 1;
        for (var t = 1; t <= maxTerrain; t++) byTerrain[t] = [];
        matchs.forEach(function (m) {
            if (m.terrain && byTerrain[m.terrain]) byTerrain[m.terrain].push(m);
        });

        var terrainsSection = el('div', { class: 'terrains-section' });
        Object.keys(byTerrain).forEach(function (t) {
            var list = byTerrain[t];
            var card = el('div', { class: 'terrain-card' });
            card.appendChild(el('h3', { class: 'terrain-card-title' }, '🏟️ Terrain ' + t));

            var prochains = list.filter(function (m) { return m.status === 'en_attente'; });
            var resultats = list.filter(function (m) { return m.status === 'termine'; });

            if (prochains.length > 0) {
                card.appendChild(el('div', { class: 'terrain-subsection' }, [
                    el('h4', { class: 'terrain-subtitle' }, '⏭️ Prochains matchs'),
                    el('div', { class: 'matchs-mini-list' }, prochains.slice(0, 3).map(renderMatchMini))
                ]));
            }
            if (resultats.length > 0) {
                card.appendChild(el('div', { class: 'terrain-subsection' }, [
                    el('h4', { class: 'terrain-subtitle' }, '✅ Résultats'),
                    el('div', { class: 'matchs-mini-list' }, resultats.slice(-5).reverse().map(renderMatchMini))
                ]));
            }
            if (prochains.length === 0 && resultats.length === 0) {
                card.appendChild(el('p', { class: 'live-empty-mini' }, 'Aucun match programmé'));
            }
            terrainsSection.appendChild(card);
        });
        root.appendChild(terrainsSection);

        // Phase finale : brackets si la phase est démarrée
        var matchsFinale = matchs.filter(function (m) { return m.phase === 'finale'; });
        if (matchsFinale.length > 0) {
            var finaleSection = el('div', { class: 'finale-live-section' });
            finaleSection.appendChild(el('h2', { class: 'live-section-title' }, '🏆 Phase finale'));

            var byBracket = {};
            matchsFinale.forEach(function (m) {
                var b = m.bracket || 'autre';
                (byBracket[b] = byBracket[b] || []).push(m);
            });
            var order = function (b) {
                if (b === 'principal') return 0;
                if (b.indexOf('rang_') === 0) return parseInt(b.split('_')[1], 10);
                return 99;
            };
            var label = function (b) {
                if (b === 'principal') return '🏆 Tableau principal';
                if (b === 'rang_2') return '🥈 Places 5-6';
                if (b === 'rang_3') return '🥉 Places 7-9';
                if (b === 'rang_4') return '🎾 Places 10-12';
                if (b === 'places_5_6') return '🥈 Places 5-6';
                if (b === 'places_7_8') return '🥉 Places 7-8';
                if (b === 'places_9_10') return '🎾 Places 9-10';
                if (b === 'places_11_12') return '🎾 Places 11-12';
                if (b && b.indexOf('places_') === 0) {
                    return '🎾 Places ' + b.replace('places_', '').split('_').join('-');
                }
                return 'Bracket ' + b;
            };
            Object.keys(byBracket).sort(function (a, b) { return order(a) - order(b); }).forEach(function (bk) {
                var bcard = el('div', { class: 'bracket-live-card' });
                bcard.appendChild(el('h3', { class: 'bracket-live-title' }, label(bk)));
                var list = el('div', { class: 'matchs-mini-list' });
                byBracket[bk].sort(function (a, b) { return a.ordre - b.ordre; })
                    .forEach(function (m) { list.appendChild(renderMatchMini(m)); });
                bcard.appendChild(list);
                finaleSection.appendChild(bcard);
            });
            root.appendChild(finaleSection);
        }

        // Poules : classement + composition
        if (poules.length > 0) {
            var pouleSection = el('div', { class: 'poules-live-section' });
            pouleSection.appendChild(el('h2', { class: 'live-section-title' }, '🏊 Poules'));
            var grid = el('div', { class: 'poules-live-grid' });
            poules.forEach(function (p) { grid.appendChild(renderPouleLive(p)); });
            pouleSection.appendChild(grid);
            root.appendChild(pouleSection);
        }
    }

    function renderLiveMatch(m) {
        var eqA = findEq(m.equipe_a_id);
        var eqB = findEq(m.equipe_b_id);
        var poule = findPoule(m.poule_id);

        var card = el('div', { class: 'live-match' });
        card.appendChild(el('div', { class: 'live-match-meta' },
            (poule ? poule.nom + ' · ' : '') + (m.terrain ? 'Terrain ' + m.terrain : '')
        ));
        var body = el('div', { class: 'live-match-body' });
        body.appendChild(el('div', { class: 'live-match-equipe' + (eqA ? '' : ' live-match-equipe--placeholder') }, equipeNomFromMatch(m, 'a')));
        var scoreEl = el('div', { class: 'live-match-score' });
        scoreEl.appendChild(el('span', null, m.score_a || '–'));
        scoreEl.appendChild(el('span', { class: 'score-sep' }, ':'));
        scoreEl.appendChild(el('span', null, m.score_b || '–'));
        body.appendChild(scoreEl);
        body.appendChild(el('div', { class: 'live-match-equipe' + (eqB ? '' : ' live-match-equipe--placeholder') }, equipeNomFromMatch(m, 'b')));
        card.appendChild(body);

        var pulse = el('span', { class: 'live-pulse' });
        card.appendChild(el('div', { class: 'live-badge' }, [pulse, document.createTextNode(' EN COURS')]));
        return card;
    }

    function renderMatchMini(m) {
        var eqA = findEq(m.equipe_a_id);
        var eqB = findEq(m.equipe_b_id);

        var item = el('div', { class: 'match-mini' });
        var nomA = el('span', { class: 'match-mini-equipe' + (eqA ? '' : ' match-mini-equipe--placeholder') }, equipeNomFromMatch(m, 'a'));
        var nomB = el('span', { class: 'match-mini-equipe' + (eqB ? '' : ' match-mini-equipe--placeholder') }, equipeNomFromMatch(m, 'b'));
        if (m.vainqueur_id === m.equipe_a_id) nomA.classList.add('vainqueur');
        if (m.vainqueur_id === m.equipe_b_id) nomB.classList.add('vainqueur');

        item.appendChild(nomA);
        if (m.status === 'termine') {
            var s = el('span', { class: 'match-mini-score' }, (m.score_a || '–') + ' – ' + (m.score_b || '–'));
            item.appendChild(s);
        } else {
            item.appendChild(el('span', { class: 'match-mini-vs' }, 'vs'));
        }
        item.appendChild(nomB);
        return item;
    }

    function renderPouleLive(p) {
        var card = el('div', { class: 'poule-live-card' });
        var head = el('div', { class: 'poule-live-head' });
        head.appendChild(el('h4', { class: 'poule-live-nom' }, p.nom));
        if (p.terrain) head.appendChild(el('span', { class: 'poule-live-terrain' }, 'Terrain ' + p.terrain));
        card.appendChild(head);

        var classement = computeClassement(p.id);
        var fmt = currentTournoi && currentTournoi.format_score;
        var showSets = FORMAT_HAS_SETS[fmt];

        var table = el('table', { class: 'poule-live-table' });
        // En-tête
        var thead = el('tr', { class: 'poule-live-thead' });
        thead.appendChild(el('th', null, '#'));
        thead.appendChild(el('th', { style: 'text-align:left' }, 'Équipe'));
        thead.appendChild(el('th', { title: 'Matchs joués' }, 'MJ'));
        thead.appendChild(el('th', { title: 'Victoires' }, 'V'));
        if (showSets) thead.appendChild(el('th', { title: 'Diff. sets' }, '±S'));
        if (showSets) thead.appendChild(el('th', { title: 'Diff. jeux' }, '±J'));
        table.appendChild(thead);

        classement.forEach(function (s) {
            var eq = findEq(s.id);
            var row = el('tr');
            row.appendChild(el('td', { class: 'poule-pos' }, s.mj > 0 ? '#' + s.pos : '·'));
            var nomTd = el('td', { class: 'poule-eq' }, eq ? eq.nom : s.nom);
            if (eq && eq.qualifie) nomTd.appendChild(document.createTextNode(' ✓'));
            row.appendChild(nomTd);
            row.appendChild(el('td', { class: 'poule-stat' }, String(s.mj)));
            row.appendChild(el('td', { class: 'poule-stat poule-stat--v' }, String(s.v)));
            if (showSets) {
                var ds = s.sg - s.sp;
                row.appendChild(el('td', { class: 'poule-stat' }, (ds >= 0 ? '+' : '') + ds));
            }
            if (showSets) {
                var dj = s.jg - s.jp;
                row.appendChild(el('td', { class: 'poule-stat' }, (dj >= 0 ? '+' : '') + dj));
            }
            table.appendChild(row);
        });
        card.appendChild(table);
        return card;
    }

    // ===== Init =====
    loadAll().then(subscribe);

    // Fullscreen button
    var fsBtn = document.getElementById('fullscreen-btn');
    if (fsBtn) {
        fsBtn.addEventListener('click', function () {
            if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(function () { });
            else document.exitFullscreen();
        });
    }

    document.addEventListener('keydown', function (e) {
        if (e.code === 'KeyF') {
            if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(function () { });
            else document.exitFullscreen();
        }
    });
})();
