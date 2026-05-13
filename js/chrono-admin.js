/* ============================================
   CHRONO ADMIN
   - Login Supabase (email + password)
   - Start / Pause / Reset → écrit dans table chronos
   - Affiche preview du chrono en direct (réutilise la même logique de calcul)
   ============================================ */
(function () {
    var supa = window.LeRebondSupa;
    if (!supa) { alert('Erreur: Supabase non initialisé'); return; }

    // Elements
    var loginView = document.getElementById('login-view');
    var adminView = document.getElementById('admin-view');
    var loginForm = document.getElementById('login-form');
    var loginError = document.getElementById('login-error');
    var loginEmail = document.getElementById('login-email');
    var loginPassword = document.getElementById('login-password');
    var btnLogout = document.getElementById('btn-logout');
    var userEmail = document.getElementById('user-email');

    var display = document.getElementById('display');
    var statusEl = document.getElementById('status');
    var progress = document.getElementById('progress');
    var inputMin = document.getElementById('input-min');
    var inputSec = document.getElementById('input-sec');
    var inputNom = document.getElementById('input-nom');
    var btnStart = document.getElementById('btn-start');
    var btnPause = document.getElementById('btn-pause');
    var btnReset = document.getElementById('btn-reset');
    var btnApply = document.getElementById('btn-apply');
    var presetBtns = document.querySelectorAll('.preset-btn');

    var chronoState = null;
    var rafId = null;

    function format(secs) {
        if (secs < 0) secs = 0;
        var h = Math.floor(secs / 3600);
        var m = Math.floor((secs % 3600) / 60);
        var s = Math.floor(secs % 60);
        if (h > 0) {
            return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
        }
        return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    }

    function computeRemaining() {
        if (!chronoState) return { remaining: 0, total: 0 };
        var total = chronoState.duree_secondes || 0;
        var status = chronoState.status;
        if (status === 'idle') return { remaining: total, total: total };
        if (status === 'paused') return { remaining: chronoState.paused_remaining || 0, total: total };
        if (status === 'finished') return { remaining: 0, total: total };
        if (status === 'running') {
            var startedAt = new Date(chronoState.started_at).getTime();
            var elapsed = (Date.now() - startedAt) / 1000;
            return { remaining: total - elapsed, total: total };
        }
        return { remaining: total, total: total };
    }

    function render() {
        var calc = computeRemaining();
        var remaining = Math.max(0, calc.remaining);
        var pct = calc.total > 0 ? ((calc.total - remaining) / calc.total) * 100 : 0;
        if (pct > 100) pct = 100;

        display.textContent = format(remaining);
        progress.style.width = pct + '%';

        display.classList.remove('warning', 'danger', 'finished', 'idle');
        progress.classList.remove('warning', 'danger');

        if (!chronoState || chronoState.status === 'idle') {
            statusEl.textContent = 'En attente';
            display.classList.add('idle');
            btnStart.disabled = false;
            btnPause.disabled = true;
            btnReset.disabled = false;
        } else if (chronoState.status === 'paused') {
            statusEl.textContent = '⏸ En pause';
            display.classList.add('warning');
            btnStart.disabled = false;
            btnPause.disabled = true;
            btnReset.disabled = false;
        } else if (chronoState.status === 'finished' || remaining <= 0) {
            statusEl.textContent = '✓ Terminé';
            display.classList.add('finished');
            display.textContent = '00:00';
            progress.style.width = '100%';
            btnStart.disabled = false;
            btnPause.disabled = true;
            btnReset.disabled = false;
            // Auto-mark finished
            if (chronoState.status === 'running' && remaining <= 0) {
                supa.from('chronos').update({ status: 'finished', updated_at: new Date().toISOString() }).eq('id', 'main');
            }
        } else if (chronoState.status === 'running') {
            statusEl.textContent = '● En cours';
            btnStart.disabled = true;
            btnPause.disabled = false;
            btnReset.disabled = false;
            if (remaining <= 10) {
                display.classList.add('danger');
                progress.classList.add('danger');
            } else if (remaining <= 30) {
                display.classList.add('warning');
                progress.classList.add('warning');
            }
        }
    }

    function loop() {
        render();
        rafId = requestAnimationFrame(loop);
    }

    async function loadChrono() {
        var res = await supa.from('chronos').select('*').eq('id', 'main').single();
        if (res.data) {
            chronoState = res.data;
            inputNom.value = res.data.nom || '';
            if (chronoState.status === 'idle') {
                var d = chronoState.duree_secondes || 0;
                inputMin.value = Math.floor(d / 60);
                inputSec.value = d % 60;
            }
            render();
        }
    }

    function subscribe() {
        supa.channel('chronos-admin')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'chronos', filter: 'id=eq.main' }, function (payload) {
                if (payload.new) {
                    chronoState = payload.new;
                    render();
                }
            })
            .subscribe();
    }

    // Actions admin

    async function startChrono() {
        var m = parseInt(inputMin.value) || 0;
        var s = parseInt(inputSec.value) || 0;
        var duree = m * 60 + s;

        if (duree === 0 && (!chronoState || chronoState.status !== 'paused')) {
            alert('Définis une durée d\'abord !');
            return;
        }

        if (chronoState && chronoState.status === 'paused') {
            // Reprise : on calcule un started_at à partir du remaining
            var pausedRem = chronoState.paused_remaining || 0;
            var newStartedAt = new Date(Date.now() - (chronoState.duree_secondes - pausedRem) * 1000);
            await supa.from('chronos').update({
                status: 'running',
                started_at: newStartedAt.toISOString(),
                paused_remaining: null,
                paused_at: null,
                nom: inputNom.value || 'Chrono',
                updated_at: new Date().toISOString()
            }).eq('id', 'main');
        } else {
            await supa.from('chronos').update({
                status: 'running',
                duree_secondes: duree,
                started_at: new Date().toISOString(),
                paused_remaining: null,
                paused_at: null,
                nom: inputNom.value || 'Chrono',
                updated_at: new Date().toISOString()
            }).eq('id', 'main');
        }
    }

    async function pauseChrono() {
        if (!chronoState || chronoState.status !== 'running') return;
        var calc = computeRemaining();
        var remaining = Math.max(0, Math.floor(calc.remaining));
        await supa.from('chronos').update({
            status: 'paused',
            paused_at: new Date().toISOString(),
            paused_remaining: remaining,
            updated_at: new Date().toISOString()
        }).eq('id', 'main');
    }

    async function resetChrono() {
        await supa.from('chronos').update({
            status: 'idle',
            started_at: null,
            paused_at: null,
            paused_remaining: null,
            updated_at: new Date().toISOString()
        }).eq('id', 'main');
    }

    async function applySettings() {
        var m = parseInt(inputMin.value) || 0;
        var s = parseInt(inputSec.value) || 0;
        var duree = m * 60 + s;
        await supa.from('chronos').update({
            duree_secondes: duree,
            nom: inputNom.value || 'Chrono',
            status: 'idle',
            started_at: null,
            paused_at: null,
            paused_remaining: null,
            updated_at: new Date().toISOString()
        }).eq('id', 'main');
    }

    btnStart.addEventListener('click', startChrono);
    btnPause.addEventListener('click', pauseChrono);
    btnReset.addEventListener('click', resetChrono);
    btnApply.addEventListener('click', applySettings);

    presetBtns.forEach(function (b) {
        b.addEventListener('click', function () {
            inputMin.value = b.dataset.min;
            inputSec.value = b.dataset.sec || 0;
            inputNom.value = b.dataset.nom || inputNom.value;
        });
    });

    // Auth
    async function checkAuth() {
        var res = await supa.auth.getSession();
        if (res.data && res.data.session) {
            showAdmin(res.data.session.user);
        } else {
            showLogin();
        }
    }

    function showLogin() {
        loginView.style.display = '';
        adminView.style.display = 'none';
    }

    function showAdmin(user) {
        loginView.style.display = 'none';
        adminView.style.display = '';
        userEmail.textContent = user.email;
        loadChrono().then(function () {
            subscribe();
            loop();
        });
    }

    loginForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        loginError.textContent = '';
        var email = loginEmail.value.trim();
        var password = loginPassword.value;
        var res = await supa.auth.signInWithPassword({ email: email, password: password });
        if (res.error) {
            loginError.textContent = 'Erreur : ' + res.error.message;
        } else {
            showAdmin(res.data.user);
        }
    });

    btnLogout.addEventListener('click', async function () {
        await supa.auth.signOut();
        if (rafId) cancelAnimationFrame(rafId);
        showLogin();
    });

    checkAuth();
})();
