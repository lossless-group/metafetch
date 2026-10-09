// Folder profiles: which frontmatter a note in a given folder should carry.
//
// A profile is a markdown file in the profiles folder (default
// zz-cf-lib/frontmatter/), in the same shape as Perplexed's templates:
// frontmatter with `applies-to-paths` globs, free prose for humans, and one
// fenced block the runtime reads:
//
//   ```metafetch-profile
//   fields:
//     linkedin_url: { platform: linkedin-company }
//     og_image:     { page: image, aliases: [image] }
//   ```
//
// `platform:` fields are filled from the site's own social links;
// `page:` fields from the page's metadata; fields with `from: [model]` and a
// `describe:` instruction by a model reading the page's text (see
// modelRecipes.ts). Social links and other URLs are never asked of a model,
// which would make them up. See context-v/explorations/Folder-Aware-Frontmatter-
// Templates-and-Fetch-Recipes.md.

import { parseYaml } from 'obsidian';
import type { OpenGraphData } from '../types/open-graph-service';
import { isSocialPlatform, type SocialChoice, type SocialPlatform } from './socialLinks';

/** The direct-fetch values a `page:` field can take. */
export const PAGE_VALUES = ['title', 'description', 'image', 'favicon', 'site_name', 'type', 'authors', 'published'] as const;
export type PageValue = typeof PAGE_VALUES[number];

const isPageValue = (v: unknown): v is PageValue => typeof v === 'string' && (PAGE_VALUES as readonly string[]).includes(v);

export interface ProfileField {
  key: string;
  /** Filled from the site's social links. */
  platform?: SocialPlatform;
  /** Filled from the page's own metadata. */
  page?: PageValue;
  /** Other keys that, when set, mean this field is already filled. Never renamed. */
  aliases: string[];
  /** The direct parser may fill it (it has a platform or page value, and `from` allows `direct`). */
  runnable: boolean;
  /** A model may fill it, when the direct parser didn't. */
  model?: ModelFieldSpec;
}

export interface ModelFieldSpec {
  /** The instruction the model gets for this field. */
  describe: string;
  type: 'string' | 'enum' | 'list';
  /** Allowed values, for `enum` (one) and `list` (any of; empty means free text). */
  values: string[];
}

export interface FrontmatterProfile {
  path: string;
  title: string;
  description: string;
  appliesToPaths: string[];
  fields: ProfileField[];
  /** Which model recipe fills `from: [model]` fields; empty means the settings default. */
  modelProvider: string;
  /** Problems found while reading the file; the profile still loads what it can. */
  problems: string[];
}

// Copied from Perplexed's directoryTemplateService (each plugin ships
// standalone): `**/` spans folders, `*` stays within one.
function globToRegExp(glob: string): RegExp {
  let re = '^';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i] ?? '';
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        re += '(?:.*/)?';
        i += 3;
      } else {
        re += '.*';
        i += 2;
      }
    } else if (c === '*') {
      re += '[^/]*';
      i++;
    } else if (c === '?') {
      re += '[^/]';
      i++;
    } else if ('.+^$|(){}[]\\'.includes(c)) {
      re += '\\' + c;
      i++;
    } else {
      re += c;
      i++;
    }
  }
  return new RegExp(re + '$');
}

/** Length of a glob's literal prefix: `Tooling/AI/**` is more specific than `Tooling/**`. */
function specificity(glob: string): number {
  const wild = glob.search(/[*?]/);
  return wild === -1 ? glob.length + 1 : wild;
}

const FENCE_OPEN = /^```metafetch-profile\s*$/;
const FENCE_CLOSE = /^```\s*$/;

function splitFrontmatter(content: string): { frontmatter: string; body: string } {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  if (lines[0] !== '---') return { frontmatter: '', body: lines.join('\n') };
  const end = lines.indexOf('---', 1);
  if (end < 0) return { frontmatter: '', body: lines.join('\n') };
  return { frontmatter: lines.slice(1, end).join('\n'), body: lines.slice(end + 1).join('\n') };
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
}

function safeYaml(text: string): Record<string, unknown> | null {
  if (!text.trim()) return {};
  try {
    return asRecord(parseYaml(text));
  } catch {
    return null;
  }
}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' ? [v] : [];

