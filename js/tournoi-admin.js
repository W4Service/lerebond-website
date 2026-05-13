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
        var [resActif, resArchivés] = await Promise.all([
            supa.from('tournois').select('*').eq('status', 'actif').order('created_at', { ascending: false }).limit(1),
            supa.from('tournois').select('*').eq('status', 'archive').order('updated_at', { ascending: false })
        ]);
        archivedTournois = resArchivés.data || [];
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

        var res = await supa.from('tournois').insert({
            nom: nom, nb_terrains: nbTerrains, date: date, format_score: format, no_ad: noAd,
            phase: 'preparation', status: 'actif'
        }).select().single();

        if (res.error) { showToast('Erreur : ' + res.error.message, 'error'); console.error(res.error); return; }
        currentTournoi = res.data;
        await loadDetails();
        render();
        showToast('Tournoi créé', 'ok');
    }

    async function archiveTournoi() {
        if (!currentTournoi) return;
        if (!confirm('Archiver ce tournoi ? Il ne sera plus visible côté client.')) return;
        var res = await supa.from('tournois').update({ status: 'archive', updated_at: new Date().toISOString() }).eq('id', currentTournoi.id);
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

    async function addEquipe() {
        var nom = els.eqNom.value.trim();
        if (!nom) { showToast('Saisir un nom d\'équipe', 'error'); return; }
        var res = await supa.from('equipes').insert({ tournoi_id: currentTournoi.id, nom: nom }).select().single();
        if (res.error) { showToast('Erreur : ' + res.error.message, 'error'); console.error(res.error); return; }
        equipes.push(res.data);
        els.eqNom.value = '';
        els.eqNom.focus();
        render();
    }

    async function deleteEquipe(id) {
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

    // ===== Poules =====

    async function addPoule() {
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

    async function deletePoule(id) {
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

    async function genererMatchsPoules() {
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
        showToast(newMatchs.length + ' matchs de poule générés', 'ok');
        render();
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
        var scoreA = document.getElementById('score-a-' + matchId).value.trim();
        var scoreB = document.getElementById('score-b-' + matchId).value.trim();
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
        render();
        showToast('Score enregistré', 'ok');
    }

    async function resetMatch(matchId) {
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
        render();
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
            var setup = el('div', { class: 'tournoi-setup-grid' });
            setup.appendChild(renderEquipesSection());
            setup.appendChild(renderPoulesSection());
            root.appendChild(setup);
            root.appendChild(renderMatchsSection());
        }
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

        var btn = el('button', { class: 'btn-live btn-live--primary', style: 'margin-top:1.5rem;width:100%', onclick: createTournoi }, 'Créer le tournoi');
        form.appendChild(btn);
        card.appendChild(form);

        // Stocker refs pour createTournoi()
        els.tNom = inputNom;
        els.tDate = inputDate;
        els.tTerrains = inputTerrains;
        els.tFormat = selectFormat;
        els.tNoAd = noAdInput;

        wrap.appendChild(card);
        if (archivedTournois.length > 0) {
            wrap.appendChild(renderArchivedSection());
        }
        return wrap;
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
        meta.innerHTML = (currentTournoi.date ? '📅 ' + currentTournoi.date + ' · ' : '') +
            '🏟️ ' + currentTournoi.nb_terrains + ' terrain' + (currentTournoi.nb_terrains > 1 ? 's' : '') + ' · ' +
            'Phase : <strong>' + currentTournoi.phase + '</strong>' +
            (currentTournoi.no_ad ? ' · <strong>No-ad</strong>' : '');
        info.appendChild(meta);
        card.appendChild(info);

        var actions = el('div', { class: 'tournoi-actions' });
        actions.appendChild(el('button', { class: 'btn-live btn-live--outline btn-live--small', onclick: function () { window.open('live/tournoi/', '_blank'); } }, '👀 Vue client'));
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

    function renderEquipesSection() {
        var card = el('div', { class: 'tournoi-card tournoi-card--equipes' });
        var unassigned = equipes.filter(function (e) { return !e.poule_id; });
        card.appendChild(el('h3', { class: 'tournoi-section-title' }, '👥 Équipes (' + equipes.length + ')'));
        card.appendChild(el('p', { class: 'tournoi-hint' }, '💡 Glisse une équipe sur une poule à droite pour l\'assigner.'));

        // Form ajout équipe
        var addForm = el('div', { class: 'setup-row' });
        var inputEq = el('input', { type: 'text', class: 'tournoi-input', placeholder: 'Nom équipe (ex: Dupont / Martin)' });
        inputEq.addEventListener('keydown', function (e) { if (e.key === 'Enter') addEquipe(); });
        addForm.appendChild(el('div', { class: 'input-group input-group--full' }, inputEq));
        addForm.appendChild(el('button', { class: 'btn-live btn-live--primary btn-live--small', onclick: addEquipe }, '+ Ajouter'));
        card.appendChild(addForm);
        els.eqNom = inputEq;

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
            unassigned.forEach(function (eq) {
                var item = el('div', { class: 'equipe-item equipe-item--draggable' });
                item.appendChild(el('span', { class: 'drag-handle', title: 'Glisser' }, '⋮⋮'));
                item.appendChild(el('span', { class: 'equipe-nom' }, eq.nom));
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

        // Grouper par terrain
        var byTerrain = {};
        matchs.forEach(function (m) {
            var t = m.terrain || 'aucun';
            if (!byTerrain[t]) byTerrain[t] = [];
            byTerrain[t].push(m);
        });

        Object.keys(byTerrain).sort().forEach(function (t) {
            var section = el('div', { class: 'terrain-section' });
            section.appendChild(el('h4', { class: 'terrain-title' }, '🏟️ Terrain ' + t));
            var list = el('div', { class: 'matchs-list' });
            byTerrain[t].forEach(function (m) {
                list.appendChild(renderMatchAdmin(m));
            });
            section.appendChild(list);
            card.appendChild(section);
        });

        return card;
    }

    function placeholderLabel(sourceOrdre, sourceType) {
        if (sourceOrdre == null || !sourceType) return '?';
        var prefix = sourceType === 'gagnant' ? 'GM' : 'PM';
        return prefix + (sourceOrdre + 1);
    }

    function equipeLabel(m, side) {
        var id = side === 'a' ? m.equipe_a_id : m.equipe_b_id;
        if (id) {
            var eq = equipes.find(function (e) { return e.id === id; });
            return eq ? eq.nom : '?';
        }
        var sOrdre = side === 'a' ? m.equipe_a_source_ordre : m.equipe_b_source_ordre;
        var sType = side === 'a' ? m.equipe_a_source_type : m.equipe_b_source_type;
        return placeholderLabel(sOrdre, sType);
    }

    function renderMatchAdmin(m) {
        var eqA = equipes.find(function (e) { return e.id === m.equipe_a_id; });
        var eqB = equipes.find(function (e) { return e.id === m.equipe_b_id; });
        var poule = poules.find(function (p) { return p.id === m.poule_id; });
        var ready = !!(m.equipe_a_id && m.equipe_b_id);

        var card = el('div', { class: 'match-item match-item--' + m.status + (ready ? '' : ' match-item--pending-dep') });

        var header = el('div', { class: 'match-header' });
        header.appendChild(el('span', { class: 'match-meta' }, (poule ? poule.nom + ' · ' : '') + 'Match ' + (m.ordre + 1) + ' · ' + statusLabel(m.status) + (ready ? '' : ' · ⏸ en attente d\'un match parent')));
        card.appendChild(header);

        var body = el('div', { class: 'match-body' });
        body.appendChild(el('span', { class: 'match-equipe' + (eqA ? '' : ' match-equipe--placeholder') }, equipeLabel(m, 'a')));

        // Si terminé : affiche le score, sinon inputs
        if (m.status === 'en_cours' || m.status === 'termine') {
            var scoreInputs = el('div', { class: 'match-score-inputs' });
            scoreInputs.appendChild(el('input', { type: 'text', id: 'score-a-' + m.id, value: m.score_a || '', class: 'tournoi-input score-input', placeholder: 'A' }));
            scoreInputs.appendChild(el('span', { class: 'match-vs' }, '–'));
            scoreInputs.appendChild(el('input', { type: 'text', id: 'score-b-' + m.id, value: m.score_b || '', class: 'tournoi-input score-input', placeholder: 'B' }));
            body.appendChild(scoreInputs);
        } else {
            body.appendChild(el('span', { class: 'match-vs' }, 'vs'));
        }

        body.appendChild(el('span', { class: 'match-equipe' + (eqB ? '' : ' match-equipe--placeholder') }, equipeLabel(m, 'b')));
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
