/*
 * CSI Lab · UFOP — publications.js (ES module, publications page only, no dependencies).
 * Progressive enhancement of the server-rendered archive (views/publicacoes.njk); without it
 * every paper is listed and the toolbar stays hidden.
 *   [data-pubs]            the archive section; templates for the counts in data-one/-other,
 *                          data-count-of, data-all/-some/-none ({n}, {total})
 *   [data-pubs-bar]        toolbar (search #pubs-q, year #pubs-y, Filtros button [data-pubs-more]
 *                          opening the panel [data-pubs-filters]), revealed here
 *   [data-pubs-filter]     person / venue / type / minimum-citation selects in the panel, matched
 *                          against li.pub data-people, data-venue, data-type, data-cites;
 *                          [data-pubs-sort] = "" (by year, in groups) or "citacoes" (one list)
 *   [data-pubs-badge]      number of active panel filters (+ [data-pubs-badge-sr] for its name,
 *                          from data-active-one/-other) · [data-pubs-chips] removable chips
 *   [data-pubs-status]     count + clear line under the bar (below 960px), revealed here
 *   [data-pubs-count]      visible counts · [data-pubs-live] polite status for screen readers
 *   [data-pubs-clear]      clear buttons · [data-pubs-empty] no-results message
 *   [data-year]            year groups ([data-count] = their count) holding li.pub items
 * Search covers title, authors, venue and year; it ignores case and accents and every word
 * must match; every filter must hold too. One requestAnimationFrame applies a change: only items
 * whose state changed are touched. Sorting by citations moves the papers into one ranked <ol>
 * (DOM order = visual order) and back. Filters are mirrored in the URL
 * (?q=…&ano=…&pessoa=…&veiculo=…&tipo=…&cit=…&ordem=citacoes#arquivo) and read back on load.
 * Charts: one Tab stop per chart, arrow keys move between years; a bar whose year is filtered
 * out clears the filters before the page jumps to it, and every jump to a year re-aligns once
 * the groups around it have rendered.
 */

const MARKS = /\p{M}+/gu;
/** Lower case without accents: "Inteligência" → "inteligencia". */
const fold = (s) => s.normalize('NFD').replace(MARKS, '').toLowerCase();
const ASCII = /^[\x00-\x7f]*$/;
const MARK_MAX = 150;

/** fold() plus, for every folded character, the index of its source character. */
function foldMap(text) {
  if (ASCII.test(text)) return { norm: text.toLowerCase(), map: null };
  let norm = '';
  const map = [];
  for (let i = 0; i < text.length; i++) {
    const f = text.charCodeAt(i) < 128 ? text[i].toLowerCase() : fold(text[i]);
    for (let k = 0; k < f.length; k++) map.push(i);
    norm += f;
  }
  map.push(text.length);
  return { norm, map };
}

/** URL parameter of each filter of the disclosure (data-pubs-filter on its select). */
const PARAMS = { people: 'pessoa', venue: 'veiculo', type: 'tipo', cites: 'cit' };
const SORT_PARAM = 'ordem';

