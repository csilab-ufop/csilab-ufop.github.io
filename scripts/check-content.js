#!/usr/bin/env node
'use strict';

// Checks that the content is complete in every language and consistent with what the site
// and the CMS expect (spec: data-model.md §1–2), including that every key has a field in the
// CMS config, in the same order (section 10). Prints warnings and exits 0, so it never blocks
// `npm run dev` / `npm run build`.
//
//   node scripts/check-content.js                  print warnings
//   node scripts/check-content.js --strict         exit 1 when there are warnings
//   node scripts/check-content.js --no-cms         skip the CMS coverage check (section 10)
//   node scripts/check-content.js --content <dir>  check another content/ folder (e.g. a test
//                                                  copy); --public <dir> likewise for public/
//                                                  (where admin/config.yml is read)

const fs = require('fs');
const path = require('path');
const jsyaml = require('js-yaml');

// The folders must be set before lib/content.js reads them.
const argv = process.argv.slice(2);
for (const [flag, env] of [['--content', 'CONTENT_DIR'], ['--public', 'PUBLIC_DIR']]) {
  const i = argv.indexOf(flag);
  if (i !== -1 && argv[i + 1]) process.env[env] = path.resolve(argv[i + 1]);
}

const { LANGUAGES, DEFAULT_LANG, PAGES } = require('../config');
const {
  ROOT, CONTENT_DIR, PUBLIC_DIR, FACULTY_GROUPS, STUDENT_GROUPS, ALUMNI_GROUPS, TEAM_GROUPS,
  readYaml, readMarkdown,
} = require('../lib/content');

const LANGS = Object.keys(LANGUAGES);
const OTHER_LANGS = LANGS.filter(l => l !== DEFAULT_LANG);
const STRICT = argv.includes('--strict');
const NO_CMS = argv.includes('--no-cms');

const DATA_FILES = ['research', 'projects', 'counters', 'faq', 'contact', 'ui', 'team_i18n'];
const SHARED_FILES = ['site', 'team', 'team_tags'];
const PROJECT_STATUS = ['active', 'development', 'completed'];
const COUNTER_SOURCES = ['manual', 'publications', 'citations', 'faculty', 'students'];
const NEWS_CATEGORIES = ['award', 'conference', 'publication', 'project', 'event', 'open_source'];
const DATE_RE = /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/;
const BODY = '(body)';

// Values that are the same in every language (`i18n: duplicate` in the CMS).
// `*` = any map key, `[]` = any list index.
const IDENTICAL = [
  [/^data\/research\.yaml$/, ['*.icon', '*.tags']],
  [/^data\/projects\.yaml$/, ['items[].partner', 'items[].status', 'items[].link']],
  [/^data\/counters\.yaml$/, ['*.source', '*.value', '*.suffix']],
  [/^data\/contact\.yaml$/, ['join_items.*.icon']],
  [/^data\/faq\.yaml$/, ['items[].id']],
  [/^news\/[^/]+\.md$/, ['date', 'category', 'featured', 'link', 'image']],
  [/^pesquisa\.md$/, ['open_stat_value']],
];

const warnings = [];
const seen = new Set();
function warn(file, msg) {
  const line = `${file}: ${msg}`;
  if (!seen.has(line)) {
    seen.add(line);
    warnings.push(line);
  }
}

const isPlainObject = v => Object.prototype.toString.call(v) === '[object Object]';
const isEmpty = v => v === undefined || v === null || v === '';
const contentRel = (...parts) => path.posix.join('content', ...parts);

function walk(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name.startsWith('.')) return [];
    const abs = path.join(dir, e.name);
    return e.isDirectory() ? walk(abs, base) : [path.relative(base, abs).split(path.sep).join('/')];
  });
}

// Parsed file: YAML data, or front matter (+ body under BODY) for .md. null when unreadable.
function load(lang, rel) {
  const file = path.join(CONTENT_DIR, lang, rel);
  try {
    if (rel.endsWith('.md')) {
      const md = readMarkdown(file);
      return md.body ? { ...md.data, [BODY]: md.body } : md.data;
    }
    return readYaml(file);
  } catch (err) {
    warn(contentRel(lang, rel), `cannot be parsed (${err.message.replace(/^\[content\] /, '')})`);
    return null;
  }
}

// Leaf paths: { 'a.b': value, 'items[0].id': value, 'items': [] (empty list) }.
function leaves(value, prefix = '', out = new Map()) {
  if (Array.isArray(value)) {
    if (!value.length) out.set(prefix, value);
    value.forEach((v, i) => leaves(v, `${prefix}[${i}]`, out));
  } else if (isPlainObject(value)) {
    if (!Object.keys(value).length && prefix) out.set(prefix, value);
    for (const [k, v] of Object.entries(value)) leaves(v, prefix ? `${prefix}.${k}` : k, out);
  } else {
    out.set(prefix, value);
  }
  return out;
}

