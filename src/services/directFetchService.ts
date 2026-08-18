import { requestUrl } from 'obsidian';
import type { OpenGraphData } from '../types/open-graph-service';

export class DirectFetchError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'DirectFetchError';
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

/**
 * Every value for a meta tag, in document order, de-duplicated.
 *
 * Scholarly pages repeat tags: arXiv emits one `citation_author` per author.
 * The single-value getMeta below would return the first and silently drop the
 * rest, which is how a five-author paper became a one-author note.
 */
export function getMetaAll(
  html: string,
  attrName: 'property' | 'name',
  attrValue: string
): string[] {
  const v = attrValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Two patterns because the content attribute can sit on either side of the
  // name/property attribute.
  const patterns = [
    new RegExp(
      `<meta\\s+[^>]*${attrName}\\s*=\\s*["']${v}["'][^>]*content\\s*=\\s*["']([^"']*)["']`,
      'gi'
    ),
    new RegExp(
      `<meta\\s+[^>]*content\\s*=\\s*["']([^"']*)["'][^>]*${attrName}\\s*=\\s*["']${v}["']`,
      'gi'
    ),
  ];

  const values: string[] = [];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) !== null) {
      const decoded = decodeEntities(match[1] ?? '').trim();
      if (decoded) values.push(decoded);
    }
  }
  return [...new Set(values)];
}

function getMeta(html: string, attrName: 'property' | 'name', attrValue: string): string | null {
  return getMetaAll(html, attrName, attrValue)[0] ?? null;
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

function resolveAgainstBase(href: string, baseUrl: string): string {
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return href;
  }
}

function getFavicon(html: string, baseUrl: string): string {
  const re1 =
    /<link\s+[^>]*rel\s*=\s*["'][^"']*icon[^"']*["'][^>]*href\s*=\s*["']([^"']+)["']/i;
  const re2 =
    /<link\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*rel\s*=\s*["'][^"']*icon[^"']*["']/i;
  const href = html.match(re1)?.[1] ?? html.match(re2)?.[1];
  return resolveAgainstBase(href ?? '/favicon.ico', baseUrl);
}

export async function fetchDirectOpenGraph(url: string): Promise<OpenGraphData> {
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

  const title =
    getMeta(html, 'property', 'og:title') ??
    getMeta(html, 'name', 'twitter:title') ??
    getMeta(html, 'name', 'citation_title') ??
    getTitleTag(html) ??
    '';
  const description =
    getMeta(html, 'property', 'og:description') ??
    getMeta(html, 'name', 'twitter:description') ??
    getMeta(html, 'name', 'description') ??
    '';
  const rawImage =
    getMeta(html, 'property', 'og:image') ??
    getMeta(html, 'name', 'twitter:image');
  const image = rawImage ? resolveAgainstBase(rawImage, url) : null;
  const site_name = getMeta(html, 'property', 'og:site_name') ?? '';
  const type = getMeta(html, 'property', 'og:type') ?? '';
  const favicon = getFavicon(html, url);
  // Tiers, first non-empty wins — NOT merged. A journal page can carry both a
  // generic `author` naming one person and a full `citation_author` set;
  // merging would double-list them under two spellings.
  //
  // citation_* leads because it's the Highwire Press standard scholarly
  // publishers emit, and it's complete where the generic tags are lossy.
  // Pages without it (TechCrunch et al.) fall straight through to the tags
  // they do publish, so nothing about their behaviour changes.
  const authors = firstNonEmpty(
    getMetaAll(html, 'name', 'citation_author'),
    getMetaAll(html, 'name', 'author'),
    getMetaAll(html, 'property', 'article:author')
  )
    // `article:author` is frequently a profile URL rather than a name.
    .filter((value) => !/^https?:\/\//i.test(value))
    .map(normalizeAuthorName);

  const publishedRaw =
    getMeta(html, 'name', 'citation_publication_date') ??
    getMeta(html, 'name', 'citation_date') ??
    getMeta(html, 'property', 'article:published_time') ??
    getMeta(html, 'name', 'date') ??
    getMeta(html, 'property', 'og:published_time') ??
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
