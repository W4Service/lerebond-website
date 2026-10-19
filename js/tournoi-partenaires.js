/* ============================================
   RECHERCHE DE PARTENAIRE (page /tournois/partenaires/?t=<tournoi>)
   - Liste des joueurs sans binôme : prénom, initiale, classement, club, message.
     Jamais de coordonnées à l'écran.
   - « Proposer de jouer ensemble » : le club transmet les coordonnées par e-mail
     aux deux joueurs, qui s'inscrivent ensuite normalement.
   - « Je cherche un partenaire » : se signaler (fermé automatiquement à l'inscription).
   ============================================ */
(function () {
    var supa = window.LeRebondSupa;
    var CLE_PROFIL = 'rebond-inscription-profil';
    var CLE_ESPACE = 'rebond-espace-joueur';
    var tournoi = null;

    function $(id) { return document.getElementById(id); }
    function el(tag, cls, texte) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (texte != null) e.textContent = texte;
        return e;
    }
    function lire(cle) { try { return JSON.parse(localStorage.getItem(cle) || 'null'); } catch (e) { return null; } }
    function ecrire(cle, v) { try { localStorage.setItem(cle, JSON.stringify(v)); } catch (e) { /* navigation privée */ } }
    function dateLongue(iso) { return new Date(iso + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }); }

    async function charger() {
        var id = new URLSearchParams(location.search).get('t');
        var zone = $('part-contenu');
        if (!supa || !id) { zone.innerHTML = '<p class="events-empty">Tournoi introuvable. <a href="tournois/">Voir le calendrier</a></p>'; return; }
        var res = await supa.from('tournois_calendrier').select('*').eq('id', id).maybeSingle();
        if (res.error || !res.data) { zone.innerHTML = '<p class="events-empty">Tournoi introuvable. <a href="tournois/">Voir le calendrier</a></p>'; return; }
        tournoi = res.data;
        document.title = 'Trouver un partenaire — ' + tournoi.nom + ' | Le Rebond';
        $('part-titre').textContent = 'Trouver un partenaire';
        $('part-infos').textContent = tournoi.nom + ' · ' + dateLongue(tournoi.date);
        await afficher();
    }

    async function afficher() {
        var zone = $('part-contenu');
        zone.innerHTML = '';
        var res = await supa.rpc('partenaires_recherches', { p_tournoi: tournoi.id });
        var liste = res.data || [];

        var carteListe = el('section', 'ins-form part-liste');
        carteListe.appendChild(el('h2', 'part-titre', liste.length
            ? liste.length + ' joueur' + (liste.length > 1 ? 's cherchent' : ' cherche') + ' un partenaire'
            : 'Personne ne cherche de partenaire pour l\'instant'));
        if (!liste.length) carteListe.appendChild(el('p', 'ej-note', 'Soyez le premier : signalez-vous ci-dessous, les autres joueurs pourront vous proposer de jouer ensemble.'));
        liste.forEach(function (r) { carteListe.appendChild(ligneRecherche(r)); });
        zone.appendChild(carteListe);

        zone.appendChild(formulaireRecherche());

        var lien = el('p', 'part-deja');
        lien.appendChild(document.createTextNode('Vous avez déjà un partenaire ? '));
        var a = el('a', null, 'Inscrivez votre paire →'); a.href = 'tournois/inscription/?t=' + tournoi.id;
        lien.appendChild(a);
        zone.appendChild(lien);
    }

    function ligneRecherche(r) {
        var b = el('div', 'part-joueur');
        var tete = el('div', 'part-joueur__tete');
        tete.appendChild(el('strong', null, r.prenom + ' ' + r.initiale));
        tete.appendChild(el('span', 'part-joueur__rang', r.fft_rang ? FFTRecherche.formaterNombre(r.fft_rang) + 'e FFT' : 'non classé·e'));
        b.appendChild(tete);
        var infos = [r.genre === 'F' ? 'Joueuse' : 'Joueur', r.fft_club].filter(Boolean).join(' · ');
        b.appendChild(el('p', 'part-joueur__infos', infos));
        if (r.message) b.appendChild(el('p', 'part-joueur__message', '« ' + r.message + ' »'));
        var bouton = el('button', 'btn btn--primary', 'Proposer de jouer ensemble');
        bouton.type = 'button';
        bouton.addEventListener('click', function () {
            bouton.remove();
            b.appendChild(formulaireContact('Vos coordonnées seront transmises à ' + r.prenom + ' par e-mail, et les siennes à vous.',
                'Envoyer ma proposition', function (joueur, message) {
                    return supa.rpc('proposer_partenaire', { p_recherche: r.id, p_joueur: joueur, p_message: message });
                }, function () {
                    return 'Proposition envoyée ! ' + r.prenom + ' a reçu vos coordonnées, et vous les siennes par e-mail. '
                        + 'Une fois d\'accord, l\'un de vous inscrit la paire.';
                }));
        });
        b.appendChild(bouton);
        return b;
    }

    function formulaireRecherche() {
        var carte = el('section', 'ins-form');
        carte.appendChild(el('h2', 'part-titre', 'Je cherche un partenaire'));
        carte.appendChild(formulaireContact('Les autres joueurs verront votre prénom, l\'initiale de votre nom, votre classement et votre message — jamais vos coordonnées.',
            'Me signaler', function (joueur, message) {
                return supa.rpc('chercher_partenaire', { p_tournoi: tournoi.id, p_joueur: joueur, p_message: message });
            }, function (data) {
                var jeton = data && data.lien ? new URL(data.lien).searchParams.get('j') : null;
                if (jeton) ecrire(CLE_ESPACE, jeton);
                setTimeout(afficher, 2500);
                return 'C\'est noté ! Vous apparaissez dans la liste. Vous recevrez un e-mail à chaque proposition. '
                    + 'Votre recherche se ferme toute seule dès que vous êtes inscrit·e.';
            }));
        return carte;
    }

    // Formulaire joueur (avec suggestions FFT) + message, partagé par « proposer » et « chercher ».
    function formulaireContact(aide, libelleBouton, envoyer, succes) {
        var form = el('form', 'part-form');
        form.noValidate = true;
        var profil = lire(CLE_PROFIL) || {};
        var choix = profil.fft || null;
        function saisie(type, placeholder, valeur, auto) {
            var i = el('input', 'ins-input'); i.type = type; i.placeholder = placeholder; i.value = valeur || '';
            if (auto) i.autocomplete = auto;
            return i;
        }
        function champ(label, input) {
            var c = el('label', 'ins-champ');
            c.appendChild(el('span', 'ins-champ__label', label));
            c.appendChild(input);
            return c;
        }
        var prenom = saisie('text', 'Prénom', profil.prenom, 'given-name');
        var nom = saisie('text', 'Nom', profil.nom, 'family-name');
        var email = saisie('email', 'adresse@exemple.fr', profil.email, 'email');
        var tel = saisie('tel', '06 12 34 56 78', profil.telephone, 'tel');
        var message = el('textarea', 'ins-input'); message.rows = 2; message.maxLength = 300;
        message.placeholder = 'Ex. : joueur de gauche, dispo dès 18h, niveau P100…';
        var l1 = el('div', 'ins-ligne'); l1.appendChild(champ('Prénom', prenom)); l1.appendChild(champ('Nom', nom));
        var l2 = el('div', 'ins-ligne'); l2.appendChild(champ('E-mail', email)); l2.appendChild(champ('Téléphone', tel));
        var badge = el('p', 'ins-fft');
        function majBadge() {
            badge.className = 'ins-fft' + (choix ? ' ins-fft--ok' : '');
            badge.textContent = choix ? 'Classé·e ' + FFTRecherche.formaterNombre(choix.rang) + 'e' + (choix.club ? ' · ' + choix.club : '') : 'Tapez votre nom : on cherche votre classement FFT.';
        }
        [prenom, nom].forEach(function (inp) {
            inp.addEventListener('input', function () {
                if (choix && FFTRecherche.normaliser(choix.prenom + ' ' + choix.nom) !== FFTRecherche.normaliser(prenom.value + ' ' + nom.value)) choix = null;
                majBadge();
            });
            FFTRecherche.attacher(inp, {
                supa: supa,
                requete: function () { return prenom.value + ' ' + nom.value; },
                genre: function () { return tournoi.genre === 'dames' ? 'F' : null; },
                onChoix: function (j) { prenom.value = j.prenom; nom.value = j.nom; choix = j; majBadge(); }
            });
        });
        majBadge();
        form.appendChild(l1); form.appendChild(badge); form.appendChild(l2);
        form.appendChild(champ('Message (facultatif)', message));
        form.appendChild(el('p', 'ej-note', aide));
        var alerte = el('div', 'ins-alerte'); alerte.hidden = true;
        form.appendChild(alerte);
        var bouton = el('button', 'btn btn--primary', libelleBouton); bouton.type = 'submit';
        form.appendChild(bouton);
        form.addEventListener('submit', async function (e) {
            e.preventDefault();
            var joueur = { prenom: prenom.value.trim(), nom: nom.value.trim(), email: email.value.trim(), telephone: tel.value.trim(),
                           id_crm: choix ? choix.id_crm : null, genre: choix ? choix.genre : null };
            if (!joueur.prenom || !joueur.nom || !joueur.email || !joueur.telephone) {
                alerte.hidden = false; alerte.className = 'ins-alerte ins-alerte--erreur';
                alerte.textContent = 'Prénom, nom, e-mail et téléphone sont obligatoires.';
                return;
            }
            bouton.disabled = true;
            var res = await envoyer(joueur, message.value);
            bouton.disabled = false;
            alerte.hidden = false;
            if (res.error) {
                alerte.className = 'ins-alerte ins-alerte--erreur';
                alerte.textContent = res.error.message;
                return;
            }
            ecrire(CLE_PROFIL, { prenom: joueur.prenom, nom: joueur.nom, email: joueur.email, telephone: joueur.telephone, fft: choix });
            alerte.className = 'ins-alerte part-ok';
            alerte.textContent = succes(res.data);
            bouton.hidden = true;
        });
        return form;
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', charger);
    else charger();
})();
