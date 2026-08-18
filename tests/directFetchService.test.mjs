/**
 * Tests for the scholarly-metadata helpers in src/services/directFetchService.ts.
 *
 * These are the pieces that made arXiv work: reading REPEATED meta tags
 * (one `citation_author` per author), flipping "Last, First" into "First Last",
 * and turning Highwire's slash dates into ISO.
 *
 * Pure functions only — no network. The live end-to-end check is a manual
 * probe against real URLs; see the source-note spec.
 *
 * Run: pnpm test
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const work = mkdtempSync(join(tmpdir(), 'metafetch-direct-'));
const bundle = join(work, 'directFetchService.mjs');

// Unlike the other units under test, this module imports `requestUrl` from
// obsidian at RUNTIME, so `--external` would leave an unresolvable import.
// The functions exercised here are pure, so the stub is never called.
const stub = join(work, 'obsidian-stub.mjs');
writeFileSync(stub, 'export function requestUrl() { throw new Error("network not used in these tests"); }\n');

execFileSync('npx', [
  'esbuild', 'src/services/directFetchService.ts',
  '--bundle', '--format=esm', `--alias:obsidian=${stub}`, `--outfile=${bundle}`,
], { stdio: 'pipe' });

const { getMetaAll, normalizeAuthorName, normalizeDate } =
  await import(pathToFileURL(bundle).href);

let pass = 0;
const failures = [];

function check(name, got, want) {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}`);
    console.log(`        got  ${JSON.stringify(got)}`);
    console.log(`        want ${JSON.stringify(want)}`);
  }
}

// --- getMetaAll: the repeated-tag problem -------------------------------
// Shaped like arXiv's actual markup.
const arxivish = `
<meta name="citation_title" content="An Empirical Study of Agent Developer Practices" />
<meta name="citation_author" content="Wang, Yanlin" />
<meta name="citation_author" content="Xu, Xinyi" />
<meta name="citation_author" content="Chen, Jiachi" />
<meta name="citation_date" content="2025/12/01" />
<meta property="og:type" content="website" />
`;

check('getMetaAll returns every repeated value in order',
  getMetaAll(arxivish, 'name', 'citation_author'),
  ['Wang, Yanlin', 'Xu, Xinyi', 'Chen, Jiachi']);

check('getMetaAll on a single-value tag',
  getMetaAll(arxivish, 'name', 'citation_date'), ['2025/12/01']);

check('getMetaAll returns empty for an absent tag',
  getMetaAll(arxivish, 'name', 'author'), []);

check('getMetaAll matches content-attribute-first ordering',
  getMetaAll('<meta content="Ada Lovelace" name="author">', 'name', 'author'),
  ['Ada Lovelace']);

check('getMetaAll de-duplicates identical values',
  getMetaAll('<meta name="author" content="Ada"><meta name="author" content="Ada">', 'name', 'author'),
  ['Ada']);

check('getMetaAll decodes HTML entities',
  getMetaAll('<meta name="author" content="Ben &amp; Jerry">', 'name', 'author'),
  ['Ben & Jerry']);

check('getMetaAll does not match a different tag with a shared prefix',
  getMetaAll(arxivish, 'name', 'citation_'), []);

// --- normalizeAuthorName: Last, First -> First Last ----------------------
check('flips Last, First', normalizeAuthorName('Dennis, Simon'), 'Simon Dennis');
check('flips with extra whitespace', normalizeAuthorName('  Wang ,  Yanlin '), 'Yanlin Wang');
check('leaves an already-natural name alone', normalizeAuthorName('Simon Dennis'), 'Simon Dennis');
check('leaves a mononym alone', normalizeAuthorName('Prince'), 'Prince');
check('does not flip a PhD suffix', normalizeAuthorName('Jane Doe, PhD'), 'Jane Doe, PhD');
check('does not flip Ph.D. with a period', normalizeAuthorName('Jane Doe, Ph.D.'), 'Jane Doe, Ph.D.');
check('does not flip a generational suffix', normalizeAuthorName('John Smith, Jr.'), 'John Smith, Jr.');
check('leaves a three-part comma string alone',
  normalizeAuthorName('Doe, Jane, PhD'), 'Doe, Jane, PhD');
check('leaves a dangling comma alone', normalizeAuthorName('Dennis,'), 'Dennis,');

// --- normalizeDate: Highwire slashes -> ISO ------------------------------
check('slash date to ISO', normalizeDate('2025/12/01'), '2025-12-01');
check('pads single-digit month and day', normalizeDate('2026/4/3'), '2026-04-03');
check('year-month only', normalizeDate('2026/04'), '2026-04');
check('ISO date passes through', normalizeDate('2026-08-17'), '2026-08-17');
check('ISO timestamp passes through untouched',
  normalizeDate('2026-08-17T21:27:05+00:00'), '2026-08-17T21:27:05+00:00');
check('unrecognized format passes through trimmed',
  normalizeDate('  17 August 2026 '), '17 August 2026');

rmSync(work, { recursive: true, force: true });

console.log(`\n${pass} passed, ${failures.length} failed`);
process.exit(failures.length > 0 ? 1 : 0);
