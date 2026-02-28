/* ============================================
   LE REBOND - MAIN JAVASCRIPT
   Padel & Five à Noyon
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {
    // Initialize all components
    initHeader();
    initMobileNav();
    initScrollAnimations();
    initFAQ();
    initEventFilters();
    initParticles();
    initSmoothScroll();
    initCountdown();
    initReservationPopup();
    initFormSubmit();
    initLazyEmbeds();
    initMobileCta();
});

/* ============================================
   HEADER SCROLL EFFECT
   ============================================ */
function initHeader() {
    const header = document.querySelector('.header');
    if (!header) return;

    let lastScroll = 0;
    const scrollThreshold = 50;

    window.addEventListener('scroll', () => {
        const currentScroll = window.pageYOffset;

        if (currentScroll > scrollThreshold) {
            header.classList.add('scrolled');
        } else {
            header.classList.remove('scrolled');
        }

        lastScroll = currentScroll;
    });
}

/* ============================================
   MOBILE NAVIGATION
   ============================================ */
function initMobileNav() {
    // Support both nav structures: .nav__toggle/.nav (index) and .mobile-menu-toggle/.mobile-nav (secondary pages)
    const toggle = document.querySelector('.nav__toggle') || document.querySelector('.mobile-menu-toggle');
    const nav = document.querySelector('.mobile-nav') || document.querySelector('.nav');
    const navLinks = document.querySelectorAll('.nav__link, .nav-link, .mobile-nav-link');

    if (!toggle || !nav) return;

    if (!nav.id) {
        nav.id = 'site-nav';
    }
    toggle.setAttribute('aria-controls', nav.id);
    toggle.setAttribute('aria-expanded', 'false');

    function setExpanded(isOpen) {
        toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    }

    toggle.addEventListener('click', () => {
        toggle.classList.toggle('active');
        nav.classList.toggle('active');
        const isOpen = nav.classList.contains('active');
        document.body.style.overflow = isOpen ? 'hidden' : '';
        setExpanded(isOpen);
    });

    // Close menu when clicking a link
    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            toggle.classList.remove('active');
            nav.classList.remove('active');
            document.body.style.overflow = '';
            setExpanded(false);
        });
    });

    // Close menu on escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && nav.classList.contains('active')) {
            toggle.classList.remove('active');
            nav.classList.remove('active');
            document.body.style.overflow = '';
            setExpanded(false);
        }
    });
}

/* ============================================
   SCROLL ANIMATIONS
   ============================================ */
function initScrollAnimations() {
    const animatedElements = document.querySelectorAll('[data-animate]');
    
    if (!animatedElements.length) return;

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                // Optionally unobserve after animation
                // observer.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    });

    animatedElements.forEach(el => observer.observe(el));
}

/* ============================================
   FAQ ACCORDION
   ============================================ */
function initFAQ() {
    // Support both BEM (.faq__item) and non-BEM (.faq-item) class names
    const faqItems = document.querySelectorAll('.faq__item, .faq-item');

    if (!faqItems.length) return;

    faqItems.forEach(item => {
        const question = item.querySelector('.faq__question, .faq-question');
        const answer = item.querySelector('.faq__answer, .faq-answer');

        if (!question || !answer) return;

        question.addEventListener('click', () => {
            const isActive = item.classList.contains('active');

            // Close all other items
            faqItems.forEach(otherItem => {
                if (otherItem !== item) {
                    otherItem.classList.remove('active');
                }
            });

            // Toggle current item
            item.classList.toggle('active');
        });
    });
}

/* ============================================
   EVENT FILTERS
   ============================================ */
function initEventFilters() {
    const eventCards = document.querySelectorAll('.event-card');
    if (!eventCards.length) return;

    // Track active filters
    let activeCategory = 'all';
    let activeType = 'all';

    function applyFilters() {
        eventCards.forEach(card => {
            const category = card.dataset.category;
            const type = card.dataset.type;

            const matchCategory = activeCategory === 'all' || category === activeCategory;
            const matchType = activeType === 'all' || type === activeType;

            if (matchCategory && matchType) {
                card.style.display = '';
                card.style.opacity = '0';
                card.style.transform = 'translateY(20px)';

                setTimeout(() => {
                    card.style.transition = 'all 0.4s ease';
                    card.style.opacity = '1';
                    card.style.transform = 'translateY(0)';
                }, 50);
            } else {
                card.style.opacity = '0';
                card.style.transform = 'translateY(20px)';

                setTimeout(() => {
                    card.style.display = 'none';
                }, 400);
            }
        });
    }

    // Category filter buttons (data-filter)
    document.querySelectorAll('[data-filter]').forEach(btn => {
        btn.addEventListener('click', () => {
            activeCategory = btn.dataset.filter;
            // Update active state within same filter group
            const siblings = btn.closest('.filter-buttons, .event-filters')?.querySelectorAll('[data-filter]') || document.querySelectorAll('[data-filter]');
            siblings.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            applyFilters();
        });
    });

    // Type filter buttons (data-filter-type)
    document.querySelectorAll('[data-filter-type]').forEach(btn => {
        btn.addEventListener('click', () => {
            activeType = btn.dataset.filterType;
            const siblings = btn.closest('.filter-buttons')?.querySelectorAll('[data-filter-type]') || document.querySelectorAll('[data-filter-type]');
            siblings.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            applyFilters();
        });
    });
}

