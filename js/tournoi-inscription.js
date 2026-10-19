/* ============================================
   INSCRIPTION D'UNE PAIRE (page /tournois/inscription/?t=<tournoi>)
   - Suggestions FFT pour chaque joueur : le classement et l'identifiant FFT
     viennent du classement officiel, pas de la saisie.
   - Contrôle d'éligibilité (cuts FFT) avant l'envoi ; le serveur le refait.
   - Pas de compte : le résultat donne un lien personnel vers l'espace joueur.
   ============================================ */
(function () {
    var supa = window.LeRebondSupa;
    var CLE_ESPACE = 'rebond-espace-joueur';
    var CLE_PROFIL = 'rebond-inscription-profil';
    var GENRES = { messieurs: 'Messieurs', dames: 'Dames', mixte: 'Mixte' };

    var tournoi = null;
    var choix = { j1: null, j2: null };   // ligne FFT choisie dans les suggestions

    function $(id) { return document.getElementById(id); }
    function el(tag, cls, texte) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (texte != null) e.textContent = texte;
        return e;
    }
    function lire(cle) { try { return JSON.parse(localStorage.getItem(cle) || 'null'); } catch (e) { return null; } }
    function ecrire(cle, v) { try { localStorage.setItem(cle, JSON.stringify(v)); } catch (e) { /* navigation privée */ } }
    function heure(h) { if (!h) return ''; var p = String(h).split(':'); return parseInt(p[0], 10) + 'h' + (p[1] && p[1] !== '00' ? p[1] : ''); }
    function dateLongue(iso) { return new Date(iso + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }); }

    // ----- Chargement du tournoi -----

    async function charger() {
        var id = new URLSearchParams(location.search).get('t');
        var zone = $('ins-contenu');
        if (!supa || !id) { zone.innerHTML = '<p class="events-empty">Tournoi introuvable. <a href="tournois/">Voir le calendrier</a></p>'; return; }
        var res = await supa.from('tournois_calendrier').select('*').eq('id', id).maybeSingle();
        if (res.error || !res.data) { zone.innerHTML = '<p class="events-empty">Tournoi introuvable. <a href="tournois/">Voir le calendrier</a></p>'; return; }
        tournoi = res.data;
        afficherEntete();
        if (!tournoi.inscription_ouverte) {
            zone.innerHTML = '';
            var p = el('div', 'ins-ferme');
            p.appendChild(el('p', null, 'Les inscriptions en ligne sont fermées pour ce tournoi.'));
            var a = el('a', 'btn btn--outline-dark', 'Retour au calendrier'); a.href = 'tournois/';
            p.appendChild(a);
            zone.appendChild(p);
            return;
        }
        construireFormulaire();
    }

    function afficherEntete() {
        document.title = 'Inscription — ' + tournoi.nom + ' | Le Rebond';
        $('ins-titre').textContent = tournoi.nom;
        var infos = [dateLongue(tournoi.date)];
        if (tournoi.heure_debut) infos.push(heure(tournoi.heure_debut) + (tournoi.heure_fin ? ' – ' + heure(tournoi.heure_fin) : ''));
        if (tournoi.genre) infos.push(GENRES[tournoi.genre]);
        if (tournoi.prix_par_joueur != null) infos.push(Number(tournoi.prix_par_joueur) + ' € / joueur (à régler sur place)');
        $('ins-infos').textContent = infos.join(' · ');
        var places = $('ins-places');
        if (tournoi.nb_equipes_max) {
            var reste = Math.max(0, tournoi.nb_equipes_max - tournoi.inscrits);
            places.textContent = tournoi.complet || tournoi.liste_attente > 0
                ? 'Complet : votre paire ira en liste d\'attente (' + tournoi.liste_attente + ' paire' + (tournoi.liste_attente > 1 ? 's' : '') + ' déjà en attente). Vous serez prévenus si une place se libère.'
                : reste + ' place' + (reste > 1 ? 's' : '') + ' disponible' + (reste > 1 ? 's' : '') + ' sur ' + tournoi.nb_equipes_max + '.';
            places.className = 'ins-places' + (tournoi.complet ? ' ins-places--attente' : '');
        }
    }

    // ----- Formulaire -----

    function champ(label, input, aide) {
        var c = el('label', 'ins-champ');
        c.appendChild(el('span', 'ins-champ__label', label));
        c.appendChild(input);
        if (aide) c.appendChild(el('span', 'ins-champ__aide', aide));
        return c;
    }
    function saisie(type, nom, placeholder, auto) {
        var i = el('input', 'ins-input');
        i.type = type; i.name = nom; i.placeholder = placeholder || '';
        if (auto) i.autocomplete = auto;
        return i;
    }

    function blocJoueur(slot, titre, obligatoire) {
        var bloc = el('fieldset', 'ins-joueur');
        bloc.appendChild(el('legend', null, titre));
        var ligneNom = el('div', 'ins-ligne');
        var prenom = saisie('text', slot + '_prenom', 'Prénom', slot === 'j1' ? 'given-name' : 'off');
        var nom = saisie('text', slot + '_nom', 'Nom', slot === 'j1' ? 'family-name' : 'off');
        prenom.required = true; nom.required = true;
        ligneNom.appendChild(champ('Prénom', prenom));
        ligneNom.appendChild(champ('Nom', nom));
        bloc.appendChild(ligneNom);

        var badge = el('p', 'ins-fft');
        badge.textContent = 'Commencez à taper : on cherche le joueur dans le classement FFT.';
        bloc.appendChild(badge);

        var ligneContact = el('div', 'ins-ligne');
        var email = saisie('email', slot + '_email', 'adresse@exemple.fr', slot === 'j1' ? 'email' : 'off');
        var tel = saisie('tel', slot + '_telephone', '06 12 34 56 78', slot === 'j1' ? 'tel' : 'off');
        if (obligatoire) { email.required = true; tel.required = true; }
        ligneContact.appendChild(champ('E-mail', email));
        ligneContact.appendChild(champ('Téléphone', tel, obligatoire ? null : 'E-mail ou téléphone : pour qu\'il/elle confirme'));
        bloc.appendChild(ligneContact);

        function majBadge() {
            var c = choix[slot];
            badge.className = 'ins-fft' + (c ? ' ins-fft--ok' : '');
            badge.textContent = c
                ? 'Classé·e ' + FFTRecherche.formaterNombre(c.rang) + 'e (' + (c.genre === 'F' ? 'dames' : 'messieurs')
                  + (c.club ? ' · ' + c.club : '') + ') — classement FFT de ' + FFTRecherche.moisAffiche(c.mois)
                : (FFTRecherche.normaliser(prenom.value + nom.value).length >= 4
                    ? 'Pas trouvé·e dans le classement : sera inscrit·e comme non classé·e. Choisissez une suggestion si elle apparaît.'
                    : 'Commencez à taper : on cherche le joueur dans le classement FFT.');
            verifierEligibilite();
        }
        function surSaisie() {
            var c = choix[slot];
            if (c && FFTRecherche.normaliser(c.prenom + ' ' + c.nom) !== FFTRecherche.normaliser(prenom.value + ' ' + nom.value)) {
                choix[slot] = null;
            }
            majBadge();
        }
        [prenom, nom].forEach(function (inp) {
            inp.addEventListener('input', surSaisie);
            FFTRecherche.attacher(inp, {
                supa: supa,
                requete: function () { return prenom.value + ' ' + nom.value; },
                // Tableau dames : que des joueuses. Messieurs et mixte : les deux (une joueuse peut
                // jouer en messieurs avec l'équivalence FFT).
                genre: function () { return tournoi.genre === 'dames' ? 'F' : null; },
                onChoix: function (j) {
                    prenom.value = j.prenom; nom.value = j.nom;
                    choix[slot] = j;
                    majBadge();
                }
            });
        });
        return { bloc: bloc, prenom: prenom, nom: nom, email: email, tel: tel, majBadge: majBadge };
    }

    var j1, j2, zoneAlerte, zonePoids, bouton;

    function construireFormulaire() {
        var zone = $('ins-contenu');
        zone.innerHTML = '';
        var form = el('form', 'ins-form');
        form.noValidate = true;

        j1 = blocJoueur('j1', 'Vous', true);
        j2 = blocJoueur('j2', 'Votre partenaire', false);
        form.appendChild(j1.bloc);
        form.appendChild(j2.bloc);

        zonePoids = el('p', 'ins-poids');
        form.appendChild(zonePoids);
        zoneAlerte = el('div', 'ins-alerte');
        zoneAlerte.hidden = true;
        form.appendChild(zoneAlerte);

        var message = el('textarea', 'ins-input');
        message.name = 'message'; message.rows = 2; message.maxLength = 500;
        message.placeholder = 'Une info pour le juge-arbitre ? (contrainte horaire, etc.)';
        form.appendChild(champ('Message (facultatif)', message));

        // Piège à robots : champ invisible qu'un humain laisse vide.
        var piege = el('input'); piege.type = 'text'; piege.name = 'site'; piege.tabIndex = -1;
        piege.autocomplete = 'off'; piege.className = 'ins-piege'; piege.setAttribute('aria-hidden', 'true');
        form.appendChild(piege);

        var accord = el('label', 'ins-accord');
        var caseAccord = el('input'); caseAccord.type = 'checkbox'; caseAccord.required = true;
        accord.appendChild(caseAccord);
        accord.appendChild(document.createTextNode(' J\'accepte que nos coordonnées servent uniquement à l\'organisation de ce tournoi (confirmation, convocation, liste d\'attente). '));
        var lien = el('a', null, 'Confidentialité'); lien.href = 'politique-confidentialite/'; lien.target = '_blank';
        accord.appendChild(lien);
        form.appendChild(accord);

        bouton = el('button', 'btn btn--primary ins-envoyer', tournoi.complet ? 'S\'inscrire en liste d\'attente' : 'Inscrire notre paire');
        bouton.type = 'submit';
        form.appendChild(bouton);

        form.addEventListener('submit', function (e) { e.preventDefault(); envoyer(form, message, piege, caseAccord); });
        zone.appendChild(form);
        var aide = el('p', 'part-deja');
        var a1 = el('a', null, 'Pas encore de partenaire ? Trouvez-en un →'); a1.href = 'tournois/partenaires/?t=' + tournoi.id;
        aide.appendChild(a1);
        if (tournoi.homologue) {
            aide.appendChild(document.createTextNode(' · '));
            var a2 = el('a', null, 'Pas de licence FFT ? Demandez-la →'); a2.href = 'licence/';
            aide.appendChild(a2);
        }
        zone.appendChild(aide);
        preremplir();
    }

    // Reprend les coordonnées de la dernière inscription, et le partenaire passé en paramètre
    // (« Se réinscrire avec … » depuis l'espace joueur).
    function preremplir() {
        var p = lire(CLE_PROFIL);
        if (p) {
            j1.prenom.value = p.prenom || ''; j1.nom.value = p.nom || '';
            j1.email.value = p.email || ''; j1.tel.value = p.telephone || '';
            if (p.fft) choix.j1 = p.fft;
        }
        var q = new URLSearchParams(location.search);
        if (q.get('pprenom')) j2.prenom.value = q.get('pprenom');
        if (q.get('pnom')) j2.nom.value = q.get('pnom');
        j1.majBadge(); j2.majBadge();
        // Rafraîchit le classement du partenaire prérempli
        if (j2.prenom.value && j2.nom.value) {
            FFTRecherche.rechercherPartout(supa, j2.prenom.value + ' ' + j2.nom.value, {}).then(function (r) {
                var exact = (r || []).filter(function (x) {
                    return FFTRecherche.normaliser(x.prenom + ' ' + x.nom) === FFTRecherche.normaliser(j2.prenom.value + ' ' + j2.nom.value);
                });
                if (exact.length === 1) { choix.j2 = exact[0]; j2.majBadge(); }
            });
        }
    }

    var dernierControle = 0;
    async function verifierEligibilite() {
        if (!tournoi || !zonePoids) return;
        var r1 = choix.j1 && choix.j1.rang, r2 = choix.j2 && choix.j2.rang;
        zonePoids.textContent = (r1 && r2)
            ? 'Poids de la paire : ' + FFTRecherche.formaterNombre(r1 + r2) + ' (somme des classements — plus il est petit, mieux la paire est classée).'
            : '';
        var n = ++dernierControle;
        var motifs = [];
        if (tournoi.homologue) {
            for (var slot of ['j1', 'j2']) {
                var c = choix[slot];
                if (!c) continue;
                var res = await supa.rpc('fft_motif_inegibilite', {
                    p_categorie: tournoi.categorie, p_tableau: tournoi.genre, p_rang: c.rang, p_genre: c.genre
                });
                if (res.data) motifs.push(FFTRecherche.nomAffiche(c) + ' — ' + res.data);
            }
        }
        if (n !== dernierControle) return;
        if (motifs.length) {
            alerte('Inscription impossible dans ce tournoi :\n' + motifs.join('\n'), 'erreur');
            bouton.disabled = true;
        } else {
            zoneAlerte.hidden = true;
            if (bouton) bouton.disabled = false;
        }
    }

    function alerte(texte, type) {
        zoneAlerte.hidden = false;
        zoneAlerte.className = 'ins-alerte ins-alerte--' + (type || 'erreur');
        zoneAlerte.textContent = texte;
        zoneAlerte.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function joueurJson(b, slot) {
        var c = choix[slot];
        return {
            prenom: b.prenom.value.trim(), nom: b.nom.value.trim(),
            email: b.email.value.trim(), telephone: b.tel.value.trim(),
            id_crm: c ? c.id_crm : null, genre: c ? c.genre : null
        };
    }

    async function envoyer(form, message, piege, caseAccord) {
        if (piege.value) return;
        var a = joueurJson(j1, 'j1'), b = joueurJson(j2, 'j2');
        if (!a.prenom || !a.nom || !b.prenom || !b.nom) return alerte('Prénom et nom des deux joueurs sont obligatoires.');
        if (!a.email || !a.telephone) return alerte('Votre e-mail et votre téléphone sont obligatoires : c\'est par là que vous recevrez la confirmation et la convocation.');
        if (!b.email && !b.telephone) return alerte('Indiquez l\'e-mail ou le téléphone de votre partenaire, pour qu\'il/elle confirme sa participation.');
        if (!caseAccord.checked) return alerte('Merci de cocher la case d\'accord sur l\'usage de vos coordonnées.');

        bouton.disabled = true;
        bouton.textContent = 'Envoi…';
        var res = await supa.rpc('inscrire_paire', { p_tournoi: tournoi.id, p_j1: a, p_j2: b, p_message: message.value });
        if (res.error) {
            bouton.disabled = false;
            bouton.textContent = 'Inscrire notre paire';
            return alerte(res.error.message || 'L\'inscription n\'a pas pu être enregistrée.');
        }
        ecrire(CLE_PROFIL, { prenom: a.prenom, nom: a.nom, email: a.email, telephone: a.telephone, fft: choix.j1 });
        var jeton = new URL(res.data.lien).searchParams.get('j');
        if (jeton) ecrire(CLE_ESPACE, jeton);
        afficherResultat(res.data, b);
    }

    function afficherResultat(r, partenaire) {
        var zone = $('ins-contenu');
        zone.innerHTML = '';
        var carte = el('div', 'ins-resultat' + (r.statut === 'liste_attente' ? ' ins-resultat--attente' : ''));
        carte.appendChild(el('p', 'ins-resultat__icone', r.statut === 'inscrite' ? '🎾' : '⏳'));
        carte.appendChild(el('h2', null, r.statut === 'inscrite' ? 'Votre paire est inscrite !' : 'Vous êtes en liste d\'attente'));
        carte.appendChild(el('p', null, r.statut === 'inscrite'
            ? 'Rendez-vous au ' + tournoi.nom + ' le ' + dateLongue(tournoi.date) + '. Vous recevrez votre convocation (heure de passage) quelques jours avant.'
            : 'Position ' + r.position + ' sur la liste d\'attente. Si une place se libère, vous passez automatiquement aux inscrits et vous êtes prévenus.'));
        carte.appendChild(el('p', null, partenaire.prenom + ' reçoit un message pour confirmer sa participation.'));
        var lien = el('a', 'btn btn--primary', 'Ouvrir mon espace joueur');
        lien.href = r.lien;
        carte.appendChild(lien);
        carte.appendChild(el('p', 'ins-resultat__note', 'Gardez ce lien : il permet de suivre l\'inscription, de vous désinscrire et de confirmer votre présence. Il vous est aussi envoyé par e-mail et SMS.'));
        zone.appendChild(carte);
        carte.scrollIntoView({ block: 'center' });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', charger);
    else charger();
})();
