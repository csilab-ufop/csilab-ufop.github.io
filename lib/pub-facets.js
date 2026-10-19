'use strict';

// Facets of the publications archive (views/publicacoes.njk, public/js/publications.js), computed
// at build time from publications.json and the team:
//
// - people: the lab members who signed a paper. A paper belongs to a member when it comes from
//   the member's Google Scholar profile (user=<scholar_id> in its url) or when its author list
//   names the member. Scholar abbreviates given names ("Gladston Moreira" → "GJP Moreira",
//   "G Moreira"), so an author matches on the surname plus the first initial. Common surnames
//   (Silva, Santos, Oliveira…) need more: two initials or more that agree with the member's
//   known initials, learnt from the member's name, from the papers of their own profile, or,
//   failing both, from the only family of multi-initial forms that the corpus shows for that
//   surname and first initial. An author form that two members could claim matches neither.
// - venue: the venue name without volume, issue, pages, edition or year, grouped by its acronym
//   in parentheses when it has one, else case-insensitively.
// - type: journal, conference (proceedings), preprint or other (book, thesis, patent), a
//   heuristic on the venue text.
//
// Each paper gets `facets` = { people: [slug…], venue: key, type }; buildPubFacets() returns the
// option lists. Idempotent: it can run on the same loaded data more than once.

const FACULTY = ['coordinators', 'professors', 'collaborators'];
const STUDENTS = ['phd_students', 'masters_students', 'undergrads'];
const ALUMNI = ['alumni_grad', 'alumni_undergrad'];

const COMMON_SURNAMES = new Set(['silva', 'santos', 'oliveira', 'souza', 'sousa', 'ferreira', 'almeida',
  'pereira', 'costa', 'rodrigues', 'lima', 'gomes', 'alves', 'ribeiro', 'carvalho', 'martins', 'araujo',
  'barbosa', 'rocha', 'dias', 'nascimento', 'lopes', 'soares', 'vieira', 'fernandes', 'mendes', 'castro',
  'cardoso', 'teixeira', 'moura', 'correia', 'pinto', 'cunha']);
const PARTICLES = new Set(['da', 'das', 'de', 'del', 'di', 'do', 'dos', 'e', 'van', 'von', 'y']);
const SUFFIXES = new Set(['filho', 'junior', 'jr', 'neto', 'sobrinho']);

const fold = s => String(s || '').normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();

/** "GJP Moreira" → { surname: "moreira", initials: "gjp" }; "EJ da Silva Luz" → luz / ejs. */
function parseName(raw) {
  const tokens = String(raw || '').replace(/[​-‍﻿&]/g, ' ').replace(/\./g, '. ')
    .split(/\s+/).map(t => t.replace(/\.$/, '')).filter(Boolean);
  while (tokens.length > 1 && SUFFIXES.has(fold(tokens[tokens.length - 1]))) tokens.pop();
  if (tokens.length < 2) return null;
  const surname = fold(tokens.pop());
  let initials = '';
  for (const t of tokens) {
    const f = fold(t);
    if (PARTICLES.has(f)) continue;
    // an all-capitals token of up to four letters is a run of initials ("GJP"), else a word
    if (/^\p{Lu}{1,4}$/u.test(t)) initials += f;
    else initials += f[0];
  }
  return initials ? { surname, initials } : null;
}

const consistent = (a, b) => a.startsWith(b) || b.startsWith(a);

/** The family of multi-initial forms in a list (forms that extend one another: "GA" ⊂ "GAL"),
 *  when it holds every form, or at least three occurrences and three quarters of them. */
function family(forms) {
  const multi = forms.filter(f => f.length > 1);
  if (!multi.length) return null;
  let best = null;
  let bestN = 0;
  for (const head of new Set(multi)) {
    const n = multi.filter(f => head.startsWith(f)).length;
    if (n > bestN || (n === bestN && best && head.length > best.length)) { best = head; bestN = n; }
  }
  return bestN === multi.length || (bestN >= 3 && bestN / multi.length >= 0.75) ? best : null;
}

