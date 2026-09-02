/* ============================================
   AMERICANO — Écran TV « TIMER »
   Gros décompte + qui joue contre qui sur chaque terrain,
   et qui est au repos. Pensé pour être lu de loin dans la salle.
   ============================================ */
(function () {
    'use strict';

    var AP = window.AmericanoPublic;
    var root = document.getElementById('amtv-root');
    var rafId = null;
    var dernierSignal = null;   // évite de re-sonner en boucle
    var audioCtx = null;

    function esc(s) {
        return String(s === null || s === undefined ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    /* Chaque nom est échappé séparément, le <br> reste un vrai retour à la ligne. */
    function escNoms(arr) { return arr.map(esc).join('<br>'); }

    /* Signal sonore à 0 (si la TV a le son et que l'autoplay est autorisé). */
    function bip() {
        try {
            var AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            if (!audioCtx) audioCtx = new AC();
            if (audioCtx.state === 'suspended') audioCtx.resume();
            [0, 0.45, 0.9].forEach(function (off) {
                var osc = audioCtx.createOscillator(), g = audioCtx.createGain();
                osc.type = 'square'; osc.frequency.value = 880;
                g.gain.setValueAtTime(0.0001, audioCtx.currentTime + off);
                g.gain.exponentialRampToValueAtTime(0.4, audioCtx.currentTime + off + 0.02);
                g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + off + 0.4);
                osc.connect(g); g.connect(audioCtx.destination);
                osc.start(audioCtx.currentTime + off);
                osc.stop(audioCtx.currentTime + off + 0.41);
            });
        } catch (e) { /* pas de son sur cette TV : on continue */ }
    }

    function rendre() {
        var e = AP.etat;

        if (!e.chargé) { root.innerHTML = ecran('Chargement…', ''); return; }
        if (e.erreur)  { root.innerHTML = ecran('Tournoi indisponible', esc(e.erreur)); return; }
        if (!e.tournoi) { root.innerHTML = ecran('Aucun tournoi en cours', 'Le Rebond — Noyon'); return; }

        var t = e.tournoi;

        if (t.status === 'termine') {
            var cl = AP.classement();
            var surMoy = !cl.memeNombreDeTours;
            var med = ['🥇', '🥈', '🥉'];
            var h = '<div class="amtv-timer">' +
                '<div class="amtv-timer-head">' +
                    '<div class="amtv-timer-tour">Tournoi terminé</div>' +
                    '<div class="amtv-timer-sub">' + esc(t.nom) + '</div>' +
                '</div>' +
                '<div class="amtv-timer-matchs" data-n="3">';
            cl.lignes.slice(0, 3).forEach(function (l, i) {
                h += '<div class="amtv-tm">' +
                    '<div class="amtv-tm-terrain">' + med[i] + ' ' + (i + 1) + (i === 0 ? 'er' : 'e') + '</div>' +
                    '<div class="amtv-tm-paire">' + esc(l.nom) + '</div>' +
                    '<div class="amtv-tm-score">' + (surMoy ? l.moyenne.toFixed(1) + ' /tour' : l.points + ' pts') + '</div>' +
                '</div>';
            });
            h += '</div></div>';
            root.innerHTML = h;
            return;
        }

        var c = AP.chronoRestant();
        var matchs = AP.matchsDuTourCourant();
        var repos = AP.reposDuTourCourant();

        var label = c.status === 'running' ? 'Temps restant'
                  : c.status === 'paused' ? '⏸ En pause'
                  : c.status === 'finished' ? "Temps écoulé — fin du tour"
                  : 'Tour pas encore lancé';

        var clsTime = (c.restant <= 0 && c.status !== 'idle') ? ' amtv-timer-time--fin'
                    : (c.status === 'idle' ? ' amtv-timer-time--idle' : '');

        var pct = c.total > 0 ? Math.max(0, Math.min(100, (c.restant / c.total) * 100)) : 0;

        var html = '<div class="amtv-timer">' +
            '<div class="amtv-timer-head">' +
                '<div class="amtv-timer-tour">Tour ' + t.tour_courant + ' / ' + t.nb_tours + '</div>' +
                '<div class="amtv-timer-sub">' + esc(t.nom) + ' · ' +
                    (t.format_match === 'points' ? 'en ' + t.points_cible + ' points' : 'au temps') +
                '</div>' +
            '</div>' +

            '<div class="amtv-timer-clock">' +
                '<div class="amtv-timer-label" id="amtv-label">' + label + '</div>' +
                '<div class="amtv-timer-time' + clsTime + '" id="amtv-time">' + AP.fmtTemps(c.restant) + '</div>' +
            '</div>' +
            '<div class="amtv-timer-bar">' +
                '<div class="amtv-timer-fill' + (c.restant <= 0 ? ' amtv-timer-fill--fin' : '') + '" id="amtv-fill" style="width:' + pct + '%"></div>' +
            '</div>' +

            '<div class="amtv-timer-matchs" data-n="' + Math.min(3, Math.max(1, matchs.length)) + '">';

        matchs.forEach(function (m) {
            html += '<div class="amtv-tm">' +
                '<div class="amtv-tm-terrain">Terrain ' + m.terrain + '</div>' +
                '<div class="amtv-tm-paire">' + escNoms(m.equipeA) + '</div>' +
                '<div class="amtv-tm-vs">VS</div>' +
                '<div class="amtv-tm-paire">' + escNoms(m.equipeB) + '</div>' +
                (m.scoreA != null && m.scoreB != null
                    ? '<div class="amtv-tm-score">' + m.scoreA + ' – ' + m.scoreB + '</div>'
                    : '') +
            '</div>';
        });
        html += '</div>';

        if (repos.length) {
            html += '<div class="amtv-timer-repos">' +
                '<div class="amtv-timer-repos-title">☕ Au repos ce tour</div>' +
                '<div class="amtv-timer-repos-noms">' + repos.map(esc).join(' · ') + '</div>' +
            '</div>';
        }

        html += '</div>';
        root.innerHTML = html;
        boucleChrono();
    }

    function ecran(titre, sub) {
        return '<div class="amtv-empty">' +
            '<img src="img/logo-blanc.webp" alt="Le Rebond" style="height:8vh;object-fit:contain" onerror="this.src=\'img/logo-8.webp\'">' +
            '<div class="amtv-empty-title">' + titre + '</div>' +
            '<div class="amtv-empty-sub">' + sub + '</div>' +
        '</div>';
    }

    function boucleChrono() {
        if (rafId) cancelAnimationFrame(rafId);
        function boucle() {
            var el = document.getElementById('amtv-time');
            if (!el) return;
            var c = AP.chronoRestant();
            el.textContent = AP.fmtTemps(c.restant);

            var fin = c.restant <= 0 && c.status !== 'idle';
            el.classList.toggle('amtv-timer-time--fin', fin);

            var fill = document.getElementById('amtv-fill');
            if (fill) {
                fill.style.width = (c.total > 0 ? Math.max(0, Math.min(100, (c.restant / c.total) * 100)) : 0) + '%';
                fill.classList.toggle('amtv-timer-fill--fin', fin);
            }

            // Signal sonore une seule fois par tour, au passage à zéro.
            var e = AP.etat;
            var cleTour = e.tournoi ? (e.tournoi.id + ':' + e.tournoi.tour_courant) : null;
            if (fin && cleTour && dernierSignal !== cleTour) {
                dernierSignal = cleTour;
                var lab = document.getElementById('amtv-label');
                if (lab) lab.textContent = 'Temps écoulé — fin du tour';
                bip();
            }

            if (c.status === 'running') rafId = requestAnimationFrame(boucle);
        }
        boucle();
    }

    AP.onMaj(rendre);
    rendre();
    AP.demarrer(8000);

    // L'autoplay audio exige souvent une interaction : un clic sur la TV suffit.
    document.addEventListener('click', function () {
        try {
            var AC = window.AudioContext || window.webkitAudioContext;
            if (AC && !audioCtx) audioCtx = new AC();
            if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
        } catch (e) {}
    }, { once: true });

})();
