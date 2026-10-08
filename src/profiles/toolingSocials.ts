// The example profile "Create example frontmatter profile" writes into the
// profiles folder. Field names follow the ones the lossless vault's Tooling
// notes already use; the typo'd and older spellings are aliases, read but
// never renamed. github_url is deliberately absent.

export const TOOLING_SOCIALS_FILENAME = 'tooling-socials.md';

export const TOOLING_SOCIALS_PROFILE = `---
title: Tooling socials
applies-to-paths:
  - "Tooling/**"
description: A company's own GitHub, LinkedIn, X, YouTube, and other profiles, read from its homepage.
---

# Tooling socials

Run **Metafetch: Fill frontmatter from folder profile** on a note under \`Tooling/\` that has a \`url\`. Metafetch reads the company's homepage and fills the fields below that are still empty. Fields that already hold a value, under their own name or an alias, are left alone.

How a link is chosen:

1. Profiles the site declares in its structured data (JSON-LD \`sameAs\`) win.
2. Then links in the footer, then the header or navigation.
3. A handle that resembles the site's domain or name counts in its favour.
4. A link found only in the page body, with no resemblance to the brand, is never used. That's how customer logos and partner links stay out.
5. When two links tie, nothing is written and both are reported.

Edit the block below to change which fields this folder gets. Each field takes a \`platform\` (github-org, github-repo, linkedin-company, x, youtube, discord, instagram, facebook, bluesky, crunchbase) or a \`page\` value (title, description, image, favicon, site_name, type, authors, published), and optional \`aliases\`.

\`\`\`metafetch-profile
fields:
  github_profile_url:
    platform: github-org
    aliases: [github_profle_url]
  github_repo_url:
    platform: github-repo
  linkedin_url:
    platform: linkedin-company
  x_url:
    platform: x
  youtube_channel_url:
    platform: youtube
    aliases: [youtube_url_channel]
  discord_url:
    platform: discord
  instagram_url:
    platform: instagram
  facebook_url:
    platform: facebook
  bluesky_url:
    platform: bluesky
  crunchbase_url:
    platform: crunchbase
  og_image:
    page: image
    aliases: [image]
  og_favicon:
    page: favicon
    aliases: [favicon]
\`\`\`
`;
