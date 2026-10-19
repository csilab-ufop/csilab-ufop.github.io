'use strict';

// Content loading and template context, shared by server.js, scripts/build-static.js and
// scripts/check-content.js.
//
// - YAML is read with js-yaml's CORE_SCHEMA (so "2024-12-13" stays a string), .json with JSON.parse.
// - Data for language L = content/_shared/data/* → content/pt/data/* → content/L/data/*, merged
//   with merge(): maps key by key, arrays replaced, empty values never override. A missing
//   translation therefore falls back to pt.
// - Page front matter = merge(content/pt/<page>.md, content/L/<page>.md).
// - News = every slug in content/pt/news or content/L/news; L's file wins, pt fills the gaps.
// - Everything is read again on each call, so content edits need no server restart.
// - Computed per language (spec/data-model.md §3, plus): person.slug (unique id on the people
//   page), news.day_label, `lang` of each publication and citing-paper title (lib/lang.js), and
//   lang="…" on news <strong>/<em> text in another language than the page's, and the
//   publication facets (lib/pub-facets.js).

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { Marked } = require('marked');
const { LANGUAGES, DEFAULT_LANG, PAGES } = require('../config');
const { guessTitleLang, langifyEmphasis } = require('./lang');
const { buildPubFacets } = require('./pub-facets');

const ROOT = path.join(__dirname, '..');
// CONTENT_DIR / PUBLIC_DIR may point elsewhere (a test copy; see scripts/check-content.js --content).
const CONTENT_DIR = path.resolve(process.env.CONTENT_DIR || path.join(ROOT, 'content'));
const PUBLIC_DIR = path.resolve(process.env.PUBLIC_DIR || path.join(ROOT, 'public'));
const LANGS = Object.keys(LANGUAGES);
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/+$/, '');
const SITE_URL = (process.env.SITE_URL || 'https://csilab.ufop.br').replace(/\/+$/, '');
const LAB_TIME_ZONE = 'America/Sao_Paulo';

const FACULTY_GROUPS = ['coordinators', 'professors', 'collaborators'];
const STUDENT_GROUPS = ['phd_students', 'masters_students', 'undergrads'];
const ALUMNI_GROUPS = ['alumni_grad', 'alumni_undergrad'];
const TEAM_GROUPS = [...FACULTY_GROUPS, ...STUDENT_GROUPS, ...ALUMNI_GROUPS];
// Section ids of the people page (spec/ia.md); #pos-graduacao wraps #doutorado and #mestrado.
const GROUP_ANCHORS = {
  coordinators: 'coordenadores',
  professors: 'docentes',
  collaborators: 'colaboradores',
  phd_students: 'doutorado',
  masters_students: 'mestrado',
  undergrads: 'graduacao',
  alumni_grad: 'egressos',
  alumni_undergrad: 'egressos',
};
// Other ids on the people page; a person slug never takes one of them (nor a group anchor).
const RESERVED_IDS = ['pos-graduacao', 'main', 'top', 'site-live', 'site-menu', 'site-menu-title',
  'lang-menu', 'menu-lang-label', 'join-title'];

// ── Reading files ────────────────────────────────────────────────────────────

function relPath(file) {
  return path.relative(ROOT, file);
}

function readYaml(file) {
  try {
    return yaml.load(fs.readFileSync(file, 'utf8'), { schema: yaml.CORE_SCHEMA });
  } catch (err) {
    throw new Error(`[content] cannot read ${relPath(file)}: ${err.message}`);
  }
}

function readDataFile(file) {
  if (!file.endsWith('.json')) return readYaml(file);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`[content] cannot read ${relPath(file)}: ${err.message}`);
  }
}

// "---\n<yaml>\n---\n\n<body>" → { data, body }. A file without front matter is all body.
const FRONT_MATTER = /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)([\s\S]*)$/;

function parseFrontMatter(src, file = '(string)') {
  const m = src.replace(/^\uFEFF/, '').match(FRONT_MATTER);
  if (!m) return { data: {}, body: src.trim() };
  let data;
  try {
    data = yaml.load(m[1] || '', { schema: yaml.CORE_SCHEMA }) || {};
  } catch (err) {
    throw new Error(`[content] cannot read the front matter of ${file}: ${err.message}`);
  }
  return { data, body: m[2].trim() };
}

function readMarkdown(file) {
  if (!fs.existsSync(file)) return null;
  return parseFrontMatter(fs.readFileSync(file, 'utf8'), relPath(file));
}

