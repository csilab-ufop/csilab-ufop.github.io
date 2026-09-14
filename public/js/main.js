function hideLoader() {
  const loader = document.getElementById('page-loader');
  if (loader) loader.classList.add('hidden');
}
window.addEventListener('load', () => setTimeout(hideLoader, 300));
setTimeout(hideLoader, 1500);

document.addEventListener('DOMContentLoaded', () => {
  const heading = document.querySelector('.hero-heading');
  if (heading) setTimeout(() => heading.classList.add('visible'), 600);
});

const hamburger   = document.getElementById('hamburger');
const mobileNav   = document.getElementById('mobile-nav');
const navOverlay  = document.getElementById('nav-overlay');
const mobileClose = document.getElementById('mobile-close');

function openMobileNav() {
  mobileNav.classList.add('open');
  navOverlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeMobileNav() {
  mobileNav.classList.remove('open');
  navOverlay.classList.remove('open');
  document.body.style.overflow = '';
}

hamburger?.addEventListener('click', openMobileNav);
mobileClose?.addEventListener('click', closeMobileNav);
navOverlay?.addEventListener('click', closeMobileNav);
document.querySelectorAll('.mobile-nav a').forEach(a => a.addEventListener('click', closeMobileNav));

const langDropdown = document.getElementById('lang-dropdown');
const langTrigger  = document.getElementById('lang-trigger');
if (langTrigger && langDropdown) {
  langTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = langDropdown.classList.toggle('open');
    langTrigger.setAttribute('aria-expanded', open);
  });
  document.addEventListener('click', () => {
    langDropdown.classList.remove('open');
    langTrigger.setAttribute('aria-expanded', 'false');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      langDropdown.classList.remove('open');
      langTrigger.setAttribute('aria-expanded', 'false');
    }
  });
}

function animateCounter(el, target, suffix, duration = 1800) {
  const start = performance.now();
  const step = (now) => {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(eased * target);
    el.textContent = (current >= 1000 ? (current / 1000).toFixed(1) + 'K' : current) + suffix;
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

const counterSection = document.getElementById('numeros');
let countersTriggered = false;

const counterObserver = new IntersectionObserver((entries) => {
  if (entries[0].isIntersecting && !countersTriggered) {
    countersTriggered = true;
    counterSection.querySelectorAll('.number[data-target]').forEach(el => {
      const target = parseInt(el.dataset.target, 10);
      const suffix = el.dataset.suffix || '';
      if (!isNaN(target)) animateCounter(el, target, suffix);
    });
  }
}, { threshold: 0.3 });

if (counterSection) counterObserver.observe(counterSection);

function initAccordion(containerSelector, headerSelector, itemSelector) {
  const containers = document.querySelectorAll(containerSelector);
  containers.forEach(container => {
    const headers = container.querySelectorAll(headerSelector);
    headers.forEach(header => {
      header.addEventListener('click', () => {
        const item   = header.closest(itemSelector);
        const body   = item.querySelector('.accordion-body');
        const inner  = item.querySelector('.accordion-body-inner');
        const isOpen = item.classList.contains('open');

        container.querySelectorAll(itemSelector).forEach(i => {
          i.classList.remove('open');
          i.querySelector('.accordion-body').style.maxHeight = '0';
        });

        if (!isOpen) {
          item.classList.add('open');
          body.style.maxHeight = inner.scrollHeight + 'px';
        }
      });
    });

    const first = container.querySelector(itemSelector);
    if (first) {
      first.classList.add('open');
      first.querySelector('.accordion-body').style.maxHeight =
        first.querySelector('.accordion-body-inner').scrollHeight + 'px';
    }
  });
}

initAccordion('.consult-accordion', '.accordion-header:not(.faq-header)', '.accordion-item:not(.faq-item)');

initAccordion('#faq', '.faq-header', '.faq-item');

const scrollZoomObserver = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      e.target.classList.add('in-view');
    }
  });
}, { threshold: 0.1 });

document.querySelectorAll('.scroll-Zoom').forEach(el => scrollZoomObserver.observe(el));

document.addEventListener('DOMContentLoaded', () => {
  if (typeof AOS !== 'undefined') {
    AOS.init({ once: true, duration: 800, offset: 60 });
  }
});
setTimeout(() => {
  if (typeof AOS === 'undefined') {
    document.querySelectorAll('[data-aos]').forEach(el => {
      el.style.opacity = '1';
      el.style.transform = 'none';
    });
  }
}, 3000);

const contactForm = document.getElementById('contact-form');
contactForm?.addEventListener('submit', (e) => {
  e.preventDefault();
  const btn = contactForm.querySelector('[type="submit"]');
  const txtSending = btn.dataset.sending || 'Enviando…';
  const txtSent    = btn.dataset.sent    || 'Mensagem Enviada!';
  const txtDefault = btn.dataset.default || btn.textContent;
  btn.textContent = txtSending;
  btn.disabled = true;
  setTimeout(() => {
    btn.textContent = txtSent;
    contactForm.reset();
    setTimeout(() => { btn.textContent = txtDefault; btn.disabled = false; }, 3000);
  }, 1200);
});

const subscribeForm = document.getElementById('subscribe-form');
subscribeForm?.addEventListener('submit', (e) => {
  e.preventDefault();
  const input = subscribeForm.querySelector('input');
  const btn   = subscribeForm.querySelector('button');
  btn.textContent = 'Subscribed!';
  input.value = '';
  setTimeout(() => { btn.textContent = 'Subscribe'; }, 2500);
});
