// The Direct Fetch provider: one GET through Obsidian's requestUrl, parsed for
// <meta> tags inline. No API key, no third party.
//
// Cite Wide copied this extractor in 0.3.0 and then fixed bugs in its copy:
// apostrophes cut meta values short, named entities stayed encoded, the
// favicon could be the apple-touch-icon, reading times were stored as
// authors, and bot-check pages were read as real metadata. Those fixes are
// copied back here (copied, not imported: each Lossless plugin ships
// standalone), along with Metafetch's own: the share image is looked for
// everywhere pages put it, not only in <meta property="og:image">.

import { requestUrl } from 'obsidian';
import type { OpenGraphData } from '../types/open-graph-service';
import { isPlausibleAuthor } from '../utils/authorNames';

export class DirectFetchError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'DirectFetchError';
  }
}

/**
 * A publisher's brand assets, as URLs. Each is what a site declares for a
 * specific job, so they are kept apart rather than collapsed into "the icon":
 * the favicon is tiny and often a letterform, the app icon is the square
 * home-screen mark, the logo is the trademark/wordmark, and the mask icon is
 * the single-color SVG Safari uses for pinned tabs.
 */
export interface BrandAssets {
  /** <link rel="icon">, preferring SVG, then the largest PNG up to 96 px; else /favicon.ico. */
  favicon: string;
  /** Largest apple-touch-icon, else msapplication-TileImage, else the largest icon ≥ 120 px. */
  appIcon: string | undefined;
  /** The trademark/wordmark: JSON-LD Organization or publisher `logo`, else og:logo, else itemprop="logo". */
  logo: string | undefined;
  /** <link rel="mask-icon">: a single-color SVG of the mark. */
  maskIcon: string | undefined;
  /** The mask icon's declared color. */
  maskIconColor: string | undefined;
  /** <meta name="theme-color">, else msapplication-TileColor. */
  brandColor: string | undefined;
  /** <link rel="manifest">: the web app manifest, which lists more icons. */
  webManifest: string | undefined;
}

// Named entities seen in titles and descriptions. The numeric forms are
// decoded generically below.
const NAMED_ENTITIES: Record<string, string> = {
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', sbquo: '‚', bdquo: '„',
  mdash: '—', ndash: '–', hellip: '…', middot: '·', bull: '•',
  copy: '©', reg: '®', trade: '™', deg: '°', times: '×',
  laquo: '«', raquo: '»', euro: '€', pound: '£', yen: '¥', cent: '¢',
  eacute: 'é', egrave: 'è', aacute: 'á', agrave: 'à', iacute: 'í', oacute: 'ó',
  uacute: 'ú', ntilde: 'ñ', ccedil: 'ç', uuml: 'ü', ouml: 'ö', auml: 'ä', szlig: 'ß',
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&([a-z]+);/gi, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, n: string) => String.fromCharCode(parseInt(n, 16)));
}

/**
 * One attribute's value from a tag, quote-aware: double-quoted, single-quoted,
 * or bare. Minified pages (electronjs.org) write `content=https://…` with no
 * quotes at all, which the old quoted-only pattern never matched.
 */