// Lists (by path) and their lengths, to report length differences once per list.
function lists(value, prefix = '', out = new Map()) {
  if (Array.isArray(value)) {
    out.set(prefix, value.length);
    value.forEach((v, i) => lists(v, `${prefix}[${i}]`, out));
  } else if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) lists(v, prefix ? `${prefix}.${k}` : k, out);
  }
  return out;
}

// Concrete [path, value] pairs matching a pattern such as 'items[].partner' or '*.icon'.
function select(value, pattern) {
  const tokens = pattern.replace(/\[\]/g, '.[]').split('.').filter(Boolean);
  let current = [['', value]];
  for (const t of tokens) {
    const next = [];
    for (const [p, v] of current) {
      if (t === '[]') {
        if (Array.isArray(v)) v.forEach((x, i) => next.push([`${p}[${i}]`, x]));
      } else if (t === '*') {
        if (isPlainObject(v)) for (const [k, x] of Object.entries(v)) next.push([p ? `${p}.${k}` : k, x]);
      } else if (isPlainObject(v) && t in v) {
        next.push([p ? `${p}.${t}` : t, v[t]]);
      }
    }
    current = next;
  }
  return current;
}

function publicFileExists(url) {
  if (typeof url !== 'string' || !url.startsWith('/')) return false;
  let decoded = url;
  try { decoded = decodeURI(url); } catch (_) { /* keep as written */ }
  return fs.existsSync(path.join(PUBLIC_DIR, decoded.replace(/^\/+/, '')));
}
const isUrl = v => typeof v === 'string' && /^(https?:\/\/|mailto:)/.test(v);

// The CMS config (Sveltia, public/admin/config.yml). js-yaml resolves its anchors and aliases
// (&faculty_fields, *photo_field). Problems reading it are reported by section 10.
const CMS_CONFIG_FILE = path.join(PUBLIC_DIR, 'admin', 'config.yml');
const CMS_CONFIG = 'public/admin/config.yml';
let cmsConfig = null;
let cmsConfigError = null;
try {
  cmsConfig = jsyaml.load(fs.readFileSync(CMS_CONFIG_FILE, 'utf8'));
  if (!isPlainObject(cmsConfig)) throw new Error('not a YAML map');
} catch (err) {
  cmsConfig = null;
  cmsConfigError = err.code === 'ENOENT' ? 'is missing' : `cannot be parsed (${String(err.message).split('\n')[0]})`;
}
// The `options` values of a select field of the CMS file whose path ends with `fileSuffix`
// (null when the config or the field is missing).
function cmsSelectValues(fileSuffix, fieldName) {
  const file = ((cmsConfig && cmsConfig.collections) || []).flatMap(c => (Array.isArray(c.files) ? c.files : []))
    .find(f => typeof f.file === 'string' && f.file.endsWith(fileSuffix));
  const find = (fields) => {
    for (const f of Array.isArray(fields) ? fields : []) {
      if (f && f.name === fieldName && f.widget === 'select' && Array.isArray(f.options)) return f;
      const sub = f && find(f.fields);
      if (sub) return sub;
    }
    return null;
  };
  const field = file && find(file.fields);
  return field ? field.options.map(o => (isPlainObject(o) ? String(o.value) : String(o))) : null;
}
// Research-area icons: the CMS select's options (all drawn by icon() in views/_macros.njk).
const RESEARCH_ICONS = cmsSelectValues('data/research.yaml', 'icon')
  || ['cpu', 'eye', 'layers', 'message', 'bar-chart', 'map', 'activity', 'sliders', 'sparkles', 'globe', 'code', 'users', 'book', 'search'];

// ── 1. Per-locale files exist in every language ──────────────────────────────
const filesByLang = Object.fromEntries(LANGS.map(l => [l, new Set(walk(path.join(CONTENT_DIR, l)))]));
const allFiles = [...new Set(LANGS.flatMap(l => [...filesByLang[l]]))].sort();
const expected = [...PAGES.map(p => `${p}.md`), ...DATA_FILES.map(f => `data/${f}.yaml`)];
for (const rel of expected) {
  if (!allFiles.includes(rel)) warn(contentRel(DEFAULT_LANG, rel), 'is missing in every language');
}
for (const rel of allFiles) {
  const missing = LANGS.filter(l => !filesByLang[l].has(rel));
  if (!missing.length) continue;
  const news = rel.match(/^news\/(.+)\.md$/);
  for (const l of missing) {
    warn(contentRel(l, rel), news ? `news "${news[1]}" is missing in ${l} (exists in ${LANGS.filter(x => !missing.includes(x)).join(', ')})`
      : `is missing (exists in ${LANGS.filter(x => !missing.includes(x)).join(', ')})`);
  }
}

// ── 2. Same keys, list lengths and non-empty values as pt ────────────────────
const parsed = {};  // parsed[rel][lang]
for (const rel of allFiles) {
  parsed[rel] = {};
  for (const l of LANGS) if (filesByLang[l].has(rel)) parsed[rel][l] = load(l, rel);
}

