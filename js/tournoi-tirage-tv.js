/* ============================================
   TIRAGE AU SORT — AFFICHAGE TV
   Roue pilotée depuis l'admin, affichée devant les joueurs.
   Le règlement impose un tirage « réalisé devant témoins » : c'est la raison
   d'être de cet écran. L'admin écrit l'état dans tournois.tirage_live ; la TV
   le relit et anime la roue localement.
   Compatible navigateurs anciens (XHR, pas de SDK) comme le reste de la page TV.
   ============================================ */
(function (root) {
    'use strict';

    var POLL_MS = 1200;   // pendant un tirage, on interroge plus vite que les 10 s habituelles

    function el(tag, cls, txt) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (txt != null) e.textContent = txt;
        return e;
    }

    function TirageTV(opts) {
        this.api = opts.api;
        this.key = opts.key;
        this.conteneur = opts.conteneur;
        this.tournoiId = null;
        this.dernierEtat = null;
        this.timer = null;
        this.rotation = 0;
    }

    TirageTV.prototype.get = function (path, cb) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', this.api + path, true);
        xhr.setRequestHeader('apikey', this.key);
        xhr.setRequestHeader('Authorization', 'Bearer ' + this.key);
        xhr.setRequestHeader('Accept', 'application/json');
        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) return;
            if (xhr.status >= 200 && xhr.status < 300) {
                try { cb(null, JSON.parse(xhr.responseText)); } catch (e) { cb(e); }
            } else { cb(new Error('HTTP ' + xhr.status)); }
        };
        xhr.send();
    };

    TirageTV.prototype.demarrer = function (tournoiId) {
        this.tournoiId = tournoiId;
        var self = this;
        if (this.timer) clearInterval(this.timer);
        this.timer = setInterval(function () { self.rafraichir(); }, POLL_MS);
        this.rafraichir();
    };

    TirageTV.prototype.arreter = function () {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    };

    TirageTV.prototype.rafraichir = function () {
        var self = this;
        if (!this.tournoiId) return;
        this.get('/tournois?id=eq.' + this.tournoiId + '&select=tirage_live', function (err, rows) {
            if (err || !rows || !rows.length) return;
            var etat = rows[0].tirage_live;
            var sig = JSON.stringify(etat);
            if (sig === self.dernierEtat) return;   // rien de neuf, on n'anime pas
            self.dernierEtat = sig;
            self.afficher(etat);
        });
    };

    // etat : null | { phase, paires, etape, total, equipe, poule, poules, motif, tire }
    //   phase 'attente'  : tirage annoncé, pas encore commencé
    //   phase 'roue'     : la roue tourne sur la paire en cours
    //   phase 'resultat' : la paire vient d'être placée
    //   phase 'fini'     : tirage terminé, récapitulatif
    TirageTV.prototype.afficher = function (etat) {
        var c = this.conteneur;
        if (!etat || !etat.phase) {
            c.style.display = 'none';
            c.innerHTML = '';
            return;
        }
        c.style.display = '';
        c.innerHTML = '';

        var box = el('div', 'tirage-tv');
        box.appendChild(el('div', 'tirage-tv-titre', '🎲 Tirage au sort'));

        if (etat.phase === 'attente') {
            box.appendChild(el('div', 'tirage-tv-attente', 'Le tirage va commencer'));
            if (etat.total) {
                box.appendChild(el('div', 'tirage-tv-sous', etat.total + ' paires à placer'));
            }
            c.appendChild(box);
            return;
        }

        if (etat.phase === 'fini') {
            box.appendChild(el('div', 'tirage-tv-attente', 'Tirage terminé'));
            if (etat.poules) box.appendChild(this.grilleePoules(etat.poules));
            c.appendChild(box);
            return;
        }

        // Progression
        if (etat.total) {
            var prog = el('div', 'tirage-tv-progression',
                'Paire ' + (etat.etape || 0) + ' / ' + etat.total);
            box.appendChild(prog);
        }

        // La roue
        var roue = el('div', 'tirage-tv-roue' + (etat.phase === 'roue' ? ' tirage-tv-roue--tourne' : ''));
        var noms = etat.paires || [];
        if (etat.phase === 'roue' && noms.length) {
            // Pendant la rotation, on fait défiler les noms encore en lice.
            var piste = el('div', 'tirage-tv-piste');
            for (var i = 0; i < noms.length; i++) {
                piste.appendChild(el('div', 'tirage-tv-nom', noms[i]));
            }
            roue.appendChild(piste);
        } else if (etat.equipe) {
            roue.appendChild(el('div', 'tirage-tv-nom tirage-tv-nom--sorti', etat.equipe));
        }
        box.appendChild(roue);

        // Résultat
        if (etat.phase === 'resultat') {
            var res = el('div', 'tirage-tv-resultat');
            res.appendChild(el('div', 'tirage-tv-equipe', etat.equipe || ''));
            if (etat.poule) {
                res.appendChild(el('div', 'tirage-tv-fleche', '↓'));
                res.appendChild(el('div', 'tirage-tv-poule', etat.poule));
            }
            if (etat.motif) res.appendChild(el('div', 'tirage-tv-motif', etat.motif));
            box.appendChild(res);
        }

        if (etat.poules) box.appendChild(this.grilleePoules(etat.poules));
        c.appendChild(box);
    };

    // Grille des poules en cours de constitution.
    TirageTV.prototype.grilleePoules = function (poules) {
        var grille = el('div', 'tirage-tv-poules');
        for (var i = 0; i < poules.length; i++) {
            var p = poules[i];
            var carte = el('div', 'tirage-tv-poule-carte');
            carte.appendChild(el('div', 'tirage-tv-poule-nom', p.nom));
            var liste = el('div', 'tirage-tv-poule-liste');
            for (var j = 0; j < (p.equipes || []).length; j++) {
                var e = p.equipes[j];
                var ligne = el('div', 'tirage-tv-poule-eq' + (e.nouveau ? ' tirage-tv-poule-eq--neuf' : ''),
                    (e.ts ? 'TS' + e.ts + ' · ' : '') + e.nom);
                liste.appendChild(ligne);
            }
            carte.appendChild(liste);
            grille.appendChild(carte);
        }
        return grille;
    };

    root.TournoiTirageTV = TirageTV;

})(typeof window !== 'undefined' ? window : globalThis);
