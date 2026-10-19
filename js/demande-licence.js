/* ============================================
   DEMANDE DE LICENCE FFT (page /licence/)
   Le joueur envoie ses informations ; le club est prévenu par e-mail et le
   recontacte pour le règlement et la création de la licence sur Ten'Up.
   ============================================ */
(function () {
    var supa = window.LeRebondSupa;
    var CLE_PROFIL = 'rebond-inscription-profil';

    function $(id) { return document.getElementById(id); }
    function el(tag, cls, texte) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (texte != null) e.textContent = texte;
        return e;
    }

    function init() {
        var form = $('lic-form');
        if (!form || !supa) return;
        try {
            var p = JSON.parse(localStorage.getItem(CLE_PROFIL) || 'null');
            if (p) ['prenom', 'nom', 'email', 'telephone'].forEach(function (k) { if (p[k] && form[k]) form[k].value = p[k]; });
        } catch (e) { /* navigation privée */ }
        form.addEventListener('submit', async function (e) {
            e.preventDefault();
            var alerte = $('lic-alerte');
            if (form.site.value) return;   // piège à robots
            if (!form.accord.checked) {
                alerte.hidden = false; alerte.className = 'ins-alerte ins-alerte--erreur';
                alerte.textContent = 'Merci de cocher la case d\'accord sur l\'usage de vos informations.';
                return;
            }
            var donnees = {};
            ['prenom', 'nom', 'sexe', 'date_naissance', 'nationalite', 'email', 'telephone', 'adresse', 'code_postal', 'ville', 'message']
                .forEach(function (k) { donnees[k] = form[k] ? form[k].value.trim() : ''; });
            var bouton = form.querySelector('button[type=submit]');
            bouton.disabled = true;
            var res = await supa.rpc('demander_licence', { p: donnees });
            bouton.disabled = false;
            alerte.hidden = false;
            if (res.error) {
                alerte.className = 'ins-alerte ins-alerte--erreur';
                alerte.textContent = res.error.message;
                return;
            }
            form.hidden = true;
            var ok = $('lic-ok');
            ok.hidden = false;
            ok.querySelector('.lic-ok__prenom').textContent = donnees.prenom;
            ok.scrollIntoView({ block: 'center' });
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