for (const rel of allFiles) {
  const base = parsed[rel][DEFAULT_LANG];
  if (base === undefined || base === null) continue;
  const baseLeaves = leaves(base);
  const baseLists = lists(base);
  for (const [p, v] of baseLeaves) {
    if (isEmpty(v)) warn(contentRel(DEFAULT_LANG, rel), `${p || '(root)'} is empty`);
  }
  for (const l of OTHER_LANGS) {
    const other = parsed[rel][l];
    if (other === undefined || other === null) continue;
    const file = contentRel(l, rel);
    const otherLeaves = leaves(other);
    const otherLists = lists(other);
    for (const [p, n] of baseLists) {
      if (otherLists.has(p) && otherLists.get(p) !== n) {
        warn(file, `list ${p || '(root)'} has ${otherLists.get(p)} items, pt has ${n}`);
      }
    }
    for (const [p, v] of baseLeaves) {
      if (!otherLeaves.has(p)) warn(file, `${p} is missing (pt: ${JSON.stringify(typeof v === 'string' && v.length > 60 ? `${v.slice(0, 60)}…` : v)})`);
      else if (isEmpty(otherLeaves.get(p)) && !isEmpty(v)) warn(file, `${p} is empty`);
    }
    for (const p of otherLeaves.keys()) {
      if (!baseLeaves.has(p)) warn(file, `${p} is not in the pt file`);
    }
  }
}

// ── 3. Language-independent values are identical ─────────────────────────────
for (const rel of allFiles) {
  const rule = IDENTICAL.find(([re]) => re.test(rel));
  if (!rule) continue;
  const base = parsed[rel][DEFAULT_LANG];
  if (base === undefined || base === null) continue;
  for (const l of OTHER_LANGS) {
    const other = parsed[rel][l];
    if (other === undefined || other === null) continue;
    for (const pattern of rule[1]) {
      const a = new Map(select(base, pattern));
      const b = new Map(select(other, pattern));
      for (const p of new Set([...a.keys(), ...b.keys()])) {
        if (JSON.stringify(a.get(p)) !== JSON.stringify(b.get(p))) {
          warn(contentRel(l, rel), `${p} must be identical in every language (pt: ${JSON.stringify(a.get(p))}, ${l}: ${JSON.stringify(b.get(p))})`);
        }
      }
    }
  }
}

// ── 4. Raw HTML (content is Markdown) ────────────────────────────────────────
for (const rel of allFiles) {
  for (const l of LANGS) {
    const v = parsed[rel][l];
    if (v === undefined || v === null) continue;
    for (const [p, s] of leaves(v)) {
      if (typeof s === 'string' && /<\/?[a-z][a-z0-9-]*(\s[^>]*)?\/?>|&(amp|lt|gt|quot|nbsp|#\d+);/i.test(s)) {
        warn(contentRel(l, rel), `${p} contains raw HTML; use Markdown`);
      }
    }
  }
}

// ── 5. Shared files, team, tags ──────────────────────────────────────────────
const shared = {};
for (const name of SHARED_FILES) {
  const file = path.join(CONTENT_DIR, '_shared', 'data', `${name}.yaml`);
  if (!fs.existsSync(file)) {
    warn(contentRel('_shared', 'data', `${name}.yaml`), 'is missing');
    continue;
  }
  try {
    shared[name] = readYaml(file);
  } catch (err) {
    warn(contentRel('_shared', 'data', `${name}.yaml`), `cannot be parsed (${err.message.replace(/^\[content\] /, '')})`);
  }
}
const TEAM_FILE = contentRel('_shared', 'data', 'team.yaml');
const TAGS_FILE = contentRel('_shared', 'data', 'team_tags.yaml');
const tags = isPlainObject(shared.team_tags) ? shared.team_tags : {};

for (const [id, t] of Object.entries(tags)) {
  for (const l of LANGS) {
    if (!isPlainObject(t) || typeof t[l] !== 'string' || !t[l].trim()) warn(TAGS_FILE, `${id}.${l} is missing or empty`);
  }
}
const checkTag = (file, where, id) => {
  if (!tags[id]) warn(file, `${where}: tag "${id}" is not defined in ${TAGS_FILE}`);
};

const teamI18n = Object.fromEntries(LANGS.map(l => [l, parsed['data/team_i18n.yaml'] && parsed['data/team_i18n.yaml'][l]]));
const team = shared.team;
if (team !== undefined && !isPlainObject(team)) {
  warn(TEAM_FILE, 'must be a map of groups');
} else if (team) {
  for (const g of TEAM_GROUPS) if (!isPlainObject(team[g])) warn(TEAM_FILE, `group ${g} is missing`);
  for (const g of Object.keys(team)) if (!TEAM_GROUPS.includes(g)) warn(TEAM_FILE, `unknown group ${g}`);
  for (const g of TEAM_GROUPS) {
    const members = isPlainObject(team[g]) ? team[g].members : undefined;
    if (!Array.isArray(members)) {
      if (isPlainObject(team[g])) warn(TEAM_FILE, `${g}.members must be a list`);
      continue;
    }
    members.forEach((m, i) => {
      const where = `${g}.members[${i}]`;
      if (ALUMNI_GROUPS.includes(g)) {
        if (typeof m !== 'string' || !m.trim()) warn(TEAM_FILE, `${where} must be a name (string)`);
        return;
      }
      if (!isPlainObject(m) || typeof m.name !== 'string' || !m.name.trim()) {
        warn(TEAM_FILE, `${where} needs a name`);
        return;
      }
      const who = `${where} (${m.name})`;
      if (FACULTY_GROUPS.includes(g)) {
        if (!['m', 'f'].includes(m.gender)) warn(TEAM_FILE, `${who}: gender must be "m" or "f"`);
        if (isEmpty(m.role)) warn(TEAM_FILE, `${who}: role is missing`);
        else {
          for (const l of LANGS) {
            const roles = teamI18n[l] && teamI18n[l].roles;
            const role = roles && roles[m.role];
            if (!role) warn(contentRel(l, 'data/team_i18n.yaml'), `role "${m.role}" (used by ${m.name}) is not defined`);
            else if (isEmpty(role[m.gender === 'f' ? 'f' : 'm'])) warn(contentRel(l, 'data/team_i18n.yaml'), `roles.${m.role}.${m.gender === 'f' ? 'f' : 'm'} is empty`);
          }
        }
        if (m.tags !== undefined && !Array.isArray(m.tags)) warn(TEAM_FILE, `${who}: tags must be a list`);
        (Array.isArray(m.tags) ? m.tags : []).forEach(t => checkTag(TEAM_FILE, who, t));
        if (!isEmpty(m.email) && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(m.email))) warn(TEAM_FILE, `${who}: email looks wrong`);
      } else {
        if (!Number.isInteger(m.since) || m.since < 1990 || m.since > 2100) warn(TEAM_FILE, `${who}: since must be a year (number)`);
      }
      if (!isEmpty(m.scholar_id) && !/^[A-Za-z0-9_-]+$/.test(String(m.scholar_id))) warn(TEAM_FILE, `${who}: scholar_id looks wrong`);
      if (!isEmpty(m.lattes) && !(typeof m.lattes === 'string' && /^\d+$/.test(m.lattes))) warn(TEAM_FILE, `${who}: lattes must be a quoted string of digits`);
      if (!isEmpty(m.website) && !isUrl(m.website)) warn(TEAM_FILE, `${who}: website must start with http(s)://`);
      if (!isEmpty(m.photo) && !publicFileExists(m.photo)) warn(TEAM_FILE, `${who}: photo ${m.photo} not found under public/`);
    });
  }
}

