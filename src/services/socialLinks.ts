// A company's own social profiles, read from its homepage.
//
// Finding social links is easy; choosing the company's own is not. A homepage
// also links share buttons, GitHub's product pages, customer and partner
// profiles, and a blog author's personal account. So every candidate is
// scored by where it appears, and a link the page doesn't vouch for is never
// chosen. When the top two candidates tie, neither is written: a wrong
// LinkedIn URL in a note is worse than an empty one.
//
// Measured against 80 Tooling homepages in the lossless vault (2026-10-08):
// X appeared on 73%, LinkedIn on 63%, GitHub on 52%, and 31 of 73 declared
// their profiles in JSON-LD sameAs.

import { attr, jsonLdNodes, nodeTypes, resolveAgainstBase } from './directFetchService';

export type SocialPlatform =
  | 'github-org'
  | 'github-repo'
  | 'linkedin-company'
  | 'x'
  | 'youtube'
  | 'discord'
  | 'instagram'
  | 'facebook'
  | 'bluesky'
  | 'crunchbase';

export const SOCIAL_PLATFORMS: readonly SocialPlatform[] = [
  'github-org', 'github-repo', 'linkedin-company', 'x', 'youtube',
  'discord', 'instagram', 'facebook', 'bluesky', 'crunchbase',
];

export function isSocialPlatform(value: unknown): value is SocialPlatform {
  return typeof value === 'string' && (SOCIAL_PLATFORMS as readonly string[]).includes(value);
}

/** A link recognized as a profile on one platform. */
interface Match {
  /** Canonical URL: what gets written, and what candidates are compared by. */
  url: string;
  /** The account part, compared against the brand (handle, org, slug). */
  handles: string[];
}

// GitHub paths that are GitHub's own pages, not an organization or user.
const GITHUB_RESERVED = new Set([
  'about', 'apps', 'collections', 'contact', 'customer-stories', 'enterprise', 'events', 'explore',
  'features', 'login', 'join', 'marketplace', 'new', 'notifications', 'orgs', 'organizations', 'pricing',
  'readme', 'security', 'settings', 'site', 'sponsors', 'team', 'topics', 'trending', 'users', 'solutions',
  'resources', 'premium-support', 'git-guides', 'education', 'codespaces', 'copilot', 'mobile',
  'user-attachments', 'assets', 'github-copilot',
]);
// X / Twitter paths that are buttons or app pages.
const X_RESERVED = new Set(['intent', 'share', 'home', 'i', 'search', 'hashtag', 'explore', 'login', 'signup', 'settings', 'tos', 'privacy']);
const FACEBOOK_RESERVED = new Set(['sharer', 'sharer.php', 'share', 'share.php', 'dialog', 'plugins', 'tr', 'login', 'groups', 'events', 'watch', 'help', 'policies']);
const INSTAGRAM_RESERVED = new Set(['p', 'reel', 'reels', 'explore', 'accounts', 'stories', 'about', 'legal']);

