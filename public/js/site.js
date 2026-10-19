/*
 * CSI Lab · UFOP — site.js (ES module, no dependencies, every page). All features are optional.
 *   [data-header]          .is-scrolled once the page scrolls
 *   [data-lang]            language disclosure: aria-expanded, Esc, outside click, arrow keys
 *   #site-menu             <dialog> menu: showModal, Esc, focus return, closes at ≥ 960px;
 *                          html.menu-open while open (scroll lock)
 *   .page-toc--sticky      scroll-spy: aria-current on the chip of the section in view, kept
 *                          visible in the chip scroller (also the focused chip)
 *   [data-reveal]          .is-in when in view; stagger with style="--i: N" or a [data-reveal-group]
 *   [data-count-to="N"]    counts up from 0 once in view; the final value stays in the HTML until
 *                          the counter is about to scroll in, so a static "0" is never on screen
 *   .card--interactive     --mx/--my follow the pointer (fine pointers only)
 *   [data-copy="text"]     copy button; data-copied message (default #site-live[data-copied]),
 *                          optional [data-copy-label] child; announced in #site-live
 * The inline head script drops html.js if this module has not started within 4 s.
 */

const root = document.documentElement;
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const live = document.getElementById('site-live');
let reduced = motion.matches;
let revealAll = () => {};
let finishCounters = () => {};

const closest = (target, selector) => (target instanceof Element ? target.closest(selector) : null);
const safely = (fn) => {
  try {
    fn();
  } catch (err) {
    console.error(err);
  }
};

/** Announces a message in the shared polite live region (also usable by page scripts). */
export function announce(message) {
  if (!live || !message) return;
  live.textContent = '';
  setTimeout(() => { live.textContent = message; }, 60);
}

function initHeader() {
  const header = document.querySelector('[data-header]');
  if (!header) return;
  let queued = false;
  const update = () => {
    queued = false;
    header.classList.toggle('is-scrolled', scrollY > 8);
  };
  addEventListener('scroll', () => {
    if (!queued) queued = !!requestAnimationFrame(update);
  }, { passive: true });
  // First check in a frame: reading scrollY while the module runs would force the page's first
  // style and layout into this task.
  requestAnimationFrame(update);
}

function initLanguage() {
  document.querySelectorAll('[data-lang]').forEach((wrap) => {
    const button = wrap.querySelector('[data-lang-btn]');
    const menu = button && document.getElementById(button.getAttribute('aria-controls'));
    if (!menu) return;
    const isOpen = () => button.getAttribute('aria-expanded') === 'true';
    const setOpen = (open, focusButton) => {
      button.setAttribute('aria-expanded', String(open));
      wrap.toggleAttribute('data-open', open);
      if (!open && focusButton) button.focus();
    };
    button.addEventListener('click', () => setOpen(!isOpen()));
    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen()) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false, true);
        return;
      }
      const links = [...menu.querySelectorAll('a')];
      const onButton = e.target === button;
      if (!links.length || (!isOpen() && !(onButton && e.key === 'ArrowDown'))) return;
      const i = links.indexOf(document.activeElement);
      const next = e.key === 'ArrowDown' ? (onButton ? 0 : Math.min(links.length - 1, i + 1))
        : onButton ? -1
        : e.key === 'ArrowUp' ? Math.max(0, i - 1)
        : e.key === 'Home' ? 0
        : e.key === 'End' ? links.length - 1 : -1;
      if (next < 0) return;
      e.preventDefault();
      if (!isOpen()) setOpen(true);
      links[next].focus();
    });
    document.addEventListener('pointerdown', (e) => {
      if (isOpen() && !wrap.contains(e.target)) setOpen(false);
    });
    wrap.addEventListener('focusout', (e) => {
      if (isOpen() && e.relatedTarget && !wrap.contains(e.relatedTarget)) setOpen(false);
    });
    addEventListener('pagehide', () => setOpen(false));
  });
}