// ── 6. File-specific values ──────────────────────────────────────────────────
for (const l of LANGS) {
  const research = parsed['data/research.yaml'] && parsed['data/research.yaml'][l];
  if (isPlainObject(research)) {
    for (const [id, a] of Object.entries(research)) {
      const file = contentRel(l, 'data/research.yaml');
      if (!isPlainObject(a)) { warn(file, `${id} must be a map`); continue; }
      if (!RESEARCH_ICONS.includes(a.icon)) warn(file, `${id}.icon "${a.icon}" is not one of ${RESEARCH_ICONS.join(', ')}`);
      if (!Array.isArray(a.tags) || !a.tags.length) warn(file, `${id}.tags must be a non-empty list`);
      (Array.isArray(a.tags) ? a.tags : []).forEach(t => checkTag(file, `${id}.tags`, t));
    }
  }

  const projects = parsed['data/projects.yaml'] && parsed['data/projects.yaml'][l];
  if (isPlainObject(projects)) {
    const file = contentRel(l, 'data/projects.yaml');
    for (const s of PROJECT_STATUS) if (!isPlainObject(projects.status_labels) || isEmpty(projects.status_labels[s])) warn(file, `status_labels.${s} is missing`);
    (Array.isArray(projects.items) ? projects.items : []).forEach((it, i) => {
      if (!isEmpty(it && it.status) && !PROJECT_STATUS.includes(it.status)) warn(file, `items[${i}].status "${it.status}" is not one of ${PROJECT_STATUS.join(', ')}`);
      if (!isEmpty(it && it.link) && !isUrl(it.link)) warn(file, `items[${i}].link must start with http(s)://`);
    });
  }

  const counters = parsed['data/counters.yaml'] && parsed['data/counters.yaml'][l];
  if (isPlainObject(counters)) {
    const file = contentRel(l, 'data/counters.yaml');
    for (const [id, c] of Object.entries(counters)) {
      if (!isPlainObject(c)) { warn(file, `${id} must be a map`); continue; }
      if (!COUNTER_SOURCES.includes(c.source)) warn(file, `${id}.source "${c.source}" is not one of ${COUNTER_SOURCES.join(', ')}`);
      if (c.source === 'manual' && typeof c.value !== 'number') warn(file, `${id}.value must be a number for source "manual"`);
    }
  }

  const ui = parsed['data/ui.yaml'] && parsed['data/ui.yaml'][l];
  const uiPt = parsed['data/ui.yaml'] && parsed['data/ui.yaml'][DEFAULT_LANG];
  const hasCategory = (u, c) => isPlainObject(u) && isPlainObject(u.news_categories) && !isEmpty(u.news_categories[c]);
  for (const rel of allFiles.filter(r => /^news\/[^/]+\.md$/.test(r))) {
    const n = parsed[rel][l];
    if (!isPlainObject(n)) continue;
    const file = contentRel(l, rel);
    for (const key of ['title', 'date', 'category', 'summary']) if (isEmpty(n[key])) warn(file, `${key} is missing`);
    if (!isEmpty(n.date) && !DATE_RE.test(String(n.date))) warn(file, `date "${n.date}" must be "YYYY", "YYYY-MM" or "YYYY-MM-DD" (quoted)`);
    if (typeof n.date === 'number') warn(file, 'date must be a quoted string');
    if (!isEmpty(n.category) && !NEWS_CATEGORIES.includes(n.category)) warn(file, `category "${n.category}" is not one of ${NEWS_CATEGORIES.join(', ')}`);
    // a label missing only in en/es/it is already reported by section 2 (and falls back to pt)
    else if (!isEmpty(n.category) && !hasCategory(ui, n.category) && (l === DEFAULT_LANG || !hasCategory(uiPt, n.category))) {
      warn(contentRel(l, 'data/ui.yaml'), `news_categories.${n.category} is missing`);
    }
    if (typeof n.featured !== 'boolean') warn(file, 'featured must be true or false');
    if (!isEmpty(n.link) && !isUrl(n.link)) warn(file, 'link must start with http(s)://');
    if (!isEmpty(n.image) && !publicFileExists(n.image)) warn(file, `image ${n.image} not found under public/`);
    // The CMS can't require the description only when there is an image. A missing image_alt
    // in en/es/it while pt has one is reported by section 2 (and falls back to pt's text).
    const ptNews = parsed[rel][DEFAULT_LANG];
    const image = !isEmpty(n.image) ? n.image : isPlainObject(ptNews) ? ptNews.image : undefined;
    const ptAlt = isPlainObject(ptNews) ? ptNews.image_alt : undefined;
    if (!isEmpty(image) && isEmpty(n.image_alt) && (l === DEFAULT_LANG || isEmpty(ptAlt))) {
      warn(file, 'image is set but image_alt is empty: the photo would have alt="" (describe it for screen readers, in every language)');
    }
  }

  const faq = parsed['data/faq.yaml'] && parsed['data/faq.yaml'][l];
  if (isPlainObject(faq) && Array.isArray(faq.items)) {
    const first = new Map();
    faq.items.forEach((it, i) => {
      const id = it && !isEmpty(it.id) ? String(it.id) : null;
      if (id === null) return;
      if (first.has(id)) {
        warn(contentRel(l, 'data/faq.yaml'), `items[${i}].id "${id}" repeats items[${first.get(id)}].id: both questions would get id="faq-${id}" on the contact page`);
      } else {
        first.set(id, i);
      }
    });
  }
}

