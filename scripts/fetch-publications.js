#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const OPENALEX_BASE = 'https://api.openalex.org';
const USER_AGENT    = 'csilab-site/1.0 (mailto:gladston@ufop.edu.br)';
const TEAM_FILE     = path.join(__dirname, '../content/_shared/data/team.yaml');
const OUT_FILE      = path.join(__dirname, '../content/_shared/data/publications.yaml');
const PER_PAGE      = 50;
const MAX_PAGES     = 20;
const STALE_HOURS   = 12;

const FACULTY_GROUPS = ['coordinators', 'professors', 'collaborators'];

function dataIsFresh() {
  if (!fs.existsSync(OUT_FILE)) return false;
  const ageHours = (Date.now() - fs.statSync(OUT_FILE).mtimeMs) / 3_600_000;
  return ageHours < STALE_HOURS;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAlex HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function resolveByOrcid(orcid) {
  const { results } = await fetchJson(
    `${OPENALEX_BASE}/authors?filter=orcid:${encodeURIComponent(orcid)}&per-page=1`
  );
  return results[0]?.id?.replace('https://openalex.org/', '') ?? null;
}

const SELECT_FIELDS = [
  'id', 'doi', 'title', 'authorships', 'publication_year',
  'primary_location', 'cited_by_count', 'counts_by_year',
].join(',');

async function fetchWorksForAuthors(ids) {
  const base =
    `${OPENALEX_BASE}/works` +
    `?filter=author.id:${ids.join('|')}` +
    `&select=${SELECT_FIELDS}` +
    `&sort=publication_year:desc` +
    `&per-page=${PER_PAGE}`;
  const first = await fetchJson(`${base}&page=1`);
  const pages = Math.min(Math.ceil(first.meta.count / PER_PAGE), MAX_PAGES);
  console.log(`  OpenAlex: ${first.meta.count} total works, fetching first ${pages * PER_PAGE}`);
  const works = [...first.results];
  for (let p = 2; p <= pages; p++) {
    const { results } = await fetchJson(`${base}&page=${p}`);
    works.push(...results);
  }
  return works;
}

function hasUFOPAffiliation(authorship) {
  return (authorship.institutions || []).some(inst =>
    /ouro preto/i.test(inst.display_name || '')
  );
}

function hasBrazilianAffiliation(authorship) {
  return (authorship.institutions || []).some(inst => inst.country_code === 'BR');
}

function aggregateCountries(works) {
  const counts = {};
  for (const w of works) {
    const seen = new Set();
    for (const a of w.authorships) {
      for (const inst of (a.institutions || [])) {
        const cc = inst.country_code;
        if (cc && !seen.has(cc)) {
          seen.add(cc);
          counts[cc] = (counts[cc] || 0) + 1;
        }
      }
    }
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([, a], [, b]) => b - a)
  );
}

function aggregateCitationsByYear(works) {
  const byYear = {};
  for (const w of works) {
    for (const { year, cited_by_count } of (w.counts_by_year || [])) {
      byYear[year] = (byYear[year] || 0) + cited_by_count;
    }
  }
  return Object.fromEntries(
    Object.entries(byYear)
      .map(([k, v]) => [Number(k), v])
      .sort(([a], [b]) => a - b)
  );
}

function workToEntry(w) {
  const entry = {
    authors: w.authorships.map(a => a.author.display_name).join(', '),
    title:   w.title,
    journal: w.primary_location?.source?.display_name || 'Unknown venue',
  };

  const oid = w.id?.replace('https://openalex.org/', '');
  if (oid) entry.oa_id = oid;

  if (w.doi) entry.url = `https://doi.org/${w.doi.replace(/^https?:\/\/doi\.org\//i, '')}`;
  if (w.cited_by_count > 0) entry.cited_by_count = w.cited_by_count;

  const countries = new Set();
  for (const a of w.authorships) {
    for (const inst of (a.institutions || [])) {
      if (inst.country_code) countries.add(inst.country_code);
    }
  }
  if (countries.size) entry.author_countries = [...countries].sort();

  const v = entry.journal;
  if      (/springer/i.test(v))                                         entry.badge = 'Springer';
  else if (/ieee/i.test(v))                                             entry.badge = 'IEEE';
  else if (/elsevier/i.test(v))                                         entry.badge = 'Elsevier';
  else if (/wiley/i.test(v))                                            entry.badge = 'Wiley';
  else if (/SBC|SBBD|SIBGRAPI|BRACIS|STIL|ENIAC|SBCAS|GEOINFO/i.test(v)) entry.badge = 'SBC';
  return { year: w.publication_year, entry };
}

