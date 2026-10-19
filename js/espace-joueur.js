/* ============================================
   ESPACE JOUEUR (page /espace-joueur/?j=<jeton>)
   Pas de compte : le lien personnel (jeton) reçu à l'inscription donne accès à
   l'espace. Il est gardé dans le navigateur pour les visites suivantes.
   ============================================ */
(function () {
    var supa = window.LeRebondSupa;
    var CLE_ESPACE = 'rebond-espace-joueur';
    var STATUTS = {
        inscrite: { label: 'Inscrite', cls: 'ok' },
        liste_attente: { label: 'Liste d\'attente', cls: 'attente' },
        annulee: { label: 'Désinscrite', cls: 'off' },
        refusee: { label: 'Refusée', cls: 'off' }
    };
    var jeton = null, donnees = null;

    function $(id) { return document.getElementById(id); }
    function el(tag, cls, texte) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (texte != null) e.textContent = texte;
        return e;
    }
    function lire() { try { return JSON.parse(localStorage.getItem(CLE_ESPACE) || 'null'); } catch (e) { return null; } }
    function ecrire(v) { try { v ? localStorage.setItem(CLE_ESPACE, JSON.stringify(v)) : localStorage.removeItem(CLE_ESPACE); } catch (e) { /* navigation privée */ } }
    function dateLongue(iso) { return new Date(iso + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }); }
    function nombre(n) { return n == null ? '–' : Number(n).toLocaleString('fr-FR'); }

    function init() {
        var q = new URLSearchParams(location.search);
        jeton = q.get('j') || lire();
        if (q.get('j')) {
            ecrire(q.get('j'));
            // Le lien n'a plus besoin d'apparaître dans l'adresse (copie, partage d'écran).
            history.replaceState(null, '', location.pathname);
        }
        if (!jeton || !supa) return afficherAccueil();
        charger();
    }

    async function charger() {
        var res = await supa.rpc('espace_joueur', { p_jeton: jeton });
        if (res.error) {
            ecrire(null);
            return afficherAccueil('Ce lien n\'est plus valable. Demandez-en un nouveau ci-dessous.');
        }
        donnees = res.data;
        var rr = await supa.rpc('espace_joueur_recherches', { p_jeton: jeton });
        donnees.recherches = rr.error ? [] : (rr.data || []);
        afficher();
    }

    // ----- Sans lien : « recevoir mon lien » -----

    function afficherAccueil(message) {
        var zone = $('ej-contenu');
        zone.innerHTML = '';
        var carte = el('div', 'ej-carte ej-accueil');
        carte.appendChild(el('h2', null, 'Accéder à mon espace'));
        if (message) carte.appendChild(el('p', 'ej-alerte', message));
        carte.appendChild(el('p', null, 'Votre espace joueur s\'ouvre avec le lien personnel reçu lors de votre inscription à un tournoi. Vous l\'avez perdu ? Indiquez votre e-mail, on vous le renvoie.'));
        var form = el('form', 'ej-lien');
        var input = el('input', 'ins-input'); input.type = 'email'; input.required = true;
        input.placeholder = 'adresse@exemple.fr'; input.autocomplete = 'email';
        var bouton = el('button', 'btn btn--primary', 'Recevoir mon lien'); bouton.type = 'submit';
        form.appendChild(input); form.appendChild(bouton);
        var retour = el('p', 'ej-note');
        form.addEventListener('submit', async function (e) {
            e.preventDefault();
            bouton.disabled = true;
            await supa.rpc('envoyer_mon_lien', { p_email: input.value });
            retour.textContent = 'Si cette adresse correspond à un joueur inscrit, le lien vient de lui être envoyé (pensez à vérifier les indésirables).';
            bouton.disabled = false;
        });
        carte.appendChild(form);
        carte.appendChild(retour);
        var a = el('a', 'btn btn--outline-dark', 'Voir les tournois à venir'); a.href = 'tournois/';
        carte.appendChild(a);
        zone.appendChild(carte);
        zone.appendChild(blocSimulateur());
    }

    // ----- Espace -----

    function afficher() {
        var j = donnees.joueur;
        $('ej-titre').textContent = 'Bonjour ' + (j.prenom || '') + ' 👋';
        var zone = $('ej-contenu');
        zone.innerHTML = '';
        zone.appendChild(blocClassement());
        zone.appendChild(blocInscriptions());
        if (donnees.recherches && donnees.recherches.length) zone.appendChild(blocRecherches());
        zone.appendChild(blocHistorique());
        zone.appendChild(blocSimulateur());
        var sortir = el('button', 'ej-sortir', 'Se déconnecter de cet appareil');
        sortir.type = 'button';
        sortir.addEventListener('click', function () { ecrire(null); jeton = null; afficherAccueil(); });
        zone.appendChild(sortir);
    }

    function blocClassement() {
        var j = donnees.joueur;
        var carte = el('section', 'ej-carte');
        carte.appendChild(el('h2', null, 'Mon classement FFT'));
        if (j.fft_rang) {
            var chiffres = el('div', 'ej-chiffres');
            [['Classement', nombre(j.fft_rang) + 'e'], ['Points', nombre(j.fft_points)], ['Club', j.fft_club || '–']].forEach(function (c) {
                var b = el('div', 'ej-chiffre');
                b.appendChild(el('span', 'ej-chiffre__valeur', c[1]));
                b.appendChild(el('span', 'ej-chiffre__label', c[0]));
                chiffres.appendChild(b);
            });
            carte.appendChild(chiffres);
            carte.appendChild(el('p', 'ej-note', 'Classement FFT de ' + FFTRecherche.moisAffiche(j.fft_mois) + ', mis à jour automatiquement chaque mois.'));
            var h = donnees.historique_classement || [];
            if (h.length >= 2) carte.appendChild(courbe(h));
        } else {
            carte.appendChild(el('p', null, j.fft_statut === 'homonymes'
                ? 'Plusieurs joueurs classés portent votre nom : le club rattachera votre classement lors de votre prochain tournoi.'
                : j.fft_statut === 'non_classe'
                    ? 'Vous n\'apparaissez pas (encore) dans le classement FFT. Il suffit d\'un tournoi homologué pour y entrer !'
                    : 'Votre classement FFT sera vérifié automatiquement d\'ici quelques heures.'));
        }
        return carte;
    }

    // Évolution du classement : plus le rang est petit, plus le point est haut.
    function courbe(h) {
        var W = 600, H = 160, M = 28;
        var rangs = h.map(function (x) { return x.rang; });
        var min = Math.min.apply(null, rangs), max = Math.max.apply(null, rangs);
        if (min === max) { min -= 1; max += 1; }
        var x = function (i) { return M + i * (W - 2 * M) / (h.length - 1); };
        var y = function (r) { return M + (r - min) * (H - 2 * M) / (max - min); };
        var ns = 'http://www.w3.org/2000/svg';
        var svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
        svg.setAttribute('class', 'ej-courbe');
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', 'Évolution du classement : ' + h.map(function (p) { return FFTRecherche.moisAffiche(p.mois) + ' ' + p.rang + 'e'; }).join(', '));
        var d = h.map(function (p, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.rang).toFixed(1); }).join(' ');
        var path = document.createElementNS(ns, 'path');
        path.setAttribute('d', d); path.setAttribute('class', 'ej-courbe__ligne');
        svg.appendChild(path);
        h.forEach(function (p, i) {
            var c = document.createElementNS(ns, 'circle');
            c.setAttribute('cx', x(i)); c.setAttribute('cy', y(p.rang)); c.setAttribute('r', 4);
            c.setAttribute('class', 'ej-courbe__point');
            var t = document.createElementNS(ns, 'title');
            t.textContent = FFTRecherche.moisAffiche(p.mois) + ' : ' + nombre(p.rang) + 'e';
            c.appendChild(t);
            svg.appendChild(c);
            if (i === 0 || i === h.length - 1) {
                var lbl = document.createElementNS(ns, 'text');
                lbl.setAttribute('x', x(i)); lbl.setAttribute('y', y(p.rang) - 9);
                lbl.setAttribute('text-anchor', i === 0 ? 'start' : 'end');
                lbl.setAttribute('class', 'ej-courbe__texte');
                lbl.textContent = nombre(p.rang) + 'e';
                svg.appendChild(lbl);
            }
        });
        return svg;
    }

    function blocInscriptions() {
        var carte = el('section', 'ej-carte');
        carte.appendChild(el('h2', null, 'Mes inscriptions'));
        var aujourdhui = new Date().toISOString().slice(0, 10);
        var liste = (donnees.inscriptions || []).filter(function (i) { return i.date >= aujourdhui || i.statut === 'inscrite'; });
        if (!liste.length) {
            carte.appendChild(el('p', null, 'Aucune inscription en cours.'));
        }
        liste.forEach(function (i) { carte.appendChild(ligneInscription(i)); });
        var a = el('a', 'btn btn--outline-dark', 'S\'inscrire à un tournoi'); a.href = 'tournois/';
        carte.appendChild(a);
        return carte;
    }

    function ligneInscription(i) {
        var s = STATUTS[i.statut] || { label: i.statut, cls: 'off' };
        var ligne = el('div', 'ej-inscription ej-inscription--' + s.cls);
        var tete = el('div', 'ej-inscription__tete');
        tete.appendChild(el('strong', null, i.tournoi));
        tete.appendChild(el('span', 'ej-statut ej-statut--' + s.cls,
            s.label + (i.statut === 'liste_attente' && i.position ? ' · position ' + i.position : '')));
        ligne.appendChild(tete);
        ligne.appendChild(el('p', 'ej-inscription__infos', dateLongue(i.date) + ' · avec ' + i.partenaire
            + (i.poids ? ' · poids ' + nombre(i.poids) : '')));

        var actif = (i.statut === 'inscrite' || i.statut === 'liste_attente') && i.tournoi_statut === 'planifie';
        var actions = el('div', 'ej-actions');

        if (actif && i.je_suis === 2 && !i.partenaire_confirme) {
            ligne.appendChild(el('p', 'ej-alerte', 'Votre partenaire vous a inscrit·e : merci de confirmer votre participation.'));
            actions.appendChild(bouton('Je confirme ma participation', 'primary', function () {
                return supa.rpc('confirmer_partenaire', { p_jeton: jeton, p_inscription: i.id });
            }));
        }
        if (i.convocation_heure && i.statut === 'inscrite') {
            var h = new Date(i.convocation_heure);
            ligne.appendChild(el('p', 'ej-convocation', '📣 Convocation : ' + h.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
                + ' à ' + h.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
                + (i.ma_presence === true ? ' — présence confirmée ✓' : i.ma_presence === false ? ' — absence signalée' : '')));
            if (i.ma_presence !== true) actions.appendChild(bouton('Je serai présent·e', 'primary', function () {
                return supa.rpc('repondre_convocation', { p_jeton: jeton, p_inscription: i.id, p_present: true });
            }));
            if (i.ma_presence !== false) actions.appendChild(bouton('Je ne pourrai pas venir', 'outline-dark', function () {
                return supa.rpc('repondre_convocation', { p_jeton: jeton, p_inscription: i.id, p_present: false });
            }));
        }
        if (actif) {
            actions.appendChild(bouton('Me désinscrire', 'lien', function () {
                if (!confirm('Désinscrire votre paire du ' + i.tournoi + ' ?\n\nVotre partenaire sera prévenu·e et la place ira à la liste d\'attente.')) return null;
                return supa.rpc('annuler_inscription', { p_jeton: jeton, p_inscription: i.id });
            }));
        }
        if (actions.children.length) ligne.appendChild(actions);
        return ligne;
    }

    function bouton(texte, style, action) {
        var b = el('button', style === 'lien' ? 'ej-bouton-lien' : 'btn btn--' + style, texte);
        b.type = 'button';
        b.addEventListener('click', async function () {
            var p = action();
            if (!p) return;
            b.disabled = true;
            var res = await p;
            if (res && res.error) { alert(res.error.message); b.disabled = false; return; }
            charger();
        });
        return b;
    }

    function blocRecherches() {
        var carte = el('section', 'ej-carte');
        carte.appendChild(el('h2', null, 'Mes recherches de partenaire'));
        donnees.recherches.forEach(function (r) {
            var ligne = el('div', 'ej-inscription');
            var tete = el('div', 'ej-inscription__tete');
            tete.appendChild(el('strong', null, r.tournoi));
            tete.appendChild(el('span', 'ej-statut ej-statut--attente', r.propositions + ' proposition' + (r.propositions > 1 ? 's' : '')));
            ligne.appendChild(tete);
            ligne.appendChild(el('p', 'ej-inscription__infos', dateLongue(r.date) + (r.message ? ' · « ' + r.message + ' »' : '')));
            var actions = el('div', 'ej-actions');
            var voir = el('a', 'btn btn--outline-dark', 'Voir la liste'); voir.href = 'tournois/partenaires/?t=' + r.tournoi_id;
            actions.appendChild(voir);
            actions.appendChild(bouton('Retirer ma recherche', 'lien', function () {
                return supa.rpc('retirer_recherche', { p_jeton: jeton, p_recherche: r.id });
            }));
            ligne.appendChild(actions);
            carte.appendChild(ligne);
        });
        carte.appendChild(el('p', 'ej-note', 'Votre recherche se ferme toute seule dès que vous êtes inscrit·e au tournoi.'));
        return carte;
    }

    function blocHistorique() {
        var carte = el('section', 'ej-carte');
        carte.appendChild(el('h2', null, 'Mes tournois'));
        var h = donnees.historique || [];
        if (!h.length) carte.appendChild(el('p', null, 'Vos tournois joués au Rebond apparaîtront ici.'));
        else {
            var ul = el('ul', 'ej-historique');
            h.forEach(function (t) {
                var li = el('li');
                li.appendChild(el('strong', null, t.tournoi));
                li.appendChild(document.createTextNode(' — ' + new Date(t.date + 'T00:00:00').toLocaleDateString('fr-FR') + ' avec ' + t.partenaire + ' '));
                if (t.place) {
                    var medaille = { 1: '🥇 ', 2: '🥈 ', 3: '🥉 ' }[t.place] || '';
                    var pts = t.homologue ? FFTBareme.points(t.categorie, t.place, t.nb_equipes) : null;
                    li.appendChild(el('span', 'ej-place', medaille + (t.place === 1 ? '1er' : t.place + 'e') + ' / ' + t.nb_equipes
                        + (pts != null ? ' · ' + pts + ' pts FFT' : '')));
                    li.appendChild(document.createTextNode(' '));
                }
                var a = el('a', null, 'résultats');
                a.href = 'live/tournoi/#t=' + t.tournoi_id;   // la page live lit le tournoi dans le hash
                li.appendChild(a);
                ul.appendChild(li);
            });
            carte.appendChild(ul);
        }
        var p = donnees.partenaires || [];
        if (p.length) {
            carte.appendChild(el('h3', null, 'Mes partenaires'));
            var grille = el('div', 'ej-partenaires');
            p.slice(0, 6).forEach(function (x) {
                var b = el('div', 'ej-partenaire');
                b.appendChild(el('strong', null, x.prenom + ' ' + x.nom));
                b.appendChild(el('span', null, (x.fft_rang ? nombre(x.fft_rang) + 'e FFT · ' : '') + x.fois + ' tournoi' + (x.fois > 1 ? 's' : '') + ' ensemble'));
                var a = el('a', null, 'Rejouer ensemble →');
                a.href = 'tournois/?pprenom=' + encodeURIComponent(x.prenom) + '&pnom=' + encodeURIComponent(x.nom);
                b.appendChild(a);
                grille.appendChild(b);
            });
            carte.appendChild(grille);
        }
        return carte;
    }

    // ----- Simulateur de points FFT -----

    function blocSimulateur() {
        var carte = el('section', 'ej-carte');
        carte.appendChild(el('h2', null, 'Simulateur de points FFT'));
        carte.appendChild(el('p', 'ej-note', 'Combien de points rapporte un tournoi, selon votre place et le nombre de paires ? Barème officiel FFT (chapitre II).'));
        var ligne = el('div', 'ej-simu');
        var cat = el('select', 'ins-input');
        FFTBareme.CATEGORIES.forEach(function (c) { var o = el('option', null, c); o.value = c; cat.appendChild(o); });
        cat.value = 'P100';
        var nb = el('input', 'ins-input'); nb.type = 'number'; nb.min = 4; nb.max = 64; nb.value = 16;
        var place = el('input', 'ins-input'); place.type = 'number'; place.min = 1; place.max = 64; place.value = 1;
        [['Catégorie', cat], ['Paires', nb], ['Place', place]].forEach(function (c) {
            var l = el('label', 'ins-champ'); l.appendChild(el('span', 'ins-champ__label', c[0])); l.appendChild(c[1]); ligne.appendChild(l);
        });
        carte.appendChild(ligne);
        var resultat = el('p', 'ej-simu__resultat');
        carte.appendChild(resultat);
        var tableau = el('div', 'ej-simu__grille');
        carte.appendChild(tableau);
        function maj() {
            var n = Math.max(4, Math.min(64, parseInt(nb.value, 10) || 4));
            var pl = Math.max(1, Math.min(n, parseInt(place.value, 10) || 1));
            var pts = FFTBareme.points(cat.value, pl, n);
            resultat.textContent = pts == null ? '' : (pl === 1 ? 'Victoire' : pl + 'e place') + ' sur ' + n + ' paires en ' + cat.value
                + ' : ' + pts + ' point' + (pts > 1 ? 's' : '') + ' par joueur.';
            tableau.innerHTML = '';
            FFTBareme.grille(cat.value, n).slice(0, 16).forEach(function (g) {
                var c = el('span', 'ej-simu__case' + (g.place === pl ? ' ej-simu__case--actif' : ''), g.place + 'e : ' + g.points);
                tableau.appendChild(c);
            });
        }
        [cat, nb, place].forEach(function (i) { i.addEventListener('input', maj); });
        maj();
        return carte;
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
