'use strict';
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const nunjucks = require('nunjucks');
const yaml     = require('js-yaml');

const app  = express();
const PORT = process.env.PORT || 3001;

const BASE_PATH = process.env.BASE_PATH || '';
const SITE_URL  = (process.env.SITE_URL || 'https://csilab.ufop.br').replace(/\/$/, '');

const LANGS    = ['pt', 'en', 'es', 'it'];
const LANG_HTML = { pt: 'pt-BR', en: 'en', es: 'es', it: 'it' };
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

function loadYamlDir(dir, data) {
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    if (/\.(ya?ml|json)$/.test(f)) {
      const key = f.replace(/\.(ya?ml|json)$/, '');
      try {
        data[key] = yaml.load(fs.readFileSync(path.join(dir, f), 'utf8'));
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

function langUrls(page) {
  const urls = {};
  for (const l of LANGS) {
    if (l === 'pt') {
      urls.pt = page === 'index' ? (BASE_PATH || '/') : `${BASE_PATH}/${page}`;
    } else {
      urls[l] = page === 'index' ? `${BASE_PATH}/${l}` : `${BASE_PATH}/${l}/${page}`;
    }
  }
  return urls;
}

function computeCounterTargets(data) {
  if (!Array.isArray(data.counters)) return;
  const team = data.team || {};
  const overrides = {
    'c-publicacoes': (data.publications?.years || [])
      .reduce((s, yg) => s + (yg.items?.length || 0), 0),
    'c-professores': ['coordinators', 'professors', 'collaborators']
      .reduce((s, g) => s + (team[g]?.members?.length || 0), 0),
  };
  data.counters = data.counters.map(c =>
    overrides[c.id] !== undefined ? { ...c, target: overrides[c.id] } : c
  );
}

function ctx(lang, page, extra = {}) {
  const { page: p, data } = loadContent(lang, page);
  computeCounterTargets(data);
  const base_url = lang === 'pt' ? BASE_PATH : `${BASE_PATH}/${lang}`;
  return {
    lang,
    lang_html: LANG_HTML[lang],
    currentPage: page,
    base_url,
    base_path: BASE_PATH,
    site_url: SITE_URL,
    lang_urls: langUrls(page),
    page: p,
    data,
    ...extra,
  };
}

app.get('/index.html',       (req, res) => res.redirect(301, BASE_PATH || '/'));
app.get('/equipe.html',       (req, res) => res.redirect(301, `${BASE_PATH}/equipe`));
app.get('/publicacoes.html',  (req, res) => res.redirect(301, `${BASE_PATH}/publicacoes`));
app.get('/contato.html',      (req, res) => res.redirect(301, `${BASE_PATH}/contato`));
app.get('/pt',                (req, res) => res.redirect(301, BASE_PATH || '/'));
app.get('/pt/equipe',         (req, res) => res.redirect(301, `${BASE_PATH}/equipe`));
app.get('/pt/publicacoes',    (req, res) => res.redirect(301, `${BASE_PATH}/publicacoes`));
app.get('/pt/contato',        (req, res) => res.redirect(301, `${BASE_PATH}/contato`));

app.get('/',             (req, res) => res.render('index.njk',       ctx('pt', 'index')));
app.get('/equipe',       (req, res) => res.render('equipe.njk',      ctx('pt', 'equipe')));
app.get('/publicacoes',  (req, res) => res.render('publicacoes.njk', ctx('pt', 'publicacoes')));
app.get('/contato',      (req, res) => res.render('contato.njk',     ctx('pt', 'contato')));

for (const lang of LANGS.filter(l => l !== 'pt')) {
  app.get(`/${lang}`,             (req, res) => res.render('index.njk',       ctx(lang, 'index')));
  app.get(`/${lang}/equipe`,      (req, res) => res.render('equipe.njk',      ctx(lang, 'equipe')));
  app.get(`/${lang}/publicacoes`, (req, res) => res.render('publicacoes.njk', ctx(lang, 'publicacoes')));
  app.get(`/${lang}/contato`,     (req, res) => res.render('contato.njk',     ctx(lang, 'contato')));
}

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, '0.0.0.0', () =>
  console.log(`CSI Lab running at http://localhost:${PORT}`));
