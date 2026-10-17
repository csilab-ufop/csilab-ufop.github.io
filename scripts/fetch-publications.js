#!/usr/bin/env node
'use strict';

// Builds content/_shared/data/publications.json from the Google Scholar
// profiles listed in team.yaml (`scholar_id`), keeping only papers published
// from each member's `since` year on.
//
//   node scripts/fetch-publications.js            refresh from Google Scholar
//   node scripts/fetch-publications.js --cached   reuse the data published on the
//                                                 live site (no Scholar requests,
//                                                 unless nothing is published yet)
//
// Scholar has no API and blocks clients that make too many requests, so a refresh
// makes one request per profile and reuses the previously published data for the
// "Cited by" lists, re-fetching only those whose citation count changed.

const fs   = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const SCHOLAR    = 'https://scholar.google.com';
const SITE_URL   = (process.env.SITE_URL || 'https://csilab.ufop.br').replace(/\/$/, '');
const LIVE_URL   = `${SITE_URL}/data/publications.json`;
const TEAM_FILE  = path.join(__dirname, '../content/_shared/data/team.yaml');
const OUT_FILE   = path.join(__dirname, '../content/_shared/data/publications.json');
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0';

const PAGE_SIZE = 100;   // Scholar's maximum rows per profile page
const MAX_PAGES = 5;
const MIN_YEAR  = 2015;  // used for members without `since`
const MAX_CITES = Number(process.env.SCHOLAR_MAX_CITES ?? 20);  // "Cited by" pages per run
const DELAY_MS  = [8000, 20000];

const BLOCK_PAGE = /id="gs_captcha_f"|class="g-recaptcha"|unusual traffic from your computer/i;

class BlockedError extends Error {}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function warn(msg) {
  console.warn(process.env.GITHUB_ACTIONS ? `::warning::${msg}` : `Warning: ${msg}`);
}

let requestCount = 0;

async function scholarGet(url) {
  if (requestCount++ > 0) {
    const [min, max] = DELAY_MS;
    await sleep(min + Math.random() * (max - min));
  }
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en-US,en;q=0.9' },
  });
  const html = await res.text();
  if (res.status === 429 || res.status === 403 ||
      /\/sorry\/|accounts\.google\.com/.test(res.url) || BLOCK_PAGE.test(html)) {
    const via = res.redirected ? `, redirected to ${res.url}` : '';
    throw new BlockedError(`Google Scholar blocked the request (HTTP ${res.status}${via}) for ${url}`);
  }
  if (!res.ok) throw new Error(`Google Scholar HTTP ${res.status} for ${url}`);
  return html;
}

// ── HTML helpers ─────────────────────────────────────────────────────────────

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? m;
    return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  });
}

