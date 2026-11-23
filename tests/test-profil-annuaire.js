// Profil joueur, annuaire des joueurs et messagerie (migration 20261121, js/espace-joueur.js,
// js/annuaire-joueurs.js, joueurs/index.html). Contrôles statiques + rendu des deux pages
// dans un faux DOM minimal (sans dépendance), avec un faux client Supabase.
var fs = require('fs');
var vm = require('vm');
var ko = 0;
function check(n, c) { console.log((c ? '  ok   ' : '  FAIL ') + n); if (!c) ko++; }
var sql = fs.readFileSync('../supabase/migrations/20261121_profil_annuaire_messagerie.sql', 'utf8');
var code = sql.split('\n').filter(function (l) { return !/^\s*--/.test(l); }).join('\n').replace(/--[^\n]*/g, '');

// Corps d'une fonction SQL (du CREATE jusqu'au $$; final).
function corps(nom) {
    var i = code.indexOf('CREATE OR REPLACE FUNCTION ' + nom + '(');
    if (i < 0) return '';
    var j = code.indexOf('$$', i), k = code.indexOf('$$;', j + 2);
    return code.slice(i, k);
}

function partJs0() { return fs.readFileSync('../js/tournoi-partenaires.js', 'utf8'); }
console.log('=== Base : tables privées ===');
['joueurs_profils', 'messages', 'joueurs_blocages', 'joueurs_refs'].forEach(function (t) {
    check(t + ' : créée si absente, RLS activée', new RegExp('CREATE TABLE IF NOT EXISTS ' + t + ' \\(').test(code)
          && new RegExp('ALTER TABLE ' + t + '\\s+ENABLE ROW LEVEL SECURITY').test(code));
});
check('une seule règle staff par table (boucle sur les nouvelles tables)',
      /FOREACH t IN ARRAY ARRAY\['joueurs_profils', 'messages', 'joueurs_blocages', 'joueurs_signalements', 'joueurs_refs'\]/.test(code)
      && /CREATE POLICY %I ON %I FOR ALL TO authenticated USING \(est_staff\(\)\) WITH CHECK \(est_staff\(\)\)/.test(code));
check('aucune règle ouverte à anon', !/POLICY[^;]*TO anon/.test(code));
check('visibilité opt-in : ouvert décoché par défaut', /ouvert\s+boolean NOT NULL DEFAULT false/.test(code));
check('côté, niveau 1..8, dispos et présentation 300 contrôlés par la table',
      /cote\s+text CHECK \(cote IN \('droite', 'gauche', 'les_deux'\)\)/.test(code)
      && /niveau_declare smallint CHECK \(niveau_declare BETWEEN 1 AND 8\)/.test(code)
      && /dispos <@ ARRAY\['semaine_midi', 'semaine_soir', 'weekend_matin', 'weekend_apres_midi'\]/.test(code)
      && /char_length\(presentation\) <= 300/.test(code));
check('messages : 1 à 1000 caractères, sans blancs en tête ni en fin, pas à soi-même',
      /char_length\(texte\) BETWEEN 1 AND 1000 AND texte !~ '\^\\s\|\\s\$'/.test(code) && /CHECK \(de_joueur <> a_joueur\)/.test(code));
check('prérequis : la migration refuse de passer sans le correctif des liens',
      /to_regprocedure\('lien_si_nouveau\(uuid\)'\) IS NULL THEN\s+RAISE EXCEPTION 'Appliquez d''abord 20261121_correctif_liens_inscription\.sql'/.test(code));
check('références opaques : table joueurs_refs, créées par déclencheur (profil, message) + rattrapage',
      /ref\s+uuid NOT NULL DEFAULT gen_random_uuid\(\) UNIQUE/.test(code)
      && /CREATE TRIGGER trg_joueurs_profils_ref AFTER INSERT ON joueurs_profils/.test(code)
      && /CREATE TRIGGER trg_messages_ref AFTER INSERT ON messages/.test(code)
      && /DROP TRIGGER IF EXISTS trg_joueurs_profils_ref/.test(code) && /DROP TRIGGER IF EXISTS trg_messages_ref/.test(code));