/** Reads one profile file. Returns null when it isn't a profile at all (no fence). */
export function parseProfile(content: string, path: string): FrontmatterProfile | null {
  const { frontmatter, body } = splitFrontmatter(content);
  const lines = body.split('\n');
  const open = lines.findIndex(l => FENCE_OPEN.test(l));
  if (open < 0) return null;
  const close = lines.findIndex((l, i) => i > open && FENCE_CLOSE.test(l));

  const problems: string[] = [];
  const meta = safeYaml(frontmatter) ?? {};
  const basename = path.split('/').pop()?.replace(/\.md$/, '') ?? path;
  const profile: FrontmatterProfile = {
    path,
    title: typeof meta['title'] === 'string' ? meta['title'] : basename,
    description: typeof meta['description'] === 'string' ? meta['description'] : '',
    appliesToPaths: strings(meta['applies-to-paths']),
    fields: [],
    modelProvider: '',
    problems,
  };
  if (profile.appliesToPaths.length === 0) problems.push('no applies-to-paths globs, so it matches no note');
  if (close < 0) {
    problems.push('the metafetch-profile block is never closed');
    return profile;
  }

  const config = safeYaml(lines.slice(open + 1, close).join('\n'));
  if (!config) {
    problems.push('the metafetch-profile block is not valid YAML');
    return profile;
  }
  if (typeof config['model'] === 'string') profile.modelProvider = config['model'];
  const fields = asRecord(config['fields']);
  if (!fields) {
    problems.push('the metafetch-profile block has no fields map');
    return profile;
  }

  for (const [key, raw] of Object.entries(fields)) {
    const spec = asRecord(raw) ?? {};
    const platform = spec['platform'];
    const page = spec['page'];
    if (platform !== undefined && !isSocialPlatform(platform)) {
      problems.push(`${key}: unknown platform ${JSON.stringify(platform)}`);
      continue;
    }
    if (page !== undefined && !isPageValue(page)) {
      problems.push(`${key}: unknown page value ${JSON.stringify(page)}`);
      continue;
    }
    const from = strings(spec['from']);
    const describe = typeof spec['describe'] === 'string' ? spec['describe'].trim() : '';
    const wantsModel = from.includes('model');
    if (wantsModel && !describe) {
      problems.push(`${key}: from: [model] needs a describe: instruction for the model`);
      continue;
    }
    if (wantsModel && platform !== undefined) {
      problems.push(`${key}: social links come from the page, never a model, which would make them up`);
      continue;
    }
    if (platform === undefined && page === undefined && !wantsModel) {
      problems.push(`${key}: needs a platform, a page value, or from: [model] with describe`);
      continue;
    }
    const type = spec['type'];
    const values = strings(spec['values']);
    if (wantsModel && type === 'enum' && values.length === 0) {
      problems.push(`${key}: type enum needs a values list`);
      continue;
    }
    const field: ProfileField = {
      key,
      aliases: strings(spec['aliases']),
      runnable: (platform !== undefined || page !== undefined) && (from.length === 0 || from.includes('direct')),
    };
    if (platform !== undefined) field.platform = platform;
    if (page !== undefined) field.page = page;
    if (wantsModel) field.model = { describe, type: type === 'enum' || type === 'list' ? type : 'string', values };
    profile.fields.push(field);
  }
  return profile;
}

/**
 * The profiles that apply to a note, best first. `tie` is true when the
 * top two are equally specific, so the user should pick.
 */
export function resolveProfiles(profiles: FrontmatterProfile[], notePath: string): { matches: FrontmatterProfile[]; tie: boolean } {
  const scored = profiles
    .map(p => ({ p, score: Math.max(-1, ...p.appliesToPaths.filter(g => globToRegExp(g).test(notePath)).map(specificity)) }))
    .filter(x => x.score >= 0)
    .sort((a, b) => b.score - a.score);
  const [first, second] = scored;
  return { matches: scored.map(x => x.p), tie: !!first && !!second && first.score === second.score };
}

const isSet = (v: unknown): boolean =>
  v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '') && !(Array.isArray(v) && v.length === 0);

/** True when the note already holds a value for the field, under its key or an alias. */
export function fieldIsSet(field: ProfileField, frontmatter: Record<string, unknown>): boolean {
  return [field.key, ...field.aliases].some(k => isSet(frontmatter[k]));
}

export interface FillReport {
  filled: string[];
  alreadySet: string[];
  notFound: string[];
  /** Fields where the page linked two equally strong candidates; nothing was written. */
  ambiguous: { key: string; candidates: string[] }[];
  /** Fields whose sources this version can't run. */
  skipped: string[];
  /** Empty fields left for a model to fill, after the direct parser. */
  forModel: string[];
}

function pageValue(data: OpenGraphData, page: PageValue): unknown {
  switch (page) {
    case 'title': return data.title;
    case 'description': return data.description;
    case 'image': return data.image;
    case 'favicon': return data.favicon;
    case 'site_name': return data.site_name;
    case 'type': return data.type;
    case 'authors': return data.authors;
    case 'published': return data.published;
  }
}

/**
 * Decides what to write. Fills only fields that are empty under their key
 * and every alias; never blanks anything; never touches keys outside the
 * profile.
 */
