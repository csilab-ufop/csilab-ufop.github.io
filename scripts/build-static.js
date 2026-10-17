'use strict';

const http  = require('http');
const fs    = require('fs');
const fsp   = fs.promises;
const path  = require('path');
const { spawn } = require('child_process');
const { LANGUAGES, DEFAULT_LANG, PAGES } = require('../config');

const PORT   = process.env.BUILD_PORT || 3999;
const DIST   = path.join(__dirname, '..', 'dist');
const PUBLIC = path.join(__dirname, '..', 'public');
const PUBS   = path.join(__dirname, '..', 'content', '_shared', 'data', 'publications.json');

// [route, output file], e.g. ['/en/equipe', 'en/equipe/index.html']
const ROUTES = Object.keys(LANGUAGES).flatMap(lang => PAGES.map(page => {
  const dir = [lang === DEFAULT_LANG ? '' : lang, page === 'index' ? '' : page].filter(Boolean).join('/');
  return [`/${dir}`, dir ? `${dir}/index.html` : 'index.html'];
}));

function fetchPage(route) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: 'localhost', port: PORT, path: route };
    http.get(opts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchPage(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`${route} returned HTTP ${res.statusCode}`));
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
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

async function waitForServer(retries = 50) {
  for (let i = 0; i < retries; i++) {
    try {
      await fetchPage('/');
      return;
    } catch (_) {
      await new Promise(r => setTimeout(r, 200));
    }
  }
  throw new Error(`server did not start on port ${PORT}`);
}

async function main() {
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT, NODE_ENV: 'production' },
    stdio: 'inherit',
  });
  try {
    await waitForServer();
    await render();
  } finally {
    server.kill();
  }
}

async function render() {
  await fsp.rm(DIST, { recursive: true, force: true });
  await fsp.mkdir(DIST, { recursive: true });

  for (const [route, outFile] of ROUTES) {
    const html    = await fetchPage(route);
    const outPath = path.join(DIST, outFile);
    await fsp.mkdir(path.dirname(outPath), { recursive: true });
    await fsp.writeFile(outPath, html);
    console.log(`  wrote  dist/${outFile}`);
  }

  await copyDir(PUBLIC, DIST);
  console.log('  copied public/ → dist/');

  // Published so the next fetch can reuse it instead of re-querying Google Scholar.
  if (fs.existsSync(PUBS)) {
    await fsp.mkdir(path.join(DIST, 'data'), { recursive: true });
    await fsp.copyFile(PUBS, path.join(DIST, 'data', 'publications.json'));
    console.log('  copied publications.json → dist/data/');
  }

  console.log(`\nBuild complete — ${ROUTES.length} pages, assets copied.`);
}

main().catch(err => { console.error(err); process.exit(1); });
