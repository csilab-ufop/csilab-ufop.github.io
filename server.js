'use strict';
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const nunjucks = require('nunjucks');
const yaml     = require('js-yaml');
const { LANGUAGES, DEFAULT_LANG, PAGES } = require('./config');

const app  = express();
const PORT = process.env.PORT || 3001;

const BASE_PATH = process.env.BASE_PATH || '';
const SITE_URL  = (process.env.SITE_URL || 'https://csilab.ufop.br').replace(/\/$/, '');

const LANGS       = Object.keys(LANGUAGES);
const FACULTY     = ['coordinators', 'professors', 'collaborators'];
const CONTENT_DIR = path.join(__dirname, 'content');

nunjucks.configure(path.join(__dirname, 'views'), {
  autoescape: true,
  express: app,
  noCache: process.env.NODE_ENV !== 'production',
});
app.set('view engine', 'njk');

function parseFrontmatter(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const raw   = fs.readFileSync(filePath, 'utf8');
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  return yaml.load(match[1]) || {};
}

const isObject = v => Object.prototype.toString.call(v) === '[object Object]';

function deepMerge(target, source) {
  for (const [k, v] of Object.entries(source)) {
    target[k] = isObject(v) && isObject(target[k]) ? deepMerge(target[k], v) : v;
  }
  return target;
}

// Files with the same name in _shared/data and {lang}/data are merged key by key,
// so language-independent values live once and only the texts are translated.
function loadYamlDir(dir, data) {
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    if (/\.(ya?ml|json)$/.test(f)) {
      const key = f.replace(/\.(ya?ml|json)$/, '');
      try {
        const value = yaml.load(fs.readFileSync(path.join(dir, f), 'utf8'));
        data[key] = isObject(value) && isObject(data[key]) ? deepMerge(data[key], value) : value;
      } catch (e) {
        console.error(`[content] Error loading ${dir}/${f}:`, e.message);
      }
    }
  }
}

function loadContent(lang, page) {
  const langDir = path.join(CONTENT_DIR, lang);
  const pageData = parseFrontmatter(path.join(langDir, `${page}.md`));
  const data = {};
  loadYamlDir(path.join(CONTENT_DIR, '_shared', 'data'), data);
  loadYamlDir(path.join(langDir, 'data'), data);
  return { page: pageData, data };
}

function langBase(lang) {
  return lang === DEFAULT_LANG ? BASE_PATH : `${BASE_PATH}/${lang}`;
}

function pageUrl(lang, page) {
  if (page !== 'index') return `${langBase(lang)}/${page}`;
  return langBase(lang) || '/';
}

function computeCounterTargets(data) {
  const { counters, team = {}, publications } = data;
  if (!counters) return;
  if (counters.publications) {
    counters.publications.target = (publications?.years || []).reduce((s, y) => s + y.items.length, 0);
  }
  if (counters.professors) {
    counters.professors.target = FACULTY.reduce((s, g) => s + (team[g]?.members?.length || 0), 0);
  }
}

function ctx(lang, page) {
  const { page: p, data } = loadContent(lang, page);
  computeCounterTargets(data);
  return {
    lang,
    lang_html: LANGUAGES[lang].html,
    languages: LANGUAGES,
    currentPage: page,
    base_url: langBase(lang),
    base_path: BASE_PATH,
    site_url: SITE_URL,
    lang_urls: Object.fromEntries(LANGS.map(l => [l, pageUrl(l, page)])),
    page: p,
    data,
  };
}

for (const page of PAGES) {
  app.get(`/${page}.html`, (req, res) => res.redirect(301, pageUrl(DEFAULT_LANG, page)));
  app.get(`/${DEFAULT_LANG}${page === 'index' ? '' : `/${page}`}`, (req, res) => res.redirect(301, pageUrl(DEFAULT_LANG, page)));
  for (const lang of LANGS) {
    app.get(pageUrl(lang, page).slice(BASE_PATH.length) || '/', (req, res) => res.render(`${page}.njk`, ctx(lang, page)));
  }
}

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, '0.0.0.0', () =>
  console.log(`CSI Lab running at http://localhost:${PORT}`));
