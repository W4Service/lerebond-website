/* ============================================
   VIDÉOS — ADMINISTRATION (Le Rebond)

   Voir les vidéos diffusées sur le site, et couper celles qu'on ne veut plus
   afficher — typiquement quand un client exerce son droit à l'image.

   Ce que « couper » fait, et ne fait pas :
   la vidéo est hébergée par LiveXperience. On la masque sur le-rebond.fr ; elle
   reste en ligne chez eux et accessible par lien direct. Pour une suppression
   réelle, il faut la leur demander. L'interface le dit, pour qu'on ne promette
   pas à un client une disparition qui n'a pas eu lieu.
   ============================================ */
(function (root) {
    'use strict';

    // Les 4 bornes, telles que la page /videos/live/ les identifie. Les id
    // doivent rester alignés sur son tableau TERRAINS : c'est la clé du blocage.
    var TERRAINS_LIVE = [
        { id: 'wuilhome', nom: 'Padel 1' },
        { id: 'five',     nom: 'Five' },
        { id: 'w4s',      nom: 'Padel 2' },
        { id: 'wepe',     nom: 'Padel 3' }
    ];

    var supa = null;
    var videos = [];        // ce que LiveXperience expose
    var bloquees = {};      // id_video -> ligne de videos_bloquees
    var terrainsBloques = {};  // terrain_id -> ligne de terrains_bloques
    var filtreTerrain = '';
    var filtreDate = '';
    var chargement = false;
    var erreurSource = null;
    var monte = false;

    function el(tag, attrs, texte) {
        var n = document.createElement(tag);
        if (attrs) Object.keys(attrs).forEach(function (k) {
            if (k === 'class') n.className = attrs[k];
            else if (k === 'onclick') n.addEventListener('click', attrs[k]);
            else if (k === 'onchange') n.addEventListener('change', attrs[k]);
            else if (k === 'oninput') n.addEventListener('input', attrs[k]);
            else n.setAttribute(k, attrs[k]);
        });
        if (texte != null) n.appendChild(document.createTextNode(texte));
        return n;
    }

    function toast(msg, type) {
        if (root.showToast) { root.showToast(msg, type); return; }
        if (type === 'error') alert(msg); else console.log(msg);
    }

    // ===== Données =====

    // Les vidéos bloquées viennent de notre base ; la liste des vidéos, de
    // LiveXperience. Si LiveXperience ne répond pas, on garde la liste des
    // blocages affichable : on peut encore débloquer une vidéo, ce qui est
    // justement l'action urgente en cas d'erreur.
    async function charger() {
        chargement = true;
        erreurSource = null;
        render();

        var resT = await supa.from('terrains_bloques').select('*');
        if (resT.error) {
            toast('Lecture des terrains coupés impossible : ' + resT.error.message, 'error');
            console.error(resT.error);
            terrainsBloques = {};
        } else {
            terrainsBloques = {};
            (resT.data || []).forEach(function (t) { terrainsBloques[t.terrain_id] = t; });
        }

        var resB = await supa.from('videos_bloquees').select('*');
        if (resB.error) {
            toast('Lecture des blocages impossible : ' + resB.error.message, 'error');
            console.error(resB.error);
            bloquees = {};
        } else {
            bloquees = {};
            (resB.data || []).forEach(function (b) { bloquees[b.id_video] = b; });
        }

        try {
            videos = await root.VideosSource.charger({
                date: filtreDate ? isoVersFr(filtreDate) : '',
                terrain: filtreTerrain
            });
        } catch (err) {
            console.error('[videos] source LiveXperience :', err);
            erreurSource = err.message || String(err);
            videos = [];
        }

        chargement = false;
        render();
    }

    // '2026-10-15' (input date) → '15/10/2026' (attendu par LiveXperience)
    function isoVersFr(iso) {
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
        return m ? (m[3] + '/' + m[2] + '/' + m[1]) : '';
    }

    async function bloquer(v) {
        var motif = prompt(
            'Couper « ' + v.titre + ' » de l\'affichage du site.\n\n'
            + 'Motif (visible publiquement — ne pas écrire le nom du client) :',
            'Droit à l\'image'
        );
        if (motif === null) return;

        var ligne = {
            id_video: v.id,
            titre: v.titre,
            terrain: v.terrain || null,
            enregistree: v.date ? v.date.toISOString() : null,
            motif: motif || null
        };

        var res = await supa.from('videos_bloquees').upsert(ligne).select().single();
        if (res.error) {
            toast('Blocage impossible : ' + res.error.message, 'error');
            console.error(res.error);
            return;
        }
        bloquees[v.id] = res.data;
        render();
        toast('Vidéo coupée du site. Elle reste en ligne chez LiveXperience.', 'ok');
    }

    // ===== Diffusion en direct, terrain par terrain =====

    async function couperTerrain(t) {
        var motif = prompt(
            'Couper la diffusion en direct du terrain « ' + t.nom +' ».\n\n'
            + 'Le direct disparaît du site dans les 30 secondes, même pour les\n'
            + 'visiteurs ayant déjà la page ouverte. La caméra de la borne continue\n'
            + 'de filmer de son côté.\n\n'
            + 'Motif (visible publiquement — ne pas écrire le nom du client) :',
            'Droit à l\'image'
        );
        if (motif === null) return;

        var res = await supa.from('terrains_bloques')
            .upsert({ terrain_id: t.id, motif: motif || null }).select().single();
        if (res.error) {
            toast('Coupure impossible : ' + res.error.message, 'error');
            console.error(res.error);
            return;
        }
        terrainsBloques[t.id] = res.data;
        render();
        toast('Diffusion de ' + t.nom + ' coupée.', 'ok');
    }

    async function rouvrirTerrain(t) {
        var res = await supa.from('terrains_bloques').delete().eq('terrain_id', t.id);
        if (res.error) {
            toast('Réouverture impossible : ' + res.error.message, 'error');
            console.error(res.error);
            return;
        }
        delete terrainsBloques[t.id];
        render();
        toast('Diffusion de ' + t.nom + ' rétablie.', 'ok');
    }

    async function debloquer(id) {
        var res = await supa.from('videos_bloquees').delete().eq('id_video', id);
        if (res.error) {
            toast('Déblocage impossible : ' + res.error.message, 'error');
            console.error(res.error);
            return;
        }
        delete bloquees[id];
        render();
        toast('Vidéo réaffichée sur le site.', 'ok');
    }

    // ===== Rendu =====

    function render() {
        var root_ = document.getElementById('videos-section');
        if (!root_) return;
        root_.innerHTML = '';

        root_.appendChild(el('p', { class: 'videos-intro' },
            'Les vidéos sont hébergées par LiveXperience. « Couper » les retire de '
            + 'l\'affichage sur le-rebond.fr ; elles restent en ligne chez le prestataire '
            + 'et accessibles par lien direct. Pour une suppression définitive, il faut la '
            + 'demander à LiveXperience.'));

        root_.appendChild(sectionTerrains());

        root_.appendChild(el('h3', { class: 'videos-titre' }, '📼 Replays'));
        root_.appendChild(barreFiltres());

        if (chargement) {
            root_.appendChild(el('p', { class: 'videos-vide' }, 'Chargement des vidéos…'));
            return;
        }

        // Les vidéos coupées en premier : c'est ce qu'on vient vérifier.
        var listeBloquees = Object.keys(bloquees).map(function (k) { return bloquees[k]; });
        if (listeBloquees.length) {
            root_.appendChild(el('h3', { class: 'videos-titre' },
                '⛔ Coupées du site (' + listeBloquees.length + ')'));
            var grilleB = el('div', { class: 'videos-grille' });
            listeBloquees.sort(function (a, b) {
                return (b.enregistree || '').localeCompare(a.enregistree || '');
            }).forEach(function (b) {
                grilleB.appendChild(carteBloquee(b));
            });
            root_.appendChild(grilleB);
        }

        if (erreurSource) {
            var box = el('div', { class: 'videos-erreur' });
            box.appendChild(el('strong', null, 'Liste des vidéos indisponible'));
            box.appendChild(el('p', null,
                'LiveXperience n\'a pas répondu comme attendu (' + erreurSource + '). '
                + 'Les vidéos déjà coupées restent gérables ci-dessus. Réessaie plus tard ; '
                + 'si cela persiste, leur page a peut-être changé de structure.'));
            root_.appendChild(box);
            return;
        }

        var visibles = videos.filter(function (v) { return !bloquees[v.id]; });
        root_.appendChild(el('h3', { class: 'videos-titre' },
            '🎥 En ligne sur le site (' + visibles.length + ')'));

        if (!visibles.length) {
            root_.appendChild(el('p', { class: 'videos-vide' },
                videos.length
                    ? 'Toutes les vidéos de cette sélection sont coupées.'
                    : 'Aucune vidéo pour cette sélection.'));
            return;
        }

        var grille = el('div', { class: 'videos-grille' });
        visibles.forEach(function (v) { grille.appendChild(carteVideo(v)); });
        root_.appendChild(grille);
    }

    // Diffusion en direct : un interrupteur par terrain. Séparé des replays,
    // parce que ce n'est pas le même mécanisme — un direct n'a pas
    // d'identifiant de vidéo, on coupe le terrain entier.
    function sectionTerrains() {
        var box = el('div', { class: 'videos-terrains' });
        box.appendChild(el('h3', { class: 'videos-titre' }, '📡 Diffusion en direct'));
        box.appendChild(el('p', { class: 'videos-terrains__aide' },
            'Couper un terrain retire son direct de la page « En direct » dans les '
            + '30 secondes, y compris pour les visiteurs déjà sur la page. La caméra '
            + 'de la borne continue de filmer : seule la diffusion sur le site est '
            + 'arrêtée.'));

        var liste = el('div', { class: 'videos-terrains__liste' });
        TERRAINS_LIVE.forEach(function (t) {
            var coupe = !!terrainsBloques[t.id];
            var ligne = el('div', {
                class: 'terrain-ligne' + (coupe ? ' terrain-ligne--coupe' : '')
            });

            var gauche = el('div', { class: 'terrain-ligne__info' });
            gauche.appendChild(el('span', { class: 'terrain-ligne__nom' }, t.nom));
            gauche.appendChild(el('span', {
                class: 'terrain-ligne__etat' + (coupe ? ' terrain-ligne__etat--coupe' : '')
            }, coupe ? '🚫 non diffusé' : '● diffusé'));
            if (coupe && terrainsBloques[t.id].motif) {
                gauche.appendChild(el('span', { class: 'terrain-ligne__motif' },
                    terrainsBloques[t.id].motif));
            }
            ligne.appendChild(gauche);

            ligne.appendChild(el('button', {
                type: 'button',
                class: 'btn-live btn-live--small '
                     + (coupe ? 'btn-live--outline' : 'btn-live--danger'),
                onclick: function () { coupe ? rouvrirTerrain(t) : couperTerrain(t); }
            }, coupe ? '↩ Rétablir' : '⛔ Couper le direct'));

            liste.appendChild(ligne);
        });
        box.appendChild(liste);
        return box;
    }

    function barreFiltres() {
        var barre = el('div', { class: 'videos-filtres' });

        var selT = el('select', { class: 'videos-select', onchange: function (e) {
            filtreTerrain = e.target.value; charger();
        } });
        selT.appendChild(el('option', { value: '' }, 'Tous les terrains'));
        Object.keys(root.VideosSource.TERRAINS).forEach(function (id) {
            var o = el('option', { value: id }, root.VideosSource.TERRAINS[id]);
            if (id === filtreTerrain) o.setAttribute('selected', 'selected');
            selT.appendChild(o);
        });
        barre.appendChild(selT);

        var inD = el('input', {
            type: 'date', class: 'videos-date', value: filtreDate,
            onchange: function (e) { filtreDate = e.target.value; charger(); }
        });
        barre.appendChild(inD);

        if (filtreDate || filtreTerrain) {
            barre.appendChild(el('button', {
                type: 'button', class: 'btn-live btn-live--outline btn-live--small',
                onclick: function () { filtreDate = ''; filtreTerrain = ''; charger(); }
            }, 'Tout afficher'));
        }

        barre.appendChild(el('button', {
            type: 'button', class: 'btn-live btn-live--outline btn-live--small',
            onclick: function () { charger(); }
        }, '↻ Rafraîchir'));

        return barre;
    }

    function carteVideo(v) {
        var c = el('div', { class: 'video-carte' });

        var lien = el('a', {
            class: 'video-carte__vignette', href: v.url,
            target: '_blank', rel: 'noopener noreferrer'
        });
        if (v.vignette) lien.appendChild(el('img', { src: v.vignette, alt: '', loading: 'lazy' }));
        if (v.duree) lien.appendChild(el('span', { class: 'video-carte__duree' }, v.duree));
        c.appendChild(lien);

        var info = el('div', { class: 'video-carte__info' });
        info.appendChild(el('div', { class: 'video-carte__titre' }, v.titre));
        var meta = [];
        if (v.terrain) meta.push(v.terrain);
        if (v.dateTexte) meta.push(v.dateTexte);
        info.appendChild(el('div', { class: 'video-carte__meta' }, meta.join(' · ')));

        var actions = el('div', { class: 'video-carte__actions' });
        actions.appendChild(el('a', {
            class: 'btn-live btn-live--outline btn-live--small', href: v.url,
            target: '_blank', rel: 'noopener noreferrer'
        }, '▶ Voir'));
        actions.appendChild(el('button', {
            type: 'button', class: 'btn-live btn-live--danger btn-live--small',
            onclick: function () { bloquer(v); }
        }, '⛔ Couper'));
        info.appendChild(actions);

        c.appendChild(info);
        return c;
    }

    function carteBloquee(b) {
        var c = el('div', { class: 'video-carte video-carte--bloquee' });

        var info = el('div', { class: 'video-carte__info' });
        info.appendChild(el('div', { class: 'video-carte__titre' }, b.titre || b.id_video));
        var meta = [];
        if (b.terrain) meta.push(b.terrain);
        if (b.enregistree) meta.push(dateLisible(b.enregistree));
        info.appendChild(el('div', { class: 'video-carte__meta' }, meta.join(' · ')));
        if (b.motif) info.appendChild(el('div', { class: 'video-carte__motif' }, 'Motif : ' + b.motif));

        var actions = el('div', { class: 'video-carte__actions' });
        actions.appendChild(el('button', {
            type: 'button', class: 'btn-live btn-live--outline btn-live--small',
            onclick: function () { debloquer(b.id_video); }
        }, '↩ Réafficher'));
        info.appendChild(actions);

        c.appendChild(info);
        return c;
    }

    function dateLisible(iso) {
        var d = new Date(iso);
        if (isNaN(d.getTime())) return iso;
        return d.toLocaleString('fr-FR', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    }

    // ===== Entrée =====

    function init() {
        supa = root.LeRebondSupa;
        if (!supa) {
            var s = document.getElementById('videos-section');
            if (s) s.innerHTML = '<p class="videos-vide">Connexion à la base indisponible.</p>';
            return;
        }
        if (!root.VideosSource) {
            var s2 = document.getElementById('videos-section');
            if (s2) s2.innerHTML = '<p class="videos-vide">js/videos-source.js n\'est pas chargé.</p>';
            return;
        }
        if (monte) { render(); return; }
        monte = true;
        charger();
    }

    root.VideosAdmin = { init: init, charger: charger };
})(window);
