// Writes a note's `## Screenshots` section. Perplexed writes to the same
// section, so neither plugin may wipe the other's images: a section that holds
// no image yet (a template's "none publicly available") is replaced, and one
// that does gets the new content added after what's there. A note without the
// section gets it appended. Headings inside code fences are ignored.
// Kept in step with Perplexed's copy by hand; each plugin ships on its own.

export const SCREENSHOTS_HEADING = 'Screenshots';

export function upsertSection(body: string, heading: string, content: string): string {
  const lines = body.split('\n');
  const wanted = heading.trim().toLowerCase();
  let inFence = false;
  let at = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const m = inFence ? null : /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (m && (m[2] ?? '').trim().toLowerCase() === wanted) {
      at = i;
      level = (m[1] ?? '').length;
      break;
    }
  }
  if (at < 0) return `${body.replace(/\s+$/, '')}\n\n## ${heading}\n\n${content}\n`;

  let end = lines.length;
  inFence = false;
  for (let i = at + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const m = inFence ? null : /^(#{1,6})\s/.exec(line);
    if (m && (m[1] ?? '').length <= level) {
      end = i;
      break;
    }
  }
  const existing = lines.slice(at + 1, end).join('\n').trim();
  const kept = /!\[[^\]]*\]\(|!\[\[/.test(existing) ? `${existing}\n\n` : '';
  const tail = lines.slice(end);
  return [...lines.slice(0, at + 1), '', kept + content, ...(tail.length > 0 ? ['', ...tail] : [''])].join('\n');
}
