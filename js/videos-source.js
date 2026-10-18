/* ============================================
   VIDÉOS — SOURCE LIVEXPERIENCE (Le Rebond)

   Les vidéos sont hébergées et diffusées par LiveXperience. Leur page publique
   charge sa liste via /master/list_videos.asp, qui répond en HTML avec
   « access-control-allow-origin: * » : on peut donc la lire depuis notre site
   et composer notre propre galerie, au lieu d'encastrer leur iframe telle quelle.

   C'est ce qui permet de masquer une vidéo chez nous : l'iframe était opaque,
   une liste lue par nos soins est filtrable.

   Fragilité à connaître : on lit du HTML, pas une API avec contrat. Si
   LiveXperience change son balisage, extraire() renverra une liste vide. Les
   appelants doivent donc gérer le cas « aucune vidéo » sans casser la page,
   et c'est volontairement ce que fait la galerie publique (elle retombe sur
   l'iframe d'origine).
   ============================================ */
(function (root) {
    'use strict';

    var BASE = 'https://lerebond.livexperience.fr';
    var LISTE = BASE + '/master/list_videos.asp';

    // Terrains, tels que listés par le sélecteur de LiveXperience.
    var TERRAINS = {
        '3119': 'Padel 1',
        '3120': 'Padel 2',
        '3121': 'Padel 3',
        '3122': 'Five'
    };

    // Extrait les vidéos d'une réponse HTML de list_videos.asp.
    //
    // Chaque vignette porte un onclick loadVideo('<nom>','<id_video>') répété
    // (image + titre), d'où le dédoublonnage par id. On lit le document avec
    // DOMParser plutôt qu'au gré d'expressions régulières : le balisage est
    // imbriqué, et un parseur ne se laisse pas surprendre par une apostrophe
    // dans un titre d'équipe.
    function extraire(html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var vues = {};
        var out = [];

        Array.prototype.forEach.call(doc.querySelectorAll('.video-item'), function (item) {
            var lien = item.querySelector('a.avideo[onclick]');
            if (!lien) return;

            var m = /loadVideo\((['"])(.*?)\1\s*,\s*(['"])(.*?)\3\)/.exec(lien.getAttribute('onclick') || '');
            if (!m) return;

            var id = m[4];
            if (!id || vues[id]) return;
            vues[id] = true;

            // Le titre porté par le 2e lien est le plus parlant : « 19h00 | EQUIPE 1 VS EQUIPE 2 (8-13) ».
            var titreEl = item.querySelector('.video-info a.avideo') || lien;
            var dateEl = item.querySelector('.video-info .date');
            var durees = item.querySelectorAll('small.time');
            var img = item.querySelector('img[data-src], img[src]');

            out.push({
                id: id,
                titre: (titreEl.textContent || '').trim() || 'Vidéo',
                // Le terrain vient du texte du lien « channel-name », dont on retire la date.
                terrain: terrainDeItem(item),
                dateTexte: dateEl ? (dateEl.textContent || '').trim() : '',
                date: parseDateFr(dateEl ? dateEl.textContent : ''),
                duree: durees.length ? (durees[durees.length - 1].textContent || '').trim() : '',
                vignette: img ? (img.getAttribute('data-src') || img.getAttribute('src') || '') : '',
                url: BASE + '/video-' + encodeURIComponent(m[2]) + ',' + encodeURIComponent(id) + '&iframe=true'
            });
        });

        return out;
    }

    // Le nom du terrain est mêlé à la date dans le même lien ; on prend ce qui
    // précède la date, et on retombe sur la table des terrains si besoin.
    function terrainDeItem(item) {
        var chan = item.querySelector('.video-info .channel-name');
        if (chan) {
            var clone = chan.cloneNode(true);
            Array.prototype.forEach.call(clone.querySelectorAll('.date'), function (d) {
                d.parentNode.removeChild(d);
            });
            var txt = (clone.textContent || '').replace(/\s+/g, ' ').trim();
            if (txt) return txt;
        }
        return '';
    }

    // « 15/10/2026 19:00:11 » → Date. Renvoie null si illisible : l'affichage
    // se rabat alors sur le texte brut, plutôt que d'afficher « Invalid Date ».
    function parseDateFr(txt) {
        var m = /(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(txt || '');
        if (!m) return null;
        var d = new Date(
            +m[3], +m[2] - 1, +m[1],
            m[4] ? +m[4] : 0, m[5] ? +m[5] : 0, m[6] ? +m[6] : 0
        );
        return isNaN(d.getTime()) ? null : d;
    }

    // Récupère la liste des vidéos.
    //
    // @param {object} opts  { date: 'JJ/MM/AAAA' , terrain: '3122' } — les deux optionnels
    // @returns {Promise<Array>} vidéos, les plus récentes d'abord
    function charger(opts) {
        opts = opts || {};
        var url = LISTE
            + '?date=' + encodeURIComponent(opts.date || '')
            + '&id_terrain=' + encodeURIComponent(opts.terrain || '');

        return fetch(url, { credentials: 'omit' }).then(function (r) {
            if (!r.ok) throw new Error('LiveXperience a répondu ' + r.status);
            return r.text();
        }).then(function (html) {
            var videos = extraire(html);
            videos.sort(function (a, b) {
                if (a.date && b.date) return b.date - a.date;
                return 0;
            });
            return videos;
        });
    }

    root.VideosSource = {
        charger: charger,
        extraire: extraire,
        TERRAINS: TERRAINS,
        BASE: BASE
    };
})(window);