function parseUrl(href: string): URL | null {
  try {
    const u = new URL(href);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

function hostIs(u: URL, ...hosts: string[]): boolean {
  const h = u.hostname.toLowerCase().replace(/^(www|m|mobile)\./, '');
  return hosts.includes(h);
}

function segments(u: URL): string[] {
  return u.pathname.split('/').filter(Boolean).map(s => decodeURIComponent(s));
}

/**
 * Classifies one absolute URL. Returns the profile it names on each platform
 * it belongs to; a GitHub repo link names both the repo and its org.
 */
export function classifySocialUrl(href: string): Partial<Record<SocialPlatform, Match>> {
  const u = parseUrl(href);
  if (!u) return {};
  const seg = segments(u);
  const out: Partial<Record<SocialPlatform, Match>> = {};

  if (hostIs(u, 'github.com')) {
    const [owner, repo] = seg;
    if (owner && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner) && !GITHUB_RESERVED.has(owner.toLowerCase())) {
      out['github-org'] = { url: `https://github.com/${owner}`, handles: [owner] };
      if (repo && /^[A-Za-z0-9._-]+$/.test(repo) && !repo.endsWith('.git')) {
        out['github-repo'] = { url: `https://github.com/${owner}/${repo}`, handles: [repo, owner] };
        // The owner of a brand-named repo is the brand's org even when its
        // name isn't: zod.dev links github.com/colinhacks/zod.
        out['github-org'].handles.push(repo);
      }
    }
  } else if (hostIs(u, 'linkedin.com') || /\.linkedin\.com$/i.test(u.hostname)) {
    const [kind, slug] = seg;
    if (kind && slug && /^(company|school|showcase)$/i.test(kind)) {
      out['linkedin-company'] = { url: `https://www.linkedin.com/${kind.toLowerCase()}/${slug}`, handles: [slug] };
    }
  } else if (hostIs(u, 'x.com', 'twitter.com')) {
    const [handle, rest] = seg;
    if (handle && !rest && /^[A-Za-z0-9_]{1,15}$/.test(handle) && !X_RESERVED.has(handle.toLowerCase())) {
      out.x = { url: `https://x.com/${handle}`, handles: [handle] };
    }
  } else if (hostIs(u, 'youtube.com')) {
    const [first, second] = seg;
    if (first?.startsWith('@')) {
      out.youtube = { url: `https://www.youtube.com/${first}`, handles: [first.slice(1)] };
    } else if (first && second && /^(channel|c|user)$/.test(first)) {
      out.youtube = { url: `https://www.youtube.com/${first}/${second}`, handles: first === 'channel' ? [] : [second] };
    }
  } else if (hostIs(u, 'discord.gg') || (hostIs(u, 'discord.com') && seg[0] === 'invite')) {
    const code = hostIs(u, 'discord.gg') ? seg[0] : seg[1];
    if (code) out.discord = { url: `https://discord.gg/${code}`, handles: [] };
  } else if (hostIs(u, 'instagram.com')) {
    const [handle] = seg;
    if (handle && seg.length === 1 && !INSTAGRAM_RESERVED.has(handle.toLowerCase())) {
      out.instagram = { url: `https://www.instagram.com/${handle}`, handles: [handle] };
    }
  } else if (hostIs(u, 'facebook.com')) {
    const [handle] = seg;
    const id = u.searchParams.get('id');
    if (handle === 'profile.php') {
      // Pages without a vanity name: the id is the whole identity.
      if (id && /^\d+$/.test(id)) out.facebook = { url: `https://www.facebook.com/profile.php?id=${id}`, handles: [] };
    } else if (handle && seg.length === 1 && !FACEBOOK_RESERVED.has(handle.toLowerCase())) {
      out.facebook = { url: `https://www.facebook.com/${handle}`, handles: [handle] };
    }
  } else if (hostIs(u, 'bsky.app')) {
    const [kind, handle] = seg;
    if (kind === 'profile' && handle) out.bluesky = { url: `https://bsky.app/profile/${handle}`, handles: [handle.split('.')[0] ?? handle] };
  } else if (hostIs(u, 'crunchbase.com')) {
    const [kind, slug] = seg;
    if (kind === 'organization' && slug) out.crunchbase = { url: `https://www.crunchbase.com/organization/${slug}`, handles: [slug] };
  }
  return out;
}

/** Where on the page a link was found, strongest first. */
type Placement = 'sameAs' | 'footer' | 'nav' | 'body';

const PLACEMENT_SCORE: Record<Placement, number> = { sameAs: 100, footer: 30, nav: 20, body: 0 };
const BRAND_SCORE = 25;
/** Below this a candidate is never chosen: a body link the brand doesn't vouch for. */
const MIN_SCORE = 20;

export interface SocialCandidate {
  url: string;
  score: number;
  placements: Placement[];
  brandMatch: boolean;
}

export interface SocialChoice {
  /** The chosen profile, or undefined when there was none or a tie. */
  url: string | undefined;
  /** Distinct eligible candidates, best first; more than one when it was a tie. */
  candidates: SocialCandidate[];
  ambiguous: boolean;
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * The words a company's own handle tends to resemble: the registrable part of
 * its domain (glideapps.com → glideapps, tina.io → tina) and its site name.
 */
export function brandTokens(pageUrl: string, siteName?: string): string[] {
  const tokens = new Set<string>();
  const u = parseUrl(pageUrl);
  if (u) {
    const labels = u.hostname.toLowerCase().replace(/^www\./, '').split('.');
    // Second-level domains like co.uk keep the label before them.
    const core = labels.length >= 3 && /^(co|com|org|net|ac|gov)$/.test(labels[labels.length - 2] ?? '')
      ? labels[labels.length - 3]
      : labels[labels.length - 2] ?? labels[0];
    if (core) tokens.add(squash(core));
  }
  if (siteName) {
    const s = squash(siteName);
    if (s) tokens.add(s);
  }
  return [...tokens].filter(t => t.length >= 3);
}

function resemblesBrand(handles: string[], tokens: string[]): boolean {
  return handles.some(h => {
    const s = squash(h.replace(/^@/, ''));
    return s.length >= 3 && tokens.some(t => s.includes(t) || t.includes(s));
  });
}

/** Index ranges of each region tag's content, for placing links. */
function regions(html: string, tag: 'footer' | 'nav' | 'header'): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const re = new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`, 'gi');
  for (const m of html.matchAll(re)) out.push([m.index, m.index + m[0].length]);
  return out;
}

const inAny = (i: number, ranges: Array<[number, number]>) => ranges.some(([a, b]) => i >= a && i < b);

/** Every profile link on the page, per platform, scored. */
export function collectSocialCandidates(
  html: string,
  pageUrl: string,
  siteName?: string
): Record<SocialPlatform, SocialCandidate[]> {
  const tokens = brandTokens(pageUrl, siteName);
  const footers = regions(html, 'footer');
  const navs = [...regions(html, 'nav'), ...regions(html, 'header')];

  const found = new Map<string, { platform: SocialPlatform; match: Match; placements: Placement[] }>();
  const add = (href: string, placement: Placement) => {
    for (const [platform, match] of Object.entries(classifySocialUrl(href)) as [SocialPlatform, Match][]) {
      const key = `${platform} ${match.url.toLowerCase()}`;
      const entry = found.get(key) ?? { platform, match: { ...match, handles: [] }, placements: [] };
      entry.placements.push(placement);
      for (const h of match.handles) if (!entry.match.handles.includes(h)) entry.match.handles.push(h);
      found.set(key, entry);
    }
  };

  // JSON-LD sameAs on the site's own Organization (or WebSite) node.
  for (const node of jsonLdNodes(html)) {
    if (!nodeTypes(node).some(t => /Organization|Corporation|WebSite|Brand|SoftwareApplication|LocalBusiness/.test(t))) continue;
    const sameAs = node['sameAs'];
    for (const v of Array.isArray(sameAs) ? sameAs : [sameAs]) {
      if (typeof v === 'string') add(v, 'sameAs');
    }
  }

  for (const m of html.matchAll(/<a\b[^>]*>/gi)) {
    const href = attr(m[0], 'href');
    if (!href || href.startsWith('#') || /^(mailto|tel|javascript):/i.test(href)) continue;
    const placement: Placement = inAny(m.index, footers) ? 'footer' : inAny(m.index, navs) ? 'nav' : 'body';
    add(resolveAgainstBase(href, pageUrl), placement);
  }

  const result = Object.fromEntries(SOCIAL_PLATFORMS.map(p => [p, [] as SocialCandidate[]])) as Record<SocialPlatform, SocialCandidate[]>;
  for (const { platform, match, placements } of found.values()) {
    const brandMatch = resemblesBrand(match.handles, tokens);
    const best = Math.max(...placements.map(p => PLACEMENT_SCORE[p]));
    // Each extra appearance counts a little: header and footer both linking
    // the same profile is a signal, but not one that outweighs placement.
    const score = best + (brandMatch ? BRAND_SCORE : 0) + Math.min(placements.length - 1, 3) * 2;
    result[platform].push({ url: match.url, score, placements: [...new Set(placements)], brandMatch });
  }
  for (const list of Object.values(result)) list.sort((a, b) => b.score - a.score);
  return result;
}

/** Picks one profile per platform, or none when the page doesn't vouch for one or two tie. */
export function chooseSocialLinks(
  html: string,
  pageUrl: string,
  siteName?: string
): Record<SocialPlatform, SocialChoice> {
  const all = collectSocialCandidates(html, pageUrl, siteName);
  const out = {} as Record<SocialPlatform, SocialChoice>;
  for (const platform of SOCIAL_PLATFORMS) {
    const eligible = all[platform].filter(c => c.score >= MIN_SCORE);
    const [top, second] = eligible;
    const ambiguous = !!top && !!second && top.score === second.score;
    out[platform] = {
      url: top && !ambiguous ? top.url : undefined,
      candidates: ambiguous ? eligible.filter(c => c.score === top.score) : eligible,
      ambiguous,
    };
  }
  return out;
}
