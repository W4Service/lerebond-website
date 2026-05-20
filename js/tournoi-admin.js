/* ============================================
   TOURNOI ADMIN
   - Gestion complète d'un tournoi : création, équipes, poules, matchs, scores
   - Phase 1 : poules + matchs round-robin
   ============================================ */
(function () {
    var supa = window.LeRebondSupa;
    if (!supa) { alert('Erreur: Supabase non initialisé'); return; }

    // State
    var currentTournoi = null;
    var poules = [];
    var equipes = [];
    var matchs = [];
    var joueurs = []; // cache de tous les joueurs (pour autocomplete + résolution)
    var archivedTournois = [];
    var closedTournois = [];
    var activeTab = 'matchs'; // 'matchs' | 'pointage'

    // Elements (sera initialisé après login)
    var els = {};

    // Toast helper (reuse logic from chrono-admin)
    function showToast(message, type) {
        var existing = document.getElementById('live-toast');
        if (existing) existing.remove();
        var el = document.createElement('div');
        el.id = 'live-toast';
        el.textContent = message;
        el.style.cssText = 'position:fixed;bottom:30px;left:50%;transform:translateX(-50%);z-index:9999;' +
            'padding:0.9rem 1.5rem;border-radius:12px;font-family:Kanit,sans-serif;font-weight:600;' +
            'font-size:0.95rem;color:#1a1a1a;box-shadow:0 8px 30px rgba(0,0,0,0.3);' +
            'background:' + (type === 'error' ? '#ea1a15' : '#f4c941') + ';';
        if (type === 'error') el.style.color = '#fff';
        document.body.appendChild(el);
        setTimeout(function () { el.style.opacity = '0'; el.style.transition = 'opacity 0.3s'; }, 3000);
        setTimeout(function () { el.remove(); }, 3500);
    }

    // ===== Chargement des données =====

    async function loadActiveTournoi() {
        var [resActif, resArchivés, resCloses] = await Promise.all([
            supa.from('tournois').select('*').eq('status', 'actif').order('created_at', { ascending: false }).limit(1),
            supa.from('tournois').select('*').eq('status', 'archive').order('updated_at', { ascending: false }),
            supa.from('tournois').select('*').eq('status', 'cloture').order('updated_at', { ascending: false })
        ]);
        archivedTournois = resArchivés.data || [];
        closedTournois = resCloses.data || [];
        if (resActif.data && resActif.data.length > 0) {
            currentTournoi = resActif.data[0];
            await loadDetails();
        } else {
            currentTournoi = null;
            poules = []; equipes = []; matchs = [];
        }
        render();
    }

    async function restoreTournoi(id) {
        if (!confirm('Restaurer ce tournoi en actif ? Il redeviendra visible côté client.\n\nSi un autre tournoi est déjà actif, il sera archivé.')) return;
        // Archive le tournoi actif éventuel
        if (currentTournoi) {
            await supa.from('tournois').update({ status: 'archive', updated_at: new Date().toISOString() }).eq('id', currentTournoi.id);
        }
        var res = await supa.from('tournois').update({ status: 'actif', updated_at: new Date().toISOString() }).eq('id', id).select().single();
        if (res.error) { showToast('Erreur : ' + res.error.message, 'error'); console.error(res.error); return; }
        currentTournoi = res.data;
        await loadDetails();
        await loadActiveTournoi();
        showToast('Tournoi restauré', 'ok');
    }

    async function deleteTournoiArchive(id) {
        var t = archivedTournois.find(function (x) { return x.id === id; });
        var nom = t ? t.nom : 'ce tournoi';
        if (!confirm('⚠️ SUPPRIMER DÉFINITIVEMENT « ' + nom + ' » ?\n\nToutes les équipes, poules et matchs liés seront effacés. Cette action est irréversible.')) return;
        if (!confirm('Vraiment sûr ? Tape OK dans la prochaine boîte pour confirmer.')) return;
        var confirmText = prompt('Tape « SUPPRIMER » en majuscules pour confirmer :');
        if (confirmText !== 'SUPPRIMER') { showToast('Suppression annulée', 'error'); return; }
        // Cascade manuelle au cas où la DB n'a pas ON DELETE CASCADE
        await supa.from('matchs').delete().eq('tournoi_id', id);
        await supa.from('equipes').delete().eq('tournoi_id', id);
        await supa.from('poules').delete().eq('tournoi_id', id);
        var res = await supa.from('tournois').delete().eq('id', id);
        if (res.error) { showToast('Erreur : ' + res.error.message, 'error'); console.error(res.error); return; }
        archivedTournois = archivedTournois.filter(function (x) { return x.id !== id; });
        render();
        showToast('Tournoi supprimé', 'ok');
    }

    async function loadDetails() {
        if (!currentTournoi) return;
        var [resP, resE, resM, resJ] = await Promise.all([
            supa.from('poules').select('*').eq('tournoi_id', currentTournoi.id).order('ordre'),
            supa.from('equipes').select('*').eq('tournoi_id', currentTournoi.id).order('nom'),
            supa.from('matchs').select('*').eq('tournoi_id', currentTournoi.id).order('ordre'),
            supa.from('joueurs').select('*').order('nom')
        ]);
        poules = resP.data || [];
        equipes = resE.data || [];
        matchs = resM.data || [];
        joueurs = resJ.data || [];
    }

    function findJoueur(id) {
        if (!id) return null;
        return joueurs.find(function (j) { return j.id === id; }) || null;
    }

    // Affichage d'une équipe : "Nom1 / Nom2" si liée à des joueurs, sinon fallback sur eq.nom (legacy).
    function equipeAffichage(eq) {
        if (!eq) return '?';
        var j1 = findJoueur(eq.joueur_j1_id);
        var j2 = findJoueur(eq.joueur_j2_id);
        if (j1 || j2) {
            var n1 = j1 ? j1.nom : '?';
            var n2 = j2 ? j2.nom : '?';
            return n1 + ' / ' + n2;
        }
        return eq.nom || '— sans nom —';
    }

    // Crée ou retrouve un joueur (nom + prénom). Renvoie l'id.
    async function upsertJoueur(nom, prenom) {
        nom = (nom || '').trim();
        prenom = (prenom || '').trim();
        if (!nom || !prenom) return null;
        // Cherche dans le cache local d'abord
        var match = joueurs.find(function (j) {
            return j.nom.toLowerCase() === nom.toLowerCase() && j.prenom.toLowerCase() === prenom.toLowerCase();
        });
        if (match) return match.id;
        // Insert
        var res = await supa.from('joueurs').insert({ nom: nom, prenom: prenom }).select().single();
        if (res.error) {
            // Race condition : un autre client l'a peut-être créé entretemps
            console.error(res.error);
            // Retry via select
            var res2 = await supa.from('joueurs').select('*').ilike('nom', nom).ilike('prenom', prenom).limit(1);
            if (res2.data && res2.data[0]) {
                if (!joueurs.find(function (j) { return j.id === res2.data[0].id; })) joueurs.push(res2.data[0]);
                return res2.data[0].id;
            }
            showToast('Erreur joueur : ' + res.error.message, 'error');
            return null;
        }
        joueurs.push(res.data);
        return res.data.id;
    }

    // ===== Création tournoi =====

    async function createTournoi() {
        var nom = els.tNom.value.trim();
        if (!nom) { showToast('Donne un nom au tournoi', 'error'); return; }
        var nbTerrains = parseInt(els.tTerrains.value) || 1;
        var date = els.tDate.value || null;
        var format = els.tFormat.value || 'libre';
        var noAd = els.tNoAd ? !!els.tNoAd.checked : false;
        var modeClassement = (els.tModeClassement && els.tModeClassement.value) || 'niveau';

        var res = await supa.from('tournois').insert({
            nom: nom, nb_terrains: nbTerrains, date: date, format_score: format, no_ad: noAd,
            mode_classement: modeClassement,
            phase: 'preparation', status: 'actif'
        }).select().single();

        if (res.error) { showToast('Erreur : ' + res.error.message, 'error'); console.error(res.error); return; }
        currentTournoi = res.data;
        await loadDetails();
        render();
        showToast('Tournoi créé', 'ok');
    }

    function isReadOnly() {
        return currentTournoi && currentTournoi.status === 'cloture';
    }
    function guardReadOnly() {
        if (isReadOnly()) {
            showToast('Tournoi clôturé : rouvre-le pour modifier.', 'error');
            return true;
        }
        return false;
    }

    async function archiveTournoi() {
        if (!currentTournoi) return;
        if (!confirm('Archiver ce tournoi ? Il ne sera plus visible côté client.')) return;
        var res = await supa.from('tournois').update({ status: 'archive', updated_at: new Date().toISOString() }).eq('id', currentTournoi.id);
        if (res.error) { showToast('Erreur', 'error'); console.error(res.error); return; }
        await loadActiveTournoi();
        showToast('Tournoi archivé', 'ok');
    }

    async function cloturerTournoi() {
        if (!currentTournoi) return;
        if (!confirm('Clôturer ce tournoi ?\n\nIl ne sera plus modifiable, mais restera visible côté client dans l\'historique. Tu pourras le rouvrir ou l\'archiver plus tard.')) return;
        var res = await supa.from('tournois').update({ status: 'cloture', updated_at: new Date().toISOString() }).eq('id', currentTournoi.id);
        if (res.error) { showToast('Erreur : ' + res.error.message, 'error'); console.error(res.error); return; }
        await loadActiveTournoi();
        showToast('Tournoi clôturé', 'ok');
    }

    async function rouvrirTournoi(id) {
        if (!confirm('Rouvrir ce tournoi en actif ?\n\nIl redevient modifiable. Si un autre tournoi est déjà actif, il sera clôturé.')) return;
        if (currentTournoi) {
            await supa.from('tournois').update({ status: 'cloture', updated_at: new Date().toISOString() }).eq('id', currentTournoi.id);
        }
        var res = await supa.from('tournois').update({ status: 'actif', updated_at: new Date().toISOString() }).eq('id', id);
        if (res.error) { showToast('Erreur : ' + res.error.message, 'error'); console.error(res.error); return; }
        await loadActiveTournoi();
        showToast('Tournoi rouvert', 'ok');
    }

    async function archiverDepuisCloture(id) {
        if (!confirm('Archiver ce tournoi clôturé ? Il sera retiré de l\'historique public.')) return;
        var res = await supa.from('tournois').update({ status: 'archive', updated_at: new Date().toISOString() }).eq('id', id);
        if (res.error) { showToast('Erreur', 'error'); console.error(res.error); return; }
        await loadActiveTournoi();
        showToast('Tournoi archivé', 'ok');
    }

    async function updateTournoi(patch) {
        if (!currentTournoi) return;
        var res = await supa.from('tournois').update(Object.assign({}, patch, { updated_at: new Date().toISOString() })).eq('id', currentTournoi.id).select().single();
        if (res.error) { showToast('Erreur : ' + res.error.message, 'error'); console.error(res.error); return; }
        currentTournoi = res.data;
        render();
    }

    // ===== Équipes =====

    async function addEquipe() { if (guardReadOnly()) return;
        var nomJ1 = els.eqNomJ1.value.trim();
        var prenomJ1 = els.eqPrenomJ1.value.trim();
        var nomJ2 = els.eqNomJ2.value.trim();
        var prenomJ2 = els.eqPrenomJ2.value.trim();
        if (!nomJ1 || !prenomJ1 || !nomJ2 || !prenomJ2) {
            showToast('Saisir nom + prénom des 2 joueurs', 'error');
            return;
        }
        var j1Id = await upsertJoueur(nomJ1, prenomJ1);
        var j2Id = await upsertJoueur(nomJ2, prenomJ2);
        if (!j1Id || !j2Id) return;
        if (j1Id === j2Id) {
            showToast('Un joueur ne peut pas être en double dans une équipe', 'error');
            return;
        }
        // On garde un 'nom' équipe pour la rétro-compat des requêtes order('nom'), construit côté serveur
        var nomEquipe = nomJ1 + ' / ' + nomJ2;
        var res = await supa.from('equipes').insert({
            tournoi_id: currentTournoi.id,
            nom: nomEquipe,
            joueur_j1_id: j1Id,
            joueur_j2_id: j2Id
        }).select().single();
        if (res.error) { showToast('Erreur : ' + res.error.message, 'error'); console.error(res.error); return; }
        equipes.push(res.data);
        els.eqNomJ1.value = '';
        els.eqPrenomJ1.value = '';
        els.eqNomJ2.value = '';
        els.eqPrenomJ2.value = '';
        els.eqNomJ1.focus();
        render();
    }

    async function deleteEquipe(id) { if (guardReadOnly()) return;
        if (!confirm('Supprimer cette équipe ? Les matchs liés seront perdus.')) return;
        var res = await supa.from('equipes').delete().eq('id', id);
        if (res.error) { showToast('Erreur', 'error'); console.error(res.error); return; }
        equipes = equipes.filter(function (e) { return e.id !== id; });
        matchs = matchs.filter(function (m) { return m.equipe_a_id !== id && m.equipe_b_id !== id; });
        render();
    }

    async function assignEquipePoule(equipeId, pouleId) {
        var res = await supa.from('equipes').update({ poule_id: pouleId || null }).eq('id', equipeId).select().single();
        if (res.error) { showToast('Erreur', 'error'); console.error(res.error); return; }
        var i = equipes.findIndex(function (e) { return e.id === equipeId; });
        if (i >= 0) equipes[i] = res.data;
        render();
    }

    async function setEquipeNiveau(equipeId, niveau) {
        var n = (niveau === '' || niveau == null) ? null : Math.max(1, Math.min(10, parseInt(niveau, 10)));
        if (n !== null && isNaN(n)) return;
        var res = await supa.from('equipes').update({ niveau: n }).eq('id', equipeId).select().single();
        if (res.error) { showToast('Erreur : ' + res.error.message, 'error'); console.error(res.error); return; }
        var i = equipes.findIndex(function (e) { return e.id === equipeId; });
        if (i >= 0) equipes[i] = res.data;
        // pas de re-render complet — juste l'input qui a déjà changé
    }

    // Met à jour les points FFT d'un joueur (points_j1 ou points_j2). Renvoie l'équipe mise à jour pour rafraîchir l'affichage du poids.
    async function setEquipePoints(equipeId, joueurKey, points) {
        var n = (points === '' || points == null) ? null : Math.max(0, parseInt(points, 10));
        if (n !== null && isNaN(n)) return;
        var patch = {}; patch[joueurKey] = n;
        var res = await supa.from('equipes').update(patch).eq('id', equipeId).select().single();
        if (res.error) { showToast('Erreur : ' + res.error.message, 'error'); console.error(res.error); return; }
        var i = equipes.findIndex(function (e) { return e.id === equipeId; });
        if (i >= 0) equipes[i] = res.data;
    }

    async function setEquipeFlag(equipeId, flag, value) {
        if (guardReadOnly()) return;
        var patch = {}; patch[flag] = !!value;
        var res = await supa.from('equipes').update(patch).eq('id', equipeId).select().single();
        if (res.error) { showToast('Erreur : ' + res.error.message, 'error'); console.error(res.error); return; }
        var i = equipes.findIndex(function (e) { return e.id === equipeId; });
        if (i >= 0) equipes[i] = res.data;
    }

    // Renvoie le poids d'une équipe : niveau (mode niveau) ou points_j1+points_j2 (mode FFT). null si pas saisi.
    function equipePoids(eq) {
        if (currentTournoi && currentTournoi.mode_classement === 'fft') {
            if (eq.points_j1 == null && eq.points_j2 == null) return null;
            return (eq.points_j1 || 0) + (eq.points_j2 || 0);
        }
        return eq.niveau == null ? null : eq.niveau;
    }

    // ===== Répartition automatique par niveau =====

    async function repartirParNiveau() {
        if (guardReadOnly()) return;
        if (poules.length === 0) { showToast('Crée au moins une poule avant de répartir.', 'error'); return; }
        if (equipes.length === 0) { showToast('Ajoute au moins une équipe.', 'error'); return; }
        var modeFFT = currentTournoi && currentTournoi.mode_classement === 'fft';
        var sansPoids = equipes.filter(function (e) { return equipePoids(e) == null; });
        if (sansPoids.length > 0) {
            var label = modeFFT ? 'points FFT' : 'niveau';
            if (!confirm(sansPoids.length + ' équipe(s) n\'ont pas de ' + label + ' et seront placées en bas.\n\nContinuer quand même ?')) return;
        }

        var mode = prompt(
            'Choisis la stratégie de répartition :\n\n' +
            '  1 — Poules homogènes (la Poule A regroupe les plus forts, la Poule B les suivants, etc.)\n' +
            '  2 — Poules équilibrées (méthode serpentin : chaque poule contient un mix de niveaux)\n\n' +
            'Tape 1 ou 2 :',
            '1'
        );
        if (mode == null) return;
        mode = String(mode).trim();
        if (mode !== '1' && mode !== '2') { showToast('Choix invalide', 'error'); return; }

        if (!confirm('Cette action va RÉASSIGNER toutes les équipes dans les poules. Confirmer ?')) return;

        // Tri : poids desc (plus fort en premier), puis nom
        var sorted = equipes.slice().sort(function (a, b) {
            var pa = equipePoids(a); var pb = equipePoids(b);
            var na = (pa == null) ? -1 : pa;
            var nb = (pb == null) ? -1 : pb;
            if (nb !== na) return nb - na;
            return a.nom.localeCompare(b.nom);
        });

        var poulesOrdonnees = poules.slice().sort(function (a, b) { return a.ordre - b.ordre; });
        var nbPoules = poulesOrdonnees.length;
        var assignments = {};

        if (mode === '1') {
            // Homogène : on découpe en blocs séquentiels. Taille par poule = ceil/floor.
            var nbEquipes = sorted.length;
            var perPoule = Math.ceil(nbEquipes / nbPoules);
            sorted.forEach(function (eq, i) {
                var idx = Math.min(Math.floor(i / perPoule), nbPoules - 1);
                assignments[eq.id] = poulesOrdonnees[idx].id;
            });
        } else {
            // Serpentin : 0,1,2,3,3,2,1,0,0,1,2,3...
            sorted.forEach(function (eq, i) {
                var cycle = Math.floor(i / nbPoules);
                var pos = i % nbPoules;
                var idx = (cycle % 2 === 0) ? pos : (nbPoules - 1 - pos);
                assignments[eq.id] = poulesOrdonnees[idx].id;
            });
        }

        // Push en DB en parallèle
        var updates = Object.keys(assignments).map(function (eqId) {
            return supa.from('equipes').update({ poule_id: assignments[eqId] }).eq('id', eqId).select().single();
        });
        var results = await Promise.all(updates);
        var errors = results.filter(function (r) { return r.error; });
        if (errors.length > 0) {
            console.error(errors);
            showToast(errors.length + ' erreur(s) lors de la répartition', 'error');
        }
        results.forEach(function (r) {
            if (!r.data) return;
            var i = equipes.findIndex(function (e) { return e.id === r.data.id; });
            if (i >= 0) equipes[i] = r.data;
        });

        render();
        showToast('Équipes réparties (' + (mode === '1' ? 'homogène' : 'serpentin') + ')', 'ok');
    }

    // ===== Poules =====

    async function addPoule() {
        if (guardReadOnly()) return;
        var nom = els.pNom.value.trim();
        var terrain = parseInt(els.pTerrain.value) || null;
        if (!nom) { showToast('Saisir un nom de poule', 'error'); return; }
        var ordre = poules.length;
        var res = await supa.from('poules').insert({ tournoi_id: currentTournoi.id, nom: nom, terrain: terrain, ordre: ordre }).select().single();
        if (res.error) { showToast('Erreur : ' + res.error.message, 'error'); console.error(res.error); return; }
        poules.push(res.data);
        els.pNom.value = '';
        render();
    }

    async function deletePoule(id) { if (guardReadOnly()) return;
        if (!confirm('Supprimer cette poule ? Les équipes et matchs liés seront détachés.')) return;
        var res = await supa.from('poules').delete().eq('id', id);
        if (res.error) { showToast('Erreur', 'error'); console.error(res.error); return; }
        poules = poules.filter(function (p) { return p.id !== id; });
        equipes.forEach(function (e) { if (e.poule_id === id) e.poule_id = null; });
        matchs = matchs.filter(function (m) { return m.poule_id !== id; });
        render();
    }

    async function updatePouleTerrain(pouleId, terrain) {
        var res = await supa.from('poules').update({ terrain: terrain || null }).eq('id', pouleId).select().single();
        if (res.error) { showToast('Erreur', 'error'); return; }
        var i = poules.findIndex(function (p) { return p.id === pouleId; });
        if (i >= 0) poules[i] = res.data;
        render();
    }

    // ===== Génération des matchs =====

    function shuffle(arr) {
        var a = arr.slice();
        for (var i = a.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var t = a[i]; a[i] = a[j]; a[j] = t;
        }
        return a;
    }

    // Construit les matchs d'une poule selon le format choisi.
    // - 'round_robin' : toutes les paires
    // - 'croise4'     : format 4 équipes avec dépendances (M3=PM2/GM1, M4=GM2/PM1, M5=PM1/PM2, M6=GM1/GM2)
    // Algo "circle" du round-robin : génère N-1 vagues (ou N pour N pair) où chaque équipe joue
    // au plus 1 match par vague. Renvoie un tableau de vagues : [ [[a,b], [c,d]], [[a,c], [b,d]], ... ]
    function roundRobinSchedule(eqs) {
        var n = eqs.length;
        if (n < 2) return [];
        // Si nb impair, on ajoute un "bye" virtuel (équipe qui se repose)
        var teams = eqs.slice();
        if (n % 2 === 1) { teams.push(null); n++; }
        var rounds = [];
        for (var r = 0; r < n - 1; r++) {
            var round = [];
            for (var i = 0; i < n / 2; i++) {
                var a = teams[i];
                var b = teams[n - 1 - i];
                if (a && b) round.push([a, b]);
            }
            rounds.push(round);
            // Rotation : on fixe teams[0], on tourne les autres vers la droite
            teams = [teams[0]].concat([teams[n - 1]]).concat(teams.slice(1, n - 1));
        }
        return rounds;
    }

    function buildMatchsPoule(poule, format) {
        var eqs = equipes.filter(function (e) { return e.poule_id === poule.id; });
        var nbTerrains = currentTournoi.nb_terrains || 1;
        var seulePoule = poules.length === 1;
        // S'il n'y a qu'une seule poule, on limite à 2 terrains en parallèle (T1, T2)
        // et on ordonnance par vagues pour éviter les conflits d'équipes.
        var nbTerrainsUtilises = seulePoule ? Math.min(2, nbTerrains) : 1;
        var pickTerrain = function (i) {
            if (seulePoule) return ((i % nbTerrainsUtilises) + 1);
            return poule.terrain;
        };
        var base = { tournoi_id: currentTournoi.id, phase: 'poule', poule_id: poule.id, status: 'en_attente' };
        var out = [];
        var ordre = 0;

        if (format === 'croise4' && eqs.length === 4) {
            var picked = shuffle(eqs);
            // M1 : picked[0] vs picked[1]
            out.push(Object.assign({}, base, { ordre: ordre, terrain: pickTerrain(ordre), equipe_a_id: picked[0].id, equipe_b_id: picked[1].id })); ordre++;
            // M2 : picked[2] vs picked[3]
            out.push(Object.assign({}, base, { ordre: ordre, terrain: pickTerrain(ordre), equipe_a_id: picked[2].id, equipe_b_id: picked[3].id })); ordre++;
            // M3 : PM2 vs GM1
            out.push(Object.assign({}, base, { ordre: ordre, terrain: pickTerrain(ordre),
                equipe_a_source_ordre: 1, equipe_a_source_type: 'perdant',
                equipe_b_source_ordre: 0, equipe_b_source_type: 'gagnant' })); ordre++;
            // M4 : GM2 vs PM1
            out.push(Object.assign({}, base, { ordre: ordre, terrain: pickTerrain(ordre),
                equipe_a_source_ordre: 1, equipe_a_source_type: 'gagnant',
                equipe_b_source_ordre: 0, equipe_b_source_type: 'perdant' })); ordre++;
            // M5 : PM1 vs PM2 (petite finale)
            out.push(Object.assign({}, base, { ordre: ordre, terrain: pickTerrain(ordre),
                equipe_a_source_ordre: 0, equipe_a_source_type: 'perdant',
                equipe_b_source_ordre: 1, equipe_b_source_type: 'perdant' })); ordre++;
            // M6 : GM1 vs GM2 (grande finale)
            out.push(Object.assign({}, base, { ordre: ordre, terrain: pickTerrain(ordre),
                equipe_a_source_ordre: 0, equipe_a_source_type: 'gagnant',
                equipe_b_source_ordre: 1, equipe_b_source_type: 'gagnant' })); ordre++;
            return out;
        }

        // Round-robin : si 1 seule poule, on utilise l'algo circle pour ordonnancer par vagues.
        // Sinon (plusieurs poules), simple double boucle car les poules sont déjà parallélisées par terrain.
        if (seulePoule) {
            var rounds = roundRobinSchedule(eqs);
            rounds.forEach(function (round) {
                round.forEach(function (pair, idxDansRound) {
                    // Dans une même vague, on attribue T1, T2, T1, T2...
                    var terrain = ((idxDansRound % nbTerrainsUtilises) + 1);
                    out.push(Object.assign({}, base, {
                        ordre: ordre, terrain: terrain,
                        equipe_a_id: pair[0].id, equipe_b_id: pair[1].id
                    }));
                    ordre++;
                });
            });
        } else {
            for (var i = 0; i < eqs.length; i++) {
                for (var j = i + 1; j < eqs.length; j++) {
                    out.push(Object.assign({}, base, { ordre: ordre, terrain: pickTerrain(ordre), equipe_a_id: eqs[i].id, equipe_b_id: eqs[j].id }));
                    ordre++;
                }
            }
        }
        return out;
    }

    // Tous les matchs de poule aller sont-ils terminés ?
    function tousMatchsAllerTermines() {
        var allerMatchs = matchs.filter(function (m) {
            return m.phase === 'poule' && !m.is_retour;
        });
        if (allerMatchs.length === 0) return false;
        return allerMatchs.every(function (m) { return m.status === 'termine' && m.vainqueur_id; });
    }

    // Y a-t-il déjà des matchs retour générés ?
    function matchsRetourExistent() {
        return matchs.some(function (m) { return m.phase === 'poule' && m.is_retour; });
    }

    // Génère les matchs retour : pour chaque match aller, on inverse equipe_a et equipe_b.
    // Ordonnance les nouveaux matchs en vagues sans conflit, sur T1/T2 (si 1 seule poule).
    async function genererMatchsRetour() {
        if (guardReadOnly()) return;
        if (!tousMatchsAllerTermines()) {
            showToast('Termine tous les matchs aller avant de lancer les retours.', 'error');
            return;
        }
        if (matchsRetourExistent()) {
            showToast('Les matchs retour ont déjà été générés.', 'error');
            return;
        }
        if (!confirm('Lancer les matchs retour ?\n\nChaque équipe rejouera contre toutes les autres dans l\'autre sens. Le classement de poule prendra en compte aller + retour.')) return;

        var seulePoule = poules.length === 1;
        var nbTerrains = currentTournoi.nb_terrains || 1;
        var nbTerrainsUtilises = seulePoule ? Math.min(2, nbTerrains) : 1;

        // On regroupe les matchs aller par poule
        var byPoule = {};
        matchs.filter(function (m) {
            return m.phase === 'poule' && !m.is_retour && m.equipe_a_id && m.equipe_b_id;
        }).forEach(function (m) {
            (byPoule[m.poule_id] = byPoule[m.poule_id] || []).push(m);
        });

        var newMatchs = [];
        // L'ordre des nouveaux matchs reprend après le dernier ordre existant
        var maxOrdre = matchs.reduce(function (acc, m) {
            return (m.phase === 'poule') ? Math.max(acc, m.ordre) : acc;
        }, -1);
        var ordre = maxOrdre + 1;

        Object.keys(byPoule).forEach(function (pouleId) {
            var poule = poules.find(function (p) { return p.id === pouleId; });
            if (!poule) return;
            // Reconstruire les paires d'équipes (sens inversé)
            var paires = byPoule[pouleId].map(function (m) {
                return { a: m.equipe_b_id, b: m.equipe_a_id };
            });
            // Ordonnancer en vagues pour éviter qu'une équipe joue 2 matchs en parallèle
            var planifies = [];
            var restant = paires.slice();
            while (restant.length > 0) {
                var vague = [];
                var equipesVague = {};
                for (var i = restant.length - 1; i >= 0; i--) {
                    var p = restant[i];
                    if (equipesVague[p.a] || equipesVague[p.b]) continue;
                    if (seulePoule && vague.length >= nbTerrainsUtilises) continue;
                    equipesVague[p.a] = true;
                    equipesVague[p.b] = true;
                    vague.push(p);
                    restant.splice(i, 1);
                }
                planifies.push(vague.reverse());
            }
            planifies.forEach(function (vague) {
                vague.forEach(function (pair, idxDansVague) {
                    var terrain = seulePoule ? ((idxDansVague % nbTerrainsUtilises) + 1) : poule.terrain;
                    newMatchs.push({
                        tournoi_id: currentTournoi.id, phase: 'poule', poule_id: pouleId,
                        status: 'en_attente',
                        ordre: ordre, terrain: terrain,
                        equipe_a_id: pair.a, equipe_b_id: pair.b,
                        is_retour: true
                    });
                    ordre++;
                });
            });
        });

        if (newMatchs.length === 0) {
            showToast('Aucun match retour à générer.', 'error');
            return;
        }
        var res = await supa.from('matchs').insert(newMatchs).select();
        if (res.error) { showToast('Erreur : ' + res.error.message, 'error'); console.error(res.error); return; }
        matchs = matchs.concat(res.data);
        // Recalculer aussi les placeholders éventuels de phase finale
        await propagateRangPoule();
        render();
        showToast(res.data.length + ' matchs retour générés', 'ok');
    }

    async function genererMatchsPoules() { if (guardReadOnly()) return;
        // Pour chaque poule, demander le format (si 4 équipes, proposer croisé)
        var formatsParPoule = {};
        for (var i = 0; i < poules.length; i++) {
            var p = poules[i];
            var nbEqs = equipes.filter(function (e) { return e.poule_id === p.id; }).length;
            if (nbEqs < 2) { formatsParPoule[p.id] = null; continue; }
            if (nbEqs === 4) {
                var useCroise = confirm(p.nom + ' (4 équipes) : utiliser le format croisé (M1, M2 tirés au sort, puis PM2/GM1, GM2/PM1, PM1/PM2, GM1/GM2) ?\n\nAnnuler = round-robin classique (toutes les paires).');
                formatsParPoule[p.id] = useCroise ? 'croise4' : 'round_robin';
            } else {
                formatsParPoule[p.id] = 'round_robin';
            }
        }

        if (!confirm('Générer tous les matchs de poule ? Les matchs de poule existants seront supprimés.')) return;

        await supa.from('matchs').delete().eq('tournoi_id', currentTournoi.id).eq('phase', 'poule');

        var newMatchs = [];
        poules.forEach(function (poule) {
            var fmt = formatsParPoule[poule.id];
            if (!fmt) return;
            newMatchs = newMatchs.concat(buildMatchsPoule(poule, fmt));
        });

        if (newMatchs.length === 0) {
            showToast('Aucun match à générer (poules vides ou avec 1 équipe)', 'error');
            return;
        }

        var res = await supa.from('matchs').insert(newMatchs).select();
        if (res.error) { showToast('Erreur : ' + res.error.message, 'error'); console.error(res.error); return; }
        matchs = matchs.filter(function (m) { return m.phase !== 'poule' });
        matchs = matchs.concat(res.data);

        await updateTournoi({ phase: 'poules' });

        // Pré-génère le squelette de phase finale dès maintenant (les placeholders se rempliront
        // au fur et à mesure des résultats de poule via propagateRangPoule).
        if (!matchs.some(function (m) { return m.phase === 'finale'; })) {
            await squeletteAutoSelonConfig();
        }

        showToast(newMatchs.length + ' matchs de poule générés', 'ok');
        render();
    }

    // Demande à l'admin quel format de phase finale pré-générer, et appelle la bonne fonction.
    async function squeletteAutoSelonConfig() {
        if (guardReadOnly()) return;
        var maison3x4 = isConfig3p4();
        var maison1p5 = isConfig1p5();
        var maison1p4 = isConfig1p4();
        var nbPoules = poules.length;

        // 1 poule de 4 : auto, pas de popup
        if (maison1p4) {
            return await genererSqueletteMaison1p4();
        }
        // 1 poule de 5 : auto, pas de popup
        if (maison1p5) {
            return await genererSqueletteMaison1p5();
        }

        if (nbPoules < 2) {
            showToast('Il faut au moins 2 poules (ou 1 poule de 5) pour une phase finale.', 'error');
            return;
        }

        var menu = 'Choisis le format de phase finale à pré-générer :\n\n' +
            '  1 — Top 1 de chaque poule (les ' + nbPoules + ' 1ers s\'affrontent)\n' +
            '  2 — Top 1 + meilleur 2e (' + (nbPoules + 1) + ' équipes au principal)\n';
        if (maison3x4) {
            menu += '  3 — Maison 3p×4 (demi + finale + 3/4 + matchs 5-6, 7-8, 9-10, 11-12)\n';
        }
        menu += '  4 — Ne rien générer maintenant\n\nTape 1, 2' + (maison3x4 ? ', 3' : '') + ' ou 4 :';

        var choix = prompt(menu, maison3x4 ? '3' : '2');
        if (choix == null) return;
        choix = String(choix).trim();
        if (choix === '4') return;
        if (choix === '1') return await genererSqueletteGenerique('top1');
        if (choix === '2') return await genererSqueletteGenerique('top1_plus_best2');
        if (choix === '3' && maison3x4) return await genererSqueletteMaison3x4();
        showToast('Choix invalide', 'error');
    }

    // Génère le squelette de phase finale maison 3p×4 avec des placeholders rang_poule.
    // Les vraies équipes seront résolues par propagateRangPoule() au fil des matchs de poule.
    async function genererSqueletteMaison3x4() {
        var poulesOrdonnees = poules.slice().sort(function (a, b) { return a.ordre - b.ordre; });
        if (poulesOrdonnees.length !== 3) return;

        var nbT = currentTournoi.nb_terrains || 1;
        var pickT = function (i) { return ((i % nbT) + 1); };
        var base = function (bracket, ordre) {
            return {
                tournoi_id: currentTournoi.id, phase: 'finale', bracket: bracket,
                status: 'en_attente', ordre: ordre, terrain: pickT(ordre)
            };
        };
        // Placeholder helpers
        var rangP = function (pouleId, rang) {
            return {
                equipe_a_id: null,
                equipe_a_source_poule_id: pouleId, equipe_a_source_ordre: rang, equipe_a_source_type: 'rang_poule'
            };
        };
        var rangP_b = function (pouleId, rang) {
            return {
                equipe_b_id: null,
                equipe_b_source_poule_id: pouleId, equipe_b_source_ordre: rang, equipe_b_source_type: 'rang_poule'
            };
        };
        // meilleur_2e : ne dépend pas d'une poule précise, l'ordre est ignoré
        var best2eA = {
            equipe_a_id: null,
            equipe_a_source_poule_id: null, equipe_a_source_ordre: null, equipe_a_source_type: 'meilleur_2e'
        };
        var best2eB = {
            equipe_b_id: null,
            equipe_b_source_poule_id: null, equipe_b_source_ordre: null, equipe_b_source_type: 'meilleur_2e'
        };
        // autres_2es : les 2 autres 2es (pas le meilleur). Ordre 1 ou 2 pour distinguer dans le match 5-6
        var autres2eA = function (slot) {
            return {
                equipe_a_id: null,
                equipe_a_source_poule_id: null, equipe_a_source_ordre: slot, equipe_a_source_type: 'autres_2es'
            };
        };
        var autres2eB = function (slot) {
            return {
                equipe_b_id: null,
                equipe_b_source_poule_id: null, equipe_b_source_ordre: slot, equipe_b_source_type: 'autres_2es'
            };
        };

        var P1 = poulesOrdonnees[0].id;
        var P2 = poulesOrdonnees[1].id;
        var P3 = poulesOrdonnees[2].id;
        var ordre = 0;
        var newMatchs = [];

        // === Tableau principal ===
        // Demi 1 : 1er Poule A vs meilleur 2e
        newMatchs.push(Object.assign({}, base('principal', ordre++), rangP(P1, 1), best2eB));
        // Demi 2 : 1er Poule B vs 1er Poule C
        newMatchs.push(Object.assign({}, base('principal', ordre++), rangP(P2, 1), rangP_b(P3, 1)));

        // === Places 5-6 : les 2 autres 2es (slot 1 et 2 dans le pool "autres_2es") ===
        newMatchs.push(Object.assign({}, base('places_5_6', ordre++), autres2eA(1), autres2eB(2)));

        // === Places 7-8 : 3e P1 vs 3e P2 ===
        newMatchs.push(Object.assign({}, base('places_7_8', ordre++), rangP(P1, 3), rangP_b(P2, 3)));

        // === Places 9-10 : 4e P1 vs 3e P3 ===
        newMatchs.push(Object.assign({}, base('places_9_10', ordre++), rangP(P1, 4), rangP_b(P3, 3)));

        // === Places 11-12 : 4e P2 vs 4e P3 ===
        newMatchs.push(Object.assign({}, base('places_11_12', ordre++), rangP(P2, 4), rangP_b(P3, 4)));

        var res = await supa.from('matchs').insert(newMatchs).select();
        if (res.error) { showToast('Erreur squelette : ' + res.error.message, 'error'); console.error(res.error); return; }
        matchs = matchs.concat(res.data);
        // Tente une 1re résolution au cas où certaines poules sont déjà avancées
        await propagateRangPoule();
    }

    // === Squelette générique de phase finale ===
    // format: 'top1' (1er de chaque poule) ou 'top1_plus_best2' (1ers + meilleur 2e)
    // Construit :
    //   - 'principal' : seeding standard 1vN, 2v(N-1) avec placeholders rang_poule / meilleur_2e
    //   - 'rang_2'    : tous les 2es (sauf le meilleur si format top1_plus_best2) → autres_2es
    //   - 'rang_3'    : tous les 3es → rang_poule
    //   - 'rang_4'    : tous les 4es → rang_poule
    //   - 'rang_N'    : pour les poules de plus de 4 équipes
    async function genererSqueletteGenerique(format) {
        var poulesOrdonnees = poules.slice().sort(function (a, b) { return a.ordre - b.ordre; });
        if (poulesOrdonnees.length === 0) {
            showToast('Aucune poule pour générer la phase finale.', 'error');
            return;
        }

        var nbT = currentTournoi.nb_terrains || 1;
        var pickT = function (i) { return ((i % nbT) + 1); };
        var newMatchs = [];
        var ordre = 0;

        // Construit un placeholder rang_poule pour une face A ou B
        var placeholderRang = function (pouleId, rang, side) {
            var p = {};
            p['equipe_' + side + '_id'] = null;
            p['equipe_' + side + '_source_poule_id'] = pouleId;
            p['equipe_' + side + '_source_ordre'] = rang;
            p['equipe_' + side + '_source_type'] = 'rang_poule';
            return p;
        };
        // Placeholder meilleur_2e
        var placeholderMeilleur2e = function (side) {
            var p = {};
            p['equipe_' + side + '_id'] = null;
            p['equipe_' + side + '_source_poule_id'] = null;
            p['equipe_' + side + '_source_ordre'] = null;
            p['equipe_' + side + '_source_type'] = 'meilleur_2e';
            return p;
        };
        // Placeholder autres_2es (slot 1..N)
        var placeholderAutres2es = function (slot, side) {
            var p = {};
            p['equipe_' + side + '_id'] = null;
            p['equipe_' + side + '_source_poule_id'] = null;
            p['equipe_' + side + '_source_ordre'] = slot;
            p['equipe_' + side + '_source_type'] = 'autres_2es';
            return p;
        };

        var base = function (bracket) {
            return {
                tournoi_id: currentTournoi.id, phase: 'finale', bracket: bracket,
                status: 'en_attente', ordre: ordre, terrain: pickT(ordre)
            };
        };

        // === Tableau principal ===
        // Liste des "entrants" du principal : un slot par 1er de poule, plus 'meilleur_2e' si applicable
        // Représenté par un tableau de descripteurs : { kind: 'rang_poule'|'meilleur_2e', pouleId?, rang? }
        var principalEntrants = poulesOrdonnees.map(function (p) {
            return { kind: 'rang_poule', pouleId: p.id, rang: 1 };
        });
        if (format === 'top1_plus_best2') {
            principalEntrants.push({ kind: 'meilleur_2e' });
        }

        var n = principalEntrants.length;
        if (n >= 2) {
            // Seeding standard : 1 vs n, 2 vs n-1...
            // (avec n impair, on s'arrête au milieu — le seed du milieu n'a pas de match initial)
            // Placeholder pour le slot N-1, etc. : les entrants[i] sont déjà ordonnés "seed".
            var slotToPlaceholder = function (entry, side) {
                if (entry.kind === 'meilleur_2e') return placeholderMeilleur2e(side);
                return placeholderRang(entry.pouleId, entry.rang, side);
            };
            // Cas spéciaux courants :
            if (n === 2) {
                // Finale directe : 1 match
                newMatchs.push(Object.assign({}, base('principal'),
                    slotToPlaceholder(principalEntrants[0], 'a'),
                    slotToPlaceholder(principalEntrants[1], 'b')));
                ordre++;
            } else if (n === 3) {
                // Barrage + finale (l'exempté est le seed 1)
                // Match 1 : seed 2 vs seed 3
                newMatchs.push(Object.assign({}, base('principal'),
                    slotToPlaceholder(principalEntrants[1], 'a'),
                    slotToPlaceholder(principalEntrants[2], 'b')));
                ordre++;
                // Match 2 (finale) : créé après que le barrage soit joué — on le laisse à genererTourSuivant
            } else if (n === 4) {
                // Demi 1 : seed 1 vs seed 4
                newMatchs.push(Object.assign({}, base('principal'),
                    slotToPlaceholder(principalEntrants[0], 'a'),
                    slotToPlaceholder(principalEntrants[3], 'b')));
                ordre++;
                // Demi 2 : seed 2 vs seed 3
                newMatchs.push(Object.assign({}, base('principal'),
                    slotToPlaceholder(principalEntrants[1], 'a'),
                    slotToPlaceholder(principalEntrants[2], 'b')));
                ordre++;
            } else if (n === 8) {
                // Quarts seedés
                var pairs = [[0,7],[3,4],[1,6],[2,5]];
                pairs.forEach(function (pair) {
                    newMatchs.push(Object.assign({}, base('principal'),
                        slotToPlaceholder(principalEntrants[pair[0]], 'a'),
                        slotToPlaceholder(principalEntrants[pair[1]], 'b')));
                    ordre++;
                });
            } else {
                // Fallback : seeding générique 1vN, 2v(N-1)...
                for (var i = 0; i < Math.floor(n / 2); i++) {
                    newMatchs.push(Object.assign({}, base('principal'),
                        slotToPlaceholder(principalEntrants[i], 'a'),
                        slotToPlaceholder(principalEntrants[n - 1 - i], 'b')));
                    ordre++;
                }
            }
        }

        // === Bracket des 2es (sauf le meilleur si top1_plus_best2) ===
        if (format === 'top1_plus_best2') {
            // autres_2es : slot 1..N-1 (le meilleur 2e étant qualifié au principal)
            var nbAutres2es = poulesOrdonnees.length - 1;
            newMatchs = newMatchs.concat(buildPlaceholderBracket(nbAutres2es, 'rang_2', function (slot, side) {
                return placeholderAutres2es(slot, side);
            }, ordre, pickT));
            ordre += matchsRecentsCount(newMatchs);
        } else {
            // format 'top1' : tous les 2es jouent un bracket dédié, placeholders rang_poule
            var nbDeuxiemes = poulesOrdonnees.length;
            newMatchs = newMatchs.concat(buildPlaceholderBracketFromPoules(nbDeuxiemes, 'rang_2', 2, poulesOrdonnees, placeholderRang, ordre, pickT));
            ordre += matchsRecentsCount(newMatchs);
        }

        // === Brackets pour les rangs 3, 4, 5+ ===
        // On regarde la taille de poule max pour savoir combien de rangs il y a
        var nbEqMaxParPoule = 0;
        poulesOrdonnees.forEach(function (p) {
            var n = equipes.filter(function (e) { return e.poule_id === p.id; }).length;
            if (n > nbEqMaxParPoule) nbEqMaxParPoule = n;
        });
        for (var rang = 3; rang <= nbEqMaxParPoule; rang++) {
            // Combien de poules ont une équipe à ce rang ?
            var nbAuRang = poulesOrdonnees.filter(function (p) {
                return equipes.filter(function (e) { return e.poule_id === p.id; }).length >= rang;
            }).length;
            if (nbAuRang < 2) continue;
            // Bracket dédié pour ce rang
            var poulesCeRang = poulesOrdonnees.filter(function (p) {
                return equipes.filter(function (e) { return e.poule_id === p.id; }).length >= rang;
            });
            newMatchs = newMatchs.concat(buildPlaceholderBracketFromPoules(nbAuRang, 'rang_' + rang, rang, poulesCeRang, placeholderRang, ordre, pickT));
            ordre = ordre + Math.floor(nbAuRang / 2) + (nbAuRang === 3 ? 1 : 0); // heuristique
        }

        var res = await supa.from('matchs').insert(newMatchs).select();
        if (res.error) { showToast('Erreur squelette : ' + res.error.message, 'error'); console.error(res.error); return; }
        matchs = matchs.concat(res.data);
        await propagateRangPoule();
    }

    function matchsRecentsCount(arr) {
        // Compte les matchs ajoutés au dernier batch — utilisé pour incrémenter `ordre`
        // (ici on retourne 0 car on incrémente nous-mêmes via pickT). Simple stub.
        return 0;
    }

    // Construit un mini-bracket de N placeholders avec une fonction qui crée le placeholder à partir d'un slot
    function buildPlaceholderBracket(n, bracket, makePlaceholder, ordreStart, pickT) {
        var out = [];
        var ordre = ordreStart;
        var baseObj = function () {
            return {
                tournoi_id: currentTournoi.id, phase: 'finale', bracket: bracket,
                status: 'en_attente', ordre: ordre, terrain: pickT(ordre)
            };
        };
        if (n === 2) {
            out.push(Object.assign(baseObj(), makePlaceholder(1, 'a'), makePlaceholder(2, 'b')));
        } else if (n === 3) {
            out.push(Object.assign(baseObj(), makePlaceholder(2, 'a'), makePlaceholder(3, 'b')));
        } else if (n === 4) {
            out.push(Object.assign(baseObj(), makePlaceholder(1, 'a'), makePlaceholder(4, 'b')));
            ordre++;
            out.push(Object.assign(baseObj(), makePlaceholder(2, 'a'), makePlaceholder(3, 'b')));
        } else if (n >= 5) {
            for (var i = 0; i < Math.floor(n / 2); i++) {
                out.push(Object.assign(baseObj(), makePlaceholder(i + 1, 'a'), makePlaceholder(n - i, 'b')));
                ordre++;
            }
        }
        return out;
    }

    // Construit un mini-bracket à partir d'une liste de poules à un rang donné.
    // Crée les paires avec placeholderRang(pouleId, rang) en alternant les poules.
    function buildPlaceholderBracketFromPoules(n, bracket, rang, poulesList, placeholderRang, ordreStart, pickT) {
        var out = [];
        var ordre = ordreStart;
        if (n < 2) return out;
        if (n === 2) {
            out.push(Object.assign({
                tournoi_id: currentTournoi.id, phase: 'finale', bracket: bracket,
                status: 'en_attente', ordre: ordre, terrain: pickT(ordre)
            }, placeholderRang(poulesList[0].id, rang, 'a'), placeholderRang(poulesList[1].id, rang, 'b')));
        } else if (n === 3) {
            // Barrage : poule 2 vs poule 3 (la poule 1 exemptée)
            out.push(Object.assign({
                tournoi_id: currentTournoi.id, phase: 'finale', bracket: bracket,
                status: 'en_attente', ordre: ordre, terrain: pickT(ordre)
            }, placeholderRang(poulesList[1].id, rang, 'a'), placeholderRang(poulesList[2].id, rang, 'b')));
        } else if (n === 4) {
            out.push(Object.assign({
                tournoi_id: currentTournoi.id, phase: 'finale', bracket: bracket,
                status: 'en_attente', ordre: ordre++, terrain: pickT(ordre)
            }, placeholderRang(poulesList[0].id, rang, 'a'), placeholderRang(poulesList[3].id, rang, 'b')));
            out.push(Object.assign({
                tournoi_id: currentTournoi.id, phase: 'finale', bracket: bracket,
                status: 'en_attente', ordre: ordre, terrain: pickT(ordre)
            }, placeholderRang(poulesList[1].id, rang, 'a'), placeholderRang(poulesList[2].id, rang, 'b')));
        } else {
            // Générique : 1vN, 2v(N-1)...
            for (var i = 0; i < Math.floor(n / 2); i++) {
                out.push(Object.assign({
                    tournoi_id: currentTournoi.id, phase: 'finale', bracket: bracket,
                    status: 'en_attente', ordre: ordre++, terrain: pickT(ordre)
                }, placeholderRang(poulesList[i].id, rang, 'a'), placeholderRang(poulesList[n - 1 - i].id, rang, 'b')));
            }
        }
        return out;
    }

    // Résout les placeholders rang_poule / meilleur_2e / autres_2es sur les matchs en_attente
    // selon l'état courant des classements de poule.
    async function propagateRangPoule() {
        var matchsFinale = matchs.filter(function (m) {
            return m.phase === 'finale' && m.status === 'en_attente';
        });
        if (matchsFinale.length === 0) return;

        // Calculer les classements de toutes les poules une seule fois
        var classements = {};
        poules.forEach(function (p) {
            classements[p.id] = computeClassement(p.id);
        });

        // Identifier le meilleur 2e et les autres 2es
        var deuxiemes = [];
        poules.forEach(function (p) {
            var c = classements[p.id];
            if (c[1]) deuxiemes.push({ equipe_id: c[1].id, poule_id: p.id, stats: c[1] });
        });
        var deuxiemesTries = trierParStats(deuxiemes);
        var meilleur2eId = deuxiemesTries.length > 0 ? deuxiemesTries[0].equipe_id : null;
        var autres2esIds = deuxiemesTries.slice(1).map(function (d) { return d.equipe_id; });

        // Le classement provisoire est utilisable dès qu'au moins un match de la poule est joué.
        var pouleAuMoinsUnMatchJoue = function (pouleId) {
            return matchs.some(function (mm) {
                return mm.phase === 'poule' && mm.poule_id === pouleId && mm.status === 'termine';
            });
        };

        var resolveSide = function (m, side) {
            var srcType = side === 'a' ? m.equipe_a_source_type : m.equipe_b_source_type;
            var srcOrdre = side === 'a' ? m.equipe_a_source_ordre : m.equipe_b_source_ordre;
            var srcPouleId = side === 'a' ? m.equipe_a_source_poule_id : m.equipe_b_source_poule_id;
            if (!srcType) return null;
            if (srcType === 'rang_poule') {
                if (!srcPouleId || !srcOrdre) return null;
                var c = classements[srcPouleId];
                if (!c) return null;
                // On résout dès qu'au moins un match de la poule est joué : classement provisoire.
                if (!pouleAuMoinsUnMatchJoue(srcPouleId)) return null;
                var entry = c[srcOrdre - 1];
                return entry ? entry.id : null;
            }
            if (srcType === 'meilleur_2e') {
                // On résout dès qu'on a au moins un 2e provisoire (= au moins une poule a un match joué)
                return meilleur2eId;
            }
            if (srcType === 'autres_2es') {
                var idx = (srcOrdre || 1) - 1;
                return autres2esIds[idx] || null;
            }
            return null;
        };

        // On réécrit systématiquement les équipes des matchs en_attente pour refléter le classement courant
        // (même si une équipe était déjà assignée, car le rang peut avoir changé).
        var updates = [];
        matchsFinale.forEach(function (m) {
            var patch = {};
            var idA = resolveSide(m, 'a');
            var idB = resolveSide(m, 'b');
            // Ne pas écrire si l'équipe n'a pas pu être résolue ET que rien n'était assigné avant
            if (m.equipe_a_source_type && idA !== m.equipe_a_id) patch.equipe_a_id = idA;
            if (m.equipe_b_source_type && idB !== m.equipe_b_id) patch.equipe_b_id = idB;
            if (Object.keys(patch).length > 0) updates.push({ id: m.id, patch: patch });
        });

        for (var i = 0; i < updates.length; i++) {
            var u = updates[i];
            var res = await supa.from('matchs').update(u.patch).eq('id', u.id).select().single();
            if (!res.error) {
                var idx = matchs.findIndex(function (mm) { return mm.id === u.id; });
                if (idx >= 0) matchs[idx] = res.data;
            }
        }
    }

    // ===== Phase finale =====

    // Toutes les poules ont-elles tous leurs matchs terminés ?
    function poulesToutesTerminees() {
        if (poules.length === 0) return false;
        var matchsPoule = matchs.filter(function (m) { return m.phase === 'poule'; });
        if (matchsPoule.length === 0) return false;
        return matchsPoule.every(function (m) { return m.status === 'termine' && m.vainqueur_id; });
    }

    // Classement global : { poule_id, poule_nom, rang_dans_poule, equipe, stats }
    function classementGlobal() {
        var rows = [];
        poules.forEach(function (p) {
            var classement = computeClassement(p.id);
            classement.forEach(function (s, idx) {
                rows.push({
                    poule_id: p.id,
                    poule_nom: p.nom,
                    rang: idx + 1, // 1 = 1er de poule, 2 = 2e, etc.
                    equipe_id: s.id,
                    stats: s
                });
            });
        });
        return rows;
    }

    // Trie des équipes ayant le même rang de poule selon les stats (V, ±sets, ±jeux, nom)
    function trierParStats(rows) {
        return rows.slice().sort(function (a, b) {
            var sa = a.stats, sb = b.stats;
            if (sb.v !== sa.v) return sb.v - sa.v;
            var dsA = sa.sg - sa.sp, dsB = sb.sg - sb.sp;
            if (dsB !== dsA) return dsB - dsA;
            var djA = sa.jg - sa.jp, djB = sb.jg - sb.jp;
            if (djB !== djA) return djB - djA;
            return sa.nom.localeCompare(sb.nom);
        });
    }

    // Construit les pairs de bracket avec seeding standard puis correction "éviter mêmes poules".
    // entrants[] = équipes triées (seed 1 d'abord). Renvoie [{ a, b }] dans l'ordre des matchs.
    function buildBracketPairs(entrants) {
        var n = entrants.length;
        if (n < 2) return [];
        // Seeding standard : 1 vs n, 2 vs n-1, ...
        var pairs = [];
        for (var i = 0; i < n / 2; i++) {
            pairs.push({ a: entrants[i], b: entrants[n - 1 - i] });
        }
        // Tentative simple d'éviter les mêmes poules : si conflit, swap avec un voisin
        for (var k = 0; k < pairs.length; k++) {
            var pa = pairs[k];
            if (pa.a.poule_id && pa.b.poule_id && pa.a.poule_id === pa.b.poule_id) {
                for (var j = k + 1; j < pairs.length; j++) {
                    var pb = pairs[j];
                    // Swap b de pa avec b de pb si ça résout sans créer de conflit ailleurs
                    if (pa.a.poule_id !== pb.b.poule_id && pa.b.poule_id !== pb.a.poule_id) {
                        var tmp = pa.b; pa.b = pb.b; pb.b = tmp;
                        break;
                    }
                }
            }
        }
        return pairs;
    }

    // Génère les matchs du premier tour d'un mini-bracket pour un ensemble d'équipes.
    // - 2 équipes : 1 match unique (= match de classement direct)
    // - 3 équipes : "exemption + finale" : meilleur exempté, les 2 autres jouent un barrage,
    //   puis le gagnant affronte l'exempté. On crée juste le barrage maintenant ; le match
    //   "finale" sera créé après.
    // - 4+ équipes : seeding 1vN, 2v(N-1)... + correction mêmes poules
    function buildPremiers(entrants, bracket, terrainPool) {
        var matchsBracket = [];
        var n = entrants.length;
        if (n < 2) return [];
        var pickTerrain = function (i) { return terrainPool[i % terrainPool.length] || null; };

        if (n === 3) {
            // Barrage : exempté = entrants[0]. Les 2 autres jouent.
            matchsBracket.push({
                phase: 'finale', bracket: bracket,
                tournoi_id: currentTournoi.id, status: 'en_attente',
                ordre: 0, terrain: pickTerrain(0),
                equipe_a_id: entrants[1].equipe_id,
                equipe_b_id: entrants[2].equipe_id
            });
            return matchsBracket;
        }

        var pairs = buildBracketPairs(entrants);
        pairs.forEach(function (p, i) {
            matchsBracket.push({
                phase: 'finale', bracket: bracket,
                tournoi_id: currentTournoi.id, status: 'en_attente',
                ordre: i, terrain: pickTerrain(i),
                equipe_a_id: p.a.equipe_id,
                equipe_b_id: p.b.equipe_id
            });
        });
        return matchsBracket;
    }

    // Génération phase finale "maison" pour 3 poules de 4 équipes.
    // Brackets créés :
    //   - 'principal' (4 équipes : 3 premiers + meilleur 2e) → demi×2 + finale + 3e/4e
    //   - 'places_5_6' (les 2 autres 2es) → 1 match
    //   - 'places_7_8' (3e poule 1 vs 3e poule 2) → 1 match
    //   - 'places_9_10' (4e poule 1 vs 3e poule 3) → 1 match
    //   - 'places_11_12' (les 2 restants : 4e poule 2 et 4e poule 3) → 1 match
    async function genererPhaseFinaleMaison3x4() {
        // Poules triées par ordre (P1, P2, P3)
        var poulesOrdonnees = poules.slice().sort(function (a, b) { return a.ordre - b.ordre; });
        // Pour chaque poule, classement final
        var rangs = poulesOrdonnees.map(function (p) {
            var c = computeClassement(p.id);
            return c; // c[0] = 1er, c[1] = 2e, c[2] = 3e, c[3] = 4e
        });

        // Vérif : 3 poules de 4 avec classement complet
        if (rangs.length !== 3 || !rangs.every(function (c) { return c.length === 4; })) {
            showToast('Format maison : il faut exactement 3 poules de 4 équipes.', 'error');
            return;
        }

        var premiers = [
            { equipe_id: rangs[0][0].id, poule_id: poulesOrdonnees[0].id, stats: rangs[0][0] },
            { equipe_id: rangs[1][0].id, poule_id: poulesOrdonnees[1].id, stats: rangs[1][0] },
            { equipe_id: rangs[2][0].id, poule_id: poulesOrdonnees[2].id, stats: rangs[2][0] }
        ];
        var deuxiemes = [
            { equipe_id: rangs[0][1].id, poule_id: poulesOrdonnees[0].id, stats: rangs[0][1] },
            { equipe_id: rangs[1][1].id, poule_id: poulesOrdonnees[1].id, stats: rangs[1][1] },
            { equipe_id: rangs[2][1].id, poule_id: poulesOrdonnees[2].id, stats: rangs[2][1] }
        ];
        var troisiemes = [rangs[0][2], rangs[1][2], rangs[2][2]];
        var quatriemes = [rangs[0][3], rangs[1][3], rangs[2][3]];

        // Trier 2es par stats pour identifier le meilleur
        var deuxiemesTries = trierParStats(deuxiemes);
        var meilleur2e = deuxiemesTries[0];
        var autres2es = deuxiemesTries.slice(1); // 2 équipes

        // Tableau principal : 3 premiers + meilleur 2e
        var principal = trierParStats(premiers).concat([meilleur2e]);
        // Réordonner pour seeding : 1 vs 4, 2 vs 3
        // (premier des stats vs dernier)

        var nbT = currentTournoi.nb_terrains || 1;
        var pickT = function (i) { return ((i % nbT) + 1); };
        var newMatchs = [];
        var ordre = 0;

        // === Tableau principal : demi 1, demi 2, finale (avec deps), 3e/4e (avec deps) ===
        // Demi 1 : seed 1 vs seed 4 ; Demi 2 : seed 2 vs seed 3
        newMatchs.push({
            tournoi_id: currentTournoi.id, phase: 'finale', bracket: 'principal',
            status: 'en_attente', ordre: ordre, terrain: pickT(ordre),
            equipe_a_id: principal[0].equipe_id, equipe_b_id: principal[3].equipe_id
        }); ordre++;
        newMatchs.push({
            tournoi_id: currentTournoi.id, phase: 'finale', bracket: 'principal',
            status: 'en_attente', ordre: ordre, terrain: pickT(ordre),
            equipe_a_id: principal[1].equipe_id, equipe_b_id: principal[2].equipe_id
        }); ordre++;

        // === Bracket places 5-6 : les 2 autres 2es ===
        newMatchs.push({
            tournoi_id: currentTournoi.id, phase: 'finale', bracket: 'places_5_6',
            status: 'en_attente', ordre: ordre, terrain: pickT(ordre),
            equipe_a_id: autres2es[0].equipe_id, equipe_b_id: autres2es[1].equipe_id
        }); ordre++;

        // === Bracket places 7-8 : 3e P1 vs 3e P2 ===
        newMatchs.push({
            tournoi_id: currentTournoi.id, phase: 'finale', bracket: 'places_7_8',
            status: 'en_attente', ordre: ordre, terrain: pickT(ordre),
            equipe_a_id: troisiemes[0].id, equipe_b_id: troisiemes[1].id
        }); ordre++;

        // === Bracket places 9-10 : 4e P1 vs 3e P3 ===
        newMatchs.push({
            tournoi_id: currentTournoi.id, phase: 'finale', bracket: 'places_9_10',
            status: 'en_attente', ordre: ordre, terrain: pickT(ordre),
            equipe_a_id: quatriemes[0].id, equipe_b_id: troisiemes[2].id
        }); ordre++;

        // === Bracket places 11-12 : 4e P2 vs 4e P3 ===
        newMatchs.push({
            tournoi_id: currentTournoi.id, phase: 'finale', bracket: 'places_11_12',
            status: 'en_attente', ordre: ordre, terrain: pickT(ordre),
            equipe_a_id: quatriemes[1].id, equipe_b_id: quatriemes[2].id
        }); ordre++;

        var res = await supa.from('matchs').insert(newMatchs).select();
        if (res.error) { showToast('Erreur : ' + res.error.message, 'error'); console.error(res.error); return; }
        matchs = matchs.concat(res.data);
        await updateTournoi({ phase: 'finale' });
        render();
        showToast('Phase finale (maison 3p×4) générée : ' + res.data.length + ' matchs', 'ok');
    }

    // Est-on dans la config exacte 3 poules de 4 équipes (12 équipes) ?
    function isConfig3p4() {
        if (poules.length !== 3) return false;
        var tailles = poules.map(function (p) {
            return equipes.filter(function (e) { return e.poule_id === p.id; }).length;
        });
        return tailles.every(function (n) { return n === 4; });
    }

    function isConfig1p5() {
        if (poules.length !== 1) return false;
        var nb = equipes.filter(function (e) { return e.poule_id === poules[0].id; }).length;
        return nb === 5;
    }

    function isConfig1p4() {
        if (poules.length !== 1) return false;
        var nb = equipes.filter(function (e) { return e.poule_id === poules[0].id; }).length;
        return nb === 4;
    }

    // Format maison 1 poule de 4 équipes :
    // - principal/ordre 0 : finale = 1er vs 2e de poule (sur T1)
    // - places_3_4/ordre 1 : 3e vs 4e (sur T2)
    async function genererSqueletteMaison1p4() {
        if (poules.length !== 1) return;
        var pouleId = poules[0].id;
        var nbT = currentTournoi.nb_terrains || 1;
        var newMatchs = [];

        // Finale : 1er vs 2e — T1
        newMatchs.push({
            tournoi_id: currentTournoi.id, phase: 'finale', bracket: 'principal',
            status: 'en_attente', ordre: 0, terrain: 1,
            equipe_a_id: null,
            equipe_a_source_poule_id: pouleId, equipe_a_source_ordre: 1, equipe_a_source_type: 'rang_poule',
            equipe_b_id: null,
            equipe_b_source_poule_id: pouleId, equipe_b_source_ordre: 2, equipe_b_source_type: 'rang_poule'
        });

        // Match 3e/4e — T2 (ou T1 s'il n'y a qu'un terrain)
        newMatchs.push({
            tournoi_id: currentTournoi.id, phase: 'finale', bracket: 'places_3_4',
            status: 'en_attente', ordre: 1, terrain: nbT >= 2 ? 2 : 1,
            equipe_a_id: null,
            equipe_a_source_poule_id: pouleId, equipe_a_source_ordre: 3, equipe_a_source_type: 'rang_poule',
            equipe_b_id: null,
            equipe_b_source_poule_id: pouleId, equipe_b_source_ordre: 4, equipe_b_source_type: 'rang_poule'
        });

        var res = await supa.from('matchs').insert(newMatchs).select();
        if (res.error) { showToast('Erreur squelette : ' + res.error.message, 'error'); console.error(res.error); return; }
        matchs = matchs.concat(res.data);
        await propagateRangPoule();
    }

    // Format maison 1 poule de 5 équipes :
    // - principal/ordre 0 : demi-finale = 2e vs 3e
    // - principal/ordre 1 : finale = 1er de poule vs vainqueur de la demi (créée auto après la demi)
    // - places_4_5/ordre 2 : match pour les places 4-5
    // Le perdant de la demi est 3e (pas de match supplémentaire).
    async function genererSqueletteMaison1p5() {
        if (poules.length !== 1) return;
        var pouleId = poules[0].id;
        var nbT = currentTournoi.nb_terrains || 1;
        var newMatchs = [];

        // Demi-finale (principal) : 2e vs 3e — T1
        newMatchs.push({
            tournoi_id: currentTournoi.id, phase: 'finale', bracket: 'principal',
            status: 'en_attente', ordre: 0, terrain: 1,
            equipe_a_id: null,
            equipe_a_source_poule_id: pouleId, equipe_a_source_ordre: 2, equipe_a_source_type: 'rang_poule',
            equipe_b_id: null,
            equipe_b_source_poule_id: pouleId, equipe_b_source_ordre: 3, equipe_b_source_type: 'rang_poule'
        });

        // Match places 4-5 : 4e vs 5e — T2 (en parallèle), ou T1 si pas de 2e terrain
        newMatchs.push({
            tournoi_id: currentTournoi.id, phase: 'finale', bracket: 'places_4_5',
            status: 'en_attente', ordre: 1, terrain: nbT >= 2 ? 2 : 1,
            equipe_a_id: null,
            equipe_a_source_poule_id: pouleId, equipe_a_source_ordre: 4, equipe_a_source_type: 'rang_poule',
            equipe_b_id: null,
            equipe_b_source_poule_id: pouleId, equipe_b_source_ordre: 5, equipe_b_source_type: 'rang_poule'
        });

        // La finale (principal/ordre 1) sera créée par genererTourSuivant('principal')
        // automatiquement quand la demi sera terminée (via le hook dans saveScore).

        var res = await supa.from('matchs').insert(newMatchs).select();
        if (res.error) { showToast('Erreur squelette : ' + res.error.message, 'error'); console.error(res.error); return; }
        matchs = matchs.concat(res.data);
        await propagateRangPoule();
    }

    async function genererPhaseFinale() {
        if (guardReadOnly()) return;
        if (!poulesToutesTerminees()) {
            showToast('Toutes les poules doivent être terminées avant la phase finale.', 'error');
            return;
        }

        // Choix du mode
        var modeMaisonDispo = isConfig3p4();
        var mode;
        if (modeMaisonDispo) {
            var choix = prompt(
                'Choisis le format de phase finale :\n\n' +
                '  1 — Générique (seeding standard, bracket adapté à la taille)\n' +
                '  2 — Maison 3p×4 (demi+finale+3/4 + match 5-6, 7-8, 9-10, 11-12)\n\n' +
                'Tape 1 ou 2 :',
                '2'
            );
            if (choix == null) return;
            choix = String(choix).trim();
            if (choix !== '1' && choix !== '2') { showToast('Choix invalide', 'error'); return; }
            mode = choix === '2' ? 'maison_3x4' : 'generique';
        } else {
            mode = 'generique';
        }

        if (matchs.some(function (m) { return m.phase === 'finale'; })) {
            if (!confirm('Des matchs de phase finale existent déjà. Tout regénérer (les scores existants seront perdus) ?')) return;
            await supa.from('matchs').delete().eq('tournoi_id', currentTournoi.id).eq('phase', 'finale');
            matchs = matchs.filter(function (m) { return m.phase !== 'finale'; });
        }

        if (mode === 'maison_3x4') {
            return await genererPhaseFinaleMaison3x4();
        }

        // 1. Calculer le classement global
        var rows = classementGlobal();
        var premiers = rows.filter(function (r) { return r.rang === 1; });
        var deuxiemes = rows.filter(function (r) { return r.rang === 2; });
        var troisiemes = rows.filter(function (r) { return r.rang === 3; });
        var quatriemes = rows.filter(function (r) { return r.rang === 4; });
        var cinqEtPlus = rows.filter(function (r) { return r.rang >= 5; });

        // 2. Trier chaque groupe par stats
        premiers = trierParStats(premiers);
        deuxiemes = trierParStats(deuxiemes);
        troisiemes = trierParStats(troisiemes);
        quatriemes = trierParStats(quatriemes);

        // 3. Constituer le tableau principal : tous les premiers + le meilleur 2e
        var principal = premiers.slice();
        if (deuxiemes.length > 0) {
            principal.push(deuxiemes[0]);
            deuxiemes = deuxiemes.slice(1); // les autres 2es jouent leur propre bracket
        }

        // 4. Préparer les terrains disponibles
        var nbT = currentTournoi.nb_terrains || 1;
        var terrains = [];
        for (var t = 1; t <= nbT; t++) terrains.push(t);

        // 5. Générer le premier round de chaque bracket
        var newMatchs = [];
        newMatchs = newMatchs.concat(buildPremiers(principal, 'principal', terrains));
        if (deuxiemes.length > 0) newMatchs = newMatchs.concat(buildPremiers(deuxiemes, 'rang_2', terrains));
        if (troisiemes.length > 0) newMatchs = newMatchs.concat(buildPremiers(troisiemes, 'rang_3', terrains));
        if (quatriemes.length > 0) newMatchs = newMatchs.concat(buildPremiers(quatriemes, 'rang_4', terrains));
        if (cinqEtPlus.length > 0) {
            // Si poules >= 5 équipes, groupe par rang
            var byRang = {};
            cinqEtPlus.forEach(function (r) { (byRang[r.rang] = byRang[r.rang] || []).push(r); });
            Object.keys(byRang).sort().forEach(function (rang) {
                newMatchs = newMatchs.concat(buildPremiers(trierParStats(byRang[rang]), 'rang_' + rang, terrains));
            });
        }

        if (newMatchs.length === 0) {
            showToast('Aucun match de phase finale à générer.', 'error');
            return;
        }

        var res = await supa.from('matchs').insert(newMatchs).select();
        if (res.error) { showToast('Erreur : ' + res.error.message, 'error'); console.error(res.error); return; }
        matchs = matchs.concat(res.data);
        await updateTournoi({ phase: 'finale' });
        render();
        showToast(res.data.length + ' matchs de phase finale générés', 'ok');
    }

    // Génère le tour suivant d'un bracket dont tous les matchs du tour courant sont termines.
    async function genererTourSuivant(bracket) {
        var bracketMatchs = matchs.filter(function (m) {
            return m.phase === 'finale' && m.bracket === bracket;
        }).sort(function (a, b) { return a.ordre - b.ordre; });

        // Identifier le dernier "round" (= matchs avec le plus grand ordre groupé)
        // Approche simple : le dernier round est celui dont tous les matchs sont 'termine'
        // et qui n'a pas de successeur. On regroupe par paire d'ordres consécutifs.
        var nonTermine = bracketMatchs.filter(function (m) { return m.status !== 'termine' || !m.vainqueur_id; });
        if (nonTermine.length > 0) {
            showToast('Il reste ' + nonTermine.length + ' match(s) non terminés dans ce bracket.', 'error');
            return;
        }

        // Cas barrage (3 équipes) : 1 match initial + 1 match "finale" à créer
        // Le premier round du bracket à 3 a 1 seul match. Le 2e round confronte gagnant vs exempté.
        // Pour détecter ça, on regarde si le bracket a un classement à 3.
        var rows = classementGlobal();
        var rangCible = null;
        if (bracket === 'principal') rangCible = null; // pas barrage
        else if (bracket === 'rang_2') rangCible = 2;
        else if (bracket === 'rang_3') rangCible = 3;
        else if (bracket === 'rang_4') rangCible = 4;
        else if (bracket.indexOf('rang_') === 0) rangCible = parseInt(bracket.split('_')[1], 10);

        var nbT = currentTournoi.nb_terrains || 1;
        var terrains = [];
        for (var t = 1; t <= nbT; t++) terrains.push(t);

        var nextMatchs = [];
        var nextOrdre = bracketMatchs.length;

        // Tableau principal : structure standard bracket à élimination
        if (bracket === 'principal') {
            // Cas spécial 1p×5 : 1 seule demi → créer finale (1er de poule vs vainqueur demi)
            if (bracketMatchs.length === 1 && isConfig1p5()) {
                var demi = bracketMatchs[0];
                // 1er de la poule
                var pouleId = poules[0].id;
                var classement = computeClassement(pouleId);
                var premierId = classement[0] ? classement[0].id : null;
                if (!premierId) {
                    showToast('Impossible de déterminer le 1er de poule pour la finale.', 'error');
                    return;
                }
                nextMatchs.push({
                    phase: 'finale', bracket: bracket,
                    tournoi_id: currentTournoi.id, status: 'en_attente',
                    ordre: nextOrdre++, terrain: terrains[0],
                    equipe_a_id: premierId,
                    equipe_b_id: demi.vainqueur_id
                });
                // pas de match 3/4 : le perdant de la demi est 3e directement
            } else {
            // Si on a fait demi (2 matchs), on doit créer finale + match 3e/4e
            // Si on a fait quart (4 matchs), on doit créer demi (2 matchs)
            var nbMatchsRoundCourant = bracketMatchs.length === 2 ? 2 : (bracketMatchs.length === 4 ? 4 : null);
            // Round courant = dernier round joué
            // On crée le round suivant : N/2 matchs (gagnants) + un match perdants si on est en demi
            var lastRound = bracketMatchs.slice(-nbMatchsRoundCourant);
            if (lastRound.length === 2) {
                // Finale + petite finale
                nextMatchs.push({
                    phase: 'finale', bracket: bracket,
                    tournoi_id: currentTournoi.id, status: 'en_attente',
                    ordre: nextOrdre++, terrain: terrains[0],
                    equipe_a_id: lastRound[0].vainqueur_id,
                    equipe_b_id: lastRound[1].vainqueur_id
                });
                // Petite finale (3e/4e)
                var loser0 = lastRound[0].vainqueur_id === lastRound[0].equipe_a_id ? lastRound[0].equipe_b_id : lastRound[0].equipe_a_id;
                var loser1 = lastRound[1].vainqueur_id === lastRound[1].equipe_a_id ? lastRound[1].equipe_b_id : lastRound[1].equipe_a_id;
                nextMatchs.push({
                    phase: 'finale', bracket: bracket,
                    tournoi_id: currentTournoi.id, status: 'en_attente',
                    ordre: nextOrdre++, terrain: terrains[1 % terrains.length],
                    equipe_a_id: loser0,
                    equipe_b_id: loser1
                });
            } else if (lastRound.length === 4) {
                // Quarts -> Demis (2 matchs)
                nextMatchs.push({
                    phase: 'finale', bracket: bracket,
                    tournoi_id: currentTournoi.id, status: 'en_attente',
                    ordre: nextOrdre++, terrain: terrains[0],
                    equipe_a_id: lastRound[0].vainqueur_id,
                    equipe_b_id: lastRound[3].vainqueur_id
                });
                nextMatchs.push({
                    phase: 'finale', bracket: bracket,
                    tournoi_id: currentTournoi.id, status: 'en_attente',
                    ordre: nextOrdre++, terrain: terrains[1 % terrains.length],
                    equipe_a_id: lastRound[1].vainqueur_id,
                    equipe_b_id: lastRound[2].vainqueur_id
                });
            } else {
                showToast('Tableau principal complet ou format non supporté pour le tour suivant.', 'error');
                return;
            }
            } // fin du else (cas non 1p×5)
        } else if (rangCible != null) {
            // Brackets secondaires : peuvent être à 3 (barrage + finale) ou à 4+ (idem principal sans 3e/4e ?)
            var rangRows = rows.filter(function (r) { return r.rang === rangCible; });
            var sortedRows = trierParStats(rangRows);
            // Pour rang_2, on a déjà retiré le meilleur 2e qualifié principal ; il faut refaire le tri
            if (bracket === 'rang_2') {
                sortedRows = trierParStats(rangRows).slice(1);
            }
            if (sortedRows.length === 3) {
                // Barrage déjà joué -> finale entre exempté et gagnant
                var exempted = sortedRows[0];
                var winnerBarrage = bracketMatchs[0].vainqueur_id;
                var loserBarrage = bracketMatchs[0].vainqueur_id === bracketMatchs[0].equipe_a_id
                    ? bracketMatchs[0].equipe_b_id : bracketMatchs[0].equipe_a_id;
                // Finale du mini bracket
                if (bracketMatchs.length === 1) {
                    nextMatchs.push({
                        phase: 'finale', bracket: bracket,
                        tournoi_id: currentTournoi.id, status: 'en_attente',
                        ordre: nextOrdre++, terrain: terrains[0],
                        equipe_a_id: exempted.equipe_id,
                        equipe_b_id: winnerBarrage
                    });
                    // (Pas de match supplémentaire pour le 3e place : c'est le perdant du barrage)
                } else {
                    showToast('Ce mini-bracket est déjà terminé.', 'error');
                    return;
                }
            } else if (sortedRows.length === 2) {
                // Match unique déjà joué = pas de tour suivant
                showToast('Bracket déjà terminé (2 équipes = 1 seul match).', 'error');
                return;
            } else if (sortedRows.length >= 4) {
                // Même logique que principal mais sans match 3e/4e (on garde simple)
                var nbCourant = bracketMatchs.length === 2 ? 2 : (bracketMatchs.length === 4 ? 4 : null);
                if (!nbCourant) {
                    showToast('Format non supporté pour ce bracket.', 'error');
                    return;
                }
                var lastRound2 = bracketMatchs.slice(-nbCourant);
                if (lastRound2.length === 2) {
                    nextMatchs.push({
                        phase: 'finale', bracket: bracket,
                        tournoi_id: currentTournoi.id, status: 'en_attente',
                        ordre: nextOrdre++, terrain: terrains[0],
                        equipe_a_id: lastRound2[0].vainqueur_id,
                        equipe_b_id: lastRound2[1].vainqueur_id
                    });
                } else if (lastRound2.length === 4) {
                    nextMatchs.push({
                        phase: 'finale', bracket: bracket,
                        tournoi_id: currentTournoi.id, status: 'en_attente',
                        ordre: nextOrdre++, terrain: terrains[0],
                        equipe_a_id: lastRound2[0].vainqueur_id,
                        equipe_b_id: lastRound2[3].vainqueur_id
                    });
                    nextMatchs.push({
                        phase: 'finale', bracket: bracket,
                        tournoi_id: currentTournoi.id, status: 'en_attente',
                        ordre: nextOrdre++, terrain: terrains[1 % terrains.length],
                        equipe_a_id: lastRound2[1].vainqueur_id,
                        equipe_b_id: lastRound2[2].vainqueur_id
                    });
                }
            }
        }

        if (nextMatchs.length === 0) {
            showToast('Rien à générer pour ce tour.', 'error');
            return;
        }
        var res = await supa.from('matchs').insert(nextMatchs).select();
        if (res.error) { showToast('Erreur : ' + res.error.message, 'error'); console.error(res.error); return; }
        matchs = matchs.concat(res.data);
        render();
        showToast(res.data.length + ' match(s) suivants générés', 'ok');
    }

    // Le tour courant d'un bracket est-il complet (donc on peut générer la suite) ?
    function bracketTourComplet(bracket) {
        var b = matchs.filter(function (m) { return m.phase === 'finale' && m.bracket === bracket; });
        if (b.length === 0) return false;
        // Tous terminés et il reste un round à jouer ?
        var allDone = b.every(function (m) { return m.status === 'termine' && m.vainqueur_id; });
        if (!allDone) return false;
        // Heuristique : si le bracket a pour entrants 4 -> 4 puis 2 puis 2 (finale+3e/4e) = 8 matchs total
        // 2 entrants -> 1 match total. 3 entrants -> 2 matchs total.
        // On évalue si le nb de matchs courants est "complet"
        return !bracketEstFini(bracket);
    }

    function bracketEstFini(bracket) {
        var b = matchs.filter(function (m) { return m.phase === 'finale' && m.bracket === bracket; });
        if (b.length === 0) return false;

        // Brackets "places_X_Y" du mode maison : 1 seul match attendu, fini dès qu'il est joué
        if (bracket.indexOf('places_') === 0) {
            return b.every(function (m) { return m.status === 'termine' && m.vainqueur_id; });
        }

        // Mode 1p×5 : principal = 2 matchs au total (demi + finale)
        if (bracket === 'principal' && isConfig1p5()) {
            return b.length >= 2 && b.every(function (m) { return m.status === 'termine' && m.vainqueur_id; });
        }

        // Mode 1p×4 : principal = 1 seul match (la finale), fini dès qu'il est joué
        if (bracket === 'principal' && isConfig1p4()) {
            return b.length >= 1 && b.every(function (m) { return m.status === 'termine' && m.vainqueur_id; });
        }

        var rows = classementGlobal();
        var rangCible = bracket === 'principal' ? null
            : bracket.indexOf('rang_') === 0 ? parseInt(bracket.split('_')[1], 10) : null;

        var entrants;
        if (bracket === 'principal') {
            var prems = trierParStats(rows.filter(function (r) { return r.rang === 1; }));
            var deuxs = trierParStats(rows.filter(function (r) { return r.rang === 2; }));
            entrants = prems.concat(deuxs.length > 0 ? [deuxs[0]] : []);
        } else if (rangCible === 2) {
            entrants = trierParStats(rows.filter(function (r) { return r.rang === 2; })).slice(1);
        } else if (rangCible != null) {
            entrants = trierParStats(rows.filter(function (r) { return r.rang === rangCible; }));
        }
        if (!entrants) return true;

        var n = entrants.length;
        var totalMatchs;
        if (n < 2) totalMatchs = 0;
        else if (n === 2) totalMatchs = 1;
        else if (n === 3) totalMatchs = 2;
        else if (n === 4) totalMatchs = bracket === 'principal' ? 4 : 3; // principal a 3e/4e en plus
        else if (n === 8) totalMatchs = bracket === 'principal' ? 8 : 7;
        else totalMatchs = n - 1; // fallback simple

        return b.length >= totalMatchs;
    }

    // ===== Résolution des dépendances (GM/PM) =====

    // Renvoie l'id d'équipe correspondant à un placeholder, ou null si non encore résolu.
    function resolveSource(pouleId, sourceOrdre, sourceType) {
        if (sourceOrdre == null || !sourceType) return null;
        var src = matchs.find(function (m) {
            return m.poule_id === pouleId && m.phase === 'poule' && m.ordre === sourceOrdre;
        });
        if (!src || src.status !== 'termine' || !src.vainqueur_id) return null;
        if (sourceType === 'gagnant') return src.vainqueur_id;
        // perdant = l'autre équipe
        if (src.equipe_a_id && src.equipe_b_id) {
            return src.vainqueur_id === src.equipe_a_id ? src.equipe_b_id : src.equipe_a_id;
        }
        return null;
    }

    // Pour chaque match dépendant de la poule, met à jour equipe_a_id / equipe_b_id si la source est résolue.
    async function propagateDependencies(pouleId) {
        var updates = [];
        matchs.forEach(function (m) {
            if (m.poule_id !== pouleId || m.phase !== 'poule') return;
            var patch = {};
            if (!m.equipe_a_id && m.equipe_a_source_ordre != null) {
                var resolvedA = resolveSource(pouleId, m.equipe_a_source_ordre, m.equipe_a_source_type);
                if (resolvedA) patch.equipe_a_id = resolvedA;
            }
            if (!m.equipe_b_id && m.equipe_b_source_ordre != null) {
                var resolvedB = resolveSource(pouleId, m.equipe_b_source_ordre, m.equipe_b_source_type);
                if (resolvedB) patch.equipe_b_id = resolvedB;
            }
            if (Object.keys(patch).length > 0) updates.push({ id: m.id, patch: patch });
        });
        for (var i = 0; i < updates.length; i++) {
            var u = updates[i];
            var res = await supa.from('matchs').update(u.patch).eq('id', u.id).select().single();
            if (!res.error) {
                var idx = matchs.findIndex(function (m) { return m.id === u.id; });
                if (idx >= 0) matchs[idx] = res.data;
            }
        }
    }

    // Quand un match est réinitialisé/score effacé : reset les matchs dépendants (cascading).
    async function cascadeReset(pouleId, ordre) {
        var dependants = matchs.filter(function (m) {
            return m.poule_id === pouleId && m.phase === 'poule' && (
                m.equipe_a_source_ordre === ordre || m.equipe_b_source_ordre === ordre
            );
        });
        for (var i = 0; i < dependants.length; i++) {
            var d = dependants[i];
            var patch = {
                status: 'en_attente',
                score_a: null, score_b: null, vainqueur_id: null,
                started_at: null, finished_at: null,
                updated_at: new Date().toISOString()
            };
            if (d.equipe_a_source_ordre === ordre) patch.equipe_a_id = null;
            if (d.equipe_b_source_ordre === ordre) patch.equipe_b_id = null;
            var res = await supa.from('matchs').update(patch).eq('id', d.id).select().single();
            if (!res.error) {
                var idx = matchs.findIndex(function (m) { return m.id === d.id; });
                if (idx >= 0) matchs[idx] = res.data;
                // Cascade récursif
                await cascadeReset(pouleId, d.ordre);
            }
        }
    }

    // ===== Match : actions admin =====

    async function startMatch(matchId) {
        if (guardReadOnly()) return;
        // Arrêter les autres matchs en cours sur le même terrain
        var match = matchs.find(function (m) { return m.id === matchId; });
        if (!match) return;
        var others = matchs.filter(function (m) { return m.terrain === match.terrain && m.status === 'en_cours' && m.id !== matchId; });
        for (var i = 0; i < others.length; i++) {
            await supa.from('matchs').update({ status: 'en_attente', started_at: null }).eq('id', others[i].id);
        }
        var res = await supa.from('matchs').update({
            status: 'en_cours',
            started_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        }).eq('id', matchId).select().single();
        if (res.error) { showToast('Erreur', 'error'); console.error(res.error); return; }
        await loadDetails();
        render();
    }

    async function saveScore(matchId) {
        if (guardReadOnly()) return;
        var scoreA = '', scoreB = '';
        var legacyA = document.getElementById('score-a-' + matchId);
        var legacyB = document.getElementById('score-b-' + matchId);
        if (legacyA && legacyB) {
            // Mode libre / americano : un seul champ par équipe
            scoreA = legacyA.value.trim();
            scoreB = legacyB.value.trim();
        } else {
            // Mode multi-sets : on agrège les inputs par index
            var grid = document.querySelector('.sets-grid[data-match="' + matchId + '"]');
            if (grid) {
                var nb = parseInt(grid.getAttribute('data-nb'), 10) || 0;
                var aVals = [], bVals = [];
                for (var i = 0; i < nb; i++) {
                    var a = grid.querySelector('.set-input-a[data-idx="' + i + '"]');
                    var b = grid.querySelector('.set-input-b[data-idx="' + i + '"]');
                    var va = a ? a.value.trim() : '';
                    var vb = b ? b.value.trim() : '';
                    // Ne pas pousser une manche vide (ex: 3e set non joué)
                    if (va === '' && vb === '') continue;
                    aVals.push(va === '' ? '0' : va);
                    bVals.push(vb === '' ? '0' : vb);
                }
                scoreA = aVals.join(' ');
                scoreB = bVals.join(' ');
            }
        }
        var vainqueurSel = document.getElementById('vainqueur-' + matchId);
        var vainqueurId = vainqueurSel ? vainqueurSel.value || null : null;

        // Validation du score selon le format
        var fmt = currentTournoi && currentTournoi.format_score;
        var validation = validateScore(scoreA, scoreB, fmt);
        if (!validation.ok) {
            showToast('Score invalide : ' + validation.error, 'error');
            return;
        }

        // Auto-déduction du vainqueur si la validation l'a trouvé et qu'aucun n'est sélectionné
        if (!vainqueurId && validation.vainqueurSide) {
            var match = matchs.find(function (m) { return m.id === matchId; });
            if (match) {
                vainqueurId = validation.vainqueurSide === 'a' ? match.equipe_a_id : match.equipe_b_id;
            }
        }
        // Cohérence : si l'admin a choisi un vainqueur, vérifier qu'il correspond au score
        if (vainqueurId && validation.vainqueurSide) {
            var match2 = matchs.find(function (m) { return m.id === matchId; });
            var expectedId = validation.vainqueurSide === 'a' ? match2.equipe_a_id : match2.equipe_b_id;
            if (expectedId && vainqueurId !== expectedId) {
                showToast('Le vainqueur sélectionné ne correspond pas au score saisi.', 'error');
                return;
            }
        }

        var res = await supa.from('matchs').update({
            score_a: scoreA,
            score_b: scoreB,
            vainqueur_id: vainqueurId,
            status: 'termine',
            finished_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        }).eq('id', matchId).select().single();

        if (res.error) { showToast('Erreur : ' + res.error.message, 'error'); console.error(res.error); return; }
        var i = matchs.findIndex(function (m) { return m.id === matchId });
        if (i >= 0) matchs[i] = res.data;

        // Si un vainqueur est désigné, propager aux matchs dépendants de cette poule
        if (vainqueurId && res.data.poule_id) {
            await propagateDependencies(res.data.poule_id);
        }
        // Propager aussi vers le squelette de phase finale si présent
        if (res.data.phase === 'poule') {
            await propagateRangPoule();
        }
        // Auto-générer le tour suivant en phase finale si le round courant est complet
        if (res.data.phase === 'finale' && res.data.bracket) {
            if (bracketTourComplet(res.data.bracket)) {
                try { await genererTourSuivant(res.data.bracket); } catch (err) { console.error(err); }
            }
        }
        render();
        showToast('Score enregistré', 'ok');
    }

    async function resetMatch(matchId) {
        if (guardReadOnly()) return;
        if (!confirm('Réinitialiser ce match (effacer le score) ?\n\n⚠️ Les matchs dépendants de ce résultat seront aussi réinitialisés.')) return;
        var match = matchs.find(function (m) { return m.id === matchId; });
        var res = await supa.from('matchs').update({
            score_a: null, score_b: null, vainqueur_id: null,
            status: 'en_attente', started_at: null, finished_at: null,
            updated_at: new Date().toISOString()
        }).eq('id', matchId).select().single();
        if (res.error) { showToast('Erreur', 'error'); return; }
        var i = matchs.findIndex(function (m) { return m.id === matchId });
        if (i >= 0) matchs[i] = res.data;

        // Cascade reset des matchs dépendants
        if (match && match.poule_id != null) {
            await cascadeReset(match.poule_id, match.ordre);
        }
        // Si on a reset un match de poule, invalider les résolutions de phase finale qui
        // dépendaient potentiellement de cette poule, puis recalculer.
        if (match && match.phase === 'poule') {
            await unresolvePhaseFinale(match.poule_id);
            await propagateRangPoule();
        }
        render();
    }

    // Quand un match de poule est reset, on efface les equipe_*_id des matchs de phase finale
    // en_attente dont la source est cette poule (rang_poule) ou globale (meilleur_2e/autres_2es)
    // si la poule n'est plus complète. Ne touche pas aux matchs déjà démarrés.
    async function unresolvePhaseFinale(pouleIdReset) {
        var pouleEncoreComplete = !matchs.some(function (m) {
            return m.phase === 'poule' && m.poule_id === pouleIdReset && m.status !== 'termine';
        });
        var pouleToujoursOK = pouleEncoreComplete; // si tjs complète, pas de reset

        var matchsFinale = matchs.filter(function (m) {
            return m.phase === 'finale' && m.status === 'en_attente';
        });
        var updates = [];
        matchsFinale.forEach(function (m) {
            var patch = {};
            // Side A
            if (m.equipe_a_id) {
                var tA = m.equipe_a_source_type;
                var pA = m.equipe_a_source_poule_id;
                if (tA === 'rang_poule' && pA === pouleIdReset && !pouleToujoursOK) patch.equipe_a_id = null;
                if ((tA === 'meilleur_2e' || tA === 'autres_2es')) patch.equipe_a_id = null;
            }
            if (m.equipe_b_id) {
                var tB = m.equipe_b_source_type;
                var pB = m.equipe_b_source_poule_id;
                if (tB === 'rang_poule' && pB === pouleIdReset && !pouleToujoursOK) patch.equipe_b_id = null;
                if ((tB === 'meilleur_2e' || tB === 'autres_2es')) patch.equipe_b_id = null;
            }
            if (Object.keys(patch).length > 0) updates.push({ id: m.id, patch: patch });
        });
        for (var i = 0; i < updates.length; i++) {
            var u = updates[i];
            var res = await supa.from('matchs').update(u.patch).eq('id', u.id).select().single();
            if (!res.error) {
                var idx = matchs.findIndex(function (mm) { return mm.id === u.id; });
                if (idx >= 0) matchs[idx] = res.data;
            }
        }
    }

    // ===== Classement manuel =====

    async function setClassementPoule(equipeId, pos) {
        var res = await supa.from('equipes').update({ classement_poule: pos || null }).eq('id', equipeId).select().single();
        if (res.error) { showToast('Erreur', 'error'); return; }
        var i = equipes.findIndex(function (e) { return e.id === equipeId });
        if (i >= 0) equipes[i] = res.data;
        render();
    }

    // ===== Render =====

    function el(tag, attrs, children) {
        var e = document.createElement(tag);
        if (attrs) Object.keys(attrs).forEach(function (k) {
            if (k === 'class') e.className = attrs[k];
            else if (k === 'onclick') e.onclick = attrs[k];
            else if (k === 'onchange') e.onchange = attrs[k];
            else if (k === 'oninput') e.oninput = attrs[k];
            else if (k === 'style') e.style.cssText = attrs[k];
            else if (k === 'html') e.innerHTML = attrs[k];
            else e.setAttribute(k, attrs[k]);
        });
        if (children) {
            (Array.isArray(children) ? children : [children]).forEach(function (c) {
                if (c === null || c === undefined) return;
                if (typeof c === 'string') e.appendChild(document.createTextNode(c));
                else e.appendChild(c);
            });
        }
        return e;
    }

    function render() {
        var root = document.getElementById('tournoi-root');
        if (!root) return;
        root.innerHTML = '';

        if (!currentTournoi) {
            root.appendChild(renderCreate());
        } else {
            root.appendChild(renderHeader());
            root.appendChild(renderTabsBar());
            if (activeTab === 'pointage') {
                root.appendChild(renderPointageSection());
            } else {
                var setup = el('div', { class: 'tournoi-setup-grid' });
                setup.appendChild(renderEquipesSection());
                setup.appendChild(renderPoulesSection());
                root.appendChild(setup);
                root.appendChild(renderMatchsSection());
            }
        }
    }

    function renderTabsBar() {
        var bar = el('div', { class: 'tournoi-tabs' });
        var tabs = [
            { id: 'matchs', label: '🎮 Matchs & poules' },
            { id: 'pointage', label: '📋 Pointage' }
        ];
        tabs.forEach(function (t) {
            var btn = el('button', {
                class: 'tournoi-tab' + (activeTab === t.id ? ' tournoi-tab--active' : ''),
                onclick: function () { activeTab = t.id; render(); }
            }, t.label);
            bar.appendChild(btn);
        });
        // Bouton imprimer à droite
        var spacer = el('div', { class: 'tournoi-tabs-spacer' });
        bar.appendChild(spacer);
        var printBtn = el('button', {
            class: 'btn-live btn-live--outline btn-live--small',
            onclick: function () { window.open('live/tournoi/print/?t=' + currentTournoi.id, '_blank'); },
            title: 'Ouvre une page imprimable (poules + matchs)'
        }, '🖨️ Imprimer / PDF');
        bar.appendChild(printBtn);
        return bar;
    }

    // Renvoie ["Affichage J1", "Affichage J2"] pour le pointage.
    // Si joueurs liés : "Prénom Nom". Sinon fallback split du nom d'équipe sur "/".
    function nomsJoueurs(eq) {
        var j1 = findJoueur(eq.joueur_j1_id);
        var j2 = findJoueur(eq.joueur_j2_id);
        if (j1 || j2) {
            return [
                j1 ? (j1.prenom + ' ' + j1.nom) : 'Joueur 1',
                j2 ? (j2.prenom + ' ' + j2.nom) : 'Joueur 2'
            ];
        }
        var parts = (eq.nom || '').split('/').map(function (s) { return s.trim(); }).filter(Boolean);
        return [parts[0] || 'Joueur 1', parts[1] || 'Joueur 2'];
    }

    function renderPointageSection() {
        var card = el('div', { class: 'tournoi-card' });
        card.appendChild(el('h3', { class: 'tournoi-section-title' }, '📋 Pointage des joueurs'));

        var nbJoueurs = equipes.length * 2;
        var nbPresent = equipes.reduce(function (acc, e) {
            return acc + (e.present_j1 ? 1 : 0) + (e.present_j2 ? 1 : 0);
        }, 0);
        var nbPaye = equipes.reduce(function (acc, e) {
            return acc + (e.paye_j1 ? 1 : 0) + (e.paye_j2 ? 1 : 0);
        }, 0);

        var stats = el('div', { class: 'pointage-stats' });
        stats.appendChild(el('div', { class: 'pointage-stat' }, [
            el('span', { class: 'pointage-stat-label' }, 'Présents'),
            el('span', { class: 'pointage-stat-value' }, nbPresent + ' / ' + nbJoueurs)
        ]));
        stats.appendChild(el('div', { class: 'pointage-stat' }, [
            el('span', { class: 'pointage-stat-label' }, 'Payés'),
            el('span', { class: 'pointage-stat-value' }, nbPaye + ' / ' + nbJoueurs)
        ]));
        card.appendChild(stats);

        if (equipes.length === 0) {
            card.appendChild(el('p', { class: 'tournoi-empty' }, 'Aucune équipe inscrite.'));
            return card;
        }

        // Liste : équipes triées par nom, avec leur poule, et 2 lignes joueurs par carte
        var sorted = equipes.slice().sort(function (a, b) { return a.nom.localeCompare(b.nom); });
        var list = el('div', { class: 'pointage-list' });
        sorted.forEach(function (eq) {
            var p = poules.find(function (po) { return po.id === eq.poule_id; });
            var noms = nomsJoueurs(eq);

            var card2 = el('div', { class: 'pointage-equipe' });
            var head = el('div', { class: 'pointage-equipe-head' });
            head.appendChild(el('span', { class: 'pointage-equipe-nom' }, equipeAffichage(eq)));
            if (p) head.appendChild(el('span', { class: 'pointage-poule' }, p.nom));
            card2.appendChild(head);

            card2.appendChild(renderJoueurRow(eq, 'j1', noms[0]));
            card2.appendChild(renderJoueurRow(eq, 'j2', noms[1]));

            list.appendChild(card2);
        });
        card.appendChild(list);

        return card;
    }

    function renderJoueurRow(eq, suffix, nomJoueur) {
        var presentFlag = 'present_' + suffix;
        var payeFlag = 'paye_' + suffix;
        var on1 = !!eq[presentFlag];
        var on2 = !!eq[payeFlag];

        var row = el('div', { class: 'pointage-joueur' + (on1 ? ' pointage-joueur--present' : '') + (on2 ? ' pointage-joueur--paye' : '') });
        row.appendChild(el('span', { class: 'pointage-joueur-nom' }, nomJoueur));

        var toggles = el('div', { class: 'pointage-toggles' });
        toggles.appendChild(renderJoueurToggle(eq, presentFlag, '✅', 'Présent'));
        toggles.appendChild(renderJoueurToggle(eq, payeFlag, '💰', 'Payé'));
        row.appendChild(toggles);

        return row;
    }

    function renderJoueurToggle(eq, flag, icon, label) {
        var on = !!eq[flag];
        var btn = el('button', {
            class: 'toggle-btn' + (on ? ' toggle-btn--on' : ''),
            onclick: function () {
                setEquipeFlag(eq.id, flag, !on).then(function () { render(); });
            }
        });
        btn.appendChild(el('span', { class: 'toggle-icon' }, icon));
        btn.appendChild(el('span', { class: 'toggle-label' }, label));
        return btn;
    }

    function renderCreate() {
        var wrap = el('div', { class: 'tournoi-create-wrap' });
        var card = el('div', { class: 'tournoi-card tournoi-card--centered' });
        card.appendChild(el('h2', { class: 'tournoi-title' }, '🏆 Créer un tournoi'));
        card.appendChild(el('p', { class: 'tournoi-subtitle', style: 'margin-bottom:1.5rem' }, 'Aucun tournoi actif. Crée-en un nouveau ci-dessous.'));

        var form = el('div', { class: 'tournoi-form' });

        form.appendChild(el('label', { class: 'control-label' }, 'Nom du tournoi'));
        var inputNom = el('input', { type: 'text', class: 'tournoi-input', placeholder: 'Ex: Tournoi Padel sans licence 18/05' });
        form.appendChild(el('div', { class: 'input-group input-group--full' }, inputNom));

        form.appendChild(el('label', { class: 'control-label', style: 'margin-top:1rem' }, 'Date'));
        var inputDate = el('input', { type: 'date', class: 'tournoi-input' });
        form.appendChild(el('div', { class: 'input-group input-group--full' }, inputDate));

        form.appendChild(el('label', { class: 'control-label', style: 'margin-top:1rem' }, 'Nombre de terrains'));
        var inputTerrains = el('input', { type: 'number', min: '1', max: '10', value: '3', class: 'tournoi-input' });
        form.appendChild(el('div', { class: 'input-group' }, inputTerrains));

        form.appendChild(el('label', { class: 'control-label', style: 'margin-top:1rem' }, 'Format de score (FFT Padel 2026)'));
        var selectFormat = el('select', { class: 'tournoi-input' });
        // Formats officiels FFT padel 2026 (A à E) + Americano + Libre
        var fftFormats = [
            { v: 'format_b', label: 'B — 2 sets de 6 jeux + super tie-break à 10' },
            { v: 'format_a', label: 'A — 3 sets de 6 jeux (TB à 7)' },
            { v: 'format_c', label: 'C — 2 sets de 4 jeux + super tie-break à 10' },
            { v: 'format_d', label: 'D — 1 set de 9 jeux (TB à 7)' },
            { v: 'format_e', label: 'E — Super tie-break unique à 10 points' },
            { v: 'americano', label: 'Americano (points cumulés)' },
            { v: 'libre', label: 'Libre (saisie texte personnalisée)' }
        ];
        fftFormats.forEach(function (f) {
            selectFormat.appendChild(el('option', { value: f.v }, f.label));
        });
        form.appendChild(el('div', { class: 'input-group input-group--full' }, selectFormat));

        // Description du format choisi (défaut: B, le plus courant en FFT)
        var formatHint = el('p', { class: 'format-hint' }, getFormatHint('format_b'));
        form.appendChild(formatHint);

        // Checkbox no-ad (point décisif à 40-40)
        var noAdInput = el('input', { type: 'checkbox', id: 'tournoi-no-ad' });
        var noAdLabel = el('label', { class: 'checkbox-row', for: 'tournoi-no-ad' });
        noAdLabel.appendChild(noAdInput);
        noAdLabel.appendChild(el('span', { class: 'checkbox-text' }, 'Point décisif à 40-40 (no-ad)'));
        noAdLabel.appendChild(el('span', { class: 'checkbox-hint' }, 'À 40-40, un seul point décide du jeu — pas d\'avantage. Format plus rapide.'));
        form.appendChild(noAdLabel);

        function updateFormatUI() {
            var v = selectFormat.value;
            formatHint.textContent = getFormatHint(v);
            // No-ad ne s'applique pas à E (super TB), Americano, Libre
            var hideNoAd = (v === 'format_e' || v === 'americano' || v === 'libre');
            noAdLabel.style.display = hideNoAd ? 'none' : '';
            if (hideNoAd) noAdInput.checked = false;
        }
        selectFormat.addEventListener('change', updateFormatUI);
        updateFormatUI();

        // Mode de classement des équipes
        form.appendChild(el('label', { class: 'control-label', style: 'margin-top:1rem' }, 'Mode de classement des équipes'));
        var selectMode = el('select', { class: 'tournoi-input' });
        [
            { v: 'niveau', label: 'Niveau 1-10 (simple)' },
            { v: 'fft', label: 'Points FFT padel (par joueur)' }
        ].forEach(function (m) {
            selectMode.appendChild(el('option', { value: m.v }, m.label));
        });
        form.appendChild(el('div', { class: 'input-group input-group--full' }, selectMode));
        var modeHint = el('p', { class: 'format-hint' }, '');
        form.appendChild(modeHint);
        function updateModeUI() {
            if (selectMode.value === 'fft') {
                modeHint.textContent = 'Tu saisis les points FFT des 2 joueurs par équipe. Le poids de paire (somme) sert à la répartition automatique dans les poules.';
            } else {
                modeHint.textContent = 'Tu saisis un niveau simple 1-10 par équipe (10 = expert). Aucun classement officiel requis.';
            }
        }
        selectMode.addEventListener('change', updateModeUI);
        updateModeUI();

        var btn = el('button', { class: 'btn-live btn-live--primary', style: 'margin-top:1.5rem;width:100%', onclick: createTournoi }, 'Créer le tournoi');
        form.appendChild(btn);
        card.appendChild(form);

        // Stocker refs pour createTournoi()
        els.tNom = inputNom;
        els.tDate = inputDate;
        els.tTerrains = inputTerrains;
        els.tFormat = selectFormat;
        els.tNoAd = noAdInput;
        els.tModeClassement = selectMode;

        wrap.appendChild(card);
        if (closedTournois.length > 0) {
            wrap.appendChild(renderClosedSection());
        }
        if (archivedTournois.length > 0) {
            wrap.appendChild(renderArchivedSection());
        }
        return wrap;
    }

    function renderClosedSection() {
        var card = el('div', { class: 'tournoi-card tournoi-card--archived' });
        card.appendChild(el('h3', { class: 'tournoi-section-title' }, '🔒 Tournois clôturés (' + closedTournois.length + ')'));
        card.appendChild(el('p', { class: 'tournoi-hint' }, 'Visibles côté client en historique. Tu peux les rouvrir si tu veux les modifier, ou les archiver pour les masquer.'));
        var list = el('div', { class: 'archived-list' });
        closedTournois.forEach(function (t) {
            var row = el('div', { class: 'archived-item' });
            var info = el('div', { class: 'archived-info' });
            info.appendChild(el('div', { class: 'archived-nom' }, t.nom));
            var meta = [];
            if (t.date) meta.push('📅 ' + t.date);
            if (t.format_score) meta.push('🎾 ' + t.format_score);
            if (t.no_ad) meta.push('No-ad');
            if (t.mode_classement === 'fft') meta.push('🏅 FFT');
            if (meta.length > 0) info.appendChild(el('div', { class: 'archived-meta' }, meta.join(' · ')));
            row.appendChild(info);
            var actions = el('div', { class: 'archived-actions' });
            actions.appendChild(el('button', {
                class: 'btn-live btn-live--outline btn-live--small',
                onclick: function () { rouvrirTournoi(t.id); },
                title: 'Repasser en actif'
            }, '↺ Rouvrir'));
            actions.appendChild(el('button', {
                class: 'btn-live btn-live--danger btn-live--small',
                onclick: function () { archiverDepuisCloture(t.id); },
                title: 'Retirer de l\'historique public'
            }, '📦 Archiver'));
            row.appendChild(actions);
            list.appendChild(row);
        });
        card.appendChild(list);
        return card;
    }

    function renderArchivedSection() {
        var card = el('div', { class: 'tournoi-card tournoi-card--archived' });
        card.appendChild(el('h3', { class: 'tournoi-section-title' }, '📦 Tournois archivés (' + archivedTournois.length + ')'));
        var list = el('div', { class: 'archived-list' });
        archivedTournois.forEach(function (t) {
            var row = el('div', { class: 'archived-item' });
            var info = el('div', { class: 'archived-info' });
            info.appendChild(el('div', { class: 'archived-nom' }, t.nom));
            var meta = [];
            if (t.date) meta.push('📅 ' + t.date);
            if (t.format_score) meta.push('🎾 ' + t.format_score);
            if (t.no_ad) meta.push('No-ad');
            if (meta.length > 0) info.appendChild(el('div', { class: 'archived-meta' }, meta.join(' · ')));
            row.appendChild(info);
            var actions = el('div', { class: 'archived-actions' });
            actions.appendChild(el('button', {
                class: 'btn-live btn-live--outline btn-live--small',
                onclick: function () { restoreTournoi(t.id); },
                title: 'Remettre actif'
            }, '↺ Restaurer'));
            actions.appendChild(el('button', {
                class: 'btn-live btn-live--danger btn-live--small',
                onclick: function () { deleteTournoiArchive(t.id); },
                title: 'Supprimer définitivement'
            }, '🗑 Supprimer'));
            row.appendChild(actions);
            list.appendChild(row);
        });
        card.appendChild(list);
        return card;
    }

    function getFormatHint(format) {
        switch (format) {
            case 'format_a':
                return 'Format A (FFT) — Format long. 3 sets gagnants de 6 jeux, tie-break classique à 7 points en cas d\'égalité 6-6. Réservé aux grands tournois.';
            case 'format_b':
                return 'Format B (FFT) — Le plus courant en compétition padel. 2 sets gagnants de 6 jeux. Si 1 set partout, super tie-break à 10 points (avec 2 d\'écart).';
            case 'format_c':
                return 'Format C (FFT) — 2 sets gagnants de 4 jeux. Si 1 set partout, super tie-break à 10 points (avec 2 d\'écart). Format court.';
            case 'format_d':
                return 'Format D (FFT) — 1 set unique de 9 jeux, tie-break classique à 7 points si 8-8. Format intermédiaire.';
            case 'format_e':
                return 'Format E (FFT) — Un seul super tie-break à 10 points (avec 2 d\'écart). Format ultra-rapide pour P25 ou formats club.';
            case 'americano':
                return 'Format Americano : on compte les points marqués sur un temps ou un nombre de jeux donné. Saisie libre dans le score.';
            case 'libre':
                return 'Saisie libre : tu écris ce que tu veux dans le score (ex: « 21 » pour des points, « 6-4 6-3 » pour des sets, etc.).';
        }
        return '';
    }

    // ===== Règles de format & validation des scores =====
    // Chaque règle décrit ce qu'un score doit ressembler pour le format choisi.
    // - sets : nombre de sets gagnants requis (null = pas de notion de set classique)
    // - jeux : nombre de jeux pour gagner un set (null = pas de set)
    // - tb : score cible du tie-break dans le set (7 = TB à 6-6 jusqu'à 7, etc.)
    // - superTb : super tie-break (à 10) à la place du set décisif (true/false)
    // - superTbOnly : un seul super tie-break (Format E)
    // - libre : pas de validation
    var FORMAT_RULES = {
        format_a: { sets: 2, jeux: 6, tb: 7,  superTb: false }, // 3 sets gagnants en 6 jeux (donc 2 sets gagnants suffisent)
        format_b: { sets: 2, jeux: 6, tb: 7,  superTb: true  },
        format_c: { sets: 2, jeux: 4, tb: 5,  superTb: true  }, // TB à 4-4 jusqu'à 5
        format_d: { sets: 1, jeux: 9, tb: 7,  superTb: false }, // 1 set en 9 jeux, TB à 8-8 jusqu'à 7
        format_e: { superTbOnly: true },
        americano: { libre: true },
        libre:     { libre: true }
    };

    // Note: pour format_a (3 sets gagnants), on en a besoin = 2 sets gagnants ? FFT 2026 = "3 sets de 6 jeux".
    // 3 sets de 6 jeux = best of 5 ? Ou 2 sets gagnants sur 3 ? Le guide FFT décrit 2 sets gagnants pour A et B.
    // On part sur 2 sets gagnants pour A (sans super TB) = identique à B mais avec 3e set complet en cas de 1-1.

    function formatShortLabel(f) {
        switch (f) {
            case 'format_a': return 'Format A · 3 sets de 6 jeux (TB à 7)';
            case 'format_b': return 'Format B · 2 sets de 6 jeux + super TB à 10';
            case 'format_c': return 'Format C · 2 sets de 4 jeux + super TB à 10';
            case 'format_d': return 'Format D · 1 set de 9 jeux (TB à 7)';
            case 'format_e': return 'Format E · super TB à 10';
            case 'americano': return 'Americano (points cumulés)';
            case 'libre': return 'Libre';
        }
        return f || 'Libre';
    }

    function formatExample(f) {
        switch (f) {
            case 'format_a': return 'Ex : 6-4 6-3  ·  6-7(5) 6-4 6-2';
            case 'format_b': return 'Ex : 6-4 6-3  ·  6-4 4-6 10-7';
            case 'format_c': return 'Ex : 4-2 4-1  ·  4-2 2-4 10-8';
            case 'format_d': return 'Ex : 9-5  ·  9-8(7-4)';
            case 'format_e': return 'Ex : 10-7  ·  12-10';
            case 'americano': return 'Ex : 21  ·  24';
            case 'libre': return '';
        }
        return '';
    }

    // Parse un score brut en liste de "manches" (nombres). Renvoie [] si vide.
    // Sépare sur espaces, slashes, virgules ou points-virgules.
    function parseScoreSides(scoreA, scoreB) {
        var splitter = /[\s,/;]+/;
        var a = (scoreA || '').trim().split(splitter).filter(Boolean);
        var b = (scoreB || '').trim().split(splitter).filter(Boolean);
        return { a: a, b: b };
    }

    // Extrait le score numérique d'une manche, en ignorant un éventuel TB entre parenthèses : "7(5)" -> 7
    function manche(raw) {
        if (raw == null) return NaN;
        var m = String(raw).match(/^(\d+)/);
        return m ? parseInt(m[1], 10) : NaN;
    }

    // Détermine si un set [a, b] est gagné selon les règles données.
    // Renvoie 'a', 'b' ou null (set non terminé / invalide).
    function setWinner(a, b, rule) {
        if (isNaN(a) || isNaN(b)) return null;
        var target = rule.jeux;
        var tbCap = rule.tb;     // valeur max du jeu décisif (ex: 7)
        var tbAt = target;        // TB joué à target-target (ex: 6-6 ou 4-4 ou 8-8 pour set de 9)
        // Cas particulier set de 9 : TB se joue à 8-8 jusqu'à 7
        if (target === 9) tbAt = 8;
        // Victoire classique : atteint target avec 2 d'écart
        if (a >= target && a - b >= 2) return 'a';
        if (b >= target && b - a >= 2) return 'b';
        // Victoire au TB : tbAt+1 à tbAt
        if (a === tbCap && b === tbAt) return 'a';
        if (b === tbCap && a === tbAt) return 'b';
        return null;
    }

    // Valide un score complet. Renvoie { ok, error, vainqueurSide } (side = 'a' | 'b' | null)
    function validateScore(scoreA, scoreB, format) {
        var rule = FORMAT_RULES[format] || FORMAT_RULES.libre;
        if (rule.libre) return { ok: true, vainqueurSide: null };

        var sides = parseScoreSides(scoreA, scoreB);
        if (sides.a.length !== sides.b.length) {
            return { ok: false, error: 'Le nombre de manches est différent côté A (' + sides.a.length + ') et côté B (' + sides.b.length + ').' };
        }
        if (sides.a.length === 0) {
            return { ok: false, error: 'Saisis au moins une manche.' };
        }

        // === Format E : un seul super tie-break à 10 ===
        if (rule.superTbOnly) {
            if (sides.a.length !== 1) return { ok: false, error: 'Format E : une seule valeur attendue (super TB).' };
            var a = manche(sides.a[0]); var b = manche(sides.b[0]);
            if (isNaN(a) || isNaN(b)) return { ok: false, error: 'Score invalide.' };
            if (Math.max(a, b) < 10) return { ok: false, error: 'Super TB : il faut au moins 10 points pour gagner.' };
            if (Math.abs(a - b) < 2) return { ok: false, error: 'Super TB : 2 points d\'écart requis.' };
            return { ok: true, vainqueurSide: a > b ? 'a' : 'b' };
        }

        // === Formats A, B, C, D ===
        var setsGagnesA = 0, setsGagnesB = 0;
        var setsRequis = rule.sets;
        var setRule = { jeux: rule.jeux, tb: rule.tb };
        var n = sides.a.length;

        for (var i = 0; i < n; i++) {
            var aRaw = manche(sides.a[i]);
            var bRaw = manche(sides.b[i]);
            if (isNaN(aRaw) || isNaN(bRaw)) {
                return { ok: false, error: 'Manche ' + (i + 1) + ' : valeurs non numériques.' };
            }

            // Cas du super tie-break en dernière manche (format B, C)
            var isLastAndSuperTb = rule.superTb && (i === n - 1) && setsGagnesA === setsRequis - 1 && setsGagnesB === setsRequis - 1;
            if (isLastAndSuperTb) {
                if (Math.max(aRaw, bRaw) < 10) return { ok: false, error: 'Super TB final : il faut au moins 10 points.' };
                if (Math.abs(aRaw - bRaw) < 2) return { ok: false, error: 'Super TB final : 2 points d\'écart requis.' };
                if (aRaw > bRaw) setsGagnesA++; else setsGagnesB++;
                break;
            }

            var w = setWinner(aRaw, bRaw, setRule);
            if (!w) {
                return {
                    ok: false,
                    error: 'Manche ' + (i + 1) + ' (' + aRaw + '-' + bRaw + ') : score non valide pour un set de ' + rule.jeux + ' jeux (TB à ' + rule.tb + ').'
                };
            }
            if (w === 'a') setsGagnesA++; else setsGagnesB++;

            // Si quelqu'un a déjà atteint le nb de sets gagnants requis, le match est fini.
            if (setsGagnesA === setsRequis || setsGagnesB === setsRequis) {
                if (i !== n - 1) {
                    return { ok: false, error: 'Le match est gagné au set ' + (i + 1) + ', mais d\'autres sets ont été saisis.' };
                }
                break;
            }
        }

        if (setsGagnesA < setsRequis && setsGagnesB < setsRequis) {
            return {
                ok: false,
                error: 'Match incomplet : il faut ' + setsRequis + ' sets gagnants. Actuel : ' + setsGagnesA + '-' + setsGagnesB + '.'
            };
        }

        return { ok: true, vainqueurSide: setsGagnesA > setsGagnesB ? 'a' : 'b' };
    }

    // ===== Calcul du classement de poule en temps réel =====
    // Critères : victoires (desc) > diff sets (desc) > diff jeux (desc) > nom (asc)
    function computeClassement(pouleId) {
        var eqs = equipes.filter(function (e) { return e.poule_id === pouleId; });
        var stats = {};
        eqs.forEach(function (e) {
            stats[e.id] = { id: e.id, nom: equipeAffichage(e), mj: 0, v: 0, d: 0, sg: 0, sp: 0, jg: 0, jp: 0 };
        });
        var fmt = currentTournoi && currentTournoi.format_score;
        var rule = FORMAT_RULES[fmt] || FORMAT_RULES.libre;

        var matchsPoule = matchs.filter(function (m) {
            return m.poule_id === pouleId && m.phase === 'poule' && m.status === 'termine';
        });

        matchsPoule.forEach(function (m) {
            if (!stats[m.equipe_a_id] || !stats[m.equipe_b_id]) return;
            stats[m.equipe_a_id].mj++; stats[m.equipe_b_id].mj++;

            // Victoire / défaite
            if (m.vainqueur_id === m.equipe_a_id) { stats[m.equipe_a_id].v++; stats[m.equipe_b_id].d++; }
            else if (m.vainqueur_id === m.equipe_b_id) { stats[m.equipe_b_id].v++; stats[m.equipe_a_id].d++; }

            // Sets et jeux (si le format les utilise)
            if (!rule.libre && !rule.superTbOnly) {
                var sides = parseScoreSides(m.score_a, m.score_b);
                var n = Math.min(sides.a.length, sides.b.length);
                for (var i = 0; i < n; i++) {
                    var aRaw = manche(sides.a[i]);
                    var bRaw = manche(sides.b[i]);
                    if (isNaN(aRaw) || isNaN(bRaw)) continue;
                    stats[m.equipe_a_id].jg += aRaw; stats[m.equipe_a_id].jp += bRaw;
                    stats[m.equipe_b_id].jg += bRaw; stats[m.equipe_b_id].jp += aRaw;
                    if (aRaw > bRaw) { stats[m.equipe_a_id].sg++; stats[m.equipe_b_id].sp++; }
                    else if (bRaw > aRaw) { stats[m.equipe_b_id].sg++; stats[m.equipe_a_id].sp++; }
                }
            }
        });

        var arr = Object.keys(stats).map(function (k) { return stats[k]; });
        arr.sort(function (a, b) {
            if (b.v !== a.v) return b.v - a.v;
            var dsA = a.sg - a.sp, dsB = b.sg - b.sp;
            if (dsB !== dsA) return dsB - dsA;
            var djA = a.jg - a.jp, djB = b.jg - b.jp;
            if (djB !== djA) return djB - djA;
            return a.nom.localeCompare(b.nom);
        });
        // Position
        arr.forEach(function (s, i) { s.pos = i + 1; });
        return arr;
    }

    // Durée moyenne d'un match en minutes selon le format de score
    function dureeMatchMin(format, noAd) {
        var base;
        switch (format) {
            case 'format_a': base = 50; break;
            case 'format_b': base = 40; break;
            case 'format_c': base = 25; break;
            case 'format_d': base = 30; break;
            case 'format_e': base = 15; break;
            case 'americano': base = 30; break;
            default: base = 30; break;
        }
        if (noAd) base = Math.round(base * 0.9); // -10% en no-ad
        return base;
    }

    // Estime la durée totale restante en minutes (matchs non terminés × durée / nb terrains utilisables)
    function dureeTotaleEstimee() {
        var dureeM = dureeMatchMin(currentTournoi.format_score, currentTournoi.no_ad);
        var aJouer = matchs.filter(function (m) { return m.status !== 'termine'; });
        if (aJouer.length === 0) return 0;
        // Si une seule poule : on est limité à 2 terrains en parallèle au max
        var seulePoule = poules.length === 1;
        var nbTerrains = currentTournoi.nb_terrains || 1;
        var paralleles = seulePoule ? Math.min(2, nbTerrains) : nbTerrains;
        // Cas dégradé : 0 paralleles → on prend 1
        if (paralleles < 1) paralleles = 1;
        // Une "vague" = paralleles matchs en parallèle. Mais on a aussi des dépendances (matchs finale
        // dépendant des matchs poule). Approche grossière : on suppose qu'on peut paralléliser au max.
        var vagues = Math.ceil(aJouer.length / paralleles);
        return vagues * dureeM;
    }

    function formatDureeMin(min) {
        if (min < 60) return min + ' min';
        var h = Math.floor(min / 60);
        var r = min % 60;
        return r === 0 ? h + 'h' : h + 'h' + (r < 10 ? '0' + r : r);
    }

    async function updateNbTerrains(nouv) {
        if (guardReadOnly()) return;
        var n = parseInt(nouv, 10);
        if (isNaN(n) || n < 1 || n > 10) { showToast('Nb terrains entre 1 et 10', 'error'); return; }
        var res = await supa.from('tournois').update({ nb_terrains: n, updated_at: new Date().toISOString() }).eq('id', currentTournoi.id).select().single();
        if (res.error) { showToast('Erreur : ' + res.error.message, 'error'); return; }
        currentTournoi = res.data;
        render();
        showToast('Nb terrains : ' + n, 'ok');
    }

    function renderHeader() {
        var card = el('div', { class: 'tournoi-card tournoi-header' });
        var info = el('div');
        info.appendChild(el('h2', { class: 'tournoi-title' }, currentTournoi.nom));
        var meta = el('p', { class: 'tournoi-subtitle' });
        var fmtLabel = currentTournoi.format_score ? formatShortLabel(currentTournoi.format_score) : null;
        var parts = [];
        if (currentTournoi.date) parts.push('📅 ' + currentTournoi.date);
        parts.push('Phase : <strong>' + currentTournoi.phase + '</strong>');
        if (fmtLabel) parts.push('🎾 <strong>' + fmtLabel + '</strong>');
        if (currentTournoi.no_ad) parts.push('<strong>No-ad</strong>');
        if (currentTournoi.mode_classement === 'fft') parts.push('🏅 <strong>FFT</strong>');
        if (currentTournoi.status === 'cloture') parts.push('<strong class="readonly-badge">🔒 Clôturé</strong>');
        // Estimation de durée restante (matchs non terminés)
        var dureeMin = dureeTotaleEstimee();
        if (dureeMin > 0) {
            parts.push('⏱️ <strong>~' + formatDureeMin(dureeMin) + '</strong> restantes');
        }
        meta.innerHTML = parts.join(' · ');
        info.appendChild(meta);

        // Widget terrain éditable (sur sa propre ligne pour rester lisible)
        var terrainLine = el('div', { class: 'tournoi-terrain-edit' });
        terrainLine.appendChild(el('span', null, '🏟️ '));
        var inpT = el('input', {
            type: 'number', min: '1', max: '10',
            value: currentTournoi.nb_terrains,
            class: 'tournoi-input tournoi-input--mini',
            style: 'width:4rem',
            onchange: function (e) { updateNbTerrains(e.target.value); }
        });
        terrainLine.appendChild(inpT);
        terrainLine.appendChild(el('span', { class: 'tournoi-terrain-edit-label' }, 'terrain' + (currentTournoi.nb_terrains > 1 ? 's' : '') + ' disponibles'));
        info.appendChild(terrainLine);

        card.appendChild(info);

        var actions = el('div', { class: 'tournoi-actions' });
        actions.appendChild(el('button', { class: 'btn-live btn-live--outline btn-live--small', onclick: function () { window.open('live/tournoi/', '_blank'); } }, '👀 Vue client'));
        actions.appendChild(el('button', {
            class: 'btn-live btn-live--outline btn-live--small',
            onclick: function () {
                if (window.TournoiQR) {
                    var url = window.location.origin + '/live/tournoi/';
                    window.TournoiQR.open(url, 'Tournoi : ' + (currentTournoi.nom || ''));
                }
            },
            title: 'QR code à scanner par les joueurs / spectateurs'
        }, '📱 QR code'));
        actions.appendChild(el('button', { class: 'btn-live btn-live--primary btn-live--small', onclick: cloturerTournoi, title: 'Verrouiller le tournoi (visible côté client en historique)' }, '🔒 Clôturer'));
        actions.appendChild(el('button', { class: 'btn-live btn-live--danger btn-live--small', onclick: archiveTournoi }, 'Archiver'));
        card.appendChild(actions);

        return card;
    }

    function makeDraggableEquipe(item, eq) {
        item.setAttribute('draggable', 'true');
        item.dataset.equipeId = eq.id;
        item.addEventListener('dragstart', function (e) {
            e.dataTransfer.setData('text/plain', String(eq.id));
            e.dataTransfer.effectAllowed = 'move';
            item.classList.add('dragging');
        });
        item.addEventListener('dragend', function () {
            item.classList.remove('dragging');
        });
    }

    function makeDropZonePoule(zone, pouleId) {
        zone.addEventListener('dragover', function (e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            zone.classList.add('drop-target');
        });
        zone.addEventListener('dragleave', function (e) {
            if (e.target === zone) zone.classList.remove('drop-target');
        });
        zone.addEventListener('drop', function (e) {
            e.preventDefault();
            zone.classList.remove('drop-target');
            var equipeId = e.dataTransfer.getData('text/plain');
            if (!equipeId) return;
            // Préserver le type original (string si UUID, number si int)
            var eq = equipes.find(function (x) { return String(x.id) === equipeId; });
            if (!eq) return;
            if (eq.poule_id === pouleId) return; // no-op
            assignEquipePoule(eq.id, pouleId);
        });
    }

    function makeNiveauInput(eq) {
        // En mode FFT, on rend un widget à 2 inputs (J1+J2) + un badge de poids
        if (currentTournoi && currentTournoi.mode_classement === 'fft') {
            return makeFFTInputs(eq);
        }
        var input = el('input', {
            type: 'number', min: '1', max: '10',
            class: 'tournoi-input tournoi-input--mini niveau-input',
            value: eq.niveau != null ? eq.niveau : '',
            placeholder: '–',
            title: 'Niveau padel 1 → 10 (10 = expert)',
            onchange: function (e) { setEquipeNiveau(eq.id, e.target.value); }
        });
        // Empêche le drag depuis l'input (sinon on glisse l'équipe en éditant le niveau)
        input.addEventListener('mousedown', function (e) { e.stopPropagation(); });
        input.setAttribute('draggable', 'false');
        return input;
    }

    function makeFFTInputs(eq) {
        var wrap = el('div', { class: 'fft-points-wrap' });
        var inp1 = el('input', {
            type: 'number', min: '0',
            class: 'tournoi-input tournoi-input--mini fft-points-input',
            value: eq.points_j1 != null ? eq.points_j1 : '',
            placeholder: 'J1',
            title: 'Points FFT joueur 1',
            onchange: function (e) {
                setEquipePoints(eq.id, 'points_j1', e.target.value).then(function () { updateBadge(); });
            }
        });
        var inp2 = el('input', {
            type: 'number', min: '0',
            class: 'tournoi-input tournoi-input--mini fft-points-input',
            value: eq.points_j2 != null ? eq.points_j2 : '',
            placeholder: 'J2',
            title: 'Points FFT joueur 2',
            onchange: function (e) {
                setEquipePoints(eq.id, 'points_j2', e.target.value).then(function () { updateBadge(); });
            }
        });
        var badge = el('span', { class: 'fft-poids-badge', title: 'Poids de paire (somme)' }, '');
        function updateBadge() {
            var eqMaj = equipes.find(function (e2) { return e2.id === eq.id; }) || eq;
            var p = equipePoids(eqMaj);
            badge.textContent = p == null ? '–' : String(p);
        }
        updateBadge();
        [inp1, inp2].forEach(function (i) {
            i.addEventListener('mousedown', function (e) { e.stopPropagation(); });
            i.setAttribute('draggable', 'false');
            wrap.appendChild(i);
        });
        wrap.appendChild(badge);
        return wrap;
    }

    function renderEquipesSection() {
        var card = el('div', { class: 'tournoi-card tournoi-card--equipes' });
        var unassigned = equipes.filter(function (e) { return !e.poule_id; });
        card.appendChild(el('h3', { class: 'tournoi-section-title' }, '👥 Équipes (' + equipes.length + ')'));
        card.appendChild(el('p', { class: 'tournoi-hint' }, '💡 Saisis un niveau (1-10) pour chaque équipe puis clique « Répartir » pour créer les poules automatiquement. Tu peux aussi glisser-déposer.'));

        // Form ajout équipe (2 joueurs : nom + prénom chacun)
        // On utilise un datalist partagé pour autocomplete sur les joueurs existants
        var datalistNoms = el('datalist', { id: 'joueurs-noms' });
        var datalistPrenoms = el('datalist', { id: 'joueurs-prenoms' });
        var nomsSet = {}, prenomsSet = {};
        joueurs.forEach(function (j) {
            if (j.nom && !nomsSet[j.nom]) { nomsSet[j.nom] = true; datalistNoms.appendChild(el('option', { value: j.nom })); }
            if (j.prenom && !prenomsSet[j.prenom]) { prenomsSet[j.prenom] = true; datalistPrenoms.appendChild(el('option', { value: j.prenom })); }
        });
        card.appendChild(datalistNoms);
        card.appendChild(datalistPrenoms);

        var addForm = el('div', { class: 'add-equipe-form' });
        var rowJ1 = el('div', { class: 'add-equipe-row' });
        var inpNom1 = el('input', { type: 'text', class: 'tournoi-input', placeholder: 'Nom J1', list: 'joueurs-noms' });
        var inpPrenom1 = el('input', { type: 'text', class: 'tournoi-input', placeholder: 'Prénom J1', list: 'joueurs-prenoms' });
        rowJ1.appendChild(el('span', { class: 'add-equipe-label' }, 'J1'));
        rowJ1.appendChild(inpNom1);
        rowJ1.appendChild(inpPrenom1);
        addForm.appendChild(rowJ1);

        var rowJ2 = el('div', { class: 'add-equipe-row' });
        var inpNom2 = el('input', { type: 'text', class: 'tournoi-input', placeholder: 'Nom J2', list: 'joueurs-noms' });
        var inpPrenom2 = el('input', { type: 'text', class: 'tournoi-input', placeholder: 'Prénom J2', list: 'joueurs-prenoms' });
        rowJ2.appendChild(el('span', { class: 'add-equipe-label' }, 'J2'));
        rowJ2.appendChild(inpNom2);
        rowJ2.appendChild(inpPrenom2);
        addForm.appendChild(rowJ2);

        // Submit on Enter dans le dernier champ
        inpPrenom2.addEventListener('keydown', function (e) { if (e.key === 'Enter') addEquipe(); });

        var btnAdd = el('button', { class: 'btn-live btn-live--primary btn-live--small', onclick: addEquipe, style: 'width:100%;margin-top:0.5rem' }, '+ Ajouter l\'équipe');
        addForm.appendChild(btnAdd);
        card.appendChild(addForm);
        els.eqNomJ1 = inpNom1;
        els.eqPrenomJ1 = inpPrenom1;
        els.eqNomJ2 = inpNom2;
        els.eqPrenomJ2 = inpPrenom2;

        // Bouton répartir par niveau (visible dès qu'il y a au moins une poule)
        if (poules.length > 0 && equipes.length > 0) {
            card.appendChild(el('button', {
                class: 'btn-live btn-live--outline btn-live--small',
                style: 'margin-top:0.75rem;width:100%',
                onclick: repartirParNiveau,
                title: 'Répartir automatiquement les équipes dans les poules selon leur niveau'
            }, '🎯 Répartir par niveau'));
        }

        // Sous-titre + zone de dépôt pour "désassigner"
        var sub = el('div', { class: 'equipes-sub-head' });
        sub.appendChild(el('span', null, 'Non assignées (' + unassigned.length + ')'));
        card.appendChild(sub);

        var unassignedZone = el('div', { class: 'equipes-list equipes-list--dropzone' });
        makeDropZonePoule(unassignedZone, null);

        if (unassigned.length === 0) {
            unassignedZone.appendChild(el('p', { class: 'poule-empty' }, equipes.length === 0
                ? 'Aucune équipe. Ajoute-en ci-dessus.'
                : 'Toutes les équipes sont assignées. Dépose ici pour retirer d\'une poule.'));
        } else {
            // Tri par niveau desc pour mettre les plus forts en haut
            var sortedUnassigned = unassigned.slice().sort(function (a, b) {
                var na = a.niveau == null ? -1 : a.niveau;
                var nb = b.niveau == null ? -1 : b.niveau;
                if (nb !== na) return nb - na;
                return a.nom.localeCompare(b.nom);
            });
            sortedUnassigned.forEach(function (eq) {
                var item = el('div', { class: 'equipe-item equipe-item--draggable' });
                item.appendChild(el('span', { class: 'drag-handle', title: 'Glisser' }, '⋮⋮'));
                item.appendChild(el('span', { class: 'equipe-nom' }, equipeAffichage(eq)));
                item.appendChild(makeNiveauInput(eq));
                item.appendChild(el('button', { class: 'icon-btn icon-btn--danger', onclick: function () { deleteEquipe(eq.id); }, title: 'Supprimer' }, '🗑'));
                makeDraggableEquipe(item, eq);
                unassignedZone.appendChild(item);
            });
        }
        card.appendChild(unassignedZone);

        return card;
    }

    function renderPoulesSection() {
        var card = el('div', { class: 'tournoi-card' });
        card.appendChild(el('h3', { class: 'tournoi-section-title' }, '🎾 Poules (' + poules.length + ')'));

        // Form ajout poule
        var addForm = el('div', { class: 'setup-row' });
        var inputNomP = el('input', { type: 'text', class: 'tournoi-input', placeholder: 'Nom poule (ex: Poule A)', value: 'Poule ' + String.fromCharCode(65 + poules.length) });
        inputNomP.addEventListener('keydown', function (e) { if (e.key === 'Enter') addPoule(); });
        addForm.appendChild(el('div', { class: 'input-group' }, inputNomP));

        var inputTer = el('input', { type: 'number', min: '1', max: currentTournoi.nb_terrains, value: (poules.length % currentTournoi.nb_terrains) + 1, class: 'tournoi-input', style: 'width:5rem' });
        addForm.appendChild(el('div', { class: 'input-group' }, [inputTer, el('label', null, 'terrain')]));
        addForm.appendChild(el('button', { class: 'btn-live btn-live--primary btn-live--small', onclick: addPoule }, '+ Ajouter'));
        card.appendChild(addForm);
        els.pNom = inputNomP;
        els.pTerrain = inputTer;

        // Liste poules + équipes dedans
        if (poules.length > 0) {
            var grid = el('div', { class: 'poules-grid' });
            poules.forEach(function (p) {
                var pcard = el('div', { class: 'poule-card' });
                var head = el('div', { class: 'poule-head' });
                head.appendChild(el('h4', { class: 'poule-nom' }, p.nom));

                var terInput = el('input', { type: 'number', min: '1', value: p.terrain || '', class: 'tournoi-input tournoi-input--mini', placeholder: 'T?', style: 'width:3.5rem', onchange: function (e) { updatePouleTerrain(p.id, parseInt(e.target.value)); } });
                head.appendChild(el('div', { class: 'poule-terrain' }, [el('span', null, 'Terrain '), terInput]));

                head.appendChild(el('button', { class: 'icon-btn icon-btn--danger', onclick: function () { deletePoule(p.id); }, title: 'Supprimer' }, '🗑'));
                pcard.appendChild(head);

                // Équipes de la poule (zone de drop)
                var eqs = equipes.filter(function (e) { return e.poule_id === p.id; });
                var elist = el('div', { class: 'poule-equipes poule-equipes--dropzone' });
                makeDropZonePoule(elist, p.id);
                if (eqs.length === 0) {
                    elist.appendChild(el('p', { class: 'poule-empty' }, 'Dépose une équipe ici'));
                } else {
                    // Classement calculé en temps réel
                    var classement = computeClassement(p.id);
                    var classementByEq = {};
                    classement.forEach(function (s) { classementByEq[s.id] = s; });
                    // Trier les équipes selon le classement (les non classées à la fin)
                    var eqsOrdonnees = eqs.slice().sort(function (a, b) {
                        var sa = classementByEq[a.id], sb = classementByEq[b.id];
                        return (sa ? sa.pos : 999) - (sb ? sb.pos : 999);
                    });
                    eqsOrdonnees.forEach(function (eq) {
                        var s = classementByEq[eq.id];
                        var row = el('div', { class: 'poule-equipe-item equipe-item--draggable' });
                        row.appendChild(el('span', { class: 'drag-handle', title: 'Glisser' }, '⋮⋮'));
                        if (s && s.mj > 0) {
                            row.appendChild(el('span', { class: 'poule-pos-badge', title: 'Position calculée' }, '#' + s.pos));
                        }
                        row.appendChild(el('span', { class: 'equipe-nom' }, equipeAffichage(eq)));
                        if (s && s.mj > 0) {
                            row.appendChild(el('span', { class: 'poule-stats', title: 'V-D · diff sets · diff jeux' },
                                s.v + '-' + s.d + ' · ' + ((s.sg - s.sp) >= 0 ? '+' : '') + (s.sg - s.sp)
                            ));
                        } else {
                            row.appendChild(makeNiveauInput(eq));
                        }
                        makeDraggableEquipe(row, eq);
                        elist.appendChild(row);
                    });
                }
                pcard.appendChild(elist);
                grid.appendChild(pcard);
            });
            card.appendChild(grid);

            // Bouton générer
            card.appendChild(el('button', {
                class: 'btn-live btn-live--primary',
                style: 'margin-top:1rem;width:100%',
                onclick: genererMatchsPoules
            }, '⚡ Générer les matchs de poule (round-robin)'));
        }

        return card;
    }

    // === Tableau récap des classements de poule (admin) ===
    function renderClassementsPoulesAdmin() {
        var fmt = currentTournoi && currentTournoi.format_score;
        var rule = FORMAT_RULES[fmt] || FORMAT_RULES.libre;
        var showSets = !rule.libre && !rule.superTbOnly;

        var wrap = el('div', { class: 'phase-section' });
        wrap.appendChild(el('h4', { class: 'phase-section-title' }, '📊 Classements de poule'));
        var grid = el('div', { class: 'classements-poules-grid' });
        poules.slice().sort(function (a, b) { return a.ordre - b.ordre; }).forEach(function (p) {
            var pcard = el('div', { class: 'classement-poule-card' });
            pcard.appendChild(el('h5', { class: 'classement-poule-title' }, p.nom));
            var classement = computeClassement(p.id);
            if (classement.length === 0) {
                pcard.appendChild(el('p', { class: 'poule-empty' }, '— aucune équipe —'));
                grid.appendChild(pcard);
                return;
            }
            var table = el('table', { class: 'poule-live-table' });
            var thead = el('tr', { class: 'poule-live-thead' });
            thead.appendChild(el('th', null, '#'));
            thead.appendChild(el('th', { style: 'text-align:left' }, 'Équipe'));
            thead.appendChild(el('th', { title: 'Matchs joués' }, 'MJ'));
            thead.appendChild(el('th', { title: 'Victoires' }, 'V'));
            if (showSets) thead.appendChild(el('th', { title: 'Diff. sets' }, '±S'));
            if (showSets) thead.appendChild(el('th', { title: 'Diff. jeux' }, '±J'));
            table.appendChild(thead);
            classement.forEach(function (s) {
                var row = el('tr');
                row.appendChild(el('td', { class: 'poule-pos' }, s.mj > 0 ? '#' + s.pos : '·'));
                row.appendChild(el('td', { class: 'poule-eq' }, s.nom));
                row.appendChild(el('td', { class: 'poule-stat' }, String(s.mj)));
                row.appendChild(el('td', { class: 'poule-stat poule-stat--v' }, String(s.v)));
                if (showSets) {
                    var ds = s.sg - s.sp;
                    row.appendChild(el('td', { class: 'poule-stat' }, (ds >= 0 ? '+' : '') + ds));
                }
                if (showSets) {
                    var dj = s.jg - s.jp;
                    row.appendChild(el('td', { class: 'poule-stat' }, (dj >= 0 ? '+' : '') + dj));
                }
                table.appendChild(row);
            });
            pcard.appendChild(table);
            grid.appendChild(pcard);
        });
        wrap.appendChild(grid);
        return wrap;
    }

    // === Classement final générique ===
    // Reconstruit les places à partir des brackets de phase finale présents.
    // Renvoie un tableau ordonné de { place, equipe_id, nom }. Slots non résolus = nom null.
    function computeClassementFinal() {
        var byBracket = {};
        matchs.filter(function (m) { return m.phase === 'finale'; }).forEach(function (m) {
            (byBracket[m.bracket] = byBracket[m.bracket] || []).push(m);
        });
        Object.keys(byBracket).forEach(function (k) {
            byBracket[k].sort(function (a, b) { return a.ordre - b.ordre; });
        });

        var nomFor = function (id) {
            if (!id) return null;
            var e = equipes.find(function (x) { return x.id === id; });
            return e ? e.nom : null;
        };
        var winnerOf = function (m) {
            if (!m || m.status !== 'termine' || !m.vainqueur_id) return null;
            return m.vainqueur_id;
        };
        var loserOf = function (m) {
            if (!m || m.status !== 'termine' || !m.vainqueur_id) return null;
            return m.vainqueur_id === m.equipe_a_id ? m.equipe_b_id : m.equipe_a_id;
        };

        // Identifie les "entrants distincts" d'un bracket en regardant les matchs du premier round.
        // Retourne la liste d'ids (ou null pour les slots non résolus) — utilisé pour estimer
        // combien de places le bracket couvre.
        var entrantsBracket = function (ms) {
            var ids = new Set();
            var hasUnresolved = false;
            ms.forEach(function (m) {
                if (m.equipe_a_id) ids.add(m.equipe_a_id); else hasUnresolved = true;
                if (m.equipe_b_id) ids.add(m.equipe_b_id); else hasUnresolved = true;
            });
            // Si tous les matchs ont 2 équipes assignées : on a un compte exact des entrants directs.
            // Pour un bracket avec finale 'cachée' (round 2), on ne la compte pas.
            // Heuristique : on regarde le 1er round = matchs sans match précédent qui les alimente.
            return { count: ids.size + (hasUnresolved ? 0 : 0), hasUnresolved: hasUnresolved };
        };

        // Place une paire (gagnant/perdant) d'un match unique
        var pairPlaces = function (m, placeWin, placeLose, into) {
            into.push({ place: placeWin, equipe_id: winnerOf(m), nom: nomFor(winnerOf(m)) });
            into.push({ place: placeLose, equipe_id: loserOf(m), nom: nomFor(loserOf(m)) });
        };

        // Calcule les places couvertes par un bracket de N entrants (4 → 1-4, 3 → 1-3, 2 → 1-2, etc.)
        // En posant un offset = place de départ.
        // Retourne un array de { place, equipe_id, nom } pour ce bracket.
        var placesPourBracket = function (ms, offset, isPrincipal) {
            var out = [];
            if (ms.length === 0) return out;

            // Compter les équipes distinctes mentionnées sur les faces (ids + placeholders)
            // pour estimer la taille du bracket. Avec 2 demis (4 entrants) on a 2 matchs initiaux,
            // avec 1 barrage (3 entrants) on a 1 match initial, avec 1 finale (2 entrants) on a 1 match initial.
            // Avec quarts (8 entrants) on a 4 matchs initiaux.
            // Le 1er round = les matchs avec le plus petit ordre dont les équipes ne viennent pas d'un round précédent.
            // Approche simple : on prend le nombre de matchs initiaux comme = ceil(nb_entrants/2)
            // -> ici, on déduit nb_entrants depuis les autres infos.
            // Pour rester pragmatique on examine la composition.

            var nbMatchs = ms.length;

            // === Cas 1 match (bracket à 2 entrants) ===
            if (nbMatchs === 1) {
                pairPlaces(ms[0], offset, offset + 1, out);
                return out;
            }

            // === Cas 2 matchs ===
            // Soit bracket à 3 (barrage + finale)
            // Soit bracket à 4 sans 3e/4e (demis + finale, génériques rang_K) — donne places offset, offset+1, et les perdants des demis à départager
            // On ne peut pas trivialement distinguer sans regarder la composition.
            // Heuristique : si l'un des 2 matchs a UNE équipe en commun avec l'autre → barrage+finale (3 entrants).
            //               sinon → demis + finale (4 entrants, sans 3e/4e résolu).
            if (nbMatchs === 2) {
                var m1 = ms[0], m2 = ms[1];
                var equipesM1 = [m1.equipe_a_id, m1.equipe_b_id].filter(Boolean);
                var equipesM2 = [m2.equipe_a_id, m2.equipe_b_id].filter(Boolean);
                var commune = equipesM1.some(function (id) { return equipesM2.indexOf(id) >= 0; });
                if (commune) {
                    // Bracket à 3 : m1 = barrage, m2 = finale
                    pairPlaces(m2, offset, offset + 1, out); // gagnant finale = 1, perdant = 2
                    var perdantBarrage = loserOf(m1);
                    out.push({ place: offset + 2, equipe_id: perdantBarrage, nom: nomFor(perdantBarrage) });
                } else {
                    // 2 demis sans finale jouée (ou pas encore générée) : on ne sait pas les places exactes
                    out.push({ place: offset, equipe_id: null, nom: null });
                    out.push({ place: offset + 1, equipe_id: null, nom: null });
                    out.push({ place: offset + 2, equipe_id: loserOf(m1), nom: nomFor(loserOf(m1)) });
                    out.push({ place: offset + 3, equipe_id: loserOf(m2), nom: nomFor(loserOf(m2)) });
                }
                return out;
            }

            // === Cas 4 matchs (bracket à 4 entrants : 2 demis + finale + 3e/4e) ===
            if (nbMatchs === 4) {
                var demi1 = ms[0], demi2 = ms[1];
                var finaleM = null, petiteF = null;
                for (var i = 2; i < ms.length; i++) {
                    var m = ms[i];
                    var hw = m.equipe_a_id && m.equipe_b_id && demi1.vainqueur_id && demi2.vainqueur_id
                        && (m.equipe_a_id === demi1.vainqueur_id || m.equipe_a_id === demi2.vainqueur_id)
                        && (m.equipe_b_id === demi1.vainqueur_id || m.equipe_b_id === demi2.vainqueur_id);
                    if (hw) finaleM = m; else petiteF = m;
                }
                pairPlaces(finaleM, offset, offset + 1, out);
                pairPlaces(petiteF, offset + 2, offset + 3, out);
                return out;
            }

            // === Cas 3 matchs (bracket à 4 entrants : 2 demis + finale sans 3e/4e) ===
            if (nbMatchs === 3) {
                var d1 = ms[0], d2 = ms[1], finM = ms[2];
                pairPlaces(finM, offset, offset + 1, out);
                // Perdants des demis non départagés
                out.push({ place: offset + 2, equipe_id: loserOf(d1), nom: nomFor(loserOf(d1)) });
                out.push({ place: offset + 3, equipe_id: loserOf(d2), nom: nomFor(loserOf(d2)) });
                return out;
            }

            // === Fallback générique (bracket plus grand : quarts/demis/finale...) ===
            // On suppose une élimination directe : nbMatchs = nb_entrants - 1.
            // Les places sont déduites par le dernier match (finale) et les perdants à chaque round.
            // Implémentation simplifiée : finaleM est le dernier match.
            var finalGen = ms[ms.length - 1];
            pairPlaces(finalGen, offset, offset + 1, out);
            // Le reste : on liste les perdants en bloc sans hiérarchie fine
            ms.slice(0, -1).forEach(function (mm, idx) {
                var l = loserOf(mm);
                out.push({ place: offset + 2 + idx, equipe_id: l, nom: nomFor(l) });
            });
            return out;
        };

        var places = [];
        var offset = 1;

        // Tableau principal
        var principal = byBracket['principal'] || [];
        if (principal.length > 0) {
            var partPrincipal = placesPourBracket(principal, offset, true);
            places = places.concat(partPrincipal);
            offset += partPrincipal.length;
        }

        // Mode maison : brackets places_X_Y (1 match chacun, place déjà encodée dans le nom)
        var maisonBrackets = [
            { key: 'places_3_4', w: 3, l: 4 },
            { key: 'places_4_5', w: 4, l: 5 },
            { key: 'places_5_6', w: 5, l: 6 },
            { key: 'places_7_8', w: 7, l: 8 },
            { key: 'places_9_10', w: 9, l: 10 },
            { key: 'places_11_12', w: 11, l: 12 }
        ];
        maisonBrackets.forEach(function (b) {
            if (byBracket[b.key]) {
                var m = byBracket[b.key][0];
                places.push({ place: b.w, equipe_id: winnerOf(m), nom: nomFor(winnerOf(m)) });
                places.push({ place: b.l, equipe_id: loserOf(m), nom: nomFor(loserOf(m)) });
                offset = Math.max(offset, b.l + 1);
            }
        });

        // Brackets génériques rang_K (K=2, 3, 4, ...) — calculer dans l'ordre
        var rangBrackets = Object.keys(byBracket)
            .filter(function (k) { return k.indexOf('rang_') === 0; })
            .map(function (k) { return { key: k, n: parseInt(k.split('_')[1], 10) }; })
            .sort(function (a, b) { return a.n - b.n; });
        rangBrackets.forEach(function (rb) {
            var part = placesPourBracket(byBracket[rb.key], offset, false);
            places = places.concat(part);
            offset += part.length;
        });

        // Trier et dédupliquer par place
        places.sort(function (a, b) { return a.place - b.place; });
        var seen = {};
        return places.filter(function (p) {
            if (seen[p.place]) return false;
            seen[p.place] = true;
            return true;
        });
    }

    function bracketLabel(b) {
        if (b === 'principal') return '🏆 Tableau principal';
        if (b === 'rang_2') return '🥈 Places 5-6';
        if (b === 'rang_3') return '🥉 Places 7-9';
        if (b === 'rang_4') return '🎾 Places 10-12';
        // Mode maison
        if (b === 'places_3_4') return '🥉 Match 3ᵉ place';
        if (b === 'places_4_5') return '🎾 Match places 4-5';
        if (b === 'places_5_6') return '🥈 Match places 5-6';
        if (b === 'places_7_8') return '🥉 Match places 7-8';
        if (b === 'places_9_10') return '🎾 Match places 9-10';
        if (b === 'places_11_12') return '🎾 Match places 11-12';
        if (b && b.indexOf('places_') === 0) {
            var parts = b.replace('places_', '').split('_');
            return '🎾 Match places ' + parts.join('-');
        }
        if (!b) return 'Phase finale';
        var n = parseInt((b.split('_')[1] || '0'), 10);
        return '🎾 Places ' + (n * 3 + 1) + '+'; // approximation
    }

    function renderMatchsSection() {
        var card = el('div', { class: 'tournoi-card' });
        card.appendChild(el('h3', { class: 'tournoi-section-title' }, '🎮 Matchs (' + matchs.length + ')'));

        // Bandeau rappel du format
        var fmt = currentTournoi.format_score || 'libre';
        var banner = el('div', { class: 'format-banner' });
        banner.appendChild(el('span', { class: 'format-banner-label' }, '🎾 ' + formatShortLabel(fmt) + (currentTournoi.no_ad ? ' · No-ad' : '')));
        var ex = formatExample(fmt);
        if (ex) banner.appendChild(el('span', { class: 'format-banner-example' }, ex));
        card.appendChild(banner);

        if (matchs.length === 0) {
            card.appendChild(el('p', { class: 'tournoi-empty' }, 'Aucun match. Génère les matchs depuis la section "Poules".'));
            return card;
        }

        var matchsPoule = matchs.filter(function (m) { return m.phase === 'poule'; });
        var matchsFinale = matchs.filter(function (m) { return m.phase === 'finale'; });

        // === Classements de poule (tableaux récap) ===
        if (poules.length > 0 && matchsPoule.length > 0) {
            card.appendChild(renderClassementsPoulesAdmin());
        }

        // === Section Phase de poule ===
        if (matchsPoule.length > 0) {
            var pouleSection = el('div', { class: 'phase-section' });
            pouleSection.appendChild(el('h4', { class: 'phase-section-title' }, '🎾 Phase de poule'));
            var byTerrain = {};
            matchsPoule.forEach(function (m) {
                var t = m.terrain || 'aucun';
                if (!byTerrain[t]) byTerrain[t] = [];
                byTerrain[t].push(m);
            });
            Object.keys(byTerrain).sort().forEach(function (t) {
                var section = el('div', { class: 'terrain-section' });
                section.appendChild(el('h5', { class: 'terrain-title' }, '🏟️ Terrain ' + t));
                var list = el('div', { class: 'matchs-list' });
                byTerrain[t].forEach(function (m) { list.appendChild(renderMatchAdmin(m)); });
                section.appendChild(list);
                pouleSection.appendChild(section);
            });
            card.appendChild(pouleSection);
        }

        // === Bouton "Lancer matchs retour" : visible quand l'aller est terminé et que les retours n'existent pas ===
        if (tousMatchsAllerTermines() && !matchsRetourExistent()) {
            card.appendChild(el('button', {
                class: 'btn-live btn-live--outline',
                style: 'width:100%;margin-top:1rem',
                onclick: genererMatchsRetour,
                title: 'Crée 6 matchs retour (paires inversées). Le classement de poule prendra en compte aller + retour.'
            }, '🔄 Lancer les matchs retour (optionnel)'));
        }

        // === Pré-générer le squelette dès maintenant (placeholders qui se rempliront au fil des résultats) ===
        if (matchsFinale.length === 0 && matchsPoule.length > 0 && (poules.length >= 2 || isConfig1p5() || isConfig1p4())) {
            card.appendChild(el('button', {
                class: 'btn-live btn-live--primary',
                style: 'width:100%;margin-top:1rem',
                onclick: async function () {
                    if (guardReadOnly()) return;
                    await squeletteAutoSelonConfig();
                    render();
                },
                title: 'Crée le squelette de phase finale avec placeholders (qui se rempliront automatiquement)'
            }, '🏆 Pré-générer la phase finale'));
        }

        // === Section Phase finale ===
        if (matchsFinale.length > 0) {
            var finaleSection = el('div', { class: 'phase-section phase-section--finale' });
            finaleSection.appendChild(el('h4', { class: 'phase-section-title' }, '🏆 Phase finale'));

            // Regrouper par bracket, puis par "round" (par terrain n'est pas utile ici)
            var byBracket = {};
            matchsFinale.forEach(function (m) {
                var b = m.bracket || 'autre';
                (byBracket[b] = byBracket[b] || []).push(m);
            });

            // Ordre d'affichage des brackets : principal d'abord, puis rang_2, rang_3...
            var bracketOrder = function (b) {
                if (b === 'principal') return 0;
                if (b.indexOf('rang_') === 0) return parseInt(b.split('_')[1], 10);
                return 99;
            };
            Object.keys(byBracket).sort(function (a, b) { return bracketOrder(a) - bracketOrder(b); })
                .forEach(function (bk) {
                    var bcard = el('div', { class: 'bracket-card' });
                    bcard.appendChild(el('h5', { class: 'bracket-title' }, bracketLabel(bk)));
                    var list = el('div', { class: 'matchs-list' });
                    byBracket[bk].sort(function (a, b) { return a.ordre - b.ordre; })
                        .forEach(function (m) { list.appendChild(renderMatchAdmin(m)); });
                    bcard.appendChild(list);

                    // Bouton "générer le tour suivant" si le tour courant est complet
                    if (bracketTourComplet(bk)) {
                        bcard.appendChild(el('button', {
                            class: 'btn-live btn-live--outline btn-live--small',
                            style: 'margin-top:0.5rem;width:100%',
                            onclick: function () { genererTourSuivant(bk); }
                        }, '⏭️ Générer le tour suivant'));
                    } else if (bracketEstFini(bk)) {
                        bcard.appendChild(el('p', { class: 'bracket-done' }, '✅ Bracket terminé'));
                    }
                    finaleSection.appendChild(bcard);
                });

            card.appendChild(finaleSection);

            // Tableau final (classement des places)
            var classementFinal = computeClassementFinal();
            if (classementFinal.length > 0) {
                card.appendChild(renderClassementFinal(classementFinal));
            }
        }

        return card;
    }

    function renderClassementFinal(places) {
        var card = el('div', { class: 'classement-final-card' });
        card.appendChild(el('h4', { class: 'phase-section-title' }, '🥇 Classement final'));
        var table = el('table', { class: 'classement-final-table' });
        var medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
        places.forEach(function (p) {
            var row = el('tr', { class: p.equipe_id ? 'place-row' : 'place-row place-row--pending' });
            row.appendChild(el('td', { class: 'place-rank' }, (medals[p.place] || '') + ' ' + p.place + (p.place === 1 ? 'er' : 'e')));
            row.appendChild(el('td', { class: 'place-equipe' }, p.nom || '— en attente —'));
            table.appendChild(row);
        });
        card.appendChild(table);
        return card;
    }

    function placeholderLabel(sourceOrdre, sourceType, sourcePouleId) {
        if (!sourceType) return '?';
        if (sourceType === 'gagnant' || sourceType === 'perdant') {
            if (sourceOrdre == null) return '?';
            return (sourceType === 'gagnant' ? 'GM' : 'PM') + (sourceOrdre + 1);
        }
        if (sourceType === 'rang_poule') {
            var rangs = { 1: '1er', 2: '2e', 3: '3e', 4: '4e', 5: '5e' };
            var nomP = '?';
            if (sourcePouleId) {
                var p = poules.find(function (x) { return x.id === sourcePouleId; });
                if (p) nomP = p.nom;
            }
            return (rangs[sourceOrdre] || (sourceOrdre + 'e')) + ' ' + nomP;
        }
        if (sourceType === 'meilleur_2e') return 'Meilleur 2e';
        if (sourceType === 'autres_2es') return 'Autre 2e';
        return '?';
    }

    function equipeLabel(m, side) {
        var id = side === 'a' ? m.equipe_a_id : m.equipe_b_id;
        if (id) {
            var eq = equipes.find(function (e) { return e.id === id; });
            return eq ? equipeAffichage(eq) : '?';
        }
        var sOrdre = side === 'a' ? m.equipe_a_source_ordre : m.equipe_b_source_ordre;
        var sType = side === 'a' ? m.equipe_a_source_type : m.equipe_b_source_type;
        var sPouleId = side === 'a' ? m.equipe_a_source_poule_id : m.equipe_b_source_poule_id;
        return placeholderLabel(sOrdre, sType, sPouleId);
    }

    // Combien d'inputs de score afficher selon le format
    // Renvoie { nbSets, labels, hasSuperTb } ou { libre: true }
    function scoreInputsForFormat(format) {
        switch (format) {
            case 'format_a': // 3 sets gagnants, donc max 5 mais on en montre 3 par défaut (2 + éventuel 3e)
                return { nbSets: 3, labels: ['Set 1', 'Set 2', 'Set 3'], hasSuperTb: false };
            case 'format_b':
                return { nbSets: 3, labels: ['Set 1', 'Set 2', 'Super TB'], hasSuperTb: true };
            case 'format_c':
                return { nbSets: 3, labels: ['Set 1', 'Set 2', 'Super TB'], hasSuperTb: true };
            case 'format_d':
                return { nbSets: 1, labels: ['Set unique'], hasSuperTb: false };
            case 'format_e':
                return { nbSets: 1, labels: ['Super TB'], hasSuperTb: true };
            case 'americano':
            case 'libre':
            default:
                return { libre: true };
        }
    }

    async function updateMatchTerrain(matchId, terrain) {
        var t = parseInt(terrain, 10);
        if (isNaN(t) || t < 1) t = null;
        var res = await supa.from('matchs').update({ terrain: t, updated_at: new Date().toISOString() }).eq('id', matchId).select().single();
        if (res.error) { showToast('Erreur : ' + res.error.message, 'error'); console.error(res.error); return; }
        var i = matchs.findIndex(function (m) { return m.id === matchId; });
        if (i >= 0) matchs[i] = res.data;
        render();
    }

    // Met à jour une équipe sur une face d'un match (utilisé par drag & drop phase finale)
    async function updateMatchEquipeSide(matchId, side, newEquipeId) {
        var patch = {};
        patch[side === 'a' ? 'equipe_a_id' : 'equipe_b_id'] = newEquipeId;
        // Drag manuel : on neutralise les placeholders pour ne pas être réécrasé par le résolveur auto
        if (side === 'a') {
            patch.equipe_a_source_type = null;
            patch.equipe_a_source_ordre = null;
            patch.equipe_a_source_poule_id = null;
        } else {
            patch.equipe_b_source_type = null;
            patch.equipe_b_source_ordre = null;
            patch.equipe_b_source_poule_id = null;
        }
        patch.updated_at = new Date().toISOString();
        var res = await supa.from('matchs').update(patch).eq('id', matchId).select().single();
        if (res.error) { showToast('Erreur : ' + res.error.message, 'error'); console.error(res.error); return false; }
        var i = matchs.findIndex(function (m) { return m.id === matchId; });
        if (i >= 0) matchs[i] = res.data;
        return true;
    }

    // Swap d'équipes entre deux matchs (drag depuis un match vers une face d'un autre match)
    async function swapEquipesEntreMatchs(srcMatchId, srcSide, dstMatchId, dstSide) {
        if (srcMatchId === dstMatchId && srcSide === dstSide) return;
        var src = matchs.find(function (m) { return m.id === srcMatchId; });
        var dst = matchs.find(function (m) { return m.id === dstMatchId; });
        if (!src || !dst) return;
        var srcEqId = srcSide === 'a' ? src.equipe_a_id : src.equipe_b_id;
        var dstEqId = dstSide === 'a' ? dst.equipe_a_id : dst.equipe_b_id;
        if (!srcEqId && !dstEqId) return;

        if (srcMatchId === dstMatchId) {
            // Swap A/B au sein du même match — neutralise les placeholders auto pour figer le choix manuel
            await supa.from('matchs').update({
                equipe_a_id: dst.equipe_b_id, equipe_b_id: dst.equipe_a_id,
                equipe_a_source_type: null, equipe_a_source_ordre: null, equipe_a_source_poule_id: null,
                equipe_b_source_type: null, equipe_b_source_ordre: null, equipe_b_source_poule_id: null,
                updated_at: new Date().toISOString()
            }).eq('id', dstMatchId);
            var res2 = await supa.from('matchs').select('*').eq('id', dstMatchId).single();
            var idx = matchs.findIndex(function (m) { return m.id === dstMatchId; });
            if (idx >= 0 && res2.data) matchs[idx] = res2.data;
            render();
            showToast('Équipes interverties', 'ok');
            return;
        }

        // Cross-match swap
        await Promise.all([
            updateMatchEquipeSide(srcMatchId, srcSide, dstEqId),
            updateMatchEquipeSide(dstMatchId, dstSide, srcEqId)
        ]);
        render();
        showToast('Équipes interverties entre matchs', 'ok');
    }

    function makeMatchEquipeDraggable(span, matchId, side) {
        var eqId = (function () {
            var m = matchs.find(function (m) { return m.id === matchId; });
            if (!m) return null;
            return side === 'a' ? m.equipe_a_id : m.equipe_b_id;
        })();
        if (!eqId) return; // Rien à drag si pas d'équipe assignée

        span.setAttribute('draggable', 'true');
        span.dataset.matchId = matchId;
        span.dataset.side = side;
        span.classList.add('match-equipe--draggable');

        span.addEventListener('dragstart', function (e) {
            e.dataTransfer.setData('text/plain', JSON.stringify({ matchId: matchId, side: side }));
            e.dataTransfer.effectAllowed = 'move';
            span.classList.add('dragging');
        });
        span.addEventListener('dragend', function () { span.classList.remove('dragging'); });

        span.addEventListener('dragover', function (e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            span.classList.add('drop-target');
        });
        span.addEventListener('dragleave', function () { span.classList.remove('drop-target'); });
        span.addEventListener('drop', function (e) {
            e.preventDefault();
            span.classList.remove('drop-target');
            var data;
            try { data = JSON.parse(e.dataTransfer.getData('text/plain')); } catch (err) { return; }
            if (!data || !data.matchId) return;
            swapEquipesEntreMatchs(data.matchId, data.side, matchId, side);
        });
    }

    function renderMatchAdmin(m) {
        var eqA = equipes.find(function (e) { return e.id === m.equipe_a_id; });
        var eqB = equipes.find(function (e) { return e.id === m.equipe_b_id; });
        var poule = poules.find(function (p) { return p.id === m.poule_id; });
        var ready = !!(m.equipe_a_id && m.equipe_b_id);
        var fmt = currentTournoi && currentTournoi.format_score;
        var fmtInputs = scoreInputsForFormat(fmt);
        var isFinale = m.phase === 'finale';

        var card = el('div', { class: 'match-item match-item--' + m.status + (ready ? '' : ' match-item--pending-dep') });

        var header = el('div', { class: 'match-header' });
        var retourTag = m.is_retour ? ' · 🔄 retour' : '';
        var metaText = (poule ? poule.nom + ' · ' : '') + (isFinale ? bracketLabel(m.bracket) + ' · ' : '') + 'Match ' + (m.ordre + 1) + retourTag + ' · ' + statusLabel(m.status) + (ready ? '' : ' · ⏸ en attente d\'un match parent');
        header.appendChild(el('span', { class: 'match-meta' }, metaText));
        // Rappel du format directement dans la carte du match
        header.appendChild(el('span', { class: 'match-format-tag' }, '🎾 ' + formatShortLabel(fmt) + (currentTournoi && currentTournoi.no_ad ? ' · No-ad' : '')));

        // Dropdown terrain (modifiable sur tous les matchs)
        var nbT = currentTournoi.nb_terrains || 1;
        var terrainSel = el('select', {
            class: 'tournoi-input tournoi-input--mini match-terrain-select',
            title: 'Changer le terrain',
            onchange: function (e) { updateMatchTerrain(m.id, e.target.value); }
        });
        terrainSel.appendChild(el('option', { value: '' }, '🏟️ –'));
        for (var t = 1; t <= nbT; t++) {
            var opt = el('option', { value: t }, '🏟️ T' + t);
            if (m.terrain === t) opt.selected = true;
            terrainSel.appendChild(opt);
        }
        header.appendChild(terrainSel);
        card.appendChild(header);

        var body = el('div', { class: 'match-body' });
        var spanA = el('span', { class: 'match-equipe' + (eqA ? '' : ' match-equipe--placeholder') }, equipeLabel(m, 'a'));
        if (isFinale) makeMatchEquipeDraggable(spanA, m.id, 'a');
        body.appendChild(spanA);

        // Si terminé : affiche le score, sinon inputs
        if (m.status === 'en_cours' || m.status === 'termine') {
            var scoreInputs = el('div', { class: 'match-score-inputs' });
            if (fmtInputs.libre) {
                // Champ texte unique par équipe
                scoreInputs.appendChild(el('input', {
                    type: 'text', id: 'score-a-' + m.id,
                    value: m.score_a || '',
                    class: 'tournoi-input score-input', placeholder: 'Score A'
                }));
                scoreInputs.appendChild(el('span', { class: 'match-vs' }, '–'));
                scoreInputs.appendChild(el('input', {
                    type: 'text', id: 'score-b-' + m.id,
                    value: m.score_b || '',
                    class: 'tournoi-input score-input', placeholder: 'Score B'
                }));
            } else {
                // N paires d'inputs, une par set/manche
                var splitter = /[\s,/;]+/;
                var aArr = (m.score_a || '').trim().split(splitter).filter(Boolean);
                var bArr = (m.score_b || '').trim().split(splitter).filter(Boolean);
                var grid = el('div', { class: 'sets-grid', 'data-match': m.id, 'data-nb': fmtInputs.nbSets });
                for (var i = 0; i < fmtInputs.nbSets; i++) {
                    var col = el('div', { class: 'set-col' });
                    col.appendChild(el('span', { class: 'set-label' }, fmtInputs.labels[i]));
                    var pair = el('div', { class: 'set-pair' });
                    pair.appendChild(el('input', {
                        type: 'number', min: '0',
                        class: 'tournoi-input score-input score-input--set set-input-a',
                        'data-idx': i,
                        value: aArr[i] || '',
                        placeholder: '–'
                    }));
                    pair.appendChild(el('span', { class: 'set-sep' }, '–'));
                    pair.appendChild(el('input', {
                        type: 'number', min: '0',
                        class: 'tournoi-input score-input score-input--set set-input-b',
                        'data-idx': i,
                        value: bArr[i] || '',
                        placeholder: '–'
                    }));
                    col.appendChild(pair);
                    grid.appendChild(col);
                }
                scoreInputs.appendChild(grid);
            }
            body.appendChild(scoreInputs);
        } else {
            body.appendChild(el('span', { class: 'match-vs' }, 'vs'));
        }

        var spanB = el('span', { class: 'match-equipe' + (eqB ? '' : ' match-equipe--placeholder') }, equipeLabel(m, 'b'));
        if (isFinale) makeMatchEquipeDraggable(spanB, m.id, 'b');
        body.appendChild(spanB);
        card.appendChild(body);

        // Actions
        var actions = el('div', { class: 'match-actions' });

        if (m.status === 'en_attente') {
            if (ready) {
                actions.appendChild(el('button', { class: 'btn-live btn-live--primary btn-live--small', onclick: function () { startMatch(m.id); } }, '▶ Démarrer'));
            } else {
                actions.appendChild(el('span', { class: 'match-dep-hint' }, '⏳ équipes pas encore déterminées'));
            }
        } else if (m.status === 'en_cours' || m.status === 'termine') {
            // Vainqueur select
            var vSelect = el('select', { id: 'vainqueur-' + m.id, class: 'tournoi-input tournoi-input--mini' });
            vSelect.appendChild(el('option', { value: '' }, '— Vainqueur —'));
            if (eqA) {
                var optA = el('option', { value: eqA.id }, eqA.nom);
                if (m.vainqueur_id === eqA.id) optA.selected = true;
                vSelect.appendChild(optA);
            }
            if (eqB) {
                var optB = el('option', { value: eqB.id }, eqB.nom);
                if (m.vainqueur_id === eqB.id) optB.selected = true;
                vSelect.appendChild(optB);
            }
            actions.appendChild(vSelect);

            actions.appendChild(el('button', { class: 'btn-live btn-live--primary btn-live--small', onclick: function () { saveScore(m.id); } }, '💾 Valider'));
            actions.appendChild(el('button', { class: 'btn-live btn-live--outline btn-live--small', onclick: function () { resetMatch(m.id); } }, '↺'));
        }

        card.appendChild(actions);
        return card;
    }

    function statusLabel(s) {
        if (s === 'en_attente') return '⏳ À jouer';
        if (s === 'en_cours') return '🔴 En cours';
        if (s === 'termine') return '✅ Terminé';
        return s;
    }

    // ===== Export =====

    window.TournoiAdmin = {
        init: function () {
            els = {};
            loadActiveTournoi();
        },
        reload: loadActiveTournoi
    };
})();
