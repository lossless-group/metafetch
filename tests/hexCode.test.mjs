/**
 * Tests for src/utils/hexCode.ts — vault-wide identity codes.
 *
 * The properties that matter are (a) the alphabet really is 36 characters, not
 * 16 — that's the whole reason these aren't hexadecimal — (b) a code already in
 * use is never handed out again, and (c) an existing code is never overwritten.
 *
 * Run: pnpm test
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const work = mkdtempSync(join(tmpdir(), 'metafetch-hex-'));
const bundle = join(work, 'hexCode.mjs');
const stub = join(work, 'obsidian-stub.mjs');
writeFileSync(stub, 'export {};\n');

execFileSync('npx', [
  'esbuild', 'src/utils/hexCode.ts',
  '--bundle', '--format=esm', `--alias:obsidian=${stub}`, `--outfile=${bundle}`,
], { stdio: 'pipe' });

const { generateHexCode, collectExistingHexCodes, mintUniqueHexCode, stampIdentityCode } =
  await import(pathToFileURL(bundle).href);

let pass = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`);
  }
}

/** Minimal stand-in for the slice of the Obsidian App this module touches. */
function fakeApp(frontmatterByFile) {
  const files = Object.keys(frontmatterByFile).map((path) => ({ path }));
  return {
    vault: { getMarkdownFiles: () => files },
    metadataCache: {
      getFileCache: (file) => ({ frontmatter: frontmatterByFile[file.path] }),
    },
  };
}

// --- alphabet and shape --------------------------------------------------
const sample = Array.from({ length: 2000 }, () => generateHexCode(6));

check('default length is 6', sample.every((c) => c.length === 6));
check('only lowercase alphanumerics', sample.every((c) => /^[a-z0-9]+$/.test(c)));
check('honours a requested length', generateHexCode(12).length === 12);

// The point of the wider alphabet: letters past 'f' must actually appear.
// With 2000x6 = 12000 characters, seeing every one of the 36 is a near
// certainty; seeing none past 'f' would mean we'd silently become hex.
const observed = new Set(sample.join(''));
const beyondHex = [...observed].filter((c) => /[g-z]/.test(c));
check('uses the full 36-character alphabet, not just hex digits',
  observed.size === 36,
  `saw ${observed.size} distinct characters, ${beyondHex.length} of them beyond [0-9a-f]`);

// Not a randomness test — just a smoke check that we aren't emitting constants.
check('does not repeat itself trivially', new Set(sample).size > 1990,
  `${new Set(sample).size} distinct out of ${sample.length}`);

// --- collision avoidance -------------------------------------------------
const crowded = new Set(sample);
const fresh = mintUniqueHexCode(crowded, 6);
check('mints a code not already in the set', !crowded.has(fresh));

// Exhaust a tiny space so the uniqueness path is genuinely exercised: with
// length 1 there are only 36 possibilities, and we block 35 of them.
const almostAll = new Set('abcdefghijklmnopqrstuvwxyz0123456789'.slice(0, 35).split(''));
const onlyOneLeft = mintUniqueHexCode(almostAll, 1);
check('finds the one remaining code in a nearly-exhausted space',
  onlyOneLeft === '9', `got ${JSON.stringify(onlyOneLeft)}`);

// When the space really is exhausted it widens rather than spinning forever.
const allTaken = new Set('abcdefghijklmnopqrstuvwxyz0123456789'.split(''));
const widened = mintUniqueHexCode(allTaken, 1);
check('widens by one character when the space is exhausted', widened.length === 2);

// --- reading existing codes from the vault -------------------------------
const app = fakeApp({
  'a.md': { hex_code: 'aaa111' },
  'b.md': { hex_code: 'bbb222' },
  'c.md': { title: 'no code here' },
  'd.md': undefined,
  'e.md': { hex_code: ['ccc333', 'ddd444'] }, // tolerate a list-valued field
});

const existing = collectExistingHexCodes(app, 'hex_code');
check('collects every code in the vault',
  ['aaa111', 'bbb222', 'ccc333', 'ddd444'].every((c) => existing.has(c)) && existing.size === 4,
  `got ${JSON.stringify([...existing])}`);

check('respects a renamed field', collectExistingHexCodes(app, 'uuid').size === 0);

// --- stamping policy -----------------------------------------------------
const enabled = { stampHexCode: true, hexCodeFieldName: 'hex_code', hexCodeLength: 6 };
const disabled = { ...enabled, stampHexCode: false };

const offNote = {};
stampIdentityCode(app, offNote, disabled);
check('does nothing when the option is off', offNote.hex_code === undefined);

const newNote = {};
stampIdentityCode(app, newNote, enabled);
check('stamps a code on a note without one',
  typeof newNote.hex_code === 'string' && /^[a-z0-9]{6}$/.test(newNote.hex_code));
check('never reuses a code already in the vault', !existing.has(newNote.hex_code));

// Write-once: the whole value of the code is that references to it don't rot.
const alreadyCoded = { hex_code: 'keepme' };
stampIdentityCode(app, alreadyCoded, enabled);
check('never overwrites an existing code', alreadyCoded.hex_code === 'keepme');

const emptyString = { hex_code: '' };
stampIdentityCode(app, emptyString, enabled);
check('treats an empty code as missing and fills it', emptyString.hex_code !== '');

// Batch safety: the metadata cache lags vault writes, so a run-scoped set has
// to stand in for codes minted seconds ago.
const run = new Set();
const batch = Array.from({ length: 200 }, () => {
  const fm = {};
  stampIdentityCode(app, fm, enabled, run);
  return fm.hex_code;
});
check('a batch never issues the same code twice', new Set(batch).size === batch.length,
  `${new Set(batch).size} distinct out of ${batch.length}`);
check('the run-scoped set accumulates every minted code', run.size === batch.length);

const honoursLength = {};
stampIdentityCode(app, honoursLength, { ...enabled, hexCodeLength: 10 });
check('honours a configured length', honoursLength.hex_code.length === 10);

const renamedField = {};
stampIdentityCode(app, renamedField, { ...enabled, hexCodeFieldName: 'site_uuid' });
check('honours a renamed field',
  typeof renamedField.site_uuid === 'string' && renamedField.hex_code === undefined);

rmSync(work, { recursive: true, force: true });

console.log(`\n${pass} passed, ${failures.length} failed`);
process.exit(failures.length > 0 ? 1 : 0);
