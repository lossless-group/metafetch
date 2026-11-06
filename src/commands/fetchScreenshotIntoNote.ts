// "Fetch screenshots from website": a screenshot of the note's website as it
// looks today, rendered by Microlink, saved as a vault attachment and embedded
// under `## Screenshots`. Saved, not linked, because Microlink's image URLs are
// temporary.

import { Notice, TFile } from 'obsidian';
import type { App } from 'obsidian';
import { downloadScreenshot, fetchMicrolinkScreenshot } from '../services/microlinkScreenshotService';
import { collectFrontmatterUrls } from '../utils/frontmatterUrls';
import { editBody } from '../utils/jsonUnderHeading';
import { SCREENSHOTS_HEADING, upsertSection } from '../utils/screenshotsSection';
import { extractFrontmatter } from '../utils/yamlFrontmatter';

/** The page to capture: `url`, or the note's only URL-valued property. */
export function screenshotTarget(fm: Record<string, unknown>): string | null {
  if (typeof fm['url'] === 'string' && /^https?:\/\//i.test(fm['url'].trim())) return fm['url'].trim();
  const urls = collectFrontmatterUrls(fm);
  return urls.length === 1 ? (urls[0]?.url ?? null) : null;
}

/** `Linear App` + 2026-11-06 + png → `linear-app-screenshot-2026-11-06.png` */
export function screenshotFileName(basename: string, date: Date, type: string): string {
  const slug = basename.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'page';
  const day = [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map(n => n.toString().padStart(2, '0'))
    .join('-');
  const ext = type === 'jpeg' || type === 'jpg' ? 'jpg' : 'png';
  return `${slug}-screenshot-${day}.${ext}`;
}

export async function fetchScreenshotIntoNote(app: App, microlinkApiKey: string): Promise<void> {
  const file = app.workspace.getActiveFile();
  if (!(file instanceof TFile)) {
    new Notice('Metafetch: no active file');
    return;
  }
  const fm = extractFrontmatter(await app.vault.read(file)) ?? {};
  const pageUrl = screenshotTarget(fm);
  if (!pageUrl) {
    new Notice('Metafetch: add a URL to the frontmatter to choose which website to screenshot');
    return;
  }

  const notice = new Notice(`Metafetch: taking a screenshot of ${pageUrl}…`, 0);
  try {
    const shot = await fetchMicrolinkScreenshot(pageUrl, microlinkApiKey);
    const bytes = await downloadScreenshot(shot);
    const name = screenshotFileName(file.basename, new Date(), shot.type);
    const path = await app.fileManager.getAvailablePathForAttachment(name, file.path);
    const image = await app.vault.createBinary(path, bytes);
    const embed = `!${app.fileManager.generateMarkdownLink(image, file.path)}`;
    const block = `${embed}\n*Screenshot of [${pageUrl}](${pageUrl}), ${name.slice(-14, -4)}*`;
    await app.vault.process(file, content =>
      editBody(content, body => upsertSection(body, SCREENSHOTS_HEADING, block))
    );
    new Notice(`Metafetch: saved ${image.path} under ## ${SCREENSHOTS_HEADING}`);
  } catch (err) {
    new Notice(`Metafetch: ${err instanceof Error ? err.message : 'screenshot failed'}`);
  } finally {
    notice.hide();
  }
}
