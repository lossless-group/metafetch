// Guards src/utils/hexCode.ts: vault-wide identity codes.
//
// The properties that matter are (a) the alphabet really is 36 characters, not
// 16 (that's the whole reason these aren't hexadecimal), (b) a code already in
// use is never handed out again, and (c) an existing code is never overwritten.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { App } from 'obsidian';
import {
    generateHexCode,
    collectExistingHexCodes,
    mintUniqueHexCode,
    stampIdentityCode,
    type HexCodeSettings,
} from '../src/utils/hexCode';

interface FakeFile {
    path: string;
}

/** Minimal stand-in for the slice of the Obsidian App this module touches. */
function fakeApp(frontmatterByFile: Record<string, Record<string, unknown> | undefined>): App {
    const files: FakeFile[] = Object.keys(frontmatterByFile).map((path) => ({ path }));
    const fake = {
        vault: { getMarkdownFiles: (): FakeFile[] => files },
        metadataCache: {
            getFileCache: (file: FakeFile) => ({ frontmatter: frontmatterByFile[file.path] }),
        },
    };
    return fake as unknown as App;
}

const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'.split('');

describe('alphabet and shape', () => {
    const sample = Array.from({ length: 2000 }, () => generateHexCode(6));

    test('default length is 6', () => {
        assert.ok(sample.every((c) => c.length === 6));
    });

    test('only lowercase alphanumerics', () => {
        assert.ok(sample.every((c) => /^[a-z0-9]+$/.test(c)));
    });

    test('honours a requested length', () => {
        assert.equal(generateHexCode(12).length, 12);
    });

    // The point of the wider alphabet: letters past 'f' must actually appear.
    // With 2000x6 = 12000 characters, seeing every one of the 36 is a near
    // certainty; seeing none past 'f' would mean we'd silently become hex.
    test('uses the full 36-character alphabet, not just hex digits', () => {
        const observed = new Set(sample.join(''));
        const beyondHex = [...observed].filter((c) => /[g-z]/.test(c));
        assert.equal(
            observed.size,
            36,
            `saw ${observed.size} distinct characters, ${beyondHex.length} of them beyond [0-9a-f]`,
        );
    });

    // Not a randomness test, just a smoke check that we aren't emitting constants.
    test('does not repeat itself trivially', () => {
        assert.ok(new Set(sample).size > 1990, `${new Set(sample).size} distinct out of ${sample.length}`);
    });
});

describe('collision avoidance', () => {
    test('mints a code not already in the set', () => {
        const crowded = new Set(Array.from({ length: 2000 }, () => generateHexCode(6)));
        const fresh = mintUniqueHexCode(crowded, 6);
        assert.ok(!crowded.has(fresh));
    });

    // Squeeze a tiny space so the uniqueness path is genuinely exercised: with
    // length 1 there are only 36 possibilities, and we block half of them.
    //
    // Deliberately half and not 35-of-36. Minting retries a bounded number of
    // times before widening the code by a character, so blocking all but one slot
    // makes the outcome depend on retry luck: the widen path legitimately fires
    // about a quarter of the time. Half leaves the odds of a spurious failure at
    // roughly 2^-50, while still proving the real property: a taken code is never
    // handed out.
    test('never returns a code that is already taken', () => {
        const halfTaken = new Set(alphabet.slice(0, 18));
        const fromSqueezedSpace = mintUniqueHexCode(halfTaken, 1);
        assert.ok(
            !halfTaken.has(fromSqueezedSpace) && alphabet.includes(fromSqueezedSpace),
            `got ${JSON.stringify(fromSqueezedSpace)}`,
        );
    });

    // When the space really is exhausted it widens rather than spinning forever.
    test('widens by one character when the space is exhausted', () => {
        const allTaken = new Set(alphabet);
        assert.equal(mintUniqueHexCode(allTaken, 1).length, 2);
    });
});