function userOf(url) {
  const m = /[?&]user=([^&#]+)/.exec(url || '');
  return m ? decodeURIComponent(m[1]) : '';
}

// ── venues ────────────────────────────────────────────────────────────────────

const ACRONYM = /\(([\p{Lu}][\p{L}-]*\p{Lu}[\p{L}-]*)(?:\s+(?:19|20)\d{2})?(?:\)|$)/gu;
const PAGE_PART = /^[\w–-]*\d[\w–/-]*$/;

/** "2020 IEEE congress on evolutionary computation (CEC), 1-8" → "IEEE congress on … (CEC)". */
function cleanVenue(raw) {
  let s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (/^https?:\/\//i.test(s)) return { name: s.replace(/^https?:\/\/(www\.)?([^/?#]+).*$/i, '$2'), acronym: '' };
  const truncated = /…\s*$/.test(s);
  s = s.replace(/\s*…\s*$/, '').trim();
  // trailing ", pages" / ", article number" / ", year" (twice: "…, 2016, 8")
  for (let k = 0; k < 2; k++) {
    const at = s.lastIndexOf(',');
    if (at > 0 && PAGE_PART.test(s.slice(at + 1).trim())) s = s.slice(0, at).trim();
  }
  // trailing volume and issue: " 52 (3)", " 51 (1_suppl", " 2018 (1)", " (1)"
  s = s.replace(/\s+\d[\w.]*\s*(?:\([^)]*\)?)?$/, '').replace(/\s*\(\d+\)$/, '').trim();
  // leading edition, year, "Proceedings of the", "Anais do", "The"
  for (let k = 0; k < 3; k++) {
    s = s.replace(/^(?:proceedings? of (?:the )?|anais do |the )/i, '')
      .replace(/^(?:19|20)\d{2}\s+/, '')
      .replace(/^\d+(?:st|nd|rd|th|º|ª)?\s+/i, '')
      .replace(/^[IVXLC]+\s+(?=\p{Lu})/u, '')
      .trim();
  }
  // trailing year ("… Conference 2026"), an acronym's year ("(CBIC 2025)")
  s = s.replace(/\s+(?:19|20)\d{2}$/, '').replace(/\(([\p{Lu}][\p{L}-]*)\s+(?:19|20)\d{2}\)/u, '($1)').trim();
  // a truncated acronym loses its closing parenthesis: "(SIBGRAPI" → "(SIBGRAPI)"
  let closed = false;
  if (/\([^)]*$/.test(s)) closed = /\([\p{Lu}][\p{L}-]*$/u.test(s);
  if (/\([^)]*$/.test(s)) s = /\([\p{Lu}][\p{L}-]*$/u.test(s) ? `${s})` : s.replace(/\s*\([^)]*$/, '');
  let acronym = '';
  for (const m of s.matchAll(ACRONYM)) acronym = m[1];
  if (/^arxiv/i.test(s)) s = 'arXiv';
  s = s.replace(/[\s,:;–-]+$/, '');
  // Scholar cut the name short: drop a dangling connective and say so (the key ignores the mark)
  if (truncated && !closed) s = `${s.replace(/\s+(?:of|in|on|and|for|the|de|da|do|e)$/i, '')} …`;
  return { name: s, acronym };
}

const PREPRINT = /arxiv|preprint/i;
const OTHER = /patent|university|universidade|pqdt|thesis|tese|disserta|handbook|hands-on science/i;
const CONFERENCE = /conference|congress|congresso|symposium|simp[oó]sio|workshop|proceeding|anais|encontro|escola regional|semin[aá]rio|meeting|colloquium|\b(?:SIBGRAPI|ENIAC|GEOINFO|ICEIS|VISIGRAPP|BraSNAM|KDMiLe|AISTech|FHYSCON|WebMedia|ASONAM|ICWSM|SBAI|CBA|CBIC)\b|IFAC-PapersOnLine|(?:^|\s)(?:19|20)\d{2}\s+(?:IEEE|ACM)\b/i;

function venueType(raw) {
  const s = String(raw || '');
  if (!s) return 'other';
  if (PREPRINT.test(s)) return 'preprint';
  if (OTHER.test(s)) return 'other';
  if (CONFERENCE.test(s)) return 'conference';
  return 'journal';
}

/** Title Case over all capitals, then the most frequent spelling. */
function bestName(names) {
  const tally = new Map();
  for (const n of names) tally.set(n, (tally.get(n) || 0) + 1);
  const caps = n => (n.match(/(?:^|\s)\p{Lu}/gu) || []).length;
  const shouting = n => n.length > 6 && n === n.toUpperCase();
  return [...tally.keys()].sort((a, b) => (shouting(a) - shouting(b)) || (tally.get(b) - tally.get(a)) || (caps(b) - caps(a)) || a.length - b.length)[0];
}

// ── people ────────────────────────────────────────────────────────────────────

function membersOf(people) {
  const groups = (people && people.groups) || {};
  const byName = new Map();
  const order = [...FACULTY, ...STUDENTS, ...ALUMNI, ...Object.keys(groups).filter(g => ![...FACULTY, ...STUDENTS, ...ALUMNI].includes(g))];
  for (const g of order) {
    for (const p of groups[g] || []) {
      const key = fold(p.name).trim();
      if (!key) continue;
      // one person listed twice (a student who is also an alumnus): the first group keeps them
      const known = byName.get(key);
      if (known) {
        if (!known.scholar_id && p.scholar_id) known.scholar_id = p.scholar_id;
        continue;
      }
      const parsed = parseName(p.name);
      if (!parsed) continue;
      byName.set(key, {
        slug: p.slug,
        name: p.name,
        scholar_id: p.scholar_id || '',
        category: FACULTY.includes(g) ? 'faculty' : STUDENTS.includes(g) ? 'students' : 'alumni',
        surname: parsed.surname,
        first: parsed.initials[0],
        initials: parsed.initials,
      });
    }
  }
  return [...byName.values()];
}

function buildPubFacets(raw, people) {
  const years = raw && Array.isArray(raw.years) ? raw.years : [];
  const items = [];
  for (const y of years) for (const item of (y && Array.isArray(y.items) ? y.items : [])) if (item && typeof item === 'object') items.push(item);
  const members = membersOf(people);
  const authorsOf = item => String(item.authors || '').split(',').map(parseName).filter(Boolean);
  const parsedAuthors = new Map(items.map(item => [item, authorsOf(item)]));

  // the initials each member is known by
  for (const m of members) {
    m.known = new Set();
    if (m.initials.length > 1) m.known.add(m.initials);
    if (m.scholar_id) {
      for (const item of items) {
        if (userOf(item.url) !== m.scholar_id) continue;
        for (const a of parsedAuthors.get(item)) if (a.surname === m.surname && a.initials[0] === m.first && a.initials.length > 1) m.known.add(a.initials);
      }
    }
    if (!m.known.size && COMMON_SURNAMES.has(m.surname)) {
      const forms = [];
      for (const a of parsedAuthors.values()) for (const x of a) if (x.surname === m.surname && x.initials[0] === m.first) forms.push(x.initials);
      const fam = family(forms);
      if (fam) m.known.add(fam);
    }
  }

  const claims = (m, a) => {
    if (a.surname !== m.surname || a.initials[0] !== m.first) return false;
    if (!COMMON_SURNAMES.has(m.surname)) {
      // rare surname: the first initial is enough unless both sides spell out more and disagree
      return a.initials.length < 2 || !m.known.size || [...m.known].some(k => consistent(k, a.initials));
    }
    return a.initials.length > 1 && [...m.known].some(k => consistent(k, a.initials));
  };

  const count = new Map();
  for (const item of items) {
    const found = new Set();
    const user = userOf(item.url);
    for (const m of members) if (m.scholar_id && m.scholar_id === user) found.add(m);
    for (const a of parsedAuthors.get(item)) {
      const who = members.filter(m => claims(m, a));
      if (who.length === 1) found.add(who[0]);
    }
    const slugs = members.filter(m => found.has(m)).map(m => m.slug);
    slugs.forEach(s => count.set(s, (count.get(s) || 0) + 1));
    item.facets = { ...(item.facets || {}), people: slugs };
  }

  // venues: group by acronym, else by the folded name; a name seen with an acronym takes it
  const cleaned = new Map(items.map(item => [item, cleanVenue(item.journal)]));
  const acronymOfName = new Map();
  for (const c of cleaned.values()) {
    if (!c.acronym) continue;
    const bare = fold(c.name.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/[\s,:;–-]+$/, '')).trim();
    if (bare) acronymOfName.set(bare, c.acronym);
  }
  const venues = new Map();
  for (const item of items) {
    const c = cleaned.get(item);
    const type = venueType(item.journal);
    let key = '';
    if (c.name) {
      const acronym = c.acronym || acronymOfName.get(fold(c.name).trim()) || '';
      key = acronym ? `a-${fold(acronym)}` : `n-${fold(c.name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
      const v = venues.get(key) || { key, names: [], count: 0, type };
      v.names.push(c.name);
      v.count += 1;
      venues.set(key, v);
    }
    item.facets = { ...item.facets, venue: key, type };
  }
  const venueList = [...venues.values()].filter(v => v.count >= 2)
    .map(v => ({ key: v.key, name: bestName(v.names), count: v.count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const listed = new Set(venueList.map(v => v.key));
  // keys of venues outside the list become "other" (one paper each, or none at all)
  for (const item of items) if (!listed.has(item.facets.venue)) item.facets.venue = 'other';

  const typeCount = { journal: 0, conference: 0, preprint: 0, other: 0 };
  items.forEach(item => { typeCount[item.facets.type] += 1; });

  const byCount = (a, b) => b.count - a.count || a.name.localeCompare(b.name);
  const peopleList = members.filter(m => count.get(m.slug)).map(m => ({ slug: m.slug, name: m.name, category: m.category, count: count.get(m.slug) }));
  return {
    people: ['faculty', 'students', 'alumni'].map(cat => ({ category: cat, members: peopleList.filter(p => p.category === cat).sort(byCount) })).filter(g => g.members.length),
    venues: venueList,
    venue_other: items.filter(item => item.facets.venue === 'other').length,
    types: ['journal', 'conference', 'preprint', 'other'].map(t => ({ key: t, count: typeCount[t] })).filter(t => t.count),
    cites: [1, 10, 50, 100].map(n => ({ min: n, count: items.filter(item => (Number(item.cited_by_count) || 0) >= n).length })),
  };
}

module.exports = { buildPubFacets, parseName, cleanVenue, venueType };