function initArchive(section) {
  const bar = section.querySelector('[data-pubs-bar]');
  const input = section.querySelector('#pubs-q');
  const select = section.querySelector('#pubs-y');
  if (!bar || !input || !select) return;
  const status = section.querySelector('[data-pubs-status]');
  const live = section.querySelector('[data-pubs-live]');
  const empty = section.querySelector('[data-pubs-empty]');
  const yearsBox = section.querySelector('.pubs-years');
  const counts = [...section.querySelectorAll('[data-pubs-count]')];
  const yearText = section.querySelector('[data-pubs-year-text]');
  const yearIdle = yearText ? yearText.textContent : '';
  const more = section.querySelector('[data-pubs-more]');
  const panel = section.querySelector('[data-pubs-filters]');
  const badge = section.querySelector('[data-pubs-badge]');
  const badgeSr = section.querySelector('[data-pubs-badge-sr]');
  const filters = [...section.querySelectorAll('[data-pubs-filter]')].filter((el) => el.dataset.pubsFilter in PARAMS);
  const sortEl = section.querySelector('[data-pubs-sort]');
  const chips = section.querySelector('[data-pubs-chips]');
  const chipList = chips ? chips.querySelector('ul') : null;
  const t = section.dataset;

  let nf;
  try {
    nf = new Intl.NumberFormat(document.documentElement.lang || undefined);
  } catch {
    nf = new Intl.NumberFormat();
  }
  const num = (n) => nf.format(n);
  const fill = (tpl, vars) => (tpl || '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  const papers = (n) => fill(n === 1 ? t.one : t.other, { n: num(n) });

  // DOM references now; the search text and facets of each paper are read once, at idle time or
  // on the first filter (buildIndex), so loading the page costs next to nothing
  let order = 0;
  const groups = [...section.querySelectorAll('[data-year]')].map((el) => {
    const list = el.querySelector('.pubs-list');
    const items = [...el.querySelectorAll('li.pub')].map((li) => ({
      li, year: el.dataset.year, index: order++, hay: '', fields: [], people: null, venue: '', type: '', cites: 0, shown: true, marked: '',
    }));
    return { el, list, year: el.dataset.year, items, total: items.length, n: items.length, shown: true, count: el.querySelector('[data-count]') };
  });
  const all = groups.flatMap((g) => g.items);
  const grandTotal = all.length;
  let byCites = null;
  let indexed = false;
  function buildIndex() {
    if (indexed) return;
    indexed = true;
    for (const it of all) {
      const { li } = it;
      const title = li.querySelector('.pub__title a') || li.querySelector('.pub__title');
      const authors = li.querySelector('.pub__authors');
      const venue = li.querySelector('.pub__venue-text');
      it.hay = `${fold([title, authors, venue].map((node) => (node ? node.textContent : '')).join(' '))} ${it.year}`;
      it.fields = [title, authors, venue].filter(Boolean).map((node) => ({ node, text: node.textContent, folded: null, on: false }));
      it.people = new Set((li.dataset.people || '').split(' ').filter(Boolean));
      it.venue = li.dataset.venue || '';
      it.type = li.dataset.type || '';
      it.cites = Number(li.dataset.cites) || 0;
    }
    // most cited first; a tie keeps the newer paper, then the order of the page
    byCites = [...all].sort((a, b) => b.cites - a.cites || Number(b.year) - Number(a.year) || a.index - b.index);
  }

  // ── rendering ──────────────────────────────────────────────────────────────
  /** Writes a count template into el with every placeholder value in <b>. */
  function renderCount(el, tpl, vars) {
    const frag = document.createDocumentFragment();
    let last = 0;
    tpl.replace(/\{(\w+)\}/g, (m, k, at) => {
      if (at > last) frag.append(tpl.slice(last, at));
      if (k in vars) {
        const b = document.createElement('b');
        b.textContent = vars[k];
        frag.append(b);
      } else frag.append(m);
      last = at + m.length;
      return m;
    });
    if (last < tpl.length) frag.append(tpl.slice(last));
    el.replaceChildren(frag);
  }

  /** Wraps the folded matches of terms in <mark>, or restores the plain text. */
  function markField(field, terms) {
    if (!terms.length) {
      if (field.on) field.node.textContent = field.text;
      field.on = false;
      return;
    }
    field.folded ??= foldMap(field.text);
    const { norm, map } = field.folded;
    const ranges = [];
    for (const term of terms) {
      for (let at = norm.indexOf(term); at !== -1; at = norm.indexOf(term, at + term.length)) {
        ranges.push(map ? [map[at], map[at + term.length]] : [at, at + term.length]);
      }
    }
    if (!ranges.length) {
      if (field.on) field.node.textContent = field.text;
      field.on = false;
      return;
    }
    ranges.sort((a, b) => a[0] - b[0]);
    const frag = document.createDocumentFragment();
    let pos = 0;
    for (const [start, end] of ranges) {
      if (end <= pos) continue;
      const from = Math.max(start, pos);
      if (from > pos) frag.append(field.text.slice(pos, from));
      const mark = document.createElement('mark');
      mark.textContent = field.text.slice(from, end);
      frag.append(mark);
      pos = end;
    }
    if (pos < field.text.length) frag.append(field.text.slice(pos));
    field.node.replaceChildren(frag);
    field.on = true;
  }

  /** Sorted by citations, the papers leave their year groups for one ranked list (and go back
   *  to their groups, in their order, when sorted by year). DOM order = visual order. */
  let ranked = null;
  let isRanked = false;
  function setRanked(on) {
    if (on === isRanked) return;
    isRanked = on;
    if (on) {
      if (!ranked) {
        ranked = document.createElement('ol');
        ranked.className = 'pubs-list pubs-ranked';
        ranked.setAttribute('role', 'list');
        yearsBox.insertBefore(ranked, empty && empty.parentNode === yearsBox ? empty : null);
      }
      ranked.append(...byCites.map((it) => it.li));
      ranked.hidden = false;
    } else {
      for (const g of groups) g.list.append(...g.items.map((it) => it.li));
      if (ranked) ranked.hidden = true;
    }
    section.classList.toggle('is-ranked', on);
  }

  /** The active filters of the disclosure as removable chips under the bar. */
  let chipIcon = null;
  function renderChips(active) {
    if (!chips || !chipList) return;
    chipIcon ??= section.querySelector('[data-pubs-clear] svg');
    const frag = document.createDocumentFragment();
    for (const el of active) {
      const label = (section.querySelector(`label[for="${el.id}"]`) || {}).textContent || '';
      const option = el.selectedOptions[0];
      const value = option ? option.dataset.name || option.textContent : el.value;
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'pubs-chip';
      button.dataset.chipFor = el.id;
      button.setAttribute('aria-label', fill(chips.dataset.remove, { filter: `${label}: ${value}` }));
      const text = document.createElement('span');
      text.className = 'pubs-chip__text';
      const b = document.createElement('b');
      b.textContent = `${label}:`;
      text.append(b, ` ${value}`);
      button.append(text);
      if (chipIcon) button.append(chipIcon.cloneNode(true));
      li.append(button);
      frag.append(li);
    }
    chipList.replaceChildren(frag);
    chips.hidden = !active.length;
  }

  // ── filtering ──────────────────────────────────────────────────────────────
  let lastKey = '';
  let liveTimer = 0;
  let urlTimer = 0;

  function readState() {
    const query = input.value.trim();
    const state = { query, words: fold(query).split(/\s+/).filter(Boolean), year: select.value, sort: sortEl ? sortEl.value : '' };
    for (const key of Object.keys(PARAMS)) state[key] = '';
    for (const el of filters) state[el.dataset.pubsFilter] = el.value;
    state.cites = Number(state.cites) || 0;
    return state;
  }

  function apply({ scroll = true } = {}) {
    buildIndex();
    const s = readState();
    const key = JSON.stringify([s.words, s.year, s.people, s.venue, s.type, s.cites, s.sort]);
    if (key === lastKey) return;
    const filterKey = JSON.stringify([s.people, s.venue, s.type, s.cites]);
    const prevFilterKey = lastKey ? JSON.stringify(JSON.parse(lastKey).slice(2, 6)) : '';
    lastKey = key;

    setRanked(s.sort === 'citacoes');

    // visibility: every criterion must hold; only items whose state changed are touched
    let shown = 0;
    for (const g of groups) {
      let n = 0;
      for (const it of g.items) {
        const show = (!s.year || it.year === s.year)
          && (!s.people || it.people.has(s.people))
          && (!s.venue || it.venue === s.venue)
          && (!s.type || it.type === s.type)
          && (!s.cites || it.cites >= s.cites)
          && s.words.every((w) => it.hay.includes(w));
        if (show !== it.shown) {
          it.shown = show;
          it.li.hidden = !show;
        }
        if (show) n += 1;
      }
      if (n !== g.n) {
        g.n = n;
        if (g.count) g.count.textContent = n === g.total ? papers(n) : fill(t.countOf, { n: num(n), total: papers(g.total) });
      }
      const groupShown = !isRanked && n > 0;
      if (groupShown !== g.shown) {
        g.shown = groupShown;
        g.el.hidden = !groupShown;
      }
      shown += n;
    }

    // highlights: words of two letters or more, and only when the results are narrow enough to
    // be read match by match (a broad query would repaint most of the list for nothing)
    const terms = shown <= MARK_MAX ? s.words.filter((w) => w.length > 1) : [];
    const markKey = terms.join(' ');
    for (const it of all) {
      if (it.shown && it.marked !== markKey) {
        it.fields.forEach((f) => markField(f, terms));
        it.marked = markKey;
      }
    }

    // the disclosure's filters: highlighted selects, the count on the button, the chips
    const active = filters.filter((el) => el.value);
    if (filterKey !== prevFilterKey) {
      filters.forEach((el) => el.classList.toggle('is-active', Boolean(el.value)));
      if (badge) {
        badge.textContent = active.length ? num(active.length) : '';
        badge.hidden = !active.length;
      }
      if (badgeSr) badgeSr.textContent = active.length ? `(${fill(active.length === 1 ? t.activeOne : t.activeOther, { n: num(active.length) })})` : '';
      renderChips(active);
    }
    if (sortEl) sortEl.classList.toggle('is-active', Boolean(s.sort));

    const filtered = Boolean(s.year || s.words.length || active.length);
    section.classList.toggle('is-filtered', filtered || Boolean(s.sort));
    section.classList.toggle('has-query', s.words.length > 0);
    section.classList.toggle('has-year', Boolean(s.year));
    section.classList.toggle('has-more', active.length > 0);
    if (yearText) yearText.textContent = s.year || yearIdle;
    // visible counts stay numeric ("0 de 312"); the no-results message is the empty block below
    const tpl = filtered ? t.some : t.all;
    const vars = { n: num(shown), total: num(grandTotal) };
    counts.forEach((el) => renderCount(el, tpl, vars));
    if (empty) empty.hidden = shown > 0;

    // announce once typing settles; mirror the filters in the URL
    const message = fill(filtered && !shown ? t.none : tpl, vars);
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => {
      if (live) live.textContent = message;
    }, 700);
    clearTimeout(urlTimer);
    urlTimer = setTimeout(() => syncUrl(s), 500);

    if (scroll) keepResultsInView();
  }

  /** While the toolbar is stuck, filtering brings the start of the results under it. */
  function keepResultsInView() {
    const anchor = status && status.offsetParent ? status : chips && !chips.hidden ? chips : yearsBox;
    if (!anchor) return;
    const barBottom = bar.getBoundingClientRect().bottom;
    const top = anchor.getBoundingClientRect().top;
    if (top < barBottom - 1) window.scrollBy({ top: top - barBottom, behavior: 'instant' });
  }

  /** Mirrors the filters in the URL; a filtered link also points at #arquivo, so a shared or
   *  bookmarked link opens on the results rather than on the page header. */
  function syncUrl(s) {
    try {
      const url = new URL(location.href);
      const values = { q: s.query, ano: s.year, [SORT_PARAM]: s.sort };
      for (const [k, param] of Object.entries(PARAMS)) values[param] = s[k] ? String(s[k]) : '';
      let any = false;
      for (const [param, value] of Object.entries(values)) {
        if (value) {
          url.searchParams.set(param, value);
          any = true;
        } else url.searchParams.delete(param);
      }
      if (any) url.hash = section.id;
      else if (url.hash === `#${section.id}`) url.hash = '';
      if (url.href !== location.href) history.replaceState(history.state, '', url);
    } catch { /* history unavailable (sandboxed frame): the filters still work */ }
  }

  let frame = 0;
  const schedule = () => {
    if (!frame) {
      frame = requestAnimationFrame(() => {
        frame = 0;
        apply();
      });
    }
  };
  const applyNow = (opts) => {
    cancelAnimationFrame(frame);
    frame = 0;
    apply(opts);
  };

  function clear({ focus = true, scroll = true } = {}) {
    input.value = '';
    select.value = '';
    filters.forEach((el) => { el.value = ''; });
    if (sortEl) sortEl.value = '';
    applyNow({ scroll });
    if (focus) input.focus({ preventScroll: true });
  }

  /** The Filtros disclosure: a button (aria-expanded) and the panel row of the bar. */
  function setOpen(open) {
    if (!more || !panel) return;
    more.setAttribute('aria-expanded', String(open));
    panel.hidden = !open;
  }

  input.addEventListener('focus', buildIndex, { once: true });
  input.addEventListener('input', schedule);
  select.addEventListener('change', schedule);
  filters.forEach((el) => el.addEventListener('change', schedule));
  if (sortEl) sortEl.addEventListener('change', schedule);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && input.value) {
      e.preventDefault();
      input.value = '';
      schedule();
    }
  });
  if (more && panel) {
    more.addEventListener('click', () => setOpen(panel.hidden));
    panel.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      setOpen(false);
      more.focus();
    });
  }
  section.addEventListener('click', (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;
    if (target.closest('[data-pubs-clear]')) {
      clear();
      return;
    }
    const chip = target.closest('[data-chip-for]');
    if (chip) {
      // remove that filter; focus moves to the next chip, else the previous one, else the button
      const el = section.querySelector(`#${CSS.escape(chip.dataset.chipFor)}`);
      const buttons = [...chipList.querySelectorAll('[data-chip-for]')];
      const at = buttons.indexOf(chip);
      const next = buttons[at + 1] || buttons[at - 1];
      const nextFor = next ? next.dataset.chipFor : '';
      if (el) el.value = '';
      applyNow();
      const focusTo = nextFor ? chipList.querySelector(`[data-chip-for="${CSS.escape(nextFor)}"]`) : more;
      if (focusTo) focusTo.focus({ preventScroll: true });
    }
  });
  // a chart bar pointing at a year that the filters hide: show everything first
  document.addEventListener('click', (e) => {
    const link = e.target instanceof Element ? e.target.closest('a[href^="#ano-"]') : null;
    if (!link) return;
    const target = document.getElementById(link.getAttribute('href').slice(1));
    if (target && target.hidden) clear({ focus: false, scroll: false });
  });

  // filters from the URL (shared links, history navigation); unknown values are ignored
  const params = new URLSearchParams(location.search);
  const pick = (el, value) => {
    if (el && value && [...el.options].some((o) => o.value === value)) el.value = value;
  };
  const q = params.get('q');
  if (q) input.value = q;
  pick(select, params.get('ano'));
  filters.forEach((el) => pick(el, params.get(PARAMS[el.dataset.pubsFilter])));
  pick(sortEl, params.get(SORT_PARAM));

  bar.hidden = false;
  if (status) status.hidden = false;
  section.classList.add('is-enhanced');
  watchStuck(bar);
  measureBar(bar, section);
  const fromUrl = input.value.trim() || select.value || filters.some((el) => el.value) || (sortEl && sortEl.value);
  if (fromUrl) {
    apply({ scroll: false });
    // an older link without #arquivo: open on the results all the same
    if (!location.hash) section.scrollIntoView({ block: 'start', behavior: 'instant' });
  } else {
    lastKey = JSON.stringify([[], '', '', '', '', 0, '']);
    if ('requestIdleCallback' in window) requestIdleCallback(buildIndex, { timeout: 3000 });
    else setTimeout(buildIndex, 800);
  }
}

