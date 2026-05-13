/* ============================================
   SUPABASE CLIENT (Le Rebond)
   Initialise le client Supabase à partir de window.REBOND_CONFIG
   défini dans js/resa-config.js (injecté au build via GitHub Actions).
   ============================================ */
(function () {
    if (!window.REBOND_CONFIG || !window.REBOND_CONFIG.SUPABASE_URL || !window.REBOND_CONFIG.SUPABASE_ANON_KEY) {
        console.error('REBOND_CONFIG manquant. Vérifie que js/resa-config.min.js est chargé avant.');
        return;
    }
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
        console.error('Supabase SDK non chargé. Vérifie js/vendor/supabase.min.js.');
        return;
    }
    window.LeRebondSupa = window.supabase.createClient(
        window.REBOND_CONFIG.SUPABASE_URL,
        window.REBOND_CONFIG.SUPABASE_ANON_KEY
    );
})();
