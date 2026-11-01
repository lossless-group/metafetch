// Recipes: any model or data API, described as data.
//
// A recipe says where to send a request, which stored secret to attach and
// how, what the body looks like, and what to read out of the reply. There are
// two kinds:
//
// - `model` recipes return text holding a JSON object (Claude, OpenAI,
//   TrustedRouter, any OpenAI-compatible endpoint).
// - `data` recipes return named outputs read from a JSON reply by path
//   (Firecrawl, Firecrawl Branding, Fireround). A profile field picks one
//   output by name, so the recipe's vocabulary never dictates a vault's keys.
//
// Anything else is a recipe file in the vault (zz-cf-lib/recipes/*.md, in a
// `cf-recipe` block). A data recipe can borrow another recipe's key with
// `provider:`, and the key still only goes to that provider's hosts: a vault
// file with `provider: firecrawl` can call anything in Firecrawl's catalogue.
//
// Recipes are data, never code: the only computation is substituting
// {{variables}} into the body and reading one path out of the response.
// Secrets live in Obsidian's secret storage, never in a recipe or data.json,
// and are only sent to hosts the plugin (bundled recipes) or the operator
// (vault recipes, in settings) has approved.

import { parseYaml, requestUrl } from 'obsidian';

export type AuthPlacement = 'bearer' | `header:${string}` | `query:${string}` | 'none';

export type RecipeKind = 'model' | 'data';

export interface ModelRecipe {
  id: string;
  kind: RecipeKind;
  /**
   * The recipe whose key, settings, and allowed hosts this one uses. Its own
   * id, unless a data recipe shares another's key.
   */
  provider: string;
  title: string;
  /** Where the recipe came from; vault recipes need host approval in settings. */
  origin: 'bundled' | 'vault';
  /** Shown in settings under the recipe's name. */
  description: string;
  request: {
    method: 'POST' | 'GET' | 'PUT';
    /** May contain {{baseUrl}} and {{model}}. */
    url: string;
    headers: Record<string, string>;
    auth: AuthPlacement;
    /** JSON body template; see substitute(). */
    body: unknown;
  };
  /** Model recipes: path to the reply's text, `choices[0].message.content`, `content[?type=text].text`. */
  responseText: string;
  /** Data recipes: a path that holds the provider's error message, when it reports one inside a 200. */
  responseError?: string;
  /** Data recipes: path to a list of results. Outputs are read from the first one that matches. */
  records?: string;
  /** Data recipes: record path → expected value (may use {{domain}} etc.), compared case-insensitively. */
  match?: Record<string, string>;
  /** Data recipes: output name → paths to try in order. */
  outputs?: Record<string, string[]>;
  /**
   * Data recipes: only look up a note whose URL is a site's homepage. A deep URL
   * is usually about something hosted on that domain, and what the API knows
   * about the domain belongs to the host.
   */
  homepageOnly?: boolean;
  /** Data recipes: gets a "Fetch via" command that writes the raw records as a JSON fence under this heading. */
  writeJsonUnder?: string;
  /** The key those records sit under in the fence; `records` unless a recipe names its own. */
  jsonKey?: string;
  defaultModel: string;
  /** Default base URL, for recipes whose URL starts with {{baseUrl}}. */
  defaultBaseUrl: string;
  /** Hosts a bundled recipe may send its secret to. Vault recipes use the settings list instead. */
  allowedHosts: string[];
  /** True when the provider enforces the JSON schema; otherwise the prompt asks for JSON. */
  enforcesSchema: boolean;
}

// --- Bundled recipes -------------------------------------------------------

const SYSTEM_VAR = '{{system}}';
const PROMPT_VAR = '{{prompt}}';