// ── Merging ──────────────────────────────────────────────────────────────────

const isPlainObject = v => Object.prototype.toString.call(v) === '[object Object]';
const isEmpty = v => v === undefined || v === null || v === '';
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// Returns a new value: maps are merged key by key (`over` wins), arrays and scalars are
// replaced, and an empty value (undefined, null, '') never replaces an existing one.
function merge(base, over) {
  if (isEmpty(over)) return base;
  if (!isPlainObject(base) || !isPlainObject(over)) return over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = hasOwn(out, k) ? merge(out[k], v) : v;
  return out;
}

// content/<dir>/data/*.{yaml,yml,json} → { <file name>: value }
function loadDataDir(dir) {
  const out = {};
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).sort()) {
    const m = f.match(/^([^.].*)\.(ya?ml|json)$/);
    if (m) out[m[1]] = readDataFile(path.join(dir, f));
  }
  return out;
}

function langChain(lang) {
  return lang === DEFAULT_LANG ? [DEFAULT_LANG] : [DEFAULT_LANG, lang];
}

// Merged data for a language, before the computed values are added.
function loadData(lang) {
  let data = loadDataDir(path.join(CONTENT_DIR, '_shared', 'data'));
  for (const l of langChain(lang)) data = merge(data, loadDataDir(path.join(CONTENT_DIR, l, 'data')));
  return data;
}

// One per-locale data file (e.g. 'ui'), merged with the pt fallback.
function loadLangDataFile(lang, name) {
  let out = {};
  for (const l of langChain(lang)) {
    const file = path.join(CONTENT_DIR, l, 'data', `${name}.yaml`);
    if (fs.existsSync(file)) out = merge(out, readYaml(file) || {});
  }
  return out;
}

// Front matter of content/<lang>/<page>.md, merged with the pt fallback.
function loadPage(lang, page) {
  let out = {};
  for (const l of langChain(lang)) {
    const md = readMarkdown(path.join(CONTENT_DIR, l, `${page}.md`));
    if (md) out = merge(out, md.data);
  }
  return out;
}

// News entries of a language (unsorted): front matter + `body` (Markdown) + `slug`.
function loadNews(lang) {
  const slugs = new Set();
  for (const l of langChain(lang)) {
    const dir = path.join(CONTENT_DIR, l, 'news');
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) if (/^[^._].*\.md$/.test(f)) slugs.add(f.slice(0, -3));
  }
  return [...slugs].sort().map((slug) => {
    let entry = {};
    for (const l of langChain(lang)) {
      const md = readMarkdown(path.join(CONTENT_DIR, l, 'news', `${slug}.md`));
      if (md) entry = merge(entry, { ...md.data, body: md.body });
    }
    return { ...entry, slug };
  });
}

// ── URLs ─────────────────────────────────────────────────────────────────────

// Language prefix including BASE_PATH ("" for pt at the domain root, "/en", …).
function langBase(lang) {
  return lang === DEFAULT_LANG ? BASE_PATH : `${BASE_PATH}/${lang}`;
}

// URL path of a page: "/", "/en/", "/equipe/", "/en/equipe/", … The trailing slash matches the
// dist/<page>/index.html layout, so GitHub Pages serves it directly instead of answering with a 301.
function pageUrl(lang, page) {
  if (page === 'index') return `${langBase(lang)}/`;
  return `${langBase(lang)}/${page}/`;
}

// ── Formatting (Intl, with LANGUAGES[lang].html as the locale) ───────────────

function localeOf(lang) {
  return (LANGUAGES[lang] || LANGUAGES[DEFAULT_LANG]).html;
}

const DATE_RE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

// "2024" → "2024"; "2024-12" → "dezembro de 2024"; "2024-12-13" → "13 de dezembro de 2024";
// an ISO timestamp (publications.json generated_at) → its day in Brazil's time zone.
// Anything else is returned unchanged.
function formatDate(value, lang = DEFAULT_LANG) {
  if (isEmpty(value)) return '';
  const s = String(value).trim();
  const m = s.match(DATE_RE);
  if (m) {
    const [, y, mo, d] = m.map(Number);
    if ((m[2] && (mo < 1 || mo > 12)) || (m[3] && (d < 1 || d > 31))) return s;
    const opts = m[3] ? { day: 'numeric', month: 'long', year: 'numeric' }
      : m[2] ? { month: 'long', year: 'numeric' }
      : { year: 'numeric' };
    const date = new Date(Date.UTC(y, m[2] ? mo - 1 : 0, m[3] ? d : 1));
    if (m[3] && date.getUTCDate() !== d) return s;  // e.g. 2024-02-30
    return new Intl.DateTimeFormat(localeOf(lang), { ...opts, timeZone: 'UTC' }).format(date);
  }
  const t = TIMESTAMP_RE.test(s) ? Date.parse(s) : NaN;
  if (Number.isNaN(t)) return s;
  return new Intl.DateTimeFormat(localeOf(lang), {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: LAB_TIME_ZONE,
  }).format(new Date(t));
}

