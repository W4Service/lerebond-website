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
                        render(tournoi, poules || [], equipes || [], matchs || []);
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
    function eqName(equipes, id) {
        var e = findEq(equipes, id);
        return e ? e.nom : '?';
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

    function render(tournoi, poules, equipes, matchs) {
        // Header
        document.getElementById('t-title').textContent = tournoi.nom || 'Tournoi';
        var subParts = [];
        if (tournoi.date) subParts.push('📅 ' + tournoi.date);
        var fmt = formatLabel(tournoi.format_score);
        if (fmt) subParts.push('🎾 ' + fmt);
        if (tournoi.no_ad) subParts.push('No-ad');
        document.getElementById('t-subtitle').textContent = subParts.join(' · ');

        // Matchs en direct (en_cours)
        var liveHtml = '';
        var enCours = [];
        for (var i = 0; i < matchs.length; i++) if (matchs[i].status === 'en_cours') enCours.push(matchs[i]);
        if (enCours.length === 0) {
            liveHtml = '<div class="tv-live-empty">Aucun match en cours</div>';
        } else {
            for (var k = 0; k < enCours.length; k++) {
                var m = enCours[k];
                var poule = null;
                for (var pi = 0; pi < poules.length; pi++) if (poules[pi].id === m.poule_id) { poule = poules[pi]; break; }
                var meta = (poule ? poule.nom + ' · ' : '') + (m.terrain ? 'Terrain ' + m.terrain : '');
                liveHtml += '<div class="tv-match">' +
                    '<div class="tv-match-meta">' + escape(meta) + '</div>' +
                    '<div class="tv-match-body">' +
                        '<div class="tv-match-equipe tv-eq-a">' + escape(eqName(equipes, m.equipe_a_id)) + '</div>' +
                        '<div class="tv-match-score">' + escape(m.score_a || '–') + ' : ' + escape(m.score_b || '–') + '</div>' +
                        '<div class="tv-match-equipe tv-eq-b">' + escape(eqName(equipes, m.equipe_b_id)) + '</div>' +
                    '</div></div>';
            }
        }
        document.getElementById('live-matchs').innerHTML = liveHtml;

        // Classement par poule
        var hasSets = !!FORMAT_HAS_SETS[tournoi.format_score];
        var poulesHtml = '';
        if (poules.length === 0) {
            poulesHtml = '<div class="tv-empty">Pas de poules</div>';
        } else {
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
                    rows += '<tr>' +
                        '<td class="pos">' + (s.mj > 0 ? '#' + s.pos : '·') + '</td>' +
                        '<td class="equipe">' + escape(s.nom) + '</td>' +
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
        }
        document.getElementById('poules-list').innerHTML = poulesHtml;
    }

    // Démarrage
    loadAll();
    // Refresh JS toutes les 10 secondes (sans recharger la page = pas de "flash")
    // En complément du <meta refresh> qui recharge complètement toutes les 60s.
    setInterval(loadAll, 10000);
})();