describe('reading existing codes from the vault', () => {
    const app = fakeApp({
        'a.md': { hex_code: 'aaa111' },
        'b.md': { hex_code: 'bbb222' },
        'c.md': { title: 'no code here' },
        'd.md': undefined,
        'e.md': { hex_code: ['ccc333', 'ddd444'] }, // tolerate a list-valued field
    });

    test('collects every code in the vault', () => {
        const existing = collectExistingHexCodes(app, 'hex_code');
        assert.ok(
            ['aaa111', 'bbb222', 'ccc333', 'ddd444'].every((c) => existing.has(c)) && existing.size === 4,
            `got ${JSON.stringify([...existing])}`,
        );
    });

    test('respects a renamed field', () => {
        assert.equal(collectExistingHexCodes(app, 'uuid').size, 0);
    });
});

describe('stamping policy', () => {
    const app = fakeApp({
        'a.md': { hex_code: 'aaa111' },
        'b.md': { hex_code: 'bbb222' },
        'c.md': { title: 'no code here' },
        'd.md': undefined,
        'e.md': { hex_code: ['ccc333', 'ddd444'] },
    });
    const existing = collectExistingHexCodes(app, 'hex_code');
    const enabled: HexCodeSettings = { stampHexCode: true, hexCodeFieldName: 'hex_code', hexCodeLength: 6 };
    const disabled: HexCodeSettings = { ...enabled, stampHexCode: false };

    test('does nothing when the option is off', () => {
        const offNote: Record<string, unknown> = {};
        stampIdentityCode(app, offNote, disabled);
        assert.equal(offNote.hex_code, undefined);
    });

    test('stamps a code on a note without one', () => {
        const newNote: Record<string, unknown> = {};
        stampIdentityCode(app, newNote, enabled);
        assert.ok(typeof newNote.hex_code === 'string' && /^[a-z0-9]{6}$/.test(newNote.hex_code));
    });

    test('never reuses a code already in the vault', () => {
        const newNote: Record<string, unknown> = {};
        stampIdentityCode(app, newNote, enabled);
        assert.ok(!existing.has(newNote.hex_code as string));
    });

    // Write-once: the whole value of the code is that references to it don't rot.
    test('never overwrites an existing code', () => {
        const alreadyCoded: Record<string, unknown> = { hex_code: 'keepme' };
        stampIdentityCode(app, alreadyCoded, enabled);
        assert.equal(alreadyCoded.hex_code, 'keepme');
    });

    test('treats an empty code as missing and fills it', () => {
        const emptyString: Record<string, unknown> = { hex_code: '' };
        stampIdentityCode(app, emptyString, enabled);
        assert.notEqual(emptyString.hex_code, '');
    });

    // Batch safety: the metadata cache lags vault writes, so a run-scoped set has
    // to stand in for codes minted seconds ago.
    const run = new Set<string>();
    const batch = Array.from({ length: 200 }, () => {
        const fm: Record<string, unknown> = {};
        stampIdentityCode(app, fm, enabled, run);
        return fm.hex_code as string;
    });

    test('a batch never issues the same code twice', () => {
        assert.equal(new Set(batch).size, batch.length, `${new Set(batch).size} distinct out of ${batch.length}`);
    });

    test('the run-scoped set accumulates every minted code', () => {
        assert.equal(run.size, batch.length);
    });

    test('honours a configured length', () => {
        const honoursLength: Record<string, unknown> = {};
        stampIdentityCode(app, honoursLength, { ...enabled, hexCodeLength: 10 });
        assert.equal((honoursLength.hex_code as string).length, 10);
    });

    test('honours a renamed field', () => {
        const renamedField: Record<string, unknown> = {};
        stampIdentityCode(app, renamedField, { ...enabled, hexCodeFieldName: 'site_uuid' });
        assert.ok(typeof renamedField.site_uuid === 'string' && renamedField.hex_code === undefined);
    });
});
