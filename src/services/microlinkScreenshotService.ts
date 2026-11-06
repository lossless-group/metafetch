// A screenshot of a web page, rendered by Microlink (the same service as
// "Fetch via Microlink"; free tier 50 requests a day, no key needed).
// Microlink's image URLs are temporary, so callers download the bytes and keep
// them in the vault rather than linking to Microlink.

import { requestUrl } from 'obsidian';
import { MicrolinkFetchError } from './microlinkFetchService';

const ENDPOINT = 'https://api.microlink.io';

export interface PageScreenshot {
  /** Microlink's temporary URL for the image. */
  url: string;
  /** `png` or `jpeg`. */
  type: string;
  width?: number;
  height?: number;
}

/** The request URL for a screenshot of `pageUrl`. Exported for tests. */
export function screenshotRequestUrl(pageUrl: string): string {
  // meta=false skips the metadata pass: only the image is needed.
  return `${ENDPOINT}?url=${encodeURIComponent(pageUrl)}&screenshot=true&meta=false`;
}

/** The screenshot in a Microlink response, or null when it has none. */
export function screenshotFromResponse(body: unknown): PageScreenshot | null {
  if (typeof body !== 'object' || body === null) return null;
  const data = (body as { data?: unknown }).data;
  if (typeof data !== 'object' || data === null) return null;
  const shot = (data as { screenshot?: unknown }).screenshot;
  if (typeof shot !== 'object' || shot === null) return null;
  const s = shot as Record<string, unknown>;
  if (typeof s['url'] !== 'string' || !/^https?:\/\//.test(s['url'])) return null;
  const result: PageScreenshot = { url: s['url'], type: typeof s['type'] === 'string' ? s['type'] : 'png' };
  if (typeof s['width'] === 'number') result.width = s['width'];
  if (typeof s['height'] === 'number') result.height = s['height'];
  return result;
}

export async function fetchMicrolinkScreenshot(pageUrl: string, apiKey?: string): Promise<PageScreenshot> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey && apiKey.trim()) headers['x-api-key'] = apiKey.trim();

  let res;
  try {
    res = await requestUrl({ url: screenshotRequestUrl(pageUrl), method: 'GET', headers, throw: false });
  } catch (err) {
    throw new MicrolinkFetchError(
      `Network error calling Microlink for ${pageUrl}: ${err instanceof Error ? err.message : 'unknown'}`,
      'NETWORK_ERROR'
    );
  }
  if (res.status === 429) {
    throw new MicrolinkFetchError(
      'Microlink rate limit hit (50/day on the free tier). Try again later or add an API key.',
      'RATE_LIMITED'
    );
  }
  if (res.status >= 400) {
    throw new MicrolinkFetchError(`Microlink HTTP ${res.status} for ${pageUrl}`, 'HTTP_ERROR');
  }

  let body: unknown;
  try {
    body = res.json;
  } catch {
    throw new MicrolinkFetchError(`Microlink returned non-JSON for ${pageUrl}`, 'INVALID_RESPONSE');
  }
  const shot = screenshotFromResponse(body);
  if (!shot) {
    const message = (body as { message?: unknown } | null)?.message;
    throw new MicrolinkFetchError(
      typeof message === 'string' ? message : `Microlink returned no screenshot for ${pageUrl}`,
      'API_ERROR'
    );
  }
  return shot;
}

/** The image's bytes. Microlink's URL expires, so these go into the vault. */
export async function downloadScreenshot(shot: PageScreenshot): Promise<ArrayBuffer> {
  const res = await requestUrl({ url: shot.url, method: 'GET', throw: false });
  if (res.status >= 400) {
    throw new MicrolinkFetchError(`Downloading the screenshot failed: HTTP ${res.status}`, 'HTTP_ERROR');
  }
  return res.arrayBuffer;
}