function initMenu() {
  const dialog = document.getElementById('site-menu');
  const opener = document.querySelector('[data-menu-open]');
  if (!dialog || !opener || typeof dialog.showModal !== 'function') return;
  const close = () => dialog.open && dialog.close();
  // handled here (not by the native command="show-modal") to keep aria-expanded in sync
  opener.addEventListener('click', (e) => {
    e.preventDefault();
    if (dialog.open) return;
    root.classList.add('menu-open');
    dialog.showModal();
    opener.setAttribute('aria-expanded', 'true');
  });
  dialog.querySelectorAll('[data-menu-close]').forEach((b) => b.addEventListener('click', (e) => {
    e.preventDefault();
    close();
  }));
  dialog.addEventListener('close', () => {
    root.classList.remove('menu-open');
    opener.setAttribute('aria-expanded', 'false');
    if (opener.checkVisibility ? opener.checkVisibility() : opener.offsetParent) opener.focus({ preventScroll: true });
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog || closest(e.target, 'a')) close();
  });
  matchMedia('(min-width: 960px)').addEventListener('change', (e) => e.matches && close());
  addEventListener('pagehide', close);
}

function initToc() {
  const nav = document.querySelector('.page-toc--sticky');
  const list = nav && nav.querySelector('ul');
  const links = list ? [...list.querySelectorAll('a[href^="#"]')] : [];
  const targets = links.map((a) => document.getElementById(decodeURIComponent(a.hash.slice(1))));
  if (!links.length || !targets.every(Boolean)) return;
  let current = null;
  let queued = false;
  let held = false; // after a chip click the spy waits until the page stops scrolling
  let timer = 0;
  // keeps a chip inside the scroller, clear of its scroll padding (the edge fade)
  const show = (chip) => {
    const box = list.getBoundingClientRect();
    const r = chip.getBoundingClientRect();
    const s = getComputedStyle(list);
    const start = box.left + (parseFloat(s.scrollPaddingInlineStart) || 0);
    const end = box.right - (parseFloat(s.scrollPaddingInlineEnd) || 0);
    const dx = r.left < start ? r.left - start : r.right > end ? r.right - end : 0;
    if (dx) list.scrollBy({ left: dx, behavior: reduced ? 'auto' : 'smooth' });
  };
  const mark = (link) => {
    if (link === current) return;
    current?.removeAttribute('aria-current');
    current = link;
    if (link) {
      link.setAttribute('aria-current', 'true');
      show(link);
    }
  };
  const update = () => {
    queued = false;
    if (held) return;
    // a section is current once its top passes a third of the screen (or just under the nav)
    const line = Math.max(nav.getBoundingClientRect().bottom + 48, innerHeight * 0.35);
    let active = null;
    targets.forEach((t, i) => {
      if (t.getBoundingClientRect().top <= line) active = links[i];
    });
    mark(active);
  };
  const queue = () => {
    if (!queued) queued = !!requestAnimationFrame(update);
  };
  const release = () => {
    held = false;
    queue();
  };
  // released on scrollend, or once the page has not scrolled for a while (1.2 s if never)
  const wait = (ms) => {
    clearTimeout(timer);
    timer = setTimeout(release, ms);
  };
  list.addEventListener('click', (e) => {
    const link = closest(e.target, 'a');
    if (!links.includes(link)) return;
    mark(link);
    held = true;
    wait(1200);
  });
  addEventListener('scrollend', () => held && release());
  list.addEventListener('focusin', (e) => show(e.target));
  addEventListener('scroll', () => (held ? wait(250) : queue()), { passive: true });
  addEventListener('resize', queue, { passive: true });
  queue();
}

function initReveal() {
  document.querySelectorAll('[data-reveal-group]').forEach((group) => {
    group.querySelectorAll('[data-reveal]').forEach((el, i) => {
      if (!el.style.getPropertyValue('--i')) el.style.setProperty('--i', String(i));
    });
  });
  const items = [...document.querySelectorAll('[data-reveal]')];
  const show = (el) => el.classList.add('is-in');
  if (!items.length) return;
  if (reduced || !('IntersectionObserver' in window)) {
    items.forEach(show);
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const r = entry.boundingClientRect;
      // an element without a box (display: contents) never intersects: shown as is
      if (entry.isIntersecting || !(r.width || r.height)) {
        show(entry.target);
        observer.unobserve(entry.target);
      }
    }
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.01 });
  items.forEach((el) => observer.observe(el));
  revealAll = () => {
    observer.disconnect();
    items.forEach(show);
  };
}

