---
title: "Folder-Aware Frontmatter Templates and Fetch Recipes"
lede: "A note in Tooling/ wants different frontmatter than one in Sources/. Templates in zz-cf-lib say which fields; recipes say how to fetch them."
summary: "Exploration for Metafetch's next feature line. Proposes splitting the work into three parts: (1) frontmatter profiles: vault files under zz-cf-lib/ that declare, per folder, which properties a note should carry and where each comes from; (2) fetch recipes: declarative, data-only descriptions of an HTTP call (endpoint, auth by secret reference, body, response mapping), so a new provider is a file rather than a code change; (3) three command kinds that fill a profile: direct parser, web-extraction APIs (Firecrawl, Tavily), and model calls. Grounded in a key-frequency sample of the lossless vault's Tooling/, Sources/, and Vocabulary/ notes, and in Perplexed's shipped zz-cf-lib template system. Builds on content-farm's Moving-Beyond-Simple-API-Calls (D4 resolution, direct-SDK posture) and Per-Directory-Profile-Templates (applies-to-paths). Ends with open questions and a proposed slicing; nothing here is decided."
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
site_uuid: 0536b9d1-a146-46e1-a6e3-ae239edb02e6
hex_code: u57cmc
status: Exploration
tags:
  - Exploration
  - Obsidian-Plugin
  - Frontmatter
  - Templates
  - API-Providers
related:
  - "[[Moving-Beyond-Simple-API-Calls]]"
  - "[[Per-Directory-Profile-Templates]]"
  - "[[Using-APIs-to-Ingest-More-Data]]"
  - "[[Add-New-API-Provider-to-Plugin]]"
---

# Folder-Aware Frontmatter Templates and Fetch Recipes

