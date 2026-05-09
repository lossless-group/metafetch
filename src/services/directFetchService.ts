import { requestUrl } from 'obsidian';
import { OpenGraphData } from '../types/open-graph-service';

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

function getMeta(html: string, attrName: 'property' | 'name', attrValue: string): string | null {
  const v = attrValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re1 = new RegExp(
    `<meta\\s+[^>]*${attrName}\\s*=\\s*["']${v}["'][^>]*content\\s*=\\s*["']([^"']*)["']`,
    'i'
  );
  const re2 = new RegExp(
    `<meta\\s+[^>]*content\\s*=\\s*["']([^"']*)["'][^>]*${attrName}\\s*=\\s*["']${v}["']`,
    'i'
  );
  const raw = html.match(re1)?.[1] ?? html.match(re2)?.[1];
  return raw ? decodeEntities(raw).trim() : null;
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
  const author =
    getMeta(html, 'name', 'author') ??
    getMeta(html, 'property', 'article:author') ??
    null;
  const published =
    getMeta(html, 'property', 'article:published_time') ??
    getMeta(html, 'name', 'date') ??
    getMeta(html, 'property', 'og:published_time') ??
    null;

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
  if (author) result.authors = [author];
  if (published) result.published = published;
  return result;
}