function initCounters() {
  const counters = [...document.querySelectorAll('[data-count-to]')].filter((el) => Number(el.dataset.countTo) > 0);
  if (!counters.length || reduced || !('IntersectionObserver' in window)) return;
  let format;
  try {
    format = new Intl.NumberFormat(root.lang || undefined);
  } catch {
    format = new Intl.NumberFormat();
  }
  const finalText = (el) => format.format(Number(el.dataset.countTo));
  // read when a counter starts, never while the module runs: the getter forces a style + layout
  const fontsReady = () => (document.fonts ? document.fonts.ready.catch(() => {}) : Promise.resolve());
  const state = new WeakMap(); // none: final value shown · 'primed': 0, still off-screen · 'run'
  // lock the final width so neither the digits nor the suffix move while counting
  const lock = (el) => {
    el.textContent = finalText(el);
    el.style.minWidth = '';
    el.style.minWidth = `${el.getBoundingClientRect().width}px`;
  };
  const prime = (el) => {
    if (state.has(el)) return;
    state.set(el, 'primed');
    lock(el);
    el.textContent = format.format(0);
  };
  const run = async (el, entry) => {
    if (state.get(el) === 'run') return;
    // reached from above (scrolling back up) before it was ever primed: keep the final value
    const fromAbove = entry.boundingClientRect.top < 0 && !state.has(el);
    state.set(el, 'run');
    if (fromAbove) return;
    await fontsReady();
    const target = Number(el.dataset.countTo);
    lock(el);
    const duration = Math.min(1700, 900 + Math.log10(target + 1) * 250);
    const start = performance.now();
    const tick = (now) => {
      const p = reduced ? 1 : Math.min(1, (now - start) / duration);
      el.textContent = p < 1 ? format.format(Math.round(target * (1 - (1 - p) ** 4))) : finalText(el);
      if (p < 1) requestAnimationFrame(tick);
      else el.style.minWidth = '';
    };
    tick(start);
  };
  const watch = (fn, rootMargin) => new IntersectionObserver((entries, observer) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        observer.unobserve(entry.target);
        fn(entry.target, entry);
      }
    }
  }, { rootMargin });
  // created first, so its callback runs before the primer's when both fire together
  const runner = watch(run, '0px');
  // drops to 0 while still 15% below the viewport, where nobody sees it
  const primer = watch(prime, '0px 0px 15% 0px');
  counters.forEach((el) => {
    runner.observe(el);
    primer.observe(el);
  });
  finishCounters = () => {
    runner.disconnect();
    primer.disconnect();
    counters.forEach((el) => {
      el.textContent = finalText(el);
      el.style.minWidth = '';
    });
  };
}

function initSpotlight() {
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  let frame = 0;
  let last = null;
  document.addEventListener('pointermove', (e) => {
    last = e;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const card = closest(last.target, '.card--interactive');
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${(last.clientX - r.left).toFixed(1)}px`);
      card.style.setProperty('--my', `${(last.clientY - r.top).toFixed(1)}px`);
    });
  }, { passive: true });
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // insecure contexts (plain http on a LAN): legacy fallback
    const area = Object.assign(document.createElement('textarea'), { value: text, readOnly: true });
    area.style.cssText = 'position:fixed;top:0;opacity:0;pointer-events:none';
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch { /* unsupported */ }
    area.remove();
    return ok;
  }
}

function initCopy() {
  document.addEventListener('click', async (e) => {
    const button = closest(e.target, '[data-copy]');
    if (!button) return;
    e.preventDefault();
    if (!(await copyText(button.dataset.copy || ''))) return;
    const message = button.dataset.copied || (live && live.dataset.copied) || '';
    const label = button.querySelector('[data-copy-label]');
    if (label) {
      label.dataset.idle ??= label.textContent;
      if (message) label.textContent = message;
    }
    button.classList.add('is-copied');
    announce(message);
    clearTimeout(button.copyTimer);
    button.copyTimer = setTimeout(() => {
      button.classList.remove('is-copied');
      if (label) label.textContent = label.dataset.idle;
    }, 2200);
  });
}

try {
  initReveal();
} catch (err) {
  root.classList.replace('js', 'no-js'); // never leave content hidden behind html.js
  console.error(err);
}
root.classList.add('is-ready');
[initHeader, initLanguage, initMenu, initToc, initCounters, initSpotlight, initCopy].forEach(safely);

motion.addEventListener('change', (e) => {
  reduced = e.matches;
  if (reduced) {
    revealAll();
    finishCounters();
  }
});
// printed pages show final numbers and every element, even those never scrolled to
addEventListener('beforeprint', () => {
  revealAll();
  finishCounters();
});
