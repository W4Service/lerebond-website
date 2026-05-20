/* ============================================
   TOURNOI QR — helper pour afficher un QR code dans une popup
   Dépend de /js/vendor/qrcode.min.js
   ============================================ */
(function () {
    function openQRPopup(url, titre) {
        // Supprime une popup existante (cas double clic)
        var existing = document.getElementById('qr-popup-overlay');
        if (existing) existing.remove();

        var overlay = document.createElement('div');
        overlay.id = 'qr-popup-overlay';
        overlay.style.cssText = [
            'position:fixed', 'top:0', 'left:0', 'right:0', 'bottom:0',
            'background:rgba(0,0,0,0.78)', 'z-index:99999',
            'display:flex', 'align-items:center', 'justify-content:center',
            'padding:1rem'
        ].join(';');
        overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };

        var card = document.createElement('div');
        card.style.cssText = [
            'background:#f4f0e6', 'color:#1a1a1a', 'border-radius:16px',
            'padding:1.5rem 1.75rem', 'max-width:380px', 'width:100%',
            'box-shadow:0 20px 60px rgba(0,0,0,0.6)',
            'text-align:center', 'font-family:"Kanit",sans-serif'
        ].join(';');

        var h = document.createElement('h2');
        h.textContent = titre || 'Scanner ce QR code';
        h.style.cssText = 'font-family:"Turret Road",sans-serif;font-weight:800;color:#680920;font-size:1.15rem;letter-spacing:0.05em;margin-bottom:0.5rem;text-transform:uppercase';
        card.appendChild(h);

        var sub = document.createElement('p');
        sub.textContent = 'Pour suivre le tournoi en direct';
        sub.style.cssText = 'color:#555;font-size:0.9rem;margin-bottom:1rem';
        card.appendChild(sub);

        var qrBox = document.createElement('div');
        qrBox.id = 'qr-popup-box';
        qrBox.style.cssText = 'display:flex;justify-content:center;background:#fff;padding:0.75rem;border-radius:12px;margin-bottom:1rem';
        card.appendChild(qrBox);

        // Génération du QR
        try {
            new QRCode(qrBox, {
                text: url,
                width: 280,
                height: 280,
                colorDark: '#680920',
                colorLight: '#ffffff',
                correctLevel: QRCode.CorrectLevel.M
            });
        } catch (err) {
            console.error(err);
            qrBox.textContent = 'Erreur QR : ' + (err.message || err);
        }

        var urlBox = document.createElement('div');
        urlBox.textContent = url;
        urlBox.style.cssText = 'font-family:ui-monospace,Menlo,monospace;font-size:0.82rem;color:#680920;background:rgba(104,9,32,0.08);padding:0.5rem 0.75rem;border-radius:8px;margin-bottom:1rem;word-break:break-all';
        card.appendChild(urlBox);

        var actions = document.createElement('div');
        actions.style.cssText = 'display:flex;gap:0.5rem;justify-content:center;flex-wrap:wrap';

        var btnDl = document.createElement('button');
        btnDl.textContent = '⬇️ Télécharger PNG';
        btnDl.style.cssText = 'padding:0.5rem 1rem;border-radius:8px;border:none;background:#efa707;color:#fff;font-weight:700;cursor:pointer;font-family:inherit';
        btnDl.onclick = function () {
            var img = qrBox.querySelector('img');
            if (!img) {
                // qrcodejs peut générer un canvas
                var cv = qrBox.querySelector('canvas');
                if (cv) {
                    var link = document.createElement('a');
                    link.download = 'tournoi-qr.png';
                    link.href = cv.toDataURL('image/png');
                    link.click();
                }
                return;
            }
            var link = document.createElement('a');
            link.download = 'tournoi-qr.png';
            link.href = img.src;
            link.click();
        };
        actions.appendChild(btnDl);

        var btnCopy = document.createElement('button');
        btnCopy.textContent = '📋 Copier le lien';
        btnCopy.style.cssText = 'padding:0.5rem 1rem;border-radius:8px;border:1px solid #680920;background:#fff;color:#680920;font-weight:700;cursor:pointer;font-family:inherit';
        btnCopy.onclick = function () {
            if (navigator.clipboard) {
                navigator.clipboard.writeText(url).then(function () {
                    btnCopy.textContent = '✓ Copié';
                    setTimeout(function () { btnCopy.textContent = '📋 Copier le lien'; }, 1500);
                });
            }
        };
        actions.appendChild(btnCopy);

        var btnClose = document.createElement('button');
        btnClose.textContent = '✕ Fermer';
        btnClose.style.cssText = 'padding:0.5rem 1rem;border-radius:8px;border:1px solid #999;background:#fff;color:#555;font-weight:600;cursor:pointer;font-family:inherit';
        btnClose.onclick = function () { overlay.remove(); };
        actions.appendChild(btnClose);

        card.appendChild(actions);
        overlay.appendChild(card);
        document.body.appendChild(overlay);
    }

    window.TournoiQR = { open: openQRPopup };
})();