export const BUNDLED_RECIPES: ModelRecipe[] = [
  {
    id: 'anthropic',
    kind: 'model',
    provider: 'anthropic',
    title: 'Claude (Anthropic)',
    origin: 'bundled',
    description: 'The Anthropic Messages API, with the reply held to a JSON schema. Get a key at console.anthropic.com.',
    request: {
      method: 'POST',
      url: 'https://api.anthropic.com/v1/messages',
      headers: {
        'anthropic-version': '2023-06-01',
        // Server-side fallback: if the model declines, the API re-runs the
        // request on a fallback model inside the same call.
        'anthropic-beta': 'server-side-fallback-2026-07-01',
        'content-type': 'application/json',
      },
      auth: 'header:x-api-key',
      body: {
        model: '{{model}}',
        max_tokens: 16000,
        system: SYSTEM_VAR,
        messages: [{ role: 'user', content: PROMPT_VAR }],
        output_config: { format: { type: 'json_schema', schema: '{{schema}}' } },
        fallbacks: 'default',
      },
    },
    // Thinking blocks come first on current models; the answer is the text block.
    responseText: 'content[?type=text].text',
    defaultModel: 'claude-opus-5-5',
    defaultBaseUrl: '',
    allowedHosts: ['api.anthropic.com'],
    enforcesSchema: true,
  },
  {
    id: 'openai',
    kind: 'model',
    provider: 'openai',
    title: 'OpenAI',
    origin: 'bundled',
    description: 'OpenAI Chat Completions, with the reply held to a strict JSON schema. Get a key at platform.openai.com.',
    request: {
      method: 'POST',
      url: 'https://api.openai.com/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      auth: 'bearer',
      body: {
        model: '{{model}}',
        messages: [
          { role: 'system', content: SYSTEM_VAR },
          { role: 'user', content: PROMPT_VAR },
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'frontmatter', strict: true, schema: '{{schema}}' } },
      },
    },
    responseText: 'choices[0].message.content',
    defaultModel: 'gpt-6-astra',
    defaultBaseUrl: '',
    allowedHosts: ['api.openai.com'],
    enforcesSchema: true,
  },
  {
    id: 'trustedrouter',
    kind: 'model',
    provider: 'trustedrouter',
    title: 'TrustedRouter',
    origin: 'bundled',
    description: 'One OpenAI-compatible key for hundreds of models, through an attested gateway. Model names look like openai/gpt-6-astra. Get a key at trustedrouter.com.',
    request: {
      method: 'POST',
      url: 'https://api.trustedrouter.com/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      auth: 'bearer',
      body: {
        model: '{{model}}',
        messages: [
          { role: 'system', content: SYSTEM_VAR },
          { role: 'user', content: PROMPT_VAR },
        ],
      },
    },
    responseText: 'choices[0].message.content',
    defaultModel: 'openai/gpt-6-astra',
    defaultBaseUrl: '',
    allowedHosts: ['api.trustedrouter.com'],
    // Routed models vary in schema support, so the prompt asks for JSON.
    enforcesSchema: false,
  },
  {
    id: 'openai-compatible',
    kind: 'model',
    provider: 'openai-compatible',
    title: 'OpenAI-compatible endpoint',
    origin: 'bundled',
    description: 'Any API that speaks OpenAI Chat Completions: LM Studio, Ollama, OpenRouter, Groq, a self-hosted gateway. Set its base URL; the key is only sent to that host.',
    request: {
      method: 'POST',
      url: '{{baseUrl}}/chat/completions',
      headers: { 'content-type': 'application/json' },
      auth: 'bearer',
      body: {
        model: '{{model}}',
        messages: [
          { role: 'system', content: SYSTEM_VAR },
          { role: 'user', content: PROMPT_VAR },
        ],
      },
    },
    responseText: 'choices[0].message.content',
    defaultModel: '',
    defaultBaseUrl: 'http://localhost:1234/v1',
    // The host of the configured base URL; see allowedHostsFor().
    allowedHosts: [],
    enforcesSchema: false,
  },
];

// Firecrawl's metadata keys come in two spellings; outputs try both.
const FC_META = 'data.metadata';