/** .is-stuck on the toolbar while it is pinned under the site header. The sentinel sits
 *  var(--header-h) + 1px above the bar (CSS), so it passes the top of the viewport exactly when
 *  the bar sticks. The root margin stretches the viewport far downwards: "below the viewport"
 *  then counts as intersecting and only the top edge matters, so jumps that skip over the
 *  viewport (a chart bar, End, a scrollbar drag, find in page) still flip the state. No layout
 *  or style reads here. */
function watchStuck(bar) {
  if (!('IntersectionObserver' in window)) return;
  const sentinel = document.createElement('div');
  sentinel.className = 'pubs-bar__sentinel';
  sentinel.setAttribute('aria-hidden', 'true');
  bar.before(sentinel);
  new IntersectionObserver(([entry]) => {
    bar.classList.toggle('is-stuck', !entry.isIntersecting);
  }, { rootMargin: '0px 0px 1000000px 0px' }).observe(sentinel);
}

/** Writes the toolbar's height to --pubs-bar-measured on the archive (one style write per size
 *  change), for the sticky year heading and the scroll margins below it. */
function measureBar(bar, section) {
  if (!('ResizeObserver' in window)) return;
  let last = -1;
  new ResizeObserver(([entry]) => {
    const box = entry.borderBoxSize && entry.borderBoxSize[0];
    const h = Math.round(box ? box.blockSize : entry.target.offsetHeight);
    if (h === last || !h) return;
    last = h;
    section.style.setProperty('--pubs-bar-measured', `${h}px`);
  }).observe(bar);
}

