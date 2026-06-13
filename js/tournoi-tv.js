/* ============================================
   TOURNOI TV — vue ultra-simple pour TV / Android TV / Chromecast
   Compatible navigateurs anciens (pas de SDK Supabase, juste HTTP REST)
   ============================================ */
(function () {
    if (!window.REBOND_CONFIG || !window.REBOND_CONFIG.SUPABASE_URL || !window.REBOND_CONFIG.SUPABASE_ANON_KEY) {
        document.body.innerHTML = '<div class="tv-error">Config Supabase manquante.</div>';
        return;
    }

    var API = window.REBOND_CONFIG.SUPABASE_URL + '/rest/v1';
    var KEY = window.REBOND_CONFIG.SUPABASE_ANON_KEY;

    // Petit fetch HTTP via XHR, compatible navigateurs anciens
    function get(path, cb) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', API + path, true);
        xhr.setRequestHeader('apikey', KEY);
        xhr.setRequestHeader('Authorization', 'Bearer ' + KEY);
        xhr.setRequestHeader('Accept', 'application/json');
        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) return;
            if (xhr.status >= 200 && xhr.status < 300) {
                try { cb(null, JSON.parse(xhr.responseText)); }
                catch (e) { cb(e); }
            } else {
                cb(new Error('HTTP ' + xhr.status + ' : ' + xhr.responseText));
            }
        };
        xhr.send();
    }

    // Récupère séquentiellement (parallèle = plus de code, on garde simple)
    function loadAll() {
        get('/tournois?status=eq.actif&order=created_at.desc&limit=1', function (err, tournois) {
            if (err) return showError(err);
            if (!tournois || tournois.length === 0) {
                document.getElementById('t-title').textContent = 'Aucun tournoi en cours';
                document.getElementById('t-subtitle').textContent = '';
                document.getElementById('live-matchs').innerHTML = '<div class="tv-empty">Pas de tournoi actif.</div>';
                document.getElementById('poules-list').innerHTML = '';
                return;
            }
            var tournoi = tournois[0];
            get('/poules?tournoi_id=eq.' + tournoi.id + '&order=ordre', function (err, poules) {
                if (err) return showError(err);
                get('/equipes?tournoi_id=eq.' + tournoi.id, function (err, equipes) {
                    if (err) return showError(err);
                    get('/matchs?tournoi_id=eq.' + tournoi.id + '&order=ordre', function (err, matchs) {
                        if (err) return showError(err);
                        // Récupérer aussi les joueurs (pour affichage propre Nom1 / Nom2)
                        get('/joueurs', function (err, joueurs) {
                            // En cas d'erreur (table absente, droits), on continue sans joueurs
                            render(tournoi, poules || [], equipes || [], matchs || [], joueurs || []);
                        });
                    });
                });
            });
        });
    }

    function showError(err) {
        var c = document.getElementById('live-matchs');
        if (c) c.innerHTML = '<div class="tv-error">Erreur : ' + (err.message || err) + '</div>';
    }

    function formatLabel(f) {
        switch (f) {
            case 'format_a': return 'Format A · 3 sets de 6 jeux';
            case 'format_b': return 'Format B · 2 sets de 6 jeux + super TB';
            case 'format_c': return 'Format C · 2 sets de 4 jeux + super TB';
            case 'format_d': return 'Format D · 1 set de 9 jeux';
            case 'format_e': return 'Format E · super TB à 10';
            case '1set_6jeux': return '1 set à 6 jeux';
            case '1set_5jeux': return '1 set à 5 jeux';
            case '1set_4jeux': return '1 set à 4 jeux';
            case 'americano': return 'Americano';
        }
        return null;
    }

    var FORMAT_HAS_SETS = {
        format_a: true, format_b: true, format_c: true, format_d: true,
        format_e: false,
        '1set_6jeux': true, '1set_5jeux': true, '1set_4jeux': true,
        americano: false, libre: false
    };

    function findEq(equipes, id) {
        for (var i = 0; i < equipes.length; i++) if (equipes[i].id === id) return equipes[i];
        return null;
    }
    function findJoueur(joueurs, id) {
        if (!id || !joueurs) return null;
        for (var i = 0; i < joueurs.length; i++) if (joueurs[i].id === id) return joueurs[i];
        return null;
    }
    function eqName(equipes, id) {
        var e = findEq(equipes, id);
        return e ? e.nom : '?';
    }
    // Renvoie [ligne1, ligne2] pour l'affichage 2 lignes (utilisé dans les cartes de match).
    // Ligne 1 (gros) = noms de famille J1 / J2. Ligne 2 (petit) = prénoms J1 · J2.
    function eqLines(equipes, joueurs, id) {
        var e = findEq(equipes, id);
        if (!e) return ['?', ''];
        var j1 = findJoueur(joueurs, e.joueur_j1_id);
        var j2 = findJoueur(joueurs, e.joueur_j2_id);
        if (j1 || j2) {
            var n1 = j1 && j1.nom ? j1.nom : (j1 && j1.prenom ? j1.prenom : ((e.nom || '').split('/')[0] || '?'));
            var n2 = j2 && j2.nom ? j2.nom : (j2 && j2.prenom ? j2.prenom : ((e.nom || '').split('/')[1] || '?'));
            var l1 = String(n1).trim() + ' / ' + String(n2).trim();
            var prenoms = [];
            if (j1 && j1.prenom) prenoms.push(j1.prenom);
            if (j2 && j2.prenom) prenoms.push(j2.prenom);
            var l2 = prenoms.join(' · ');
            return [l1, l2];
        }
        var parts = (e.nom || '').split('/');
        return [
            (parts[0] || e.nom || '?').trim(),
            (parts[1] || '').trim()
        ];
    }

    // Variante utilisée dans le classement de poule : un prénom par ligne (plus de place).
    // Ligne 1 = prénom J1, ligne 2 = prénom J2.
    function eqLinesCompact(equipes, joueurs, id) {
        var e = findEq(equipes, id);
        if (!e) return ['?', ''];
        var j1 = findJoueur(joueurs, e.joueur_j1_id);
        var j2 = findJoueur(joueurs, e.joueur_j2_id);
        if (j1 || j2) {
            var p1 = j1 && j1.prenom ? j1.prenom : (j1 && j1.nom ? j1.nom : ((e.nom || '').split('/')[0] || '?'));
            var p2 = j2 && j2.prenom ? j2.prenom : (j2 && j2.nom ? j2.nom : ((e.nom || '').split('/')[1] || '?'));
            return [String(p1).trim(), String(p2).trim()];
        }
        // Fallback : split sur " / "
        var parts = (e.nom || '').split('/');
        return [
            (parts[0] || e.nom || '?').trim(),
            (parts[1] || '').trim()
        ];
    }
    function manche(raw) {
        if (raw == null) return NaN;
        var m = String(raw).match(/^(\d+)/);
        return m ? parseInt(m[1], 10) : NaN;
    }

    function computeClassement(pouleId, equipes, matchs, hasSets) {
        var eqs = [];
        for (var i = 0; i < equipes.length; i++) if (equipes[i].poule_id === pouleId) eqs.push(equipes[i]);
        var stats = {};
        for (var i2 = 0; i2 < eqs.length; i2++) {
            stats[eqs[i2].id] = { id: eqs[i2].id, nom: eqs[i2].nom, mj: 0, v: 0, d: 0, sg: 0, sp: 0, jg: 0, jp: 0 };
        }
        var splitter = /[\s,\/;]+/;
        for (var k = 0; k < matchs.length; k++) {
            var m = matchs[k];
            if (m.poule_id !== pouleId || m.phase !== 'poule' || m.status !== 'termine') continue;
            if (!stats[m.equipe_a_id] || !stats[m.equipe_b_id]) continue;
            stats[m.equipe_a_id].mj++; stats[m.equipe_b_id].mj++;
            if (m.vainqueur_id === m.equipe_a_id) { stats[m.equipe_a_id].v++; stats[m.equipe_b_id].d++; }
            else if (m.vainqueur_id === m.equipe_b_id) { stats[m.equipe_b_id].v++; stats[m.equipe_a_id].d++; }
            if (hasSets) {
                var aArr = (m.score_a || '').split(splitter);
                var bArr = (m.score_b || '').split(splitter);
                for (var j = 0; j < Math.min(aArr.length, bArr.length); j++) {
                    var aRaw = manche(aArr[j]);
                    var bRaw = manche(bArr[j]);
                    if (isNaN(aRaw) || isNaN(bRaw)) continue;
                    stats[m.equipe_a_id].jg += aRaw; stats[m.equipe_a_id].jp += bRaw;
                    stats[m.equipe_b_id].jg += bRaw; stats[m.equipe_b_id].jp += aRaw;
                    if (aRaw > bRaw) { stats[m.equipe_a_id].sg++; stats[m.equipe_b_id].sp++; }
                    else if (bRaw > aRaw) { stats[m.equipe_b_id].sg++; stats[m.equipe_a_id].sp++; }
                }
            }
        }
        var arr = [];
        for (var key in stats) if (stats.hasOwnProperty(key)) arr.push(stats[key]);
        arr.sort(function (a, b) {
            if (b.v !== a.v) return b.v - a.v;
            var dsA = a.sg - a.sp, dsB = b.sg - b.sp;
            if (dsB !== dsA) return dsB - dsA;
            var djA = a.jg - a.jp, djB = b.jg - b.jp;
            if (djB !== djA) return djB - djA;
            return a.nom.localeCompare(b.nom);
        });
        for (var i3 = 0; i3 < arr.length; i3++) arr[i3].pos = i3 + 1;
        return arr;
    }

    function escape(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // Cherche un match parent dans la liste 'matchs' par poule_id + ordre.
    function trouveMatchParent(matchs, pouleId, ordre) {
        if (pouleId == null || ordre == null) return null;
        for (var i = 0; i < matchs.length; i++) {
            var mm = matchs[i];
            if (mm.phase !== 'poule') continue;
            if (mm.poule_id !== pouleId) continue;
            if (mm.ordre !== ordre) continue;
            return mm;
        }
        return null;
    }

    // Si l'équipe n'est pas encore assignée (placeholder en attente d'un résultat),
    // construit un label parlant. Retourne { line1, line2 } pour qu'on puisse afficher les
    // 2 paires possibles sur 2 lignes (ex: "Marc/Paul ou", "Jean/Luc").
    function placeholderForSide(m, side, poules, matchs, equipes, joueurs) {
        var srcType = side === 'a' ? m.equipe_a_source_type : m.equipe_b_source_type;
        var srcOrdre = side === 'a' ? m.equipe_a_source_ordre : m.equipe_b_source_ordre;
        var srcPouleId = side === 'a' ? m.equipe_a_source_poule_id : m.equipe_b_source_poule_id;
        if (!srcType) return null;

        // gagnant/perdant : on cherche le match parent et on affiche les 2 équipes
        if (srcType === 'gagnant' || srcType === 'perdant') {
            var parent = trouveMatchParent(matchs || [], m.poule_id, srcOrdre);
            if (parent && parent.equipe_a_id && parent.equipe_b_id) {
                var l_a = eqLines(equipes, joueurs, parent.equipe_a_id);
                var l_b = eqLines(equipes, joueurs, parent.equipe_b_id);
                // Format compact : 2 lignes avec "ou" entre
                return {
                    line1: l_a[0] + ' ou',
                    line2: l_b[0],
                    type: srcType  // pour distinguer en CSS si besoin
                };
            }
            // Fallback : pas de match parent ou pas d'équipes → label texte
            var prefix = (srcType === 'gagnant') ? 'Gagnant M' : 'Perdant M';
            return { line1: prefix + ((srcOrdre || 0) + 1), line2: '', type: srcType };
        }

        if (srcType === 'rang_poule') {
            var rangs = { 1: '1er', 2: '2e', 3: '3e', 4: '4e', 5: '5e' };
            var nomP = '?';
            if (srcPouleId) {
                for (var i = 0; i < poules.length; i++) if (poules[i].id === srcPouleId) { nomP = poules[i].nom; break; }
            }
            return { line1: (rangs[srcOrdre] || (srcOrdre + 'e')) + ' ' + nomP, line2: '', type: srcType };
        }
        if (srcType === 'meilleur_2e') return { line1: 'Meilleur 2e', line2: '', type: srcType };
        if (srcType === 'autres_2es') return { line1: 'Autre 2e', line2: '', type: srcType };
        return null;
    }

    function renderEquipeLines(equipes, joueurs, m, side, poules, matchs) {
        var id = side === 'a' ? m.equipe_a_id : m.equipe_b_id;
        var clsExtra = '';
        // Marquer le gagnant en vert si match terminé
        if (m && m.status === 'termine' && m.vainqueur_id === id) clsExtra = ' tv-eq-winner';

        // Si pas d'équipe assignée, on tente d'afficher un placeholder parlant
        if (!id) {
            var ph = placeholderForSide(m, side, poules || [], matchs || [], equipes, joueurs);
            if (ph) {
                var ll1 = '<span class="tv-eq-line tv-eq-line--1">' + escape(ph.line1) + '</span>';
                var ll2 = ph.line2 ? '<span class="tv-eq-line tv-eq-line--2">' + escape(ph.line2) + '</span>' : '';
                return '<div class="tv-match-equipe tv-eq-' + side + ' tv-eq-placeholder">' + ll1 + ll2 + '</div>';
            }
            return '<div class="tv-match-equipe tv-eq-' + side + ' tv-eq-placeholder">' +
                '<span class="tv-eq-line tv-eq-line--1">?</span>' +
                '</div>';
        }

        var lines = eqLines(equipes, joueurs, id);
        var l1 = '<span class="tv-eq-line tv-eq-line--1">' + escape(lines[0]) + '</span>';
        var l2 = lines[1] ? '<span class="tv-eq-line tv-eq-line--2">' + escape(lines[1]) + '</span>' : '';
        return '<div class="tv-match-equipe tv-eq-' + side + clsExtra + '">' + l1 + l2 + '</div>';
    }

    function renderMatchCard(m, poules, equipes, joueurs, opts, matchs) {
        opts = opts || {};
        var poule = null;
        for (var pi = 0; pi < poules.length; pi++) if (poules[pi].id === m.poule_id) { poule = poules[pi]; break; }
        var meta = (poule ? poule.nom + ' · ' : '') + (m.terrain ? 'Terrain ' + m.terrain : '');
        if (opts.bracket) meta = (opts.bracket + ' · ') + meta;
        var scoreLine = '';
        if (m.status === 'en_cours' || m.status === 'termine') {
            scoreLine = '<div class="tv-match-score">' + escape(m.score_a || '–') + ' : ' + escape(m.score_b || '–') + '</div>';
        } else {
            scoreLine = '<div class="tv-match-score tv-match-score--vs">vs</div>';
        }
        var cls = 'tv-match';
        if (m.status === 'en_attente') cls += ' tv-match--upcoming';
        else if (m.status === 'termine') cls += ' tv-match--done';
        return '<div class="' + cls + '">' +
            '<div class="tv-match-meta">' + escape(meta) + '</div>' +
            '<div class="tv-match-body">' +
                renderEquipeLines(equipes, joueurs, m, 'a', poules, matchs) +
                scoreLine +
                renderEquipeLines(equipes, joueurs, m, 'b', poules, matchs) +
            '</div></div>';
    }

    function bracketLabel(b) {
        if (b === 'principal') return '🏆 Principal';
        if (b === 'rang_2') return '🥈 Places 5-7';
        if (b === 'rang_3') return '🥉 Places 8-10';
        if (b === 'rang_4') return 'Places 11-13';
        if (b === 'places_3_4') return 'Match 3ᵉ place';
        if (b === 'places_4_5') return 'Places 4-5';
        if (b === 'places_5_6') return 'Places 5-6';
        if (b === 'places_7_8') return 'Places 7-8';
        if (b === 'places_9_10') return 'Places 9-10';
        if (b === 'places_11_12') return 'Places 11-12';
        return b || '';
    }

    function renderPoulesGrid(poules, equipes, matchs, joueurs, hasSets) {
        var poulesHtml = '';
        if (poules.length === 0) {
            return '<div class="tv-empty">Pas de poules</div>';
        }
        for (var pi2 = 0; pi2 < poules.length; pi2++) {
            var p = poules[pi2];
            var clmt = computeClassement(p.id, equipes, matchs, hasSets);
            var rows = '';
            rows += '<tr>' +
                '<th class="col-pos">#</th>' +
                '<th class="left">Équipe</th>' +
                '<th class="col-mj">MJ</th>' +
                '<th class="col-v">V</th>' +
                (hasSets ? '<th class="col-s">±S</th>' : '') +
                (hasSets ? '<th class="col-j">±J</th>' : '') +
                '</tr>';
            for (var ci = 0; ci < clmt.length; ci++) {
                var s = clmt[ci];
                var ds = s.sg - s.sp;
                var dj = s.jg - s.jp;
                // Classement de poule : 1 prénom par ligne (plus de place horizontale)
                var lines = eqLinesCompact(equipes, joueurs, s.id);
                var nomCell = '<span class="tv-eq-line tv-eq-line--1">' + escape(lines[0]) + '</span>';
                if (lines[1]) nomCell += '<span class="tv-eq-line tv-eq-line--2">' + escape(lines[1]) + '</span>';
                rows += '<tr>' +
                    '<td class="pos">' + (s.mj > 0 ? '#' + s.pos : '·') + '</td>' +
                    '<td class="equipe">' + nomCell + '</td>' +
                    '<td class="col-mj">' + s.mj + '</td>' +
                    '<td class="v col-v">' + s.v + '</td>' +
                    (hasSets ? '<td class="col-s">' + (ds >= 0 ? '+' : '') + ds + '</td>' : '') +
                    (hasSets ? '<td class="col-j">' + (dj >= 0 ? '+' : '') + dj + '</td>' : '') +
                    '</tr>';
            }
            poulesHtml += '<div class="tv-poule">' +
                '<div class="tv-poule-nom">' + escape(p.nom) + (p.terrain ? ' · T' + p.terrain : '') + '</div>' +
                '<table class="tv-poule-table">' + rows + '</table>' +
                '</div>';
        }
        return poulesHtml;
    }

    // Détermine le mode d'affichage TV selon tv_mode + état des matchs
    function determineMode(tournoi, matchs) {
        var force = tournoi.tv_mode || 'auto';
        if (force === 'poule' || force === 'finale') return force;
        // Auto : on bascule en finale dès que tous les matchs de poule sont terminés ET qu'il y a au moins un match finale
        var matchsPoule = matchs.filter(function (m) { return m.phase === 'poule'; });
        var matchsFinale = matchs.filter(function (m) { return m.phase === 'finale'; });
        if (matchsFinale.length > 0) {
            var allPouleDone = matchsPoule.length > 0 && matchsPoule.every(function (m) { return m.status === 'termine'; });
            if (allPouleDone) return 'finale';
        }
        return 'poule';
    }

    function render(tournoi, poules, equipes, matchs, joueurs) {
        joueurs = joueurs || [];
        // Header
        document.getElementById('t-title').textContent = tournoi.nom || 'Tournoi';
        var subParts = [];
        if (tournoi.date) subParts.push('📅 ' + tournoi.date);
        var fmt = formatLabel(tournoi.format_score);
        if (fmt) subParts.push('🎾 ' + fmt);
        if (tournoi.no_ad) subParts.push('No-ad');
        document.getElementById('t-subtitle').textContent = subParts.join(' · ');

        var mode = determineMode(tournoi, matchs);
        var hasSets = !!FORMAT_HAS_SETS[tournoi.format_score];

        var enCours = [];
        for (var i = 0; i < matchs.length; i++) if (matchs[i].status === 'en_cours') enCours.push(matchs[i]);
        // Toggle layout selon présence de matchs en cours
        document.body.setAttribute('data-has-live', enCours.length > 0 ? 'yes' : 'no');

        if (mode === 'finale') {
            renderModeFinale(tournoi, poules, equipes, matchs, joueurs, enCours);
        } else {
            renderModePoule(tournoi, poules, equipes, matchs, joueurs, enCours, hasSets);
        }

        // Bandeau "Derniers résultats" en bas (commun aux 2 modes)
        renderDerniersResultats(matchs, poules, equipes, joueurs);
    }

    // === MODE POULE : classement (gauche) + matchs en cours + prochains (droite) ===
    function renderModePoule(tournoi, poules, equipes, matchs, joueurs, enCours, hasSets) {
        document.body.setAttribute('data-mode', 'poule');

        // Section live
        var liveHtml = '';
        if (enCours.length === 0) {
            liveHtml = '<div class="tv-live-empty">Aucun match en cours</div>';
        } else {
            for (var k = 0; k < enCours.length; k++) {
                liveHtml += renderMatchCard(enCours[k], poules, equipes, joueurs, null, matchs);
            }
        }
        document.getElementById('live-matchs').innerHTML = liveHtml;

        // Prochains matchs à lancer (en_attente, avec ou sans équipes assignées — on affiche
        // les placeholders type "Gagnant M1", "PM2", "1er Poule A" pour les matchs avec dépendances)
        var prochains = [];
        for (var p = 0; p < matchs.length; p++) {
            var m = matchs[p];
            if (m.phase !== 'poule') continue;
            if (m.status !== 'en_attente') continue;
            prochains.push(m);
        }
        prochains.sort(function (a, b) {
            if (a.terrain !== b.terrain) return (a.terrain || 99) - (b.terrain || 99);
            return a.ordre - b.ordre;
        });
        var prochainsHtml = '';
        if (prochains.length === 0) {
            prochainsHtml = '<div class="tv-empty">Tous les matchs sont joués ou en cours</div>';
        } else {
            // Limite plus élevée si pas de match en cours (on a plus de place)
            var maxProchains = enCours.length === 0 ? 8 : 5;
            for (var q = 0; q < Math.min(prochains.length, maxProchains); q++) {
                prochainsHtml += renderMatchCard(prochains[q], poules, equipes, joueurs, null, matchs);
            }
        }
        document.getElementById('upcoming-matchs').innerHTML = prochainsHtml;

        // Classements
        document.getElementById('poules-list').innerHTML = renderPoulesGrid(poules, equipes, matchs, joueurs, hasSets);
        document.getElementById('poules-section-title').textContent = 'Classements de poule';
    }

    // === MODE FINALE : brackets en haut, classement final en bas ===
    function renderModeFinale(tournoi, poules, equipes, matchs, joueurs, enCours) {
        document.body.setAttribute('data-mode', 'finale');

        // En direct
        var liveHtml = '';
        if (enCours.length === 0) {
            liveHtml = '<div class="tv-live-empty">Aucun match en cours</div>';
        } else {
            for (var k = 0; k < enCours.length; k++) {
                var m = enCours[k];
                liveHtml += renderMatchCard(m, poules, equipes, joueurs, { bracket: m.phase === 'finale' ? bracketLabel(m.bracket) : '' }, matchs);
            }
        }
        document.getElementById('live-matchs').innerHTML = liveHtml;

        // Prochains matchs phase finale (avec ou sans équipes assignées, placeholders OK)
        var prochains = matchs.filter(function (m) {
            return m.phase === 'finale' && m.status === 'en_attente';
        });
        prochains.sort(function (a, b) { return a.ordre - b.ordre; });
        var prochainsHtml = '';
        if (prochains.length === 0) {
            prochainsHtml = '<div class="tv-empty">Aucun match programmé</div>';
        } else {
            var maxProchains = enCours.length === 0 ? 8 : 5;
            for (var q = 0; q < Math.min(prochains.length, maxProchains); q++) {
                var mp = prochains[q];
                prochainsHtml += renderMatchCard(mp, poules, equipes, joueurs, { bracket: bracketLabel(mp.bracket) }, matchs);
            }
        }
        document.getElementById('upcoming-matchs').innerHTML = prochainsHtml;

        // Bloc principal : matchs de phase finale groupés par bracket
        document.getElementById('poules-section-title').textContent = 'Tableau final';
        var byBracket = {};
        matchs.forEach(function (m) {
            if (m.phase !== 'finale') return;
            (byBracket[m.bracket] = byBracket[m.bracket] || []).push(m);
        });
        var bracketOrder = function (b) {
            if (b === 'principal') return 0;
            if (b === 'places_3_4') return 0.5;
            if (b === 'rang_2' || b === 'places_5_6') return 1;
            if (b === 'rang_3' || b === 'places_7_8') return 2;
            if (b === 'rang_4' || b === 'places_9_10') return 3;
            if (b === 'places_11_12') return 4;
            return 99;
        };
        var keys = Object.keys(byBracket).sort(function (a, b) { return bracketOrder(a) - bracketOrder(b); });
        var html = '';
        keys.forEach(function (bk) {
            var ms = byBracket[bk].slice().sort(function (a, b) { return a.ordre - b.ordre; });
            html += '<div class="tv-bracket">' +
                '<div class="tv-bracket-title">' + escape(bracketLabel(bk)) + '</div>' +
                '<div class="tv-bracket-matchs">';
            ms.forEach(function (m) {
                html += renderMatchCard(m, poules, equipes, joueurs, null, matchs);
            });
            html += '</div></div>';
        });
        document.getElementById('poules-list').innerHTML = html;
    }

    // === Bandeau "Derniers résultats" ===
    function renderDerniersResultats(matchs, poules, equipes, joueurs) {
        var termines = matchs.filter(function (m) {
            return m.status === 'termine' && m.vainqueur_id && m.finished_at;
        });
        // Tri par finished_at décroissant (les plus récents d'abord)
        termines.sort(function (a, b) {
            if (a.finished_at && b.finished_at) {
                return b.finished_at.localeCompare(a.finished_at);
            }
            return b.ordre - a.ordre;
        });
        var section = document.getElementById('results-section');
        if (termines.length === 0) {
            section.style.display = 'none';
            return;
        }
        // Affiche 4 derniers résultats
        var html = '';
        var nb = Math.min(termines.length, 4);
        for (var i = 0; i < nb; i++) {
            html += '<div class="tv-result-card">';
            html += renderMatchCard(termines[i], poules, equipes, joueurs).replace(/^<div class="tv-match[^"]*">/, '').replace(/<\/div>$/, '');
            html += '</div>';
        }
        document.getElementById('results-list').innerHTML = html;
        section.style.display = '';
    }

    // Démarrage
    loadAll();
    // Refresh JS toutes les 10 secondes (sans recharger la page = pas de "flash")
    // En complément du <meta refresh> qui recharge complètement toutes les 60s.
    setInterval(loadAll, 10000);
})();
