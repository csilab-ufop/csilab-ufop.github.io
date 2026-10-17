# CSI Lab · UFOP — Website

Static site built with Express + Nunjucks, available in PT (default), EN, ES and IT.

```bash
npm install
npm run dev          # http://localhost:3001 (downloads the published publications first)
npm run build        # pre-render to dist/
npm run fetch:pubs   # refresh publications from Google Scholar (CI does this weekly)
npm run validate:pubs
```

## Deploy

Every push to `main` builds the site and publishes it to GitHub Pages at https://csilab.ufop.br (`.github/workflows/deploy.yml`). Publications are refreshed from Google Scholar only by the weekly run (Mondays 06:00 UTC) or a manual run from the Actions tab; pushes reuse the data already published on the site.

## Where to edit

| Task | File |
|---|---|
| Team members | `content/_shared/data/team.yaml` |
| Research tags (4 languages) | `content/_shared/data/team_tags.yaml` |
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
  scholar_id: "XXXXXXXXXXXX"     # from scholar.google.com/citations?user=XXXXXXXXXXXX
  since: 2019                    # year they joined the lab
  links:
    - text: "Lattes →"
      href: "http://lattes.cnpq.br/ID"
```

Students only need `name`, `since` and `links` (plus `scholar_id` if they have a profile). Alumni are a plain list of names.

## Publications

Publications are not stored in the repo. `npm run fetch:pubs` reads every Google Scholar profile listed in `team.yaml` (`scholar_id`) and writes `content/_shared/data/publications.json` (gitignored):

- Only papers from each member's `since` year on are kept (2015 when `since` is missing); entries Scholar lists without a venue are skipped.
- Papers on several co-authors' profiles are merged.
- To remove or fix a paper, edit it on the owner's Google Scholar profile; the site follows on the next weekly run.

Scholar has no API and blocks clients that make too many requests, so each refresh makes one request per profile and reuses the data published at https://csilab.ufop.br/data/publications.json for the "Cited by" lists, re-fetching at most `SCHOLAR_MAX_CITES` (default 20) lists whose citation count changed. If Scholar blocks the run, the previously published data is kept.

`npm run dev` and `npm run build` download the published data instead (`--cached`), so they don't touch Google Scholar.
