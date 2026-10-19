'use strict';

// Language of short texts (paper titles, emphasised titles in news), for WCAG 3.1.2 Language
// of Parts: a title in another language than the page's gets lang="…", so screen readers switch
// voice.
//
//   guessTitleLang(text)          → 'en' | 'pt' | 'es' | null
//   langifyEmphasis(html, lang)   → html with lang="…" added to <strong>/<em> elements whose
//                                   text is in another language than `lang` (the site code)
//
// The guess weighs function words, diacritics and a few word endings. Precision matters more
// than recall: it returns null whenever the evidence is thin or mixed, e.g. a title made only
// of names, acronyms and technical terms, or one with Italian or French words.

// Function words (and a few very common title words) that point to one language. Words shared
// by Portuguese and Spanish (de, para, por, que…) count for both, as "romance"; words shared by
// English and Portuguese (a, as, do, no) count for neither.
const WORDS = {
  en: {
    the: 2, of: 1.5, and: 1.5, for: 1.5, with: 1.5, from: 1.5, to: 1, on: 1, in: 1, into: 1.5,
    onto: 1.5, by: 1, is: 1.5, are: 1.5, was: 1.5, were: 1.5, an: 1, its: 1.5, at: 1, or: 1,
    how: 1.5, what: 1.5, when: 1.5, why: 1.5, which: 1.5, who: 1.5, where: 1.5, does: 1.5,
    can: 1, using: 1.5, based: 1, towards: 1.5, toward: 1.5, through: 1.5, under: 1, over: 1,
    between: 1.5, among: 1.5, across: 1.5, beyond: 1.5, without: 1.5, within: 1.5,
    against: 1.5, after: 1, before: 1, during: 1.5, versus: 1, this: 1, that: 1, these: 1.5,
    those: 1.5, their: 1.5, our: 1, we: 1.5, you: 1.5, it: 1, be: 1, not: 1, than: 1.5,
    more: 1, less: 1, new: 1, all: 0.5, study: 1, analysis: 1, approach: 1,
  },
  pt: {
    da: 1.5, das: 1.5, dos: 1, em: 1.5, na: 1.5, nas: 1.5, nos: 1, um: 1.5, uma: 1.5, uns: 1.5,
    umas: 1.5, com: 1.5, pelo: 1.5, pela: 1.5, pelos: 1.5, pelas: 1.5, ao: 1.5, aos: 1.5,
    'à': 1.5, 'às': 1.5, 'não': 1.5, 'é': 1, e: 1, os: 1, ou: 1, sem: 1, seu: 1, sua: 1.5,
    seus: 1.5, suas: 1.5, 'através': 1.5, 'após': 1.5, 'até': 1.5, uso: 1, num: 1, numa: 1.5,
    nesta: 1.5, neste: 1.5, desta: 1.5, deste: 1.5, isso: 1.5, mais: 1, 'também': 1.5, 'há': 1,
    estudo: 1, 'análise': 1.5, abordagem: 1.5,
  },
  es: {
    y: 2, el: 2, los: 2, las: 2, la: 1, del: 1.5, en: 1.5, con: 1, una: 1, un: 0.5, es: 1,
    lo: 1, su: 1, sus: 1.5, 'más': 1.5, mediante: 1.5, hacia: 1.5, hasta: 1.5, 'según': 1.5,
    cuando: 1.5, donde: 1.5, sin: 1, muy: 1.5, estudio: 1, 'análisis': 1.5,
  },
  romance: {
    de: 1, para: 1, por: 1, que: 1, como: 0.5, sobre: 1, entre: 1, desde: 1, este: 0.5,
    esta: 0.5, estas: 0.5, o: 0.5,
  },
  // Italian and French: their presence makes the guess give up.
  other: {
    il: 1, di: 1, della: 1.5, delle: 1.5, dello: 1.5, dei: 1, degli: 1.5, nel: 1, nella: 1.5,
    nelle: 1.5, negli: 1.5, gli: 1.5, per: 1, che: 1, sono: 1, anche: 1, questo: 1.5,
    questa: 1.5, dal: 1, dalla: 1.5, sul: 1, sulla: 1.5, alla: 1, alle: 1, agli: 1.5,
    le: 1, les: 1.5, des: 1.5, du: 1.5, et: 1, pour: 1.5, dans: 1.5, une: 1.5, sur: 1,
    avec: 1.5, au: 1, aux: 1.5, est: 1, qui: 1, ces: 1.5, leur: 1.5, par: 1,
  },
};