export function planFill(
  profile: FrontmatterProfile,
  frontmatter: Record<string, unknown>,
  page: OpenGraphData | null,
  socials: Record<SocialPlatform, SocialChoice> | null
): { values: Record<string, unknown>; report: FillReport } {
  const values: Record<string, unknown> = {};
  const report: FillReport = { filled: [], alreadySet: [], notFound: [], ambiguous: [], skipped: [], forModel: [] };

  for (const field of profile.fields) {
    if (fieldIsSet(field, frontmatter)) { report.alreadySet.push(field.key); continue; }
    if (!field.runnable) {
      if (field.model) report.forModel.push(field.key);
      else report.skipped.push(field.key);
      continue;
    }

    if (field.platform) {
      const choice = socials?.[field.platform];
      if (choice?.url) { values[field.key] = choice.url; report.filled.push(field.key); }
      else if (choice?.ambiguous) report.ambiguous.push({ key: field.key, candidates: choice.candidates.map(c => c.url) });
      else report.notFound.push(field.key);
    } else if (field.page) {
      const value = page ? pageValue(page, field.page) : undefined;
      if (isSet(value)) { values[field.key] = value; report.filled.push(field.key); }
      else if (field.model) report.forModel.push(field.key);
      else report.notFound.push(field.key);
    }
  }
  return { values, report };
}

/**
 * The JSON Schema a model reply must match: one property per field, each
 * nullable, all required (strict structured-output modes require every
 * property to be listed), no extra properties.
 */
export function modelSchema(fields: ProfileField[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const f of fields) {
    if (!f.model) continue;
    const m = f.model;
    const value = m.type === 'enum'
      ? { type: 'string', enum: m.values }
      : m.type === 'list'
        ? { type: 'array', items: m.values.length ? { type: 'string', enum: m.values } : { type: 'string' } }
        : { type: 'string' };
    properties[f.key] = { anyOf: [value, { type: 'null' }], description: m.describe };
  }
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

/** The instructions for one model call. */
export function modelPrompt(
  fields: ProfileField[],
  note: { title: string; url: string; frontmatter: Record<string, unknown> },
  pageText: { text: string; truncated: boolean }
): { system: string; prompt: string } {
  const system = [
    'You fill in frontmatter properties for a note in an Obsidian vault, using only the web page you are given.',
    'For each property, follow its instruction. If the page does not support a value, return null for it: an empty property is better than a guessed one.',
    'Never invent URLs, names, numbers, or dates that are not on the page.',
  ].join(' ');
  const known = Object.entries(note.frontmatter)
    .filter(([, v]) => typeof v === 'string' && v.length < 300)
    .map(([k, v]) => `${k}: ${String(v as string)}`)
    .join('\n');
  const wanted = fields
    .filter(f => f.model)
    .map(f => {
      const m = f.model!;
      const allowed = m.values.length ? ` Allowed values: ${m.values.join(', ')}.` : '';
      return `- ${f.key} (${m.type === 'list' ? 'a list' : m.type === 'enum' ? 'one value' : 'text'}): ${m.describe}${allowed}`;
    })
    .join('\n');
  const prompt = [
    `The note is about: ${note.title}`,
    `Its URL: ${note.url}`,
    known ? `What the note already says:\n${known}` : '',
    `Properties to fill:\n${wanted}`,
    `The page's text${pageText.truncated ? ' (the first part; the page is longer)' : ''}:\n<page>\n${pageText.text}\n</page>`,
  ].filter(Boolean).join('\n\n');
  return { system, prompt };
}

/**
 * A model's value for one field, checked against the field's type. Returns
 * undefined for null, the wrong shape, or a value outside an enum: nothing is
 * written that the profile didn't allow.
 */
export function acceptModelValue(field: ProfileField, value: unknown): unknown {
  const m = field.model;
  if (!m || value === null || value === undefined) return undefined;
  if (m.type === 'list') {
    if (!Array.isArray(value)) return undefined;
    const items = value.filter((v): v is string => typeof v === 'string').map(v => v.trim()).filter(Boolean)
      .filter(v => m.values.length === 0 || m.values.includes(v));
    return items.length ? [...new Set(items)] : undefined;
  }
  if (typeof value !== 'string') return undefined;
  const t = value.trim();
  if (!t) return undefined;
  if (m.type === 'enum') return m.values.includes(t) ? t : undefined;
  return t;
}

/** Does any empty field need the site's social links (and so its homepage)? */
export function needsSocials(profile: FrontmatterProfile, frontmatter: Record<string, unknown>): boolean {
  return profile.fields.some(f => f.runnable && f.platform && !fieldIsSet(f, frontmatter));
}