function groupByYear(entries) {
  const byYear = {};
  for (const { year, entry } of entries) {
    if (!byYear[year]) byYear[year] = [];
    byYear[year].push(entry);
  }
  return byYear;
}

const IS_PREPRINT = /chemrxiv|arxiv|biorxiv|medrxiv|ssrn|isti open portal|preprint/i;

function normaliseTitle(t) {
  return (t || '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

function deduplicateEntries(entries) {
  const groups = new Map();
  for (const e of entries) {
    const key = normaliseTitle(e.entry.title);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }

  const result = [];
  for (const [, group] of groups) {
    if (group.length === 1) { result.push(group[0]); continue; }

    group.sort((a, b) => {
      const aPreprint = IS_PREPRINT.test(a.entry.journal || '');
      const bPreprint = IS_PREPRINT.test(b.entry.journal || '');
      if (aPreprint !== bPreprint) return aPreprint ? 1 : -1;
      const citeDiff = (b.entry.cited_by_count || 0) - (a.entry.cited_by_count || 0);
      if (citeDiff !== 0) return citeDiff;
      return (a.year || 0) - (b.year || 0);
    });

    const primary = { year: group[0].year, entry: { ...group[0].entry } };

    const seenUrls = new Set();
    const links = [];
    for (const g of group) {
      if (g.entry.url && !seenUrls.has(g.entry.url)) {
        seenUrls.add(g.entry.url);
        const link = { url: g.entry.url, journal: g.entry.journal };
        if (g.entry.badge) link.badge = g.entry.badge;
        links.push(link);
      }
    }
    if (links.length > 1) {
      primary.entry.access_links = links;
      delete primary.entry.url;
      delete primary.entry.badge;
    }

    const maxCited = Math.max(...group.map(g => g.entry.cited_by_count || 0));
    if (maxCited > 0) primary.entry.cited_by_count = maxCited;
    else delete primary.entry.cited_by_count;

    const seenCite = new Set();
    const allCiting = [];
    for (const g of group) {
      for (const cp of (g.entry.citing_papers || [])) {
        const ck = normaliseTitle(cp.title);
        if (!seenCite.has(ck)) { seenCite.add(ck); allCiting.push(cp); }
      }
    }
    if (allCiting.length > 0) {
      allCiting.sort((a, b) => (b.cited_by_count || 0) - (a.cited_by_count || 0));
      primary.entry.citing_papers = allCiting.slice(0, 10);
    }

    result.push(primary);
  }

  console.log(`  Deduplicated: ${entries.length} → ${result.length} entries`);
  return result;
}

async function main() {
  const force = process.argv.includes('--force');

  if (!force && dataIsFresh()) {
    const ageMin = Math.round((Date.now() - fs.statSync(OUT_FILE).mtimeMs) / 60_000);
    console.log(`Publications data is ${ageMin}m old (< ${STALE_HOURS}h). Skipping fetch.`);
    console.log('Pass --force to override.\n');
    return;
  }

  const teamData = yaml.load(fs.readFileSync(TEAM_FILE, 'utf8'));
  const members  = FACULTY_GROUPS.flatMap(g => teamData[g]?.members || []).filter(m => m.name);
  console.log(`Loaded ${members.length} faculty members from team.yaml\n`);

  console.log('Resolving OpenAlex author IDs...\n');
  const resolved = [];
  for (const m of members) {
    let id = null, anchor = false, note = '';
    if (m.orcid) {
      id = await resolveByOrcid(m.orcid);
      anchor = !!id;
      note = id ? `ORCID ${m.orcid} → anchor ✓` : `ORCID ${m.orcid} → not found`;
    } else if (m.openalex_id) {
      id     = m.openalex_id.replace('https://openalex.org/', '');
      anchor = true;
      note   = `openalex_id → anchor ✓`;
    } else {
      console.log(`  ${m.name.padEnd(34)} ${'(skipped)'.padEnd(16)} no orcid or openalex_id in team.yaml`);
      continue;
    }
    console.log(`  ${m.name.padEnd(34)} ${(id || '(not found)').padEnd(16)} ${note}`);
    if (id) resolved.push({ name: m.name, resolvedId: id, anchor });
  }

  const allIds    = resolved.map(r => r.resolvedId);
  const anchorIds = new Set(resolved.map(r => r.resolvedId));
  console.log(`\n  ${allIds.length} resolved, ${anchorIds.size} anchors\n`);

  if (!anchorIds.size) throw new Error('No anchor authors — aborting.');

  console.log('Fetching works...');
  const works = await fetchWorksForAuthors(allIds);
  console.log(`  Received ${works.length} works`);

  const anchorFull = new Set([...anchorIds].map(id => `https://openalex.org/${id}`));

  const filtered = works.filter(w => {
    if (w.publication_year < 2015) return false;

    const allAnchors  = w.authorships.filter(a => anchorFull.has(a.author.id));
    const ufopAnchors = allAnchors.filter(a => hasUFOPAffiliation(a));

    if (ufopAnchors.length === 0) return false;

    if (allAnchors.length >= 2) return true;

    if (w.authorships.length === 1) return true;

    return w.authorships.some(a =>
      !anchorFull.has(a.author.id) && hasBrazilianAffiliation(a)
    );
  });
  console.log(`  After year + UFOP + co-author plausibility filter: ${filtered.length} works`);

  const country_counts    = aggregateCountries(filtered);
  const citations_by_year = aggregateCitationsByYear(filtered);

  const topCountries = Object.entries(country_counts).slice(0, 5).map(([k, v]) => `${k}:${v}`).join(' ');
  console.log(`  Country contributions: ${Object.keys(country_counts).length} countries (top: ${topCountries})`);
  console.log(`  Citations timeline: ${Object.keys(citations_by_year).length} years`);

  const entries = filtered.map(workToEntry);

  const CITE_SELECT = 'id,doi,title,authorships,publication_year,cited_by_count';
  const cited = entries.filter(({ entry }) => entry.oa_id && entry.cited_by_count > 0);
  console.log(`\nFetching citing papers for ${cited.length} works...`);
  let citesFetched = 0;
  for (const { entry } of cited) {
    try {
      const url = `${OPENALEX_BASE}/works?filter=cites:${entry.oa_id}&sort=cited_by_count:desc&per-page=10&select=${CITE_SELECT}`;
      const { results } = await fetchJson(url);
      if (results && results.length > 0) {
        entry.citing_papers = results.map(w => {
          const auths  = (w.authorships || []).slice(0, 3).map(a => a.author?.display_name).filter(Boolean);
          const suffix = (w.authorships || []).length > 3 ? ' et al.' : '';
          const doi    = w.doi ? w.doi.replace(/^https?:\/\/doi\.org\//i, '') : null;
          const cp     = { title: w.title || '(no title)', authors: auths.join(', ') + suffix };
          if (w.publication_year) cp.year = w.publication_year;
          if (doi) cp.url = `https://doi.org/${doi}`;
          if (w.cited_by_count > 0) cp.cited_by_count = w.cited_by_count;
          return cp;
        });
        citesFetched++;
      }
    } catch (_) {}
    await new Promise(r => setTimeout(r, 120));
  }
  console.log(`  Done — citing papers stored for ${citesFetched} works`);

  const deduped = deduplicateEntries(entries);

  const byYear = groupByYear(deduped);
  const years  = Object.keys(byYear)
    .map(Number).sort((a, b) => b - a)
    .map(year => ({ year, items: byYear[year] }));

  const output = yaml.dump({ country_counts, citations_by_year, years }, { lineWidth: 140, quotingType: '"' });
  fs.writeFileSync(OUT_FILE, output, 'utf8');
  console.log(`\nDone — written to ${OUT_FILE}`);
  console.log('Review the file, then commit.');
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
