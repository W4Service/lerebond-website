/* ============================================
   AMERICANO — Vue joueurs (mobile, lecture seule)
   Classement live + tour en cours + qui se repose + grille.
   ============================================ */
(function () {
    'use strict';

    var AP = window.AmericanoPublic;
    var root = document.getElementById('amp-root');
    var vue = 'live';   // 'live' | 'classement' | 'grille'
    var rafId = null;

    function esc(s) {
        return String(s === null || s === undefined ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function rendre() {
        var e = AP.etat;

        if (e.erreur) {
            root.innerHTML = '<div class="amp-empty">Impossible de charger le tournoi.<br><small>' + esc(e.erreur) + '</small></div>';
            return;
        }
        if (!e.chargé) { root.innerHTML = '<div class="amp-empty">Chargement…</div>'; return; }
        if (!e.tournoi) {
            root.innerHTML = '<div class="amp-empty">Aucun tournoi en cours.<br><small>Rendez-vous au comptoir pour vous inscrire.</small></div>';
            return;
        }

        var t = e.tournoi;
        var termine = t.status === 'termine';

        var html = '';

        // En-tête
        html += '<div class="amp-header">' +
            '<img src="img/logo-blanc.webp" alt="Le Rebond" class="amp-logo" onerror="this.src=\'img/logo-8.webp\'">' +
            '<div class="amp-title">' + esc(t.nom) + '</div>' +
            '<div class="amp-sub">' +
                (termine
                    ? 'Tournoi terminé'
                    : 'Tour ' + t.tour_courant + ' / ' + t.nb_tours) +
                ' · ' + e.joueurs.length + ' joueurs · ' +
                (t.format_match === 'points' ? 'en ' + t.points_cible + ' pts' : 'au temps') +
            '</div>' +
        '</div>';

        html += '<div class="amp-wrap">';

        // Chrono (seulement en cours)
        if (!termine) {
            var c = AP.chronoRestant();
            var cls = c.status === 'finished' || c.restant <= 0 ? ' amp-chrono-time--fin'
                    : (c.status === 'idle' ? ' amp-chrono-time--idle' : '');
            var label = c.status === 'running' ? 'Temps restant'
                      : c.status === 'paused' ? 'En pause'
                      : c.status === 'finished' ? 'Temps écoulé'
                      : 'Tour pas encore lancé';
            html += '<div class="amp-chrono">' +
                '<div class="amp-chrono-label">' + label + '</div>' +
                '<div class="amp-chrono-time' + cls + '" id="amp-chrono">' + AP.fmtTemps(c.restant) + '</div>' +
            '</div>';
        }

        // Onglets
        var onglets = [
            { id: 'live', label: termine ? '🎾 Résultats' : '🎾 En cours' },
            { id: 'classement', label: '🏆 Classement' },
            { id: 'grille', label: '📋 Grille' }
        ];
        html += '<div class="amp-tabs">' + onglets.map(function (o) {
            return '<button class="amp-tab' + (vue === o.id ? ' amp-tab--on' : '') + '" data-vue="' + o.id + '">' + o.label + '</button>';
        }).join('') + '</div>';

        if (vue === 'live') html += vueLive(termine);
        else if (vue === 'classement') html += vueClassement();
        else html += vueGrille();

        html += '<div class="amp-refresh">Mise à jour automatique</div>';
        html += '</div>';

        root.innerHTML = html;

        root.querySelectorAll('.amp-tab').forEach(function (b) {
            b.addEventListener('click', function () { vue = b.dataset.vue; rendre(); });
        });

        boucleChrono();
    }

    function vueLive(termine) {
        var e = AP.etat;

        if (termine) {
            var cl = AP.classement();
            var top = cl.lignes.slice(0, 3);
            var med = ['🥇', '🥈', '🥉'];
            var h = '<div class="amp-section-title">Podium</div>';
            top.forEach(function (l, i) {
                h += '<div class="amp-match"><div class="amp-match-row">' +
                    '<div class="amp-paire">' + med[i] + ' ' + esc(l.nom) + '</div>' +
                    '<div class="amp-score">' +
                        (cl.memeNombreDeTours ? l.points : l.moyenne.toFixed(1)) +
                    '</div>' +
                '</div></div>';
            });
            return h;
        }

        var matchs = AP.matchsDuTourCourant();
        var repos = AP.reposDuTourCourant();
        var h = '<div class="amp-section-title">Tour ' + e.tournoi.tour_courant + ' — en cours</div>';

        if (!matchs.length) {
            h += '<div class="amp-empty">Aucun match pour ce tour.</div>';
        }

        matchs.forEach(function (m) {
            h += '<div class="amp-match">' +
                '<div class="amp-match-head"><span>Terrain ' + m.terrain + '</span>' +
                    (m.valide ? '<span>terminé</span>' : '<span>en jeu</span>') +
                '</div>' +
                '<div class="amp-match-row">' +
                    '<div class="amp-paire">' + esc(m.equipeA[0]) + '<br>' + esc(m.equipeA[1]) + '</div>' +
                    '<div class="amp-score' + (m.scoreA === null || m.scoreA === undefined ? ' amp-score--vide' : '') + '">' +
                        (m.scoreA === null || m.scoreA === undefined ? '–' : m.scoreA) + '</div>' +
                '</div>' +
                '<div class="amp-vs">VS</div>' +
                '<div class="amp-match-row">' +
                    '<div class="amp-paire">' + esc(m.equipeB[0]) + '<br>' + esc(m.equipeB[1]) + '</div>' +
                    '<div class="amp-score' + (m.scoreB === null || m.scoreB === undefined ? ' amp-score--vide' : '') + '">' +
                        (m.scoreB === null || m.scoreB === undefined ? '–' : m.scoreB) + '</div>' +
                '</div>' +
            '</div>';
        });

        if (repos.length) {
            h += '<div class="amp-repos">' +
                '<div class="amp-repos-title">☕ Au repos ce tour</div>' +
                '<div class="amp-repos-noms">' + repos.map(esc).join(' · ') + '</div>' +
            '</div>';
        }

        // Ce qui vient ensuite
        var suite = AP.prochainTour();
        if (suite) {
            h += '<div class="amp-section-title">Ensuite — tour ' + suite.tour + '</div>';
            suite.matchs.forEach(function (m) {
                h += '<div class="amp-grille-line">' +
                    '<span class="amp-grille-t">T' + m.terrain + '</span>' +
                    '<span>' + esc(m.equipeA.join(' + ')) + '  <span style="opacity:.4">vs</span>  ' + esc(m.equipeB.join(' + ')) + '</span>' +
                '</div>';
            });
            if (suite.repos.length) {
                h += '<div class="amp-grille-repos">Repos : ' + suite.repos.map(esc).join(', ') + '</div>';
            }
        }

        return h;
    }

    function vueClassement() {
        var cl = AP.classement();
        var surMoy = !cl.memeNombreDeTours;

        var h = '<div class="amp-section-title">Classement</div>';
        if (surMoy) {
            h += '<div class="amp-note">Tous les joueurs n\'ont pas joué le même nombre de tours : ' +
                 'le classement se fait sur la <strong>moyenne de points par tour</strong>.</div>';
        }
        h += '<table class="amp-table"><thead><tr>' +
            '<th>#</th><th>Joueur</th>' +
            '<th' + (surMoy ? ' class="amp-cle"' : '') + '>Moy.</th>' +
            '<th' + (surMoy ? '' : ' class="amp-cle"') + '>Pts</th>' +
            '<th>Diff</th><th>V</th>' +
        '</tr></thead><tbody>';

        cl.lignes.forEach(function (l, i) {
            var cls = i === 0 ? ' class="amp-top1"' : i === 1 ? ' class="amp-top2"' : i === 2 ? ' class="amp-top3"' : '';
            h += '<tr' + cls + '>' +
                '<td class="amp-rang">' + (i + 1) + '</td>' +
                '<td class="amp-nom">' + esc(l.nom) + '</td>' +
                '<td' + (surMoy ? ' class="amp-cle"' : '') + '>' + l.moyenne.toFixed(1) + '</td>' +
                '<td' + (surMoy ? '' : ' class="amp-cle"') + '>' + l.points + '</td>' +
                '<td>' + (l.diff > 0 ? '+' : '') + l.diff + '</td>' +
                '<td>' + l.victoires + '</td>' +
            '</tr>';
        });
        h += '</tbody></table>';
        return h;
    }

    function vueGrille() {
        var e = AP.etat;
        var t = e.tournoi;
        var parOrdre = {};
        e.joueurs.forEach(function (j) { parOrdre[j.ordre] = j.nom; });

        var h = '<div class="amp-section-title">Grille des ' + t.nb_tours + ' tours</div>';
        (t.grille || []).forEach(function (g) {
            var courant = g.tour === t.tour_courant && t.status === 'en_cours';
            h += '<div class="amp-grille-tour">' +
                '<div class="amp-grille-head"><span>Tour ' + g.tour + '</span>' +
                    (courant ? '<span class="amp-grille-badge">en cours</span>' : '') +
                '</div>';
            g.matchs.forEach(function (m) {
                h += '<div class="amp-grille-line">' +
                    '<span class="amp-grille-t">T' + m.terrain + '</span>' +
                    '<span>' + esc(parOrdre[m.a1]) + ' + ' + esc(parOrdre[m.a2]) +
                    '  <span style="opacity:.4">vs</span>  ' +
                    esc(parOrdre[m.b1]) + ' + ' + esc(parOrdre[m.b2]) + '</span>' +
                '</div>';
            });
            if (g.repos && g.repos.length) {
                h += '<div class="amp-grille-repos">Repos : ' +
                    g.repos.map(function (o) { return esc(parOrdre[o]); }).join(', ') + '</div>';
            }
            h += '</div>';
        });
        return h;
    }

    /* Le chrono s'anime sans re-rendre toute la page. */
    function boucleChrono() {
        if (rafId) cancelAnimationFrame(rafId);
        function boucle() {
            var el = document.getElementById('amp-chrono');
            if (!el) return;
            var c = AP.chronoRestant();
            el.textContent = AP.fmtTemps(c.restant);
            el.classList.toggle('amp-chrono-time--fin', c.restant <= 0 && c.status !== 'idle');
            if (c.status === 'running') rafId = requestAnimationFrame(boucle);
        }
        boucle();
    }

    AP.onMaj(rendre);
    rendre();
    AP.demarrer(8000);

})();
