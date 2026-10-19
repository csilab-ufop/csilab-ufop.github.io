'use strict';

// Site structure shared by server.js and scripts/build-static.js.
module.exports = {
  LANGUAGES: {
    pt: { html: 'pt-BR', name: 'Português' },
    en: { html: 'en',    name: 'English' },
    es: { html: 'es',    name: 'Español' },
    it: { html: 'it',    name: 'Italiano' },
  },
  DEFAULT_LANG: 'pt',
  // Page keys = template names (views/<key>.njk) = URL slugs (Portuguese in every language).
  PAGES: ['index', 'pesquisa', 'equipe', 'publicacoes', 'noticias', 'contato'],
};