/** Recipes that read data rather than ask a model. All three share one Firecrawl key. */
export const BUNDLED_DATA_RECIPES: ModelRecipe[] = [
  {
    id: 'firecrawl',
    kind: 'data',
    provider: 'firecrawl',
    title: 'Firecrawl',
    origin: 'bundled',
    description: 'Reads a page through Firecrawl\'s scraper, for sites that refuse a plain fetch. Its outputs are the page values (title, description, image, favicon, site_name, type, published). The same key runs Firecrawl Branding, Fireround, and any recipe file with provider: firecrawl. Get a key at firecrawl.dev.',
    request: {
      method: 'POST',
      url: 'https://api.firecrawl.dev/v2/scrape',
      headers: { 'content-type': 'application/json' },
      auth: 'bearer',
      body: { url: '{{url}}', formats: ['markdown'], onlyMainContent: true },
    },
    responseText: '',
    responseError: 'error',
    outputs: {
      title: [`${FC_META}.ogTitle`, `${FC_META}.og:title`, `${FC_META}.title`],
      description: [`${FC_META}.ogDescription`, `${FC_META}.og:description`, `${FC_META}.description`],
      image: [`${FC_META}.ogImage`, `${FC_META}.og:image`],
      favicon: [`${FC_META}.favicon`],
      site_name: [`${FC_META}.ogSiteName`, `${FC_META}.og:site_name`, `${FC_META}.publisher`],
      type: [`${FC_META}.og:type`, `${FC_META}.ogType`],
      published: [`${FC_META}.article:published_time`, `${FC_META}.publishedTime`],
      language: [`${FC_META}.language`],
      keywords: [`${FC_META}.keywords`],
    },
    defaultModel: '',
    defaultBaseUrl: '',
    allowedHosts: ['api.firecrawl.dev'],
    enforcesSchema: false,
  },
  {
    id: 'firecrawl-branding',
    kind: 'data',
    provider: 'firecrawl',
    title: 'Firecrawl Branding',
    origin: 'bundled',
    description: 'A site\'s logo, colours, and fonts, read by Firecrawl. Outputs: logo, favicon, image, primary_color, secondary_color, accent_color, background_color, color_scheme, heading_font, body_font, fonts. Uses the Firecrawl key.',
    request: {
      method: 'POST',
      url: 'https://api.firecrawl.dev/v2/scrape',
      headers: { 'content-type': 'application/json' },
      auth: 'bearer',
      body: { url: '{{url}}', formats: ['branding'] },
    },
    responseText: '',
    responseError: 'error',
    outputs: {
      // Often an inline data: SVG, which is never written; a linked image is.
      // (images.logoHref is where the logo links to, not the image.)
      logo: ['data.branding.images.logo'],
      favicon: ['data.branding.images.favicon'],
      image: ['data.branding.images.ogImage'],
      primary_color: ['data.branding.colors.primary'],
      secondary_color: ['data.branding.colors.secondary'],
      accent_color: ['data.branding.colors.accent'],
      background_color: ['data.branding.colors.background'],
      color_scheme: ['data.branding.colorScheme'],
      heading_font: ['data.branding.typography.fontFamilies.heading'],
      body_font: ['data.branding.typography.fontFamilies.primary'],
      fonts: ['data.branding.fonts[*].family'],
    },
    defaultModel: '',
    defaultBaseUrl: '',
    allowedHosts: ['api.firecrawl.dev'],
    enforcesSchema: false,
  },
  {
    id: 'fireround',
    kind: 'data',
    provider: 'firecrawl',
    title: 'Fireround',
    origin: 'bundled',
    description: 'A company\'s latest funding round, from Fireround\'s verified feed (through Firecrawl). Matched on the note\'s domain, so a similarly named company is never written. Outputs: round, round_stage, amount, amount_usd_millions, announced_on, lead_investors, other_investors, total_raised, valuation, previous_rounds, sources, fireround_url, company_name, company_description, sector, headquarters. Uses the Firecrawl key.',
    request: {
      method: 'POST',
      url: 'https://api.firecrawl.dev/v2/scrape',
      headers: { 'content-type': 'application/json' },
      auth: 'bearer',
      body: { alexandria: { provider: 'fireround', capability: 'rounds/search', options: { q: '{{domain}}', limit: 20 } } },
    },
    responseText: '',
    responseError: 'data.alexandria[0].error',
    records: 'data.alexandria[0].data.data',
    match: { 'company.domain': '{{domain}}' },
    homepageOnly: true,
    writeJsonUnder: 'Fundraising History',
    jsonKey: 'rounds',
    outputs: {
      round: ['stage_as_written'],
      round_stage: ['stage'],
      amount: ['amount.as_written'],
      amount_usd_millions: ['amount.usd_millions'],
      announced_on: ['announced_on'],
      lead_investors: ['lead_investors'],
      other_investors: ['other_investors'],
      total_raised: ['total_as_written'],
      valuation: ['valuation.as_written', 'valuation'],
      previous_rounds: ['previous_rounds[*].stage_as_written'],
      sources: ['sources[*].url'],
      fireround_url: ['url'],
      company_name: ['company.name'],
      company_description: ['company.description'],
      sector: ['company.sector'],
      headquarters: ['company.headquarters'],
    },
    defaultModel: '',
    defaultBaseUrl: '',
    allowedHosts: ['api.firecrawl.dev'],
    enforcesSchema: false,
  },
];

