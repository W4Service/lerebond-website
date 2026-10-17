/* ============================================
   CALENDRIER DES TOURNOIS (page /tournois/)
   - Liste les tournois publiés à venir (vue Supabase tournois_calendrier),
     groupés par mois, filtrables par tableau et catégorie.
   - Recherche de classement dans le dernier classement FFT importé.
   ============================================ */
(function () {
    var supa = window.LeRebondSupa;
    var LIEN_APPLI = 'https://lerebond.mymobileapp.fr';
    var MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août',
                'septembre', 'octobre', 'novembre', 'décembre'];
    var GENRES = { messieurs: 'Messieurs', dames: 'Dames', mixte: 'Mixte' };
    var ORDRE_CATEGORIES = ['P25', 'P50', 'P100', 'P250', 'P500', 'P1000', 'P1500', 'P2000', 'loisir'];

    var tournois = [];
    var filtre = { genre: '', categorie: '' };

    function $(id) { return document.getElementById(id); }

    function el(tag, cls, texte) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (texte != null) e.textContent = texte;
        return e;
    }

    function aujourdhui() {
        var d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function heure(h) {
        if (!h) return '';
        var p = String(h).split(':');
        return parseInt(p[0], 10) + 'h' + (p[1] && p[1] !== '00' ? p[1] : '');
    }

    function prix(p) {
        if (p == null) return '';
        var n = Number(p);
        return (n % 1 ? n.toFixed(2).replace('.', ',') : String(n)) + ' € / joueur';
    }

    function libelleCategorie(c) { return c === 'loisir' ? 'Loisir' : c; }

    // ----- Calendrier -----

    async function chargerTournois() {
        var liste = $('tcal-liste');
        if (!supa) { liste.innerHTML = '<p class="events-empty">Calendrier indisponible pour le moment.</p>'; return; }
        var res = await supa.from('tournois_calendrier').select('*')
            .gte('date', aujourdhui())
            .order('date', { ascending: true })
            .order('heure_debut', { ascending: true });
        if (res.error) {
            console.error(res.error);
            liste.innerHTML = '<p class="events-empty">Impossible de charger les tournois. Réessayez dans un instant.</p>';
            return;
        }
        tournois = res.data || [];
        lireFiltresUrl();
        construireFiltres();
        afficherTournois();
    }

    // Les filtres sont gardés dans l'URL (?tableau=dames&categorie=P100) pour pouvoir partager un lien filtré.
    function lireFiltresUrl() {
        var p = new URLSearchParams(location.search);
        filtre.genre = p.get('tableau') || '';
        filtre.categorie = p.get('categorie') || '';
    }

    function ecrireFiltresUrl() {
        var p = new URLSearchParams(location.search);
        filtre.genre ? p.set('tableau', filtre.genre) : p.delete('tableau');
        filtre.categorie ? p.set('categorie', filtre.categorie) : p.delete('categorie');
        var q = p.toString();
        history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash);
    }

    function construireFiltres() {
        var genres = Object.keys(GENRES).filter(function (g) {
            return tournois.some(function (t) { return t.genre === g; });
        });
        var categories = ORDRE_CATEGORIES.filter(function (c) {
            return tournois.some(function (t) { return t.categorie === c; });
        });
        // Un filtre à une seule valeur n'aide personne.
        if (genres.length < 2 && categories.length < 2) return;
        $('tcal-filtres').hidden = false;

        function boutons(conteneur, cle, valeurs, libelle) {
            conteneur.innerHTML = '';
            [''].concat(valeurs).forEach(function (v) {
                var b = el('button', 'filter-btn' + (filtre[cle] === v ? ' active' : ''), v ? libelle(v) : 'Tous');
                b.type = 'button';
                b.addEventListener('click', function () {
                    filtre[cle] = v;
                    Array.prototype.forEach.call(conteneur.children, function (x) { x.classList.toggle('active', x === b); });
                    ecrireFiltresUrl();
                    afficherTournois();
                });
                conteneur.appendChild(b);
            });
            conteneur.closest('.filter-group').hidden = valeurs.length < 2;
        }
        boutons($('tcal-filtre-genre'), 'genre', genres, function (g) { return GENRES[g]; });
        boutons($('tcal-filtre-categorie'), 'categorie', categories, libelleCategorie);
    }

    function afficherTournois() {
        var liste = $('tcal-liste');
        liste.innerHTML = '';
        var visibles = tournois.filter(function (t) {
            return (!filtre.genre || t.genre === filtre.genre)
                && (!filtre.categorie || t.categorie === filtre.categorie);
        });

        if (!visibles.length) {
            var vide = el('div', 'tcal-vide');
            vide.appendChild(el('p', null, tournois.length
                ? 'Aucun tournoi ne correspond à ces filtres.'
                : 'Pas de tournoi programmé pour le moment. Les prochaines dates arrivent bientôt !'));
            var lien = el('a', 'btn btn--outline', 'Voir tous les événements');
            lien.href = 'evenements/';
            vide.appendChild(lien);
            liste.appendChild(vide);
            return;
        }

        var moisCourant = null, grille = null;
        visibles.forEach(function (t) {
            var cle = t.date.slice(0, 7);
            if (cle !== moisCourant) {
                moisCourant = cle;
                var nb = visibles.filter(function (x) { return x.date.slice(0, 7) === cle; }).length;
                var titre = el('h3', 'tcal-mois');
                titre.appendChild(document.createTextNode(MOIS[parseInt(cle.slice(5), 10) - 1] + ' ' + cle.slice(0, 4)));
                titre.appendChild(el('span', 'tcal-mois__nb', nb + ' tournoi' + (nb > 1 ? 's' : '')));
                liste.appendChild(titre);
                grille = el('div', 'tcal-grille');
                liste.appendChild(grille);
            }
            grille.appendChild(carte(t));
        });
    }

    function carte(t) {
        var d = new Date(t.date + 'T00:00:00');
        var enCours = t.status === 'actif';
        var c = el('article', 'tcal-carte' + (t.complet ? ' tcal-carte--complet' : '') + (enCours ? ' tcal-carte--live' : ''));
        c.id = 'tournoi-' + t.id;

        var date = el('div', 'tcal-date');
        date.appendChild(el('span', 'tcal-date__jour', d.toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '')));
        date.appendChild(el('span', 'tcal-date__num', String(d.getDate())));
        date.appendChild(el('span', 'tcal-date__mois', d.toLocaleDateString('fr-FR', { month: 'short' })));
        c.appendChild(date);

        var corps = el('div', 'tcal-corps');
        var badges = el('div', 'tcal-badges');
        if (t.categorie) badges.appendChild(el('span', 'tcal-badge tcal-badge--cat', libelleCategorie(t.categorie)));
        if (t.genre) badges.appendChild(el('span', 'tcal-badge', GENRES[t.genre]));
        if (t.homologue) badges.appendChild(el('span', 'tcal-badge tcal-badge--fft', 'Homologué FFT'));
        if (enCours) badges.appendChild(el('span', 'tcal-badge tcal-badge--live', '● En cours'));
        corps.appendChild(badges);
        corps.appendChild(el('h4', 'tcal-titre', t.nom));

        var infos = [];
        if (t.heure_debut) infos.push(heure(t.heure_debut) + (t.heure_fin ? ' – ' + heure(t.heure_fin) : ''));
        if (t.prix_par_joueur != null) infos.push(prix(t.prix_par_joueur));
        if (t.juge_arbitre) infos.push('JA : ' + t.juge_arbitre);
        if (infos.length) corps.appendChild(el('p', 'tcal-infos', infos.join(' · ')));
        if (t.description) corps.appendChild(el('p', 'tcal-desc', t.description));

        if (t.nb_equipes_max) {
            var places = el('div', 'tcal-places');
            var restant = Math.max(0, t.nb_equipes_max - t.inscrits);
            var texte = t.complet ? 'Complet — liste d\'attente'
                : (restant <= 2 ? 'Plus que ' + restant + ' place' + (restant > 1 ? 's' : '') + ' !' : restant + ' places disponibles');
            var ligne = el('div', 'tcal-places__ligne');
            ligne.appendChild(el('span', 'tcal-places__nb', t.inscrits + '/' + t.nb_equipes_max + ' équipes'));
            ligne.appendChild(el('span', 'tcal-places__etat' + (t.complet ? ' tcal-places__etat--complet' : ''), texte));
            places.appendChild(ligne);
            var barre = el('div', 'tcal-barre');
            var rempli = el('div', 'tcal-barre__rempli');
            rempli.style.width = Math.min(100, Math.round(100 * t.inscrits / t.nb_equipes_max)) + '%';
            barre.appendChild(rempli);
            barre.setAttribute('role', 'progressbar');
            barre.setAttribute('aria-valuemin', '0');
            barre.setAttribute('aria-valuemax', String(t.nb_equipes_max));
            barre.setAttribute('aria-valuenow', String(t.inscrits));
            barre.setAttribute('aria-label', 'Équipes inscrites');
            places.appendChild(barre);
            corps.appendChild(places);
        }

        var actions = el('div', 'tcal-actions');
        if (enCours) {
            var live = el('a', 'btn btn--primary', 'Suivre en direct');
            live.href = 'live/tournoi/';
            actions.appendChild(live);
        } else {
            var lien = el('a', 'btn btn--primary', t.complet ? 'Liste d\'attente' : 'S\'inscrire');
            lien.href = t.lien_inscription || LIEN_APPLI;
            lien.target = '_blank';
            lien.rel = 'noopener';
            actions.appendChild(lien);
            if (!t.lien_inscription) actions.appendChild(el('span', 'tcal-note', 'via l\'appli Le Rebond, rubrique Événements'));
        }
        corps.appendChild(actions);
        c.appendChild(corps);
        return c;
    }

    // ----- Recherche de classement FFT -----

    var genreFFT = '';
    var minuteur = null, generation = 0;

    async function afficherSourceFFT() {
        if (!supa) return;
        var res = await supa.from('fft_imports').select('mois').order('mois', { ascending: false }).limit(1);
        var mois = !res.error && res.data && res.data.length ? FFTRecherche.moisAffiche(res.data[0].mois) : null;
        $('tcal-fft-source').textContent = 'Tapez le prénom et le nom d\'un joueur ou d\'une joueuse : '
            + 'on interroge le classement national padel' + (mois ? ' (classement de ' + mois + ')' : '') + '.';
    }

    function rechercherFFT() {
        var q = $('tcal-fft-q').value;
        var zone = $('tcal-fft-resultats');
        clearTimeout(minuteur);
        if (FFTRecherche.normaliser(q).length < FFTRecherche.LONGUEUR_MIN) { zone.innerHTML = ''; return; }
        minuteur = setTimeout(async function () {
            var g = ++generation;
            try {
                var r = await FFTRecherche.rechercherPartout(supa, q, { genre: genreFFT || null, limite: 15 });
                if (g !== generation) return;
                zone.innerHTML = '';
                if (!r.length) {
                    zone.appendChild(el('p', 'tcal-fft__vide', r.directIndisponible
                        ? 'Le classement national ne répond pas pour le moment. Réessayez dans quelques instants.'
                        : FFTRecherche.rechercheDirectePossible(q)
                        ? 'Aucun classé à ce nom. Un joueur non classé, ou anonyme sur Ten\'Up, n\'apparaît pas.'
                        : 'Tapez le prénom et le nom complets pour chercher dans tout le classement national.'));
                    return;
                }
                var table = el('table', 'tcal-fft__table');
                var tete = el('tr');
                ['Classement', 'Joueur', 'Points', 'Ligue'].forEach(function (h) { tete.appendChild(el('th', null, h)); });
                var thead = el('thead'); thead.appendChild(tete); table.appendChild(thead);
                var tbody = el('tbody');
                r.forEach(function (j) {
                    var tr = el('tr');
                    tr.appendChild(el('td', 'tcal-fft__rang', j.rang === 1 ? '1er' : FFTRecherche.formaterNombre(j.rang) + 'e'));
                    var nom = el('td', 'tcal-fft__nom');
                    nom.appendChild(el('strong', null, FFTRecherche.nomAffiche(j)));
                    // Le club reste sous le nom (même sur mobile) : c'est lui qui distingue deux homonymes.
                    nom.appendChild(el('span', 'tcal-fft__genre',
                        [j.genre === 'F' ? 'Dames' : 'Messieurs', j.club].filter(Boolean).join(' · ')));
                    tr.appendChild(nom);
                    tr.appendChild(el('td', null, j.points != null ? FFTRecherche.formaterNombre(j.points) : '–'));
                    tr.appendChild(el('td', 'tcal-fft__ligue', j.ligue || '–'));
                    tbody.appendChild(tr);
                });
                table.appendChild(tbody);
                zone.appendChild(table);
            } catch (err) {
                if (g !== generation) return;
                console.error(err);
                zone.innerHTML = '';
                zone.appendChild(el('p', 'tcal-fft__vide', 'Recherche indisponible pour le moment.'));
            }
        }, 250);
    }

    function initFFT() {
        var input = $('tcal-fft-q');
        if (!input || !supa || !window.FFTRecherche) return;
        afficherSourceFFT();
        input.addEventListener('input', rechercherFFT);
        document.querySelectorAll('.tcal-fft__genre [data-genre]').forEach(function (b) {
            b.addEventListener('click', function () {
                genreFFT = b.getAttribute('data-genre');
                document.querySelectorAll('.tcal-fft__genre [data-genre]').forEach(function (x) {
                    x.classList.toggle('active', x === b);
                });
                rechercherFFT();
            });
        });
    }

    function init() {
        chargerTournois();
        initFFT();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
