/* ============================================
   AMERICANO — Application staff
   Persistance Supabase (americano_tournois / _joueurs / _matchs).
   Écrans : création, tour en cours, classement, grille, fin de tournoi.
   ============================================ */
(function () {
    'use strict';

    var supa = window.LeRebondSupa;
    var Engine = window.AmericanoEngine;

    var DEFAUTS = {
        nbJoueurs: 12, nbTerrains: 3, nbTours: 6,
        format: 'points', pointsCible: 16, dureeTour: 14
    };
    var MIN_JOUEURS = 8, MAX_JOUEURS = 24;

    /* ---------- état ---------- */
    var tournoi = null;      // ligne americano_tournois
    var joueurs = [];        // triés par ordre
    var matchs = [];         // tous les matchs du tournoi
    var vue = 'tour';        // 'tour' | 'classement' | 'grille' | 'fin'
    var brouillonNoms = [];  // saisie des noms avant création

    // Chrono (local à l'appareil qui pilote)
    var chrono = { finAt: null, restant: 0, enMarche: false, sonne: false };
    var chronoTimer = null;
    var audioCtx = null;

    var root = document.getElementById('americano-root');

    /* ---------- utilitaires ---------- */

    function esc(s) {
        return String(s === null || s === undefined ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function toast(msg, type) {
        var old = document.querySelector('.am-toast');
        if (old) old.remove();
        var el = document.createElement('div');
        el.className = 'am-toast' + (type ? ' am-toast--' + type : '');
        el.textContent = msg;
        document.body.appendChild(el);
        setTimeout(function () { el.remove(); }, 2800);
    }

    function fmtTemps(secs) {
        if (secs < 0) secs = 0;
        var m = Math.floor(secs / 60), s = Math.floor(secs % 60);
        return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    }

    function joueurNom(id) {
        for (var i = 0; i < joueurs.length; i++) if (joueurs[i].id === id) return joueurs[i].nom;
        return '?';
    }

    function matchsDuTour(t) {
        return matchs.filter(function (m) { return m.tour === t; })
            .sort(function (a, b) { return a.terrain - b.terrain; });
    }

    function reposDuTour(t) {
        var grille = tournoi.grille || [];
        var entree = null;
        for (var i = 0; i < grille.length; i++) if (grille[i].tour === t) entree = grille[i];
        if (!entree || !entree.repos) return [];
        return entree.repos.map(function (ordre) {
            for (var i = 0; i < joueurs.length; i++) if (joueurs[i].ordre === ordre) return joueurs[i].nom;
            return '?';
        });
    }

    /* ---------- signal sonore ---------- */

    function bip() {
        try {
            if (!audioCtx) {
                var AC = window.AudioContext || window.webkitAudioContext;
                if (!AC) return;
                audioCtx = new AC();
            }
            if (audioCtx.state === 'suspended') audioCtx.resume();
            // 3 bips courts, bien audibles dans une salle bruyante
            [0, 0.45, 0.9].forEach(function (offset) {
                var osc = audioCtx.createOscillator();
                var gain = audioCtx.createGain();
                osc.type = 'square';
                osc.frequency.value = 880;
                gain.gain.setValueAtTime(0.0001, audioCtx.currentTime + offset);
                gain.gain.exponentialRampToValueAtTime(0.35, audioCtx.currentTime + offset + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + offset + 0.35);
                osc.connect(gain); gain.connect(audioCtx.destination);
                osc.start(audioCtx.currentTime + offset);
                osc.stop(audioCtx.currentTime + offset + 0.36);
            });
        } catch (e) { /* audio indisponible : on continue sans son */ }
        if (navigator.vibrate) { try { navigator.vibrate([300, 120, 300, 120, 300]); } catch (e) {} }
    }

    /* ---------- chrono ---------- */

    // Le chrono est publié en base pour que les TV et la vue publique
    // affichent exactement le même décompte. L'affichage local reste
    // calculé en local (fluide), la base ne sert qu'à la synchronisation.
    async function publierChrono(patch) {
        if (!tournoi) return;
        Object.keys(patch).forEach(function (k) { tournoi[k] = patch[k]; });
        var res = await supa.from('americano_tournois')
            .update(patch).eq('id', tournoi.id).select().single();
        if (!res.error && res.data) tournoi = res.data;
    }

    function chronoDemarrer() {
        if (!tournoi) return;
        if (chrono.enMarche) return;
        var restant = chrono.restant > 0 ? chrono.restant : tournoi.duree_tour_min * 60;
        chrono.finAt = Date.now() + restant * 1000;
        chrono.enMarche = true;
        chrono.sonne = false;
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
        tickChrono();
        // On publie la date de fin implicite : les autres écrans recalculent
        // le restant depuis tour_demarre_a + duree.
        publierChrono({
            chrono_status: 'running',
            tour_demarre_a: new Date(Date.now() - (tournoi.duree_tour_min * 60 - restant) * 1000).toISOString(),
            chrono_restant: null
        });
    }

    function chronoPause() {
        if (!chrono.enMarche) return;
        chrono.restant = Math.max(0, (chrono.finAt - Date.now()) / 1000);
        chrono.enMarche = false;
        majChronoDisplay();
        publierChrono({ chrono_status: 'paused', chrono_restant: Math.round(chrono.restant) });
    }

    function chronoReset() {
        chrono.enMarche = false;
        chrono.finAt = null;
        chrono.restant = tournoi ? tournoi.duree_tour_min * 60 : 0;
        chrono.sonne = false;
        majChronoDisplay();
        publierChrono({ chrono_status: 'idle', tour_demarre_a: null, chrono_restant: null });
    }

    // Reprend l'état du chrono tel qu'il est en base : si le staff recharge
    // la page en plein tour, le décompte continue au bon endroit.
    function adopterChronoDeLaBase() {
        if (!tournoi) { chrono.enMarche = false; chrono.restant = 0; chrono.finAt = null; return; }
        var total = tournoi.duree_tour_min * 60;
        var st = tournoi.chrono_status || 'idle';
        chrono.sonne = false;
        if (st === 'running' && tournoi.tour_demarre_a) {
            var ecoule = (Date.now() - new Date(tournoi.tour_demarre_a).getTime()) / 1000;
            var reste = total - ecoule;
            if (reste > 0) {
                chrono.enMarche = true;
                chrono.finAt = Date.now() + reste * 1000;
                tickChrono();
            } else {
                chrono.enMarche = false; chrono.restant = 0; chrono.sonne = true;
            }
        } else if (st === 'paused') {
            chrono.enMarche = false;
            chrono.restant = tournoi.chrono_restant !== null && tournoi.chrono_restant !== undefined
                ? tournoi.chrono_restant : total;
        } else if (st === 'finished') {
            chrono.enMarche = false; chrono.restant = 0; chrono.sonne = true;
        } else {
            chrono.enMarche = false; chrono.restant = total;
        }
    }

    function chronoRestant() {
        if (chrono.enMarche) return Math.max(0, (chrono.finAt - Date.now()) / 1000);
        return chrono.restant;
    }

    function tickChrono() {
        if (chronoTimer) cancelAnimationFrame(chronoTimer);
        function boucle() {
            majChronoDisplay();
            if (chrono.enMarche) {
                if (chronoRestant() <= 0 && !chrono.sonne) {
                    chrono.sonne = true;
                    chrono.enMarche = false;
                    chrono.restant = 0;
                    bip();
                    majChronoDisplay();
                    publierChrono({ chrono_status: 'finished', chrono_restant: 0 });
                    return;
                }
                chronoTimer = requestAnimationFrame(boucle);
            }
        }
        boucle();
    }

    function majChronoDisplay() {
        var el = document.getElementById('am-chrono-display');
        if (!el) return;
        var r = chronoRestant();
        el.textContent = fmtTemps(r);
        el.classList.toggle('am-chrono-display--fin', r <= 0);
        var btn = document.getElementById('am-chrono-toggle');
        if (btn) btn.textContent = chrono.enMarche ? '⏸ Pause' : '▶ Démarrer';
    }

    /* ============================================
       CHARGEMENT
       ============================================ */

    async function charger() {
        var res = await supa.from('americano_tournois')
            .select('*')
            .eq('status', 'en_cours')
            .order('created_at', { ascending: false })
            .limit(1);

        if (res.error) { rendreErreur(res.error.message); return; }

        if (!res.data || res.data.length === 0) {
            tournoi = null; joueurs = []; matchs = [];
            rendreCreation();
            return;
        }

        tournoi = res.data[0];
        await chargerDetails();
        adopterChronoDeLaBase();
        vue = 'tour';
        rendre();
    }

    async function chargerDetails() {
        var r = await Promise.all([
            supa.from('americano_joueurs').select('*').eq('tournoi_id', tournoi.id).order('ordre'),
            supa.from('americano_matchs').select('*').eq('tournoi_id', tournoi.id).order('tour').order('terrain')
        ]);
        joueurs = r[0].data || [];
        matchs = r[1].data || [];
    }

    /* ============================================
       CRÉATION
       ============================================ */

    function initBrouillon(n) {
        var anciens = brouillonNoms.slice();
        brouillonNoms = [];
        for (var i = 0; i < n; i++) {
            brouillonNoms.push(anciens[i] !== undefined ? anciens[i] : '');
        }
    }

    function rendreCreation() {
        if (brouillonNoms.length === 0) initBrouillon(DEFAUTS.nbJoueurs);

        var n = brouillonNoms.length;
        var html = '' +
        '<div class="am-topbar">' +
            '<div class="am-topbar-title">Tournoi Americano<br>' +
            '<span class="am-topbar-sub">Nouveau tournoi</span></div>' +
        '</div>' +
        '<div class="am-panel">' +
            '<div class="am-card">' +
                '<div class="am-card-title">Paramètres</div>' +

                '<div class="am-field">' +
                    '<label class="am-label" for="am-nom">Nom du tournoi</label>' +
                    '<input class="am-input" id="am-nom" type="text" value="Americano du ' + new Date().toLocaleDateString('fr-FR') + '">' +
                '</div>' +

                '<div class="am-field">' +
                    '<label class="am-label">Nombre de joueurs (' + MIN_JOUEURS + ' à ' + MAX_JOUEURS + ')</label>' +
                    stepper('nbjoueurs', n, MIN_JOUEURS, MAX_JOUEURS) +
                '</div>' +

                '<div class="am-field">' +
                    '<label class="am-label">Nombre de terrains</label>' +
                    stepper('nbterrains', DEFAUTS.nbTerrains, 1, 3) +
                '</div>' +

                '<div class="am-field">' +
                    '<label class="am-label">Nombre de tours</label>' +
                    stepper('nbtours', DEFAUTS.nbTours, 1, 20) +
                '</div>' +

                '<div class="am-field">' +
                    '<label class="am-label">Format de match</label>' +
                    '<div class="am-segmented" id="am-format">' +
                        '<button type="button" class="am-seg--on" data-format="points">En points</button>' +
                        '<button type="button" data-format="temps">Au temps</button>' +
                    '</div>' +
                '</div>' +

                '<div class="am-field" id="am-field-points">' +
                    '<label class="am-label">Match en … points</label>' +
                    stepper('points', DEFAUTS.pointsCible, 4, 64) +
                '</div>' +

                '<div class="am-field">' +
                    '<label class="am-label">Durée max d\'un tour (minutes)</label>' +
                    stepper('duree', DEFAUTS.dureeTour, 1, 60) +
                '</div>' +
            '</div>' +

            '<div class="am-card">' +
                '<div class="am-card-title">Joueurs <span id="am-cpt-joueurs" style="font-family:Kanit;font-weight:400;opacity:.6">(' + n + ')</span></div>' +
                '<div class="am-joueurs-list" id="am-joueurs-list">' + rendreChampsJoueurs() + '</div>' +
            '</div>' +

            '<div id="am-apercu"></div>' +

            '<button class="am-btn am-btn--primary am-btn--full" id="am-creer">Créer le tournoi</button>' +
        '</div>';

        root.innerHTML = html;
        brancherCreation();
        majApercu();
    }

    function stepper(id, val, min, max) {
        return '<div class="am-stepper" data-stepper="' + id + '" data-min="' + min + '" data-max="' + max + '">' +
            '<button type="button" class="am-step-btn" data-delta="-1" aria-label="Diminuer">−</button>' +
            '<input class="am-input" id="am-' + id + '" type="number" inputmode="numeric" value="' + val + '" min="' + min + '" max="' + max + '">' +
            '<button type="button" class="am-step-btn" data-delta="1" aria-label="Augmenter">+</button>' +
        '</div>';
    }

    function rendreChampsJoueurs() {
        return brouillonNoms.map(function (nom, i) {
            return '<div class="am-joueur-row">' +
                '<div class="am-joueur-num">' + (i + 1) + '</div>' +
                '<input class="am-input am-joueur-input" type="text" data-idx="' + i + '" ' +
                    'placeholder="Joueur ' + (i + 1) + '" value="' + esc(nom) + '" autocomplete="off">' +
            '</div>';
        }).join('');
    }

    function lireNombre(id, min, max, def) {
        var el = document.getElementById('am-' + id);
        if (!el) return def;
        var v = parseInt(el.value, 10);
        if (isNaN(v)) v = def;
        return Math.max(min, Math.min(max, v));
    }

    function majApercu() {
        var el = document.getElementById('am-apercu');
        if (!el) return;
        var n = brouillonNoms.length;
        var terrains = lireNombre('nbterrains', 1, 3, DEFAUTS.nbTerrains);
        var places = Engine.placesParTour(n, terrains);
        var repos = n - places;
        var txt;
        if (places < 4) {
            txt = '⚠️ Il faut au moins 4 joueurs sur le terrain pour jouer.';
        } else {
            txt = (places / 4) + ' match' + (places / 4 > 1 ? 's' : '') + ' par tour · ' + places + ' joueurs sur les terrains';
            txt += repos > 0
                ? ' · <strong>' + repos + ' au repos</strong> à chaque tour (rotation automatique, écart max 1 tour)'
                : ' · tout le monde joue à chaque tour';
        }
        el.innerHTML = '<div class="am-note">' + txt + '</div>';
    }

    function brancherCreation() {
        // Steppers
        root.querySelectorAll('[data-stepper]').forEach(function (wrap) {
            var input = wrap.querySelector('input');
            var min = parseInt(wrap.dataset.min, 10), max = parseInt(wrap.dataset.max, 10);
            wrap.querySelectorAll('.am-step-btn').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    var v = parseInt(input.value, 10);
                    if (isNaN(v)) v = min;
                    v = Math.max(min, Math.min(max, v + parseInt(btn.dataset.delta, 10)));
                    input.value = v;
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                });
            });
            input.addEventListener('change', function () {
                var v = parseInt(input.value, 10);
                if (isNaN(v)) v = min;
                input.value = Math.max(min, Math.min(max, v));
                if (wrap.dataset.stepper === 'nbjoueurs') {
                    sauverSaisieNoms();
                    initBrouillon(parseInt(input.value, 10));
                    document.getElementById('am-joueurs-list').innerHTML = rendreChampsJoueurs();
                    document.getElementById('am-cpt-joueurs').textContent = '(' + brouillonNoms.length + ')';
                    brancherChampsJoueurs();
                }
                majApercu();
            });
        });

        // Format de match
        var segs = root.querySelectorAll('#am-format button');
        segs.forEach(function (b) {
            b.addEventListener('click', function () {
                segs.forEach(function (x) { x.classList.remove('am-seg--on'); });
                b.classList.add('am-seg--on');
                var champPoints = document.getElementById('am-field-points');
                champPoints.style.display = (b.dataset.format === 'points') ? '' : 'none';
            });
        });

        brancherChampsJoueurs();
        document.getElementById('am-creer').addEventListener('click', creerTournoi);
    }

    function brancherChampsJoueurs() {
        root.querySelectorAll('.am-joueur-input').forEach(function (input) {
            input.addEventListener('input', function () {
                brouillonNoms[parseInt(input.dataset.idx, 10)] = input.value;
            });
        });
    }

    function sauverSaisieNoms() {
        root.querySelectorAll('.am-joueur-input').forEach(function (input) {
            brouillonNoms[parseInt(input.dataset.idx, 10)] = input.value;
        });
    }

    async function creerTournoi() {
        sauverSaisieNoms();

        var nom = (document.getElementById('am-nom').value || '').trim() || 'Americano';
        var nbTerrains = lireNombre('nbterrains', 1, 3, DEFAUTS.nbTerrains);
        var nbTours = lireNombre('nbtours', 1, 20, DEFAUTS.nbTours);
        var dureeTour = lireNombre('duree', 1, 60, DEFAUTS.dureeTour);
        var segOn = root.querySelector('#am-format .am-seg--on');
        var format = segOn ? segOn.dataset.format : 'points';
        var pointsCible = format === 'points' ? lireNombre('points', 4, 64, DEFAUTS.pointsCible) : DEFAUTS.pointsCible;

        // Pré-remplissage : un nom vide devient "Joueur i"
        var noms = brouillonNoms.map(function (v, i) {
            var s = (v || '').trim();
            return s || ('Joueur ' + (i + 1));
        });

        if (noms.length < MIN_JOUEURS || noms.length > MAX_JOUEURS) {
            toast('Le nombre de joueurs doit être entre ' + MIN_JOUEURS + ' et ' + MAX_JOUEURS + '.', 'error');
            return;
        }

        var btn = document.getElementById('am-creer');
        if (btn) { btn.disabled = true; btn.textContent = 'Calcul de la grille…'; }

        // Grille figée à la création : les joueurs veulent la voir d'avance.
        var grille = Engine.genererGrille(noms.length, nbTerrains, nbTours);
        if (!grille.length) {
            toast('Configuration impossible : pas assez de joueurs.', 'error');
            if (btn) { btn.disabled = false; btn.textContent = 'Créer le tournoi'; }
            return;
        }

        var resT = await supa.from('americano_tournois').insert({
            nom: nom, nb_terrains: nbTerrains, nb_tours: nbTours,
            format_match: format, points_cible: pointsCible,
            duree_tour_min: dureeTour, tour_courant: 1,
            status: 'en_cours', grille: grille
        }).select().single();

        if (resT.error) {
            toast('Erreur : ' + resT.error.message, 'error');
            if (btn) { btn.disabled = false; btn.textContent = 'Créer le tournoi'; }
            return;
        }
        tournoi = resT.data;

        var resJ = await supa.from('americano_joueurs').insert(
            noms.map(function (n, i) {
                return { tournoi_id: tournoi.id, nom: n, ordre: i };
            })
        ).select();

        if (resJ.error) {
            toast('Erreur joueurs : ' + resJ.error.message, 'error');
            if (btn) { btn.disabled = false; btn.textContent = 'Créer le tournoi'; }
            return;
        }
        joueurs = (resJ.data || []).sort(function (a, b) { return a.ordre - b.ordre; });

        // On matérialise tous les matchs de la grille (indices → ids joueurs).
        var parOrdre = {};
        joueurs.forEach(function (j) { parOrdre[j.ordre] = j.id; });

        var lignes = [];
        grille.forEach(function (t) {
            t.matchs.forEach(function (m) {
                lignes.push({
                    tournoi_id: tournoi.id, tour: t.tour, terrain: m.terrain,
                    a1_id: parOrdre[m.a1], a2_id: parOrdre[m.a2],
                    b1_id: parOrdre[m.b1], b2_id: parOrdre[m.b2],
                    score_a: null, score_b: null, valide: false
                });
            });
        });

        var resM = await supa.from('americano_matchs').insert(lignes).select();
        if (resM.error) {
            toast('Erreur matchs : ' + resM.error.message, 'error');
            if (btn) { btn.disabled = false; btn.textContent = 'Créer le tournoi'; }
            return;
        }
        matchs = resM.data || [];

        brouillonNoms = [];
        chronoReset();
        vue = 'tour';
        rendre();
        toast('Tournoi créé — ' + noms.length + ' joueurs, ' + nbTours + ' tours', 'ok');
    }

    /* ============================================
       RENDU PRINCIPAL
       ============================================ */

    function rendre() {
        if (!tournoi) { rendreCreation(); return; }

        var termine = tournoi.status === 'termine';
        if (termine && vue === 'tour') vue = 'fin';

        var onglets = [
            { id: 'tour', label: '🎾 Tour ' + tournoi.tour_courant, cache: termine },
            { id: 'classement', label: '🏆 Classement' },
            { id: 'grille', label: '📋 Grille' },
            { id: 'fin', label: '🏁 Fin', cache: !termine }
        ].filter(function (o) { return !o.cache; });

        var html = '' +
        '<div class="am-topbar">' +
            '<div class="am-topbar-title">' + esc(tournoi.nom) + '<br>' +
                '<span class="am-topbar-sub">' + joueurs.length + ' joueurs · ' +
                tournoi.nb_terrains + ' terrain' + (tournoi.nb_terrains > 1 ? 's' : '') + ' · ' +
                (tournoi.format_match === 'points' ? 'en ' + tournoi.points_cible + ' pts' : 'au temps') +
                '</span>' +
            '</div>' +
        '</div>' +
        '<div class="am-tabs">' +
            onglets.map(function (o) {
                return '<button class="am-tab' + (vue === o.id ? ' am-tab--active' : '') + '" data-vue="' + o.id + '">' + o.label + '</button>';
            }).join('') +
        '</div>' +
        '<div class="am-panel" id="am-contenu"></div>';

        root.innerHTML = html;

        root.querySelectorAll('.am-tab').forEach(function (b) {
            b.addEventListener('click', function () { vue = b.dataset.vue; rendre(); });
        });

        var contenu = document.getElementById('am-contenu');
        if (vue === 'tour') rendreTour(contenu);
        else if (vue === 'classement') rendreClassement(contenu);
        else if (vue === 'grille') rendreGrille(contenu);
        else if (vue === 'fin') rendreFin(contenu);
    }

    function rendreErreur(msg) {
        root.innerHTML = '<div class="am-panel"><div class="am-card">' +
            '<div class="am-card-title">Erreur</div><p>' + esc(msg) + '</p></div></div>';
    }

    /* ---------- Vue : tour en cours ---------- */

    function rendreTour(el) {
        var t = tournoi.tour_courant;
        var lst = matchsDuTour(t);
        var repos = reposDuTour(t);
        var dernierTour = t >= tournoi.nb_tours;

        var html = '';

        // Chrono
        html += '<div class="am-chrono-card">' +
            '<div class="am-chrono-label">Tour ' + t + ' / ' + tournoi.nb_tours +
                ' · durée max ' + tournoi.duree_tour_min + ' min</div>' +
            '<div class="am-chrono-display" id="am-chrono-display">' + fmtTemps(chronoRestant()) + '</div>' +
            '<div class="am-chrono-actions">' +
                '<button class="am-btn am-btn--or" id="am-chrono-toggle">▶ Démarrer</button>' +
                '<button class="am-btn am-btn--outline" id="am-chrono-reset">↺ Remettre à ' + tournoi.duree_tour_min + ':00</button>' +
            '</div>' +
        '</div>';

        // Terrains
        html += '<div class="am-terrains">';
        lst.forEach(function (m) {
            html += '<div class="am-terrain" data-match="' + m.id + '">' +
                '<div class="am-terrain-head"><span>Terrain ' + m.terrain + '</span>' +
                    (tournoi.format_match === 'points' ? '<span>en ' + tournoi.points_cible + ' pts</span>' : '<span>au temps</span>') +
                '</div>' +
                '<div class="am-terrain-body">' +
                    '<div class="am-equipe am-equipe--a">' +
                        '<div class="am-equipe-tag">Équipe A</div>' +
                        '<div class="am-equipe-noms"><span>' + esc(joueurNom(m.a1_id)) + '</span><span>' + esc(joueurNom(m.a2_id)) + '</span></div>' +
                    '</div>' +
                    '<div class="am-vs">— VS —</div>' +
                    '<div class="am-equipe am-equipe--b">' +
                        '<div class="am-equipe-tag">Équipe B</div>' +
                        '<div class="am-equipe-noms"><span>' + esc(joueurNom(m.b1_id)) + '</span><span>' + esc(joueurNom(m.b2_id)) + '</span></div>' +
                    '</div>' +
                    '<div class="am-scores">' +
                        '<div>' +
                            '<input class="am-score-input" type="number" inputmode="numeric" min="0" ' +
                                'data-match="' + m.id + '" data-cote="a" ' +
                                'value="' + (m.score_a === null || m.score_a === undefined ? '' : m.score_a) + '" ' +
                                'aria-label="Score équipe A terrain ' + m.terrain + '">' +
                            padScore(m.id, 'a') +
                        '</div>' +
                        '<div class="am-score-sep">–</div>' +
                        '<div>' +
                            '<input class="am-score-input" type="number" inputmode="numeric" min="0" ' +
                                'data-match="' + m.id + '" data-cote="b" ' +
                                'value="' + (m.score_b === null || m.score_b === undefined ? '' : m.score_b) + '" ' +
                                'aria-label="Score équipe B terrain ' + m.terrain + '">' +
                            padScore(m.id, 'b') +
                        '</div>' +
                    '</div>' +
                '</div>' +
            '</div>';
        });
        html += '</div>';

        if (repos.length) {
            html += '<div class="am-repos">' +
                '<div class="am-repos-title">Au repos ce tour</div>' +
                '<div class="am-repos-noms">' + repos.map(esc).join(' · ') + '</div>' +
            '</div>';
        }

        // Actions secondaires
        html += '<div class="am-btn-row" style="margin-top:1.2rem">' +
            (t > 1 ? '<button class="am-btn am-btn--outline" id="am-corriger">✏️ Corriger le tour précédent</button>' : '') +
            '<button class="am-btn am-btn--danger" id="am-reset-tournoi">🗑 Réinitialiser le tournoi</button>' +
        '</div>';

        // Écrans à diffuser (joueurs + TV)
        html += blocEcrans();

        // Barre collée en bas
        html += '<div class="am-sticky-bar">' +
            '<button class="am-btn am-btn--primary" id="am-valider">' +
                (dernierTour ? '🏁 Valider et terminer' : '✓ Valider le tour ' + t) +
            '</button>' +
        '</div>';

        el.innerHTML = html;

        // Branchements
        document.getElementById('am-chrono-toggle').addEventListener('click', function () {
            if (chrono.enMarche) chronoPause(); else chronoDemarrer();
            majChronoDisplay();
        });
        document.getElementById('am-chrono-reset').addEventListener('click', chronoReset);

        el.querySelectorAll('.am-score-input').forEach(function (input) {
            input.addEventListener('input', function () {
                input.classList.remove('am-score-input--vide');
                majScoreLocal(input.dataset.match, input.dataset.cote, input.value);
            });
            input.addEventListener('focus', function () { input.select(); });
        });

        el.querySelectorAll('.am-score-pad button').forEach(function (b) {
            b.addEventListener('click', function () {
                var cible = el.querySelector('.am-score-input[data-match="' + b.dataset.match + '"][data-cote="' + b.dataset.cote + '"]');
                if (!cible) return;
                var v = parseInt(cible.value, 10);
                if (isNaN(v)) v = 0;
                v = Math.max(0, v + parseInt(b.dataset.delta, 10));
                cible.value = v;
                cible.classList.remove('am-score-input--vide');
                majScoreLocal(b.dataset.match, b.dataset.cote, String(v));
            });
        });

        brancherEcrans();

        var btnCorr = document.getElementById('am-corriger');
        if (btnCorr) btnCorr.addEventListener('click', corrigerTourPrecedent);
        document.getElementById('am-reset-tournoi').addEventListener('click', reinitialiser);
        document.getElementById('am-valider').addEventListener('click', validerTour);

        majChronoDisplay();
    }

    /* ---------- Écrans à diffuser ---------- */

    var URL_JOUEURS = 'https://le-rebond.fr/live/americano/live/';
    var URL_TV      = 'https://le-rebond.fr/live/americano/tv/';
    var URL_TIMER   = 'https://le-rebond.fr/live/americano/tv/timer/';

    function blocEcrans() {
        return '<div class="am-card" style="margin-top:1.2rem">' +
            '<div class="am-card-title">Écrans à diffuser</div>' +
            '<div class="am-note">Les joueurs suivent le classement sur leur téléphone, ' +
                'les TV affichent les matchs et le chrono. Le chrono ci-dessus pilote tous ces écrans.</div>' +
            '<div class="am-btn-row">' +
                '<button class="am-btn am-btn--outline" id="am-qr-joueurs">📱 QR joueurs</button>' +
                '<a class="am-btn am-btn--outline" href="live/americano/tv/" target="_blank" rel="noopener">📺 Écran TV</a>' +
                '<a class="am-btn am-btn--outline" href="live/americano/tv/timer/" target="_blank" rel="noopener">⏱ TV Timer</a>' +
            '</div>' +
        '</div>';
    }

    function brancherEcrans() {
        var b = document.getElementById('am-qr-joueurs');
        if (!b) return;
        b.addEventListener('click', function () {
            if (window.TournoiQR && window.TournoiQR.open) {
                window.TournoiQR.open(URL_JOUEURS, 'Suivre le tournoi');
            } else {
                window.open(URL_JOUEURS, '_blank');
            }
        });
    }

    function padScore(matchId, cote) {
        return '<div class="am-score-pad">' +
            '<button type="button" data-match="' + matchId + '" data-cote="' + cote + '" data-delta="-1">−1</button>' +
            '<button type="button" data-match="' + matchId + '" data-cote="' + cote + '" data-delta="1">+1</button>' +
        '</div>';
    }

    function majScoreLocal(matchId, cote, val) {
        var v = val === '' ? null : Math.max(0, parseInt(val, 10));
        if (v !== null && isNaN(v)) v = null;
        for (var i = 0; i < matchs.length; i++) {
            if (matchs[i].id === matchId) {
                matchs[i][cote === 'a' ? 'score_a' : 'score_b'] = v;
                return;
            }
        }
    }

    /* ---------- Validation d'un tour ---------- */

    async function validerTour() {
        var t = tournoi.tour_courant;
        var lst = matchsDuTour(t);

        // Garde-fou : aucun score manquant.
        var manquants = [];
        lst.forEach(function (m) {
            if (m.score_a === null || m.score_a === undefined) manquants.push([m.id, 'a']);
            if (m.score_b === null || m.score_b === undefined) manquants.push([m.id, 'b']);
        });

        if (manquants.length) {
            manquants.forEach(function (mk) {
                var el = root.querySelector('.am-score-input[data-match="' + mk[0] + '"][data-cote="' + mk[1] + '"]');
                if (el) el.classList.add('am-score-input--vide');
            });
            var premier = root.querySelector('.am-score-input--vide');
            if (premier) premier.scrollIntoView({ behavior: 'smooth', block: 'center' });
            toast('Score manquant : complète tous les terrains avant de valider.', 'error');
            return;
        }

        var btn = document.getElementById('am-valider');
        if (btn) { btn.disabled = true; btn.textContent = 'Enregistrement…'; }

        for (var i = 0; i < lst.length; i++) {
            var m = lst[i];
            var res = await supa.from('americano_matchs')
                .update({ score_a: m.score_a, score_b: m.score_b, valide: true, updated_at: new Date().toISOString() })
                .eq('id', m.id).select().single();
            if (res.error) {
                toast('Erreur : ' + res.error.message, 'error');
                if (btn) btn.disabled = false;
                return;
            }
            m.valide = true;
        }

        var dernierTour = t >= tournoi.nb_tours;
        var maj = dernierTour
            ? { status: 'termine', updated_at: new Date().toISOString() }
            : { tour_courant: t + 1, updated_at: new Date().toISOString() };

        var resT = await supa.from('americano_tournois').update(maj).eq('id', tournoi.id).select().single();
        if (resT.error) { toast('Erreur : ' + resT.error.message, 'error'); if (btn) btn.disabled = false; return; }
        tournoi = resT.data;

        chronoReset();

        if (dernierTour) {
            vue = 'fin';
            rendre();
            toast('Tournoi terminé !', 'ok');
        } else {
            vue = 'tour';
            rendre();
            window.scrollTo({ top: 0, behavior: 'smooth' });
            toast('Tour ' + t + ' validé — place au tour ' + (t + 1), 'ok');
        }
    }

    async function corrigerTourPrecedent() {
        var t = tournoi.tour_courant - 1;
        if (t < 1) return;
        if (!confirm('Revenir au tour ' + t + ' pour corriger les scores ?\n\nLe tour ' + tournoi.tour_courant + ' sera rejoué ensuite.')) return;

        var res = await supa.from('americano_tournois')
            .update({ tour_courant: t, updated_at: new Date().toISOString() })
            .eq('id', tournoi.id).select().single();
        if (res.error) { toast('Erreur : ' + res.error.message, 'error'); return; }
        tournoi = res.data;

        // On dévalide le tour rouvert pour qu'il ressorte du classement tant
        // qu'il n'est pas revalidé.
        await supa.from('americano_matchs')
            .update({ valide: false })
            .eq('tournoi_id', tournoi.id).eq('tour', t);
        matchs.forEach(function (m) { if (m.tour === t) m.valide = false; });

        chronoReset();
        vue = 'tour';
        rendre();
        toast('Tour ' + t + ' rouvert — corrige les scores puis revalide.', 'ok');
    }

    async function reinitialiser() {
        if (!confirm('⚠️ RÉINITIALISER LE TOURNOI ?\n\n« ' + tournoi.nom +' »\nTous les joueurs, matchs et scores seront définitivement effacés.\n\nCette action est irréversible.')) return;
        if (!confirm('Dernière confirmation : effacer définitivement ce tournoi ?')) return;

        var res = await supa.from('americano_tournois').delete().eq('id', tournoi.id);
        if (res.error) { toast('Erreur : ' + res.error.message, 'error'); return; }

        tournoi = null; joueurs = []; matchs = []; brouillonNoms = [];
        chronoReset();
        rendreCreation();
        toast('Tournoi réinitialisé.', 'ok');
    }

    /* ---------- Vue : classement ---------- */

    function rendreClassement(el) {
        var r = Engine.calculerClassement(joueurs, matchs);
        var surMoyenne = !r.memeNombreDeTours;

        var html = '<div class="am-card">' +
            '<div class="am-card-title">Classement live</div>';

        if (surMoyenne) {
            html += '<div class="am-note">Tous les joueurs n\'ont pas disputé le même nombre de tours ' +
                '(rotation des repos) : le classement se fait sur la <strong>moyenne de points par tour</strong>.</div>';
        }

        html += '<div class="am-table-wrap"><table class="am-table"><thead><tr>' +
            '<th>#</th><th>Joueur</th>' +
            '<th' + (surMoyenne ? ' class="am-col-cle"' : '') + '>Moy./tour</th>' +
            '<th' + (surMoyenne ? '' : ' class="am-col-cle"') + '>Total</th>' +
            '<th>Diff.</th><th>V</th><th>Tours</th>' +
        '</tr></thead><tbody>';

        r.lignes.forEach(function (l, i) {
            html += '<tr>' +
                '<td class="am-rang">' + (i + 1) + '</td>' +
                '<td class="am-nom-cell">' + esc(l.nom) + '</td>' +
                '<td' + (surMoyenne ? ' class="am-col-cle"' : '') + '>' + l.moyenne.toFixed(1) + '</td>' +
                '<td' + (surMoyenne ? '' : ' class="am-col-cle"') + '>' + l.points + '</td>' +
                '<td>' + (l.diff > 0 ? '+' : '') + l.diff + '</td>' +
                '<td>' + l.victoires + '</td>' +
                '<td>' + l.toursJoues + '</td>' +
            '</tr>';
        });

        html += '</tbody></table></div>';
        html += '<div class="am-btn-row" style="margin-top:1rem">' +
            '<button class="am-btn am-btn--outline" id="am-export-csv">⬇ Exporter en CSV</button>' +
        '</div>';
        html += '</div>';

        el.innerHTML = html;
        document.getElementById('am-export-csv').addEventListener('click', exporterCsv);
    }

    /* ---------- Vue : grille complète ---------- */

    function rendreGrille(el) {
        var grille = tournoi.grille || [];
        var parOrdre = {};
        joueurs.forEach(function (j) { parOrdre[j.ordre] = j.nom; });

        var html = '<div class="am-card">' +
            '<div class="am-print-title">' + esc(tournoi.nom) + ' — Grille des tours</div>' +
            '<div class="am-card-title am-no-print">Grille complète des ' + tournoi.nb_tours + ' tours</div>' +
            '<div class="am-note am-no-print">Grille calculée à la création : elle ne change pas. ' +
                'Chacun peut voir à l\'avance avec qui et contre qui il joue.</div>';

        grille.forEach(function (t) {
            var estCourant = t.tour === tournoi.tour_courant && tournoi.status === 'en_cours';
            html += '<div class="am-grille-tour">' +
                '<div class="am-grille-tour-head"><span>Tour ' + t.tour + '</span>' +
                    (estCourant ? '<span class="am-grille-tour-badge">en cours</span>' : '') +
                '</div>';

            t.matchs.forEach(function (m) {
                html += '<div class="am-grille-match">' +
                    '<span class="am-grille-terrain">T' + m.terrain + '</span>' +
                    '<span class="am-grille-paire">' + esc(parOrdre[m.a1]) + ' + ' + esc(parOrdre[m.a2]) + '</span>' +
                    '<span class="am-grille-vs">VS</span>' +
                    '<span class="am-grille-paire">' + esc(parOrdre[m.b1]) + ' + ' + esc(parOrdre[m.b2]) + '</span>' +
                '</div>';
            });

            if (t.repos && t.repos.length) {
                html += '<div class="am-grille-repos">Repos : ' +
                    t.repos.map(function (o) { return esc(parOrdre[o]); }).join(', ') + '</div>';
            }
            html += '</div>';
        });

        html += '<div class="am-btn-row am-no-print" style="margin-top:1rem">' +
            '<button class="am-btn am-btn--outline" id="am-imprimer">🖨 Imprimer (A4)</button>' +
        '</div></div>';

        el.innerHTML = html;
        document.getElementById('am-imprimer').addEventListener('click', function () { window.print(); });
    }

    /* ---------- Vue : fin de tournoi ---------- */

    function rendreFin(el) {
        var r = Engine.calculerClassement(joueurs, matchs);
        var surMoyenne = !r.memeNombreDeTours;
        var top = r.lignes.slice(0, 3);
        var medailles = ['🥇', '🥈', '🥉'];

        var html = '<div class="am-card">' +
            '<div class="am-card-title">Podium — ' + esc(tournoi.nom) + '</div>' +
            '<div class="am-podium">';

        top.forEach(function (l, i) {
            html += '<div class="am-podium-place am-podium-place--' + (i + 1) + '">' +
                '<div class="am-podium-medaille">' + medailles[i] + '</div>' +
                '<div class="am-podium-nom">' + esc(l.nom) + '</div>' +
                '<div class="am-podium-score">' +
                    (surMoyenne ? l.moyenne.toFixed(1) + ' pts/tour' : l.points + ' pts') +
                    ' · ' + (l.diff > 0 ? '+' : '') + l.diff +
                '</div>' +
            '</div>';
        });
        html += '</div>';

        html += '<div class="am-btn-row">' +
            '<button class="am-btn am-btn--primary" id="am-export-csv">⬇ Exporter le classement (CSV)</button>' +
            '<button class="am-btn am-btn--outline" id="am-voir-classement">Voir le classement complet</button>' +
        '</div>' +
        '<div class="am-btn-row" style="margin-top:0.7rem">' +
            '<button class="am-btn am-btn--outline" id="am-nouveau">➕ Nouveau tournoi</button>' +
            '<button class="am-btn am-btn--danger" id="am-reset-tournoi">🗑 Supprimer ce tournoi</button>' +
        '</div></div>';

        el.innerHTML = html;

        document.getElementById('am-export-csv').addEventListener('click', exporterCsv);
        document.getElementById('am-voir-classement').addEventListener('click', function () { vue = 'classement'; rendre(); });
        document.getElementById('am-reset-tournoi').addEventListener('click', reinitialiser);
        document.getElementById('am-nouveau').addEventListener('click', function () {
            if (!confirm('Démarrer un nouveau tournoi ?\n\nLe tournoi « ' + tournoi.nom + ' » est terminé et restera archivé.')) return;
            tournoi = null; joueurs = []; matchs = []; brouillonNoms = [];
            rendreCreation();
        });
    }

    /* ---------- Export CSV ---------- */

    function exporterCsv() {
        var r = Engine.calculerClassement(joueurs, matchs);
        var surMoyenne = !r.memeNombreDeTours;

        var sep = ';'; // Excel FR
        var lignes = [];
        lignes.push(['Rang', 'Joueur', 'Points marques', 'Points encaisses', 'Differentiel',
                     'Victoires', 'Tours joues', 'Moyenne par tour'].join(sep));

        r.lignes.forEach(function (l, i) {
            lignes.push([
                i + 1,
                '"' + String(l.nom).replace(/"/g, '""') + '"',
                l.points, l.encaisses, l.diff, l.victoires, l.toursJoues,
                l.moyenne.toFixed(2).replace('.', ',')
            ].join(sep));
        });

        lignes.push('');
        lignes.push('Tournoi' + sep + '"' + String(tournoi.nom).replace(/"/g, '""') + '"');
        lignes.push('Classement etabli sur' + sep + (surMoyenne ? 'moyenne de points par tour' : 'total de points'));
        lignes.push('Tours' + sep + tournoi.nb_tours);
        lignes.push('Joueurs' + sep + joueurs.length);

        // BOM UTF-8 pour qu'Excel lise correctement les accents.
        var blob = new Blob(['﻿' + lignes.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        var slug = String(tournoi.nom).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        a.href = url;
        a.download = 'classement-' + (slug || 'americano') + '.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        toast('Classement exporté.', 'ok');
    }

    /* ============================================
       API publique
       ============================================ */

    window.Americano = {
        init: function () {
            if (!supa) { rendreErreur('Supabase non initialisé.'); return; }
            if (!Engine) { rendreErreur('Moteur Americano non chargé.'); return; }
            if (!root) return;
            charger();
        }
    };

})();