/* ============================================
   PARTICLES BACKGROUND (Lightweight)
   ============================================ */
function initParticles() {
    const canvas = document.getElementById('particles-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    let particles = [];
    let animationId;
    let isVisible = true;
    let particleColor = { r: 206, g: 195, b: 182 }; // Default --secondary (tombstone-grey)

    // Function to get --secondary color from CSS and convert to RGB
    function updateParticleColor() {
        const style = getComputedStyle(document.documentElement);
        const secondaryColor = style.getPropertyValue('--secondary').trim();

        console.log('Particle color update - secondary:', secondaryColor);

        // Convert hex to RGB
        if (secondaryColor.startsWith('#')) {
            const hex = secondaryColor.slice(1);
            particleColor = {
                r: parseInt(hex.substring(0, 2), 16),
                g: parseInt(hex.substring(2, 4), 16),
                b: parseInt(hex.substring(4, 6), 16)
            };
            console.log('Particle color set to:', particleColor);
        }
        // Handle rgb() format
        else if (secondaryColor.startsWith('rgb')) {
            const match = secondaryColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
            if (match) {
                particleColor = {
                    r: parseInt(match[1]),
                    g: parseInt(match[2]),
                    b: parseInt(match[3])
                };
                console.log('Particle color set to (rgb):', particleColor);
            }
        }
    }

    // Check if device might have performance issues
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const particleCount = isMobile ? 30 : 60;

    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }

    function createParticle() {
        return {
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            radius: Math.random() * 2 + 1,
            vx: (Math.random() - 0.5) * 0.5,
            vy: (Math.random() - 0.5) * 0.5,
            alpha: Math.random() * 0.5 + 0.2
        };
    }

    function init() {
        resize();
        updateParticleColor();
        particles = [];
        for (let i = 0; i < particleCount; i++) {
            particles.push(createParticle());
        }
    }

    function draw() {
        if (!isVisible) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        particles.forEach((p, i) => {
            // Update position
            p.x += p.vx;
            p.y += p.vy;

            // Wrap around edges
            if (p.x < 0) p.x = canvas.width;
            if (p.x > canvas.width) p.x = 0;
            if (p.y < 0) p.y = canvas.height;
            if (p.y > canvas.height) p.y = 0;

            // Draw particle
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${particleColor.r}, ${particleColor.g}, ${particleColor.b}, ${p.alpha})`;
            ctx.fill();

            // Draw connections (only to nearby particles)
            particles.slice(i + 1).forEach(p2 => {
                const dx = p.x - p2.x;
                const dy = p.y - p2.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < 150) {
                    ctx.beginPath();
                    ctx.moveTo(p.x, p.y);
                    ctx.lineTo(p2.x, p2.y);
                    ctx.strokeStyle = `rgba(${particleColor.r}, ${particleColor.g}, ${particleColor.b}, ${0.1 * (1 - dist / 150)})`;
                    ctx.lineWidth = 0.5;
                    ctx.stroke();
                }
            });
        });

        animationId = requestAnimationFrame(draw);
    }

    // Listen for theme changes
    const themeObserver = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.attributeName === 'data-theme') {
                updateParticleColor();
            }
        });
    });
    themeObserver.observe(document.documentElement, { attributes: true });

    // Handle visibility
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            isVisible = entry.isIntersecting;
            if (isVisible && !animationId) {
                draw();
            }
        });
    });

    observer.observe(canvas);

    // Initialize
    init();
    draw();

    // Handle resize
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            resize();
        }, 250);
    });
}

/* ============================================
   SMOOTH SCROLL
   ============================================ */
function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            const href = this.getAttribute('href');
            if (href === '#') return;
            
            const target = document.querySelector(href);
            if (!target) return;
            
            e.preventDefault();
            
            const headerHeight = document.querySelector('.header')?.offsetHeight || 80;
            const targetPosition = target.getBoundingClientRect().top + window.pageYOffset - headerHeight;
            
            window.scrollTo({
                top: targetPosition,
                behavior: 'smooth'
            });
        });
    });
}

/* ============================================
   FORM HANDLING
   ============================================ */
function handleFormSubmit(formId, successMessage) {
    const form = document.getElementById(formId);
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const submitBtn = form.querySelector('button[type="submit"]');
        const originalText = submitBtn.textContent;
        
        // Show loading state
        submitBtn.disabled = true;
        submitBtn.textContent = 'Envoi en cours...';

        // Simulate form submission (replace with actual endpoint)
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Show success
        submitBtn.textContent = '✓ Envoyé !';
        submitBtn.style.background = '#70b7a9';
        
        // Reset form
        form.reset();

        // Reset button after delay
        setTimeout(() => {
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
            submitBtn.style.background = '';
        }, 3000);
    });
}

/* ============================================
   COUNTER ANIMATION
   ============================================ */
function animateCounter(element, target, duration = 2000) {
    const start = 0;
    const increment = target / (duration / 16);
    let current = start;

    const timer = setInterval(() => {
        current += increment;
        if (current >= target) {
            element.textContent = target;
            clearInterval(timer);
        } else {
            element.textContent = Math.floor(current);
        }
    }, 16);
}

// Initialize counters when they come into view
function initCounters() {
    const counters = document.querySelectorAll('[data-counter]');
    
    if (!counters.length) return;

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const target = parseInt(entry.target.dataset.counter);
                animateCounter(entry.target, target);
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.5 });

    counters.forEach(counter => observer.observe(counter));
}

/* ============================================
   UTILITY FUNCTIONS
   ============================================ */

// Debounce function
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Throttle function
function throttle(func, limit) {
    let inThrottle;
    return function(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// Format phone number
function formatPhone(phone) {
    return phone.replace(/(\d{2})(?=\d)/g, '$1 ');
}

// Check if element is in viewport
function isInViewport(element) {
    const rect = element.getBoundingClientRect();
    return (
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
        rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    );
}

/* ============================================
   COUNTDOWN TIMER
   16 Mars 2026 à 09h00 (heure de Paris)
   ============================================ */
function initCountdown() {
    // Target: 16 Mars 2026 09:00:00 Paris time (CET = UTC+1, but March is CET before DST switch on March 29)
    const targetDate = new Date('2026-03-16T09:00:00+01:00');

    const heroTimer = document.getElementById('countdown-hero-timer');
    const heroContainer = document.getElementById('countdown-hero');

    // Create floating countdown (on all pages)
    const floating = document.createElement('div');
    floating.className = 'countdown-floating';
    floating.id = 'countdown-floating';
    floating.innerHTML = '<p class="countdown-floating__label">Ouverture dans</p><div class="countdown-floating__timer" id="countdown-floating-timer"></div>';
    document.body.appendChild(floating);

    const floatingTimer = document.getElementById('countdown-floating-timer');

    function buildTimerHTML(days, hours, minutes, seconds) {
        return '<div class="countdown-unit"><span class="countdown-unit__value">' + String(days).padStart(2, '0') + '</span><span class="countdown-unit__label">Jours</span></div>' +
            '<span class="countdown-separator">:</span>' +
            '<div class="countdown-unit"><span class="countdown-unit__value">' + String(hours).padStart(2, '0') + '</span><span class="countdown-unit__label">Heures</span></div>' +
            '<span class="countdown-separator">:</span>' +
            '<div class="countdown-unit"><span class="countdown-unit__value">' + String(minutes).padStart(2, '0') + '</span><span class="countdown-unit__label">Min</span></div>' +
            '<span class="countdown-separator">:</span>' +
            '<div class="countdown-unit"><span class="countdown-unit__value">' + String(seconds).padStart(2, '0') + '</span><span class="countdown-unit__label">Sec</span></div>';
    }

    function updateCountdown() {
        const now = new Date();
        const diff = targetDate - now;

        if (diff <= 0) {
            // Countdown finished
            if (heroTimer) heroTimer.innerHTML = '<span style="font-family:var(--font-display);font-size:1.5rem;color:var(--accent);font-weight:700;">C\'est parti !</span>';
            if (floatingTimer) floatingTimer.innerHTML = '<span style="font-family:var(--font-display);font-size:1rem;color:var(--accent);font-weight:700;">C\'est parti !</span>';
            return;
        }

        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);

        const html = buildTimerHTML(days, hours, minutes, seconds);

        if (heroTimer) heroTimer.innerHTML = html;
        if (floatingTimer) floatingTimer.innerHTML = html;
    }

    // Update every second
    updateCountdown();
    setInterval(updateCountdown, 1000);

    // Show/hide floating countdown based on scroll
    function handleFloatingVisibility() {
        if (heroContainer) {
            // On index page: show floating when hero countdown is out of view
            const rect = heroContainer.getBoundingClientRect();
            if (rect.bottom < 0) {
                floating.classList.add('visible');
            } else {
                floating.classList.remove('visible');
            }
        } else {
            // On other pages: always show floating
            floating.classList.add('visible');
        }
    }

    window.addEventListener('scroll', throttle(handleFloatingVisibility, 100));
    // Initial check
    handleFloatingVisibility();
}

/* ============================================
   RESERVATION POPUP (Toast)
   ============================================ */
function initReservationPopup() {
    // Create global toast element if not present
    let toast = document.querySelector('.toast-global');
    if (!toast) {
        toast = document.createElement('div');
        toast.className = 'toast-global';
        toast.id = 'toast-global';
        document.body.appendChild(toast);
    }

    function showReservationToast(message) {
        toast.innerHTML = message;
        toast.classList.add('show');
        setTimeout(function() {
            toast.classList.remove('show');
        }, 5000);
    }

    window.showToast = function(message) {
        showReservationToast(message);
    };

    // Optional toast hook (only if explicitly opted-in)
    document.addEventListener('click', function(e) {
        var link = e.target.closest('a[data-reservation-toast="true"]');
        if (link) {
            e.preventDefault();
            showReservationToast('Réservation disponible bientôt !');
        }
    });

    // Event banner CTA toast
    document.addEventListener('click', function(e) {
        var bannerLink = e.target.closest('.event-banner__link');
        if (!bannerLink) return;
        e.preventDefault();

        showReservationToast('La date de la semaine de gratuité arrive prochainement. <span class="icon-inline">Restez connecté 🤫</span>');
    });
}

/* ============================================
   FORM SUBMIT (Formsubmit.co)
   ============================================ */
function initFormSubmit() {
    const forms = document.querySelectorAll('form[data-formsubmit="true"]');
    if (!forms.length) return;

    forms.forEach(form => {
        const feedback = form.querySelector('.form-feedback');
        const submitBtn = form.querySelector('button[type="submit"]');
        const successMsg = form.getAttribute('data-success-message') ||
            'Merci, votre demande sera traitée sous 24h.';

        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.setAttribute('aria-busy', 'true');
            }

            if (feedback) {
                feedback.textContent = '';
                feedback.classList.remove('visible', 'is-error');
            }

            try {
                const res = await fetch(form.action, {
                    method: 'POST',
                    body: new FormData(form),
                    headers: { 'Accept': 'application/json' },
                });

                if (!res.ok) {
                    throw new Error('Formsubmit error');
                }

                if (feedback) {
                    feedback.textContent = successMsg;
                    feedback.classList.add('visible');
                }
                form.reset();
            } catch (err) {
                if (feedback) {
                    feedback.textContent = "Une erreur est survenue. Réessayez.";
                    feedback.classList.add('visible', 'is-error');
                }
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.removeAttribute('aria-busy');
                }
            }
        });
    });
}

/* ============================================
   LAZY EMBEDS (Maps)
   ============================================ */
function initLazyEmbeds() {
    const embeds = document.querySelectorAll('.lazy-embed');
    if (!embeds.length) return;

    embeds.forEach(embed => {
        const btn = embed.querySelector('.lazy-embed__btn');
        const src = embed.getAttribute('data-src');
        if (!src) return;

        const title = embed.getAttribute('data-title') || '';

        const loadEmbed = () => {
            if (embed.querySelector('iframe')) return;
            const iframe = document.createElement('iframe');
            iframe.src = src;
            iframe.loading = 'lazy';
            iframe.referrerPolicy = 'no-referrer-when-downgrade';
            if (title) iframe.title = title;
            iframe.allowFullscreen = true;
            iframe.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0';
            embed.appendChild(iframe);
            if (btn) btn.remove();
        };

        // Auto-load immediately
        loadEmbed();
    });
}

/* ============================================
   MOBILE CTA (Contextual)
   ============================================ */
function initMobileCta() {
    const cta = document.querySelector('.mobile-cta');
    if (!cta) return;

    const actions = cta.querySelector('.mobile-cta__actions');
    if (!actions) return;

    const buttons = Array.from(actions.querySelectorAll('.mobile-cta__btn'));
    if (buttons.length < 2) return;

    const tableBtn = buttons.find(btn => (btn.getAttribute('href') || '').includes('reserver-restaurant'));
    const terrainBtn = buttons.find(btn => (btn.getAttribute('href') || '').includes('reserver/'));
    if (!tableBtn || !terrainBtn) return;

    const path = window.location.pathname;
    const preferTable = path.includes('reserver-restaurant') || path.includes('bar-restaurant');

    if (preferTable) {
        tableBtn.classList.add('btn--primary', 'text-light');
        tableBtn.classList.remove('btn--light');
        terrainBtn.classList.add('btn--light');
        terrainBtn.classList.remove('btn--primary', 'text-light');
        actions.innerHTML = '';
        actions.append(tableBtn, terrainBtn);
    }
}