export const ALL_BUNDLED_RECIPES: ModelRecipe[] = [...BUNDLED_RECIPES, ...BUNDLED_DATA_RECIPES];

// --- Vault recipes ---------------------------------------------------------

const FENCE_OPEN = /^```cf-recipe\s*$/;
const FENCE_CLOSE = /^```\s*$/;

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);

/** Reads one recipe file. Returns the recipe and any problems; null when it has no recipe block. */
export function parseRecipe(content: string, path: string): { recipe: ModelRecipe | null; problems: string[] } | null {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const open = lines.findIndex(l => FENCE_OPEN.test(l));
  if (open < 0) return null;
  const close = lines.findIndex((l, i) => i > open && FENCE_CLOSE.test(l));
  if (close < 0) return { recipe: null, problems: ['the cf-recipe block is never closed'] };

  let config: Record<string, unknown> | null;
  try {
    config = asRecord(parseYaml(lines.slice(open + 1, close).join('\n')));
  } catch {
    config = null;
  }
  if (!config) return { recipe: null, problems: ['the cf-recipe block is not valid YAML'] };

  const problems: string[] = [];
  const basename = path.split('/').pop()?.replace(/\.md$/, '') ?? path;
  const id = str(config['id'], basename).toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  const request = asRecord(config['request']) ?? {};
  const url = str(request['url']);
  const method = str(request['method'], 'POST').toUpperCase();
  const auth = str(request['auth'], 'bearer');
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(asRecord(request['headers']) ?? {})) {
    if (typeof v === 'string' || typeof v === 'number') headers[k] = String(v);
  }
  const response = asRecord(config['response']) ?? {};
  const responseText = str(response['text']);
  const kind = str(config['kind'], 'model');
  // Only data recipes may borrow another recipe's key.
  const provider = kind === 'data' ? str(config['provider'], id).toLowerCase() : id;

  const outputs: Record<string, string[]> = {};
  for (const [name, paths] of Object.entries(asRecord(response['outputs']) ?? {})) {
    const list = (Array.isArray(paths) ? paths : [paths]).filter((x): x is string => typeof x === 'string' && x.length > 0);
    if (list.length) outputs[name] = list;
  }
  const match: Record<string, string> = {};
  for (const [path, v] of Object.entries(asRecord(response['match']) ?? {})) {
    if (typeof v === 'string' || typeof v === 'number') match[path] = String(v);
  }

  if (!url) problems.push('request.url is missing');
  if (kind !== 'model' && kind !== 'data') problems.push(`unknown kind "${kind}" (model or data)`);
  if (kind === 'model' && !responseText) problems.push('response.text (the path to the reply text) is missing');
  if (kind === 'data' && Object.keys(outputs).length === 0) problems.push('response.outputs (output name → path) is missing');
  if (!['POST', 'GET', 'PUT'].includes(method)) problems.push(`unsupported method ${method}`);
  if (!/^(bearer|none|header:[A-Za-z0-9-]+|query:[A-Za-z0-9_-]+)$/.test(auth)) problems.push(`unsupported auth "${auth}"`);
  if (ALL_BUNDLED_RECIPES.some(r => r.id === id)) problems.push(`id "${id}" is taken by a bundled recipe`);
  if (problems.length) return { recipe: null, problems };

  const recipe: ModelRecipe = {
    id,
    kind: kind as RecipeKind,
    provider,
    title: str(config['title'], basename),
    origin: 'vault',
    description: str(config['description'], path),
    request: { method: method as 'POST', url, headers, auth: auth as AuthPlacement, body: request['body'] ?? {} },
    responseText,
    defaultModel: str(config['model']),
    defaultBaseUrl: str(config['base-url']),
    allowedHosts: [],
    enforcesSchema: config['enforces-schema'] === true,
  };
  if (kind === 'data') {
    recipe.outputs = outputs;
    if (Object.keys(match).length) recipe.match = match;
    if (str(response['records'])) recipe.records = str(response['records']);
    if (str(response['error'])) recipe.responseError = str(response['error']);
    if (config['homepage-only'] === true) recipe.homepageOnly = true;
    if (str(response['write-json-under']).trim()) recipe.writeJsonUnder = str(response['write-json-under']).trim();
    if (str(response['json-key'])) recipe.jsonKey = str(response['json-key']);
  }
  return { recipe, problems };
}