// Word endings and letters, tested on each word: [regex, language, weight]. Only the first
// matching rule of a language counts for a word.
const SHAPES = [
  [/(?:ção|ções|çao|çoes)$/, 'pt', 2],
  [/[ãõ]/, 'pt', 1],
  [/ç/, 'pt', 1],
  [/(?:agem|agens)$/, 'pt', 1],
  [/dade$/, 'pt', 1],
  [/[âêô]/, 'pt', 0.5],
  [/ñ/, 'es', 2],
  [/(?:ción|ciones)$/, 'es', 2],
  [/dad$/, 'es', 1.5],
  [/(?:zione|zioni)$/, 'other', 2],
  [/n['’]t$/, 'en', 1.5],
  [/['’]s$/, 'en', 1],
  [/ness$/, 'en', 1],
  [/tions?$/, 'en', 0.5],
  [/.{3}ing$/, 'en', 0.5],
  [/.{2}ity$/, 'en', 0.5],
];

const WORD_RE = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(s) {
  return s.replace(/&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi, (m, dec, hex, name) => {
    const code = dec ? Number(dec) : hex ? parseInt(hex, 16) : NaN;
    if (dec || hex) return code > 0 && code <= 0x10FFFF ? String.fromCodePoint(code) : ' ';
    return ENTITIES[name.toLowerCase()] || m;
  });
}

function score(text) {
  const s = { en: 0, pt: 0, es: 0, romance: 0, other: 0 };
  const clean = String(text).normalize('NFC')
    .replace(/\bet\s+al\b\.?/gi, ' ')     // "et al." is Latin, not French
    .replace(/[¿¡]/g, () => { s.es += 2; return ' '; });
  // English plural possessive ("Chairs' Welcome"); "'s" is handled per word below
  s.en += (clean.match(/\p{L}s['’](?=[\s:,.;!?)]|$)/gu) || []).length;
  // In a mixed-case title, all-caps words are acronyms (DE, PSO, ON/OFF), not words
  const allCaps = clean === clean.toUpperCase();
  for (const raw of clean.match(WORD_RE) || []) {
    if (!allCaps && raw.length > 1 && raw === raw.toUpperCase()) continue;
    const w = raw.toLowerCase();
    let known = false;
    for (const lang of Object.keys(WORDS)) {
      if (Object.prototype.hasOwnProperty.call(WORDS[lang], w)) {
        s[lang] += WORDS[lang][w];
        known = true;
      }
    }
    if (known) continue;
    const done = new Set();
    for (const [re, lang, weight] of SHAPES) {
      if (!done.has(lang) && re.test(w)) {
        s[lang] += weight;
        done.add(lang);
      }
    }
  }
  return s;
}

const memo = new Map();

// 'en', 'pt', 'es' or null (unsure). Empty or non-string input → null.
function guessTitleLang(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  if (memo.has(text)) return memo.get(text);
  const s = score(text);
  const romance = s.pt + s.es + s.romance;
  const top = Math.max(s.en, romance);
  let lang = null;
  if (s.other > 0 && top < 3 + 2 * s.other) {
    lang = null;                                         // Italian or French words
  } else if (s.en >= 1 && s.en >= 2.5 * romance) {
    lang = 'en';
  } else if (romance >= 2 && romance >= 2.5 * s.en) {
    if (s.pt >= 1 && s.pt >= 2 * s.es && s.pt > s.es) lang = 'pt';
    else if (s.es >= 1 && s.es >= 2 * s.pt && s.es > s.pt) lang = 'es';
  }
  if (memo.size > 5000) memo.clear();
  memo.set(text, lang);
  return lang;
}

// Adds lang="…" to each <strong> and <em> of Markdown output (marked writes them without
// attributes) whose text is confidently in another language than `pageLang` (pt, en, es, it).
// Each element is judged by its own text; emphasis nested inside is judged separately, against
// the language of its parent.
function langifyEmphasis(html, pageLang) {
  if (typeof html !== 'string' || !html) return html || '';
  return html.replace(/<(strong|em)>([\s\S]*?)<\/\1>/g, (_, tag, inner) => {
    const own = inner.replace(/<(strong|em)>[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]*>/g, ' ');
    const guess = guessTitleLang(decodeEntities(own));
    const lang = guess && guess !== pageLang ? guess : null;
    const content = langifyEmphasis(inner, lang || pageLang);
    return lang ? `<${tag} lang="${lang}">${content}</${tag}>` : `<${tag}>${content}</${tag}>`;
  });
}

module.exports = { guessTitleLang, langifyEmphasis, score };
