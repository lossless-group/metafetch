/**
 * Round-trip tests for src/utils/yamlFrontmatter.ts
 *
 * Metafetch rewrites the ENTIRE frontmatter block on every fetch/insert, not
 * just the og_* keys it owns. So the parse -> serialize round trip has to be
 * lossless for keys metafetch has no business touching (tags, authors,
 * related). These cases pin the behavior fixed in 0.1.7.
 *
 * Run: pnpm test
 *
 * There is no test framework here on purpose — the util has no runtime deps
 * and this keeps it that way. If js-yaml happens to be installed, each case
 * also asserts that a REAL YAML parser reads our output the way we intend;
 * without it those assertions are skipped rather than failing.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const work = mkdtempSync(join(tmpdir(), 'metafetch-yfm-'));
const bundle = join(work, 'yamlFrontmatter.mjs');

execFileSync('npx', [
  'esbuild', 'src/utils/yamlFrontmatter.ts',
  '--bundle', '--format=esm', '--external:obsidian', `--outfile=${bundle}`,
], { stdio: 'pipe' });

const { extractFrontmatter, formatFrontmatter } = await import(pathToFileURL(bundle).href);

let yaml = null;
try {
  yaml = (await import('js-yaml')).default;
} catch {
  console.log('note: js-yaml not installed — skipping real-YAML agreement checks\n');
}

const wrap = (body) => `---\n${body}\n---\nbody text`;

/** @type {[string, string, string, unknown][]} name, input, expected output, expected object */
const cases = [
  // --- the reported bug: array items were unconditionally quoted -----------
  ['block tags emit bare',
    'tags:\n  - augmented-intelligence\n  - ai',
    'tags:\n  - augmented-intelligence\n  - ai',
    { tags: ['augmented-intelligence', 'ai'] }],
  ['Train-Case tags emit bare',
    'tags:\n  - Markdown-Rendering\n  - Issue-Resolution',
    'tags:\n  - Markdown-Rendering\n  - Issue-Resolution',
    { tags: ['Markdown-Rendering', 'Issue-Resolution'] }],

  // --- inline flow sequences used to become a quoted STRING ----------------
  ['inline array parses, emits as block',
    'tags: [augmented-intelligence, ai]',
    'tags:\n  - augmented-intelligence\n  - ai',
    { tags: ['augmented-intelligence', 'ai'] }],
  ['inline array splits on commas outside quotes',
    'tags: ["a, b", c]',
    'tags:\n  - "a, b"\n  - c',
    { tags: ['a, b', 'c'] }],
  ['empty inline array',
    'tags: []',
    'tags: []',
    { tags: [] }],

  // --- wikilinks: quoting is REQUIRED, not cosmetic ------------------------
  // Unquoted, a real YAML parser reads [[Ada Lovelace]] as [["Ada Lovelace"]].
  ['wikilink item keeps its quotes',
    'authors:\n  - "[[Ada Lovelace]]"',
    'authors:\n  - "[[Ada Lovelace]]"',
    { authors: ['[[Ada Lovelace]]'] }],
  ['unquoted wikilink item gains quotes',
    'authors:\n  - [[Ada Lovelace]]',
    'authors:\n  - "[[Ada Lovelace]]"',
    { authors: ['[[Ada Lovelace]]'] }],
  ['wikilink alias and heading forms survive',
    'related:\n  - "[[Doc|Alias]]"\n  - "[[Doc#Section]]"',
    'related:\n  - "[[Doc|Alias]]"\n  - "[[Doc#Section]]"',
    { related: ['[[Doc|Alias]]', '[[Doc#Section]]'] }],
  ['wikilink scalar is not mistaken for a flow sequence',
    'related: [[Some Note]]',
    'related: "[[Some Note]]"',
    { related: '[[Some Note]]' }],

  // --- items that must stay quoted or they change TYPE on re-read ----------
  ['numeric-looking item stays quoted',
    'tags:\n  - "2026"', 'tags:\n  - "2026"', { tags: ['2026'] }],
  ['boolean-looking item stays quoted',
    'tags:\n  - "no"', 'tags:\n  - "no"', { tags: ['no'] }],
  ['date-looking item stays quoted',
    'tags:\n  - "2026-08-17"', 'tags:\n  - "2026-08-17"', { tags: ['2026-08-17'] }],
  ['item with colon-space stays quoted',
    'tags:\n  - "Ratio: 3"', 'tags:\n  - "Ratio: 3"', { tags: ['Ratio: 3'] }],
  ['mixed link + plain array',
    'related:\n  - "[[Doc A]]"\n  - plain-tag',
    'related:\n  - "[[Doc A]]"\n  - plain-tag',
    { related: ['[[Doc A]]', 'plain-tag'] }],

  // --- the deliberate scalar rule must NOT regress -------------------------
  // URLs carry ?, =, &, # and are quoted unconditionally on purpose.
  ['URL scalar stays quoted',
    'og_image: https://example.com/a?b=1&c=2#d',
    'og_image: "https://example.com/a?b=1&c=2#d"',
    { og_image: 'https://example.com/a?b=1&c=2#d' }],
  ['date scalar stays quoted',
    'date_created: 2026-08-17',
    'date_created: "2026-08-17"',
    { date_created: '2026-08-17' }],
];

let pass = 0;
const failures = [];

for (const [name, input, expectedOutput, expectedObject] of cases) {
  const problems = [];

  const parsed = extractFrontmatter(wrap(input));
  if (JSON.stringify(parsed) !== JSON.stringify(expectedObject)) {
    problems.push(`parse    got ${JSON.stringify(parsed)}\n                 want ${JSON.stringify(expectedObject)}`);
  }

  const emitted = formatFrontmatter(parsed);
  if (emitted !== expectedOutput) {
    problems.push(`emit     got ${JSON.stringify(emitted)}\n                 want ${JSON.stringify(expectedOutput)}`);
  }

  // Writing our own output back in must be a fixed point — otherwise every
  // fetch churns the file a little more.
  const reparsed = extractFrontmatter(wrap(emitted));
  if (JSON.stringify(reparsed) !== JSON.stringify(expectedObject)) {
    problems.push(`idempotence  got ${JSON.stringify(reparsed)}`);
  }

  if (yaml) {
    try {
      const viaYaml = yaml.load(emitted);
      if (JSON.stringify(viaYaml) !== JSON.stringify(expectedObject)) {
        problems.push(`js-yaml  got ${JSON.stringify(viaYaml)}\n                 want ${JSON.stringify(expectedObject)}`);
      }
    } catch (error) {
      problems.push(`js-yaml  threw ${error.reason || error.message}`);
    }
  }

  if (problems.length === 0) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}`);
    for (const problem of problems) console.log(`        ${problem}`);
  }
}

rmSync(work, { recursive: true, force: true });

console.log(`\n${pass} passed, ${failures.length} failed`);
process.exit(failures.length > 0 ? 1 : 0);