// --- Running a recipe ------------------------------------------------------

export class ModelCallError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'ModelCallError';
  }
}

/**
 * Fills a body template. A string that is exactly `{{name}}` becomes the
 * variable's value as-is (so `{{schema}}` can be an object); `{{name}}` inside
 * a longer string is spliced in as text. Unknown variables are an error, so a
 * typo'd recipe fails loudly instead of sending a literal `{{modle}}`.
 */
export function substitute(template: unknown, vars: Record<string, unknown>): unknown {
  if (typeof template === 'string') {
    const whole = template.match(/^\{\{([a-zA-Z]+)\}\}$/);
    if (whole) {
      const name = whole[1] ?? '';
      if (!(name in vars)) throw new ModelCallError(`Unknown recipe variable {{${name}}}`, 'BAD_RECIPE');
      return vars[name];
    }
    return template.replace(/\{\{([a-zA-Z]+)\}\}/g, (_m, name: string) => {
      if (!(name in vars)) throw new ModelCallError(`Unknown recipe variable {{${name}}}`, 'BAD_RECIPE');
      const v = vars[name];
      return typeof v === 'string' ? v : JSON.stringify(v);
    });
  }
  if (Array.isArray(template)) return template.map(t => substitute(t, vars));
  const obj = asRecord(template);
  if (obj) return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, substitute(v, vars)]));
  return template;
}

/**
 * Reads one value out of a JSON response. Segments are dot-separated; `[n]`
 * indexes an array, `[-1]` counts from the end, `[?key=value]` takes the
 * first element whose `key` equals `value`, and `[*]` reads the rest of the
 * path from every element, giving a list.
 */
export function readPath(data: unknown, path: string): unknown {
  return walk(data, path.replace(/^\$\.?/, '').match(/[^.[\]]+|\[[^\]]*\]/g) ?? []);
}

function walk(data: unknown, parts: string[]): unknown {
  let cur: unknown = data;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] ?? '';
    if (cur === undefined || cur === null) return undefined;
    if (part === '[*]') {
      if (!Array.isArray(cur)) return undefined;
      const rest = parts.slice(i + 1);
      return cur.map(el => walk(el, rest)).flat().filter(v => v !== undefined && v !== null);
    }
    if (part.startsWith('[')) {
      const inner = part.slice(1, -1);
      if (!Array.isArray(cur)) return undefined;
      const filter = inner.match(/^\?([^=]+)=(.*)$/);
      if (filter) {
        const [, key, value] = filter;
        cur = cur.find(el => {
          const v = asRecord(el)?.[key ?? ''];
          return (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') && String(v) === value;
        });
      } else {
        const n = Number(inner);
        cur = cur[n < 0 ? cur.length + n : n];
      }
    } else {
      cur = asRecord(cur)?.[part];
    }
  }
  return cur;
}

