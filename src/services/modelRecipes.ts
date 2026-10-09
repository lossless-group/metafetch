// Model recipes: any model API, described as data.
//
// A recipe says where to send a request, which stored secret to attach and
// how, what the body looks like, and where the reply's text is. Claude,
// OpenAI, TrustedRouter, and any OpenAI-compatible endpoint ship as bundled
// recipes; anything else is a recipe file in the vault
// (zz-cf-lib/recipes/*.md, in a `metafetch-recipe` block).
//
// Recipes are data, never code: the only computation is substituting
// {{variables}} into the body and reading one path out of the response.
// Secrets live in Obsidian's secret storage, never in a recipe or data.json,
// and are only sent to hosts the plugin (bundled recipes) or the operator
// (vault recipes, in settings) has approved.

import { parseYaml, requestUrl } from 'obsidian';

export type AuthPlacement = 'bearer' | `header:${string}` | `query:${string}` | 'none';

export interface ModelRecipe {
  id: string;
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
  /** Path to the reply's text: `choices[0].message.content`, `content[?type=text].text`. */
  responseText: string;
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

// --- Vault recipes ---------------------------------------------------------

const FENCE_OPEN = /^```metafetch-recipe\s*$/;
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
  if (close < 0) return { recipe: null, problems: ['the metafetch-recipe block is never closed'] };

  let config: Record<string, unknown> | null;
  try {
    config = asRecord(parseYaml(lines.slice(open + 1, close).join('\n')));
  } catch {
    config = null;
  }
  if (!config) return { recipe: null, problems: ['the metafetch-recipe block is not valid YAML'] };

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

  if (!url) problems.push('request.url is missing');
  if (!responseText) problems.push('response.text (the path to the reply text) is missing');
  if (!['POST', 'GET', 'PUT'].includes(method)) problems.push(`unsupported method ${method}`);
  if (!/^(bearer|none|header:[A-Za-z0-9-]+|query:[A-Za-z0-9_-]+)$/.test(auth)) problems.push(`unsupported auth "${auth}"`);
  if (BUNDLED_RECIPES.some(r => r.id === id)) problems.push(`id "${id}" is taken by a bundled recipe`);
  if (problems.length) return { recipe: null, problems };

  return {
    recipe: {
      id,
      title: str(config['title'], basename),
      origin: 'vault',
      description: str(config['description'], path),
      request: { method: method as 'POST', url, headers, auth: auth as AuthPlacement, body: request['body'] ?? {} },
      responseText,
      defaultModel: str(config['model']),
      defaultBaseUrl: str(config['base-url']),
      allowedHosts: [],
      enforcesSchema: config['enforces-schema'] === true,
    },
    problems,
  };
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
 * indexes an array, `[-1]` counts from the end, and `[?key=value]` takes the
 * first element whose `key` equals `value`.
 */
export function readPath(data: unknown, path: string): unknown {
  let cur: unknown = data;
  for (const part of path.replace(/^\$\.?/, '').match(/[^.[\]]+|\[[^\]]*\]/g) ?? []) {
    if (cur === undefined || cur === null) return undefined;
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

/** Sends one recipe request and returns the JSON object in the reply. */
export async function callModel(call: ModelCall): Promise<{ values: Record<string, unknown>; model: string }> {
  const { recipe, provider } = call;
  const model = provider.model.trim() || recipe.defaultModel;
  if (!model) throw new ModelCallError(`${recipe.title}: no model is set. Choose one in Metafetch settings.`, 'NO_MODEL');
  const baseUrl = (provider.baseUrl.trim() || recipe.defaultBaseUrl).replace(/\/+$/, '');

  const prompt = recipe.enforcesSchema
    ? call.prompt
    : `${call.prompt}\n\nReply with only a JSON object matching this schema, and nothing else:\n${JSON.stringify(call.schema)}`;
  const vars = { model, baseUrl, system: call.system, prompt, schema: call.schema };

  let url = String(substitute(recipe.request.url, { model, baseUrl }));
  const host = hostOf(url);
  if (!host) throw new ModelCallError(`${recipe.title}: "${url}" is not a valid URL`, 'BAD_RECIPE');
  if (!url.startsWith('https://') && !LOCAL_HOSTS.has(host)) {
    throw new ModelCallError(`${recipe.title}: refusing to send a key over plain HTTP to ${host}. Use https, or a localhost endpoint.`, 'INSECURE_URL');
  }

  const headers: Record<string, string> = { ...recipe.request.headers };
  if (recipe.request.auth !== 'none') {
    const allowed = allowedHostsFor(recipe, provider);
    if (!allowed.includes(host)) {
      throw new ModelCallError(
        recipe.origin === 'vault'
          ? `${recipe.title}: ${host} is not an approved host for its key. Add it under the recipe's approved hosts in Metafetch settings.`
          : `${recipe.title}: its key may only go to ${allowed.join(', ')}, not ${host}.`,
        'HOST_NOT_APPROVED'
      );
    }
    const secret = provider.secret ? call.getSecret(provider.secret) : null;
    if (!secret) throw new ModelCallError(`${recipe.title}: no API key. Choose one under ${recipe.title} in Metafetch settings.`, 'NO_KEY');
    const auth = recipe.request.auth;
    if (auth === 'bearer') headers['authorization'] = `Bearer ${secret}`;
    else if (auth.startsWith('header:')) headers[auth.slice('header:'.length)] = secret;
    else if (auth.startsWith('query:')) {
      const u = new URL(url);
      u.searchParams.set(auth.slice('query:'.length), secret);
      url = u.href;
    }
  }

  const body = recipe.request.method === 'GET' ? undefined : JSON.stringify(substitute(recipe.request.body, vars));
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

  let data: unknown;
  try {
    data = JSON.parse(res.text) as unknown;
  } catch {
    throw new ModelCallError(`${recipe.title}: the response was not JSON`, 'BAD_RESPONSE');
  }
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
