/* ============================================
   FIDÉLITÉ — ADMINISTRATION (Le Rebond)

   Onglet « Fidélité » de l'admin : tunnel de bienvenue padel (schéma `fidelite`).
   - Clients : recherche par code cadeau (RB-…), nom ou téléphone → fiche complète
     (ce à quoi il a droit + bouton « utilisé », paliers, cadeaux, réservations,
     passages en caisse, messages reçus).
   - Suivi : progression ciblés / témoins, cadeaux, remplissage, messages générés.
   Le QR code des e-mails ouvre /admin/client/?j=<jeton>, qui redirige ici
   (/admin/?client=<jeton>). Toutes les données passent par des fonctions réservées
   au staff (public.fidelite_*) : sans compte staff, rien ne s'affiche.
   ============================================ */
(function (root) {
    'use strict';

    var supa = null;
    var monte = false;
    var vue = 'clients';
    var minuteur = null;
    var jetonOuvert = null;
    var suivi = null, filtreMessages = 'tous';

    var ORIGINES = { palier: 'Tunnel', retour: 'Tunnel (retour)', rattrapage: 'Rattrapage', grand_retour: 'Grand retour' };
    var STATUTS = { actif: 'en cours', utilise: 'utilisé', expire: 'expiré', perdu_hp: 'perdu', remplace: 'remplacé' };
    var TUNNEL = { actif: 'dans le tunnel', regulier: 'joueur régulier', decroche: 'sorti du tunnel' };
    var TYPES = { annonce: 'Annonce J+1', retour: 'Retour', rappel: 'Rappel J+5', rattrapage: 'Rattrapage J+14', grand_retour: 'Grand retour' };
    var GROUPES = { cible: 'Reçoivent les messages', temoin: 'Groupe témoin' };

    var CSS = ''
        + '.fid-wrap{max-width:900px;margin:0 auto;padding:1rem;color:#f4f0e6}'
        + '.fid-onglets{display:flex;gap:.5rem;margin-bottom:1rem}'
        + '.fid-onglets button{border:1px solid rgba(244,240,230,.3);background:none;color:#f4f0e6;border-radius:999px;padding:.4rem 1rem;font-weight:600;cursor:pointer}'
        + '.fid-onglets button.actif{background:#efa707;border-color:#efa707;color:#1a1a1a}'
        + '.fid-carte{background:rgba(244,240,230,.08);border:1px solid rgba(244,240,230,.2);border-radius:14px;padding:1rem;margin-bottom:.8rem}'
        + '.fid-carte h3{font-size:1rem;color:#efa707;margin-bottom:.5rem}'
        + '.fid-recherche{width:100%;font-size:1.1rem;padding:.8rem 1rem;border-radius:12px;border:2px solid rgba(244,240,230,.3);background:rgba(0,0,0,.2);color:#f4f0e6}'
        + '.fid-recherche::placeholder{color:rgba(244,240,230,.5)}'
        + '.fid-aide{font-size:.8rem;opacity:.65;margin-top:.3rem}'
        + '.fid-res{display:flex;justify-content:space-between;align-items:center;gap:.6rem;padding:.6rem 0;border-bottom:1px solid rgba(244,240,230,.12);cursor:pointer}'
        + '.fid-res:last-child{border-bottom:0}.fid-res:hover{opacity:.85}'
        + '.fid-nom{font-size:1.3rem;font-weight:700}.fid-meta{opacity:.7;font-size:.9rem}'
        + '.fid-chiffres{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:.5rem;margin-top:.7rem}'
        + '.fid-chiffre{background:rgba(0,0,0,.2);border-radius:10px;padding:.5rem .7rem}.fid-chiffre b{display:block;font-size:1.3rem}.fid-chiffre span{font-size:.75rem;opacity:.7}'
        + '.fid-offre{border:2px solid #efa707;background:rgba(239,167,7,.12)}'
        + '.fid-libelle{font-size:1.2rem;font-weight:700}.fid-code{font-family:monospace;font-size:1.05rem;letter-spacing:1px}'
        + '.fid-actions{display:flex;gap:.5rem;margin-top:.7rem;flex-wrap:wrap}'
        + '.fid-btn{flex:1;min-width:120px;border:0;border-radius:10px;padding:.75rem;font-size:1rem;font-weight:700;cursor:pointer}'
        + '.fid-btn--or{background:#efa707;color:#1a1a1a}.fid-btn--creme{background:#f4f0e6;color:#680920}.fid-btn:disabled{opacity:.5}'
        + '.fid-palier{padding:.45rem .7rem;border-radius:8px;margin-bottom:.35rem;font-size:.9rem}'
        + '.fid-palier--valide{color:#8fd694}.fid-palier--actuel{border:2px solid #efa707;background:rgba(239,167,7,.12);font-weight:700}'
        + '.fid-palier--a_debloquer{background:rgba(0,0,0,.2);opacity:.55}'
        + '.fid-ligne{display:flex;justify-content:space-between;gap:.8rem;padding:.45rem 0;border-bottom:1px solid rgba(244,240,230,.1);font-size:.9rem}'
        + '.fid-ligne:last-child{border-bottom:0}.fid-petit{font-size:.78rem;opacity:.65}'
        + '.fid-etiq{font-size:.72rem;border-radius:999px;padding:.05rem .55rem;background:rgba(244,240,230,.15);white-space:nowrap;align-self:center}'
        + '.fid-etiq--utilise,.fid-etiq--envoye{background:rgba(72,187,120,.25)}.fid-etiq--actif,.fid-etiq--avenir,.fid-etiq--simule{background:rgba(239,167,7,.3)}'
        + '.fid-etiq--bloque,.fid-etiq--echec{background:rgba(179,38,30,.4)}'
        + '.fid-ok{color:#8fd694;margin-top:.5rem}.fid-err{color:#ff9b8f;margin-top:.5rem}'
        + '.fid-table{overflow-x:auto}.fid-table table{border-collapse:collapse;width:100%;font-size:.85rem}'
        + '.fid-table th,.fid-table td{padding:.4rem .5rem;text-align:right;border-bottom:1px solid rgba(244,240,230,.12);white-space:nowrap}'
        + '.fid-table th:first-child,.fid-table td:first-child{text-align:left}.fid-table th{opacity:.65;font-weight:600}'
        + '.fid-puces{display:flex;flex-wrap:wrap;gap:.4rem;margin-bottom:.6rem}.fid-puce{background:rgba(0,0,0,.25);border-radius:999px;padding:.2rem .7rem;font-size:.82rem}'
        + '.fid-msg summary{cursor:pointer;font-size:.88rem;padding:.35rem 0;list-style:none}.fid-msg pre{white-space:pre-wrap;font-size:.8rem;opacity:.85;margin:.3rem 0 .6rem}'
        + '.fid-retour{background:none;border:0;color:#efa707;font-weight:600;cursor:pointer;margin-bottom:.6rem;padding:0}';

    function e(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function jour(iso) {
        if (!iso) return '';
        var d = new Date(String(iso).length === 10 ? iso + 'T12:00:00' : iso);
        return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    }
    function heure(iso) { return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); }
    function eur(n) { return n == null ? '' : Number(n).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }); }
    function pct(n) { return n == null ? '—' : String(n).replace('.', ',') + ' %'; }
    function section() { return document.getElementById('fidelite-section'); }
    function zone() { return document.getElementById('fid-zone'); }

    // ===== Squelette =====

    function monter() {
        var st = document.createElement('style');
        st.textContent = CSS;
        document.head.appendChild(st);
        section().innerHTML = '<div class="fid-wrap"><div class="fid-onglets">'
            + '<button type="button" data-vue="clients">Clients &amp; cadeaux</button>'
            + '<button type="button" data-vue="suivi">Suivi</button></div><div id="fid-zone"></div></div>';
        section().addEventListener('click', clic);
        section().addEventListener('input', function (ev) {
            if (ev.target.id !== 'fid-q') return;
            clearTimeout(minuteur);
            minuteur = setTimeout(rechercher, 300);
        });
    }

    function afficherVue(v) {
        vue = v;
        section().querySelectorAll('[data-vue]').forEach(function (b) { b.classList.toggle('actif', b.getAttribute('data-vue') === v); });
        if (v === 'suivi') { chargerSuivi(); return; }
        if (jetonOuvert) { chargerFiche(jetonOuvert); return; }
        zone().innerHTML = '<div class="fid-carte"><input type="search" class="fid-recherche" id="fid-q" autocomplete="off"'
            + ' placeholder="Code RB-…, nom, prénom ou téléphone">'
            + '<div class="fid-aide">Le client te donne son code ou montre son QR code (le scanner ouvre directement sa fiche).</div>'
            + '<div id="fid-resultats"></div></div>';
        var q = document.getElementById('fid-q');
        if (q) q.focus();
    }

    async function clic(ev) {
        var v = ev.target.closest('[data-vue]');
        if (v) { jetonOuvert = null; afficherVue(v.getAttribute('data-vue')); return; }
        var r = ev.target.closest('[data-jeton]');
        if (r) { ouvrirClient(r.getAttribute('data-jeton')); return; }
        if (ev.target.closest('[data-retour]')) { jetonOuvert = null; nettoyerUrl(); afficherVue('clients'); return; }
        var f = ev.target.closest('[data-filtre]');
        if (f) { filtreMessages = f.getAttribute('data-filtre'); rendreSuivi(); return; }
        var b = ev.target.closest('[data-cadeau]');
        if (b) utiliser(b);
    }

    // ===== Recherche =====

    async function rechercher() {
        var q = document.getElementById('fid-q');
        var out = document.getElementById('fid-resultats');
        if (!q || !out) return;
        if (q.value.trim().length < 2) { out.innerHTML = ''; return; }
        var r = await supa.rpc('fidelite_bar_recherche', { p_q: q.value.trim() });
        if (r.error) { out.innerHTML = '<div class="fid-err">' + e(r.error.message) + '</div>'; return; }
        if (!r.data.length) { out.innerHTML = '<div class="fid-aide" style="margin-top:.8rem">Aucun client trouvé.</div>'; return; }
        out.innerHTML = '<div style="margin-top:.6rem">' + r.data.map(function (c) {
            return '<div class="fid-res" data-jeton="' + e(c.jeton) + '"><span><b>' + e((c.prenom || '') + ' ' + (c.nom || '')) + '</b>'
                + '<br><span class="fid-petit">' + e(c.telephone || '') + (c.tunnel ? ' · palier ' + c.tunnel.palier : '') + '</span></span>'
                + (c.cadeau ? '<span class="fid-etiq fid-etiq--actif">' + e(c.cadeau.libelle) + '</span>' : '<span class="fid-petit">pas de cadeau</span>')
                + '</div>';
        }).join('') + '</div>';
    }

    // ===== Fiche client =====

    function ouvrirClient(jeton) {
        jetonOuvert = jeton;
        vue = 'clients';
        section().querySelectorAll('[data-vue]').forEach(function (b) { b.classList.toggle('actif', b.getAttribute('data-vue') === 'clients'); });
        chargerFiche(jeton);
    }

    async function chargerFiche(jeton) {
        zone().innerHTML = '<div class="fid-carte">Chargement…</div>';
        var r = await supa.rpc('fidelite_fiche_client', { p_jeton: jeton });
        if (r.error) {
            zone().innerHTML = '<button class="fid-retour" data-retour="1">← Recherche</button><div class="fid-carte fid-err">' + e(r.error.message) + '</div>';
            return;
        }
        rendreFiche(r.data);
    }

    function rendreFiche(f) {
        var c = f.client, s = f.stats || {}, h = '<button class="fid-retour" data-retour="1">← Recherche</button>';
        h += '<div class="fid-carte"><div class="fid-nom">' + e((c.prenom || '') + ' ' + (c.nom || '')) + '</div>'
            + '<div class="fid-meta">' + e(c.telephone || 'pas de téléphone') + ' · ' + e(c.email || 'pas d\'e-mail') + '</div>'
            + '<div class="fid-meta">' + (f.tunnel ? e(TUNNEL[f.tunnel.statut] || f.tunnel.statut) + ' · palier ' + f.tunnel.palier
                + (f.tunnel.groupe === 'temoin' ? ' · groupe témoin' : '') : 'hors tunnel de bienvenue')
            + (c.relances_ok ? '' : ' · désinscrit des relances') + '</div>'
            + '<div class="fid-chiffres">'
            + '<div class="fid-chiffre"><b>' + (s.parties_padel || 0) + '</b><span>parties de padel</span></div>'
            + '<div class="fid-chiffre"><b>' + (s.parties_five || 0) + '</b><span>parties de five</span></div>'
            + '<div class="fid-chiffre"><b>' + (s.a_venir || 0) + '</b><span>à venir</span></div>'
            + '<div class="fid-chiffre"><b>' + (s.derniere ? new Date(s.derniere + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '—')
            + '</b><span>dernière venue</span></div></div>'
            + (s.premiere ? '<div class="fid-aide">Client depuis le ' + jour(s.premiere) + '</div>' : '') + '</div>';

        var k = f.cadeau;
        if (k) {
            h += '<div class="fid-carte fid-offre"><h3>À quoi il a droit</h3><div class="fid-libelle">' + e(k.libelle) + '</div>'
                + '<div class="fid-code">' + e(k.code) + '</div>'
                + '<div class="fid-meta">' + e(ORIGINES[k.origine] || '') + ' · valable jusqu\'au ' + jour(k.expire_le) + '</div>';
            if (k.pas_encore_valable) {
                h += '<div class="fid-err">Valable à partir du ' + jour(k.valable_du) + ' (pour la partie suivante).</div>';
            } else if (k.choix_requis) {
                h += '<div class="fid-actions"><button class="fid-btn fid-btn--or" data-cadeau="' + k.id + '" data-choix="pizza">Pizza</button>'
                    + '<button class="fid-btn fid-btn--creme" data-cadeau="' + k.id + '" data-choix="planche">Planche</button></div>';
            } else {
                h += '<div class="fid-actions"><button class="fid-btn fid-btn--or" data-cadeau="' + k.id + '">Marquer utilisé</button></div>';
            }
            h += '<div id="fid-msg-cadeau"></div></div>';
        } else {
            h += '<div class="fid-carte"><h3>À quoi il a droit</h3><div class="fid-petit">Aucun cadeau en cours.</div></div>';
        }

        if (f.paliers && f.paliers.length) {
            h += '<div class="fid-carte"><h3>Paliers</h3>' + f.paliers.map(function (p) {
                var nom = p.fin ? e(p.libelle) : 'Palier ' + p.rang + ' — ' + e(p.libelle);
                if (p.etat === 'valide') return '<div class="fid-palier fid-palier--valide">✔ ' + nom + '</div>';
                if (p.etat === 'actuel') return '<div class="fid-palier fid-palier--actuel">Palier ' + p.rang + ' validé — ' + e(p.libelle) + '</div>';
                return '<div class="fid-palier fid-palier--a_debloquer">🔒 ' + nom + ' · encore ' + p.manque + ' réservation' + (p.manque > 1 ? 's' : '') + '</div>';
            }).join('') + '</div>';
        }

        h += '<div class="fid-carte"><h3>Cadeaux gagnés</h3>' + (f.cadeaux.length ? f.cadeaux.map(function (g) {
            return '<div class="fid-ligne"><span>' + e(g.libelle) + (g.choix ? ' (' + e(g.choix) + ')' : '')
                + '<br><span class="fid-petit">' + e(ORIGINES[g.origine] || g.origine) + (g.palier ? ' ' + g.palier : '') + ' · ' + e(g.code)
                + (g.utilise_le ? ' · utilisé le ' + jour(g.utilise_le) + (g.utilise_par ? ' par ' + e(g.utilise_par) : '') : ' · jusqu\'au ' + jour(g.expire_le))
                + '</span></span><span class="fid-etiq fid-etiq--' + e(g.statut) + '">' + e(STATUTS[g.statut] || g.statut) + '</span></div>';
        }).join('') : '<div class="fid-petit">Aucun.</div>') + '</div>';

        h += '<div class="fid-carte"><h3>Réservations (' + f.reservations.length + ')</h3>' + (f.reservations.length ? f.reservations.map(function (r) {
            return '<div class="fid-ligne"><span>' + jour(r.debut) + ' · ' + heure(r.debut) + '–' + heure(r.fin)
                + '<br><span class="fid-petit">' + e(r.terrain) + (r.prix ? ' · ' + eur(r.prix) : '') + '</span></span>'
                + (r.a_venir ? '<span class="fid-etiq fid-etiq--avenir">à venir</span>' : '<span class="fid-petit">' + e(r.sport) + '</span>') + '</div>';
        }).join('') : '<div class="fid-petit">Aucune.</div>') + '</div>';

        var total = f.caisse.reduce(function (t, p) { return t + Number(p.montant || 0); }, 0);
        h += '<div class="fid-carte"><h3>Passages en caisse' + (f.caisse.length ? ' · ' + eur(total) : '') + '</h3>'
            + '<div class="fid-aide" style="margin:0 0 .4rem">Retrouvés par le nom. Le détail des produits n\'est pas encore récupéré de LiveXperience.</div>'
            + (f.caisse.length ? f.caisse.map(function (p) {
                return '<div class="fid-ligne"><span>' + jour(p.jour) + ' · ' + e(p.heure) + '<br><span class="fid-petit">' + e(p.description)
                    + (p.numero ? ' n° ' + e(p.numero) : '') + '</span></span><span>' + eur(p.montant) + '</span></div>';
            }).join('') : '<div class="fid-petit">Aucun.</div>') + '</div>';

        h += '<div class="fid-carte"><h3>Messages reçus</h3>' + (f.messages.length ? f.messages.map(function (m) {
            return '<div class="fid-ligne"><span>' + jour(m.cree_le) + ' · ' + e(TYPES[m.type] || m.type) + '<br><span class="fid-petit">' + e(m.sujet || '')
                + '</span></span><span class="fid-etiq fid-etiq--' + e(m.statut) + '">' + e(m.statut) + '</span></div>';
        }).join('') : '<div class="fid-petit">Aucun.</div>') + '</div>';
        zone().innerHTML = h;
    }

    async function utiliser(bouton) {
        var choix = bouton.getAttribute('data-choix');
        section().querySelectorAll('[data-cadeau]').forEach(function (x) { x.disabled = true; });
        var r = await supa.rpc('fidelite_bar_utiliser', { p_cadeau: bouton.getAttribute('data-cadeau'), p_choix: choix || null });
        var msg = document.getElementById('fid-msg-cadeau');
        if (r.error) {
            msg.className = 'fid-err'; msg.textContent = r.error.message;
            section().querySelectorAll('[data-cadeau]').forEach(function (x) { x.disabled = false; });
            return;
        }
        msg.className = 'fid-ok';
        msg.textContent = 'C\'est noté : ' + r.data.libelle + (choix ? ' (' + choix + ')' : '') + '.';
        setTimeout(function () { if (jetonOuvert) chargerFiche(jetonOuvert); }, 1500);
    }

    // ===== Suivi =====

    async function chargerSuivi() {
        zone().innerHTML = '<div class="fid-carte">Chargement…</div>';
        var r = await supa.rpc('fidelite_tableau');
        if (r.error) { zone().innerHTML = '<div class="fid-carte fid-err">' + e(r.error.message) + '</div>'; return; }
        suivi = r.data;
        rendreSuivi();
    }

    function table(entetes, lignes) {
        return '<div class="fid-table"><table><thead><tr>' + entetes.map(function (x) { return '<th>' + x + '</th>'; }).join('')
            + '</tr></thead><tbody>' + (lignes.length ? lignes.join('') : '<tr><td colspan="' + entetes.length + '">Rien pour l\'instant.</td></tr>')
            + '</tbody></table></div>';
    }

    function rendreSuivi() {
        var d = suivi, c = d.config, h = '<div class="fid-carte"><div class="fid-puces">'
            + (c.dry_run === true ? '<span class="fid-puce">Mode test : rien n\'est envoyé aux clients</span>' : '<span class="fid-puce">Envoi réel actif</span>')
            + '<span class="fid-puce">Lancement : ' + e(c.date_lancement || 'non fixé') + '</span>'
            + '<span class="fid-puce">Témoin : ' + e(c.pourcentage_temoin) + ' %</span>'
            + '<span class="fid-puce">Inscrits newsletter : ' + e(d.inscrits_newsletter) + '</span></div>';
        h += '<h3>Progression dans le tunnel</h3>' + table(['Groupe', 'Entrés', '2e partie', '3e', '4e', 'Réguliers', 'Décrochés', 'En cours', '% revenus', 'Parties à 30 j'],
            d.paliers.map(function (p) {
                return '<tr><td>' + e(GROUPES[p.groupe] || p.groupe) + '</td><td>' + p.entres + '</td><td>' + p.palier_2 + '</td><td>' + p.palier_3
                    + '</td><td>' + p.palier_4 + '</td><td>' + p.reguliers + '</td><td>' + p.decroches + '</td><td>' + p.actifs
                    + '</td><td>' + pct(p.pct_2e_partie) + '</td><td>' + e(p.parties_30j_moy) + '</td></tr>';
            })) + '</div>';
        h += '<div class="fid-carte"><h3>Cadeaux</h3>' + table(['Cadeau', 'Créés', 'Utilisés', 'En cours', 'Expirés', 'Remplacés', '% utilisés'],
            d.cadeaux.map(function (k) {
                return '<tr><td>' + e(ORIGINES[k.origine]) + (k.palier ? ' ' + k.palier : '') + ' — ' + e(k.libelle) + '</td><td>' + k.crees
                    + '</td><td>' + k.utilises + '</td><td>' + k.actifs + '</td><td>' + (k.expires + k.perdus_hp) + '</td><td>' + k.remplaces
                    + '</td><td>' + pct(k.pct_utilises) + '</td></tr>';
            })) + '</div>';
        h += '<div class="fid-carte"><h3>Remplissage des heures creuses (padel)</h3>' + table(['Semaine du', 'Réservées', 'Disponibles', 'Remplissage', 'Heures pleines'],
            d.heures_creuses.map(function (s) {
                return '<tr><td>' + new Date(s.semaine + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
                    + '</td><td>' + s.heures_hc_reservees + ' h</td><td>' + s.heures_hc_dispo + ' h</td><td>' + pct(s.pct_hc)
                    + '</td><td>' + s.heures_hp_reservees + ' h</td></tr>';
            })) + '</div>';
        var statuts = ['tous', 'simule', 'a_envoyer', 'envoye', 'bloque', 'echec'];
        var msgs = d.messages.filter(function (m) { return filtreMessages === 'tous' || m.statut === filtreMessages; });
        h += '<div class="fid-carte"><h3>Messages générés</h3><div class="fid-puces">' + statuts.map(function (s) {
            return '<button type="button" class="fid-puce" style="border:0;cursor:pointer;' + (s === filtreMessages ? 'background:#efa707;color:#1a1a1a' : 'color:inherit')
                + '" data-filtre="' + s + '">' + s.replace('_', ' ') + '</button>';
        }).join('') + '</div>' + (msgs.length ? msgs.map(function (m) {
            return '<details class="fid-msg"><summary><span class="fid-etiq fid-etiq--' + e(m.statut) + '">' + e(m.statut) + '</span> '
                + jour(m.cree_le) + ' · ' + e(TYPES[m.type] || m.type) + ' · ' + e((m.prenom || '') + ' ' + (m.nom || ''))
                + (m.motif ? ' · ' + e(m.motif) : '') + '</summary>'
                + (m.corps ? '<pre><b>' + e(m.sujet || '') + '</b>\n→ ' + e(m.destinataire) + '\n\n' + e(m.corps) + '</pre>' : '') + '</details>';
        }).join('') : '<div class="fid-petit">Aucun.</div>') + '</div>';
        zone().innerHTML = h;
    }

    // ===== Entrée =====

    function jetonUrl() { return new URLSearchParams(location.search).get('client'); }
    function nettoyerUrl() {
        if (jetonUrl()) history.replaceState(null, '', location.pathname);
    }

    function init() {
        supa = root.LeRebondSupa;
        if (!supa) { section().innerHTML = '<p class="fid-err">Connexion à la base indisponible.</p>'; return; }
        if (!monte) { monte = true; monter(); }
        var j = jetonUrl();
        if (j) { ouvrirClient(j); return; }
        afficherVue(vue);
    }

    root.FideliteAdmin = { init: init, ouvrirClient: ouvrirClient, jetonUrl: jetonUrl };
})(window);