export function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`(?:^|[\\s"'])${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i'));
  const v = m ? (m[1] ?? m[2] ?? m[3]) : undefined;
  return v === undefined ? undefined : decodeEntities(v).trim();
}

/**
 * Every value for a meta tag, in document order, de-duplicated.
 *
 * Scholarly pages repeat tags: arXiv emits one `citation_author` per author.
 * A single-value lookup would return the first and silently drop the rest,
 * which is how a five-author paper became a one-author note.
 *
 * Each <meta> tag's attributes are read quote-aware. The old pattern matched
 * content=["']([^"']*)["'], so content="Kyle O'Brien" came back as "Kyle O".
 */
export function getMetaAll(
  html: string,
  attrName: 'property' | 'name' | 'itemprop',
  attrValue: string
): string[] {
  const want = attrValue.toLowerCase();
  const values: string[] = [];
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    if ((attr(tag, attrName) ?? '').toLowerCase() !== want) continue;
    const content = attr(tag, 'content');
    if (content) values.push(content);
  }
  return [...new Set(values)];
}

function getMeta(html: string, attrName: 'property' | 'name' | 'itemprop', attrValue: string): string | null {
  return getMetaAll(html, attrName, attrValue)[0] ?? null;
}

/**
 * An Open Graph or Twitter key under either attribute. The specs say
 * `property` for og:* and `name` for twitter:*, but plenty of pages swap
 * them: Wondershare's Filmora writes <meta name="og:image">.
 */
function getMetaEither(html: string, key: string): string | null {
  return getMeta(html, 'property', key) ?? getMeta(html, 'name', key);
}

/**
 * Flips `"Dennis, Simon"` into `"Simon Dennis"`.
 *
 * Highwire `citation_author` is conventionally Last, First, while cite-wide's
 * schema validates "FirstName LastName". Left alone when the tail looks like a
 * credential or generational suffix, so "Jane Doe, PhD" doesn't become
 * "PhD Jane Doe".
 */
export function normalizeAuthorName(raw: string): string {
  const parts = raw.split(',');
  if (parts.length !== 2) return raw.trim();

  const last = (parts[0] ?? '').trim();
  const first = (parts[1] ?? '').trim();
  if (!last || !first) return raw.trim();
  if (/^(ph\.?\s?d|m\.?\s?d|j\.?\s?d|jr|sr|i{1,3}|iv|esq|m\.?b\.?a)\.?$/i.test(first)) {
    return raw.trim();
  }
  return `${first} ${last}`;
}

/**
 * Highwire dates are slash-separated (`2026/04/30`, sometimes `2026/4/30`, and
 * occasionally year-month only). Everything else — notably the ISO timestamps
 * `article:published_time` emits — passes through untouched.
 */
export function normalizeDate(raw: string): string {
  const value = raw.trim();
  const match = value.match(/^(\d{4})\/(\d{1,2})(?:\/(\d{1,2}))?$/);
  if (!match) return value;

  const [, year, month, day] = match;
  const paddedMonth = (month ?? '').padStart(2, '0');
  return day ? `${year}-${paddedMonth}-${day.padStart(2, '0')}` : `${year}-${paddedMonth}`;
}

/** Returns the first list that has anything in it. */
function firstNonEmpty(...candidates: string[][]): string[] {
  for (const list of candidates) {
    if (list.length > 0) return list;
  }
  return [];
}

function getTitleTag(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m && m[1] ? decodeEntities(m[1]).trim() : null;
}

export function resolveAgainstBase(href: string, baseUrl: string): string {
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return href;
  }
}

interface LinkTag {
  rel: string[];
  href: string;
  sizes: number;
  type: string;
  color: string | undefined;
  itemprop: string | undefined;
}

/** Largest dimension in a `sizes` attribute ("180x180", "16x16 32x32", "any"). */
function largestSize(sizes: string | undefined): number {
  if (!sizes) return 0;
  if (/\bany\b/i.test(sizes)) return Number.MAX_SAFE_INTEGER;
  let max = 0;
  for (const m of sizes.matchAll(/(\d+)x(\d+)/gi)) max = Math.max(max, Number(m[1]), Number(m[2]));
  return max;
}

function linkTags(html: string, baseUrl: string): LinkTag[] {
  const out: LinkTag[] = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const href = attr(tag, 'href');
    if (!href) continue;
    out.push({
      rel: (attr(tag, 'rel') ?? '').toLowerCase().split(/\s+/).filter(Boolean),
      href: resolveAgainstBase(href, baseUrl),
      sizes: largestSize(attr(tag, 'sizes')),
      type: (attr(tag, 'type') ?? '').toLowerCase(),
      color: attr(tag, 'color'),
      itemprop: attr(tag, 'itemprop'),
    });
  }
  return out;
}

/** Every JSON-LD node on the page, flattened through @graph and arrays. */
export function jsonLdNodes(html: string): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(visit); return; }
    if (v && typeof v === 'object') {
      const obj = v as Record<string, unknown>;
      nodes.push(obj);
      if (obj['@graph']) visit(obj['@graph']);
      if (obj['publisher']) visit(obj['publisher']);
    }
  };
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      visit(JSON.parse(m[1] ?? '') as unknown);
    } catch {
      // Malformed JSON-LD is common; skip it.
    }
  }
  return nodes;
}

export function nodeTypes(node: Record<string, unknown>): string[] {
  const t = node['@type'];
  return (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === 'string');
}

/** A URL from a JSON-LD image or logo value: a string, an ImageObject, or a list of either. */
function jsonLdUrl(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return jsonLdUrl(value[0]);
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return jsonLdUrl(o['url'] ?? o['contentUrl']);
  }
  return undefined;
}

const ORGANIZATION_TYPES = /^(Organization|NewsMediaOrganization|Corporation|EducationalOrganization|GovernmentOrganization|NGO|ResearchOrganization|OnlineBusiness)$/;

export function extractBrandAssets(html: string, baseUrl: string): BrandAssets {
  const links = linkTags(html, baseUrl);
  const has = (l: LinkTag, rel: string) => l.rel.includes(rel);

  // Whole rel tokens: the old pattern matched any rel *containing* "icon",
  // so a page listing apple-touch-icon first reported it as the favicon.
  const icons = links.filter(l => has(l, 'icon'));
  const svgIcon = icons.find(l => l.type === 'image/svg+xml' || /\.svg(\?|$)/i.test(l.href));
  const smallIcons = icons.filter(l => l.sizes <= 96).sort((a, b) => b.sizes - a.sizes);
  const favicon = svgIcon?.href ?? smallIcons[0]?.href ?? icons[0]?.href ?? resolveAgainstBase('/favicon.ico', baseUrl);

  const touch = links
    .filter(l => has(l, 'apple-touch-icon') || has(l, 'apple-touch-icon-precomposed'))
    .sort((a, b) => (b.sizes || 180) - (a.sizes || 180));
  const tile = getMeta(html, 'name', 'msapplication-TileImage');
  const bigIcon = icons.filter(l => l.sizes >= 120 && l.sizes !== Number.MAX_SAFE_INTEGER).sort((a, b) => b.sizes - a.sizes)[0];
  const appIcon = touch[0]?.href ?? (tile ? resolveAgainstBase(tile, baseUrl) : undefined) ?? bigIcon?.href;

  let logo: string | undefined;
  for (const node of jsonLdNodes(html)) {
    if (nodeTypes(node).some(x => ORGANIZATION_TYPES.test(x))) {
      const u = jsonLdUrl(node['logo']);
      if (u) { logo = resolveAgainstBase(u, baseUrl); break; }
    }
  }
  if (!logo) {
    const og = getMeta(html, 'property', 'og:logo');
    if (og) logo = resolveAgainstBase(og, baseUrl);
  }
  if (!logo) {
    const linked = links.find(l => l.itemprop === 'logo')?.href;
    const img = html.match(/<img\b[^>]*itemprop\s*=\s*["']?logo["']?[^>]*>/i)?.[0];
    const src = img ? attr(img, 'src') : undefined;
    logo = linked ?? (src ? resolveAgainstBase(src, baseUrl) : undefined);
  }

  const mask = links.find(l => has(l, 'mask-icon'));
  return {
    favicon,
    appIcon,
    logo,
    maskIcon: mask?.href,
    maskIconColor: mask?.color,
    brandColor: getMeta(html, 'name', 'theme-color') ?? getMeta(html, 'name', 'msapplication-TileColor') ?? undefined,
    webManifest: links.find(l => has(l, 'manifest'))?.href,
  };
}

const ARTICLE_TYPES = /^(Article|NewsArticle|BlogPosting|TechArticle|ScholarlyArticle|Report|WebPage|VideoObject|DiscussionForumPosting|SocialMediaPosting|DigitalDocument|Book|CreativeWork|HowTo|Review|Product|SoftwareApplication|WebSite)$/;

/**
 * The page's share image, from every place pages put one, in order:
 *
 *   1. og:image, then its explicit og:image:url and og:image:secure_url forms
 *   2. twitter:image, then the older twitter:image:src
 *      (each of 1–2 under `property` or `name`, since pages mix them up)
 *   3. <meta itemprop="image">, which schema.org microdata pages use
 *   4. <link rel="image_src">, the pre-Open Graph convention
 *   5. the `image` of the page's article-like JSON-LD node
 *
 * Resolved against the page URL, so a relative path becomes a usable URL.
 */
export function extractImage(html: string, baseUrl: string): string | null {
  const fromMeta =
    getMetaEither(html, 'og:image') ??
    getMetaEither(html, 'og:image:url') ??
    getMetaEither(html, 'og:image:secure_url') ??
    getMetaEither(html, 'twitter:image') ??
    getMetaEither(html, 'twitter:image:src') ??
    getMeta(html, 'itemprop', 'image');
  if (fromMeta) return resolveAgainstBase(fromMeta, baseUrl);

  const imageSrc = linkTags(html, baseUrl).find(l => l.rel.includes('image_src'));
  if (imageSrc) return imageSrc.href;

  for (const node of jsonLdNodes(html)) {
    if (!nodeTypes(node).some(x => ARTICLE_TYPES.test(x))) continue;
    const u = jsonLdUrl(node['image'] ?? node['primaryImageOfPage'] ?? node['thumbnailUrl']);
    if (u) return resolveAgainstBase(u, baseUrl);
  }
  return null;
}

function personNames(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(personNames);
  if (v && typeof v === 'object') {
    const name = (v as Record<string, unknown>)['name'];
    return typeof name === 'string' ? [name] : [];
  }
  return [];
}

/** `author` (else `creator`) of the page's article-like JSON-LD node. */
export function jsonLdAuthors(html: string): string[] {
  for (const node of jsonLdNodes(html)) {
    if (!nodeTypes(node).some(x => ARTICLE_TYPES.test(x))) continue;
    const names = personNames(node['author'] ?? node['creator']).map(n => decodeEntities(n).trim()).filter(Boolean);
    if (names.length) return [...new Set(names)];
  }
  return [];
}

/**
 * Medium, Ghost, and WordPress put the byline in twitter:data1 — but only when
 * twitter:label1 says so. Elsewhere data1 is the reading time ("3 minutes"),
 * which is how reading times ended up stored as authors.
 */
export function twitterWrittenBy(html: string): string[] {
  const out: string[] = [];
  for (const n of ['1', '2']) {
    const label = getMeta(html, 'name', `twitter:label${n}`) ?? '';
    const data = getMeta(html, 'name', `twitter:data${n}`);
    if (data && /^(written by|author|by)$/i.test(label.trim())) out.push(data);
  }
  return out;
}

/**
 * Last HTML resort: the visible byline. Text of the first elements whose class
 * or itemprop names an author or byline (Rivery, Deloitte, Harvard DCE expose
 * nothing else). Only name-shaped strings survive downstream filtering;
 * "By" and "Published by" prefixes are dropped here.
 */
export function bylineElements(html: string): string[] {
  // Whole class tokens, BEM-aware. Deloitte marks names
  // `cmp-di-authors__name` and job titles `author-role`; matching any class
  // that merely starts with "author" picked the job title.
  const NAME_TOKEN = /^(?:[a-z0-9]+[-_]+)*(?:authors?|byline)(?:[-_]{1,2}name|Name)(?:--[a-z0-9-]+)?$/i;
  const BARE_TOKEN = /^(?:[a-z0-9]+[-_]+)*(?:authors?|byline)(?:--[a-z0-9-]+)?$/i;
  const named: string[] = [];
  const bare: string[] = [];
  const re = /<(a|span|div|p|li|address|strong|h[2-6])\b([^>]*)>((?:(?!<\/?(?:a|span|div|p|li|address|strong|h[2-6])\b)[\s\S]){1,200})/gi;
  for (const m of html.matchAll(re)) {
    const attrs = m[2] ?? '';
    const tokens = [...(attr(`<x ${attrs}>`, 'class') ?? '').split(/\s+/), attr(`<x ${attrs}>`, 'itemprop') === 'author' ? 'author' : ''].filter(Boolean);
    const kind = tokens.some(t => NAME_TOKEN.test(t)) ? named : tokens.some(t => BARE_TOKEN.test(t)) ? bare : null;
    if (!kind) continue;
    const text = decodeEntities((m[3] ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
      .replace(/^(published )?by\s*:?\s*/i, '');
    if (text && text.length <= 60 && !kind.includes(text)) kind.push(text);
  }
  return (named.length ? named : bare).slice(0, 6);
}

// Titles that describe the fetch, not the page: bot-check interstitials
// (Scribd answers with "Client Challenge"), error pages, and login walls.
// Seen in the wild by Cite Wide enriching the lossless vault's citations
// (2026-10-06). Writing them as og_title would put "Just a moment..." on the
// note, so the fetch counts as failed instead.
const JUNK_TITLES = [
  /^client challenge$/i,
  /^just a moment\.*$/i,
  /^attention required!?( \| cloudflare)?$/i,
  /^access denied$/i,
  /^403 forbidden$/i,
  /^are you a robot\??$/i,
  /^verify(ing)? you are human/i,
  /^security check/i,
  /^captcha/i,
  /^(404[ :|-]*)?(page )?not found\b/i,
  /\bpage not found\b/i,
  /^not found\s*[-|]/i,
  /page (you('re| are) looking for )?(can['’]?t|cannot|could not) be found/i,
  /^publication not available$/i,
  /^(sign|log) ?(in|up)( \| | to |$)/i,
  /^(error|(an )?(unexpected )?error (has )?occurred)( \d{3})?[.!]?$/i,
];

export function isJunkTitle(title: string | undefined): boolean {
  const t = title?.trim();
  return !!t && JUNK_TITLES.some(re => re.test(t));
}

/** The page's metadata, parsed from its HTML. No network, so it's testable. */
export function parseDirectFetchHtml(html: string, url: string): OpenGraphData {
  const title =
    getMetaEither(html, 'og:title') ??
    getMetaEither(html, 'twitter:title') ??
    getMeta(html, 'name', 'citation_title') ??
    getTitleTag(html) ??
    '';
  const description =
    getMetaEither(html, 'og:description') ??
    getMetaEither(html, 'twitter:description') ??
    getMeta(html, 'name', 'description') ??
    '';
  const image = extractImage(html, url);
  const site_name = getMetaEither(html, 'og:site_name') ?? '';
  const type = getMetaEither(html, 'og:type') ?? '';
  const favicon = extractBrandAssets(html, url).favicon;

  // Tiers, first non-empty wins — NOT merged. A journal page can carry both a
  // generic `author` naming one person and a full `citation_author` set;
  // merging would double-list them under two spellings.
  //
  // citation_* leads because it's the Highwire Press standard scholarly
  // publishers emit, and it's complete where the generic tags are lossy.
  // After it, Cite Wide's order from probing 40 author-less citations
  // (2026-10-06): JSON-LD carried the byline on 15 that have no author meta
  // tag; a few expose it only in a visible byline. Each source is filtered
  // before choosing, so a junk meta author can't shadow a real byline.
  const plausible = (list: string[]): string[] => list.filter((a) => isPlausibleAuthor(a.replace(/,/g, ' ')));
  const authors = firstNonEmpty(
    getMetaAll(html, 'name', 'citation_author'),
    plausible(jsonLdAuthors(html)),
    plausible(getMetaAll(html, 'name', 'author')),
    plausible(getMetaAll(html, 'property', 'article:author')),
    plausible(twitterWrittenBy(html)),
    plausible(bylineElements(html))
  )
    // `article:author` is frequently a profile URL rather than a name.
    .filter((value) => !/^https?:\/\//i.test(value))
    // "Lee Ying Shan,Dylan Butts" is two people, not "Last, First":
    // split on commas when every part is itself a multi-word name.
    .flatMap((value) => {
      const parts = value.split(',').map((p) => p.trim()).filter(Boolean);
      return parts.length > 1 && parts.every((p) => p.split(/\s+/).length > 1) ? parts : [value];
    })
    .map(normalizeAuthorName);

  const publishedRaw =
    getMeta(html, 'name', 'citation_publication_date') ??
    getMeta(html, 'name', 'citation_date') ??
    getMetaEither(html, 'article:published_time') ??
    getMeta(html, 'name', 'date') ??
    getMetaEither(html, 'og:published_time') ??
    // Last resort: when a paper was posted, if no publication date is given.
    getMeta(html, 'name', 'citation_online_date') ??
    null;
  const published = publishedRaw ? normalizeDate(publishedRaw) : null;

  const result: OpenGraphData = {
    title,
    description,
    image,
    favicon,
    url,
    type,
    site_name,
    date: new Date().toISOString(),
  };
  if (authors.length > 0) result.authors = authors;
  if (published) result.published = published;
  return result;
}

/** One GET with `throw: false`; the page's HTML. Throws DirectFetchError on any failure. */
export async function fetchPageHtml(url: string): Promise<string> {
  let res;
  try {
    res = await requestUrl({ url, method: 'GET', throw: false });
  } catch (err) {
    throw new DirectFetchError(
      `Network error fetching ${url}: ${err instanceof Error ? err.message : 'unknown'}`,
      'NETWORK_ERROR'
    );
  }

  if (res.status >= 400) {
    throw new DirectFetchError(`HTTP ${res.status} fetching ${url}`, 'HTTP_ERROR');
  }

  const html = res.text ?? '';
  if (!html) {
    throw new DirectFetchError(`Empty response from ${url}`, 'EMPTY_RESPONSE');
  }
  return html;
}

/** Parses fetched HTML, treating a bot-check or error page as a failed fetch. */
export function parseOrReject(html: string, url: string): OpenGraphData {
  const data = parseDirectFetchHtml(html, url);
  if (isJunkTitle(data.title)) {
    throw new DirectFetchError(
      `${url} served a bot-check or error page ("${data.title}"), not the page itself`,
      'BLOCKED_PAGE'
    );
  }
  return data;
}

/** One GET, parsed. Throws DirectFetchError on any failure. */
export async function fetchDirectOpenGraph(url: string): Promise<OpenGraphData> {
  return parseOrReject(await fetchPageHtml(url), url);
}
