/* ============================================
   AMERICANO — Écran TV (classement + matchs en cours)
   Lecture seule, plein écran, sans interaction.
   ============================================ */
(function () {
    'use strict';

    var AP = window.AmericanoPublic;
    var root = document.getElementById('amtv-root');
    var rafId = null;

    // Nombre de lignes de classement affichables sans déborder.
    var MAX_LIGNES = 14;
    var pageClassement = 0;
    var rotationTimer = null;

    function esc(s) {
        return String(s === null || s === undefined ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function rendre() {
        var e = AP.etat;

        if (!e.chargé) { root.innerHTML = ecran('Chargement…', ''); return; }
        if (e.erreur)  { root.innerHTML = ecran('Tournoi indisponible', esc(e.erreur)); return; }
        if (!e.tournoi) { root.innerHTML = ecran('Aucun tournoi en cours', 'Le Rebond — Noyon'); return; }

        var t = e.tournoi;
        var termine = t.status === 'termine';
        var cl = AP.classement();
        var surMoy = !cl.memeNombreDeTours;
        var c = AP.chronoRestant();

        // Pagination du classement si beaucoup de joueurs
        var pages = Math.max(1, Math.ceil(cl.lignes.length / MAX_LIGNES));
        if (pageClassement >= pages) pageClassement = 0;
        var slice = cl.lignes.slice(pageClassement * MAX_LIGNES, (pageClassement + 1) * MAX_LIGNES);

        var html = '<div class="amtv">';

        // En-tête
        html += '<div class="amtv-head">' +
            '<img src="img/logo-blanc.webp" alt="Le Rebond" class="amtv-logo" onerror="this.src=\'img/logo-8.webp\'">' +
            '<div class="amtv-title">' + esc(t.nom) + '</div>' +
            '<div class="amtv-meta">' +
                (termine
                    ? '<strong>Terminé</strong>'
                    : '<strong>Tour ' + t.tour_courant + '/' + t.nb_tours + '</strong>') +
                '<br>' + e.joueurs.length + ' joueurs' +
                (termine ? '' : '<br>' + AP.fmtTemps(c.restant)) +
            '</div>' +
        '</div>';

        html += '<div class="amtv-body">';

        // Colonne gauche : matchs en cours (ou podium si terminé)
        html += '<div class="amtv-col">';
        if (termine) {
            html += '<div class="amtv-col-title">Podium</div><div class="amtv-matchs">';
            var med = ['🥇', '🥈', '🥉'];
            cl.lignes.slice(0, 3).forEach(function (l, i) {
                html += '<div class="amtv-match"><div class="amtv-match-row">' +
                    '<div class="amtv-paire">' + med[i] + ' ' + esc(l.nom) + '</div>' +
                    '<div class="amtv-score">' + (surMoy ? l.moyenne.toFixed(1) : l.points) + '</div>' +
                '</div></div>';
            });
            html += '</div>';
        } else {
            html += '<div class="amtv-col-title">Tour ' + t.tour_courant + ' — sur les terrains</div>';
            html += '<div class="amtv-matchs">';
            AP.matchsDuTourCourant().forEach(function (m) {
                html += '<div class="amtv-match">' +
                    '<div class="amtv-match-head"><span>Terrain ' + m.terrain + '</span>' +
                        '<span>' + (m.valide ? 'terminé' : 'en jeu') + '</span></div>' +
                    '<div class="amtv-match-row">' +
                        '<div class="amtv-paire">' + esc(m.equipeA.join(' + ')) + '</div>' +
                        '<div class="amtv-score' + (m.scoreA == null ? ' amtv-score--vide' : '') + '">' +
                            (m.scoreA == null ? '–' : m.scoreA) + '</div>' +
                    '</div>' +
                    '<div class="amtv-vs">VS</div>' +
                    '<div class="amtv-match-row">' +
                        '<div class="amtv-paire">' + esc(m.equipeB.join(' + ')) + '</div>' +
                        '<div class="amtv-score' + (m.scoreB == null ? ' amtv-score--vide' : '') + '">' +
                            (m.scoreB == null ? '–' : m.scoreB) + '</div>' +
                    '</div>' +
                '</div>';
            });
            html += '</div>';

            var repos = AP.reposDuTourCourant();
            if (repos.length) {
                html += '<div class="amtv-repos">' +
                    '<div class="amtv-repos-title">☕ Au repos</div>' +
                    '<div class="amtv-repos-noms">' + repos.map(esc).join(' · ') + '</div>' +
                '</div>';
            }
        }
        html += '</div>';

        // Colonne droite : classement
        html += '<div class="amtv-col">' +
            '<div class="amtv-col-title">Classement' +
                (pages > 1 ? ' (' + (pageClassement + 1) + '/' + pages + ')' : '') +
                (surMoy ? ' — moyenne / tour' : '') +
            '</div>' +
            '<div class="amtv-scroll"><table class="amtv-table"><thead><tr>' +
                '<th>#</th><th>Joueur</th>' +
                '<th' + (surMoy ? ' class="amtv-cle"' : '') + '>Moy</th>' +
                '<th' + (surMoy ? '' : ' class="amtv-cle"') + '>Pts</th>' +
                '<th>Diff</th>' +
            '</tr></thead><tbody>';

        slice.forEach(function (l, i) {
            var rang = pageClassement * MAX_LIGNES + i + 1;
            var cls = rang === 1 ? ' class="amtv-r1"' : rang === 2 ? ' class="amtv-r2"' : rang === 3 ? ' class="amtv-r3"' : '';
            html += '<tr' + cls + '>' +
                '<td class="amtv-rang">' + rang + '</td>' +
                '<td class="amtv-nom">' + esc(l.nom) + '</td>' +
                '<td' + (surMoy ? ' class="amtv-cle"' : '') + '>' + l.moyenne.toFixed(1) + '</td>' +
                '<td' + (surMoy ? '' : ' class="amtv-cle"') + '>' + l.points + '</td>' +
                '<td>' + (l.diff > 0 ? '+' : '') + l.diff + '</td>' +
            '</tr>';
        });
        html += '</tbody></table></div></div>';

        html += '</div>'; // body

        html += '<div class="amtv-foot">' +
            '<span>le-rebond.fr — Noyon</span>' +
            '<span>' + (t.format_match === 'points' ? 'Matchs en ' + t.points_cible + ' points' : 'Matchs au temps') + '</span>' +
        '</div>';

        html += '</div>';
        root.innerHTML = html;

        // Rotation des pages de classement quand il y a trop de joueurs
        if (rotationTimer) clearInterval(rotationTimer);
        if (pages > 1) {
            rotationTimer = setInterval(function () {
                pageClassement = (pageClassement + 1) % pages;
                rendre();
            }, 12000);
        }

        boucleChrono();
    }

    function ecran(titre, sub) {
        return '<div class="amtv-empty">' +
            '<img src="img/logo-blanc.webp" alt="Le Rebond" style="height:8vh;object-fit:contain" onerror="this.src=\'img/logo-8.webp\'">' +
            '<div class="amtv-empty-title">' + titre + '</div>' +
            '<div class="amtv-empty-sub">' + sub + '</div>' +
        '</div>';
    }

    /* Le chrono de l'en-tête s'anime sans re-rendre la page entière. */
    function boucleChrono() {
        if (rafId) cancelAnimationFrame(rafId);
        var meta = root.querySelector('.amtv-meta');
        if (!meta) return;
        function boucle() {
            var e = AP.etat;
            if (!e.tournoi || e.tournoi.status === 'termine') return;
            var c = AP.chronoRestant();
            var m = root.querySelector('.amtv-meta');
            if (!m) return;
            m.innerHTML = '<strong>Tour ' + e.tournoi.tour_courant + '/' + e.tournoi.nb_tours + '</strong>' +
                '<br>' + e.joueurs.length + ' joueurs<br>' + AP.fmtTemps(c.restant);
            if (c.status === 'running') rafId = requestAnimationFrame(boucle);
        }
        boucle();
    }

    AP.onMaj(rendre);
    rendre();
    AP.demarrer(8000);

})();
