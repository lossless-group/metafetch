// "Fill frontmatter from folder profile": the note's folder profile says which
// fields it should carry; the direct parser fills the empty ones from the
// note's page and, for social links, from the site's homepage.

import { Notice, normalizePath, TFile, TFolder } from 'obsidian';
import type { App } from 'obsidian';
import { fetchPageHtml, isJunkTitle, parseDirectFetchHtml, parseOrReject } from '../services/directFetchService';
import { chooseSocialLinks } from '../services/socialLinks';
import {
  needsSocials,
  parseProfile,
  planFill,
  resolveProfiles,
  fieldIsSet,
  type FillReport,
  type FrontmatterProfile,
} from '../services/frontmatterProfiles';
import type { OpenGraphData } from '../types/open-graph-service';
import { extractFrontmatter } from '../utils/yamlFrontmatter';
import { TOOLING_SOCIALS_FILENAME, TOOLING_SOCIALS_PROFILE } from '../profiles/toolingSocials';

export type ProfilePicker = (profiles: FrontmatterProfile[]) => Promise<FrontmatterProfile | null>;

/** Every profile under the profiles folder. Files without a metafetch-profile block are ignored. */
export async function listProfiles(app: App, root: string): Promise<FrontmatterProfile[]> {
  const prefix = normalizePath(root).replace(/\/$/, '') + '/';
  const out: FrontmatterProfile[] = [];
  for (const file of app.vault.getMarkdownFiles()) {
    if (!file.path.startsWith(prefix)) continue;
    const profile = parseProfile(await app.vault.cachedRead(file), file.path);
    if (profile) out.push(profile);
  }
  return out;
}

/** The site's homepage, where social links live even when the note's URL is a deeper page. */
export function siteRoot(url: string): string | null {
  try {
    return new URL(url).origin + '/';
  } catch {
    return null;
  }
}

const sameUrl = (a: string, b: string) => a.replace(/[?#].*$/, '').replace(/\/+$/, '') === b.replace(/[?#].*$/, '').replace(/\/+$/, '');

function summarize(profile: FrontmatterProfile, report: FillReport): string {
  const parts = [`Metafetch (${profile.title}):`];
  parts.push(report.filled.length ? `filled ${report.filled.join(', ')}.` : 'nothing new to fill.');
  if (report.ambiguous.length) {
    parts.push(`Not written, the page links more than one: ${report.ambiguous.map(a => `${a.key} (${a.candidates.join(' or ')})`).join('; ')}.`);
  }
  if (report.notFound.length) parts.push(`Not found: ${report.notFound.join(', ')}.`);
  if (report.skipped.length) parts.push(`Skipped (needs a provider this version lacks): ${report.skipped.join(', ')}.`);
  return parts.join(' ');
}

async function tryFetch(url: string): Promise<{ html: string } | { error: string }> {
  try {
    return { html: await fetchPageHtml(url) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'unknown error' };
  }
}

export async function fillFromProfile(app: App, profilesRoot: string, pick: ProfilePicker): Promise<void> {
  const file = app.workspace.getActiveFile();
  if (!(file instanceof TFile)) {
    new Notice('Metafetch: no active file');
    return;
  }

  const profiles = await listProfiles(app, profilesRoot);
  const { matches, tie } = resolveProfiles(profiles, file.path);
  if (matches.length === 0) {
    new Notice(`Metafetch: no frontmatter profile in ${profilesRoot} applies to ${file.parent?.path ?? 'this folder'}. "Create example frontmatter profile" adds one for Tooling.`);
    return;
  }
  const profile = tie ? await pick(matches) : matches[0] ?? null;
  if (!profile) return;

  const content = await app.vault.read(file);
  const fm = extractFrontmatter(content) ?? {};
  const url = typeof fm['url'] === 'string' ? fm['url'].trim() : '';
  if (!url) {
    new Notice('Metafetch: this note has no web address in its frontmatter to read from.');
    return;
  }

  if (profile.fields.every(f => fieldIsSet(f, fm))) {
    new Notice(`Metafetch (${profile.title}): every field is already set.`);
    return;
  }

  const pending = new Notice(`Metafetch (${profile.title}): reading ${url}…`, 0);
  const pageFetch = await tryFetch(url);
  let page: OpenGraphData | null = null;
  let pageError: string | null = 'error' in pageFetch ? pageFetch.error : null;
  if ('html' in pageFetch) {
    try {
      page = parseOrReject(pageFetch.html, url);
    } catch (err) {
      pageError = err instanceof Error ? err.message : 'unknown error';
    }
  }

  let socials = null;
  if (needsSocials(profile, fm)) {
    const root = siteRoot(url);
    // The note's own page, when it was readable and not a bot-check page.
    const pageHtml = page && 'html' in pageFetch ? pageFetch.html : null;
    let rootHtml: string | null = null;
    if (root && sameUrl(root, url)) {
      rootHtml = pageHtml;
    } else if (root) {
      const rootFetch = await tryFetch(root);
      // A blocked homepage's links are the blocker's, not the company's.
      if ('html' in rootFetch && !isJunkTitle(parseDirectFetchHtml(rootFetch.html, root).title)) rootHtml = rootFetch.html;
      // A deep page the site does serve beats nothing: footers repeat site-wide.
      else rootHtml = pageHtml;
    }
    if (rootHtml && root) socials = chooseSocialLinks(rootHtml, root, page?.site_name || undefined);
  }
  pending.hide();

  if (!page && !socials) {
    new Notice(`Metafetch (${profile.title}) failed — ${pageError ?? 'nothing could be read'}`);
    return;
  }

  const { values, report } = planFill(profile, fm, page, socials);
  if (report.filled.length > 0) {
    // processFrontMatter adds the new keys and leaves every other line of the
    // note's frontmatter as it was; rewriting the whole block would re-quote
    // values this command never meant to touch.
    await app.fileManager.processFrontMatter(file, (live: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(values)) {
        // Re-checked against the live frontmatter: the note may have changed
        // while the pages were fetched.
        const current = live[key];
        if (current === undefined || current === null || current === '') live[key] = value;
      }
    });
  }
  new Notice(summarize(profile, report), 12000);
  for (const a of report.ambiguous) console.debug(`Metafetch: ${file.path} ${a.key} candidates:`, a.candidates);
}

/** Writes the Tooling socials example into the profiles folder, unless it's already there. */
export async function createExampleProfile(app: App, profilesRoot: string): Promise<void> {
  const root = normalizePath(profilesRoot);
  const path = normalizePath(`${root}/${TOOLING_SOCIALS_FILENAME}`);
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    new Notice(`Metafetch: ${path} already exists; it was left as is.`);
    return;
  }
  if (!(app.vault.getAbstractFileByPath(root) instanceof TFolder)) {
    await app.vault.createFolder(root);
  }
  await app.vault.create(path, TOOLING_SOCIALS_PROFILE);
  new Notice(`Metafetch: created ${path}. Edit its fields block to change what Tooling notes get.`);
}
