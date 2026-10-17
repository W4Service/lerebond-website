/* ============================================
   TOURNOI — PLANNING
   Onglet « Calendrier » de l'admin : planifier les tournois à l'avance et les
   publier sur le-rebond.fr/tournois/.
   - status 'planifie' : annoncé, pas encore joué (invisible pour l'admin jour J)
   - « Lancer » le jour J : passe le tournoi en 'actif' et ouvre l'onglet Tournoi
   ============================================ */
(function () {
    var supa = window.LeRebondSupa;
    if (!supa) return;

    var CATEGORIES = ['P25', 'P50', 'P100', 'P250', 'P500', 'P1000', 'P1500', 'P2000'];
    var GENRES = [
        { v: 'messieurs', label: 'Messieurs' },
        { v: 'dames', label: 'Dames' },
        { v: 'mixte', label: 'Mixte' }
    ];
    // Mêmes valeurs que le formulaire de création de tournoi-admin.js.
    var FORMATS = [
        { v: 'format_b', label: 'B — 2 sets de 6 jeux + super tie-break à 10' },
        { v: 'format_a', label: 'A — 3 sets de 6 jeux (TB à 7)' },
        { v: 'format_c', label: 'C — 2 sets de 4 jeux + super tie-break à 10' },
        { v: 'format_d', label: 'D — 1 set de 9 jeux (TB à 7)' },
        { v: 'format_e', label: 'E — Super tie-break unique à 10 points' },
        { v: '1set_6jeux', label: '1 set à 6 jeux (TB à 6-6, format court)' },
        { v: '1set_5jeux', label: '1 set à 5 jeux (TB à 5-5, format court)' },
        { v: '1set_4jeux', label: '1 set à 4 jeux (TB à 4-4, format ultra-court)' },
        { v: 'libre', label: 'Libre (saisie texte personnalisée)' }
    ];

    var planifies = [];
    var enEdition = null;   // tournoi en cours de modification, null = création
    var panneauOuvert = null;   // id du tournoi dont on affiche les inscriptions
    var compteurs = {};         // id tournoi -> { inscrite, liste_attente }

    function el(tag, attrs, children) {
        var e = document.createElement(tag);
        if (attrs) Object.keys(attrs).forEach(function (k) {
            if (k === 'class') e.className = attrs[k];
            else if (k === 'onclick') e.onclick = attrs[k];
            else if (k === 'onchange') e.onchange = attrs[k];
            else if (k === 'style') e.style.cssText = attrs[k];
            else e.setAttribute(k, attrs[k]);
        });
        (Array.isArray(children) ? children : [children]).forEach(function (c) {
            if (c === null || c === undefined) return;
            e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        });
        return e;
    }

    // Même toast que tournoi-admin.js (même id : un nouveau message remplace l'ancien).
    function toast(message, type) {
        var existing = document.getElementById('live-toast');
        if (existing) existing.remove();
        var t = document.createElement('div');
        t.id = 'live-toast';
        t.textContent = message;
        t.style.cssText = 'position:fixed;bottom:30px;left:50%;transform:translateX(-50%);z-index:9999;' +
            'padding:0.9rem 1.5rem;border-radius:12px;font-family:Kanit,sans-serif;font-weight:600;' +
            'font-size:0.95rem;color:#1a1a1a;box-shadow:0 8px 30px rgba(0,0,0,0.3);' +
            'background:' + (type === 'error' ? '#ea1a15' : '#f4c941') + ';';
        if (type === 'error') t.style.color = '#fff';
        document.body.appendChild(t);
        setTimeout(function () { t.style.opacity = '0'; t.style.transition = 'opacity 0.3s'; }, 3000);
        setTimeout(function () { t.remove(); }, 3500);
    }

    function aujourdhui() {
        var d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function dateLongue(iso) {
        return new Date(iso + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    }

    function heure(h) { return h ? String(h).slice(0, 5).replace(':', 'h') : ''; }

    function libelleGenre(g) {
        var x = GENRES.find(function (o) { return o.v === g; });
        return x ? x.label : '';
    }

    // Nom par défaut : « P100 Messieurs », « Tournoi loisir Mixte »…
    function nomParDefaut(categorie, genre) {
        var base = categorie === 'loisir' ? 'Tournoi loisir' : (categorie || 'Tournoi');
        return (base + ' ' + libelleGenre(genre)).trim();
    }

    async function charger() {
        var res = await supa.from('tournois').select('*').eq('status', 'planifie')
            .order('date', { ascending: true }).order('heure_debut', { ascending: true });
        if (res.error) { toast('Erreur : ' + res.error.message, 'error'); console.error(res.error); return; }
        planifies = res.data || [];
        compteurs = {};
        if (planifies.length) {
            var ri = await supa.from('inscriptions').select('tournoi_id, statut')
                .in('tournoi_id', planifies.map(function (t) { return t.id; }))
                .in('statut', ['inscrite', 'liste_attente']);
            (ri.data || []).forEach(function (x) {
                var c = compteurs[x.tournoi_id] = compteurs[x.tournoi_id] || { inscrite: 0, liste_attente: 0 };
                c[x.statut]++;
            });
        }
        render();
    }

    // ISO → valeur d'un <input type="datetime-local"> (heure locale)
    function versLocal(iso) {
        var d = new Date(iso);
        d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
        return d.toISOString().slice(0, 16);
    }

    // ----- Formulaire -----

    function champ(label, input, pleine) {
        return el('div', { class: 'planning-champ' + (pleine ? ' planning-champ--plein' : '') }, [
            el('label', { class: 'control-label' }, label), input
        ]);
    }

    function renderFormulaire() {
        var t = enEdition || {};
        var card = el('div', { class: 'tournoi-card' });
        card.appendChild(el('h3', { class: 'tournoi-section-title' },
            enEdition ? '✏️ Modifier « ' + (t.nom || '') + ' »' : '➕ Planifier un tournoi'));

        var i = {
            nom: el('input', { type: 'text', class: 'tournoi-input', placeholder: 'Auto : « P100 Messieurs »' }),
            date: el('input', { type: 'date', class: 'tournoi-input', min: enEdition ? '' : aujourdhui() }),
            debut: el('input', { type: 'time', class: 'tournoi-input' }),
            fin: el('input', { type: 'time', class: 'tournoi-input' }),
            categorie: el('select', { class: 'tournoi-input' }),
            genre: el('select', { class: 'tournoi-input' }),
            max: el('input', { type: 'number', min: '2', max: '64', class: 'tournoi-input', placeholder: '16' }),
            inscrits: el('input', { type: 'number', min: '0', max: '64', class: 'tournoi-input', placeholder: '0' }),
            prix: el('input', { type: 'number', min: '0', step: '0.5', class: 'tournoi-input', placeholder: '20' }),
            ja: el('input', { type: 'text', class: 'tournoi-input', placeholder: 'Prénom du juge-arbitre' }),
            lien: el('input', { type: 'url', class: 'tournoi-input', placeholder: 'Vide = appli mobile Le Rebond' }),
            format: el('select', { class: 'tournoi-input' }),
            terrains: el('input', { type: 'number', min: '1', max: '10', class: 'tournoi-input' }),
            description: el('textarea', { class: 'tournoi-input', rows: '3', placeholder: 'Dotation, restauration, infos pratiques…' }),
            homologue: el('input', { type: 'checkbox' }),
            publie: el('input', { type: 'checkbox' }),
            enLigne: el('input', { type: 'checkbox' }),
            limite: el('input', { type: 'datetime-local', class: 'tournoi-input' })
        };

        i.categorie.appendChild(el('option', { value: '' }, '— Catégorie —'));
        CATEGORIES.forEach(function (c) { i.categorie.appendChild(el('option', { value: c }, c + ' (homologué FFT)')); });
        i.categorie.appendChild(el('option', { value: 'loisir' }, 'Loisir (non homologué)'));
        i.genre.appendChild(el('option', { value: '' }, '— Tableau —'));
        GENRES.forEach(function (g) { i.genre.appendChild(el('option', { value: g.v }, g.label)); });
        FORMATS.forEach(function (f) { i.format.appendChild(el('option', { value: f.v }, f.label)); });

        i.nom.value = t.nom || '';
        i.date.value = t.date || '';
        i.debut.value = t.heure_debut ? String(t.heure_debut).slice(0, 5) : '';
        i.fin.value = t.heure_fin ? String(t.heure_fin).slice(0, 5) : '';
        i.categorie.value = t.categorie || '';
        i.genre.value = t.genre || '';
        i.max.value = t.nb_equipes_max != null ? t.nb_equipes_max : '';
        i.inscrits.value = t.nb_inscrits || '';
        i.prix.value = t.prix_par_joueur != null ? t.prix_par_joueur : '';
        i.ja.value = t.juge_arbitre || '';
        i.lien.value = t.lien_inscription || '';
        i.format.value = t.format_score || 'format_b';
        i.terrains.value = t.nb_terrains || 3;
        i.description.value = t.description || '';
        i.homologue.checked = enEdition ? !!t.homologue : false;
        i.publie.checked = enEdition ? !!t.publie : true;
        i.enLigne.checked = enEdition ? t.inscription_en_ligne !== false : true;
        i.limite.value = t.date_limite_inscription ? versLocal(t.date_limite_inscription) : '';

        // Une catégorie P25…P2000 est par définition un tournoi homologué.
        i.categorie.addEventListener('change', function () {
            if (i.categorie.value && i.categorie.value !== 'loisir') i.homologue.checked = true;
            if (i.categorie.value === 'loisir') i.homologue.checked = false;
        });

        var grille = el('div', { class: 'planning-grille' }, [
            champ('Nom', i.nom, true),
            champ('Date *', i.date),
            champ('Début', i.debut),
            champ('Fin', i.fin),
            champ('Catégorie', i.categorie),
            champ('Tableau', i.genre),
            champ('Équipes max', i.max),
            champ('Déjà inscrites', i.inscrits),
            champ('Prix / joueur (€)', i.prix),
            champ('Juge-arbitre', i.ja),
            champ('Terrains', i.terrains),
            champ('Format de score', i.format, true),
            champ('Date limite d\'inscription en ligne', i.limite),
            champ('Lien d\'inscription (si pas en ligne)', i.lien, true),
            champ('Description', i.description, true)
        ]);
        card.appendChild(grille);

        card.appendChild(el('p', { class: 'tournoi-hint' },
            '« Déjà inscrites » : nombre d\'équipes inscrites via l\'appli mobile, affiché sur le site. '
            + 'Le jour J, les équipes saisies dans l\'admin prennent le relais si elles sont plus nombreuses.'));

        var options = el('div', { class: 'planning-options' }, [
            el('label', { class: 'planning-case' }, [i.homologue, ' Homologué FFT (barème officiel en poule)']),
            el('label', { class: 'planning-case' }, [i.publie, ' Publié sur le-rebond.fr/tournois/']),
            el('label', { class: 'planning-case' }, [i.enLigne, ' Inscriptions en ligne sur le site (sinon : lien ou appli)'])
        ]);
        card.appendChild(options);

        var actions = el('div', { class: 'planning-actions' });
        actions.appendChild(el('button', {
            class: 'btn-live btn-live--primary btn-live--small',
            onclick: function () { enregistrer(i); }
        }, enEdition ? '💾 Enregistrer' : '📅 Planifier'));
        if (enEdition) {
            actions.appendChild(el('button', {
                class: 'btn-live btn-live--outline btn-live--small',
                onclick: function () { enEdition = null; render(); }
            }, 'Annuler'));
        }
        card.appendChild(actions);
        return card;
    }

    function entierOuNull(v) {
        if (v === '' || v == null) return null;
        var n = parseInt(v, 10);
        return isNaN(n) ? null : n;
    }

    async function enregistrer(i) {
        if (!i.date.value) { toast('La date est obligatoire', 'error'); i.date.focus(); return; }
        var max = entierOuNull(i.max.value);
        var inscrits = entierOuNull(i.inscrits.value) || 0;
        if (max != null && max < 2) { toast('Il faut au moins 2 équipes', 'error'); return; }
        if (i.debut.value && i.fin.value && i.fin.value <= i.debut.value) {
            toast('L\'heure de fin doit suivre l\'heure de début', 'error'); return;
        }
        var categorie = i.categorie.value || null;
        var genre = i.genre.value || null;
        var homologue = !!i.homologue.checked;
        var prix = i.prix.value === '' ? null : Number(i.prix.value);

        var champs = {
            nom: i.nom.value.trim() || nomParDefaut(categorie, genre),
            date: i.date.value,
            heure_debut: i.debut.value || null,
            heure_fin: i.fin.value || null,
            categorie: categorie,
            genre: genre,
            nb_equipes_max: max,
            nb_inscrits: inscrits,
            prix_par_joueur: prix,
            juge_arbitre: i.ja.value.trim() || null,
            lien_inscription: i.lien.value.trim() || null,
            description: i.description.value.trim() || null,
            format_score: i.format.value,
            nb_terrains: entierOuNull(i.terrains.value) || 3,
            homologue: homologue,
            // Un tournoi homologué se classe aux classements FFT, sinon au niveau 1-10.
            mode_classement: homologue ? 'fft' : 'niveau',
            publie: !!i.publie.checked,
            inscription_en_ligne: !!i.enLigne.checked,
            date_limite_inscription: i.limite.value ? new Date(i.limite.value).toISOString() : null,
            updated_at: new Date().toISOString()
        };

        var res = enEdition
            ? await supa.from('tournois').update(champs).eq('id', enEdition.id).select().single()
            : await supa.from('tournois').insert(Object.assign(champs, {
                status: 'planifie', phase: 'preparation', no_ad: false
            })).select().single();
        if (res.error) { toast('Erreur : ' + res.error.message, 'error'); console.error(res.error); return; }
        toast(enEdition ? 'Tournoi modifié' : 'Tournoi planifié' + (champs.publie ? ' et publié' : ''), 'ok');
        enEdition = null;
        await charger();
    }

    // ----- Liste -----

    async function basculerPublication(t) {
        var res = await supa.from('tournois').update({ publie: !t.publie, updated_at: new Date().toISOString() }).eq('id', t.id);
        if (res.error) { toast('Erreur : ' + res.error.message, 'error'); console.error(res.error); return; }
        await charger();
    }

    async function supprimer(t) {
        if (!confirm('Supprimer « ' + t.nom + ' » du ' + dateLongue(t.date) + ' ?\n\nS\'il était publié, il disparaît du site.')) return;
        var res = await supa.from('tournois').delete().eq('id', t.id);
        if (res.error) { toast('Erreur : ' + res.error.message, 'error'); console.error(res.error); return; }
        toast('Tournoi supprimé', 'ok');
        await charger();
    }

    // Le jour J : le tournoi planifié devient LE tournoi actif de l'admin.
    // L'admin ne gère qu'un tournoi actif à la fois : l'actif en cours est clôturé
    // (il reste visible dans l'historique et peut être rouvert).
    async function lancer(t) {
        var resA = await supa.from('tournois').select('id, nom').eq('status', 'actif');
        if (resA.error) { toast('Erreur : ' + resA.error.message, 'error'); return; }
        var actifs = resA.data || [];
        var msg = 'Lancer « ' + t.nom + ' » maintenant ?\n\nIl devient le tournoi actif de l\'onglet Tournoi.';
        if (actifs.length) {
            msg += '\n\n⚠️ « ' + actifs.map(function (a) { return a.nom; }).join(', ')
                + ' » est actif : il sera CLÔTURÉ (tu pourras le rouvrir depuis la liste des tournois clôturés).';
        }
        if (t.date !== aujourdhui()) msg += '\n\nAttention : ce tournoi est prévu le ' + dateLongue(t.date) + ', pas aujourd\'hui.';
        if (!confirm(msg)) return;

        var maintenant = new Date().toISOString();
        if (actifs.length) {
            var resC = await supa.from('tournois').update({ status: 'cloture', updated_at: maintenant })
                .in('id', actifs.map(function (a) { return a.id; }));
            if (resC.error) { toast('Erreur : ' + resC.error.message, 'error'); return; }
        }
        var res = await supa.from('tournois').update({ status: 'actif', updated_at: maintenant }).eq('id', t.id);
        if (res.error) { toast('Erreur : ' + res.error.message, 'error'); console.error(res.error); return; }
        toast('Tournoi lancé 🏆', 'ok');
        if (window.switchTab) window.switchTab('tournoi');
    }

    function renderListe() {
        var card = el('div', { class: 'tournoi-card' });
        card.appendChild(el('h3', { class: 'tournoi-section-title' }, '📅 Tournois planifiés (' + planifies.length + ')'));
        card.appendChild(el('p', { class: 'tournoi-hint' }, [
            'Les tournois publiés apparaissent sur ',
            el('a', { href: 'tournois/', target: '_blank', style: 'color:#efa707' }, 'le-rebond.fr/tournois'),
            '. Le jour J, « Lancer » les bascule dans l\'onglet Tournoi.'
        ]));

        if (!planifies.length) {
            card.appendChild(el('p', { class: 'poule-empty' }, 'Aucun tournoi planifié.'));
            return card;
        }

        var auj = aujourdhui();
        planifies.forEach(function (t) {
            var passe = t.date < auj;
            var ligne = el('div', { class: 'planning-ligne' + (passe ? ' planning-ligne--passe' : '') + (t.publie ? '' : ' planning-ligne--brouillon') });

            var infos = el('div', { class: 'planning-infos' });
            infos.appendChild(el('span', { class: 'planning-nom' }, t.nom));
            var details = [dateLongue(t.date)];
            if (t.heure_debut) details.push(heure(t.heure_debut) + (t.heure_fin ? '–' + heure(t.heure_fin) : ''));
            // Même calcul que le site public : inscriptions en ligne, ou compteur manuel s'il est plus grand.
            var prises = Math.max(t.nb_inscrits || 0, (compteurs[t.id] && compteurs[t.id].inscrite) || 0);
            if (t.nb_equipes_max) details.push(prises + '/' + t.nb_equipes_max + ' équipes');
            if (t.juge_arbitre) details.push('JA ' + t.juge_arbitre);
            infos.appendChild(el('span', { class: 'planning-meta' }, details.join(' · ')));
            var badges = el('span', { class: 'planning-badges' });
            if (t.homologue) badges.appendChild(el('span', { class: 'planning-badge planning-badge--fft' }, 'FFT'));
            badges.appendChild(el('span', { class: 'planning-badge' + (t.publie ? ' planning-badge--publie' : '') },
                t.publie ? 'Publié' : 'Brouillon'));
            if (passe) badges.appendChild(el('span', { class: 'planning-badge planning-badge--alerte' }, 'Date passée'));
            var c = compteurs[t.id];
            if (t.inscription_en_ligne !== false) {
                badges.appendChild(el('span', { class: 'planning-badge' + (t.inscriptions_fermees ? ' planning-badge--alerte' : ' planning-badge--publie') },
                    t.inscriptions_fermees ? 'Inscriptions fermées' : 'Inscriptions en ligne'));
            }
            if (c) badges.appendChild(el('span', { class: 'planning-badge' },
                c.inscrite + ' inscrite' + (c.inscrite > 1 ? 's' : '') + (c.liste_attente ? ' · ' + c.liste_attente + ' en attente' : '')));
            infos.appendChild(badges);
            ligne.appendChild(infos);

            var actions = el('div', { class: 'planning-actions' }, [
                el('button', {
                    class: 'btn-live btn-live--outline btn-live--small',
                    onclick: function () { panneauOuvert = panneauOuvert === t.id ? null : t.id; render(); }
                }, (panneauOuvert === t.id ? '▾ ' : '▸ ') + '👥 Inscriptions'),
                el('button', {
                    class: 'btn-live btn-live--primary btn-live--small',
                    onclick: function () { lancer(t); },
                    title: 'Le jour J : passe ce tournoi en actif dans l\'onglet Tournoi'
                }, '▶ Lancer'),
                el('button', {
                    class: 'btn-live btn-live--outline btn-live--small',
                    onclick: function () { basculerPublication(t); }
                }, t.publie ? 'Dépublier' : 'Publier'),
                el('button', {
                    class: 'icon-btn',
                    onclick: function () { enEdition = t; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); },
                    title: 'Modifier'
                }, '✏️'),
                el('button', {
                    class: 'icon-btn icon-btn--danger',
                    onclick: function () { supprimer(t); },
                    title: 'Supprimer'
                }, '🗑')
            ]);
            ligne.appendChild(actions);
            card.appendChild(ligne);
            if (panneauOuvert === t.id) {
                var panneau = el('div', { class: 'inscr-panneau' }, el('p', { class: 'tournoi-hint' }, 'Chargement…'));
                card.appendChild(panneau);
                remplirPanneau(t, panneau);
            }
        });
        return card;
    }

    // ===== Inscriptions d'un tournoi : liste, liste d'attente, convocations, export JA =====

    function hhmm(iso) {
        if (!iso) return '';
        var d = new Date(iso);
        return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }

    async function remplirPanneau(t, panneau) {
        var res = await supa.from('inscriptions')
            .select('*, j1:joueurs!inscriptions_joueur1_id_fkey(nom, prenom, fft_rang, fft_club, licence), '
                  + 'j2:joueurs!inscriptions_joueur2_id_fkey(nom, prenom, fft_rang, fft_club, licence)')
            .eq('tournoi_id', t.id).order('cree_le');
        if (res.error) { panneau.innerHTML = ''; panneau.appendChild(el('p', { class: 'tournoi-hint' }, 'Erreur : ' + res.error.message)); return; }
        var liste = res.data || [];
        var ids = [];
        liste.forEach(function (x) { ids.push(x.joueur1_id, x.joueur2_id); });
        var contacts = {};
        if (ids.length) {
            var rc = await supa.from('joueurs_contacts').select('joueur_id, email, telephone').in('joueur_id', ids);
            (rc.data || []).forEach(function (c) { contacts[c.joueur_id] = c; });
        }
        var inscrites = liste.filter(function (x) { return x.statut === 'inscrite'; })
            .sort(function (a, b) { return (a.poids == null) - (b.poids == null) || (a.poids || 0) - (b.poids || 0); });
        var attente = liste.filter(function (x) { return x.statut === 'liste_attente'; });
        var retirees = liste.filter(function (x) { return x.statut === 'annulee' || x.statut === 'refusee'; });

        panneau.innerHTML = '';
        var barre = el('div', { class: 'inscr-barre' });
        barre.appendChild(el('strong', null, inscrites.length + ' inscrite' + (inscrites.length > 1 ? 's' : '')
            + (t.nb_equipes_max ? ' / ' + t.nb_equipes_max : '') + (attente.length ? ' · ' + attente.length + ' en attente' : '')));
        barre.appendChild(el('button', {
            class: 'btn-live btn-live--outline btn-live--small',
            onclick: async function () {
                await supa.from('tournois').update({ inscriptions_fermees: !t.inscriptions_fermees, updated_at: new Date().toISOString() }).eq('id', t.id);
                await charger();
            }
        }, t.inscriptions_fermees ? 'Rouvrir les inscriptions' : 'Fermer les inscriptions'));
        barre.appendChild(el('button', {
            class: 'btn-live btn-live--outline btn-live--small',
            onclick: function () { exporterCsv(t, inscrites.concat(attente), contacts); }
        }, '⬇️ Export CSV (JA)'));
        panneau.appendChild(barre);

        if (!liste.length) {
            panneau.appendChild(el('p', { class: 'poule-empty' }, 'Aucune inscription en ligne pour l\'instant.'));
            return;
        }

        // Convocations : une heure par paire, préremplie avec une heure commune.
        var heuresInputs = {};
        if (inscrites.length) {
            var conv = el('div', { class: 'inscr-convoc' });
            var defaut = el('input', { type: 'time', class: 'tournoi-input inscr-heure', value: t.heure_debut ? String(t.heure_debut).slice(0, 5) : '09:00' });
            conv.appendChild(el('span', null, 'Convocation :'));
            conv.appendChild(defaut);
            conv.appendChild(el('button', {
                class: 'btn-live btn-live--outline btn-live--small',
                onclick: function () { Object.keys(heuresInputs).forEach(function (k) { heuresInputs[k].value = defaut.value; }); }
            }, 'Appliquer à toutes'));
            conv.appendChild(el('button', {
                class: 'btn-live btn-live--primary btn-live--small',
                onclick: function () { envoyerConvocations(t, inscrites, heuresInputs); }
            }, '📣 Envoyer les convocations'));
            panneau.appendChild(conv);
        }

        function tableau(titre, lignes, avecHeure) {
            panneau.appendChild(el('h4', { class: 'inscr-titre' }, titre));
            lignes.forEach(function (x, n) {
                var ligne = el('div', { class: 'inscr-ligne' });
                var qui = el('div', { class: 'inscr-qui' });
                function joueur(j, id, presence) {
                    var c = contacts[id] || {};
                    var b = el('div', { class: 'inscr-joueur' });
                    b.appendChild(el('span', { class: 'inscr-nom' }, (j ? j.prenom + ' ' + j.nom : '?')
                        + (j && j.fft_rang ? ' · ' + j.fft_rang.toLocaleString('fr-FR') + 'e' : ' · NC')
                        + (presence === true ? ' ✅' : presence === false ? ' ❌' : '')));
                    b.appendChild(el('span', { class: 'inscr-contact' }, [c.telephone, c.email].filter(Boolean).join(' · ') || 'pas de coordonnées'));
                    return b;
                }
                qui.appendChild(joueur(x.j1, x.joueur1_id, x.presence_j1));
                qui.appendChild(joueur(x.j2, x.joueur2_id, x.presence_j2));
                ligne.appendChild(el('span', { class: 'inscr-num' }, String(n + 1)));
                ligne.appendChild(qui);
                var infos = el('div', { class: 'inscr-infos' });
                infos.appendChild(el('span', null, x.poids ? 'poids ' + x.poids.toLocaleString('fr-FR') : 'poids NC'));
                infos.appendChild(el('span', { class: x.partenaire_confirme ? 'inscr-ok' : 'inscr-attente' },
                    x.partenaire_confirme ? 'partenaire ✓' : 'partenaire à confirmer'));
                if (x.message) infos.appendChild(el('span', { class: 'inscr-message', title: x.message }, '💬 ' + x.message));
                ligne.appendChild(infos);
                var actions = el('div', { class: 'inscr-actions' });
                if (avecHeure) {
                    var h = el('input', { type: 'time', class: 'tournoi-input inscr-heure', value: hhmm(x.convocation_heure) || (t.heure_debut ? String(t.heure_debut).slice(0, 5) : '09:00') });
                    heuresInputs[x.id] = h;
                    actions.appendChild(h);
                    if (x.convocation_envoyee_le) actions.appendChild(el('span', { class: 'inscr-ok', title: 'Convocation envoyée le ' + new Date(x.convocation_envoyee_le).toLocaleString('fr-FR') }, '📣'));
                }
                if (x.statut === 'inscrite' || x.statut === 'liste_attente') {
                    actions.appendChild(el('button', { class: 'icon-btn icon-btn--danger', title: 'Désinscrire (la liste d\'attente avance)',
                        onclick: function () { retirer(t, x, 'annulee'); } }, '🗑'));
                    actions.appendChild(el('button', { class: 'icon-btn', title: 'Refuser (non conforme)',
                        onclick: function () { retirer(t, x, 'refusee'); } }, '⛔'));
                } else {
                    actions.appendChild(el('span', { class: 'inscr-attente' }, (x.statut === 'refusee' ? 'refusée' : 'désinscrite') + (x.annulee_par ? ' par ' + x.annulee_par : '')));
                }
                ligne.appendChild(actions);
                panneau.appendChild(ligne);
            });
        }
        if (inscrites.length) tableau('Paires inscrites (par poids)', inscrites, true);
        if (attente.length) tableau('Liste d\'attente (ordre d\'arrivée)', attente, false);
        if (retirees.length) tableau('Désinscrites / refusées', retirees, false);
    }

    async function retirer(t, x, statut) {
        var nom = (x.j1 ? x.j1.nom : '?') + ' / ' + (x.j2 ? x.j2.nom : '?');
        if (!confirm((statut === 'refusee' ? 'Refuser' : 'Désinscrire') + ' la paire ' + nom + ' ?\n\nLes deux joueurs sont prévenus'
            + (x.statut === 'inscrite' ? ' et la première paire en attente prend la place.' : '.'))) return;
        var res = await supa.rpc('staff_retirer_inscription', { p_inscription: x.id, p_statut: statut });
        if (res.error) { toast('Erreur : ' + res.error.message, 'error'); return; }
        toast(res.data ? 'Paire retirée, ' + res.data + ' paire promue depuis la liste d\'attente' : 'Paire retirée', 'ok');
        await charger();
    }

    async function envoyerConvocations(t, inscrites, heuresInputs) {
        var heures = inscrites.map(function (x) {
            var v = heuresInputs[x.id] && heuresInputs[x.id].value;
            return v ? { inscription: x.id, heure: new Date(t.date + 'T' + v + ':00').toISOString() } : null;
        }).filter(Boolean);
        if (!heures.length) { toast('Aucune heure renseignée', 'error'); return; }
        if (!confirm('Envoyer ' + heures.length + ' convocation(s) par e-mail et SMS ?\n\nChaque joueur pourra confirmer sa présence depuis son espace.')) return;
        var res = await supa.rpc('staff_envoyer_convocations', { p_tournoi: t.id, p_heures: heures });
        if (res.error) { toast('Erreur : ' + res.error.message, 'error'); return; }
        toast(res.data + ' convocation(s) envoyée(s)', 'ok');
        await charger();
    }

    // Export pour le juge-arbitre (séparateur « ; », ouvrable dans Excel).
    function exporterCsv(t, lignes, contacts) {
        function cellule(v) { v = v == null ? '' : String(v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
        var entete = ['Statut', 'Position', 'Poids de paire', 'Joueur 1', 'Classement joueur 1', 'Club joueur 1', 'Téléphone joueur 1', 'E-mail joueur 1',
                      'Joueur 2', 'Classement joueur 2', 'Club joueur 2', 'Téléphone joueur 2', 'E-mail joueur 2',
                      'Partenaire confirmé', 'Convocation', 'Présence J1', 'Présence J2', 'Inscrite le', 'Message'];
        var n = 0, att = 0;
        var rows = lignes.map(function (x) {
            var c1 = contacts[x.joueur1_id] || {}, c2 = contacts[x.joueur2_id] || {};
            var oui = function (b) { return b === true ? 'oui' : b === false ? 'non' : ''; };
            return [x.statut === 'inscrite' ? 'Inscrite' : 'Liste d\'attente', x.statut === 'inscrite' ? ++n : ++att, x.poids,
                x.j1 ? x.j1.prenom + ' ' + x.j1.nom : '', x.rang1, x.j1 && x.j1.fft_club, c1.telephone, c1.email,
                x.j2 ? x.j2.prenom + ' ' + x.j2.nom : '', x.rang2, x.j2 && x.j2.fft_club, c2.telephone, c2.email,
                oui(x.partenaire_confirme), x.convocation_heure ? new Date(x.convocation_heure).toLocaleString('fr-FR') : '',
                oui(x.presence_j1), oui(x.presence_j2), new Date(x.cree_le).toLocaleString('fr-FR'), x.message].map(cellule).join(';');
        });
        var csv = '\ufeff' + [entete.join(';')].concat(rows).join('\r\n');
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        a.download = 'inscriptions-' + t.nom.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '-' + t.date + '.csv';
        document.body.appendChild(a); a.click(); a.remove();
    }

    function render() {
        var root = document.getElementById('planning-root');
        if (!root) return;
        root.innerHTML = '';
        root.appendChild(renderFormulaire());
        root.appendChild(renderListe());
    }

    window.TournoiPlanning = {
        init: function () { enEdition = null; charger(); },
        nomParDefaut: nomParDefaut
    };
})();