/**
 * The first JSON object in a model's reply. Providers that don't enforce a
 * schema wrap it in prose or a ```json fence; this tolerates both.
 */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const unfenced = text.replace(/```(?:json)?\s*([\s\S]*?)```/i, '$1');
  for (const candidate of [unfenced.trim(), unfenced.slice(unfenced.indexOf('{'), unfenced.lastIndexOf('}') + 1)]) {
    try {
      const parsed = asRecord(JSON.parse(candidate));
      if (parsed) return parsed;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export interface ProviderSettings {
  /** The name of the secret in Obsidian's secret storage (not the key itself). */
  secret: string;
  model: string;
  baseUrl: string;
  /** Vault recipes only: comma-separated hosts the operator lets the secret go to. */
  approvedHosts: string;
}

/** Hosts this provider's secret may be sent to. */
export function allowedHostsFor(recipe: ModelRecipe, provider: ProviderSettings): string[] {
  if (recipe.origin === 'bundled') {
    if (recipe.allowedHosts.length) return recipe.allowedHosts;
    // OpenAI-compatible: the host the operator typed as the base URL.
    const h = hostOf(provider.baseUrl || recipe.defaultBaseUrl);
    return h ? [h] : [];
  }
  return provider.approvedHosts.split(/[\s,]+/).map(h => h.trim().toLowerCase()).filter(Boolean);
}

/** The recipe whose key and hosts a recipe uses: itself, or the one its `provider:` names. */
export function keyHolderFor(recipe: ModelRecipe, recipes: ModelRecipe[]): ModelRecipe | null {
  if (recipe.provider === recipe.id) return recipe;
  const holder = recipes.find(r => r.id === recipe.provider);
  // A holder that itself borrows would let a chain widen where a key goes.
  return holder && holder.provider === holder.id ? holder : null;
}

interface Send {
  recipe: ModelRecipe;
  /** Whose key, settings, and allowed hosts apply. */
  keyHolder: ModelRecipe;
  provider: ProviderSettings;
  getSecret: (name: string) => string | null;
  /** Variables for the body. */
  vars: Record<string, unknown>;
  /** Variables for the URL, already encoded where they need to be. */
  urlVars: Record<string, unknown>;
}

/** Sends one recipe request, with the key placed and its host checked; returns the parsed JSON. */
async function send(s: Send): Promise<unknown> {
  const { recipe, keyHolder, provider } = s;
  let url = String(substitute(recipe.request.url, s.urlVars));
  const host = hostOf(url);
  if (!host) throw new ModelCallError(`${recipe.title}: "${url}" is not a valid URL`, 'BAD_RECIPE');
  if (!url.startsWith('https://') && !LOCAL_HOSTS.has(host)) {
    throw new ModelCallError(`${recipe.title}: refusing to send a key over plain HTTP to ${host}. Use https, or a localhost endpoint.`, 'INSECURE_URL');
  }

  const headers: Record<string, string> = { ...recipe.request.headers };
  if (recipe.request.auth !== 'none') {
    const allowed = allowedHostsFor(keyHolder, provider);
    if (!allowed.includes(host)) {
      throw new ModelCallError(
        keyHolder.origin === 'vault'
          ? `${recipe.title}: ${host} is not an approved host for its key. Add it under ${keyHolder.title}'s approved hosts in Metafetch settings.`
          : `${recipe.title}: the ${keyHolder.title} key may only go to ${allowed.join(', ')}, not ${host}.`,
        'HOST_NOT_APPROVED'
      );
    }
    const secret = provider.secret ? s.getSecret(provider.secret) : null;
    if (!secret) throw new ModelCallError(`${recipe.title}: no API key. Choose one under ${keyHolder.title} in Metafetch settings.`, 'NO_KEY');
    const auth = recipe.request.auth;
    if (auth === 'bearer') headers['authorization'] = `Bearer ${secret}`;
    else if (auth.startsWith('header:')) headers[auth.slice('header:'.length)] = secret;
    else if (auth.startsWith('query:')) {
      const u = new URL(url);
      u.searchParams.set(auth.slice('query:'.length), secret);
      url = u.href;
    }
  }

  const body = recipe.request.method === 'GET' ? undefined : JSON.stringify(substitute(recipe.request.body, s.vars));
  let res;
  try {
    res = await requestUrl({ url, method: recipe.request.method, headers, ...(body !== undefined ? { body } : {}), throw: false });
  } catch (err) {
    throw new ModelCallError(`${recipe.title}: network error (${err instanceof Error ? err.message : 'unknown'})`, 'NETWORK_ERROR');
  }
  if (res.status >= 400) {
    // The provider's own error message, which never contains the key.
    const detail = (res.text ?? '').slice(0, 300).replace(/\s+/g, ' ');
    throw new ModelCallError(`${recipe.title}: HTTP ${res.status}${detail ? ` (${detail})` : ''}`, 'HTTP_ERROR');
  }
  try {
    return JSON.parse(res.text) as unknown;
  } catch {
    throw new ModelCallError(`${recipe.title}: the response was not JSON`, 'BAD_RESPONSE');
  }
}

export interface ModelCall {
  recipe: ModelRecipe;
  provider: ProviderSettings;
  /** Reads a secret by name; Obsidian's app.secretStorage.getSecret in the app. */
  getSecret: (name: string) => string | null;
  system: string;
  prompt: string;
  /** JSON Schema of the expected object. */
  schema: Record<string, unknown>;
}

/** Sends one model recipe request and returns the JSON object in the reply. */
export async function callModel(call: ModelCall): Promise<{ values: Record<string, unknown>; model: string }> {
  const { recipe, provider } = call;
  const model = provider.model.trim() || recipe.defaultModel;
  if (!model) throw new ModelCallError(`${recipe.title}: no model is set. Choose one in Metafetch settings.`, 'NO_MODEL');
  const baseUrl = (provider.baseUrl.trim() || recipe.defaultBaseUrl).replace(/\/+$/, '');

  const prompt = recipe.enforcesSchema
    ? call.prompt
    : `${call.prompt}\n\nReply with only a JSON object matching this schema, and nothing else:\n${JSON.stringify(call.schema)}`;
  const data = await send({
    recipe,
    keyHolder: recipe,
    provider,
    getSecret: call.getSecret,
    vars: { model, baseUrl, system: call.system, prompt, schema: call.schema },
    urlVars: { model, baseUrl },
  });

  const stop = readPath(data, 'stop_reason') ?? readPath(data, 'choices[0].finish_reason');
  if (stop === 'refusal') throw new ModelCallError(`${recipe.title}: the model declined the request`, 'REFUSED');
  const text = readPath(data, recipe.responseText);
  if (typeof text !== 'string') {
    throw new ModelCallError(`${recipe.title}: no reply text at ${recipe.responseText}`, 'BAD_RESPONSE');
  }
  const values = parseJsonObject(text);
  if (!values) throw new ModelCallError(`${recipe.title}: the reply did not contain a JSON object`, 'BAD_RESPONSE');
  return { values, model };
}

/** What a data recipe can know about the note: its URL, that URL's domain, and its title. */
export interface NoteVars {
  url: string;
  title: string;
}

/** `www.example.com` → `example.com`; empty for an unreadable URL. */
export function domainOf(url: string): string {
  return (hostOf(url) ?? '').replace(/^www\./, '');
}

/** True when a URL has no path beyond its site's root. */
export function isHomepage(url: string): boolean {
  try {
    return new URL(url.trim()).pathname.replace(/\/+$/, '') === '';
  } catch {
    return false;
  }
}

/**
 * A data value fit for frontmatter: text, a number, a yes/no, or a list of
 * those. Objects, empty values, and inline `data:` blobs are dropped.
 */
export function acceptDataValue(value: unknown): unknown {
  const one = (v: unknown): string | number | boolean | undefined => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
    if (typeof v === 'boolean') return v;
    if (typeof v !== 'string') return undefined;
    const t = v.trim();
    return t && !/^data:/i.test(t) ? t : undefined;
  };
  if (Array.isArray(value)) {
    const items = value.map(one).filter((v): v is string | number | boolean => v !== undefined);
    return items.length ? [...new Set(items)] : undefined;
  }
  return one(value);
}

export interface DataCall {
  recipe: ModelRecipe;
  /** Every known recipe, to find the one whose key this recipe borrows. */
  recipes: ModelRecipe[];
  providers: Record<string, ProviderSettings>;
  getSecret: (name: string) => string | null;
  note: NoteVars;
}

/**
 * Sends a data recipe's request and returns what it found, untouched: every
 * record that matches, or the whole reply for a recipe without `records`. Empty
 * means no match: a near miss is never kept.
 */
export async function fetchRecords(call: DataCall): Promise<unknown[]> {
  const { recipe } = call;
  if (recipe.kind !== 'data') throw new ModelCallError(`${recipe.title} is a model recipe; use from: [model]`, 'BAD_RECIPE');
  const keyHolder = keyHolderFor(recipe, call.recipes);
  if (!keyHolder) throw new ModelCallError(`${recipe.title}: its provider "${recipe.provider}" is not a recipe with its own key`, 'BAD_RECIPE');
  if (recipe.homepageOnly && !isHomepage(call.note.url)) {
    throw new ModelCallError(`${recipe.title} skipped: ${call.note.url} is not a homepage, and what it finds there could belong to the host.`, 'NOT_HOMEPAGE');
  }
  const provider = call.providers[keyHolder.id] ?? { secret: '', model: '', baseUrl: '', approvedHosts: '' };

  const vars = { url: call.note.url, domain: domainOf(call.note.url), title: call.note.title };
  const baseUrl = (provider.baseUrl.trim() || keyHolder.defaultBaseUrl).replace(/\/+$/, '');
  const urlVars = { baseUrl, ...Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, encodeURIComponent(v)])) };
  const data = await send({ recipe, keyHolder, provider, getSecret: call.getSecret, vars, urlVars });

  if (recipe.responseError) {
    const err = readPath(data, recipe.responseError);
    if (err !== undefined && err !== null && err !== false && err !== '') {
      const msg = typeof err === 'string' ? err : JSON.stringify(err);
      throw new ModelCallError(`${recipe.title}: ${msg.slice(0, 300)}`, 'PROVIDER_ERROR');
    }
  }

  if (!recipe.records) return [data];
  const list = readPath(data, recipe.records);
  if (!Array.isArray(list)) return [];
  const want = Object.entries(recipe.match ?? {}).map(([path, v]) => [path, String(substitute(v, vars)).trim().toLowerCase()] as const);
  return (list as unknown[]).filter(rec => want.every(([path, v]) => {
    const got = readPath(rec, path);
    return (typeof got === 'string' || typeof got === 'number') && String(got).trim().toLowerCase() === v;
  }));
}

/** Runs one data recipe for a note and returns every output it could read, by name, from the first match. */
export async function callData(call: DataCall): Promise<Record<string, unknown>> {
  const { recipe } = call;
  const [source] = await fetchRecords(call);
  if (source === undefined) return {};

  const out: Record<string, unknown> = {};
  for (const [name, paths] of Object.entries(recipe.outputs ?? {})) {
    for (const path of paths) {
      const v = acceptDataValue(readPath(source, path));
      if (v !== undefined) { out[name] = v; break; }
    }
  }
  return out;
}
