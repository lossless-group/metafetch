import { requestUrl } from 'obsidian';
import type { OpenGraphData } from '../types/open-graph-service';

export class MicrolinkFetchError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'MicrolinkFetchError';
  }
}

interface MicrolinkImage {
  url?: string;
  type?: string;
  size?: number;
  width?: number;
  height?: number;
}

interface MicrolinkData {
  title?: string;
  description?: string;
  url?: string;
  publisher?: string;
  author?: string;
  lang?: string;
  image?: MicrolinkImage | null;
  logo?: MicrolinkImage | null;
  date?: string;
}

interface MicrolinkResponse {
  status?: string;
  data?: MicrolinkData;
  message?: string;
  more?: string;
}

const ENDPOINT = 'https://api.microlink.io';

export async function fetchMicrolinkOpenGraph(
  url: string,
  apiKey?: string
): Promise<OpenGraphData> {
  const reqUrl = `${ENDPOINT}?url=${encodeURIComponent(url)}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey && apiKey.trim()) headers['x-api-key'] = apiKey.trim();

  let res;
  try {
    res = await requestUrl({ url: reqUrl, method: 'GET', headers, throw: false });
  } catch (err) {
    throw new MicrolinkFetchError(
      `Network error calling Microlink for ${url}: ${err instanceof Error ? err.message : 'unknown'}`,
      'NETWORK_ERROR'
    );
  }

  if (res.status === 429) {
    throw new MicrolinkFetchError(
      `Microlink rate limit hit (50/day on the free tier). Try again later or add an API key.`,
      'RATE_LIMITED'
    );
  }

  if (res.status >= 400) {
    throw new MicrolinkFetchError(
      `Microlink HTTP ${res.status} for ${url}`,
      'HTTP_ERROR'
    );
  }

  let body: MicrolinkResponse;
  try {
    body = res.json as MicrolinkResponse;
  } catch {
    throw new MicrolinkFetchError(
      `Microlink returned non-JSON for ${url}`,
      'INVALID_RESPONSE'
    );
  }

  if (body.status !== 'success' || !body.data) {
    throw new MicrolinkFetchError(
      body.message ?? `Microlink returned status="${body.status}" for ${url}`,
      'API_ERROR'
    );
  }

  const d = body.data;
  const result: OpenGraphData = {
    title: d.title ?? '',
    description: d.description ?? '',
    image: d.image?.url ?? null,
    favicon: d.logo?.url ?? null,
    url: d.url ?? url,
    type: '',
    site_name: d.publisher ?? '',
    date: new Date().toISOString(),
  };
  if (d.author) result.authors = [d.author];
  if (d.date) result.published = d.date;
  return result;
}
