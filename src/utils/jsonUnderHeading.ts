// Writes data into a note's body as a JSON code fence under a heading. Copied
// from Perplexed's directoryTemplateService (each plugin ships standalone); a
// note Perplexed has written is updated in place rather than given a second block.

/**
 * Writes `value` as a JSON code fence directly under a heading, verbatim. A fence
 * already there is replaced rather than stacked. With no such heading, adds one
 * at the end.
 */
export function insertJsonUnderHeading(body: string, heading: string, value: unknown): string {
  const json = JSON.stringify(value, null, 2);
  // Fetched strings could hold a fence of their own; the outer one must outrank it.
  const longest = Math.max(2, ...(json.match(/`{3,}/g) ?? []).map(m => m.length));
  const fence = '`'.repeat(longest + 1);
  const block = `${fence}json\n${json}\n${fence}`;

  const lines = body.split('\n');
  const wanted = heading.trim().toLowerCase();
  let inFence = false;
  let at = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const m = inFence ? null : /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (m && (m[1] ?? '').trim().toLowerCase() === wanted) {
      at = i;
      break;
    }
  }
  if (at < 0) return `${body.replace(/\s+$/, '')}\n\n## ${heading}\n\n${block}\n`;

  let next = at + 1;
  while (next < lines.length && (lines[next] ?? '').trim() === '') next++;
  const open = /^(`{3,})json\s*$/.exec(lines[next] ?? '');
  let resume = at + 1;
  if (open) {
    const close = lines.findIndex((l, i) => i > next && l.trim() === open[1]);
    if (close > next) resume = close + 1;
  }
  return [...lines.slice(0, at + 1), '', block, ...lines.slice(resume)].join('\n');
}

/** Applies a change to a note's body only, so a `# comment` in its YAML can never be taken for a heading. */
export function editBody(content: string, change: (body: string) => string): string {
  const m = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(content);
  const head = m ? m[0] : '';
  return head + change(content.slice(head.length));
}