// ── 7. Same key order as pt (data-model §1: the order of the CMS fields) ─────
// Keys present in both files must come in the same order, so a CMS save causes no reordering.
function orderDiffs(a, b, p = '', out = []) {
  if (Array.isArray(a) && Array.isArray(b)) {
    a.forEach((x, i) => { if (i < b.length) orderDiffs(x, b[i], `${p}[${i}]`, out); });
  } else if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a).filter(k => k !== BODY && hasKey(b, k));
    const kb = Object.keys(b).filter(k => k !== BODY && hasKey(a, k));
    const i = ka.findIndex((k, n) => k !== kb[n]);
    if (i !== -1) out.push(`${p ? `${p}: ` : ''}"${kb[i]}" comes where pt has "${ka[i]}"`);
    for (const k of ka) orderDiffs(a[k], b[k], p ? `${p}.${k}` : k, out);
  }
  return out;
}
function hasKey(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
for (const rel of allFiles) {
  const base = parsed[rel][DEFAULT_LANG];
  if (base === undefined || base === null) continue;
  for (const l of OTHER_LANGS) {
    const other = parsed[rel][l];
    if (other === undefined || other === null) continue;
    for (const d of orderDiffs(base, other)) warn(contentRel(l, rel), `keys are in a different order than in pt: ${d}`);
  }
}

// ── 8. Strings without leading/trailing spaces (the CMS trims them on save) ──
for (const rel of allFiles) {
  for (const l of LANGS) {
    const v = parsed[rel][l];
    if (v === undefined || v === null) continue;
    for (const [p, s] of leaves(v)) {
      if (p !== BODY && typeof s === 'string' && s !== s.trim()) warn(contentRel(l, rel), `${p} has leading or trailing spaces`);
    }
  }
}
for (const [name, v] of Object.entries(shared)) {
  for (const [p, s] of leaves(v)) {
    if (typeof s === 'string' && s !== s.trim()) warn(contentRel('_shared', 'data', `${name}.yaml`), `${p} has leading or trailing spaces`);
  }
}

// ── 9. Written exactly as the CMS writes (data-model §1) ─────────────────────
// Sveltia CMS rewrites a whole file on save; a file must already be byte-identical to that
// output, or the first CMS commit reformats it: double-quoted strings, block lists indented
// under their key, no comments, no blank lines. The output is reproduced with the CMS's own
// YAML library (devDependency yaml, pinned to the version Sveltia 0.248.0 uses) and formatYAML()
// from sveltia-cms 0.248.0 src/lib/services/contents/file/format.js with our output options
// (quote: double, indent_size: 2, indent_sequences: true).
let YAML = null;
try {
  YAML = require('yaml');
} catch (_) {
  console.log('check-content: CMS format check skipped (devDependency "yaml" is not installed; run npm install)');
}
const YAML_1_1_BOOL = /^(?:y|Y|yes|Yes|YES|n|N|no|No|NO|true|True|TRUE|false|False|FALSE|on|On|ON|off|Off|OFF)$/;
const YAML_1_1_NUMBER = new RegExp(`^[-+]?(?:${[
  '0b[01_,]+', '0[0-7_,]+', '0x[\\da-fA-F_,]+', '(?:\\d[\\d_,]*)?\\.[\\d_,]*(?:[eE][-+]?\\d+)?',
  '\\d[\\d_,]*', '\\d[\\d_]*(?::[0-5]?\\d)+(?:\\.[\\d_]*)?',
].join('|')})$`);
function cmsYaml(data) {
  const doc = new YAML.Document(data);
  YAML.visit(doc, {
    Scalar(_key, node) {
      if (typeof node.value === 'string' && (YAML_1_1_BOOL.test(node.value) || YAML_1_1_NUMBER.test(node.value))) node.type = 'QUOTE_DOUBLE';
    },
  });
  return doc.toString({
    indent: 2, indentSeq: true, lineWidth: 0, defaultKeyType: 'PLAIN', defaultStringType: 'QUOTE_DOUBLE', singleQuote: false,
  }).trim();
}
const CMS_FRONT_MATTER = /^---\n(?:([\s\S]*?)\n)?---(?:\n([\s\S]*))?$/;
// The file as the CMS would write it back, or null when a .md file has no front matter.
function cmsText(raw, rel) {
  if (!rel.endsWith('.md')) return `${cmsYaml(YAML.parse(raw))}\n`;
  const m = raw.match(CMS_FRONT_MATTER);
  if (!m) return null;
  const body = (m[2] === undefined ? '' : m[2].replace(/^\n/, '')).trimEnd();
  return `---\n${cmsYaml(YAML.parse(m[1] || ''))}\n---\n${body ? `\n${body}\n` : ''}`;
}
if (YAML) {
  const files = [
    ...LANGS.flatMap(l => [...filesByLang[l]].filter(rel => /\.(ya?ml|md)$/.test(rel)).map(rel => [l, rel])),
    ...SHARED_FILES.map(name => ['_shared', `data/${name}.yaml`]),
  ];
  for (const [dir, rel] of files) {
    const abs = path.join(CONTENT_DIR, dir, rel);
    if (!fs.existsSync(abs)) continue;
    const raw = fs.readFileSync(abs, 'utf8');
    let want;
    try {
      want = cmsText(raw, rel);
    } catch (_) {
      continue;  // unreadable files are reported above
    }
    const file = contentRel(dir, rel);
    if (want === null) {
      warn(file, 'must start with front matter ("---", the fields, "---")');
    } else if (want !== raw) {
      const a = raw.split('\n');
      const b = want.split('\n');
      let i = 0;
      while (i < a.length && a[i] === b[i]) i++;
      warn(file, `not in CMS format at line ${i + 1}: ${JSON.stringify(a[i] === undefined ? '(end of file)' : a[i])}, the CMS writes ${JSON.stringify(b[i] === undefined ? '(end of file)' : b[i])} (double-quoted strings, block lists, no comments or blank lines)`);
    }
  }
}

// ── 10. CMS coverage: every key has a field in public/admin/config.yml ───────
// Sveltia rewrites a whole file on save, writing the keys in the order of the fields. A key with
// no field can't be edited and moves to the end of its object (alphabetically) on the first save;
// a key in another order than the fields is reordered; an empty required field blocks saving.
// Messages start with "CMS:"; one line per problem, with the languages that have it in braces.
// Skipped with --no-cms.
const CMS_PREFIX = 'CMS: ';
const warningsBeforeCms = warnings.length;
if (!NO_CMS && cmsConfigError) {
  warn(CMS_CONFIG, `${cmsConfigError}; the CMS coverage check was skipped (--no-cms skips it on purpose)`);
} else if (!NO_CMS) {
  const cmsLocales = (cmsConfig.i18n && Array.isArray(cmsConfig.i18n.locales)) ? cmsConfig.i18n.locales.map(String) : [];
  const defaultLocale = (cmsConfig.i18n && cmsConfig.i18n.default_locale) || cmsLocales[0] || DEFAULT_LANG;
  const collections = (Array.isArray(cmsConfig.collections) ? cmsConfig.collections : []).filter(c => isPlainObject(c) && !c.divider);
  const hasValue = v => !(isEmpty(v) || (Array.isArray(v) && !v.length) || (isPlainObject(v) && !Object.keys(v).length));
  const join = (at, k) => (at ? `${at}.${k}` : String(k));
  const absOf = rel => (rel.startsWith('content/') ? path.join(CONTENT_DIR, rel.slice('content/'.length)) : path.join(ROOT, rel));

  // Problems grouped by file and message, so a key missing in all four languages is one line.
  const problems = new Map();
  const report = (template, locale, message, sample) => {
    const key = `${template}\0${message}`;
    if (!problems.has(key)) problems.set(key, { template, message, sample, sampleLocale: locale, locales: [] });
    const p = problems.get(key);
    if (locale && !p.locales.includes(locale)) p.locales.push(locale);
  };

  // The file as the CMS edits it: YAML data, or front matter plus `body`. undefined = no file,
  // null = unreadable (reported by sections 1–2).
  const read = (rel) => {
    const abs = absOf(rel);
    if (!fs.existsSync(abs)) return undefined;
    try {
      if (!rel.endsWith('.md')) return readYaml(abs) ?? {};
      const md = readMarkdown(abs);
      return md.body ? { ...md.data, body: md.body } : md.data;
    } catch (_) {
      return null;
    }
  };

  // Field paths reachable through objects only (not lists), e.g. "location.room".
  const objectPaths = (fields, at = '', out = []) => {
    for (const f of fields) {
      if (!isPlainObject(f) || !f.name) continue;
      const p = join(at, f.name);
      out.push(p);
      if (f.widget === 'object' && Array.isArray(f.fields)) objectPaths(f.fields, p, out);
    }
    return out;
  };
  const hasPath = (data, p) => {
    let v = data;
    for (const k of p.split('.')) {
      if (!isPlainObject(v) || !Object.prototype.hasOwnProperty.call(v, k)) return false;
      v = v[k];
    }
    return true;
  };

  // Walks one object against its fields. `at` = key path inside the file ('' = top level);
  // ctx.fields = the names of the enclosing fields (for messages about the config).
  function walkFields(value, fields, at, ctx) {
    if (!isPlainObject(value)) return;
    const names = fields.map(f => f.name);
    const keys = Object.keys(value);
    keys.forEach((k, n) => {
      if (names.includes(k)) return;
      const prev = keys.slice(0, n).reverse().find(x => names.includes(x));
      ctx.report(`key "${join(at, k)}" has no field in ${CMS_CONFIG} (${ctx.id}${at ? ` › ${at}` : ''}): it can't be edited and the first CMS save moves it to the end; add its field ${prev ? `after "${prev}"` : 'first'}`, value[k]);
    });
    const present = keys.filter(k => names.includes(k));
    const expected = names.filter(x => present.includes(x));
    const i = present.findIndex((k, n) => k !== expected[n]);
    if (i !== -1) {
      ctx.report(`${at ? `${at}: ` : ''}key order differs from the fields in ${CMS_CONFIG} (${ctx.id}) at "${present[i]}", where the fields expect "${expected[i]}"; a CMS save would reorder the keys`);
    }
    for (const f of fields) {
      const v = value[f.name];
      const widget = f.widget || 'string';
      const p = ctx.root ? '' : join(at, f.name);
      const shownPath = p || f.name;
      const req = f.required === undefined ? true
        : Array.isArray(f.required) ? f.required.includes(ctx.locale || defaultLocale) : f.required === true;
      const shownHere = !ctx.locale || ctx.locale === defaultLocale || ctx.dup
        || f.i18n === true || f.i18n === 'translate' || f.i18n === 'duplicate';
      if (req && widget !== 'boolean' && !hasValue(v) && shownHere && !ctx.stale.has(shownPath)) {
        ctx.report(`required field "${shownPath}" is empty or missing; the CMS won't save this entry`);
      }
      if (ctx.i18n && !f.i18n && !ctx.dup && widget !== 'hidden') {
        warn(CMS_CONFIG, `${CMS_PREFIX}field ${ctx.id} › ${[...ctx.fields, f.name].join(' › ')} has no i18n option under a translated parent: it is hidden in ${cmsLocales.filter(x => x !== defaultLocale).join('/')} and stored in ${defaultLocale} only`);
      }
      const sub = {
        ...ctx, root: false, fields: [...ctx.fields, f.name],
        dup: ctx.dup || f.i18n === 'duplicate', i18n: ctx.i18n && f.i18n !== 'duplicate',
      };
      if (widget === 'object' && Array.isArray(f.fields)) walkFields(v, f.fields, p, sub);
      if (widget === 'list' && Array.isArray(f.fields)) {
        if (f.map_key_field) {
          const rest = f.fields.filter(x => x.name !== f.map_key_field);
          if (isPlainObject(v)) for (const [k, item] of Object.entries(v)) walkFields(item, rest, join(p, k), sub);
        } else if (Array.isArray(v)) {
          v.forEach((item, n) => walkFields(item, f.fields, `${p}[${n}]`, sub));
        }
      }
      if (widget === 'list' && f.field && Array.isArray(v)) {
        v.forEach((item, n) => { if (isPlainObject(item) || Array.isArray(item)) ctx.report(`${p}[${n}] must be a plain value`); });
      }
    }
  }

  const covered = new Set();
  const folderRes = [];
  for (const c of collections) {
    const targets = [];
    for (const f of (Array.isArray(c.files) ? c.files : [])) {
      if (!isPlainObject(f) || typeof f.file !== 'string') continue;
      targets.push({ id: `${c.name}/${f.name}`, path: f.file, fields: Array.isArray(f.fields) ? f.fields : [], i18n: !!(c.i18n && f.i18n), folder: false });
      for (const l of (f.file.includes('{{locale}}') ? cmsLocales : [null])) covered.add(l ? f.file.replace('{{locale}}', l) : f.file);
    }
    if (typeof c.folder === 'string') {
      folderRes.push(new RegExp(`^${c.folder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('\\{\\{locale\\}\\}', '[^/]+')}/[^/]+\\.md$`));
      const dirs = c.folder.includes('{{locale}}') ? cmsLocales.map(l => c.folder.replace('{{locale}}', l)) : [c.folder];
      const slugs = new Set(dirs.flatMap(d => (fs.existsSync(absOf(d)) ? fs.readdirSync(absOf(d)) : [])
        .filter(n => n.endsWith('.md') && !n.startsWith('.')).map(n => n.slice(0, -3))));
      for (const s of [...slugs].sort()) {
        targets.push({ id: `${c.name}/${s}`, path: `${c.folder}/${s}.md`, fields: Array.isArray(c.fields) ? c.fields : [], i18n: !!c.i18n, folder: true });
      }
    }
    for (const t of targets) {
      const locales = t.i18n && t.path.includes('{{locale}}') ? cmsLocales : [null];
      const docs = locales.map(locale => ({ locale, rel: locale ? t.path.replace('{{locale}}', locale) : t.path }))
        .map(d => ({ ...d, data: read(d.rel) }));
      for (const d of docs) {
        if (d.data === undefined) report(t.path, d.locale, `${t.id} points to this file, but it does not exist`);
      }
      const root = t.fields.length === 1 && t.fields[0].root === true;
      // A field that no language has a key for (files only: a news entry may leave optional
      // fields out): left behind after its key was removed, or the key was never added.
      const stale = new Set();
      if (!t.folder && !root) {
        const readable = docs.filter(d => isPlainObject(d.data));
        for (const p of readable.length ? objectPaths(t.fields) : []) {
          if (!readable.some(d => hasPath(d.data, p))) {
            stale.add(p);
            for (const d of readable) report(t.path, d.locale, `field "${p}" (${t.id}) has no key in any language: remove the field from ${CMS_CONFIG} or add the key`);
          }
        }
      }
      for (const d of docs) {
        if (d.data === undefined || d.data === null) continue;
        const shaped = root ? { [t.fields[0].name]: d.data } : d.data;
        walkFields(shaped, t.fields, '', {
          id: t.id, locale: d.locale, i18n: t.i18n && !!d.locale, dup: false, root, stale, fields: [],
          report: (message, sample) => report(t.path, d.locale, message, sample),
        });
      }
    }
  }

  // Content files that no collection points to (publications.json is generated, on purpose).
  const ignored = new Set(['content/_shared/data/publications.json']);
  for (const rel of walk(CONTENT_DIR).map(r => `content/${r}`)) {
    if (/\.(md|ya?ml|json)$/.test(rel) && !covered.has(rel) && !folderRes.some(re => re.test(rel)) && !ignored.has(rel)) {
      warn(rel, `${CMS_PREFIX}not editable: no collection in ${CMS_CONFIG} points to this file`);
    }
  }

  for (const p of problems.values()) {
    const file = !p.locales.length ? p.template
      : p.template.replace('{{locale}}', p.locales.length === 1 ? p.locales[0] : `{${p.locales.join(',')}}`);
    const sample = typeof p.sample === 'string'
      ? ` (${p.sampleLocale ? `${p.sampleLocale}: ` : ''}${JSON.stringify(p.sample.length > 60 ? `${p.sample.slice(0, 60)}…` : p.sample)})` : '';
    warn(file, `${CMS_PREFIX}${p.message}${sample}`);
  }
}
const cmsWarnings = warnings.length - warningsBeforeCms;

// ── Report ───────────────────────────────────────────────────────────────────
const fileCount = allFiles.reduce((s, rel) => s + LANGS.filter(l => filesByLang[l].has(rel)).length, 0) + SHARED_FILES.length;
const scope = `${fileCount} content files, ${LANGS.length} languages${NO_CMS ? ', CMS coverage not checked' : ''}`;
if (!warnings.length) {
  console.log(`check-content: 0 warnings (${scope})`);
} else {
  const ofCms = cmsWarnings ? `, ${cmsWarnings} of them from the CMS coverage check` : '';
  console.log(`check-content: ${warnings.length} warning${warnings.length === 1 ? '' : 's'}${ofCms} (${scope})`);
  for (const w of warnings) console.log(`  - ${w}`);
}
process.exit(STRICT && warnings.length ? 1 : 0);
