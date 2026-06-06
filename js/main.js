/* ============================================================
   CrackedMinds — main.js
   ============================================================ */

(function () {
  'use strict';

  const navbar     = document.getElementById('navbar');
  const mobileMenu = document.getElementById('mobileMenu');
  const toggle     = document.querySelector('.navbar__toggle');
  const navLinks   = document.querySelectorAll('.navbar__links a');

  /* ── 1. Navbar: transparent → solid on scroll ─────────── */
  function handleNavScroll() {
    navbar.classList.toggle('scrolled', window.scrollY > 60);
  }
  window.addEventListener('scroll', handleNavScroll, { passive: true });
  handleNavScroll();

  /* ── 2. Mobile menu toggle ─────────────────────────────── */
  function closeMobileMenu() {
    mobileMenu.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  toggle.addEventListener('click', () => {
    const isOpen = mobileMenu.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(isOpen));
    document.body.style.overflow = isOpen ? 'hidden' : '';
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) closeMobileMenu();
  });

  /* ── 3. Smooth scroll with nav offset ──────────────────── */
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const href = this.getAttribute('href');
      if (href === '#') return;
      const target = document.querySelector(href);
      if (!target) return;
      e.preventDefault();
      const offset = navbar.offsetHeight;
      const top = target.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top, behavior: 'smooth' });
      closeMobileMenu();
    });
  });

  /* ── 4. Active nav link via IntersectionObserver ────────── */
  const sections = document.querySelectorAll('section[id]');

  const activeObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        navLinks.forEach(link => link.classList.remove('active'));
        const active = document.querySelector(
          `.navbar__links a[href="#${entry.target.id}"]`
        );
        if (active) active.classList.add('active');
      }
    });
  }, { threshold: 0.25, rootMargin: '-10% 0px -60% 0px' });

  sections.forEach(s => activeObserver.observe(s));

  /* ── 5. Scroll-reveal animations ───────────────────────── */
  const prefersMotion = window.matchMedia('(prefers-reduced-motion: no-preference)').matches;

  if (prefersMotion) {
    const revealObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('revealed');
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

    document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));
  } else {
    document.querySelectorAll('.reveal').forEach(el => el.classList.add('revealed'));
  }

  /* ── 6. Particle network canvas ─────────────────────────── */
  (function initParticles() {
    const canvas = document.getElementById('particleCanvas');
    if (!canvas || !prefersMotion) {
      if (canvas) canvas.style.display = 'none';
      return;
    }
    const ctx = canvas.getContext('2d');
    const COUNT      = 90;
    const LINK_DIST  = 150;
    const REPEL_DIST = 120;
    const R = '249, 115, 22';
    let particles = [];
    let raf;

    /* Mouse repulsion tracker */
    const mouse = { x: -9999, y: -9999 };
    window.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; }, { passive: true });

    function resize() {
      canvas.width  = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    }

    function Particle() {
      this.x  = Math.random() * canvas.width;
      this.y  = Math.random() * canvas.height;
      /* 40 % of particles are brighter foreground dots */
      const big   = Math.random() > 0.6;
      const speed = big ? 0.5 : 0.2;
      this.vx      = (Math.random() - 0.5) * speed * 2;
      this.vy      = (Math.random() - 0.5) * speed * 2;
      this.r       = big ? Math.random() * 1.4 + 1.0 : Math.random() * 0.7 + 0.35;
      this.opacity = big ? Math.random() * 0.2 + 0.8  : Math.random() * 0.3  + 0.35;
      this.glow    = big ? this.r * 8 : this.r * 4;
    }

    Particle.prototype.update = function () {
      /* Mouse repulsion */
      const dx = this.x - mouse.x;
      const dy = this.y - mouse.y;
      const d  = Math.sqrt(dx * dx + dy * dy);
      if (d > 0 && d < REPEL_DIST) {
        const f = ((REPEL_DIST - d) / REPEL_DIST) * 1.1;
        this.vx += (dx / d) * f;
        this.vy += (dy / d) * f;
      }
      /* Speed cap */
      const spd = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
      if (spd > 3.0) { this.vx = this.vx / spd * 3.0; this.vy = this.vy / spd * 3.0; }
      /* Damping */
      this.vx *= 0.978;
      this.vy *= 0.978;
      this.x  += this.vx;
      this.y  += this.vy;
      if (this.x < 0 || this.x > canvas.width)  this.vx *= -1;
      if (this.y < 0 || this.y > canvas.height)  this.vy *= -1;
    };

    Particle.prototype.draw = function () {
      ctx.shadowBlur = this.glow;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${R}, ${this.opacity})`;
      ctx.fill();
    };

    function drawLinks() {
      ctx.shadowBlur = 0; /* no glow on links — keep perf clean */
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx   = particles[i].x - particles[j].x;
          const dy   = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < LINK_DIST) {
            const alpha = (1 - dist / LINK_DIST) * 0.28;
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `rgba(${R}, ${alpha})`;
            ctx.lineWidth = 1.0;
            ctx.stroke();
          }
        }
      }
    }

    function frame() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.shadowColor = `rgba(${R}, 0.85)`;
      particles.forEach(p => { p.update(); p.draw(); });
      drawLinks();
      raf = requestAnimationFrame(frame);
    }

    function init() {
      resize();
      particles = Array.from({ length: COUNT }, () => new Particle());
      cancelAnimationFrame(raf);
      frame();
    }

    window.addEventListener('resize', init, { passive: true });
    init();
  }());

  /* ── 7. Hero grid parallax ─────────────────────────────── */
  const heroGrid = document.querySelector('.hero__grid');
  if (heroGrid && prefersMotion) {
    window.addEventListener('scroll', () => {
      if (window.scrollY < window.innerHeight) {
        heroGrid.style.transform = `translateY(${window.scrollY * 0.15}px)`;
      }
    }, { passive: true });
  }

  /* ── 8. Contact form ────────────────────────────────────── */
  const form   = document.getElementById('contactForm');
  const status = document.getElementById('formStatus');

  if (form && status) {
    form.querySelectorAll('input, textarea').forEach(field => {
      field.addEventListener('input', () => field.classList.remove('error'));
    });

    form.addEventListener('submit', async e => {
      e.preventDefault();
      status.className = 'form-status';
      status.textContent = '';

      const required = ['name', 'email', 'message'];
      let valid = true;

      required.forEach(id => {
        const el = document.getElementById(id);
        if (!el.value.trim()) {
          el.classList.add('error');
          valid = false;
        }
      });

      const emailEl = document.getElementById('email');
      if (emailEl.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailEl.value)) {
        emailEl.classList.add('error');
        valid = false;
      }

      if (!valid) {
        status.textContent = 'Please fill in all required fields correctly.';
        status.className = 'form-status error-msg';
        return;
      }

      const btn = form.querySelector('button[type="submit"]');
      const originalHTML = btn.innerHTML;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending…';
      btn.disabled = true;

      try {
        const formData = new FormData(form);
        const res = await fetch('/api/contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: formData.get('name'),
            email: formData.get('email'),
            organisation: formData.get('organisation') || '',
            message: formData.get('message'),
          }),
        });
        if (!res.ok) throw new Error('Send failed');
        status.textContent = "Thank you — we'll be in touch within 24 hours.";
        status.className = 'form-status success';
        form.reset();
      } catch {
        status.textContent = 'Something went wrong — please email us directly at hello@crackedminds.co.uk';
        status.className = 'form-status error-msg';
      }
      btn.innerHTML = originalHTML;
      btn.disabled = false;
    });
  }

  /* ── 9. Brain gear bounce physics ──────────────────────────── */
  (function initBrainGears() {
    if (!prefersMotion) return;

    const gearLg = document.getElementById('gearLg');
    const gearMd = document.getElementById('gearMd');
    const gearSm = document.getElementById('gearSm');
    if (!gearLg || !gearMd || !gearSm) return;

    /* Ellipse collision boundary — matches the brain.png cerebrum area
       in the SVG overlay's viewBox coordinate space (280 × 154).        */
    const BRAIN_CX = 132, BRAIN_CY = 66;
    const BRAIN_RX = 112, BRAIN_RY = 54;

    /* Returns true if point (x, y) lies inside the cerebrum ellipse */
    function inside(x, y) {
      const dx = (x - BRAIN_CX) / BRAIN_RX;
      const dy = (y - BRAIN_CY) / BRAIN_RY;
      return dx * dx + dy * dy <= 1;
    }

    /* Returns true if all 12 edge samples of a circle at (cx,cy,r) are inside */
    function circleInside(cx, cy, r) {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        if (!inside(cx + r * Math.cos(a), cy + r * Math.sin(a))) return false;
      }
      return true;
    }

    /* Gear state — r is the collision radius (outer tooth tip) */
    const gears = [
      { el: gearLg, x: 115, y: 65, vx:  0.40, vy:  0.34, r: 42, rot: 0, rotSpd:  0.55 },
      { el: gearMd, x: 150, y: 50, vx: -0.47, vy:  0.31, r: 27, rot: 0, rotSpd: -1.05 },
      { el: gearSm, x: 160, y: 95, vx:  0.57, vy: -0.42, r: 18, rot: 0, rotSpd:  1.85 },
    ];

    function tick() {
      gears.forEach(g => {
        /* Try full step → flip vx → flip vy → reverse both → nudge to centre */
        if (circleInside(g.x + g.vx, g.y + g.vy, g.r)) {
          g.x += g.vx;
          g.y += g.vy;
        } else if (circleInside(g.x - g.vx, g.y + g.vy, g.r)) {
          g.vx = -g.vx;
          g.x += g.vx;
          g.y += g.vy;
        } else if (circleInside(g.x + g.vx, g.y - g.vy, g.r)) {
          g.vy = -g.vy;
          g.x += g.vx;
          g.y += g.vy;
        } else {
          g.vx = -g.vx;
          g.vy = -g.vy;
          if (!inside(g.x, g.y)) {
            g.x += (BRAIN_CX - g.x) * 0.05;
            g.y += (BRAIN_CY - g.y) * 0.05;
          }
        }

        g.rot += g.rotSpd;
        g.el.setAttribute(
          'transform',
          `translate(${g.x.toFixed(1)},${g.y.toFixed(1)}) rotate(${g.rot.toFixed(1)})`
        );
      });

      requestAnimationFrame(tick);
    }

    tick();
  }());

  /* ── 10. Scroll progress bar ─────────────────────────────── */
  (function initScrollProgress() {
    const bar = document.getElementById('scrollProgress');
    if (!bar) return;
    function updateBar() {
      const total = document.body.scrollHeight - window.innerHeight;
      bar.style.width = total > 0 ? (window.scrollY / total * 100) + '%' : '0%';
    }
    window.addEventListener('scroll', updateBar, { passive: true });
    updateBar();
  }());

  /* ── 11. Custom cursor ───────────────────────────────────── */
  (function initCursor() {
    if (!prefersMotion || window.matchMedia('(hover: none)').matches) return;
    const dot  = document.getElementById('cursorDot');
    const ring = document.getElementById('cursorRing');
    if (!dot || !ring) return;

    document.body.classList.add('custom-cursor');
    dot.style.opacity  = '0';
    ring.style.opacity = '0';

    let mx = 0, my = 0, rx = 0, ry = 0, visible = false;

    document.addEventListener('mousemove', e => {
      mx = e.clientX; my = e.clientY;
      dot.style.left = mx + 'px';
      dot.style.top  = my + 'px';
      if (!visible) {
        visible = true;
        dot.style.opacity  = '1';
        ring.style.opacity = '1';
      }
    });

    (function animRing() {
      rx += (mx - rx) * 0.14;
      ry += (my - ry) * 0.14;
      ring.style.left = rx + 'px';
      ring.style.top  = ry + 'px';
      requestAnimationFrame(animRing);
    }());

    document.querySelectorAll('a, button, .service-card, .pillar, .testimonial-card').forEach(el => {
      el.addEventListener('mouseenter', () => ring.classList.add('cursor-ring--hover'));
      el.addEventListener('mouseleave', () => ring.classList.remove('cursor-ring--hover'));
    });
  }());

  /* ── 12. Typewriter on hero "complex" ────────────────────── */
  (function initTypewriter() {
    const el = document.querySelector('.hero__em');
    if (!el || !prefersMotion) return;
    const text = el.textContent.trim();
    el.textContent = '';
    el.classList.add('typing');
    let i = 0;
    function typeChar() {
      if (i < text.length) {
        el.textContent += text[i++];
        setTimeout(typeChar, 70 + Math.random() * 55);
      } else {
        setTimeout(() => el.classList.remove('typing'), 2800);
      }
    }
    setTimeout(typeChar, 550);
  }());

  /* ── 13. Animated counters ───────────────────────────────── */
  (function initCounters() {
    function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
    function animCount(el, end, suffix, duration) {
      const t0 = performance.now();
      (function tick(now) {
        const p = Math.min((now - t0) / duration, 1);
        el.textContent = Math.round(end * easeOut(p)) + suffix;
        if (p < 1) requestAnimationFrame(tick);
      }(t0));
    }
    const obs = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const el  = entry.target;
        const raw = el.textContent.trim();
        const m   = raw.match(/^(\d+)(.*)/);
        if (m) animCount(el, parseInt(m[1], 10), m[2], 1500);
        obs.unobserve(el);
      });
    }, { threshold: 0.6 });
    document.querySelectorAll('.big-stat__num, .strip-num').forEach(el => obs.observe(el));
  }());

  /* ── 14. 3D tilt + mouse-glow on pillar & testimonial cards ─ */
  (function initCardEffects() {
    if (!prefersMotion) return;

    /* Pillar & testimonial cards — full 3D tilt + glow */
    document.querySelectorAll('.pillar, .testimonial-card').forEach(card => {
      card.addEventListener('mousemove', e => {
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        const y = (e.clientY - r.top)  / r.height;
        card.style.transition = 'background 0.45s ease, box-shadow 0.45s ease, border-color 0.45s ease, backdrop-filter 0.45s ease';
        card.style.transform  = `perspective(900px) rotateX(${(y - 0.5) * -6}deg) rotateY(${(x - 0.5) * 6}deg) translateY(-4px) scale(1.01)`;
        card.style.setProperty('--mouse-x', (x * 100) + '%');
        card.style.setProperty('--mouse-y', (y * 100) + '%');
      });
      card.addEventListener('mouseleave', () => {
        card.style.transition = '';
        card.style.transform  = '';
      });
    });

    /* Service cards — glow only (parent overflow:hidden prevents tilt) */
    document.querySelectorAll('.service-card').forEach(card => {
      card.addEventListener('mousemove', e => {
        const r = card.getBoundingClientRect();
        card.style.setProperty('--mouse-x', ((e.clientX - r.left) / r.width  * 100) + '%');
        card.style.setProperty('--mouse-y', ((e.clientY - r.top)  / r.height * 100) + '%');
      });
    });
  }());

  /* ── 15. Magnetic buttons ────────────────────────────────── */
  (function initMagneticButtons() {
    if (!prefersMotion || window.matchMedia('(hover: none)').matches) return;
    document.querySelectorAll('.btn-primary, .btn-ghost').forEach(btn => {
      btn.addEventListener('mousemove', e => {
        const r = btn.getBoundingClientRect();
        const x = (e.clientX - r.left - r.width  / 2) * 0.22;
        const y = (e.clientY - r.top  - r.height / 2) * 0.22;
        btn.style.transform = `translate(${x}px, ${y}px) translateY(-2px)`;
      });
      btn.addEventListener('mouseleave', () => { btn.style.transform = ''; });
    });
  }());

})();
