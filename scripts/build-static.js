'use strict';

// Pre-renders every page × language (plus 404.html) from the Express server into DIST_DIR
// (default dist/), copies public/, publishes publications.json under data/ and writes
// sitemap.xml and robots.txt.
//
//   BUILD_PORT  port of the temporary server (default 3999)
//   DIST_DIR    output folder (default dist/)
//   SITE_URL    absolute origin for the sitemap (default https://csilab.ufop.br)
//   BASE_PATH   path prefix when the site is not served from the domain root
//   CONTENT_DIR, PUBLIC_DIR  content/ and public/ folders to use (default: the repository's)

const http  = require('http');
const os    = require('os');
const fs    = require('fs');
const fsp   = fs.promises;
const path  = require('path');
const { spawn } = require('child_process');
const { LANGUAGES, DEFAULT_LANG, PAGES } = require('../config');
const { pageUrl, SITE_URL, BASE_PATH, CONTENT_DIR, PUBLIC_DIR } = require('../lib/content');

const ROOT   = path.join(__dirname, '..');
const PORT   = Number(process.env.BUILD_PORT) || 3999;
const DIST   = path.resolve(process.env.DIST_DIR || path.join(ROOT, 'dist'));
const PUBLIC = PUBLIC_DIR;
const PUBS   = path.join(CONTENT_DIR, '_shared', 'data', 'publications.json');
const LANGS  = Object.keys(LANGUAGES);

// [route, output file], e.g. ['/en/equipe', 'en/equipe/index.html']
const ROUTES = [
  ...LANGS.flatMap(lang => PAGES.map(page => {
    const dir = [lang === DEFAULT_LANG ? '' : lang, page === 'index' ? '' : page].filter(Boolean).join('/');
    return [`/${dir}`, dir ? `${dir}/index.html` : 'index.html'];
  })),
  ['/404.html', '404.html'],
];

// The output folder is deleted first: refuse folders whose loss would hurt.
function assertSafeDist() {
  const inside = (child, parent) => child === parent || child.startsWith(parent + path.sep);
  const reason =
    DIST === path.parse(DIST).root ? 'is the filesystem root'
    : inside(ROOT, DIST) ? 'contains the repository'
    : DIST === os.homedir() ? 'is the home directory'
    : ['public', 'content', 'views', 'lib', 'scripts', 'node_modules', '.git', '.github']
      .some(d => inside(DIST, path.join(ROOT, d))) ? 'is inside a source folder'
    : null;
  if (reason) throw new Error(`DIST_DIR ${DIST} ${reason}; refusing to delete it.`);
}

function request(route) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: 'localhost', port: PORT, path: route }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}

async function fetchPage(route, hops = 0) {
  const res = await request(route);
  if (res.status >= 300 && res.status < 400 && res.headers.location && hops < 5) {
    return fetchPage(res.headers.location, hops + 1);
  }
  if (res.status !== 200) throw new Error(`${route} returned HTTP ${res.status}`);
  return res.body;
}

async function copyDir(src, dest) {
  await fsp.mkdir(dest, { recursive: true });
  for (const entry of await fsp.readdir(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(s, d);
    } else {
      await fsp.copyFile(s, d);
    }
  }
}

// Resolves as soon as the server answers at all; page errors are reported by render().
async function waitForServer(retries = 75) {
  for (let i = 0; i < retries; i++) {
    try {
      await request('/');
      return;
    } catch (_) {
      await new Promise(r => setTimeout(r, 200));
    }
  }
  throw new Error(`server did not start on port ${PORT}`);
}

const xmlEscape = s => String(s).replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

// generated_at of publications.json as a W3C datetime ("2026-10-17T22:22:25Z"), or null.
function pubsGeneratedAt() {
  try {
    const t = Date.parse(JSON.parse(fs.readFileSync(PUBS, 'utf8')).generated_at);
    return Number.isNaN(t) ? null : new Date(t).toISOString().replace(/\.\d+Z$/, 'Z');
  } catch (_) {
    return null;
  }
}

// Every page in every language, each with its hreflang alternates and x-default (pt). The
// publications pages, rebuilt from Google Scholar every week, also get <lastmod>.
function sitemapXml() {
  const abs = (lang, page) => xmlEscape(SITE_URL + pageUrl(lang, page));
  const pubsDate = pubsGeneratedAt();
  const urls = PAGES.flatMap(page => LANGS.map(lang => [
    '  <url>',
    `    <loc>${abs(lang, page)}</loc>`,
    ...(page === 'publicacoes' && pubsDate ? [`    <lastmod>${pubsDate}</lastmod>`] : []),
    ...LANGS.map(l => `    <xhtml:link rel="alternate" hreflang="${LANGUAGES[l].html}" href="${abs(l, page)}"/>`),
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${abs(DEFAULT_LANG, page)}"/>`,
    '  </url>',
  ].join('\n')));
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
}

function robotsTxt() {
  return [
    'User-agent: *',
    `Allow: ${BASE_PATH}/`,
    `Disallow: ${BASE_PATH}/admin/`,
    '',
    `Sitemap: ${SITE_URL}${BASE_PATH}/sitemap.xml`,
    '',
  ].join('\n');
}

// Relative to the working directory when inside it, absolute otherwise (e.g. DIST_DIR=/tmp/…).
const shown = (file) => {
  const rel = path.relative(process.cwd(), file);
  return !rel ? '.' : rel.startsWith('..') || path.isAbsolute(rel) ? file : rel;
};

async function render() {
  await fsp.rm(DIST, { recursive: true, force: true });
  await fsp.mkdir(DIST, { recursive: true });

  for (const [route, outFile] of ROUTES) {
    const html    = await fetchPage(route);
    const outPath = path.join(DIST, outFile);
    await fsp.mkdir(path.dirname(outPath), { recursive: true });
    await fsp.writeFile(outPath, html);
    console.log(`  wrote  ${shown(outPath)}`);
  }

  await copyDir(PUBLIC, DIST);
  console.log(`  copied public/ → ${shown(DIST)}/`);

  // Published so the next fetch can reuse it instead of re-querying Google Scholar.
  if (fs.existsSync(PUBS)) {
    await fsp.mkdir(path.join(DIST, 'data'), { recursive: true });
    await fsp.copyFile(PUBS, path.join(DIST, 'data', 'publications.json'));
    console.log(`  copied publications.json → ${shown(DIST)}/data/`);
  }

  await fsp.writeFile(path.join(DIST, 'sitemap.xml'), sitemapXml());
  await fsp.writeFile(path.join(DIST, 'robots.txt'), robotsTxt());
  console.log(`  wrote  ${shown(path.join(DIST, 'sitemap.xml'))} (${PAGES.length * LANGS.length} URLs) and robots.txt`);

  console.log(`\nBuild complete — ${ROUTES.length} pages (incl. 404.html), assets copied.`);
}

async function main() {
  assertSafeDist();
  const server = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production' },
    stdio: 'inherit',
  });
  const exited = new Promise((_, reject) => server.on('exit', code =>
    reject(new Error(`server exited early (code ${code})`))));
  try {
    await Promise.race([waitForServer(), exited]);
    await Promise.race([render(), exited]);
  } finally {
    server.removeAllListeners('exit');
    server.kill();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
