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
        var res = await supa.from('tournois').select('*').eq('status', 'actif').order('created_at', { ascending: false }).limit(1);
        if (res.data && res.data.length > 0) {
            currentTournoi = res.data[0];
            await loadDetails();
        }
        render();
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

        var res = await supa.from('tournois').insert({
            nom: nom, nb_terrains: nbTerrains, date: date, format_score: format,
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
        currentTournoi = null; poules = []; equipes = []; matchs = [];
        render();
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

    // ===== Génération des matchs round-robin =====

    async function genererMatchsPoules() {
        if (!confirm('Générer tous les matchs de poule en round-robin ? Les matchs de poule existants seront supprimés.')) return;

        // Delete existing match matchs of phase 'poule' for this tournament
        await supa.from('matchs').delete().eq('tournoi_id', currentTournoi.id).eq('phase', 'poule');

        var newMatchs = [];
        poules.forEach(function (poule) {
            var eqs = equipes.filter(function (e) { return e.poule_id === poule.id; });
            var ordre = 0;
            // Round-robin
            for (var i = 0; i < eqs.length; i++) {
                for (var j = i + 1; j < eqs.length; j++) {
                    newMatchs.push({
                        tournoi_id: currentTournoi.id,
                        phase: 'poule',
                        poule_id: poule.id,
                        terrain: poule.terrain,
                        equipe_a_id: eqs[i].id,
                        equipe_b_id: eqs[j].id,
                        ordre: ordre++,
                        status: 'en_attente'
                    });
                }
            }
        });

        if (newMatchs.length === 0) {
            showToast('Aucun match à générer (poules vides ou avec 1 équipe)', 'error');
            return;
        }

        var res = await supa.from('matchs').insert(newMatchs).select();
        if (res.error) { showToast('Erreur : ' + res.error.message, 'error'); console.error(res.error); return; }
        matchs = matchs.filter(function (m) { return m.phase !== 'poule' });
        matchs = matchs.concat(res.data);

        // Update tournament phase
        await updateTournoi({ phase: 'poules' });

        showToast(newMatchs.length + ' matchs de poule générés', 'ok');
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
        render();
        showToast('Score enregistré', 'ok');
    }

    async function resetMatch(matchId) {
        if (!confirm('Réinitialiser ce match (effacer le score) ?')) return;
        var res = await supa.from('matchs').update({
            score_a: null, score_b: null, vainqueur_id: null,
            status: 'en_attente', started_at: null, finished_at: null,
            updated_at: new Date().toISOString()
        }).eq('id', matchId).select().single();
        if (res.error) { showToast('Erreur', 'error'); return; }
        var i = matchs.findIndex(function (m) { return m.id === matchId });
        if (i >= 0) matchs[i] = res.data;
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
            root.appendChild(renderPoulesSection());
            root.appendChild(renderEquipesSection());
            root.appendChild(renderMatchsSection());
        }
    }

    function renderCreate() {
        var card = el('div', { class: 'tournoi-card' });
        card.appendChild(el('h2', { class: 'tournoi-title' }, '🏆 Créer un tournoi'));
        card.appendChild(el('p', { class: 'tournoi-subtitle' }, 'Aucun tournoi actif. Crée-en un nouveau ci-dessous.'));

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

        form.appendChild(el('label', { class: 'control-label', style: 'margin-top:1rem' }, 'Format de score'));
        var selectFormat = el('select', { class: 'tournoi-input' });
        ['libre', 'sets', 'points'].forEach(function (v) {
            var opt = el('option', { value: v }, v === 'libre' ? 'Libre (texte)' : v === 'sets' ? 'Sets (ex: 6-4 6-3)' : 'Points (ex: 21-15)');
            selectFormat.appendChild(opt);
        });
        form.appendChild(el('div', { class: 'input-group input-group--full' }, selectFormat));

        var btn = el('button', { class: 'btn-live btn-live--primary', style: 'margin-top:1.5rem', onclick: createTournoi }, 'Créer le tournoi');
        form.appendChild(btn);
        card.appendChild(form);

        // Stocker refs pour createTournoi()
        els.tNom = inputNom;
        els.tDate = inputDate;
        els.tTerrains = inputTerrains;
        els.tFormat = selectFormat;

        return card;
    }

    function renderHeader() {
        var card = el('div', { class: 'tournoi-card tournoi-header' });
        var info = el('div');
        info.appendChild(el('h2', { class: 'tournoi-title' }, currentTournoi.nom));
        var meta = el('p', { class: 'tournoi-subtitle' });
        meta.innerHTML = (currentTournoi.date ? '📅 ' + currentTournoi.date + ' · ' : '') +
            '🏟️ ' + currentTournoi.nb_terrains + ' terrain' + (currentTournoi.nb_terrains > 1 ? 's' : '') + ' · ' +
            'Phase : <strong>' + currentTournoi.phase + '</strong>';
        info.appendChild(meta);
        card.appendChild(info);

        var actions = el('div', { class: 'tournoi-actions' });
        actions.appendChild(el('button', { class: 'btn-live btn-live--outline btn-live--small', onclick: function () { window.open('live/tournoi/', '_blank'); } }, '👀 Vue client'));
        actions.appendChild(el('button', { class: 'btn-live btn-live--danger btn-live--small', onclick: archiveTournoi }, 'Archiver'));
        card.appendChild(actions);

        return card;
    }

    function renderEquipesSection() {
        var card = el('div', { class: 'tournoi-card' });
        card.appendChild(el('h3', { class: 'tournoi-section-title' }, '👥 Équipes (' + equipes.length + ')'));

        // Form ajout équipe
        var addForm = el('div', { class: 'setup-row' });
        var inputEq = el('input', { type: 'text', class: 'tournoi-input', placeholder: 'Nom équipe (ex: Dupont / Martin)' });
        inputEq.addEventListener('keydown', function (e) { if (e.key === 'Enter') addEquipe(); });
        addForm.appendChild(el('div', { class: 'input-group input-group--full' }, inputEq));
        addForm.appendChild(el('button', { class: 'btn-live btn-live--primary btn-live--small', onclick: addEquipe }, '+ Ajouter'));
        card.appendChild(addForm);
        els.eqNom = inputEq;

        // Liste équipes
        if (equipes.length > 0) {
            var list = el('div', { class: 'equipes-list' });
            equipes.forEach(function (eq) {
                var item = el('div', { class: 'equipe-item' });
                item.appendChild(el('span', { class: 'equipe-nom' }, eq.nom));

                // Selecteur poule
                var sel = el('select', { class: 'tournoi-input tournoi-input--mini', onchange: function (e) { assignEquipePoule(eq.id, e.target.value); } });
                sel.appendChild(el('option', { value: '' }, '— Sans poule —'));
                poules.forEach(function (p) {
                    var opt = el('option', { value: p.id }, p.nom);
                    if (eq.poule_id === p.id) opt.selected = true;
                    sel.appendChild(opt);
                });
                item.appendChild(sel);

                item.appendChild(el('button', { class: 'icon-btn icon-btn--danger', onclick: function () { deleteEquipe(eq.id); }, title: 'Supprimer' }, '🗑'));
                list.appendChild(item);
            });
            card.appendChild(list);
        }

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

                // Équipes de la poule
                var eqs = equipes.filter(function (e) { return e.poule_id === p.id; });
                var elist = el('ul', { class: 'poule-equipes' });
                if (eqs.length === 0) {
                    elist.appendChild(el('li', { class: 'poule-empty' }, 'Aucune équipe assignée'));
                } else {
                    eqs.forEach(function (eq) {
                        var li = el('li');
                        li.appendChild(el('span', null, eq.nom));
                        // Classement input
                        var classInp = el('input', { type: 'number', min: '1', max: eqs.length, value: eq.classement_poule || '', class: 'tournoi-input tournoi-input--mini', placeholder: 'pos', style: 'width:3rem', title: 'Classement final dans la poule', onchange: function (e) { setClassementPoule(eq.id, parseInt(e.target.value)); } });
                        li.appendChild(classInp);
                        elist.appendChild(li);
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

    function renderMatchAdmin(m) {
        var eqA = equipes.find(function (e) { return e.id === m.equipe_a_id; });
        var eqB = equipes.find(function (e) { return e.id === m.equipe_b_id; });
        var poule = poules.find(function (p) { return p.id === m.poule_id; });

        var card = el('div', { class: 'match-item match-item--' + m.status });

        var header = el('div', { class: 'match-header' });
        header.appendChild(el('span', { class: 'match-meta' }, (poule ? poule.nom + ' · ' : '') + 'Match ' + (m.ordre + 1) + ' · ' + statusLabel(m.status)));
        card.appendChild(header);

        var body = el('div', { class: 'match-body' });
        body.appendChild(el('span', { class: 'match-equipe' }, eqA ? eqA.nom : '?'));

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

        body.appendChild(el('span', { class: 'match-equipe' }, eqB ? eqB.nom : '?'));
        card.appendChild(body);

        // Actions
        var actions = el('div', { class: 'match-actions' });

        if (m.status === 'en_attente') {
            actions.appendChild(el('button', { class: 'btn-live btn-live--primary btn-live--small', onclick: function () { startMatch(m.id); } }, '▶ Démarrer'));
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