// The date without its year: "2024-12-13" → "13 de dezembro" (pt), "December 13" (en),
// "13 de diciembre" (es), "13 dicembre" (it); "2024-12" → "dezembro"; "2024" or anything
// else → "".
function formatDayMonth(value, lang = DEFAULT_LANG) {
  const m = isEmpty(value) ? null : String(value).trim().match(DATE_RE);
  if (!m || !m[2]) return '';
  const [, y, mo, d] = m.map(Number);
  if (mo < 1 || mo > 12 || (m[3] && (d < 1 || d > 31))) return '';
  const date = new Date(Date.UTC(y, mo - 1, m[3] ? d : 1));
  if (m[3] && date.getUTCDate() !== d) return '';  // e.g. 2024-02-30
  const opts = m[3] ? { day: 'numeric', month: 'long' } : { month: 'long' };
  return new Intl.DateTimeFormat(localeOf(lang), { ...opts, timeZone: 'UTC' }).format(date);
}

// 6163 → "6.163" (pt), "6,163" (en), "6163" (es, it: CLDR groups only from 10 000 on).
// Non-numbers are returned unchanged.
function formatNumber(value, lang = DEFAULT_LANG) {
  if (isEmpty(value)) return '';
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (typeof value === 'boolean' || !Number.isFinite(n)) return value;
  return new Intl.NumberFormat(localeOf(lang)).format(n);
}

const NAME_PARTICLES = new Set(['da', 'das', 'de', 'del', 'di', 'do', 'dos', 'e', 'van', 'von']);

// "Gladston Moreira" → "GM"; "Felipe de Oliveira Mota" → "FM"; "Pedro" → "P".
function initials(name) {
  const words = String(name || '').trim().split(/\s+/)
    .filter(w => /^\p{L}/u.test(w) && !NAME_PARTICLES.has(w.toLowerCase()));
  if (!words.length) return '';
  const first = Array.from(words[0])[0];
  const last = words.length > 1 ? Array.from(words[words.length - 1])[0] : '';
  return (first + last).toLocaleUpperCase();
}

