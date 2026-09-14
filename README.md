# CSI Lab · UFOP — Website

Static site built with Express + Nunjucks, available in PT (default), EN, ES and IT.

```bash
npm install
npm run dev          # http://localhost:3001 (fetches publications first)
npm run build        # pre-render to dist/
npm run fetch:pubs   # update publications from OpenAlex
npm run validate:pubs
```

## Deploy

Every push to `main` builds the site and publishes it to GitHub Pages at https://csilab.ufop.br (`.github/workflows/deploy.yml`).

## Where to edit

| Task | File |
|---|---|
| Team members | `content/_shared/data/team.yaml` |
| Research tags (4 languages) | `content/_shared/data/team_tags.yaml` |
| Publications | `content/_shared/data/publications.yaml` |
| Page titles / descriptions | `content/{lang}/*.md` (frontmatter) |
| Team section headings, role names | `content/{lang}/data/team_i18n.yaml` |
| Nav, footer, news, awards | `content/{lang}/data/*.yaml` |

YAML and Markdown edits don't require a server restart.

## Team member format

```yaml
- name: "Firstname Lastname"     # no Prof./Profa. prefix
  gender: f                      # omit for male
  role_key: associate_professor  # key from team_i18n.yaml
  tags: [machine_learning, nlp]  # IDs from team_tags.yaml
  orcid: "0000-0000-0000-0000"   # preferred for publication fetching
  openalex_id: "A0000000000"     # fallback when no ORCID
  links:
    - text: "Lattes →"
      href: "http://lattes.cnpq.br/ID"
```

Students only need `name`, `year` and `links`. Alumni are a plain list of names.

## Publications

`npm run fetch:pubs` pulls UFOP-affiliated papers from OpenAlex and merges them into `publications.yaml`. Review the result and add missing entries by hand:

```yaml
- year: 2026
  items:
    - authors: "Author A, Author B"
      title: "Paper Title"
      journal: "Venue"
      url: "https://doi.org/..."
      badge: "IEEE"
```