- [Why Care?](#why-care)
- [What the vault already tells us](#what-the-vault-already-tells-us)
- [Three ideas, kept apart](#three-ideas-kept-apart)
- [1. Frontmatter profiles](#1-frontmatter-profiles)
- [2. Fetch recipes](#2-fetch-recipes)
- [3. Three command kinds](#3-three-command-kinds)
- [Writing the result](#writing-the-result)
- [Secrets and safety](#secrets-and-safety)
- [Open questions](#open-questions)
- [A possible slicing](#a-possible-slicing)

## Why Care?

Metafetch writes the same nine `og_*` fields to every note. A note about a tool needs a GitHub URL and a one-line zinger. A note about a book needs its authors, publication date, and Amazon and Wikipedia links. A vocabulary note needs the expanded acronym. Today, any field that isn't Open Graph is typed by hand, one note at a time.

Perplexed already solved a version of this for note *bodies*: a template in `zz-cf-lib/templates/` with `applies-to-paths: ["Tooling/**"]` gives every Tooling note the same section outline. This exploration asks whether Metafetch can do the same for *frontmatter*. A folder would decide which properties its notes carry, and Metafetch would fill them from whichever source can supply them: the page itself, a web-extraction API, or a model.

The second half is the "standardized, flexible mechanism" part. Today each provider is a hand-written service: `openGraphService.ts`, `microlinkFetchService.ts`, `directFetchService.ts`. Adding Firecrawl, Tavily, or a model means another service file, another settings group, and another release. If a provider call could be described as data (where to send it, which secret to attach, what to send, how to read the answer), most new providers would become a file in the vault.

## What the vault already tells us

We sampled the frontmatter keys of up to 400 notes in each of three folders (2026-10-08):

| Folder | Keys beyond the shared `og_*` / identity set |
|---|---|
| `Tooling/` | `zinger`, `github_repo_url`, `description_site_cp`, `og_screenshot_url`, `for_clients`, plus older `jina_last_request` / `jina_error` |
| `Sources/` | `authors`, `author`, `date_published`, `google_books_url`, `amazon_url`, `wikipedia_url`, `linkedin_url`, `youtube_url`, `youtube_url_channel`, `channel` |
| `Vocabulary/` | `expanded_acronym`, `wikipedia_url`, `docs_url`, `covers_tags`, `aliases` |

Two things stand out:

- **Each folder already has a schema; it just isn't written down.** The keys are consistent within a folder and different across folders, which is exactly what a per-folder template captures.
- **The same idea goes by several names.** `image` / `og_image`, `favicon` / `og_favicon`, `site_name` / `og_site_name`, `author` / `authors`, plus typo'd keys (`wi`, `wik`). A profile that declares canonical names and aliases could normalize these as it fills them.

## Three ideas, kept apart

The request bundles three things that are easier to design (and ship) separately:

| Idea | Answers | Lives in | Changes when |
|---|---|---|---|
| **Profile** | *Which* properties does a note here carry, and where may each come from? | `zz-cf-lib/frontmatter/*.md` | The content model changes |
| **Recipe** | *How* do we call this provider: endpoint, auth, body, response mapping? | `zz-cf-lib/recipes/*.md` (and bundled defaults) | A provider changes its API |
| **Command kind** | *What sort* of work fills the fields: parsing, extraction API, or model? | Plugin code | Rarely |

A profile names fields and their allowed sources. A recipe is one way to reach a source. A command kind is the engine that runs recipes of its type. Keeping them apart means a profile doesn't change when you swap Tavily for Firecrawl, and a recipe doesn't change when Tooling gains a field.

## 1. Frontmatter profiles

### Where they live

`zz-cf-lib/templates/` is already Perplexed's (body templates with `cft` blocks), so Metafetch needs its own root. Proposed: **`zz-cf-lib/frontmatter/`**, configurable, following the D4 rule in [[Moving-Beyond-Simple-API-Calls]]: templates are visible vault files the operator edits in Obsidian.

Per the family rule that plugins stand alone, Metafetch **bundles** a default profile (today's nine `og_*` fields). Vault files override or extend it and are never required.

### Shape

The same four-zone file Perplexed uses, so authors only learn one format: frontmatter for metadata, free prose for humans, one fenced config block, and nothing else the runtime reads.

````markdown
---
title: Tooling profile
applies-to-paths:
  - "Tooling/**"
description: Frontmatter for a company, service, app, or open-source repo.
---

Explainer prose for humans. The runtime ignores it.

```metafetch-profile
fields:
  og_title:       { from: [direct] }
  og_description: { from: [direct] }
  og_image:       { from: [direct, firecrawl], aliases: [image] }
  og_favicon:     { from: [direct], aliases: [favicon] }
  github_repo_url:
    type: url
    describe: "The project's primary GitHub repository, if it has one."
    from: [direct, firecrawl]
  zinger:
    type: string
    describe: "One punchy sentence, under 90 characters, saying what this does for whom."
    from: [model]
  pricing_model:
    type: enum
    values: [free, freemium, paid, open-source, enterprise]
    from: [firecrawl, model]
write: fill-if-empty
```
````

- **`from`** is an ordered list of command kinds or named recipes. The first source that returns a value wins, so cheap sources go first.
- **`describe`** is the field's instruction. Extraction APIs and models receive it as the schema description. The direct parser ignores it.
- **`type`** (`string`, `url`, `date`, `list`, `enum`, `wikilink`) drives validation before writing, and the JSON schema sent to providers that accept one.
- **`aliases`** lets the profile adopt a drifted key: rename it on write, or read it as "already filled". Which one is an open question.
- Field names are just the keys, so Metafetch's existing field-name settings become the defaults of the bundled profile rather than a separate mechanism.

A fenced block, rather than putting `fields:` in the file's own frontmatter, keeps the profile's metadata (title, globs) apart from its payload, and lets the payload carry YAML that would be awkward as Obsidian properties (nested maps).

### Resolution

Two mechanisms already exist in the tree:

- **`applies-to-paths` globs**: what Perplexed ships and the operator uses today. Shown as suggestions in a picker.
- **Folder mirroring** (D4): `zz-cf-lib/frontmatter/Tooling/Agentic AI/…` overrides `zz-cf-lib/frontmatter/Tooling/…`. Zero config, but invisible until you know the rule.

Lean: **globs first**, because that matches Perplexed and the live vault. Pick the most specific matching glob automatically and show the picker only when two profiles tie, so a profile can run without a dialog (which batch runs need). Mirroring can come later if globs prove clumsy.

## 2. Fetch recipes

A recipe describes one HTTP call as data. No code and no expressions beyond variable substitution, so a recipe file can't do anything except make the request it describes.

````markdown
---
title: Firecrawl structured extract
kind: web-extract
---

```metafetch-recipe
request:
  method: POST
  url: https://api.firecrawl.dev/v2/scrape
  auth:
    secret: firecrawl            # an id in Obsidian's secret storage
    as: bearer                   # bearer | header:<name> | query:<name>
    allowed-hosts: [api.firecrawl.dev]
  body:
    url: "{{url}}"
    formats:
      - type: json
        schema: "{{fields.schema}}"   # built from the profile's fields
response:
  fields: "$.data.json"          # where the field values are in the answer
  limits:
    timeout-ms: 60000
```
````

The runtime supplies a small set of variables: `{{url}}`, `{{title}}`, `{{frontmatter}}`, `{{page.text}}` (when a direct fetch ran first), and `{{fields.schema}}` / `{{fields.list}}` (the requested fields rendered as JSON Schema or as a bullet list). Responses are mapped with a deliberately small JSONPath subset (`$.a.b`, `$.a[0]`).

What this buys:

- **A provider is a file.** Firecrawl's JSON extraction, Tavily's extract endpoint, a self-hosted Perplexica, or a homegrown proxy from [[Enabling-Obsidian-Plugins-to-access-Homegrown-API-Helpers]] are recipes, not releases.
- **The bundled providers become bundled recipes.** OpenGraph.io and Microlink could be re-expressed this way, which tests whether the format is expressive enough.
- **Three secret placements** cover nearly every API: bearer token, named header, and query parameter. Anything stranger (signed requests, OAuth refresh) stays in code.

What it can't do, on purpose: chain calls, branch, paginate, or transform values beyond mapping. The first time a provider needs that, the provider gets a small TypeScript adapter instead. That's the line [[Moving-Beyond-Simple-API-Calls]] already draws for orchestration.

> **To verify in the spike:** the exact current request and response shapes of Firecrawl's scrape-with-JSON-format, Tavily's extract and search endpoints, and each model provider's structured-output parameter. The YAML above shows the shape of the idea, not tested calls.

## 3. Three command kinds

All three take the same input (the note, its resolved profile, and the fields still empty) and return the same output: a map of field to value with a provenance tag. They differ in cost, speed, and what they can know.

| Kind | Good at | Can't do | Cost per note |
|---|---|---|---|
| **Direct parser** | Anything the page declares: Open Graph, Twitter, JSON-LD, `citation_*`, `<link rel>`. Also deterministic extractors, e.g. "the first `github.com/<owner>/<repo>` link on the page". | Pages rendered by JavaScript or behind bot checks; judgment ("what's the pricing model?") | Free |
| **Web extraction API** (Firecrawl, Tavily) | Rendered and blocked pages; schema-guided extraction across the page's content; search for a URL the note lacks (Wikipedia, Amazon) | Fields that need synthesis or taste | Per-request credits |
| **Model call** (Anthropic, OpenAI, Perplexity, local LM Studio) | Synthesis: `zinger`, `pricing_model`, a tag choice from a fixed vocabulary, `expanded_acronym` | Facts it wasn't given; it should get page text or extraction output as context, never be asked to recall a URL | Per-token |

This suggests the user-facing commands:

1. **Fill frontmatter from page**: direct parser only. Free and fast; today's Direct Fetch, generalized to the profile.
2. **Fill frontmatter with web extraction**: direct first, then the extraction recipe for fields still empty.
3. **Fill frontmatter with a model**: direct (or extraction) for context, then a model for the remaining fields, with the page text in the prompt.
4. **Fill frontmatter (profile order)**: let each field's `from:` list decide. This is probably the command people actually want once profiles exist; 1–3 are useful for control and for cost.

Batch versions over a folder follow the same split. They need concurrency limits and a cost preview ("47 notes, about 47 Firecrawl credits") before they run.

## Writing the result

These rules carry over from 0.2.0, plus some new ones:

- **Never blank a stored value** (0.2.0's rule). An empty result leaves the field alone.
- **`write: fill-if-empty` by default**, so existing values are kept. `refresh` (overwrite fetched fields) is opt-in per profile or per run, and fields the operator typed by hand should be protectable (see provenance).
- **Validate before writing.** A `url` field must parse as a URL, an `enum` must be one of its values, and a `date` must normalize to ISO. Invalid values are dropped and reported, not written.
- **Provenance.** Record which source filled which field, so a later refresh knows what it may overwrite. Options: one `metafetch_sources:` map property, or nothing in the note and a sidecar log. This is an open question, because it adds a property to every note.
- **Frontmatter only.** These commands never touch the body; that stays Perplexed's job.

## Secrets and safety

Recipes are vault files, and vaults get synced, shared, and published. That shapes the design:

- **Secrets never live in a recipe or in `data.json`.** Obsidian 1.11.4+ has `app.secretStorage` (`setSecret` / `getSecret` / `listSecrets`) and a `SecretComponent` settings control. A recipe names a secret id (`secret: firecrawl`), and the operator enters the value once, in settings. The 1.13 declarative settings API has no `secret` control type, so that row would be a `render` row hosting `SecretComponent`.
- **A secret is bound to hosts.** `allowed-hosts` on the recipe, checked against the request URL after substitution. Otherwise a recipe dropped into a shared vault could send your Anthropic key anywhere. Better still, the binding should live with the secret in plugin settings ("firecrawl may be sent to api.firecrawl.dev"), so a vault file can't widen it.
- **Recipes are data, never code.** No `eval`, no JavaScript in templates. That's also a marketplace requirement: see `content-farm/context-v/reminders/Obsidian-Marketplace-Compliance.md`.
- **Disclosure.** The README must list every network destination; bundled recipes make that list concrete, and user recipes are the operator's own choice.
- **Model output is untrusted input.** It's validated by field type before writing, and it's never interpreted as a path, a wikilink target that triggers anything, or YAML structure.

## Open questions

1. **Metafetch or a shared library?** Perplexed and Metafetch would both parse `zz-cf-lib` files and resolve globs. The family rule says copy, don't import. Is a second copy acceptable, or is this the point where a shared `@lossless/cf-lib` package (bundled into each plugin, so each still stands alone) earns its keep?
2. **Aliases: rename or read-through?** When a profile declares `og_image` with alias `image`, should a fill rename `image` to `og_image`, or treat `image` as already satisfying the field and leave it? Renaming normalizes the vault but rewrites keys other tools may read (the Astro sites read some of these).
3. **Provenance: in the note or beside it?** A `metafetch_sources` map is honest and portable, but adds noise to every note. A sidecar log under `zz-cf-lib/history/` (Perplexed already writes one) keeps notes clean but can drift from them.
4. **One profile per note, or composable?** Could `Tooling/Agentic AI/` add two fields to the Tooling profile (`extends: tooling`), or does every folder copy the whole field list?
5. **Model calls: direct SDKs or Vercel AI SDK?** [[Moving-Beyond-Simple-API-Calls]] says direct SDKs until ≥3 providers with structured output, then Vercel AI SDK. Structured output across Anthropic, OpenAI, and Perplexity is exactly that threshold. Alternatively, model calls could also be recipes (they're HTTP calls with a JSON schema), which would keep the bundle free of SDKs entirely.
6. **Should the existing providers move onto recipes?** It would prove the format and shrink the code, but it's a rewrite of working code for no user-visible gain. It's probably worth doing for one provider (Microlink is the smallest) as the format's test.
7. **Cost controls.** Per-run confirmation above N paid calls? A monthly budget per secret? At minimum, batch runs need a preview.

## A possible slicing

Each slice is useful on its own, and later slices don't force changes on earlier ones:

1. **Profiles + direct parser.** The `zz-cf-lib/frontmatter/` loader, glob resolution, the bundled default profile, typed validation, fill-if-empty, and one command. No new network destinations, no secrets. Turns today's fixed field map into per-folder profiles.
2. **Recipes + secret storage + one extraction provider.** Firecrawl or Tavily via a recipe, with secrets in `app.secretStorage` bound to hosts. Re-express Microlink as a recipe to test the format.
3. **Model kind.** Structured output from one provider first (likely Anthropic), page text as context, the `zinger` / `pricing_model` class of fields.
4. **Profile-order command and batch.** `from:` lists decide per field, folder runs get concurrency limits and a cost preview.

Before slice 1, the questions worth settling are 1 (where the parser lives), 2 (aliases), and 3 (provenance). The rest can wait until their slice.
