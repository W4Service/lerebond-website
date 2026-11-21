/* ============================================
   VIDÉOS — GALERIE PUBLIQUE (Le Rebond)

   Remplace l'iframe LiveXperience par notre propre galerie, pour pouvoir
   masquer les vidéos coupées depuis l'administration. Une iframe est opaque :
   on ne peut rien y filtrer. En composant la liste nous-mêmes, on choisit ce
   qui s'affiche.

   Repli volontaire : si notre liste ne peut pas être construite (LiveXperience
   injoignable, balisage changé, base indisponible), on laisse l'iframe
   d'origine en place. Mieux vaut la galerie d'avant que pas de vidéos du tout.

   Attention à l'ordre : on ne retire l'iframe qu'une fois la liste des vidéos
   ET la liste des blocages obtenues. Sans cela, un échec de lecture des
   blocages afficherait des vidéos coupées — exactement ce qu'on veut éviter.
   ============================================ */
(function (root) {
    'use strict';

    function el(tag, attrs, texte) {
        var n = document.createElement(tag);
        if (attrs) Object.keys(attrs).forEach(function (k) {
            if (k === 'class') n.className = attrs[k];
            else n.setAttribute(k, attrs[k]);
        });
        if (texte != null) n.appendChild(document.createTextNode(texte));
        return n;
    }

    function carte(v) {
        var c = el('article', { class: 'video-carte' });
        var lien = el('a', {
            class: 'video-carte__vignette', href: v.url,
            target: '_blank', rel: 'noopener noreferrer',
            'aria-label': 'Regarder ' + v.titre
        });
        if (v.vignette) lien.appendChild(el('img', { src: v.vignette, alt: '', loading: 'lazy' }));
        if (v.duree) lien.appendChild(el('span', { class: 'video-carte__duree' }, v.duree));
        c.appendChild(lien);

        var info = el('div', { class: 'video-carte__info' });
        info.appendChild(el('a', {
            class: 'video-carte__titre', href: v.url,
            target: '_blank', rel: 'noopener noreferrer'
        }, v.titre));
        var meta = [];
        if (v.terrain) meta.push(v.terrain);
        if (v.dateTexte) meta.push(v.dateTexte);
        info.appendChild(el('div', { class: 'video-carte__meta' }, meta.join(' · ')));
        c.appendChild(info);
        return c;
    }

    // Lit les vidéos coupées. En cas d'échec, on renvoie null (et non une liste
    // vide) pour que l'appelant sache distinguer « rien de coupé » de
    // « impossible de savoir » — dans le second cas on garde l'iframe.
    function chargerBlocages() {
        var supa = root.LeRebondSupa;
        if (!supa) return Promise.resolve(null);
        return supa.from('videos_bloquees').select('id_video').then(function (res) {
            if (res.error) {
                console.error('[videos] blocages illisibles :', res.error);
                return null;
            }
            var set = {};
            (res.data || []).forEach(function (b) { set[b.id_video] = true; });
            return set;
        }).catch(function (err) {
            console.error('[videos] blocages illisibles :', err);
            return null;
        });
    }

    // Dates : LiveXperience attend JJ/MM/AAAA, le champ date du navigateur AAAA-MM-JJ.
    function deux(n) { return (n < 10 ? '0' : '') + n; }
    function jour(decalage) { var d = new Date(); d.setDate(d.getDate() - decalage); return d; }
    function versIso(d) { return d.getFullYear() + '-' + deux(d.getMonth() + 1) + '-' + deux(d.getDate()); }
    function versFr(d) { return deux(d.getDate()) + '/' + deux(d.getMonth() + 1) + '/' + d.getFullYear(); }
    function isoVersFr(iso) { var p = (iso || '').split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : ''; }

    // Sans date, LiveXperience ne renvoie que « les 5 vidéos les plus vues ».
    // On ouvre donc sur la journée la plus récente qui a des vidéos (aujourd'hui,
    // hier, avant-hier) et on ne retombe sur les plus vues qu'en dernier recours.
    function premiereListe(i) {
        var date = i < 3 ? jour(i) : null;
        return root.VideosSource.charger(date ? { date: versFr(date) } : {}).then(function (v) {
            if (v.length || !date) return { videos: v, date: date };
            return premiereListe(i + 1);
        });
    }

    function barreFiltres(dateInitiale) {
        var barre = el('div', { class: 'videos-filtres' });

        var champDate = el('label', { class: 'videos-filtres__champ' }, 'Date du match');
        var inputDate = el('input', {
            type: 'date', min: versIso(jour(14)), max: versIso(jour(0)),
            value: dateInitiale ? versIso(dateInitiale) : ''
        });
        champDate.appendChild(inputDate);

        var champTerrain = el('label', { class: 'videos-filtres__champ' }, 'Terrain');
        var select = el('select');
        select.appendChild(el('option', { value: '' }, 'Tous les terrains'));
        Object.keys(root.VideosSource.TERRAINS).forEach(function (id) {
            select.appendChild(el('option', { value: id }, root.VideosSource.TERRAINS[id]));
        });
        champTerrain.appendChild(select);

        barre.appendChild(champDate);
        barre.appendChild(champTerrain);
        return { noeud: barre, date: inputDate, terrain: select };
    }

    function afficher(zone, videos, bloquees, date) {
        var visibles = videos.filter(function (v) { return !bloquees[v.id]; });
        zone.innerHTML = '';
        zone.appendChild(el('p', { class: 'videos-entete' }, date
            ? visibles.length + ' vidéo' + (visibles.length > 1 ? 's' : '') + ' le ' + date
            : 'Les vidéos les plus vues ces derniers jours'));
        if (!visibles.length) {
            zone.appendChild(el('p', { class: 'videos-vide' },
                'Aucune vidéo pour cette sélection. En ligne, les vidéos arrivent le lendemain du match.'));
            return;
        }
        var grille = el('div', { class: 'videos-grille' });
        visibles.forEach(function (v) { grille.appendChild(carte(v)); });
        zone.appendChild(grille);
    }

    // @param {string} selecteur  conteneur de l'iframe à remplacer
    function init(selecteur) {
        var hote = document.querySelector(selecteur || '.replay-iframe-wrapper');
        if (!hote || !root.VideosSource) return;

        Promise.all([
            premiereListe(0).catch(function (err) {
                console.error('[videos] liste indisponible :', err);
                return null;
            }),
            chargerBlocages()
        ]).then(function (r) {
            var videos = r[0] && r[0].videos;
            var bloquees = r[1];

            // Un seul des deux manque : on n'a pas de garantie de filtrage correct.
            if (!videos || !videos.length || !bloquees) return;

            hote.innerHTML = '';
            hote.classList.add('is-galerie');
            var filtres = barreFiltres(r[0].date);
            var zone = el('div', { class: 'videos-zone', 'aria-live': 'polite' });
            hote.appendChild(filtres.noeud);
            hote.appendChild(zone);
            afficher(zone, videos, bloquees, r[0].date ? versFr(r[0].date) : '');

            var demande = 0;
            function recharger() {
                var n = ++demande;
                var date = isoVersFr(filtres.date.value);
                zone.innerHTML = '';
                zone.appendChild(el('p', { class: 'videos-vide' }, 'Chargement des vidéos…'));
                root.VideosSource.charger({ date: date, terrain: filtres.terrain.value }).then(function (v) {
                    if (n === demande) afficher(zone, v, bloquees, date);
                }).catch(function (err) {
                    console.error('[videos] liste indisponible :', err);
                    if (n !== demande) return;
                    zone.innerHTML = '';
                    zone.appendChild(el('p', { class: 'videos-vide' },
                        'Impossible de charger les vidéos pour le moment. Réessayez dans un instant.'));
                });
            }
            filtres.date.addEventListener('change', recharger);
            filtres.terrain.addEventListener('change', recharger);
        });
    }

    root.VideosPublic = { init: init };
})(window);
