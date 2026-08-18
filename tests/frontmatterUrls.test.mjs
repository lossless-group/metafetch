/**
 * Tests for src/utils/frontmatterUrls.ts — finding fetchable URLs in a note.
 *
 * The cases that matter are the exclusions. A source note that has already
 * been fetched carries og_image and og_favicon URLs, and offering those as
 * fetch targets would be worse than useless.
 *
 * Run: pnpm test
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const work = mkdtempSync(join(tmpdir(), 'metafetch-fmurls-'));
const bundle = join(work, 'frontmatterUrls.mjs');

execFileSync('npx', [
  'esbuild', 'src/utils/frontmatterUrls.ts',
  '--bundle', '--format=esm', '--external:obsidian', `--outfile=${bundle}`,
], { stdio: 'pipe' });

const { collectFrontmatterUrls } = await import(pathToFileURL(bundle).href);

// Defaults from settings.ts — what main.ts passes as the exclusion list.
const EXCLUDE = ['og_image', 'og_favicon'];

/** @type {[string, object, string[], Array<[string,string]>][]} */
const cases = [
  ['plain url property',
    { url: 'https://example.com/post' }, EXCLUDE,
    [['url', 'https://example.com/post']]],

  ['journal-keyed property is found',
    { arxiv: 'https://arxiv.org/abs/2604.27891' }, EXCLUDE,
    [['arxiv', 'https://arxiv.org/abs/2604.27891']]],

  ['several journals in one note, in frontmatter order',
    { arxiv: 'https://arxiv.org/abs/1', ssrn: 'https://ssrn.com/2', techcrunch: 'https://techcrunch.com/3' }, EXCLUDE,
    [['arxiv', 'https://arxiv.org/abs/1'], ['ssrn', 'https://ssrn.com/2'], ['techcrunch', 'https://techcrunch.com/3']]],

  ['metafetch output is excluded by field name',
    { url: 'https://example.com/post', og_image: 'https://cdn.example.com/card', og_favicon: 'https://example.com/fav' },
    EXCLUDE,
    [['url', 'https://example.com/post']]],

  ['image URLs excluded by extension even under a renamed field',
    { url: 'https://example.com/post', banner: 'https://cdn.example.com/card.jpg', icon: 'https://example.com/favicon.ico' },
    EXCLUDE,
    [['url', 'https://example.com/post']]],

  ['image extension with a query string still excluded',
    { hero: 'https://cdn.example.com/x.png?v=2' }, EXCLUDE, []],

  ['array values are enumerated with an index',
    { mirrors: ['https://arxiv.org/abs/1', 'https://arxiv.org/pdf/1'] }, EXCLUDE,
    [['mirrors[0]', 'https://arxiv.org/abs/1'], ['mirrors[1]', 'https://arxiv.org/pdf/1']]],

  ['non-URL values are ignored',
    { title: 'Some Paper', tags: ['ai', 'agents'], year: 2026, doi: '10.1234/abcd', url: 'https://example.com' },
    EXCLUDE,
    [['url', 'https://example.com']]],

  ['http is accepted, other schemes are not',
    { a: 'http://example.com', b: 'ftp://example.com', c: 'mailto:x@example.com', d: 'obsidian://open' },
    EXCLUDE,
    [['a', 'http://example.com']]],

  ['whitespace is trimmed',
    { url: '  https://example.com/post  ' }, EXCLUDE,
    [['url', 'https://example.com/post']]],

  ['same URL under two properties keeps both — that is informative',
    { url: 'https://example.com/x', canonical: 'https://example.com/x' }, EXCLUDE,
    [['url', 'https://example.com/x'], ['canonical', 'https://example.com/x']]],

  ['no frontmatter at all',
    null, EXCLUDE, []],

  ['frontmatter with no URLs',
    { title: 'Note', tags: ['a'] }, EXCLUDE, []],
];

let pass = 0;
const failures = [];

for (const [name, frontmatter, exclude, expected] of cases) {
  const got = collectFrontmatterUrls(frontmatter, exclude).map((entry) => [entry.key, entry.url]);
  if (JSON.stringify(got) === JSON.stringify(expected)) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}`);
    console.log(`        got  ${JSON.stringify(got)}`);
    console.log(`        want ${JSON.stringify(expected)}`);
  }
}

// `property` strips the array index so callers can group or prefix by source.
const arrayEntry = collectFrontmatterUrls({ mirrors: ['https://a.example'] }, EXCLUDE)[0];
if (arrayEntry?.property === 'mirrors' && arrayEntry?.key === 'mirrors[0]') {
  pass++;
  console.log('  PASS  array entry exposes bare property alongside indexed key');
} else {
  failures.push('array entry property');
  console.log('  FAIL  array entry exposes bare property alongside indexed key');
  console.log(`        got ${JSON.stringify(arrayEntry)}`);
}

rmSync(work, { recursive: true, force: true });

console.log(`\n${pass} passed, ${failures.length} failed`);
process.exit(failures.length > 0 ? 1 : 0);
