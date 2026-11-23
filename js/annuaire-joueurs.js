/* ============================================
   ANNUAIRE DES JOUEURS (page /joueurs/)
   Réservé aux joueurs qui ont un espace joueur : le lien personnel (jeton) gardé
   par la page espace-joueur dans le navigateur sert d'identité. Sans lien, la page
   explique comment l'obtenir. Seuls les profils « ouverts aux propositions »
   apparaissent : prénom + initiale du nom, jamais d'e-mail ni de téléphone.
   ============================================ */
(function () {
    var supa = window.LeRebondSupa;
    var CLE_ESPACE = 'rebond-espace-joueur';
    var COTES = { droite: 'Côté droit', gauche: 'Côté gauche', les_deux: 'Les deux côtés' };
    var DISPOS = [['semaine_midi', 'Semaine midi'], ['semaine_soir', 'Semaine soir'],
                  ['weekend_matin', 'Week-end matin'], ['weekend_apres_midi', 'Week-end après-midi']];
    var NIVEAUX = ['', 'Débutant', 'Débutant +', 'Initié', 'Intermédiaire', 'Intermédiaire +', 'Confirmé', 'Avancé', 'Expert'];
    var jeton = null, moi = null;

    function $(id) { return document.getElementById(id); }
    function el(tag, cls, texte) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (texte != null) e.textContent = texte;
        return e;
    }
    function lire() { try { return JSON.parse(localStorage.getItem(CLE_ESPACE) || 'null'); } catch (e) { return null; } }
    function ecrire(v) { try { v ? localStorage.setItem(CLE_ESPACE, JSON.stringify(v)) : localStorage.removeItem(CLE_ESPACE); } catch (e) { /* navigation privée */ } }
    function nombre(n) { return n == null ? '–' : Number(n).toLocaleString('fr-FR'); }
    function libelleDispo(v) { for (var i = 0; i < DISPOS.length; i++) if (DISPOS[i][0] === v) return DISPOS[i][1]; return v; }
    function rpcAbsente(err) { return !!err && (err.code === 'PGRST202' || err.code === '42883'); }
    function lien(texte, href, cls) { var a = el('a', cls || null, texte); a.href = href; return a; }
    function choixListe(options, valeur) {
        var s = el('select', 'ins-input');
        options.forEach(function (o) { var opt = el('option', null, o[1]); opt.value = o[0]; s.appendChild(opt); });
        s.value = valeur || '';
        return s;
    }
    function champ(label, input) {
        var c = el('label', 'ins-champ');
        c.appendChild(el('span', 'ins-champ__label', label));
        c.appendChild(input);
        return c;
    }

    async function init() {
        jeton = lire();
        if (!supa) return afficherSansLien();
        if (!jeton) return afficherSansLien();
        var res = await supa.rpc('mon_profil', { p_jeton: jeton });
        if (res.error) {
            if (rpcAbsente(res.error)) return afficherMessage('L\'annuaire des joueurs arrive très bientôt. Revenez dans quelques jours !');
            // Le lien n'est oublié que s'il est refusé (inconnu ou mal formé), pas sur une panne passagère.
            if (res.error.code !== '42501' && res.error.code !== '22P02') {
                return afficherMessage('Impossible de charger l\'annuaire pour le moment. Réessayez dans un instant.');
            }
            ecrire(null);
            return afficherSansLien('Ce lien n\'est plus valable. Demandez-en un nouveau ci-dessous.');
        }
        moi = res.data || {};
        afficherAnnuaire();
    }

    function afficherMessage(texte) {
        var zone = $('ann-contenu');
        zone.innerHTML = '';
        var carte = el('section', 'ej-carte');
        carte.appendChild(el('p', null, texte));
        carte.appendChild(lien('Mon espace joueur', 'espace-joueur/', 'btn btn--outline-dark'));
        zone.appendChild(carte);
    }

    // ----- Sans lien : l'annuaire n'est pas public -----

    function afficherSansLien(message) {
        var zone = $('ann-contenu');
        zone.innerHTML = '';
        var carte = el('section', 'ej-carte ej-accueil');
        carte.appendChild(el('h2', null, 'Réservé aux joueurs du club'));
        if (message) carte.appendChild(el('p', 'ej-alerte', message));
        carte.appendChild(el('p', null, 'L\'annuaire des joueurs n\'est visible que par les joueurs qui ont un espace joueur. '
            + 'Il s\'ouvre avec le lien personnel reçu lors de votre inscription à un tournoi. Vous l\'avez perdu ? Indiquez votre e-mail, on vous le renvoie.'));
        var form = el('form', 'ej-lien');
        var input = el('input', 'ins-input'); input.type = 'email'; input.required = true;
        input.placeholder = 'adresse@exemple.fr'; input.autocomplete = 'email';
        var bouton = el('button', 'btn btn--primary', 'Recevoir mon lien'); bouton.type = 'submit';
        form.appendChild(input); form.appendChild(bouton);
        var retour = el('p', 'ej-note');
        form.addEventListener('submit', async function (e) {
            e.preventDefault();
            if (!supa) return;
            bouton.disabled = true;
            await supa.rpc('envoyer_mon_lien', { p_email: input.value });
            retour.textContent = 'Si cette adresse correspond à un joueur inscrit, le lien vient de lui être envoyé (pensez à vérifier les indésirables). '
                + 'Ouvrez-le une fois : l\'annuaire sera ensuite accessible depuis cet appareil.';
            bouton.disabled = false;
        });
        carte.appendChild(form);
        carte.appendChild(retour);
        carte.appendChild(lien('Voir les tournois à venir', 'tournois/', 'btn btn--outline-dark'));
        zone.appendChild(carte);
    }

    // ----- Avec lien : filtres + cartes -----

    function afficherAnnuaire() {
        var zone = $('ann-contenu');
        zone.innerHTML = '';
        if (!moi.profil || !moi.profil.ouvert) {
            var bandeau = el('div', 'ann-bandeau');
            bandeau.appendChild(el('p', null, moi.profil
                ? 'Votre profil n\'apparaît pas dans l\'annuaire : cochez « Apparaître dans l\'annuaire des joueurs » dans votre espace pour que les autres puissent vous proposer de jouer.'
                : 'Vous n\'êtes pas encore dans l\'annuaire. Créez votre profil joueur (côté, disponibilités, présentation) dans votre espace : les autres pourront vous proposer de jouer.'));
            bandeau.appendChild(lien(moi.profil ? 'Modifier mon profil →' : 'Créer mon profil →', 'espace-joueur/'));
            zone.appendChild(bandeau);
        }

        var filtres = el('form', 'ej-carte ann-filtres');
        filtres.noValidate = true;
        var genre = choixListe([['', 'Tous'], ['H', 'Joueurs'], ['F', 'Joueuses']]);
        var cote = choixListe([['', 'Peu importe'], ['droite', 'Droite'], ['gauche', 'Gauche'], ['les_deux', 'Les deux']]);
        var dispo = choixListe([['', 'Peu importe']].concat(DISPOS));
        var rang = el('input', 'ins-input'); rang.type = 'number'; rang.min = 1; rang.placeholder = 'ex. 5000'; rang.inputMode = 'numeric';
        var texte = el('input', 'ins-input'); texte.type = 'search'; texte.maxLength = 50; texte.placeholder = 'Prénom, mot de la présentation…';
        var ligne = el('div', 'ann-filtres__grille');
        ligne.appendChild(champ('Genre', genre));
        ligne.appendChild(champ('Côté', cote));
        ligne.appendChild(champ('Disponibilité', dispo));
        ligne.appendChild(champ('Classement FFT max', rang));
        ligne.appendChild(champ('Recherche', texte));
        filtres.appendChild(ligne);
        var go = el('button', 'btn btn--primary', 'Rechercher'); go.type = 'submit';
        filtres.appendChild(go);
        zone.appendChild(filtres);

        var resultats = el('div', 'ann-resultats');
        zone.appendChild(resultats);

        function valeurs() {
            var f = {};
            if (genre.value) f.genre = genre.value;
            if (cote.value) f.cote = cote.value;
            if (dispo.value) f.dispo = dispo.value;
            if (/^\d{1,7}$/.test(rang.value.trim())) f.rang_max = parseInt(rang.value.trim(), 10);
            if (texte.value.trim()) f.texte = texte.value.trim();
            return f;
        }
        async function chercher() {
            resultats.innerHTML = '';
            resultats.appendChild(el('p', 'ann-compte', 'Recherche…'));
            var res = await supa.rpc('annuaire_joueurs', { p_jeton: jeton, p_filtres: valeurs() });
            resultats.innerHTML = '';
            if (res.error) { resultats.appendChild(el('p', 'ins-alerte ins-alerte--erreur', res.error.message)); return; }
            var liste = res.data || [];
            resultats.appendChild(el('p', 'ann-compte', liste.length
                ? liste.length + ' joueur' + (liste.length > 1 ? 's ouverts' : ' ouvert') + ' aux propositions'
                : 'Aucun joueur ne correspond à ces critères pour l\'instant.'));
            liste.forEach(function (j) { resultats.appendChild(carteJoueur(j)); });
        }
        filtres.addEventListener('submit', function (e) { e.preventDefault(); chercher(); });
        [genre, cote, dispo].forEach(function (s) { s.addEventListener('change', chercher); });
        chercher();

        var retour = el('p', 'part-deja');
        retour.appendChild(lien('← Mon espace joueur', 'espace-joueur/'));
        zone.appendChild(retour);
    }

    function niveauTexte(j) {
        if (j.fft_rang) return nombre(j.fft_rang) + 'e FFT';
        if (j.niveau_declare) return 'Niveau ' + j.niveau_declare + '/8 · ' + NIVEAUX[j.niveau_declare];
        return 'Non classé·e';
    }

    function carteJoueur(j) {
        var c = el('article', 'ann-carte');
        var tete = el('div', 'ann-carte__tete');
        tete.appendChild(el('strong', 'ann-carte__nom', j.prenom + ' ' + j.initiale));
        tete.appendChild(el('span', 'ann-carte__niveau', niveauTexte(j)));
        c.appendChild(tete);
        var infos = [j.genre === 'F' ? 'Joueuse' : j.genre === 'H' ? 'Joueur' : null, COTES[j.cote] || null].filter(Boolean);
        if (infos.length) c.appendChild(el('p', 'ann-carte__infos', infos.join(' · ')));
        var dispos = j.dispos || [];
        if (dispos.length) {
            var ul = el('ul', 'ann-dispos');
            dispos.forEach(function (d) { ul.appendChild(el('li', null, libelleDispo(d))); });
            c.appendChild(ul);
        }
        if (j.presentation) c.appendChild(el('p', 'ann-carte__presentation', '« ' + j.presentation + ' »'));
        c.appendChild(el('p', 'ann-carte__tournois', j.nb_tournois
            ? j.nb_tournois + ' tournoi' + (j.nb_tournois > 1 ? 's' : '') + ' joué' + (j.nb_tournois > 1 ? 's' : '') + ' au Rebond'
              + (j.meilleure_place ? ' · meilleure place : ' + (j.meilleure_place === 1 ? '1re' : j.meilleure_place + 'e') : '')
            : 'Pas encore de tournoi au Rebond'));

        var actions = el('div', 'ej-actions');
        var voir = el('button', 'btn btn--outline-dark', 'Voir le profil'); voir.type = 'button';
        var proposer = el('button', 'btn btn--primary', 'Proposer de jouer'); proposer.type = 'button';
        actions.appendChild(voir); actions.appendChild(proposer);
        c.appendChild(actions);

        var fiche = null, form = null;
        voir.addEventListener('click', async function () {
            if (fiche) { fiche.remove(); fiche = null; voir.textContent = 'Voir le profil'; return; }
            voir.disabled = true;
            var res = await supa.rpc('fiche_joueur', { p_jeton: jeton, p_joueur: j.ref });
            voir.disabled = false;
            fiche = el('div', 'ann-fiche');
            if (res.error) fiche.appendChild(el('p', 'ins-alerte ins-alerte--erreur', res.error.message));
            else remplirFiche(fiche, res.data || {});
            c.insertBefore(fiche, actions);
            voir.textContent = 'Masquer le profil';
        });
        proposer.addEventListener('click', function () {
            if (!form) {
                form = formulaireMessage(j, function () { proposer.remove(); });
                c.appendChild(form.form);
            }
            form.zone.focus();
        });
        return c;
    }

    function remplirFiche(zone, f) {
        var t = f.tournois || [];
        zone.appendChild(el('h3', null, 'Tournois au Rebond'));
        if (!t.length) zone.appendChild(el('p', 'ej-note', 'Aucun tournoi joué au club pour l\'instant.'));
        else {
            var ul = el('ul', 'ej-historique');
            t.forEach(function (x) {
                ul.appendChild(el('li', null, new Date(x.date + 'T00:00:00').toLocaleDateString('fr-FR') + ' — ' + x.tournoi
                    + (x.place ? ' · ' + (x.place === 1 ? '1re' : x.place + 'e') + ' place' : '')));
            });
            zone.appendChild(ul);
        }
        var h = f.historique_classement || [];
        if (h.length) {
            zone.appendChild(el('h3', null, 'Évolution du classement FFT'));
            var p = el('ul', 'ann-classement');
            h.slice(-6).forEach(function (x) {
                p.appendChild(el('li', null, (window.FFTRecherche ? FFTRecherche.moisAffiche(x.mois) : x.mois) + ' : ' + nombre(x.rang) + 'e'));
            });
            zone.appendChild(p);
        }
    }

    function formulaireMessage(j, apres) {
        var form = el('form', 'part-form ann-message');
        form.noValidate = true;
        var zone = el('textarea', 'ins-input'); zone.rows = 3; zone.maxLength = 1000;
        zone.placeholder = 'Ex. : Bonjour ' + j.prenom + ' ! Partant·e pour une partie jeudi soir au Rebond ?';
        form.appendChild(champ('Votre message à ' + j.prenom, zone));
        form.appendChild(el('p', 'ej-note', j.prenom + ' reçoit un e-mail (sans vos coordonnées) et vous répond depuis son espace joueur. '
            + 'Vos échanges sont dans votre espace, rubrique Messages.'));
        var alerte = el('div', 'ins-alerte'); alerte.hidden = true;
        form.appendChild(alerte);
        var bouton = el('button', 'btn btn--primary', 'Envoyer'); bouton.type = 'submit';
        form.appendChild(bouton);
        form.addEventListener('submit', async function (e) {
            e.preventDefault();
            if (!zone.value.trim()) {
                alerte.hidden = false; alerte.className = 'ins-alerte ins-alerte--erreur';
                alerte.textContent = 'Écrivez un message.';
                return;
            }
            bouton.disabled = true;
            var res = await supa.rpc('envoyer_message', { p_jeton: jeton, p_dest: j.ref, p_texte: zone.value });
            bouton.disabled = false;
            alerte.hidden = false;
            if (res.error) {
                alerte.className = 'ins-alerte ins-alerte--erreur';
                alerte.textContent = res.error.message;
                return;
            }
            alerte.className = 'ins-alerte part-ok';
            alerte.textContent = 'Message envoyé à ' + j.prenom + ' ! Sa réponse arrivera dans votre espace joueur, rubrique Messages.';
            // Le formulaire est retiré (et pas seulement masqué : .btn{display:inline-flex} l'emporte
            // sur [hidden]) : pas de second envoi du même message.
            zone.value = '';
            form.textContent = '';
            form.appendChild(alerte);
            var suite = el('p', 'ann-suite');
            suite.appendChild(lien('Voir mes messages →', 'espace-joueur/'));
            form.appendChild(suite);
            if (apres) apres();
        });
        return { form: form, zone: zone };
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
