'use strict';

// Nunjucks filters, registered by server.js: require('./lib/filters').register(env).
//
//   {{ text | md }}                     Markdown block → HTML (already marked safe)
//   {{ text | mdi }}                    Markdown inline, one paragraph without <p> (marked safe)
//   {{ "2024-12-13" | date_label }}     "13 de dezembro de 2024" in the current language;
//                                       "2024-12" → "dezembro de 2024", "2024" → "2024"
//   {{ 1234 | num }}                    Intl.NumberFormat of the current language ("1.234")
//   {{ "Gladston Moreira" | initials }} "GM"
//   {{ "computer_vision" | tag_label }} team tag label in the current language
//   {{ person.name | monogram }}        style string for the avatar() ridge monogram, e.g.
//                                       "--cx:112%;--cy:34%;--ridge:5.5px": the ridge origin
//                                       (16 points around the tile) and ridge spacing (3 steps),
//                                       picked by an FNV-1a hash of the name, so a person keeps
//                                       the same tile on every page, language and build
//
// Signatures: date_label(value, lang?), num(value, lang?), tag_label(id, lang?).
// The language is the explicit `lang` argument if given, otherwise the `lang` variable of the
// template context the filter runs in, otherwise pt. Macros imported WITHOUT `with context`
// run in an empty context, so inside them pass it explicitly: {{ d | date_label(lang) }}
// (with `lang` a macro argument), or import the macros `with context`.

const fs = require('fs');
const path = require('path');
const nunjucks = require('nunjucks');
const content = require('./content');
const { LANGUAGES, DEFAULT_LANG } = require('../config');

// `ctx` is the Nunjucks Context the filter was called with (`this` in a non-arrow function).
function langOf(ctx, explicit) {
  if (explicit && LANGUAGES[explicit]) return explicit;
  const fromContext = ctx && ctx.ctx && ctx.ctx.lang;
  return LANGUAGES[fromContext] ? fromContext : DEFAULT_LANG;
}

// team_tags from the template context, or read from disk when the filter runs without one.
const TAGS_FILE = path.join(content.CONTENT_DIR, '_shared', 'data', 'team_tags.yaml');
let tagsCache = { mtimeMs: -1, tags: {} };

function teamTags(ctx) {
  const fromContext = ctx && ctx.ctx && ctx.ctx.data && ctx.ctx.data.team_tags;
  if (fromContext) return fromContext;
  try {
    const { mtimeMs } = fs.statSync(TAGS_FILE);
    if (mtimeMs !== tagsCache.mtimeMs) tagsCache = { mtimeMs, tags: content.readYaml(TAGS_FILE) || {} };
  } catch (err) {
    tagsCache = { mtimeMs: -1, tags: {} };
  }
  return tagsCache.tags;
}

const safe = html => new nunjucks.runtime.SafeString(html);

// Ridge monogram (avatar() in views/_macros.njk, .avatar--monogram in site.css). Origins in % of
// the tile: 16 points evenly spread around it, alternately 12% and 6% outside an edge, so the
// concentric ridges cross the tile as arcs of different curvature from every direction.
const RIDGE_ORIGINS = [
  [4, -12], [35, -6], [66, -12], [96, -6],
  [112, 4], [106, 35], [112, 66], [106, 96],
  [96, 112], [65, 106], [34, 112], [4, 106],
  [-12, 96], [-6, 65], [-12, 34], [-6, 4],
];
const RIDGE_SPACINGS = ['4.5px', '5.5px', '6.5px'];

// FNV-1a, 32 bit, over the UTF-8 bytes of the NFC-normalized, lower-cased name.
function fnv1a(text) {
  let h = 0x811c9dc5;
  for (const byte of Buffer.from(String(text || '').normalize('NFC').toLowerCase(), 'utf8')) {
    h ^= byte;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

// Bits 28–31 pick the origin, bits 24–27 shift it along its edge (−7…+8%), bits 16–23 pick the
// spacing: 16 × 16 × 3 tiles. Only high bits are used: FNV-1a's low bits depend on the low bits
// of the input bytes alone, its high bits on all of them.
function monogram(name) {
  const h = fnv1a(name);
  const [x, y] = RIDGE_ORIGINS[h >>> 28];
  const shift = ((h >>> 24) & 0xf) - 7;
  const alongTop = y < 0 || y > 100;
  const cx = alongTop ? x + shift : x;
  const cy = alongTop ? y : y + shift;
  const ridge = RIDGE_SPACINGS[((h >>> 16) & 0xff) % RIDGE_SPACINGS.length];
  return `--cx:${cx}%;--cy:${cy}%;--ridge:${ridge}`;
}

function register(env) {
  env.addFilter('md', text => safe(content.md(text)));
  env.addFilter('mdi', text => safe(content.mdi(text)));
  env.addFilter('date_label', function dateLabel(value, lang) {
    return content.formatDate(value, langOf(this, lang));
  });
  env.addFilter('num', function num(value, lang) {
    return content.formatNumber(value, langOf(this, lang));
  });
  env.addFilter('initials', name => content.initials(name));
  env.addFilter('monogram', name => monogram(name));
  env.addFilter('tag_label', function tagLabel(id, lang) {
    return content.tagLabel(teamTags(this), id, langOf(this, lang));
  });
  return env;
}

module.exports = { register, langOf, monogram };
