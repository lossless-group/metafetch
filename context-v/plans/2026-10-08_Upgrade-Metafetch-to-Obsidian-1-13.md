---
title: "Plan — Upgrade Metafetch to Obsidian 1.13 (0.2.0)"
lede: "Direct Fetch leaves og_image empty on pages that plainly have one, and the settings tab is drawn the old way. One pass fixes the image, ports Cite Wide's extractor fixes, and moves Metafetch onto Obsidian 1.13."
summary: "Execution plan for Metafetch 0.2.0: fix the Direct Fetch og:image misses (name= instead of property=, og:image:url / secure_url, twitter:image:src, image_src, JSON-LD image, and the null that overwrote a stored image), port Cite Wide's extractor fixes (quote-aware attributes, named entities, brand assets, author fallbacks, junk titles), move to the current toolchain and a zero-dependency test suite, rebuild the settings tab on getSettingDefinitions(), and raise minAppVersion to 1.13.0. Follows content-farm/context-v/handoffs/2026-10-07_Upgrading-Plugins-to-Obsidian-1-13-and-the-Current-Stack.md."
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
site_uuid: 18081583-7e4c-4419-b519-7206d4a3835e
hex_code: upwwiy
status: Implementing
tags:
  - Plan
  - Obsidian-Plugin
  - Obsidian-1-13
  - Release-0-2-0
---

# Plan — Upgrade Metafetch to Obsidian 1.13 (0.2.0)

## Why Care?

**Direct Fetch from Script** is the command that needs no API key, so it's the one people use most. It was leaving `og_image` empty on pages that have a share image. A link card without its image looks broken.

Separately, the settings tab is hand-drawn with `display()`, so none of its rows appear in Obsidian 1.13's settings search, and on 1.14 a hand-drawn tab can silently drop rows.

## What we found (2026-10-08)

We probed the 50 vault notes that had been fetched but had no `og_image`:

- **Most pages publish no `og:image` at all** (Founders Fund, semver.org, Moonshot AI, Flink…). Here an empty field is the right answer.
- **Some pages use `name="og:image"`** instead of `property="og:image"` (Filmora). The extractor only checked `property=`, so it missed them.
- **Minified HTML with unquoted attributes** (`<meta property=og:image content=https://…>`, as on electronjs.org) matched nothing. Cite Wide's quote-aware `attr()` already handles this.
- **Other places pages put the image** were never checked: `og:image:url`, `og:image:secure_url`, `twitter:image:src`, `<link rel="image_src">`, and the JSON-LD `image`.
- **A miss erased a good image.** `runFetchScript` wrote `og_image: null` whenever nothing was found, overwriting an image the note already had from an earlier fetch or another provider.
- Several notes now extract correctly. They were probably fetched before the page added its image, so a re-run fixes them.

## Steps (one commit each)

1. **pnpm settings file.** Add `allowBuilds` next to `onlyBuiltDependencies`.
2. **Toolchain.** Pin as in the handoff: `obsidian` 1.13.1 exact, eslint ^10.12.0, typescript-eslint 8.71.1, `eslint-plugin-obsidianmd` ^0.4.2, `@eslint/plugin-kit` ^0.7.3. Hold typescript 6.0.3 and `@types/node` ^22.20.5. Replace the ESLint config with Cite Wide's and fix the findings.
3. **Test harness.** Copy Cite Wide's `scripts/run-tests.mjs` and `tests/stubs/obsidian.ts`. Port the four `.mjs` suites to `node:test`. Add `plugin-onload.test.ts` and `settings-definitions.test.ts`, red first.
4. **Extractor + og:image fix.** Port Cite Wide's `directFetchService` (copy, don't import), adapted to Metafetch's `OpenGraphData`. Add the image fallback chain. Leave a stored image in place when the fetch finds none. Treat bot-check and error-page titles as a failed fetch. Port Cite Wide's extractor tests, plus fixtures for each image case above.
5. **Settings tab → `getSettingDefinitions()`.** Delete the `display()` override, the dead `settings-tab.ts`, and the `obsidian.d.ts` augmentation that shadows Obsidian's real types. Bump to 0.2.0 with `minAppVersion` 1.13.0 in the same commit.
6. **Docs.** README, changelog entry, `changelog/releases/0.2.0.md`.
7. **Gates and the real-world check.** Load the built `main.js` with the handoff's loader and probe the live URLs again.
8. **Release.** Needs the operator's go-ahead.

## Commands (IDs must not change; hotkeys bind to them)

`fetch-opengraph-data`, `batch-fetch-opengraph-data`, `direct-fetch-from-script`, `fetch-via-microlink`, `fetch-from-frontmatter-url`.
