![Metafetch: An Obsidian Community Plugin by The Lossless Group](https://i.imgur.com/0v6sPkv.png)

# Metafetch

Turn a URL in a note's frontmatter into a link card's worth of metadata: title, description, share image, favicon, site name, authors, and publication date. Use it with no API key, or through OpenGraph.io or Microlink.

**Requires Obsidian 1.13 or newer.** Desktop only.

## Why Care?

We manage our site-wide content in Obsidian. Our toolkit section reviews applications and web services, and each review is a note whose frontmatter becomes a card on the site. Metafetch fills in those cards.

![Lossless Toolkit on The Lossless Group Website](https://i.imgur.com/WX7aIHB.gif)

It works the same way for notes about papers, articles, and companies. Fetch once, and Bases, Dataview, or your published site can show the source properly.

## What's new in 0.2.0

- **The share image comes through.** Direct Fetch finds it in `og:image` (including its `:url` and `:secure_url` forms), `twitter:image`, schema.org microdata, `<link rel="image_src">`, and JSON-LD. It reads tags however the page writes them.
- **Nothing gets erased.** If a page has no image, title, or description, your note keeps the one it had.
- **Better authors, cleaner text.** Apostrophes and HTML entities come through intact. Bylines are found in JSON-LD and visible author lines, and reading times are no longer stored as authors. Bot-check pages count as a failed fetch.
- **Socials from a folder profile.** For a note under `Tooling/`, Metafetch reads the company's homepage and fills its GitHub org and repo, LinkedIn page, X, YouTube, Discord, and more. It only fills empty fields, and when the page links two equally likely profiles it writes neither.
- **Searchable settings** on Obsidian 1.13's settings API.

Full notes: [changelog/releases/0.2.0.md](changelog/releases/0.2.0.md).

## Commands

| Command | What it does | Needs |
|---|---|---|
| **Direct fetch from script** | Fetches the page itself and reads its Open Graph, Twitter, schema.org, and scholarly (`citation_*`) tags. | Nothing. No key, no rate limit. |
| **Fetch via Microlink** | Same fields, through the Microlink API. | Nothing for about 50 requests a day; an optional key raises the limit. |
| **Fetch from a frontmatter URL…** | Lists every URL in the note's frontmatter, under any property (`url`, `arxiv`, `doi`…), and fetches the one you pick with the provider you pick. | Depends on the provider. |
| **Fill frontmatter from folder profile** | Fills the empty fields the note's folder profile asks for, such as a Tooling note's social links, from the company's own homepage. | Nothing. A profile in `zz-cf-lib/frontmatter/`. |
| **Create example frontmatter profile** | Writes a Tooling socials profile into the profiles folder to start from. | Nothing. |
| **Fetch Open Graph data for current file** | Opens a modal: overwrite or only fill in missing fields, record errors, update the fetch date. | An OpenGraph.io key. |
| **Batch fetch Open Graph data** | Scans the current folder for notes with a URL and missing metadata, then processes them with a delay between requests. | An OpenGraph.io key. |

![Metafetch — Fetch Open Graph Data for Current File](https://github.com/user-attachments/assets/19ad9691-74d0-4b6e-b4ce-3abb3adea407)

### What lands in frontmatter

```yaml
url: "https://arxiv.org/abs/2305.10601"
og_title: "Tree of Thoughts: Deliberate Problem Solving with Large Language Models"
og_description: "Language models are increasingly being deployed for general problem solving…"
og_image: "https://arxiv.org/static/browse/0.3.4/images/arxiv-logo-fb.png"
og_favicon: "https://arxiv.org/static/browse/0.3.4/images/icons/favicon-32x32.png"
og_site_name: "arXiv.org"
og_type: "website"
authors:
  - Shunyu Yao
  - Dian Yu
  - Jeffrey Zhao
  - Izhak Shafran
  - Thomas L. Griffiths
  - Yuan Cao
  - Karthik Narasimhan
og_published: "2023-05-17"
og_last_fetch: "2026-10-08T15:04:05.000Z"
```

Every key name is configurable under **Settings → Metafetch → Field names**. An optional **vault identity code** (`hex_code: k4m2x9`) can be stamped on each fetched note, so you can reference it by something steadier than its filename.

### Folder profiles

A folder profile says which frontmatter a folder's notes should carry. It's an ordinary note in `zz-cf-lib/frontmatter/`, so you edit it in Obsidian:

````markdown
---
title: Tooling socials
applies-to-paths:
  - "Tooling/**"
---

```metafetch-profile
fields:
  github_profile_url: { platform: github-org, aliases: [github_profle_url] }
  github_repo_url:    { platform: github-repo }
  linkedin_url:       { platform: linkedin-company }
  x_url:              { platform: x }
  og_image:           { page: image, aliases: [image] }
```
````

Run **Create example frontmatter profile** to get the full Tooling version, then **Fill frontmatter from folder profile** on a Tooling note. How a social link is chosen:

1. Profiles the site lists in its structured data (JSON-LD `sameAs`) win.
2. Then links in the footer, then in the header or navigation.
3. A handle that resembles the site's domain or name counts in its favour.
4. A link only in the page body, unrelated to the brand, is never used. That keeps customer logos and partner links out.
5. If two links tie, neither is written, and the notice names both.

A field that already has a value, under its own name or an alias, is never changed.

## Getting started

1. In **Settings → Community plugins**, search for "Metafetch", install it, and enable it.
2. Add a `url:` property to a note.
3. Open the command palette (`Cmd+P` / `Ctrl+P`) and run **Metafetch: Direct fetch from script**.

For the OpenGraph.io commands, add your key under **Settings → Metafetch → OpenGraph.io**. Free keys are available at [opengraph.io](https://www.opengraph.io/).

<a href="https://opengraph.io/"><img width="252" height="42" alt="trademark_OpenGraph-io" src="https://github.com/user-attachments/assets/08797db6-8fe7-4ced-a4fe-2ad4df79c26a" /></a>

Metafetch also works with [Microlink](https://microlink.io/).

## For developers

Metafetch builds with [pnpm](https://pnpm.io/) and esbuild, and has no runtime dependencies.

```bash
git clone https://github.com/lossless-group/metafetch.git
cd metafetch
pnpm install
pnpm dev     # watch build to main.js
pnpm test    # node:test suites, no framework
pnpm lint    # the Obsidian review bot's rules (eslint-plugin-obsidianmd)
pnpm build   # type-check + production bundle
```

`pnpm-workspace.yaml` is this plugin's own pnpm settings file, so it installs and builds on its own even inside a larger checkout.

To try a build in your vault, symlink the repo into the vault's plugin folder, then fully quit and reopen Obsidian (Obsidian reads `main.js` only at startup):

```bash
ln -s "$(pwd)" "<your-vault>/.obsidian/plugins/metafetch"
```

Releases are built and published by `.github/workflows/release.yml` when a version tag is pushed. The assets carry build-provenance attestations:

```bash
gh attestation verify main.js --repo lossless-group/metafetch
```

## License

[The Unlicense](LICENSE). Made by [The Lossless Group](https://lossless.group).
