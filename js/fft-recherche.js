/* ============================================
   RECHERCHE FFT
   Recherche d'un joueur dans le dernier classement padel FFT importé
   (table fft_classement, RPC rechercher_joueurs_fft) et liste de suggestions
   branchable sur n'importe quel champ texte. Utilisé par l'admin tournoi et la
   page publique /tournois/.

   Si le cache ne connaît pas le joueur, on interroge Ten'Up en direct via l'Edge
   Function Supabase « fft-recherche » (Ten'Up refuse les appels directs depuis un
   autre site). Ten'Up ne trouve que le nom + prénom complets : la recherche
   directe ne part qu'avec au moins deux mots.

   Rappel : au padel, le poids d'une paire est la somme des RANGS des deux
   joueurs (n°1 = meilleur). C'est le rang qu'on reporte dans equipes.points_j1/j2.
   ============================================ */
(function () {
    var LONGUEUR_MIN = 3;   // en dessous, la recherche n'est ni utile ni rapide (cf. migration)
    var DELAI_MS = 250;

    function normaliser(txt) {
        return String(txt == null ? '' : txt)
            .trim()
            .toLowerCase()
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/\s+/g, ' ');
    }

    function formaterNombre(n) {
        return n == null ? '' : Number(n).toLocaleString('fr-FR');
    }

    // « Julien DUPONT » : prénom puis nom, comme sur les feuilles de match.
    function nomAffiche(j) {
        return [j.prenom, j.nom].filter(Boolean).join(' ');
    }

    function moisAffiche(iso) {
        if (!iso) return '';
        var d = new Date(iso + 'T00:00:00');
        return d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    }

    async function rechercher(supa, q, options) {
        options = options || {};
        if (normaliser(q).length < LONGUEUR_MIN) return [];
        var res = await supa.rpc('rechercher_joueurs_fft', {
            q: q,
            p_genre: options.genre || null,
            p_limite: options.limite || 8
        });
        if (res.error) throw res.error;
        return res.data || [];
    }

    // Nom + prénom complets ? (Ten'Up ne fait pas de recherche partielle)
    function rechercheDirectePossible(q) {
        var mots = normaliser(q).split(' ').filter(function (m) { return m.length >= 2; });
        return mots.length >= 2;
    }

    // Interroge Ten'Up via l'Edge Function. Le résultat est aussi mis en cache côté serveur.
    async function rechercherEnDirect(supa, q, options) {
        options = options || {};
        if (!rechercheDirectePossible(q)) return [];
        var res = await supa.functions.invoke('fft-recherche', {
            body: { q: String(q).trim(), genre: options.genre || null }
        });
        if (res.error) throw res.error;
        return ((res.data && res.data.joueurs) || []).map(function (j) { j.direct = true; return j; });
    }

    // Cache d'abord ; si rien ne correspond au nom complet saisi, Ten'Up en direct.
    // Le tableau renvoyé porte .directIndisponible = true si Ten'Up n'a pas pu être
    // interrogé : « aucun résultat » ne veut alors PAS dire « non classé ».
    async function rechercherPartout(supa, q, options) {
        var locaux = await rechercher(supa, q, options);
        var cle = normaliser(q).split(' ').sort().join(' ');
        var exact = locaux.some(function (j) {
            return normaliser(j.prenom + ' ' + j.nom).split(' ').sort().join(' ') === cle;
        });
        if (exact || !rechercheDirectePossible(q)) return locaux;
        var directs = [], indisponible = false;
        try { directs = await rechercherEnDirect(supa, q, options); } catch (e) { console.warn(e); indisponible = true; }
        var vus = {};
        var tous = directs.concat(locaux).filter(function (j) {
            var k = j.id_crm ? 'id' + j.id_crm : 'n' + normaliser(j.prenom + ' ' + j.nom) + j.genre;
            if (vus[k]) return false;
            vus[k] = true;
            return true;
        });
        tous.directIndisponible = indisponible;
        return tous;
    }

    // Branche une liste de suggestions sous `input`.
    //   options.supa      client Supabase
    //   options.genre     () => 'H' | 'F' | null   (filtre facultatif)
    //   options.onChoix   (joueur) => void          appelé au clic ou sur Entrée
    //   options.requete   () => string              texte cherché (défaut : input.value),
    //                     utile quand nom et prénom sont dans deux champs
    // Renvoie { fermer, detacher }.
    function attacher(input, options) {
        var supa = options.supa;
        var liste = document.createElement('div');
        liste.className = 'fft-ac';
        liste.setAttribute('role', 'listbox');
        liste.hidden = true;

        var conteneur = input.parentNode;
        if (getComputedStyle(conteneur).position === 'static') conteneur.style.position = 'relative';
        conteneur.appendChild(liste);
        input.setAttribute('autocomplete', 'off');
        input.setAttribute('aria-autocomplete', 'list');

        var resultats = [], actif = -1, minuteur = null, generation = 0;

        function fermer() {
            liste.hidden = true;
            actif = -1;
        }

        function choisir(i) {
            var j = resultats[i];
            if (!j) return;
            fermer();
            if (options.onChoix) options.onChoix(j);
        }

        function surligner(i) {
            actif = i;
            Array.prototype.forEach.call(liste.children, function (li, k) {
                li.classList.toggle('fft-ac__item--actif', k === i);
                li.setAttribute('aria-selected', k === i ? 'true' : 'false');
            });
        }

        function afficher(message) {
            liste.innerHTML = '';
            if (message) {
                var vide = document.createElement('div');
                vide.className = 'fft-ac__vide';
                vide.textContent = message;
                liste.appendChild(vide);
            }
            resultats.forEach(function (j, i) {
                var li = document.createElement('div');
                li.className = 'fft-ac__item';
                li.setAttribute('role', 'option');
                var rang = document.createElement('span');
                rang.className = 'fft-ac__rang';
                rang.textContent = '#' + formaterNombre(j.rang);
                var nom = document.createElement('span');
                nom.className = 'fft-ac__nom';
                nom.textContent = nomAffiche(j);
                var meta = document.createElement('span');
                meta.className = 'fft-ac__meta';
                meta.textContent = [j.genre === 'F' ? 'Dames' : 'Messieurs', j.club, j.comite || j.ligue]
                    .filter(Boolean).join(' · ');
                li.appendChild(rang);
                li.appendChild(nom);
                li.appendChild(meta);
                // mousedown plutôt que click : le blur de l'input fermerait la liste avant le click.
                li.addEventListener('mousedown', function (e) { e.preventDefault(); choisir(i); });
                li.addEventListener('mouseenter', function () { surligner(i); });
                liste.appendChild(li);
            });
            liste.hidden = !message && resultats.length === 0;
        }

        function lancer() {
            var q = options.requete ? options.requete() : input.value;
            clearTimeout(minuteur);
            if (normaliser(q).length < LONGUEUR_MIN) { resultats = []; fermer(); return; }
            minuteur = setTimeout(async function () {
                var g = ++generation;
                try {
                    var r = await rechercherPartout(supa, q, { genre: options.genre ? options.genre() : null });
                    if (g !== generation) return;  // une frappe plus récente a déjà relancé
                    resultats = r;
                    actif = -1;
                    afficher(r.length ? '' : (r.directIndisponible
                        ? 'Classement national injoignable, réessaie dans un instant'
                        : 'Aucun classé FFT à ce nom'));
                } catch (err) {
                    if (g !== generation) return;
                    console.error('Recherche FFT :', err);
                    resultats = [];
                    afficher('Classement FFT indisponible');
                }
            }, DELAI_MS);
        }

        function surTouche(e) {
            if (liste.hidden || !resultats.length) return;
            if (e.key === 'ArrowDown') { e.preventDefault(); surligner((actif + 1) % resultats.length); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); surligner((actif - 1 + resultats.length) % resultats.length); }
            else if (e.key === 'Enter' && actif >= 0) { e.preventDefault(); e.stopImmediatePropagation(); choisir(actif); }
            else if (e.key === 'Escape') { fermer(); }
        }

        function surBlur() { setTimeout(fermer, 150); }

        input.addEventListener('input', lancer);
        input.addEventListener('keydown', surTouche);
        input.addEventListener('blur', surBlur);

        return {
            fermer: fermer,
            relancer: lancer,
            detacher: function () {
                input.removeEventListener('input', lancer);
                input.removeEventListener('keydown', surTouche);
                input.removeEventListener('blur', surBlur);
                if (liste.parentNode) liste.parentNode.removeChild(liste);
            }
        };
    }

    window.FFTRecherche = {
        LONGUEUR_MIN: LONGUEUR_MIN,
        normaliser: normaliser,
        rechercher: rechercher,
        rechercherEnDirect: rechercherEnDirect,
        rechercherPartout: rechercherPartout,
        rechercheDirectePossible: rechercheDirectePossible,
        attacher: attacher,
        nomAffiche: nomAffiche,
        moisAffiche: moisAffiche,
        formaterNombre: formaterNombre
    };
})();