/** After a jump to a year (#ano-YYYY), re-align once the lazily rendered groups next to it have
 *  taken their real height (content-visibility); a no-op when it already sits in place. */
function initYearJumps() {
  addEventListener('hashchange', () => {
    const target = /^#ano-\d{4}$/.test(location.hash) ? document.getElementById(location.hash.slice(1)) : null;
    if (!target || target.hidden) return;
    requestAnimationFrame(() => requestAnimationFrame(() => target.scrollIntoView({ block: 'start', behavior: 'instant' })));
  });
}

/** Roving tabindex over the bars of each chart: Tab enters, arrows/Home/End move. */
function initCharts() {
  document.querySelectorAll('.pubs-chart__svg').forEach((svg) => {
    const bars = [...svg.querySelectorAll('.pubs-chart__bar[href]')];
    if (bars.length < 2) return;
    bars.forEach((b, i) => b.setAttribute('tabindex', i === 0 ? '0' : '-1'));
    svg.addEventListener('keydown', (e) => {
      const i = bars.indexOf(e.target instanceof Element ? e.target.closest('.pubs-chart__bar') : null);
      if (i === -1) return;
      const last = bars.length - 1;
      const next = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: last }[e.key];
      if (next === undefined) return;
      e.preventDefault();
      const to = Math.max(0, Math.min(last, next));
      if (to === i) return;
      bars[i].setAttribute('tabindex', '-1');
      bars[to].setAttribute('tabindex', '0');
      bars[to].focus();
    });
  });
}

const root = document.querySelector('[data-pubs]');
if (root) {
  try {
    initArchive(root);
  } catch (err) {
    console.error(err);
  }
}
try {
  initCharts();
  initYearJumps();
} catch (err) {
  console.error(err);
}
