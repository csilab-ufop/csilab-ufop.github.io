# CSI Lab · UFOP — Website

Static site built with Express + Nunjucks, available in PT (default), EN, ES and IT.

```bash
npm install
npm run dev            # http://localhost:3001 (downloads the published publications first)
npm run build          # pre-render to dist/
npm run check:content  # content checks (also run before dev and build)
npm run fetch:pubs     # refresh publications from Google Scholar (CI does this weekly)
npm run validate:pubs
```

## Deploy

The site is built and published to GitHub Pages at https://csilab.ufop.br on every push to `main` (including CMS saves) and on manual runs from the Actions tab, using the publications already on the site (`.github/workflows/deploy.yml`). Publications are refreshed from Google Scholar only by the weekly scheduled run (Mondays 06:00 UTC), because Scholar flags clients that query it often.

## Editing content

All texts, news, people and links live in `content/`. Every language has its own copy of each translated file (`{lang}` = `pt`, `en`, `es`, `it`); `pt` is the reference and fills any gap in the others. Edit them in the browser with the CMS at https://csilab.ufop.br/admin/, or edit the files directly: both produce the same files.

### In the browser (Sveltia CMS)

**Signing in.** The CMS commits to this repository as you, with a GitHub personal access token, so your GitHub account needs write access to `csilab-ufop/csilab-ufop.github.io`.

