/* ============================================
   EVENTS RENDERER
   Fetches /data/events.json and renders event cards
   ============================================ */
(function () {
    var MONTHS = ['Janv.', 'Fév.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.'];

    // SVG icons
    var SVG_STAR = '<svg fill="none" height="18" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewbox="0 0 24 24" width="18"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>';
    var SVG_CLOCK = '<svg fill="none" height="18" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewbox="0 0 24 24" width="18"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>';
    var SVG_PEOPLE = '<svg fill="none" height="18" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewbox="0 0 24 24" width="18"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>';
    var SVG_MONEY = '<svg fill="none" height="18" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewbox="0 0 24 24" width="18"><line x1="12" x2="12" y1="1" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>';
    var SVG_HOURGLASS = '<svg fill="none" height="12" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewbox="0 0 24 24" width="12"><path d="M6 2h12"></path><path d="M6 2c0 6 6 6 6 10s-6 4-6 10"></path><path d="M18 2c0 6-6 6-6 10s6 4 6 10"></path><path d="M6 22h12"></path></svg>';
    var SVG_FACEBOOK = '<svg fill="currentColor" height="16" viewbox="0 0 24 24" width="16"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"></path></svg>';
    var SVG_WHATSAPP = '<svg fill="currentColor" height="16" viewbox="0 0 24 24" width="16"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"></path></svg>';
    var SVG_LINK = '<svg fill="none" height="16" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewbox="0 0 24 24" width="16"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>';

    var TYPE_LABELS = { tournoi: 'Tournoi', ligue: 'Ligue', montante: 'Montante', animation: 'Animation' };
    var CATEGORY_LABELS = { padel: 'Padel', five: 'Five' };

    function escapeHtml(str) {
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    function formatDate(dateStr) {
        var d = new Date(dateStr + 'T00:00:00');
        return { day: d.getDate(), month: MONTHS[d.getMonth()] };
    }

    function buildDateBadge(ev) {
        if (ev.coming_soon || !ev.date) {
            return '<div class="event-date-badge">' +
                '<span class="day icon-inline day--sm">Prochainement ' + SVG_HOURGLASS + '</span>' +
                '</div>';
        }
        var d = formatDate(ev.date);
        return '<div class="event-date-badge">' +
            '<span class="day">' + d.day + '</span>' +
            '<span class="month">' + d.month + '</span>' +
            '</div>';
    }

    function buildImage(ev) {
        // For CMS-uploaded images (single file), use simple img tag
        // For legacy images with responsive variants, try picture element
        var src = ev.image || 'img/default-event.webp';
        var alt = escapeHtml(ev.title);
        return '<img alt="' + alt + '" class="event-card-img" decoding="async" height="960" loading="lazy" src="' + src + '" width="1280"/>';
    }

    function buildShareButtons(ev) {
        var url = 'https://le-rebond.fr/evenements/%23' + ev.id;
        var text = encodeURIComponent(ev.title + ' au Rebond Noyon ! https://le-rebond.fr/evenements/#' + ev.id);
        var fullUrl = 'https://le-rebond.fr/evenements/#' + ev.id;

        return '<div class="event-share">' +
            '<span class="event-share__label">Partager</span>' +
            '<div class="event-share__buttons">' +
            '<a aria-label="Partager sur Facebook" class="event-share__btn" href="https://www.facebook.com/sharer/sharer.php?u=' + url + '" rel="noopener" target="_blank" title="Partager sur Facebook">' + SVG_FACEBOOK + '</a>' +
            '<a aria-label="Partager sur WhatsApp" class="event-share__btn" href="https://api.whatsapp.com/send?text=' + text + '" rel="noopener" target="_blank" title="Partager sur WhatsApp">' + SVG_WHATSAPP + '</a>' +
            '<button aria-label="Copier le lien" class="event-share__btn" onclick="navigator.clipboard.writeText(\'' + fullUrl + '\').then(function(){this.title=\'Lien copié !\';var b=this;setTimeout(function(){b.title=\'Copier le lien\'},2000)}.bind(this))" title="Copier le lien">' + SVG_LINK + '</button>' +
            '</div></div>';
    }

    function buildRegistrationButton(ev) {
        if (ev.registration_link && ev.registration_link !== '#' && ev.registration_link !== '') {
            return '<a class="btn btn--primary" href="' + escapeHtml(ev.registration_link) + '" target="_blank" rel="noopener">S\'inscrire</a>';
        }
        if (ev.coming_soon || !ev.date) {
            return '';
        }
        return '<a class="btn btn--primary" href="#" onclick="csOpen();return false">S\'inscrire</a>';
    }

    function buildCard(ev, index) {
        var isFeatured = ev.featured;
        var classes = 'event-card' + (isFeatured ? ' event-card-featured' : '');
        var delay = (index + 1) * 50 + 50;

        var html = '<div class="' + classes + '" data-animate="" data-category="' + ev.category + '" data-delay="' + delay + '" data-type="' + ev.type + '"' + (ev.id ? ' id="' + ev.id + '"' : '') + '>';

        // Image section
        html += '<div class="event-card-image">';
        html += buildImage(ev);
        if (isFeatured) {
            html += '<span class="event-featured-badge">' + SVG_STAR + ' À la une</span>';
        }
        html += buildDateBadge(ev);
        html += '</div>';

        // Content section
        html += '<div class="event-card-content">';

        // Meta
        html += '<div class="event-meta">';
        html += '<span class="event-category ' + ev.category + '">' + (CATEGORY_LABELS[ev.category] || ev.category) + '</span>';
        html += '<span class="event-type">' + (TYPE_LABELS[ev.type] || ev.type) + '</span>';
        html += '</div>';

        // Title & description
        html += '<h3 class="event-card-title">' + escapeHtml(ev.title) + '</h3>';
        html += '<p class="event-card-description">' + escapeHtml(ev.description) + '</p>';

        // Details
        html += '<div class="event-details">';
        html += '<span>' + SVG_CLOCK + ' ' + escapeHtml(ev.time_start) + ' - ' + escapeHtml(ev.time_end) + '</span>';
        html += '<span>' + SVG_PEOPLE + ' ' + escapeHtml(ev.max_participants) + '</span>';
        var priceClass = (ev.price && ev.price.toLowerCase().indexOf('venir') !== -1) ? ' class="event-detail--nowrap"' : '';
        html += '<span' + priceClass + '>' + SVG_MONEY + ' ' + escapeHtml(ev.price) + '</span>';
        html += '</div>';

        // Status
        html += '<div class="event-status">';
        if (ev.coming_soon || !ev.date) {
            html += '<span class="spots-left icon-inline">' + escapeHtml(ev.status_text) + ' ' + SVG_HOURGLASS + '</span>';
        } else {
            html += '<span class="spots-left">' + escapeHtml(ev.status_text) + '</span>';
        }
        html += buildRegistrationButton(ev);
        html += '</div>';

        // Registration note
        if (ev.registration_note) {
            html += '<p style="font-size:.75rem;color:#888;margin:.5rem 0 0;font-style:italic">* ' + escapeHtml(ev.registration_note) + '</p>';
        }

        // Share
        html += buildShareButtons(ev);

        html += '</div>'; // event-card-content
        html += '</div>'; // event-card

        return html;
    }

    function renderEvents(events) {
        var grid = document.querySelector('.events-grid');
        if (!grid) return;

        // Sort: featured first, then by date (dated events before coming_soon), then by order
        events.sort(function (a, b) {
            if (a.featured !== b.featured) return a.featured ? -1 : 1;
            if (a.coming_soon !== b.coming_soon) return a.coming_soon ? 1 : -1;
            if (a.date && b.date) return a.date.localeCompare(b.date);
            return 0;
        });

        var html = '';
        events.forEach(function (ev, i) {
            html += buildCard(ev, i);
        });

        grid.innerHTML = html;

        // Re-initialize filters after rendering
        if (typeof initEventFilters === 'function') {
            initEventFilters();
        }
        // Trigger scroll animations on new cards
        if (typeof initScrollAnimations === 'function') {
            initScrollAnimations();
        }
    }

    function init() {
        var grid = document.querySelector('.events-grid');
        if (!grid) return;

        // Show skeleton while loading
        grid.innerHTML = '<div class="events-loading"><div class="events-loading__spinner"></div><p>Chargement des événements...</p></div>';

        // Determine base path (works from /evenements/ or root)
        var basePath = window.location.pathname.indexOf('/evenements') !== -1 ? '../' : '';

        fetch(basePath + 'data/events.json')
            .then(function (res) { return res.json(); })
            .then(function (data) {
                if (data.events && data.events.length) {
                    renderEvents(data.events);
                } else {
                    grid.innerHTML = '<p class="events-empty">Aucun événement pour le moment. Restez connectés !</p>';
                }
            })
            .catch(function () {
                grid.innerHTML = '<p class="events-empty">Impossible de charger les événements.</p>';
            });
    }

    // Run on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
