/* ============================================================
   CrackedMinds — animations.js
   Loading screen only
   ============================================================ */

(function () {
  'use strict';

  if (typeof gsap === 'undefined') return;

  const loader = document.getElementById('loader');
  if (!loader) return;

  document.body.style.overflow = 'hidden';

  const tl = gsap.timeline({
    onComplete: () => {
      loader.style.display = 'none';
      document.body.style.overflow = '';
    }
  });

  tl
    .from('.loader__logo',        { opacity: 0, y: 24, duration: 0.8, ease: 'power3.out' })
    .from('.loader__tagline',     { opacity: 0, y: 12, duration: 0.6, ease: 'power2.out' }, '-=0.4')
    .to('.loader__progress-fill', { width: '100%',     duration: 1.1, ease: 'power2.inOut' }, '-=0.3')
    .to(loader,                   { opacity: 0,         duration: 0.5, ease: 'power2.out' }, '+=0.25');

}());