1. Create a fine-grained token with the [pre-filled form](https://github.com/settings/personal-access-tokens/new?name=CSI+Lab+CMS&target_name=csilab-ufop&expires_in=366&contents=write) (or GitHub › Settings › Developer settings › Personal access tokens › Fine-grained tokens › Generate new token) and check these settings before generating it:
   - **Resource owner: `csilab-ufop`**, the organization, not your own account. A token owned by your account can't write to the organization's repository.
   - Repository access: "Only select repositories" › `csilab-ufop.github.io`.
   - Repository permissions: **Contents: Read and write** (Metadata: Read-only is added automatically). Nothing else is needed.

   Don't use the "generate a token" link inside the CMS sign-in dialog: it opens the same GitHub form without the resource owner, so GitHub makes the token for your personal account.
2. `csilab-ufop` is an organization, and an organization can require an owner to approve fine-grained tokens. Until an owner approves it (the organization's Settings › Personal access tokens › Pending requests), the token can only read. If approval isn't possible, create a classic token instead (Personal access tokens › Tokens (classic)) with the `public_repo` scope, which is enough because this repository is public; use `repo` only if `public_repo` is refused, since `repo` also opens every private repository your account can reach, and the browser stores the token.
3. Open https://csilab.ufop.br/admin/, click "Sign In Using Access Token" ("Entrar Usando Token de Acesso") and paste the token. The browser keeps it until you sign out. When the token expires, create a new one and sign in again.

The CMS checks the token when you sign in, so most problems show up there, not when saving:

| Message | Cause |
|---|---|
| "You don’t have write access to the “csilab-ufop.github.io” repository." (in English even when the CMS is in Portuguese) or "Você não tem acesso ao repositório “csilab-ufop.github.io”." | The token is still pending the organization's approval, was made for your personal account instead of `csilab-ufop`, doesn't include this repository, or lacks Contents: Read and write; or your GitHub account has no write access to the repository. |
| "O token fornecido é inválido…" ("The provided token is invalid…") | The token was mistyped, has expired or was revoked: create a new one. |

The CMS interface follows the browser's language (it can also be changed in the CMS settings). Field names and hints are in Portuguese.

**Where things are.** The menu has five collections; the table under [Content files](#content-files) gives the file behind each screen.

- **Páginas**: the fixed texts of each page: title and description for search engines, headings, section labels, buttons, screen-reader texts.
- **Notícias**: news, events and awards, newest first. "New" ("Novo") creates an entry in all four languages. Its file name, which is also its anchor (`/noticias/#…`), comes from the Portuguese title when the entry is created and can't be changed afterwards.
- **Conteúdo**: research areas, R&D projects, home page numbers, FAQ, address and ways to join, interface texts (menu, footer, buttons, 404 page), team section headings and role names.
- **Equipe**: members (with photos) and research tags.
- **Configurações**: site name, social media, institutional links, map link.

Publications are not in the CMS: they come from the members' Google Scholar profiles every week (see [Publications](#publications)). To change them, fix the paper on Google Scholar, or the member's Scholar ID in Equipe › Membros.

**Translating side by side.** Translated screens open in two panes: Portuguese on the left, one other language on the right. The buttons at the top of the right pane switch it between English, Spanish and Italian (the CMS shows two languages at a time, not four).

- Values that don't depend on the language (news dates, categories and links, icons, tags, partner names, numbers) are edited in Portuguese only. The CMS writes them to all four files, and they are read-only in the other languages.
- Adding, removing or moving an item of a list (research areas, projects, home page numbers, FAQ, ways to join, roles) in Portuguese does the same in every language; the new item's texts are then filled in in each language.
- Required texts must be filled in in all four languages before Save works, and the language buttons mark the languages that still have errors. In a pane's menu (⋮), "Copy from…" ("Copiar de…") copies the texts of another language to start from. "Translate" ("Traduzir") needs a translation-service API key, which each user enters in the CMS settings.
- Optional texts of a news item (event, location, highlight, image description, full text) that are left empty in a language show the Portuguese text there. Fill them in in every language, or leave them empty in all of them.
- Members and research tags are one file for all languages. Each tag shows its Portuguese, English, Spanish and Italian names together.
- Identifiers (of research areas, numbers, FAQ items, ways to join, roles and tags) are used by the site and by other entries: don't change one that is in use. The ways to join `undergrad_research`, `graduate` and `industry` get their card links from these ids; a new id gets no link.
- Long lists open collapsed, one line per item (an area's title, a question, a person's name); click an item to open it, or use "Expand All" ("Expandir Tudo").
- Fields are in the order of the page, top to bottom, and labels start with the page section (e.g. "Sobre › título"). Hints say where a value comes from and what else it changes.
- Placeholders in braces (`{n}`, `{name}`, `{total}`, `{date}`, `{year}`, `{source}`, `{first}`, `{last}`) are replaced by the site with a number, a name or a date. Keep them in every language: the CMS refuses to save a text that lost one.

**Photos.** Equipe › Membros › a person › Foto. Face photos work best, square ones in particular, since the site shows them in a square. On save, the CMS converts the photo to WebP, at most 800 px wide (and 1000 px tall), gives it a lowercase file name without accents or spaces (`João Silva (1).jpg` → `joao-silva-1.webp`), stores it in `public/images/team/` and writes `/images/team/joao-silva-1.webp` in `team.yaml`. Without a photo the site shows the person's initials. News images work the same way, in `public/images/news/` (at most 1600 px).

**Publishing.** Each save is a commit to `main`, made with your GitHub account. Each save triggers the deploy workflow, so changes go live a few minutes later (watch Actions › Deploy to GitHub Pages). Until then, "View on Live Site" ("Ver no Site Ativo") shows the previous version. See [Deploy](#deploy).

**Working locally.** Run `npm run dev`, open http://localhost:3001/admin/ in Chrome, Edge or another Chromium-based browser, click "Work with Local Repository" ("Trabalhar com Repositório Local") and select this repository's folder (the one that contains `.git`). No token is needed: the CMS writes straight into your working copy, the dev server shows the change on reload, and you commit with Git as usual. This mode only works on `localhost`, and Firefox and Safari don't support it.

**Changing the CMS.** The configuration is `public/admin/config.yml`; `public/admin/index.html` loads Sveltia CMS from unpkg, pinned to the version the configuration was tested with (0.248.0). Sveltia rewrites a whole file on save and writes its keys in the order of the fields in `config.yml`; keys it doesn't know are kept, but moved to the end in alphabetical order, and can't be edited. So:

- When a template starts using a new content key, add the key to all four language files at its place in the page order, and add its field at the same position in `config.yml`: a Portuguese `label` starting with the page section, a `hint` when the value comes from or affects another screen, `widget: text` for a paragraph, `i18n: true` for a translated value (nested fields too: it isn't inherited) or `i18n: duplicate` for a value shared by all languages. A text with a placeholder also gets a `pattern`, e.g. `pattern: ['[{]n[}]', "Mantenha {n}"]`.
- When a template stops using a key, remove it from the four files and its field from `config.yml` together.
- Lists get `summary` and `collapsed: auto`.
- Then run `npm run check:content`. Besides the content itself, it checks that every content key has a field in `config.yml` and every field a key, in the same order, with the right `i18n` option, and that required values are filled in (`--no-cms` skips this part).

`publications.json` is generated (see [Publications](#publications)) and deliberately not in the CMS. The build copies `/admin/` to `dist/admin/`, disallows it in `robots.txt` and leaves it out of the sitemap.

### Content files

| Task | CMS | File |
|---|---|---|
| Page texts (title, description, headings) | Páginas | `content/{lang}/<page>.md` front matter: `index`, `pesquisa`, `equipe`, `publicacoes`, `noticias`, `contato` |
| News and awards | Notícias | `content/{lang}/news/<slug>.md`, with the same file name in all four languages |
| Navigation, footer, buttons, 404 texts | Conteúdo › Textos da interface | `content/{lang}/data/ui.yaml` |
| Research areas | Conteúdo › Áreas de pesquisa | `content/{lang}/data/research.yaml` |
| R&D projects and partners | Conteúdo › Projetos de P&D | `content/{lang}/data/projects.yaml` |
| Numbers on the home page | Conteúdo › Números da página inicial | `content/{lang}/data/counters.yaml` |
| FAQ | Conteúdo › Perguntas frequentes | `content/{lang}/data/faq.yaml` |
| Address, how to join | Conteúdo › Contato e ingresso | `content/{lang}/data/contact.yaml` |
| Team section headings, role names | Conteúdo › Textos da equipe | `content/{lang}/data/team_i18n.yaml` |
| Team members and photos | Equipe › Membros | `content/_shared/data/team.yaml`, photos in `public/images/team/` |
| Research tags (the 4 languages on one screen) | Equipe › Tags de pesquisa | `content/_shared/data/team_tags.yaml` |
| Site name, social media, institutional links, map link | Configurações › Site | `content/_shared/data/site.yaml` |

Values that don't depend on the language sit in every language's file and must be identical in all four: research `icon` and `tags`; project `partner`, `status` and `link`; counter `source`, `value` and `suffix`; FAQ `id`; join item `icon`; news `date`, `category`, `featured`, `link` and `image`; `open_stat_value` in `pesquisa.md`. Lists must have the same items in the same order in every language.

Files follow the format Sveltia CMS writes, so saving through the CMS never reformats them: every text in double quotes (`"…"`, numbers and `true`/`false` without quotes), two-space indentation, lists as `- item` lines under their key, keys in the same order in every language and in the order of the CMS fields (for page files, the order of the page from top to bottom), no comments and no blank lines (except the one between a news item's front matter and its full text). Texts are Markdown (`**bold**`, `_italic_`, `[link](https://…)`), never HTML. Dates are `"YYYY"`, `"YYYY-MM"` or `"YYYY-MM-DD"`.

`npm run check:content` reports missing translations, differing values, lists or key order, anything the CMS would rewrite, and keys the CMS doesn't cover (it also runs before `npm run dev` and `npm run build`). YAML and Markdown edits don't require a server restart.

## Team member format

```yaml
coordinators:
  members:
    - name: "Firstname Lastname"
      gender: "f"
      role: "associate_professor"
      email: "name@ufop.edu.br"
      scholar_id: "XXXXXXXXXXXX"
      lattes: "0000000000000000"
      website: "https://example.com"
      photo: "/images/team/firstname-lastname.webp"
      tags:
        - "machine_learning"
        - "nlp"
```

- `name` without the Prof./Profa. prefix (the site adds it).
- `gender`: `"m"` or `"f"`, always written (it picks the prefix and the role's wording).
- `role`: an id from `roles` in `team_i18n.yaml` (`coordinator`, `associate_professor`, `collaborating_researcher`).
- Optional: `email` (coordinators' emails also appear on the contact page), `scholar_id` (from scholar.google.com/citations?user=XXXXXXXXXXXX), `lattes` (the 16 digits of lattes.cnpq.br/ID, in quotes), `website`, `photo` (a file under `public/images/team/`), `tags` (ids from `team_tags.yaml`; the member is then listed under the research areas with those tags).

Coordinators, professors and collaborators use the format above. Students (`phd_students`, `masters_students`, `undergrads`) have `name` and `since` (the year they joined, a number without quotes), plus `scholar_id`, `lattes`, `website` and `photo` if they have them. Alumni (`alumni_grad`, `alumni_undergrad`) are a list of names.

## Publications

Publications are not stored in the repo. `npm run fetch:pubs` reads every Google Scholar profile listed in `team.yaml` (`scholar_id`) and writes `content/_shared/data/publications.json` (gitignored):

- Only papers from each member's `since` year on are kept (2015 when `since` is missing); entries Scholar lists without a venue are skipped.
- Papers on several co-authors' profiles are merged.
- To remove or fix a paper, edit it on the owner's Google Scholar profile; the site follows on the next weekly run.

Scholar has no API and blocks clients that make too many requests, so each refresh makes one request per profile and reuses the data published at https://csilab.ufop.br/data/publications.json for the "Cited by" lists, re-fetching at most `SCHOLAR_MAX_CITES` (default 20) lists whose citation count changed. If Scholar blocks the run, the previously published data is kept.

`npm run dev` and `npm run build` download the published data instead (`--cached`), so they don't touch Google Scholar.

Scholar refuses GitHub's servers, so in CI every Scholar request runs as `curl` on `jackal`, a machine on the UFOP network (`SCHOLAR_SSH_HOST`), reached through `bridge_ufop`. The SSH setup comes from the repository secrets `SCHOLAR_SSH_CONFIG`, `SCHOLAR_SSH_KEY` and `SCHOLAR_SSH_KNOWN_HOSTS`. Locally, leave `SCHOLAR_SSH_HOST` unset to query Scholar directly.