const text = s => decode((s || '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
const pick = (s, re) => (s.match(re) || [])[1] || '';
const absolute = url => (url.startsWith('/') ? SCHOLAR + url : url);

function normaliseTitle(t) {
  return (t || '').normalize('NFD').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ── Profiles ─────────────────────────────────────────────────────────────────

function parseProfile(html) {
  return [...html.matchAll(/<tr class="gsc_a_tr">([\s\S]*?)<\/tr>/g)].map(([, row]) => {
    const [authors = '', venue = ''] = [...row.matchAll(/<div class="gs_gray">([\s\S]*?)<\/div>/g)].map(m => m[1]);
    const href = decode(pick(row, /<a href="([^"]+)" class="gsc_a_at"/));
    const view = pick(href, /citation_for_view=([^&]+)/);
    return {
      title:   text(pick(row, /class="gsc_a_at"[^>]*>([\s\S]*?)<\/a>/)),
      authors: text(authors),
      venue:   text(venue.replace(/<span class="gs_oph">[\s\S]*?<\/span>/, '')),
      url:     view ? `${SCHOLAR}/citations?view_op=view_citation&hl=en&user=${view.split(':')[0]}&citation_for_view=${view}` : '',
      cites:   Number(text(pick(row, /class="gsc_a_ac[^"]*"[^>]*>([\s\S]*?)<\/a>/)).replace(/\D/g, '')) || 0,
      citesId: pick(row, /cites=([\d,]+)/),
      year:    Number(pick(row, /class="gsc_a_h gsc_a_hc[^"]*">(\d{4})</)) || null,
    };
  });
}

function sinceYear(member) {
  const y = member.since instanceof Date ? member.since.getUTCFullYear() : parseInt(member.since, 10);
  return Number.isFinite(y) ? y : MIN_YEAR;
}

async function fetchProfile(member) {
  const since = sinceYear(member);
  const rows  = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const html = await scholarGet(
      `${SCHOLAR}/citations?user=${encodeURIComponent(member.scholar_id)}&hl=en&sortby=pubdate&pagesize=${PAGE_SIZE}` +
      (page ? `&cstart=${page * PAGE_SIZE}` : '')
    );
    if (!html.includes('id="gsc_prf_in"')) {
      throw new Error(`no Scholar profile found for ${member.name} (scholar_id ${member.scholar_id})`);
    }
    const batch = parseProfile(html);
    if (html.includes('class="gsc_a_tr"') && !batch.some(r => r.title)) {
      throw new Error(`could not parse the Scholar profile of ${member.name}; the page layout may have changed`);
    }
    rows.push(...batch);
    // Rows come newest first with undated ones last, so stop once a page reaches before `since`.
    const last = batch[batch.length - 1];
    if (batch.length < PAGE_SIZE || !last.year || last.year < since) break;
  }
  // Rows without a venue are entries Scholar couldn't match to a publication
  // (course pages, mis-parsed duplicates, papers wrongly attributed): skip them.
  return rows.filter(r => r.title && r.venue && r.year && r.year >= since);
}

// The same paper shows up on every co-author's profile, sometimes split into
// several versions: group rows sharing a Scholar cluster id ("cites=") or a
// title, and keep the most cited row of each group.
function mergeRows(rows) {
  const parent = rows.map((_, i) => i);
  const find   = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const owner  = new Map();
  rows.forEach((r, i) => {
    const keys = [`t:${normaliseTitle(r.title)}`, ...r.citesId.split(',').filter(Boolean).map(id => `c:${id}`)];
    for (const k of keys) {
      if (owner.has(k)) parent[find(i)] = find(owner.get(k));
      else owner.set(k, i);
    }
  });
  const best = new Map();
  rows.forEach((r, i) => {
    const g = find(i);
    if (!best.has(g) || r.cites > best.get(g).cites) best.set(g, r);
  });
  return [...best.values()];
}

// ── "Cited by" lists ─────────────────────────────────────────────────────────

function parseCiting(html) {
  return html.split('<div class="gs_ri">').slice(1).map(block => {
    const h3   = pick(block, /<h3 class="gs_rt"[^>]*>([\s\S]*?)<\/h3>/);
    const meta = text(pick(block, /<div class="gs_a"[^>]*>([\s\S]*?)<\/div>/));
    const [authors = '', source = ''] = meta.split(' - ');
    const cp = {
      title:   text(h3).replace(/^(\[[^\]]+\]\s*)+/, ''),
      authors: authors.trim(),
    };
    const year = pick(source, /\b((?:19|20)\d{2})\b/);
    if (year) cp.year = Number(year);
    const url = decode(pick(h3, /href="([^"]+)"/));
    if (url) cp.url = absolute(url);
    const cited = Number(pick(block, />Cited by (\d+)</));
    if (cited) cp.cited_by_count = cited;
    return cp;
  }).filter(cp => cp.title);
}

async function fetchCiting(citesId) {
  return parseCiting(await scholarGet(`${SCHOLAR}/scholar?hl=en&cites=${citesId}`));
}

// ── Output ───────────────────────────────────────────────────────────────────

function badgeFor(venue) {
  if (/springer/i.test(venue))                                          return 'Springer';
  if (/ieee/i.test(venue))                                              return 'IEEE';
  if (/elsevier/i.test(venue))                                          return 'Elsevier';
  if (/wiley/i.test(venue))                                             return 'Wiley';
  if (/SBC|SBBD|SIBGRAPI|BRACIS|STIL|ENIAC|SBCAS|GEOINFO/i.test(venue)) return 'SBC';
  return null;
}

function toEntry(p) {
  const entry = { authors: p.authors, title: p.title };
  if (p.venue) entry.journal = p.venue;
  if (p.url) entry.url = p.url;
  const badge = badgeFor(p.venue);
  if (badge) entry.badge = badge;
  if (p.cites > 0) {
    entry.cited_by_count = p.cites;
    if (p.citesId) entry.scholar_cites_id = p.citesId;
  }
  return entry;
}

function indexEntries(data) {
  const index = new Map();
  for (const { items } of data?.years || []) {
    for (const e of items) {
      index.set(`t:${normaliseTitle(e.title)}`, e);
      for (const id of (e.scholar_cites_id || '').split(',').filter(Boolean)) index.set(`c:${id}`, e);
    }
  }
  return index;
}

function findPrevious(index, entry) {
  for (const id of (entry.scholar_cites_id || '').split(',').filter(Boolean)) {
    if (index.has(`c:${id}`)) return index.get(`c:${id}`);
  }
  return index.get(`t:${normaliseTitle(entry.title)}`);
}

function buildOutput(papers, entries) {
  const byYear = {};
  const citesByPubYear = {};
  papers.forEach((p, i) => {
    (byYear[p.year] ||= []).push(entries[i]);
    citesByPubYear[p.year] = (citesByPubYear[p.year] || 0) + p.cites;
  });
  const years = Object.keys(byYear).map(Number).sort((a, b) => b - a).map(year => ({
    year,
    items: byYear[year].sort((a, b) =>
      (b.cited_by_count || 0) - (a.cited_by_count || 0) || a.title.localeCompare(b.title)),
  }));
  return { generated_at: new Date().toISOString(), citations_by_pub_year: citesByPubYear, years };
}

// ── Previous data ────────────────────────────────────────────────────────────

async function loadPrevious() {
  const candidates = [];
  try {
    const res = await fetch(LIVE_URL, { headers: { 'Cache-Control': 'no-cache' } });
    if (res.ok) candidates.push({ from: LIVE_URL, data: await res.json() });
    else console.log(`  No published data at ${LIVE_URL} (HTTP ${res.status})`);
  } catch (err) {
    console.log(`  Could not load ${LIVE_URL}: ${err.message}`);
  }
  if (fs.existsSync(OUT_FILE)) {
    candidates.push({ from: path.relative(process.cwd(), OUT_FILE), data: JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')) });
  }
  candidates.sort((a, b) => String(b.data.generated_at).localeCompare(String(a.data.generated_at)));
  if (candidates[0]) console.log(`  Previous data: ${candidates[0].from} (${candidates[0].data.generated_at})`);
  return candidates[0]?.data ?? null;
}

function write(data) {
  fs.writeFileSync(OUT_FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');
  const total = (data.years || []).reduce((s, y) => s + y.items.length, 0);
  console.log(`\nWrote ${total} publications to ${path.relative(process.cwd(), OUT_FILE)}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const cachedOnly = process.argv.includes('--cached');

  console.log('Loading previously published data...');
  const previous = await loadPrevious();
  if (cachedOnly && previous) {
    write(previous);
    return;
  }
  if (cachedOnly) console.log('  Nothing published yet: fetching from Google Scholar once.');

  const team    = yaml.load(fs.readFileSync(TEAM_FILE, 'utf8'));
  const seen    = new Set();
  const members = Object.values(team)
    .flatMap(group => group?.members || [])
    .filter(m => m && typeof m === 'object' && m.scholar_id && !seen.has(m.scholar_id) && seen.add(m.scholar_id));
  if (!members.length) throw new Error('No team member has a scholar_id in team.yaml.');

  console.log(`\nFetching ${members.length} Google Scholar profiles...`);
  const rows = [];
  try {
    for (const m of members) {
      const found = await fetchProfile(m);
      console.log(`  ${m.name.padEnd(34)} ${String(found.length).padStart(3)} papers since ${sinceYear(m)}`);
      rows.push(...found);
    }
  } catch (err) {
    if (!previous) throw err;
    warn(`${err.message}. Keeping the previously published publications.`);
    write(previous);
    return;
  }

  const papers  = mergeRows(rows);
  const entries = papers.map(toEntry);
  console.log(`  ${rows.length} rows → ${papers.length} unique papers`);

  // Reuse "Cited by" lists whose citation count hasn't changed; refresh the rest,
  // biggest change first, up to MAX_CITES requests per run.
  const prevIndex = indexEntries(previous);
  const stale = [];
  for (const entry of entries) {
    if (!entry.scholar_cites_id) continue;
    const old = findPrevious(prevIndex, entry);
    if (old?.citing_papers) {
      entry.citing_papers        = old.citing_papers;
      entry.citing_checked_count = old.citing_checked_count;
    }
    if (entry.citing_checked_count !== entry.cited_by_count) {
      stale.push({ entry, gain: entry.cited_by_count - (entry.citing_checked_count || 0) });
    }
  }
  stale.sort((a, b) => b.gain - a.gain || b.entry.cited_by_count - a.entry.cited_by_count);

  const batch = stale.slice(0, MAX_CITES);
  console.log(`\n"Cited by" lists: ${entries.filter(e => e.scholar_cites_id).length - stale.length} up to date, ` +
              `${stale.length} stale, refreshing ${batch.length}...`);
  let refreshed = 0;
  for (const { entry } of batch) {
    try {
      entry.citing_papers        = (await fetchCiting(entry.scholar_cites_id)).slice(0, 10);
      entry.citing_checked_count = entry.cited_by_count;
      refreshed++;
    } catch (err) {
      warn(err.message);
      if (err instanceof BlockedError) break;
    }
  }
  console.log(`  Refreshed ${refreshed}; ${stale.length - refreshed} left for later runs`);

  write(buildOutput(papers, entries));
  console.log(`Google Scholar requests: ${requestCount}`);
}

main().catch(err => {
  console.error(process.env.GITHUB_ACTIONS ? `::error::${err.message}` : `Error: ${err.message}`);
  process.exit(1);
});
