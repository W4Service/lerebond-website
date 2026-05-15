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
        var [resP, resE, resM] = await Promise.all([
            supa.from('poules').select('*').eq('tournoi_id', currentTournoi.id).order('ordre'),
            supa.from('equipes').select('*').eq('tournoi_id', currentTournoi.id).order('nom'),
            supa.from('matchs').select('*').eq('tournoi_id', currentTournoi.id).order('ordre')
        ]);
        poules = resP.data || [];
        equipes = resE.data || [];
        matchs = resM.data || [];
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
        var nom = els.eqNom.value.trim();
        if (!nom) { showToast('Saisir un nom d\'équipe', 'error'); return; }
        var res = await supa.from('equipes').insert({ tournoi_id: currentTournoi.id, nom: nom }).select().single();
        if (res.error) { showToast('Erreur : ' + res.error.message, 'error'); console.error(res.error); return; }
        equipes.push(res.data);
        els.eqNom.value = '';
        els.eqNom.focus();
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
    function buildMatchsPoule(poule, format) {
        var eqs = equipes.filter(function (e) { return e.poule_id === poule.id; });
        var base = { tournoi_id: currentTournoi.id, phase: 'poule', poule_id: poule.id, terrain: poule.terrain, status: 'en_attente' };
        var out = [];
        var ordre = 0;

        if (format === 'croise4' && eqs.length === 4) {
            var picked = shuffle(eqs);
            // M1 : picked[0] vs picked[1]
            out.push(Object.assign({}, base, { ordre: ordre++, equipe_a_id: picked[0].id, equipe_b_id: picked[1].id }));
            // M2 : picked[2] vs picked[3]
            out.push(Object.assign({}, base, { ordre: ordre++, equipe_a_id: picked[2].id, equipe_b_id: picked[3].id }));
            // M3 : PM2 vs GM1
            out.push(Object.assign({}, base, { ordre: ordre++,
                equipe_a_source_ordre: 1, equipe_a_source_type: 'perdant',
                equipe_b_source_ordre: 0, equipe_b_source_type: 'gagnant' }));
            // M4 : GM2 vs PM1
            out.push(Object.assign({}, base, { ordre: ordre++,
                equipe_a_source_ordre: 1, equipe_a_source_type: 'gagnant',
                equipe_b_source_ordre: 0, equipe_b_source_type: 'perdant' }));
            // M5 : PM1 vs PM2 (petite finale)
            out.push(Object.assign({}, base, { ordre: ordre++,
                equipe_a_source_ordre: 0, equipe_a_source_type: 'perdant',
                equipe_b_source_ordre: 1, equipe_b_source_type: 'perdant' }));
            // M6 : GM1 vs GM2 (grande finale)
            out.push(Object.assign({}, base, { ordre: ordre++,
                equipe_a_source_ordre: 0, equipe_a_source_type: 'gagnant',
                equipe_b_source_ordre: 1, equipe_b_source_type: 'gagnant' }));
            return out;
        }

        // Round-robin par défaut
        for (var i = 0; i < eqs.length; i++) {
            for (var j = i + 1; j < eqs.length; j++) {
                out.push(Object.assign({}, base, { ordre: ordre++, equipe_a_id: eqs[i].id, equipe_b_id: eqs[j].id }));
            }
        }
        return out;
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

        // En config 3p×4, on génère automatiquement le squelette de phase finale.
        // Les placeholders ("1er Poule A", "Meilleur 2e"...) se rempliront en temps réel
        // au fur et à mesure que les matchs de poule avancent.
        if (isConfig3p4() && !matchs.some(function (m) { return m.phase === 'finale'; })) {
            await genererSqueletteMaison3x4();
        }

        showToast(newMatchs.length + ' matchs de poule générés', 'ok');
        render();
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

    function renderPointageSection() {
        var card = el('div', { class: 'tournoi-card' });
        card.appendChild(el('h3', { class: 'tournoi-section-title' }, '📋 Pointage des équipes'));

        var nbTotal = equipes.length;
        var nbPresent = equipes.filter(function (e) { return e.present; }).length;
        var nbPaye = equipes.filter(function (e) { return e.paye; }).length;

        var stats = el('div', { class: 'pointage-stats' });
        stats.appendChild(el('div', { class: 'pointage-stat' }, [
            el('span', { class: 'pointage-stat-label' }, 'Présents'),
            el('span', { class: 'pointage-stat-value' }, nbPresent + ' / ' + nbTotal)
        ]));
        stats.appendChild(el('div', { class: 'pointage-stat' }, [
            el('span', { class: 'pointage-stat-label' }, 'Payés'),
            el('span', { class: 'pointage-stat-value' }, nbPaye + ' / ' + nbTotal)
        ]));
        card.appendChild(stats);

        if (equipes.length === 0) {
            card.appendChild(el('p', { class: 'tournoi-empty' }, 'Aucune équipe inscrite.'));
            return card;
        }

        // Liste : équipes triées par nom, avec leur poule
        var sorted = equipes.slice().sort(function (a, b) { return a.nom.localeCompare(b.nom); });
        var list = el('div', { class: 'pointage-list' });
        sorted.forEach(function (eq) {
            var p = poules.find(function (po) { return po.id === eq.poule_id; });
            var row = el('div', { class: 'pointage-row' + (eq.present ? ' pointage-row--present' : '') + (eq.paye ? ' pointage-row--paye' : '') });
            var infoCol = el('div', { class: 'pointage-info' });
            infoCol.appendChild(el('div', { class: 'pointage-nom' }, eq.nom));
            if (p) infoCol.appendChild(el('div', { class: 'pointage-poule' }, p.nom));
            row.appendChild(infoCol);

            var toggles = el('div', { class: 'pointage-toggles' });
            toggles.appendChild(renderToggle(eq, 'present', '✅', 'Présent'));
            toggles.appendChild(renderToggle(eq, 'paye', '💰', 'Payé'));
            row.appendChild(toggles);

            list.appendChild(row);
        });
        card.appendChild(list);

        return card;
    }

    function renderToggle(eq, flag, icon, label) {
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
            stats[e.id] = { id: e.id, nom: e.nom, mj: 0, v: 0, d: 0, sg: 0, sp: 0, jg: 0, jp: 0 };
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

    function renderHeader() {
        var card = el('div', { class: 'tournoi-card tournoi-header' });
        var info = el('div');
        info.appendChild(el('h2', { class: 'tournoi-title' }, currentTournoi.nom));
        var meta = el('p', { class: 'tournoi-subtitle' });
        var fmtLabel = currentTournoi.format_score ? formatShortLabel(currentTournoi.format_score) : null;
        var parts = [];
        if (currentTournoi.date) parts.push('📅 ' + currentTournoi.date);
        parts.push('🏟️ ' + currentTournoi.nb_terrains + ' terrain' + (currentTournoi.nb_terrains > 1 ? 's' : ''));
        parts.push('Phase : <strong>' + currentTournoi.phase + '</strong>');
        if (fmtLabel) parts.push('🎾 <strong>' + fmtLabel + '</strong>');
        if (currentTournoi.no_ad) parts.push('<strong>No-ad</strong>');
        if (currentTournoi.mode_classement === 'fft') parts.push('🏅 <strong>FFT</strong>');
        if (currentTournoi.status === 'cloture') parts.push('<strong class="readonly-badge">🔒 Clôturé</strong>');
        meta.innerHTML = parts.join(' · ');
        info.appendChild(meta);
        card.appendChild(info);

        var actions = el('div', { class: 'tournoi-actions' });
        actions.appendChild(el('button', { class: 'btn-live btn-live--outline btn-live--small', onclick: function () { window.open('live/tournoi/', '_blank'); } }, '👀 Vue client'));
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

        // Form ajout équipe
        var addForm = el('div', { class: 'setup-row' });
        var inputEq = el('input', { type: 'text', class: 'tournoi-input', placeholder: 'Nom équipe (ex: Dupont / Martin)' });
        inputEq.addEventListener('keydown', function (e) { if (e.key === 'Enter') addEquipe(); });
        addForm.appendChild(el('div', { class: 'input-group input-group--full' }, inputEq));
        addForm.appendChild(el('button', { class: 'btn-live btn-live--primary btn-live--small', onclick: addEquipe }, '+ Ajouter'));
        card.appendChild(addForm);
        els.eqNom = inputEq;

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
                item.appendChild(el('span', { class: 'equipe-nom' }, eq.nom));
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
        card.appendChild(el('h3', { class: 'tournoi-section-title' }, '🏊 Poules (' + poules.length + ')'));

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
                        row.appendChild(el('span', { class: 'equipe-nom' }, eq.nom));
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

    // === Classement final (places 1-12 du mode maison) ===
    // Renvoie un tableau ordonné de { place, equipe_id, nom } ; certains slots peuvent être null si non encore résolus.
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

        var places = [];

        // === Tableau principal ===
        // En mode maison : 2 demis (ordre 0, 1), puis finale + 3e/4e (ordre 2, 3)
        var principal = byBracket['principal'] || [];
        if (principal.length >= 4) {
            // Convention dans genererTourSuivant : ordre 2 = finale, ordre 3 = 3e/4e
            // Mais il faut identifier laquelle. La finale oppose les 2 gagnants des demis. La petite finale les 2 perdants.
            var demi1 = principal[0], demi2 = principal[1];
            // Identifier finale et petite finale par la composition des équipes
            var finaleMatch = null, petiteFinale = null;
            for (var i = 2; i < principal.length; i++) {
                var m = principal[i];
                var hasWinners = m.equipe_a_id && m.equipe_b_id && demi1.vainqueur_id && demi2.vainqueur_id
                    && (m.equipe_a_id === demi1.vainqueur_id || m.equipe_a_id === demi2.vainqueur_id)
                    && (m.equipe_b_id === demi1.vainqueur_id || m.equipe_b_id === demi2.vainqueur_id);
                if (hasWinners) finaleMatch = m;
                else petiteFinale = m;
            }
            places[0] = { place: 1, equipe_id: winnerOf(finaleMatch), nom: nomFor(winnerOf(finaleMatch)) };
            places[1] = { place: 2, equipe_id: loserOf(finaleMatch), nom: nomFor(loserOf(finaleMatch)) };
            places[2] = { place: 3, equipe_id: winnerOf(petiteFinale), nom: nomFor(winnerOf(petiteFinale)) };
            places[3] = { place: 4, equipe_id: loserOf(petiteFinale), nom: nomFor(loserOf(petiteFinale)) };
        } else if (principal.length >= 1) {
            // Avant les finales : on ne connaît pas les places 1-4
            places[0] = { place: 1, equipe_id: null, nom: null };
            places[1] = { place: 2, equipe_id: null, nom: null };
            places[2] = { place: 3, equipe_id: null, nom: null };
            places[3] = { place: 4, equipe_id: null, nom: null };
        }

        // === Brackets de classement direct (1 match chacun) ===
        var addSinglePair = function (bracketKey, placeWin, placeLose) {
            var b = byBracket[bracketKey];
            var m = b && b[0];
            places.push({ place: placeWin, equipe_id: winnerOf(m), nom: nomFor(winnerOf(m)) });
            places.push({ place: placeLose, equipe_id: loserOf(m), nom: nomFor(loserOf(m)) });
        };
        if (byBracket['places_5_6']) addSinglePair('places_5_6', 5, 6);
        if (byBracket['places_7_8']) addSinglePair('places_7_8', 7, 8);
        if (byBracket['places_9_10']) addSinglePair('places_9_10', 9, 10);
        if (byBracket['places_11_12']) addSinglePair('places_11_12', 11, 12);

        // Trier par place
        places.sort(function (a, b) { return a.place - b.place; });
        return places;
    }

    function bracketLabel(b) {
        if (b === 'principal') return '🏆 Tableau principal';
        if (b === 'rang_2') return '🥈 Places 5-6';
        if (b === 'rang_3') return '🥉 Places 7-9';
        if (b === 'rang_4') return '🎾 Places 10-12';
        // Mode maison
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

        // === Section Phase de poule ===
        if (matchsPoule.length > 0) {
            var pouleSection = el('div', { class: 'phase-section' });
            pouleSection.appendChild(el('h4', { class: 'phase-section-title' }, '🏊 Phase de poule'));
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

        // === Pré-générer le squelette maison 3p×4 dès maintenant (utile pour rattraper
        // un tournoi créé avant l'auto-génération, ou si la config 3p×4 a été obtenue après) ===
        if (matchsFinale.length === 0 && isConfig3p4() && matchsPoule.length > 0) {
            card.appendChild(el('button', {
                class: 'btn-live btn-live--primary',
                style: 'width:100%;margin-top:1rem',
                onclick: async function () {
                    if (guardReadOnly()) return;
                    await genererSqueletteMaison3x4();
                    render();
                    showToast('Squelette de phase finale créé', 'ok');
                },
                title: 'Crée le squelette (demi/finale + matchs 5-6, 7-8, 9-10, 11-12) avec placeholders'
            }, '🏆 Pré-générer la phase finale (3p×4)'));
        }

        // === Bouton : générer la phase finale manuellement (utile hors config 3p×4) ===
        if (matchsFinale.length === 0 && !isConfig3p4() && poulesToutesTerminees()) {
            card.appendChild(el('button', {
                class: 'btn-live btn-live--primary',
                style: 'width:100%;margin-top:1rem',
                onclick: genererPhaseFinale,
                title: 'Générer le tableau principal + brackets de classement'
            }, '🏆 Générer la phase finale'));
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
            return eq ? eq.nom : '?';
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
        var metaText = (poule ? poule.nom + ' · ' : '') + (isFinale ? bracketLabel(m.bracket) + ' · ' : '') + 'Match ' + (m.ordre + 1) + ' · ' + statusLabel(m.status) + (ready ? '' : ' · ⏸ en attente d\'un match parent');
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
