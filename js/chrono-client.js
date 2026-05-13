/* ============================================
   CHRONO CLIENT (lecture seule)
   - Récupère le chrono depuis Supabase
   - Calcule localement le temps restant à partir de started_at + duree_secondes
   - S'abonne aux changements Realtime pour pause/start/reset
   ============================================ */
(function () {
    var supa = window.LeRebondSupa;
    if (!supa) { document.getElementById('display').textContent = 'Erreur Supabase'; return; }

    var display = document.getElementById('display');
    var statusEl = document.getElementById('status');
    var nomEl = document.getElementById('chrono-nom');
    var progress = document.getElementById('progress');

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
            var remaining = total - elapsed;
            return { remaining: remaining, total: total };
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
            display.classList.add('idle');
            statusEl.textContent = 'En attente';
        } else if (chronoState.status === 'paused') {
            statusEl.textContent = '⏸ En pause';
            display.classList.add('warning');
        } else if (chronoState.status === 'finished' || (chronoState.status === 'running' && remaining <= 0)) {
            statusEl.textContent = '✓ Terminé !';
            display.classList.add('finished');
            display.textContent = '00:00';
            progress.style.width = '100%';
        } else if (chronoState.status === 'running') {
            statusEl.textContent = '● En cours';
            if (remaining <= 10) {
                display.classList.add('danger');
                progress.classList.add('danger');
            } else if (remaining <= 30) {
                display.classList.add('warning');
                progress.classList.add('warning');
            }
        }

        if (nomEl && chronoState && chronoState.nom) {
            nomEl.textContent = chronoState.nom;
        }

        document.title = format(remaining) + ' — Live Le Rebond';
    }

    function loop() {
        render();
        rafId = requestAnimationFrame(loop);
    }

    async function loadInitial() {
        var res = await supa.from('chronos').select('*').eq('id', 'main').single();
        if (res.data) {
            chronoState = res.data;
            render();
        }
    }

    function subscribe() {
        supa.channel('chronos-realtime')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'chronos', filter: 'id=eq.main' }, function (payload) {
                if (payload.new) {
                    chronoState = payload.new;
                    render();
                }
            })
            .subscribe();
    }

    loadInitial().then(function () {
        subscribe();
        loop();
    });

    // Fullscreen on click
    document.getElementById('fullscreen-btn').addEventListener('click', function () {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(function () { });
        } else {
            document.exitFullscreen();
        }
    });

    // Keyboard
    document.addEventListener('keydown', function (e) {
        if (e.code === 'KeyF') {
            if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(function () { });
            else document.exitFullscreen();
        }
    });
})();
