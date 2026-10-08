---
title: "Plan — Folder profiles and social links (slice 1)"
lede: "A Tooling note gets its GitHub org, LinkedIn page, and other socials from the company's own homepage. No API key needed."
summary: "Build plan for slice 1 of the Folder-Aware-Frontmatter-Templates-and-Fetch-Recipes exploration: the zz-cf-lib/frontmatter/ profile loader (applies-to-paths globs, one metafetch-profile fence), a social-link extractor with built-in platform classifiers and a ranking that refuses to guess, and one command that fills a note's empty profile fields with the direct parser. Decides the exploration's open questions 1–3 provisionally for this slice: the parser is copied into Metafetch, aliases are read-through only (never renamed), and no provenance is written."
publish: true
date_created: 2026-10-08
date_modified: 2026-10-08
date_authored_initial_draft: 2026-10-08
date_authored_current_draft: 2026-10-08
date_authored_final_draft:
authors:
  - Michael Staton
augmented_with:
  - Claude Code on Claude Opus 5.5
at_semantic_version: 0.0.0.1
site_uuid: 4da8820e-4d37-4db2-ad70-4f2c0d73e895
hex_code: gm482u
status: Implementing
tags:
  - Plan
  - Frontmatter
  - Social-Links
related:
  - "[[Folder-Aware-Frontmatter-Templates-and-Fetch-Recipes]]"
---

# Plan — Folder profiles and social links (slice 1)

## Why Care?

Of ~1,200 Tooling notes with a URL, nine have a LinkedIn URL and seven an X URL. Probing 80 of their homepages found X on 73% and LinkedIn on 63%. The data is on the page; nobody has had time to copy it over.

## Scope

1. **Social-link extractor** (`src/services/socialLinks.ts`, pure, tested). Platforms: GitHub org, GitHub repo, LinkedIn company, X, YouTube, Discord, Instagram, Facebook, Bluesky, Crunchbase. Each has a match rule, a denylist (share buttons, GitHub's own pages), and a canonical form.
2. **Ranking that refuses to guess.** In order: JSON-LD `sameAs`, then footer links, then header/nav links, then a handle that resembles the domain or site name. A link found only in the body, unrelated to the brand, is never chosen. When the top two distinct candidates score the same, write neither and report both.
3. **Profiles** (`src/services/frontmatterProfiles.ts`). Files in `zz-cf-lib/frontmatter/` (configurable) with `applies-to-paths` globs and one `metafetch-profile` fence. Each field has either `platform:` (a social classifier) or `page:` (one of the direct-fetch values: title, description, image, favicon, site_name, type, authors, published), plus optional `aliases`.
4. **Command: "Fill frontmatter from folder profile."** Resolves the most specific matching profile (asking only on a tie), fetches the note's `url`, and also fetches the site root when socials are wanted and the URL is a deeper page. Fills only empty fields and never blanks one. Reports what was filled, what was ambiguous, and what wasn't found.
5. **Command: "Create example frontmatter profile."** Writes a Tooling socials profile into the profiles folder if it isn't there. Nothing is created automatically.

## Provisional decisions (exploration questions 1–3)

- **The parser lives in Metafetch**, copied (globs from Perplexed), per the family rule.
- **Aliases are read-through.** If `github_profle_url` has a value, `github_profile_url` counts as filled and is skipped. Nothing is renamed. Renaming can come later as its own explicit command.
- **No provenance property** in this slice. The notice and console report say what came from where.
- **`github_url` is never read or written** (the operator is sorting those by hand).

## Out of scope

Recipes, secrets, Firecrawl/Tavily, models, batch over a folder. A profile field whose only sources are non-direct is skipped and reported.

## Verification

Unit tests per platform and ranking case; a command test end to end against stubbed pages; a re-probe of the 80 Tooling homepages comparing chosen links with the raw probe.
