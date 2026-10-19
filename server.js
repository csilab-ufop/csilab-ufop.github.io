'use strict';
const express  = require('express');
const path     = require('path');
const nunjucks = require('nunjucks');
const { LANGUAGES, DEFAULT_LANG, PAGES } = require('./config');
const content  = require('./lib/content');
const filters  = require('./lib/filters');

const app  = express();
const PORT = process.env.PORT || 3001;
const PRODUCTION = process.env.NODE_ENV === 'production';
const { BASE_PATH, LANGS, pageUrl } = content;

const env = nunjucks.configure(path.join(__dirname, 'views'), {
  autoescape: true,
  express: app,
  noCache: !PRODUCTION,
});
filters.register(env);
app.set('view engine', 'njk');

// Generated URLs include BASE_PATH; the app itself is mounted at the root.
const route = url => url.slice(BASE_PATH.length) || '/';

const queryOf = req => {
  const i = req.originalUrl.indexOf('?');
  return i === -1 ? '' : req.originalUrl.slice(i);
};

function render(res, next, view, makeContext, status = 200) {
  let ctx;
  try {
    ctx = makeContext();
  } catch (err) {
    return next(err);
  }
  res.render(view, ctx, (err, html) => {
    if (err) return next(err);
    res.status(status).send(html);
  });
}

// "/en/whatever" → "en"; anything without a language prefix → pt.
function langFromPath(urlPath) {
  const p = BASE_PATH && urlPath.startsWith(`${BASE_PATH}/`) ? urlPath.slice(BASE_PATH.length) : urlPath;
  const first = p.split('/')[1];
  return LANGUAGES[first] ? first : DEFAULT_LANG;
}

for (const page of PAGES) {
  // Legacy URLs: /<page>.html and /pt/... → the canonical pt URL.
  const legacy = [`/${page}.html`, page === 'index' ? `/${DEFAULT_LANG}` : `/${DEFAULT_LANG}/${page}`];
  for (const url of legacy) {
    app.get(url, (req, res) => res.redirect(301, pageUrl(DEFAULT_LANG, page) + queryOf(req)));
  }
  for (const lang of LANGS) {
    app.get(route(pageUrl(lang, page)), (req, res, next) =>
      render(res, next, `${page}.njk`, () => content.buildContext(lang, page)));
  }
}

// Rendered once (pt) by the static build as dist/404.html, which GitHub Pages serves for unknown URLs.
app.get('/404.html', (req, res, next) =>
  render(res, next, '404.njk', () => content.notFoundContext(DEFAULT_LANG)));

if (!PRODUCTION) {
  // Component style guide for development (?lang=en to switch language).
  app.get('/_styleguide', (req, res, next) => {
    const lang = LANGUAGES[req.query.lang] ? req.query.lang : DEFAULT_LANG;
    render(res, next, '_styleguide.njk', () => content.styleguideContext(lang));
  });
}

// The publications data, linked from the publications page; the static build copies it to
// dist/data/ (scripts/build-static.js).
app.get('/data/publications.json', (req, res, next) =>
  res.sendFile(path.join(content.CONTENT_DIR, '_shared', 'data', 'publications.json'), err => err && next()));

app.use(express.static(content.PUBLIC_DIR));

// Any other URL: the 404 page in the language of the path prefix.
app.use((req, res, next) =>
  render(res, next, '404.njk', () => content.notFoundContext(langFromPath(req.path)), 404));

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () =>
    console.log(`CSI Lab running at http://localhost:${PORT}`));
}

module.exports = app;
