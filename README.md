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

The site is built and published to GitHub Pages at https://csilab.ufop.br once a week (Mondays 06:00 UTC), refreshing publications from Google Scholar (`.github/workflows/deploy.yml`). Pushes don't deploy, to keep Scholar requests to one run per week. To publish other changes sooner, run the workflow manually from the Actions tab: it redeploys with the publications already on the site and makes no Scholar requests.

## Where to edit

| Task | File |
|---|---|
| Team members | `content/_shared/data/team.yaml` |
| Research tags (4 languages) | `content/_shared/data/team_tags.yaml` |
| Social media, institutional links | `content/_shared/data/site.yaml` |
| Page titles / descriptions | `content/{lang}/*.md` (frontmatter) |
| Team section headings, role names | `content/{lang}/data/team_i18n.yaml` |
| Nav, footer, news, awards, research areas | `content/{lang}/data/*.yaml` |

A file in `content/_shared/data/` and one with the same name in `content/{lang}/data/` are merged key by key: language-independent values (icons, numbers, links) live once in the shared file and each language file only has the texts. For example, a new research area needs its icon in `_shared/data/research.yaml` and its title and text under the same key in each `{lang}/data/research.yaml`.

YAML and Markdown edits don't require a server restart.

## Team member format

```yaml
- name: "Firstname Lastname"     # no Prof./Profa. prefix
  gender: f                      # omit for male
  role_key: associate_professor  # key from team_i18n.yaml
  tags: [machine_learning, nlp]  # IDs from team_tags.yaml
  scholar_id: "XXXXXXXXXXXX"     # from scholar.google.com/citations?user=XXXXXXXXXXXX
  since: 2019                    # year they joined the lab
  email: "name@ufop.edu.br"      # optional; coordinators' emails also appear on the contact page
  lattes: "0000000000000000"     # optional; ID from lattes.cnpq.br/ID
```

Students only need `name` and `since` (plus `lattes` and `scholar_id` if they have them). Alumni are a plain list of names.

## Publications

Publications are not stored in the repo. `npm run fetch:pubs` reads every Google Scholar profile listed in `team.yaml` (`scholar_id`) and writes `content/_shared/data/publications.json` (gitignored):

- Only papers from each member's `since` year on are kept (2015 when `since` is missing); entries Scholar lists without a venue are skipped.
- Papers on several co-authors' profiles are merged.
- To remove or fix a paper, edit it on the owner's Google Scholar profile; the site follows on the next weekly run.

Scholar has no API and blocks clients that make too many requests, so each refresh makes one request per profile and reuses the data published at https://csilab.ufop.br/data/publications.json for the "Cited by" lists, re-fetching at most `SCHOLAR_MAX_CITES` (default 20) lists whose citation count changed. If Scholar blocks the run, the previously published data is kept.

`npm run dev` and `npm run build` download the published data instead (`--cached`), so they don't touch Google Scholar.

Scholar refuses GitHub's servers, so in CI every Scholar request runs as `curl` on `jackal`, a machine on the UFOP network (`SCHOLAR_SSH_HOST`), reached through `bridge_ufop`. The SSH setup comes from the repository secrets `SCHOLAR_SSH_CONFIG`, `SCHOLAR_SSH_KEY` and `SCHOLAR_SSH_KNOWN_HOSTS`. Locally, leave `SCHOLAR_SSH_HOST` unset to query Scholar directly.
