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
            target: '_blank', rel: 'noopener noreferrer'
        });
        if (v.vignette) lien.appendChild(el('img', { src: v.vignette, alt: '', loading: 'lazy' }));
        if (v.duree) lien.appendChild(el('span', { class: 'video-carte__duree' }, v.duree));
        c.appendChild(lien);

        var info = el('div', { class: 'video-carte__info' });
        var titre = el('a', {
            class: 'video-carte__titre', href: v.url,
            target: '_blank', rel: 'noopener noreferrer',
            style: 'text-decoration:none;color:inherit'
        }, v.titre);
        info.appendChild(titre);
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

    // @param {string} selecteur  conteneur de l'iframe à remplacer
    function init(selecteur) {
        var hote = document.querySelector(selecteur || '.replay-iframe-wrapper');
        if (!hote || !root.VideosSource) return;

        Promise.all([
            root.VideosSource.charger({}).catch(function (err) {
                console.error('[videos] liste indisponible :', err);
                return null;
            }),
            chargerBlocages()
        ]).then(function (r) {
            var videos = r[0];
            var bloquees = r[1];

            // Un seul des deux manque : on n'a pas de garantie de filtrage correct.
            if (!videos || !videos.length || !bloquees) return;

            var visibles = videos.filter(function (v) { return !bloquees[v.id]; });

            var grille = el('div', { class: 'videos-grille' });
            visibles.forEach(function (v) { grille.appendChild(carte(v)); });

            hote.innerHTML = '';
            if (!visibles.length) {
                hote.appendChild(el('p', { class: 'videos-vide' },
                    'Aucune vidéo disponible pour le moment.'));
                return;
            }
            hote.appendChild(grille);
        });
    }

    root.VideosPublic = { init: init };
})(window);