const SLUG_LETTERS = { 'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'ø': 'o', 'đ': 'd', 'ð': 'd', 'ł': 'l', 'þ': 'th', 'ı': 'i' };
const TITLE_PREFIX = /^(?:(?:prof(?:a|ª|\.ssa)?|dr(?:a|ª)?)(?:\.\s*|\s+))+/i;

// ASCII kebab-case: "Valéria Santos" → "valeria-santos"; "Prof. Gladston Moreira" →
// "gladston-moreira" (a title prefix is dropped). "" when nothing is left.
function slugify(text) {
  const s = String(text || '').trim().replace(TITLE_PREFIX, '')
    .normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase()
    .replace(/[ßæœøđðłþı]/g, c => SLUG_LETTERS[c])
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return /^\d/.test(s) ? `p-${s}` : s;
}

const markdown = new Marked({ gfm: true, breaks: false });

// Markdown block → HTML ("" for empty input).
function md(text) {
  return isEmpty(text) ? '' : markdown.parse(String(text), { async: false }).trim();
}

// Markdown inline (one paragraph, no <p>) → HTML.
function mdi(text) {
  return isEmpty(text) ? '' : markdown.parseInline(String(text), { async: false }).trim();
}

// Team tag id → label in a language (pt, then the id itself, as fallbacks).
function tagLabel(teamTags, id, lang = DEFAULT_LANG) {
  const t = teamTags && teamTags[id];
  return (t && (t[lang] || t[DEFAULT_LANG])) || String(id);
}

// ── Computed data ────────────────────────────────────────────────────────────

function buildPeople(data, lang) {
  const team = isPlainObject(data.team) ? data.team : {};
  const i18n = isPlainObject(data.team_i18n) ? data.team_i18n : {};
  const prefixes = i18n.name_prefixes || {};
  const roles = i18n.roles || {};
  const groupTexts = i18n.groups || {};
  const hl = encodeURIComponent(localeOf(lang));
  // person.slug: unique on the people page (its id there); groups are visited in TEAM_GROUPS
  // order, so when a name repeats (a student who is also an alumnus) the first group keeps the
  // plain slug and the next gets "-2".
  const used = new Set([...Object.values(GROUP_ANCHORS), ...RESERVED_IDS]);
  const uniqueSlug = (name) => {
    const base = slugify(name) || 'member';
    let slug = base;
    for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
    used.add(slug);
    return slug;
  };

  const person = (m, group) => {
    const anchor = GROUP_ANCHORS[group] || '';
    if (typeof m === 'string') {
      return { name: m, slug: uniqueSlug(m), group, anchor, display_name: m, initials: initials(m) };
    }
    const name = isEmpty(m.name) ? '' : String(m.name);
    const p = { ...m, name, slug: uniqueSlug(name), group, anchor };
    m.slug = p.slug;  // data.team entries carry it too
    const tags = Array.isArray(m.tags) ? m.tags : [];
    if (FACULTY_GROUPS.includes(group)) {
      const gender = m.gender === 'f' ? 'f' : 'm';
      const prefix = prefixes[gender] || '';
      const role = roles[m.role] || {};
      p.display_name = prefix && name ? `${prefix} ${name}` : name;
      p.role_label = role[gender] || role.m || '';
    } else {
      p.display_name = name;
    }
    if (STUDENT_GROUPS.includes(group) && !isEmpty(m.since)) {
      const prefix = (groupTexts[group] || {}).since_prefix;
      p.since_label = prefix ? `${prefix} ${m.since}` : String(m.since);
    }
    p.initials = initials(name);
    p.tag_items = tags.map(id => ({ id, label: tagLabel(data.team_tags, id, lang) }));
    if (m.scholar_id) p.scholar_url = `https://scholar.google.com/citations?user=${encodeURIComponent(m.scholar_id)}&hl=${hl}`;
    if (m.lattes) p.lattes_url = `https://lattes.cnpq.br/${encodeURIComponent(m.lattes)}`;
    return p;
  };

  const groups = {};
  const names = [...TEAM_GROUPS, ...Object.keys(team).filter(g => !TEAM_GROUPS.includes(g))];
  for (const g of names) {
    const members = (team[g] && Array.isArray(team[g].members)) ? team[g].members : [];
    groups[g] = members.filter(m => m && (typeof m === 'string' || typeof m === 'object')).map(m => person(m, g));
  }
  return { groups, faculty: FACULTY_GROUPS.flatMap(g => groups[g]), anchors: { ...GROUP_ANCHORS } };
}

// Sets `lang` ('en', 'pt', 'es' or null when unsure; lib/lang.js) on every paper and citing
// paper of the loaded publications.json, from its title. Templates put lang="…" on a title
// whose language differs from the page's (WCAG 3.1.2). A `lang` already in the file wins.
function annotatePubLangs(raw) {
  const years = raw && Array.isArray(raw.years) ? raw.years : [];
  const annotate = (item) => {
    if (isPlainObject(item) && (typeof item.lang !== 'string' || !item.lang)) item.lang = guessTitleLang(item.title);
  };
  for (const y of years) {
    for (const item of (y && Array.isArray(y.items) ? y.items : [])) {
      annotate(item);
      if (isPlainObject(item) && Array.isArray(item.citing_papers)) item.citing_papers.forEach(annotate);
    }
  }
}

function buildPubs(raw, lang) {
  const years = raw && Array.isArray(raw.years) ? raw.years : [];
  const items = [];
  const perYear = new Map();
  for (const y of years) {
    const year = Number(y && y.year);
    if (!Number.isFinite(year)) continue;
    const list = Array.isArray(y.items) ? y.items : [];
    const entry = perYear.get(year) || { count: 0, citations: 0 };
    for (const item of list) {
      items.push({ ...item, year });
      entry.count += 1;
      entry.citations += Number(item.cited_by_count) || 0;
    }
    perYear.set(year, entry);
  }
  const known = [...perYear.keys()].sort((a, b) => a - b);
  const first = known.length ? known[0] : null;
  const last = known.length ? known[known.length - 1] : null;
  const span = [];
  for (let y = first; first !== null && y <= last; y++) span.push(y);  // gaps → 0
  const cites = item => Number(item.cited_by_count) || 0;
  return {
    total: items.length,
    citations: items.reduce((s, item) => s + cites(item), 0),
    first_year: first,
    last_year: last,
    years: span.map(year => ({ year, count: (perYear.get(year) || {}).count || 0 })),
    citations_by_year: span.map(year => ({ year, count: (perYear.get(year) || {}).citations || 0 })),
    // Within a year the file lists papers by citations, so "latest" = top of the newest years.
    latest: [...items].sort((a, b) => b.year - a.year).slice(0, 4),
    most_cited: [...items]
      .sort((a, b) => cites(b) - cites(a) || b.year - a.year || String(a.title).localeCompare(String(b.title)))
      .slice(0, 3),
    generated_at: (raw && raw.generated_at) || '',
    updated_label: formatDate(raw && raw.generated_at, lang),
  };
}

function buildStats(data, pubs, people) {
  const counters = isPlainObject(data.counters) ? data.counters : {};
  const count = groups => groups.reduce((s, g) => s + (people.groups[g] || []).length, 0);
  return Object.entries(counters).filter(([, c]) => isPlainObject(c)).map(([id, c]) => {
    const source = c.source || 'manual';
    const value = source === 'publications' ? pubs.total
      : source === 'citations' ? pubs.citations
      : source === 'faculty' ? count(FACULTY_GROUPS)
      : source === 'students' ? count(STUDENT_GROUPS)
      : Number(c.value) || 0;
    return { id, label: c.label || '', value, suffix: c.suffix || '', source };
  });
}

function buildAreas(data, lang, faculty) {
  const research = isPlainObject(data.research) ? data.research : {};
  return Object.entries(research).filter(([, a]) => isPlainObject(a)).map(([id, a], i) => {
    const tags = Array.isArray(a.tags) ? a.tags : [];
    return {
      id,
      index: i + 1,
      icon: a.icon || '',
      title: a.title || '',
      text: a.text || '',
      tags,
      tag_items: tags.map(t => ({ id: t, label: tagLabel(data.team_tags, t, lang) })),
      people: faculty.filter(p => (p.tags || []).some(t => tags.includes(t))),
    };
  });
}

function buildProjects(projects) {
  if (!isPlainObject(projects)) return projects;
  const labels = projects.status_labels || {};
  const items = Array.isArray(projects.items) ? projects.items : [];
  return {
    ...projects,
    items: items.map(item => ({
      ...item,
      text_html: mdi(item.text),
      status_label: (item.status && labels[item.status]) || '',
    })),
  };
}

function buildFaq(faq) {
  if (!isPlainObject(faq)) return faq;
  const items = Array.isArray(faq.items) ? faq.items : [];
  return { ...faq, items: items.map(item => ({ ...item, answer_html: md(item.answer) })) };
}

// Sorted newest first. Dates are "YYYY", "YYYY-MM" or "YYYY-MM-DD", so they sort as strings
// (a year-only date comes after the dated entries of that year).
function buildNews(entries, data, lang, newsPageUrl) {
  const categories = (isPlainObject(data.ui) && data.ui.news_categories) || {};
  const str = v => (isEmpty(v) ? '' : String(v));
  return entries.map((e) => {
    const date = str(e.date);
    return {
      slug: e.slug,
      title: str(e.title),
      date,
      date_label: formatDate(date, lang),
      day_label: formatDayMonth(date, lang),
      year: /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null,
      category: str(e.category),
      category_label: str(categories[e.category]),
      featured: e.featured === true,
      event: str(e.event),
      location: str(e.location),
      highlight: str(e.highlight),
      link: str(e.link),
      image: str(e.image),
      image_alt: str(e.image_alt),
      summary: str(e.summary),
      // <strong>/<em> text in another language (e.g. an English paper title) gets lang="…"
      summary_html: langifyEmphasis(mdi(e.summary), lang),
      body: str(e.body),
      body_html: langifyEmphasis(md(e.body), lang),
      url: `${newsPageUrl}#${e.slug}`,
    };
  }).sort((a, b) => (a.date === b.date ? a.slug.localeCompare(b.slug) : a.date < b.date ? 1 : -1));
}

// ── Template context ─────────────────────────────────────────────────────────

// Context for a page (PAGES key) or a special view ('404', '_styleguide') in a language.
// See spec/data-model.md §3 for the contract.
function buildContext(lang, pageKey) {
  if (!LANGUAGES[lang]) lang = DEFAULT_LANG;
  const isPage = PAGES.includes(pageKey);
  const urls = Object.fromEntries(PAGES.map(p => [p, pageUrl(lang, p)]));
  const data = loadData(lang);

  annotatePubLangs(data.publications);
  data.pubs = buildPubs(data.publications, lang);
  data.people = buildPeople(data, lang);
  // pub.facets (people, venue, type) on every paper + the archive's filter options (lib/pub-facets.js)
  data.pub_facets = buildPubFacets(data.publications, data.people);
  data.stats = buildStats(data, data.pubs, data.people);
  data.areas = buildAreas(data, lang, data.people.faculty);
  if (data.projects) data.projects = buildProjects(data.projects);
  if (data.faq) data.faq = buildFaq(data.faq);
  data.news = buildNews(loadNews(lang), data, lang, urls.noticias || pageUrl(lang, 'noticias'));
  data.featured_news = data.news.find(n => n.featured) || data.news[0] || null;
  data.awards = data.news.filter(n => n.category === 'award');

  return {
    lang,
    lang_html: LANGUAGES[lang].html,
    languages: LANGUAGES,
    default_lang: DEFAULT_LANG,
    page_key: pageKey,
    currentPage: pageKey,
    build_year: new Date().getFullYear(),
    base_path: BASE_PATH,
    base_url: langBase(lang),
    site_url: SITE_URL,
    urls,
    // The current page in every language (the home page for views that are not pages).
    lang_urls: Object.fromEntries(LANGS.map(l => [l, pageUrl(l, isPage ? pageKey : 'index')])),
    page: isPage ? loadPage(lang, pageKey) : {},
    data,
  };
}

// The 404 view. The static build renders it once (pt) as dist/404.html; GitHub Pages serves it
// for every unknown URL, so `not_found_i18n` carries the texts of every language for the
// client-side swap by path prefix (views/404.njk), header, main content and footer alike:
// { pt|en|es|it: { title, text, home, links_heading, nav, skip_link, footer, common: { new_tab },
//   location, urls, lang_html } }.
function notFoundContext(lang = DEFAULT_LANG) {
  const ctx = buildContext(lang, '404');
  const siteName = (ctx.data.site && ctx.data.site.name) || '';
  const nf = (ctx.data.ui && ctx.data.ui.not_found) || {};
  ctx.page = {
    title: [nf.title, siteName].filter(Boolean).join(' — '),
    description: nf.text || '',
  };
  ctx.not_found_i18n = Object.fromEntries(LANGS.map((l) => {
    const ui = l === lang ? (ctx.data.ui || {}) : loadLangDataFile(l, 'ui');
    const contact = l === lang ? (ctx.data.contact || {}) : loadLangDataFile(l, 'contact');
    const t = ui.not_found || {};
    return [l, {
      title: t.title || '',
      text: t.text || '',
      home: t.home || '',
      links_heading: t.links_heading || '',
      nav: { ...(ui.nav || {}) },
      skip_link: ui.skip_link || '',
      footer: { ...(ui.footer || {}) },
      common: { new_tab: (ui.common && ui.common.new_tab) || '' },
      location: { ...(contact.location || {}) },
      urls: Object.fromEntries(PAGES.map(p => [p, pageUrl(l, p)])),
      lang_html: LANGUAGES[l].html,
    }];
  }));
  return ctx;
}

// Dev-only style guide (GET /_styleguide outside production).
function styleguideContext(lang = DEFAULT_LANG) {
  const ctx = buildContext(lang, '_styleguide');
  ctx.page = { title: `Style guide — ${(ctx.data.site && ctx.data.site.name) || ''}`, description: '' };
  return ctx;
}

module.exports = {
  ROOT,
  CONTENT_DIR,
  PUBLIC_DIR,
  BASE_PATH,
  SITE_URL,
  LANGS,
  FACULTY_GROUPS,
  STUDENT_GROUPS,
  ALUMNI_GROUPS,
  TEAM_GROUPS,
  GROUP_ANCHORS,
  readYaml,
  readDataFile,
  parseFrontMatter,
  readMarkdown,
  merge,
  loadData,
  loadLangDataFile,
  loadPage,
  loadNews,
  langBase,
  pageUrl,
  localeOf,
  formatDate,
  formatDayMonth,
  formatNumber,
  initials,
  slugify,
  md,
  mdi,
  tagLabel,
  buildContext,
  notFoundContext,
  styleguideContext,
};
