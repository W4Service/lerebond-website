/* ============================================
   TOURNOI CLIENT (vue publique live)
   ============================================ */
(function () {
    var supa = window.LeRebondSupa;
    if (!supa) {
        // Diagnostic plus parlant pour identifier la cause (souvent : Chrome trop ancien sur Android TV)
        var raison = 'inconnue';
        if (!window.REBOND_CONFIG) raison = 'config manquante';
        else if (!window.supabase) raison = 'SDK Supabase non chargé (navigateur peut-être trop ancien)';
        else if (typeof window.supabase.createClient !== 'function') raison = 'SDK Supabase corrompu';
        var c = document.getElementById('tournoi-content');
        if (c) {
            c.innerHTML = '<div style="padding:2rem;text-align:center;color:rgba(244,240,230,0.9)">' +
                '<h2 style="font-size:1.4rem;margin-bottom:1rem">⚠️ Impossible de charger le tournoi</h2>' +
                '<p style="margin-bottom:1rem">Raison : ' + raison + '</p>' +
                '<p style="font-size:0.85rem;color:rgba(244,240,230,0.6);margin-bottom:1rem">Navigateur : ' + (navigator.userAgent || '?') + '</p>' +
                '<p>Essaye sur un autre appareil (téléphone, ordinateur) ou mets à jour ton navigateur.</p>' +
                '</div>';
        }
        return;
    }

    var currentTournoi = null;
    var poules = [];
    var equipes = [];
    var matchs = [];
    var closedTournois = []; // historique des tournois clôturés

    // Mapping Terrain n° (tournoi) → id du flux vidéo live (page /videos/live/)
    // T1 = Wuilhome, T2 = W4S, T3 = WEPE (les 3 terrains padel)
    var TERRAIN_VIDEO_ID = { 1: 'wuilhome', 2: 'w4s', 3: 'wepe' };
    function terrainVideoUrl(numTerrain) {
        var id = TERRAIN_VIDEO_ID[numTerrain];
        if (!id) return null;
        return 'videos/live/?terrain=' + id;
    }

    // Si le hash contient #t=<id>, on charge ce tournoi-là (clôturé) au lieu de l'actif.
    function tournoiIdFromHash() {
        var h = window.location.hash || '';
        var m = h.match(/[#&]t=([^&]+)/);
        return m ? decodeURIComponent(m[1]) : null;
    }

    async function loadAll() {
        var [resActif, resCloses] = await Promise.all([
            supa.from('tournois').select('*').eq('status', 'actif').order('created_at', { ascending: false }).limit(1),
            supa.from('tournois').select('*').eq('status', 'cloture').order('updated_at', { ascending: false })
        ]);
        closedTournois = resCloses.data || [];

        var wantedId = tournoiIdFromHash();
        console.log('[tournoi-client] loadAll · hash wantedId =', wantedId, '· tournois cloturés =', closedTournois.length, '· tournoi actif =', resActif.data && resActif.data[0] ? resActif.data[0].nom : '(aucun)');
        var chosen = null;
        if (wantedId) {
            chosen = closedTournois.find(function (t) { return t.id === wantedId; });
            if (!chosen && resActif.data && resActif.data[0] && resActif.data[0].id === wantedId) {
                chosen = resActif.data[0];
            }
            console.log('[tournoi-client] wantedId trouvé ?', chosen ? '✓ ' + chosen.nom + ' (' + chosen.status + ')' : '✗ INTROUVABLE');
        }
        if (!chosen && resActif.data && resActif.data.length > 0) {
            chosen = resActif.data[0];
            console.log('[tournoi-client] fallback sur tournoi actif :', chosen.nom);
        }

        if (!chosen) {
            currentTournoi = null;
            poules = []; equipes = []; matchs = [];
            render();
            return;
        }

        currentTournoi = chosen;
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

    window.addEventListener('hashchange', loadAll);

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
        format_e: false,
        '1set_6jeux': true, '1set_5jeux': true, '1set_4jeux': true,
        americano: false, libre: false
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
        // Fallback : équipe déplacée mais qui a un match terminé dans cette poule → on l'ajoute
        var ajouterEquipeOrpheline = function (eqId) {
            if (!eqId || stats[eqId]) return;
            var e = equipes.find(function (x) { return x.id === eqId; });
            if (e) stats[eqId] = { id: eqId, nom: e.nom, mj: 0, v: 0, d: 0, sg: 0, sp: 0, jg: 0, jp: 0, orpheline: true };
        };
        var fmt = currentTournoi && currentTournoi.format_score;
        var hasSets = FORMAT_HAS_SETS[fmt];

        var matchsPoule = matchs.filter(function (m) {
            return m.poule_id === pouleId && m.phase === 'poule' && m.status === 'termine';
        });
        matchsPoule.forEach(function (m) {
            ajouterEquipeOrpheline(m.equipe_a_id);
            ajouterEquipeOrpheline(m.equipe_b_id);
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

    // Classement final côté client (même logique que côté admin)
    function computeClassementFinal() {
        var byBracket = {};
        matchs.filter(function (m) { return m.phase === 'finale'; }).forEach(function (m) {
            (byBracket[m.bracket] = byBracket[m.bracket] || []).push(m);
        });
        Object.keys(byBracket).forEach(function (k) {
            byBracket[k].sort(function (a, b) { return a.ordre - b.ordre; });
        });
        var nomFor = function (id) {
            if (!id) return null;
            var e = findEq(id);
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
        var pairPlaces = function (m, pw, pl, into) {
            into.push({ place: pw, equipe_id: winnerOf(m), nom: nomFor(winnerOf(m)) });
            into.push({ place: pl, equipe_id: loserOf(m), nom: nomFor(loserOf(m)) });
        };
        var placesPourBracket = function (ms, offset) {
            var out = [];
            if (ms.length === 0) return out;
            var nb = ms.length;
            if (nb === 1) { pairPlaces(ms[0], offset, offset + 1, out); return out; }
            if (nb === 2) {
                var m1 = ms[0], m2 = ms[1];
                var e1 = [m1.equipe_a_id, m1.equipe_b_id].filter(Boolean);
                var e2 = [m2.equipe_a_id, m2.equipe_b_id].filter(Boolean);
                var commune = e1.some(function (id) { return e2.indexOf(id) >= 0; });
                if (commune) {
                    pairPlaces(m2, offset, offset + 1, out);
                    var pb = loserOf(m1);
                    out.push({ place: offset + 2, equipe_id: pb, nom: nomFor(pb) });
                } else {
                    out.push({ place: offset, equipe_id: null, nom: null });
                    out.push({ place: offset + 1, equipe_id: null, nom: null });
                    out.push({ place: offset + 2, equipe_id: loserOf(m1), nom: nomFor(loserOf(m1)) });
                    out.push({ place: offset + 3, equipe_id: loserOf(m2), nom: nomFor(loserOf(m2)) });
                }
                return out;
            }
            if (nb === 4) {
                var d1 = ms[0], d2 = ms[1];
                var fm = null, pf = null;
                for (var i = 2; i < ms.length; i++) {
                    var m = ms[i];
                    var hw = m.equipe_a_id && m.equipe_b_id && d1.vainqueur_id && d2.vainqueur_id
                        && (m.equipe_a_id === d1.vainqueur_id || m.equipe_a_id === d2.vainqueur_id)
                        && (m.equipe_b_id === d1.vainqueur_id || m.equipe_b_id === d2.vainqueur_id);
                    if (hw) fm = m; else pf = m;
                }
                pairPlaces(fm, offset, offset + 1, out);
                pairPlaces(pf, offset + 2, offset + 3, out);
                return out;
            }
            if (nb === 3) {
                var d3a = ms[0], d3b = ms[1], finM = ms[2];
                pairPlaces(finM, offset, offset + 1, out);
                out.push({ place: offset + 2, equipe_id: loserOf(d3a), nom: nomFor(loserOf(d3a)) });
                out.push({ place: offset + 3, equipe_id: loserOf(d3b), nom: nomFor(loserOf(d3b)) });
                return out;
            }
            var finalGen = ms[ms.length - 1];
            pairPlaces(finalGen, offset, offset + 1, out);
            ms.slice(0, -1).forEach(function (mm, idx) {
                var l = loserOf(mm);
                out.push({ place: offset + 2 + idx, equipe_id: l, nom: nomFor(l) });
            });
            return out;
        };

        var places = [];
        var offset = 1;
        var principal = byBracket['principal'] || [];
        if (principal.length > 0) {
            var part = placesPourBracket(principal, offset);
            places = places.concat(part);
            offset += part.length;
        }
        // Tableau B (mode maison 2p×4) : places 5-8 après le principal
        var tableauB = byBracket['tableau_b'] || [];
        if (tableauB.length > 0) {
            var partB = placesPourBracket(tableauB, offset);
            places = places.concat(partB);
            offset += partB.length;
        }
        var maisonBrackets = [
            { key: 'places_3_4', w: 3, l: 4 },
            { key: 'places_4_5', w: 4, l: 5 },
            { key: 'places_5_6', w: 5, l: 6 },
            { key: 'places_7_8', w: 7, l: 8 },
            { key: 'places_9_10', w: 9, l: 10 },
            { key: 'places_11_12', w: 11, l: 12 }
        ];
        maisonBrackets.forEach(function (b) {
            if (byBracket[b.key]) {
                var mm = byBracket[b.key][0];
                places.push({ place: b.w, equipe_id: winnerOf(mm), nom: nomFor(winnerOf(mm)) });
                places.push({ place: b.l, equipe_id: loserOf(mm), nom: nomFor(loserOf(mm)) });
                offset = Math.max(offset, b.l + 1);
            }
        });
        var rangBrackets = Object.keys(byBracket)
            .filter(function (k) { return k.indexOf('rang_') === 0; })
            .map(function (k) { return { key: k, n: parseInt(k.split('_')[1], 10) }; })
            .sort(function (a, b) { return a.n - b.n; });
        rangBrackets.forEach(function (rb) {
            var part = placesPourBracket(byBracket[rb.key], offset);
            places = places.concat(part);
            offset += part.length;
        });
        places.sort(function (a, b) { return a.place - b.place; });
        var seen = {};
        return places.filter(function (p) {
            if (seen[p.place]) return false;
            seen[p.place] = true;
            return true;
        });
    }

    function placeholderLabel(sourceOrdre, sourceType, sourcePouleId) {
        if (!sourceType) return '?';
        if (sourceType === 'gagnant' || sourceType === 'perdant') {
            if (sourceOrdre == null) return '?';
            return (sourceType === 'gagnant' ? 'GM' : 'PM') + (sourceOrdre + 1);
        }
        if (sourceType === 'rang_poule') {
            var rangs = { 1: '1er', 2: '2e', 3: '3e', 4: '4e', 5: '5e' };
            var nomP = '?';
            if (sourcePouleId) {
                var p = findPoule(sourcePouleId);
                if (p) nomP = p.nom;
            }
            return (rangs[sourceOrdre] || (sourceOrdre + 'e')) + ' ' + nomP;
        }
        if (sourceType === 'meilleur_2e') return 'Meilleur 2e';
        if (sourceType === 'autres_2es') return 'Autre 2e';
        return '?';
    }
    function equipeNomFromMatch(m, side) {
        var id = side === 'a' ? m.equipe_a_id : m.equipe_b_id;
        if (id) {
            var eq = findEq(id);
            return eq ? eq.nom : '?';
        }
        var sOrdre = side === 'a' ? m.equipe_a_source_ordre : m.equipe_b_source_ordre;
        var sType = side === 'a' ? m.equipe_a_source_type : m.equipe_b_source_type;
        var sPouleId = side === 'a' ? m.equipe_a_source_poule_id : m.equipe_b_source_poule_id;
        return placeholderLabel(sOrdre, sType, sPouleId);
    }

    function formatLabel(f) {
        switch (f) {
            case 'format_a': return 'Format A · 3 sets de 6 jeux';
            case 'format_b': return 'Format B · 2 sets de 6 jeux + super TB';
            case 'format_c': return 'Format C · 2 sets de 4 jeux + super TB';
            case 'format_d': return 'Format D · 1 set de 9 jeux';
            case 'format_e': return 'Format E · super TB à 10';
            case '1set_6jeux': return '1 set à 6 jeux (TB à 6-6)';
            case '1set_5jeux': return '1 set à 5 jeux (TB à 5-5)';
            case '1set_4jeux': return '1 set à 4 jeux (TB à 4-4)';
            case 'americano': return 'Americano';
            case 'libre': return null;
            // Anciens codes (rétro-compat pour tournois déjà créés)
            case '2sets_supertb': return 'Format B · 2 sets de 6 jeux + super TB';
            case '2sets_classique': return '2 sets + 3ᵉ set complet';
            case 'proset_9jeux': return 'Format D · 1 set de 9 jeux';
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
            // Même sans tournoi actif, montrer l'historique
            if (closedTournois.length > 0) root.appendChild(renderHistorique());
            return;
        }

        var isClosed = currentTournoi.status === 'cloture';

        // Bandeau historique si on visualise un tournoi clôturé
        if (isClosed) {
            var back = el('a', {
                href: '#', class: 'historique-back',
                onclick: function (e) {
                    e.preventDefault();
                    // Vide le hash et recharge manuellement (hashchange peut ne pas se déclencher)
                    if (window.history && window.history.replaceState) {
                        window.history.replaceState(null, '', window.location.pathname + window.location.search);
                    } else {
                        window.location.hash = '';
                    }
                    loadAll();
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                }
            }, '← Revenir au tournoi en cours');
            root.appendChild(back);
        }

        // Header
        var header = el('div', { class: 'tournoi-live-header' });
        header.appendChild(el('h1', { class: 'tournoi-live-title' }, currentTournoi.nom));
        var sub = '';
        if (currentTournoi.date) sub += '📅 ' + currentTournoi.date;
        var fmt = formatLabel(currentTournoi.format_score);
        if (fmt) sub += (sub ? ' · ' : '') + '🎾 ' + fmt;
        if (currentTournoi.no_ad) sub += (sub ? ' · ' : '') + 'No-ad';
        if (isClosed) sub += (sub ? ' · ' : '') + '🔒 Terminé';
        if (sub) header.appendChild(el('p', { class: 'tournoi-live-subtitle' }, sub));

        // Bouton "📱 Partager" : ouvre une popup avec le QR code de la page
        if (window.TournoiQR && !isClosed) {
            var btnQR = el('button', {
                class: 'tournoi-live-share',
                onclick: function () {
                    window.TournoiQR.open(window.location.origin + '/live/tournoi/', 'Tournoi : ' + (currentTournoi.nom || ''));
                },
                title: 'QR code à partager pour suivre le tournoi'
            }, '📱 Partager');
            header.appendChild(btnQR);
        }

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

        // Vue par terrain (matchs à venir + résultats).
        // On exclut le squelette de phase finale tant que celle-ci n'a pas démarré
        // (sinon les placeholders "PM1 vs GM2" pollueraient la liste).
        var byTerrain = {};
        var maxTerrain = currentTournoi.nb_terrains || 1;
        for (var t = 1; t <= maxTerrain; t++) byTerrain[t] = [];
        var finalePhaseActiveTerrains = (currentTournoi && currentTournoi.phase === 'finale')
            || matchs.some(function (m) { return m.phase === 'finale' && (m.status === 'en_cours' || m.status === 'termine'); });
        matchs.forEach(function (m) {
            if (!m.terrain || !byTerrain[m.terrain]) return;
            if (m.phase === 'finale' && !finalePhaseActiveTerrains) return;
            byTerrain[m.terrain].push(m);
        });

        var terrainsSection = el('div', { class: 'terrains-section' });
        Object.keys(byTerrain).forEach(function (t) {
            var list = byTerrain[t];
            var card = el('div', { class: 'terrain-card' });
            // Titre du terrain : cliquable s'il a un flux vidéo associé
            var videoUrl = terrainVideoUrl(parseInt(t, 10));
            if (videoUrl) {
                var titleLink = el('a', {
                    class: 'terrain-card-title terrain-card-title--link',
                    href: videoUrl,
                    title: 'Voir le live vidéo du terrain ' + t
                }, '🏟️ Terrain ' + t + ' · 📺');
                card.appendChild(titleLink);
            } else {
                card.appendChild(el('h3', { class: 'terrain-card-title' }, '🏟️ Terrain ' + t));
            }

            var prochains = list.filter(function (m) { return m.status === 'en_attente'; });
            var resultats = list.filter(function (m) { return m.status === 'termine'; });

            if (prochains.length > 0) {
                card.appendChild(el('div', { class: 'terrain-subsection' }, [
                    el('h4', { class: 'terrain-subtitle' }, '⏭️ Prochains matchs (' + prochains.length + ')'),
                    el('div', { class: 'matchs-mini-list' }, prochains.map(renderMatchMini))
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

        // Phase finale : on affiche seulement si la phase a vraiment démarré (pas juste un squelette pré-généré).
        // Critère : currentTournoi.phase === 'finale' OU au moins un match finale a démarré.
        var matchsFinale = matchs.filter(function (m) { return m.phase === 'finale'; });
        var finalePhaseDemarree = currentTournoi && currentTournoi.phase === 'finale';
        var auMoinsUnMatchFinaleCommence = matchsFinale.some(function (m) { return m.status === 'en_cours' || m.status === 'termine'; });
        if (matchsFinale.length > 0 && (finalePhaseDemarree || auMoinsUnMatchFinaleCommence)) {
            var finaleSection = el('div', { class: 'finale-live-section' });
            finaleSection.appendChild(el('h2', { class: 'live-section-title' }, '🏆 Phase finale'));

            var byBracket = {};
            matchsFinale.forEach(function (m) {
                var b = m.bracket || 'autre';
                (byBracket[b] = byBracket[b] || []).push(m);
            });
            var order = function (b) {
                if (b === 'principal') return 0;
                if (b === 'tableau_b') return 1;
                if (b.indexOf('rang_') === 0) return parseInt(b.split('_')[1], 10);
                return 99;
            };
            var label = function (b) {
                if (b === 'principal') return '🏆 Tableau principal';
                if (b === 'tableau_b') return '🥈 Tableau B · places 5-8';
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

            // Tableau final
            var classementFinal = computeClassementFinal();
            if (classementFinal.length > 0) {
                var cfSection = el('div', { class: 'classement-final-live' });
                cfSection.appendChild(el('h2', { class: 'live-section-title' }, '🥇 Classement final'));
                var table = el('table', { class: 'classement-final-table' });
                var medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
                classementFinal.forEach(function (p) {
                    var row = el('tr', { class: p.equipe_id ? 'place-row' : 'place-row place-row--pending' });
                    row.appendChild(el('td', { class: 'place-rank' }, (medals[p.place] || '') + ' ' + p.place + (p.place === 1 ? 'er' : 'e')));
                    row.appendChild(el('td', { class: 'place-equipe' }, p.nom || '— en attente —'));
                    table.appendChild(row);
                });
                cfSection.appendChild(table);
                root.appendChild(cfSection);
            }
        }

        // Poules : classement + composition
        if (poules.length > 0) {
            var pouleSection = el('div', { class: 'poules-live-section' });
            pouleSection.appendChild(el('h2', { class: 'live-section-title' }, '🎾 Poules'));
            var grid = el('div', { class: 'poules-live-grid' });
            poules.forEach(function (p) { grid.appendChild(renderPouleLive(p)); });
            pouleSection.appendChild(grid);
            root.appendChild(pouleSection);
        }

        // Historique : tournois clôturés (en bas)
        if (closedTournois.length > 0) {
            var historique = renderHistorique();
            if (historique) root.appendChild(historique);
        }
    }

    function renderHistorique() {
        var others = closedTournois.filter(function (t) {
            return !currentTournoi || t.id !== currentTournoi.id;
        });
        if (others.length === 0) return null;
        var section = el('div', { class: 'historique-section' });
        section.appendChild(el('h2', { class: 'live-section-title' }, '📚 Tournois précédents'));
        var list = el('div', { class: 'historique-list' });
        others.forEach(function (t) {
            // À cause de <base href="https://le-rebond.fr/">, un href relatif "#t=xxx" partirait
            // vers la racine. On force la navigation manuelle via onclick : window.location.hash.
            var card = el('a', {
                href: '#t=' + t.id,
                class: 'historique-card',
                onclick: function (e) {
                    e.preventDefault();
                    var newHash = 't=' + t.id;
                    // Si on est déjà sur le bon hash : recharger manuellement (hashchange ne se déclenche pas)
                    if (window.location.hash.replace(/^#/, '') === newHash) {
                        loadAll();
                    } else {
                        window.location.hash = newHash;
                    }
                    // Scroll en haut pour voir le tournoi sélectionné
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                }
            });
            card.appendChild(el('div', { class: 'historique-card-nom' }, t.nom));
            var meta = [];
            if (t.date) meta.push('📅 ' + t.date);
            var fmtLabel = formatLabel(t.format_score);
            if (fmtLabel) meta.push('🎾 ' + fmtLabel);
            if (meta.length > 0) card.appendChild(el('div', { class: 'historique-card-meta' }, meta.join(' · ')));
            list.appendChild(card);
        });
        section.appendChild(list);
        return section;
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