check('index des messages reçus et des conversations',
      /ON messages \(a_joueur, lu_le\)/.test(code) && /ON messages \(least\(de_joueur, a_joueur\), greatest\(de_joueur, a_joueur\)/.test(code));
check('rejouable : rien que des IF NOT EXISTS / CREATE OR REPLACE / DROP … IF EXISTS',
      !/CREATE TABLE (?!IF NOT EXISTS)/.test(code) && !/CREATE INDEX (?!IF NOT EXISTS)/.test(code)
      && (code.match(/CREATE TRIGGER (\w+)/g) || []).every(function (t) { return code.indexOf('DROP TRIGGER IF EXISTS ' + t.slice(15)) >= 0; })
      && !/CREATE FUNCTION/.test(code) && !/CREATE POLICY (?!%I)/.test(code));

console.log('\n=== Base : fonctions publiques (jeton en 1er paramètre) ===');
var publiques = [
    ['mon_profil', 'p_jeton uuid', 'uuid', 'RETURNS jsonb'],
    ['enregistrer_profil', 'p_jeton uuid, p jsonb', 'uuid, jsonb', 'RETURNS jsonb'],
    ['supprimer_profil', 'p_jeton uuid', 'uuid', 'RETURNS void'],
    ['annuaire_joueurs', 'p_jeton uuid, p_filtres jsonb DEFAULT \'{}\'', 'uuid, jsonb', 'RETURNS TABLE'],
    ['fiche_joueur', 'p_jeton uuid, p_joueur uuid', 'uuid, uuid', 'RETURNS jsonb'],
    ['envoyer_message', 'p_jeton uuid, p_dest uuid, p_texte text', 'uuid, uuid, text', 'RETURNS jsonb'],
    ['mes_conversations', 'p_jeton uuid', 'uuid', 'RETURNS jsonb'],
    ['conversation', 'p_jeton uuid, p_avec uuid', 'uuid, uuid', 'RETURNS jsonb'],
    ['bloquer_joueur', 'p_jeton uuid, p_joueur uuid, p_bloquer boolean', 'uuid, uuid, boolean', 'RETURNS void'],
    ['signaler_joueur', 'p_jeton uuid, p_joueur uuid, p_motif text', 'uuid, uuid, text', 'RETURNS void']
];
publiques.forEach(function (f) {
    var c = corps(f[0]);
    check(f[0] + '(' + f[1] + ') ' + f[3] + ', SECURITY DEFINER SET search_path = public, GRANT anon',
          code.indexOf('CREATE OR REPLACE FUNCTION ' + f[0] + '(' + f[1] + ')\n' + f[3]) >= 0
          && /SECURITY DEFINER SET search_path = public/.test(c)
          && code.indexOf('GRANT EXECUTE ON FUNCTION ' + f[0] + '(' + f[2] + ') TO anon, authenticated;') >= 0);
    check(f[0] + ' : le jeton est résolu par joueur_du_jeton', /joueur_du_jeton\(p_jeton\)/.test(c));
});
check('joueur_du_jeton : « Lien inconnu ou expiré » (42501)',
      /RAISE EXCEPTION 'Lien inconnu ou expiré' USING ERRCODE = '42501'/.test(corps('joueur_du_jeton')));
['joueur_du_jeton(uuid)', 'joueur_de_ref(uuid)', 'prenom_initiale(uuid)', 'sans_liens(text)', 'conversation_existe(uuid, uuid)',
 'blocage_entre(uuid, uuid)', 'carte_joueur(uuid)', 'trg_joueurs_refs()'].forEach(function (f) {
    check('outil interne fermé : ' + f, code.indexOf('REVOKE ALL ON FUNCTION ' + f + ' FROM PUBLIC, anon, authenticated;') >= 0
          && code.indexOf('GRANT EXECUTE ON FUNCTION ' + f) < 0);
});
check('joueurs_contacts n\'est lu que pour résoudre le jeton', code.split('joueurs_contacts').length === 2
      && /FROM joueurs_contacts WHERE jeton = p_jeton/.test(corps('joueur_du_jeton')));
check('aucune colonne e-mail ni téléphone dans la migration', !/\bemail\b|\btelephone\b|\blicence\b|fft_id_crm'/.test(code));
check('annuaire : colonnes renvoyées sans coordonnées',
      /RETURNS TABLE \(ref uuid, prenom text, initiale text, genre char\(1\), fft_rang integer,\s+niveau_declare smallint, cote text, dispos text\[\], presentation text,\s+nb_tournois integer, meilleure_place integer, maj_le timestamptz\)/.test(code));
check('jamais joueurs.id en sortie : ref à la place (annuaire, carte, conversations)',
      !/'joueur_id'/.test(code) && /SELECT r\.ref, j\.prenom/.test(corps('annuaire_joueurs'))
      && /'ref', r\.ref/.test(corps('carte_joueur')) && /'ref', r\.ref/.test(corps('mes_conversations'))
      && /'avec', jsonb_build_object\('ref', p_avec/.test(corps('conversation')));
[['fiche_joueur', 'p_joueur'], ['envoyer_message', 'p_dest'], ['conversation', 'p_avec'], ['bloquer_joueur', 'p_joueur'], ['signaler_joueur', 'p_joueur']].forEach(function (f) {
    var c = corps(f[0]);
    check(f[0] + ' : ' + f[1] + ' est une référence, résolue par joueur_de_ref (jamais comparée à joueurs.id)',
          new RegExp('joueur_de_ref\\(' + f[1] + '\\)').test(c)
          && c.replace("'ref', p_avec", '').split(f[1]).length === 3);   // la signature + la résolution (l'écho « ref » de conversation à part)
});
check('joueur_de_ref : « Joueur introuvable » (22023)', /RAISE EXCEPTION 'Joueur introuvable' USING ERRCODE = '22023'/.test(corps('joueur_de_ref')));
var ann = corps('annuaire_joueurs');
check('annuaire : profils ouverts, hors soi-même, hors blocages, 200 au plus, récents d\'abord',
      /WHERE p\.ouvert/.test(ann) && /p\.joueur_id <> v_moi/.test(ann) && /NOT blocage_entre\(v_moi, p\.joueur_id\)/.test(ann)
      && /ORDER BY p\.maj_le DESC\s+LIMIT 200/.test(ann));
check('blocage dans les deux sens', /\(joueur_id = p_a AND bloque_id = p_b\) OR \(joueur_id = p_b AND bloque_id = p_a\)/.test(corps('blocage_entre')));
check('annuaire : recherche texte sans accents (normaliser_identite → unaccent)', /normaliser_identite\(/.test(ann));
var fiche = corps('fiche_joueur');
check('fiche : visible si profil ouvert ou conversation existante, jamais en cas de blocage',
      /NOT blocage_entre\(v_moi, v_j\)\s+AND \(conversation_existe\(v_moi, v_j\)\s+OR EXISTS \(SELECT 1 FROM joueurs_profils WHERE joueur_id = v_j AND ouvert\)\)/.test(fiche));
check('fiche : historique des tournois et du classement', /'tournois'/.test(fiche) && /'historique_classement'/.test(fiche));

console.log('\n=== Base : messagerie et anti-abus ===');
var env = corps('envoyer_message');
check('dest non ouvert refusé, sauf pour lui répondre (il m\'a déjà écrit)',
      /IF NOT EXISTS \(SELECT 1 FROM messages WHERE de_joueur = v_dest AND a_joueur = v_moi\)\s+AND NOT EXISTS \(SELECT 1 FROM joueurs_profils WHERE joueur_id = v_dest AND ouvert\)/.test(env));
check('blocage dans un sens ou l\'autre refusé', /joueur_id = v_moi AND bloque_id = v_dest/.test(env) && /joueur_id = v_dest AND bloque_id = v_moi/.test(env));
check('verrous : un envoi à la fois par expéditeur, une notification à la fois par destinataire',
      /pg_advisory_xact_lock\(hashtext\('msg:' \|\| v_moi\)\)/.test(env) && /pg_advisory_xact_lock\(hashtext\('notif-msg:' \|\| v_dest\)\)/.test(env)
      && env.indexOf("'msg:'") < env.indexOf('SELECT count(*)') && env.indexOf("'notif-msg:'") < env.indexOf("type = 'message'"));
check('texte : blancs (retours, tabulations) retirés en tête et en fin', /regexp_replace\(left\(coalesce\(p_texte, ''\), 2000\), '\^\\s\+\|\\s\+\$', '', 'g'\)/.test(env));
check('e-mail : liens neutralisés dans le prénom et l\'extrait, prénom borné',
      /v_nom := sans_liens\(prenom_initiale\(v_moi\)\)/.test(env) && /v_extrait := sans_liens\(/.test(env)
      && /left\(trim\(prenom\), 30\)/.test(corps('prenom_initiale')) && /https\?:\/\/\|www/.test(corps('sans_liens')));
check('anti-abus : 30 messages par heure (54000)', /interval '1 hour'\) >= 30/.test(env) && /ERRCODE = '54000'/.test(env));
check('anti-abus : 5 nouvelles conversations par 24 h', /interval '24 hours'\) >= 5/.test(env));
check('notification au plus toutes les 30 min par destinataire',
      /NOT EXISTS \(SELECT 1 FROM notifications WHERE type = 'message' AND joueur_id = v_dest\s+AND cree_le > now\(\) - interval '30 minutes'\)/.test(env));
check('notification : « Nouveau message de Prénom I. », extrait de 200 caractères',
      /PERFORM notifier\(v_dest, 'message', 'Nouveau message de ' \|\| v_nom,/.test(env) && /left\(v_extrait, 200\)/.test(env)
      && /Réponds depuis ton espace joueur, rubrique Messages\./.test(env));
check('conversation : marque lus les messages reçus', /UPDATE messages SET lu_le = now\(\) WHERE a_joueur = v_moi AND de_joueur = v_avec AND lu_le IS NULL/.test(corps('conversation')));
var sig = corps('signaler_joueur');
check('signalement : alerte staff avec noms + motif, 3 par jour', /PERFORM alerter_staff\('Signalement annuaire'/.test(sig)
      && /nom_joueur\(v_moi\)/.test(sig) && /interval '24 hours'\) >= 3/.test(sig));
check('signalement : seulement un joueur ouvert ou avec qui on a échangé ; plafond global de 20 e-mails par heure ; verrou',
      /IF NOT \(conversation_existe\(v_moi, v_j\) OR EXISTS \(SELECT 1 FROM joueurs_profils WHERE joueur_id = v_j AND ouvert\)\)/.test(sig)
      && /cree_le > now\(\) - interval '1 hour'\) <= 20 THEN\s+PERFORM alerter_staff/.test(sig)
      && /pg_advisory_xact_lock\(hashtext\('signalements'\)\)/.test(sig));

console.log('\n=== Correctif préalable : liens personnels (20261121_correctif_liens_inscription.sql) ===');
var cor = fs.readFileSync('../supabase/migrations/20261121_correctif_liens_inscription.sql', 'utf8');
function bloc(src, nom) {
    var i = src.indexOf('CREATE OR REPLACE FUNCTION ' + nom + '(');
    if (i < 0) return '';
    var j = src.indexOf('$$', i), k = src.indexOf('$$;', j + 2);
    return src.slice(i, k + 3);
}
function lignesDiff(a, b) {   // lignes de a absentes de b
    var lb = b.split('\n'); return a.split('\n').filter(function (l) { return lb.indexOf(l) < 0; });
}
var M = '../supabase/migrations/';
[['joueur_pour_inscription', '20261021_inscriptions.sql'], ['chercher_partenaire', '20261024_partenaires_licences.sql'],
 ['inscrire_paire', '20261023_resultats_poids_alertes.sql']].forEach(function (f) {
    var neuf = bloc(cor, f[0]), ancien = bloc(fs.readFileSync(M + f[1], 'utf8'), f[0]);
    var ajout = lignesDiff(neuf, ancien).filter(function (l) { return !/^\s*--/.test(l); });
    var retrait = lignesDiff(ancien, neuf);
    check(f[0] + ' : reprise à l\'identique de ' + f[1] + ' sauf les lignes corrigées',
          neuf !== '' && retrait.length <= 2 && ajout.length <= 2
          && ajout.every(function (l) { return /lien_si_nouveau|coalesce\(joueurs_contacts\.(email|telephone), EXCLUDED/.test(l); }),
          JSON.stringify({ ajout: ajout, retrait: retrait }));
});
check('joueur_pour_inscription : ne remplace jamais un e-mail ni un téléphone connus',
      /email = coalesce\(joueurs_contacts\.email, EXCLUDED\.email\)/.test(cor) && /telephone = coalesce\(joueurs_contacts\.telephone, EXCLUDED\.telephone\)/.test(cor)
      && !/coalesce\(EXCLUDED\.email/.test(cor));
check('chercher_partenaire / inscrire_paire : lien seulement pour une fiche créée par l\'appel',
      /'lien', lien_si_nouveau\(v_j\)\)/.test(bloc(cor, 'chercher_partenaire')) && /'lien', lien_si_nouveau\(v_j1\)\)/.test(bloc(cor, 'inscrire_paire'))
      && /j\.created_at = now\(\) AND c\.created_at = now\(\)/.test(bloc(cor, 'lien_si_nouveau'))
      && cor.split("'/espace-joueur/?j='").length === 3);   // lien_si_nouveau + staff_regenerer_lien
check('lien_si_nouveau et joueur_pour_inscription fermés au public',
      cor.indexOf('REVOKE ALL ON FUNCTION lien_si_nouveau(uuid) FROM PUBLIC, anon, authenticated;') >= 0
      && cor.indexOf('REVOKE ALL ON FUNCTION joueur_pour_inscription(jsonb) FROM PUBLIC, anon, authenticated;') >= 0);
check('staff_regenerer_lien : réservé au staff, nouveau jeton',
      /IF NOT est_staff\(\) THEN RAISE EXCEPTION 'réservé au staff' USING ERRCODE = '42501'/.test(bloc(cor, 'staff_regenerer_lien'))
      && /SET jeton = gen_random_uuid\(\)/.test(bloc(cor, 'staff_regenerer_lien'))
      && cor.indexOf('REVOKE ALL ON FUNCTION staff_regenerer_lien(uuid) FROM PUBLIC, anon;') >= 0);
var insJs = fs.readFileSync('../js/tournoi-inscription.js', 'utf8');
check('tournoi-inscription.js : « lien » absent géré (pas de new URL(null))',
      /res\.data\.lien \? new URL\(res\.data\.lien\)/.test(insJs) && /if \(r\.lien\) \{/.test(insJs));
check('tournoi-partenaires.js : « lien » absent géré', /data && data\.lien \? new URL\(data\.lien\)/.test(partJs0()));
check('espace_joueur n\'est pas modifiée', !/FUNCTION espace_joueur\(/.test(code));

console.log('\n=== Page joueurs/ ===');
var page = fs.readFileSync('../joueurs/index.html', 'utf8');
var modele = fs.readFileSync('../espace-joueur/index.html', 'utf8');
check('non indexée (noindex, nofollow)', /<meta name="robots" content="noindex, nofollow"\/>/.test(page));
check('même <base href> que l\'espace joueur', /<base href="https:\/\/le-rebond\.fr\/">/.test(page));
check('canonique /joueurs/', /<link href="https:\/\/le-rebond\.fr\/joueurs\/" rel="canonical"\/>/.test(page));
function scripts(h) { return (h.match(/<script[^>]*src="[^"]+"/g) || []).map(function (s) { return s.match(/src="([^"]+)"/)[1]; }); }
check('ordre des scripts du modèle, annuaire-joueurs.js à la place de l\'espace',
      JSON.stringify(scripts(page)) === JSON.stringify(scripts(modele).filter(function (s) { return s !== 'js/fft-bareme.js'; })
          .map(function (s) { return s === 'js/espace-joueur.js' ? 'js/annuaire-joueurs.js' : s; })));
check('en-tête et pied identiques à l\'espace joueur',
      page.slice(page.indexOf('<header'), page.indexOf('</header>')) === modele.slice(modele.indexOf('<header'), modele.indexOf('</header>'))
      && page.slice(page.indexOf('<footer'), page.indexOf('</footer>')) === modele.slice(modele.indexOf('<footer'), modele.indexOf('</footer>')));
check('zone de contenu #ann-contenu', /<div id="ann-contenu" aria-live="polite">/.test(page));
check('absente du sitemap', !/\/joueurs\//.test(fs.readFileSync('../sitemap.xml', 'utf8')));
var partJs = fs.readFileSync('../js/tournoi-partenaires.js', 'utf8');
check('la page partenaires renvoie vers l\'annuaire', /'Voir l\\'annuaire des joueurs →'\); b\.href = 'joueurs\/'/.test(partJs));

console.log('\n=== JavaScript : pas d\'HTML injecté ===');
var annJs = fs.readFileSync('../js/annuaire-joueurs.js', 'utf8');
var espJs = fs.readFileSync('../js/espace-joueur.js', 'utf8');
function innerHtmlNonVide(src) { return (src.match(/innerHTML\s*=\s*(?!\s|'';)[^\n]*/g) || []); }
check('annuaire-joueurs.js : innerHTML seulement pour vider', innerHtmlNonVide(annJs).length === 0 && !/insertAdjacentHTML|outerHTML|document\.write/.test(annJs));
check('espace-joueur.js : innerHTML seulement pour vider', innerHtmlNonVide(espJs).length === 0 && !/insertAdjacentHTML|outerHTML/.test(espJs));
check('annuaire : même clé de stockage que l\'espace joueur', /CLE_ESPACE = 'rebond-espace-joueur'/.test(annJs) && /JSON\.parse\(localStorage\.getItem\(CLE_ESPACE\)/.test(annJs));
check('dégradation : RPC absente reconnue (PGRST202 / 42883)', /'PGRST202'/.test(annJs) && /'42883'/.test(annJs) && /PGRST202 \/ 42883/.test(espJs));

// ---------------------------------------------------------------- faux DOM
function Elem(tag) {
    this.tagName = String(tag).toUpperCase(); this.children = []; this.parentNode = null; this._text = '';
    this.className = ''; this.listeners = {}; this.attrs = {}; this.hidden = false; this.value = ''; this.checked = false;
}
Object.defineProperty(Elem.prototype, 'textContent', {
    get: function () { return this.tagName === '#TEXT' ? this._text : this.children.map(function (c) { return c.textContent; }).join(''); },
    set: function (v) {
        if (this.tagName === '#TEXT') { this._text = String(v); return; }
        this.children = [];
        if (v != null && v !== '') { var t = new Elem('#text'); t._text = String(v); this.appendChild(t); }
    }
});
Object.defineProperty(Elem.prototype, 'innerHTML', {
    get: function () { return ''; },
    set: function (v) { if (v !== '') throw new Error('innerHTML avec contenu : ' + v); this.children = []; this._text = ''; }
});
Elem.prototype.appendChild = function (c) { if (c.parentNode) c.remove(); c.parentNode = this; this.children.push(c); return c; };
Elem.prototype.insertBefore = function (c, ref) {
    if (c.parentNode) c.remove();
    var i = this.children.indexOf(ref); c.parentNode = this;
    if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
    return c;
};
Elem.prototype.remove = function () {
    if (!this.parentNode) return;
    var l = this.parentNode.children; l.splice(l.indexOf(this), 1); this.parentNode = null;
};
Elem.prototype.replaceWith = function (n) { var p = this.parentNode; p.insertBefore(n, this); this.remove(); };
Elem.prototype.addEventListener = function (t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); };
Elem.prototype.setAttribute = function (k, v) { this.attrs[k] = v; };
Elem.prototype.focus = function () {};
function tous(racine) { var r = [racine]; racine.children.forEach(function (c) { r = r.concat(tous(c)); }); return r; }
function trouver(racine, f) { return tous(racine).filter(f); }
function bouton(racine, texte) { return trouver(racine, function (e) { return (e.tagName === 'BUTTON' || e.tagName === 'A') && e.textContent === texte; })[0]; }
async function declencher(e, type) {
    var p = (e.listeners[type] || []).map(function (f) { return f({ preventDefault: function () {} }); });
    await Promise.all(p); await attendre();
}
function attendre() { return new Promise(function (r) { setTimeout(r, 5); }); }

function page_(fichier, opts) {
    var ids = {};
    ['ej-contenu', 'ej-titre', 'ann-contenu'].forEach(function (id) { ids[id] = new Elem('div'); });
    var stockage = {}; if (opts.jeton) stockage['rebond-espace-joueur'] = JSON.stringify(opts.jeton);
    var appels = [];
    var supa = { rpc: function (nom, args) { appels.push({ nom: nom, args: args }); return Promise.resolve(opts.rpc(nom, args) || { data: null, error: null }); } };
    var ctx = {
        document: {
            readyState: 'complete',
            getElementById: function (id) { return ids[id]; },
            createElement: function (t) { return new Elem(t); },
            createElementNS: function (ns, t) { return new Elem(t); },
            createTextNode: function (t) { var e = new Elem('#text'); e._text = String(t); return e; }
        },
        localStorage: {
            getItem: function (k) { return k in stockage ? stockage[k] : null; },
            setItem: function (k, v) { stockage[k] = String(v); },
            removeItem: function (k) { delete stockage[k]; }
        },
        location: { search: opts.search || '', pathname: '/' },
        history: { replaceState: function () {} },
        URLSearchParams: URLSearchParams, URL: URL, setTimeout: setTimeout, console: console, Promise: Promise,
        alert: function (m) { ctx.alertes.push(m); }, confirm: function () { return true; }, prompt: function () { return opts.motif || null; },
        alertes: [],
        FFTRecherche: { moisAffiche: function (m) { return String(m); }, formaterNombre: function (n) { return String(n); } },
        FFTBareme: { CATEGORIES: ['P100'], points: function () { return 10; }, grille: function () { return []; } }
    };
    ctx.window = ctx; ctx.window.LeRebondSupa = supa;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(fichier, 'utf8'), ctx);
    return { ids: ids, appels: appels, stockage: stockage, ctx: ctx };
}

var ESPACE = { joueur: { prenom: 'Marc', nom: 'Durand', fft_rang: 5000, fft_points: 120, fft_mois: '2026-11-01', email: 'marc@exemple.fr', telephone: '0611223344' },
               historique_classement: [], inscriptions: [], historique: [], partenaires: [] };
var PROFIL = { prenom: 'Marc', fft_rang: 5000, non_lus: 2,
               profil: { cote: 'droite', niveau_declare: null, dispos: ['semaine_soir'], presentation: 'Mardi soir', ouvert: true } };
var CONVS = [{ ref: 'id-alice', prenom: 'Alice', initiale: 'M.', dernier: { extrait: 'On joue ?', date: '2026-11-22T18:00:00Z', de_moi: false }, non_lus: 2, bloque: false }];

function rpcEspace(absente) {
    return function (nom) {
        if (nom === 'espace_joueur') return { data: JSON.parse(JSON.stringify(ESPACE)), error: null };
        if (nom === 'espace_joueur_recherches') return { data: [], error: null };
        if (absente) return { data: null, error: { code: absente, message: 'Could not find the function public.' + nom } };
        if (nom === 'mon_profil') return { data: PROFIL, error: null };
        if (nom === 'mes_conversations') return { data: CONVS, error: null };
        if (nom === 'conversation') return { data: { avec: { ref: 'id-alice', prenom: 'Alice', initiale: 'M.' }, bloque: false,
            messages: [{ id: 'm1', de_moi: false, texte: '<b>On joue ?</b>', cree_le: '2026-11-22T18:00:00Z' }] }, error: null };
        return { data: null, error: null };
    };
}

(async function () {
    console.log('\n=== Espace joueur : nouveaux blocs ===');
    for (var code_ of ['PGRST202', '42883']) {
        var p = page_('../js/espace-joueur.js', { jeton: 'jeton-marc', rpc: rpcEspace(code_) });
        await attendre();
        var t = p.ids['ej-contenu'].textContent;
        check('migration absente (' + code_ + ') : l\'espace marche comme avant, sans les nouveaux blocs',
              /Mon classement FFT/.test(t) && /Mes inscriptions/.test(t) && /Simulateur de points FFT/.test(t)
              && !/Mon profil joueur/.test(t) && !/Messages/.test(t) && p.stockage['rebond-espace-joueur'] === '"jeton-marc"');
    }
    var p = page_('../js/espace-joueur.js', { jeton: 'jeton-marc', rpc: rpcEspace(null), motif: 'Insistant' });
    await attendre();
    var zone = p.ids['ej-contenu'];
    var titres = trouver(zone, function (e) { return e.tagName === 'H2'; }).map(function (e) { return e.textContent; });
    check('migration appliquée : profil et messages juste après le classement',
          titres[0] === 'Mon classement FFT' && titres[1] === 'Mon profil joueur' && /^Messages/.test(titres[2]) && titres[3] === 'Mes inscriptions', titres.join(' | '));
    var t2 = zone.textContent;
    check('profil : case annuaire, disponibilités, lien vers l\'annuaire',
          /Apparaître dans l'annuaire des joueurs \(ouvert aux propositions\)/.test(t2) && /Semaine soir/.test(t2)
          && bouton(zone, 'Trouver un partenaire →').href === 'joueurs/' && !!bouton(zone, 'Supprimer mon profil'));
    check('profil : pas de niveau déclaré pour un joueur classé', !/Mon niveau/.test(t2));
    check('messages : conversation avec badge des non lus', /Alice M\./.test(t2) && trouver(zone, function (e) { return e.className === 'msg-badge' && e.textContent === '2'; }).length >= 1);
    var conv = trouver(zone, function (e) { return /^msg-conv/.test(e.className) && e.tagName === 'BUTTON'; })[0];
    await declencher(conv, 'click');
    var t3 = zone.textContent;
    check('clic : fil, réponse, Bloquer, Signaler', /<b>On joue \?<\/b>/.test(t3) && !!bouton(zone, 'Envoyer') && !!bouton(zone, 'Bloquer') && !!bouton(zone, 'Signaler au club'));
    check('le texte d\'un message reste du texte (pas de balise créée)', trouver(zone, function (e) { return e.tagName === 'B'; }).length === 0);
    check('ouvrir la conversation appelle conversation(p_jeton, p_avec)', p.appels.some(function (a) { return a.nom === 'conversation' && a.args.p_avec === 'id-alice' && a.args.p_jeton === 'jeton-marc'; }));
    var form = trouver(zone, function (e) { return e.className === 'msg-reponse'; })[0];
    trouver(form, function (e) { return e.tagName === 'TEXTAREA'; })[0].value = 'Oui, jeudi 19h';
    await declencher(form, 'submit');
    check('répondre : envoyer_message(p_jeton, p_dest, p_texte)', p.appels.some(function (a) { return a.nom === 'envoyer_message' && a.args.p_dest === 'id-alice' && a.args.p_texte === 'Oui, jeudi 19h'; }));
    await declencher(bouton(zone, 'Signaler au club'), 'click');
    check('signaler : signaler_joueur avec le motif', p.appels.some(function (a) { return a.nom === 'signaler_joueur' && a.args.p_motif === 'Insistant'; }));
    await declencher(bouton(zone, 'Bloquer'), 'click');
    check('bloquer : bloquer_joueur(p_bloquer = true)', p.appels.some(function (a) { return a.nom === 'bloquer_joueur' && a.args.p_bloquer === true; }));
    check('l\'espace n\'affiche jamais les coordonnées dans les nouveaux blocs',
          trouver(zone, function (e) { return /ann-profil|msg-carte/.test(e.className); }).every(function (e) { return !/marc@exemple\.fr|0611223344/.test(e.textContent); }));

    // Enregistrer le profil
    var p2 = page_('../js/espace-joueur.js', { jeton: 'jeton-bruno', rpc: function (nom, args) {
        if (nom === 'espace_joueur') { var d = JSON.parse(JSON.stringify(ESPACE)); d.joueur.fft_rang = null; d.joueur.fft_statut = 'non_classe'; return { data: d }; }
        if (nom === 'mon_profil') return { data: { prenom: 'Bruno', fft_rang: null, non_lus: 0, profil: null } };
        if (nom === 'enregistrer_profil') return { data: { prenom: 'Bruno', non_lus: 0, profil: args.p } };
        if (nom === 'mes_conversations' || nom === 'espace_joueur_recherches') return { data: [] };
    } });
    await attendre();
    var z2 = p2.ids['ej-contenu'];
    check('non classé : choix du niveau 1 Débutant … 8 Expert', /1 — Débutant/.test(z2.textContent) && /8 — Expert/.test(z2.textContent));
    check('sans profil : case annuaire décochée, pas de « Supprimer »', !bouton(z2, 'Supprimer mon profil')
          && trouver(z2, function (e) { return e.type === 'checkbox' && e.checked; }).length === 0);
    check('sans conversation : invitation vers l\'annuaire', /Aucun message pour l'instant/.test(z2.textContent));
    var fp = trouver(z2, function (e) { return e.tagName === 'FORM' && e.parentNode && /ann-profil/.test(e.parentNode.className); })[0];
    trouver(fp, function (e) { return e.tagName === 'SELECT'; })[1].value = '3';
    trouver(fp, function (e) { return e.type === 'checkbox' && e.value === 'weekend_matin'; })[0].checked = true;
    trouver(fp, function (e) { return e.type === 'checkbox' && !e.value; })[0].checked = true;
    await declencher(fp, 'submit');
    var envoi = p2.appels.filter(function (a) { return a.nom === 'enregistrer_profil'; })[0];
    check('enregistrer_profil(p_jeton, p) : niveau, dispos cochées, case annuaire',
          envoi && envoi.args.p_jeton === 'jeton-bruno' && envoi.args.p.niveau_declare === 3
          && JSON.stringify(envoi.args.p.dispos) === '["weekend_matin"]' && envoi.args.p.ouvert === true, envoi && JSON.stringify(envoi.args));
    check('après enregistrement : confirmation et lien « Supprimer mon profil »',
          /vous apparaissez dans l'annuaire/.test(z2.textContent) && !!bouton(z2, 'Supprimer mon profil'));

    console.log('\n=== Annuaire ===');
    var a1 = page_('../js/annuaire-joueurs.js', { rpc: function () { return { data: [] }; } });
    await attendre();
    check('sans lien : explication + formulaire « Recevoir mon lien », aucune donnée demandée',
          /Réservé aux joueurs du club/.test(a1.ids['ann-contenu'].textContent) && !!bouton(a1.ids['ann-contenu'], 'Recevoir mon lien')
          && a1.appels.length === 0);
    var fl = trouver(a1.ids['ann-contenu'], function (e) { return e.tagName === 'FORM'; })[0];
    trouver(fl, function (e) { return e.tagName === 'INPUT'; })[0].value = 'x@exemple.fr';
    await declencher(fl, 'submit');
    check('sans lien : envoyer_mon_lien(p_email)', a1.appels.length === 1 && a1.appels[0].nom === 'envoyer_mon_lien' && a1.appels[0].args.p_email === 'x@exemple.fr');

    var a2 = page_('../js/annuaire-joueurs.js', { jeton: 'faux', rpc: function () { return { data: null, error: { code: '42501', message: 'Lien inconnu ou expiré' } }; } });
    await attendre();
    check('lien refusé : oublié sur cet appareil, retour à l\'explication',
          /n'est plus valable/.test(a2.ids['ann-contenu'].textContent) && !('rebond-espace-joueur' in a2.stockage));
    var a2b = page_('../js/annuaire-joueurs.js', { jeton: 'j', rpc: function () { return { data: null, error: { code: '', message: 'TypeError: Failed to fetch' } }; } });
    await attendre();
    check('panne passagère (réseau, 500) : message d\'attente, le lien est gardé',
          /Impossible de charger l'annuaire/.test(a2b.ids['ann-contenu'].textContent) && a2b.stockage['rebond-espace-joueur'] === '"j"');
    var a3 = page_('../js/annuaire-joueurs.js', { jeton: 'j', rpc: function () { return { data: null, error: { code: 'PGRST202', message: 'x' } }; } });
    await attendre();
    check('migration absente : message d\'attente, le lien est gardé',
          /arrive très bientôt/.test(a3.ids['ann-contenu'].textContent) && a3.stockage['rebond-espace-joueur'] === '"j"');

    var LISTE = [
        { ref: 'id-alice', prenom: 'Alice', initiale: 'M.', genre: 'F', fft_rang: 1200, niveau_declare: null, cote: 'gauche',
          dispos: ['weekend_matin'], presentation: '<img src=x onerror=alert(1)>', nb_tournois: 2, meilleure_place: 1 },
        { ref: 'id-bruno', prenom: 'Bruno', initiale: 'P.', genre: 'H', fft_rang: null, niveau_declare: 4, cote: 'droite',
          dispos: [], presentation: null, nb_tournois: 0, meilleure_place: null }];
    var a4 = page_('../js/annuaire-joueurs.js', { jeton: 'jeton-marc', rpc: function (nom, args) {
        if (nom === 'mon_profil') return { data: { prenom: 'Marc', profil: null, non_lus: 0 } };
        if (nom === 'annuaire_joueurs') return { data: LISTE };
        if (nom === 'fiche_joueur') return { data: { tournois: [{ date: '2026-10-10', tournoi: 'P100 Automne', place: 1 }], historique_classement: [{ mois: '2026-11-01', rang: 1200 }] } };
        if (nom === 'envoyer_message') return { data: { id: 'm' } };
    } });
    await attendre();
    var za = a4.ids['ann-contenu'];
    var ta = za.textContent;
    check('sans profil ouvert : bandeau vers l\'espace joueur', /pas encore dans l'annuaire/.test(ta) && bouton(za, 'Créer mon profil →').href === 'espace-joueur/');
    check('cartes : prénom + initiale, rang FFT ou niveau déclaré, côté, dispos, tournois',
          /Alice M\./.test(ta) && /1\s?200e FFT/.test(ta) && /Niveau 4\/8 · Intermédiaire/.test(ta) && /Côté gauche/.test(ta)
          && /Week-end matin/.test(ta) && /2 tournois joués au Rebond · meilleure place : 1re/.test(ta));
    check('présentation affichée en texte, aucune balise créée', /<img src=x/.test(ta) && trouver(za, function (e) { return e.tagName === 'IMG'; }).length === 0);
    var appelAnn = a4.appels.filter(function (a) { return a.nom === 'annuaire_joueurs'; })[0];
    check('annuaire_joueurs(p_jeton, p_filtres)', appelAnn && appelAnn.args.p_jeton === 'jeton-marc' && JSON.stringify(appelAnn.args.p_filtres) === '{}');
    var filtres = trouver(za, function (e) { return /ann-filtres/.test(e.className); })[0];
    var sel = trouver(filtres, function (e) { return e.tagName === 'SELECT'; });
    var inp = trouver(filtres, function (e) { return e.tagName === 'INPUT'; });
    check('filtres : genre, côté, disponibilité, rang FFT max, texte', sel.length === 3 && inp.length === 2);
    sel[0].value = 'F'; sel[2].value = 'weekend_matin'; inp[0].value = '2000'; inp[1].value = ' revers ';
    await declencher(filtres, 'submit');
    var dernier = a4.appels.filter(function (a) { return a.nom === 'annuaire_joueurs'; }).pop();
    check('filtres transmis', JSON.stringify(dernier.args.p_filtres) === JSON.stringify({ genre: 'F', dispo: 'weekend_matin', rang_max: 2000, texte: 'revers' }),
          JSON.stringify(dernier.args.p_filtres));
    var carte = trouver(za, function (e) { return e.className === 'ann-carte'; })[0];
    await declencher(bouton(carte, 'Voir le profil'), 'click');
    check('« Voir le profil » : fiche dépliée (tournois, classement)', /P100 Automne/.test(carte.textContent) && /1\s?200e/.test(carte.textContent)
          && a4.appels.some(function (a) { return a.nom === 'fiche_joueur' && a.args.p_joueur === 'id-alice'; }));
    await declencher(bouton(carte, 'Proposer de jouer'), 'click');
    var fm = trouver(carte, function (e) { return e.tagName === 'FORM'; })[0];
    trouver(fm, function (e) { return e.tagName === 'TEXTAREA'; })[0].value = 'Partante pour samedi ?';
    await declencher(fm, 'submit');
    check('« Proposer de jouer » : envoyer_message puis confirmation',
          a4.appels.some(function (a) { return a.nom === 'envoyer_message' && a.args.p_dest === 'id-alice' && a.args.p_texte === 'Partante pour samedi ?'; })
          && /Message envoyé à Alice/.test(carte.textContent));
    check('après l\'envoi : formulaire retiré (ni « Envoyer » ni « Proposer de jouer » ni zone de texte), pas de double envoi',
          !bouton(carte, 'Envoyer') && !bouton(carte, 'Proposer de jouer') && trouver(carte, function (e) { return e.tagName === 'TEXTAREA'; }).length === 0
          && a4.appels.filter(function (a) { return a.nom === 'envoyer_message'; }).length === 1);
    var css = fs.readFileSync('../css/tournois.css', 'utf8');
    check('CSS : .btn[hidden] masqué dans les nouveaux blocs', /\.ann-carte \.btn\[hidden\][^{]*\{ display: none; \}/.test(css));

    var a5 = page_('../js/annuaire-joueurs.js', { jeton: 'jeton-marc', rpc: function (nom) {
        if (nom === 'mon_profil') return { data: { prenom: 'Marc', profil: { ouvert: true }, non_lus: 0 } };
        if (nom === 'annuaire_joueurs') return { data: [] };
    } });
    await attendre();
    check('profil ouvert : pas de bandeau', !trouver(a5.ids['ann-contenu'], function (e) { return e.className === 'ann-bandeau'; }).length
          && /Aucun joueur ne correspond/.test(a5.ids['ann-contenu'].textContent));

    console.log(ko ? '\n' + ko + ' échec(s)' : '\nTout est vert.');
    process.exit(ko ? 1 : 0);
})().catch(function (e) { console.log('  FAIL exception : ' + (e && e.stack || e)); process.exit(1); });
