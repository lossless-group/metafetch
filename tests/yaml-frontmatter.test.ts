// Round-trip tests for src/utils/yamlFrontmatter.ts
//
// Metafetch rewrites the ENTIRE frontmatter block on every fetch/insert, not
// just the og_* keys it owns. So the parse -> serialize round trip has to be
// lossless for keys metafetch has no business touching (tags, authors,
// related). These cases pin the behavior fixed in 0.1.7.
//
// There is no test framework here on purpose: the util has no runtime deps
// and this keeps it that way. If js-yaml happens to be installed, each case
// also asserts that a REAL YAML parser reads our output the way we intend;
// without it those assertions are skipped rather than failing.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { extractFrontmatter, formatFrontmatter } from '../src/utils/yamlFrontmatter';

interface YamlParser {
    load(text: string): unknown;
}

// Optional dependency. The specifier is a variable so esbuild leaves it as a
// runtime import instead of failing the bundle when js-yaml is absent.
const yamlSpecifier = 'js-yaml';
let yaml: YamlParser | null = null;
try {
    const mod = (await import(yamlSpecifier)) as { default?: YamlParser } & Partial<YamlParser>;
    yaml = mod.default ?? (typeof mod.load === 'function' ? (mod as YamlParser) : null);
} catch {
    console.log('note: js-yaml not installed, skipping real-YAML agreement checks\n');
}

const wrap = (body: string): string => `---\n${body}\n---\nbody text`;

interface Case {
    name: string;
    input: string;
    expectedOutput: string;
    expectedObject: unknown;
}

const cases: Case[] = [
    // --- the reported bug: array items were unconditionally quoted -----------
    {
        name: 'block tags emit bare',
        input: 'tags:\n  - augmented-intelligence\n  - ai',
        expectedOutput: 'tags:\n  - augmented-intelligence\n  - ai',
        expectedObject: { tags: ['augmented-intelligence', 'ai'] },
    },
    {
        name: 'Train-Case tags emit bare',
        input: 'tags:\n  - Markdown-Rendering\n  - Issue-Resolution',
        expectedOutput: 'tags:\n  - Markdown-Rendering\n  - Issue-Resolution',
        expectedObject: { tags: ['Markdown-Rendering', 'Issue-Resolution'] },
    },

    // --- inline flow sequences used to become a quoted STRING ----------------
    {
        name: 'inline array parses, emits as block',
        input: 'tags: [augmented-intelligence, ai]',
        expectedOutput: 'tags:\n  - augmented-intelligence\n  - ai',
        expectedObject: { tags: ['augmented-intelligence', 'ai'] },
    },
    {
        name: 'inline array splits on commas outside quotes',
        input: 'tags: ["a, b", c]',
        expectedOutput: 'tags:\n  - "a, b"\n  - c',
        expectedObject: { tags: ['a, b', 'c'] },
    },
    {
        name: 'empty inline array',
        input: 'tags: []',
        expectedOutput: 'tags: []',
        expectedObject: { tags: [] },
    },

    // --- wikilinks: quoting is REQUIRED, not cosmetic ------------------------
    // Unquoted, a real YAML parser reads [[Ada Lovelace]] as [["Ada Lovelace"]].
    {
        name: 'wikilink item keeps its quotes',
        input: 'authors:\n  - "[[Ada Lovelace]]"',
        expectedOutput: 'authors:\n  - "[[Ada Lovelace]]"',
        expectedObject: { authors: ['[[Ada Lovelace]]'] },
    },
    {
        name: 'unquoted wikilink item gains quotes',
        input: 'authors:\n  - [[Ada Lovelace]]',
        expectedOutput: 'authors:\n  - "[[Ada Lovelace]]"',
        expectedObject: { authors: ['[[Ada Lovelace]]'] },
    },
    {
        name: 'wikilink alias and heading forms survive',
        input: 'related:\n  - "[[Doc|Alias]]"\n  - "[[Doc#Section]]"',
        expectedOutput: 'related:\n  - "[[Doc|Alias]]"\n  - "[[Doc#Section]]"',
        expectedObject: { related: ['[[Doc|Alias]]', '[[Doc#Section]]'] },
    },
    {
        name: 'wikilink scalar is not mistaken for a flow sequence',
        input: 'related: [[Some Note]]',
        expectedOutput: 'related: "[[Some Note]]"',
        expectedObject: { related: '[[Some Note]]' },
    },

    // --- items that must stay quoted or they change TYPE on re-read ----------
    {
        name: 'numeric-looking item stays quoted',
        input: 'tags:\n  - "2026"',
        expectedOutput: 'tags:\n  - "2026"',
        expectedObject: { tags: ['2026'] },
    },
    {
        name: 'boolean-looking item stays quoted',
        input: 'tags:\n  - "no"',
        expectedOutput: 'tags:\n  - "no"',
        expectedObject: { tags: ['no'] },
    },
    {
        name: 'date-looking item stays quoted',
        input: 'tags:\n  - "2026-08-17"',
        expectedOutput: 'tags:\n  - "2026-08-17"',
        expectedObject: { tags: ['2026-08-17'] },
    },
    {
        name: 'item with colon-space stays quoted',
        input: 'tags:\n  - "Ratio: 3"',
        expectedOutput: 'tags:\n  - "Ratio: 3"',
        expectedObject: { tags: ['Ratio: 3'] },
    },
    {
        name: 'mixed link + plain array',
        input: 'related:\n  - "[[Doc A]]"\n  - plain-tag',
        expectedOutput: 'related:\n  - "[[Doc A]]"\n  - plain-tag',
        expectedObject: { related: ['[[Doc A]]', 'plain-tag'] },
    },

    // --- the deliberate scalar rule must NOT regress -------------------------
    // URLs carry ?, =, &, # and are quoted unconditionally on purpose.
    {
        name: 'URL scalar stays quoted',
        input: 'og_image: https://example.com/a?b=1&c=2#d',
        expectedOutput: 'og_image: "https://example.com/a?b=1&c=2#d"',
        expectedObject: { og_image: 'https://example.com/a?b=1&c=2#d' },
    },
    {
        name: 'date scalar stays quoted',
        input: 'date_created: 2026-08-17',
        expectedOutput: 'date_created: "2026-08-17"',
        expectedObject: { date_created: '2026-08-17' },
    },
];

describe('yamlFrontmatter round trip', () => {
    for (const { name, input, expectedOutput, expectedObject } of cases) {
        test(name, () => {
            const parsed = extractFrontmatter(wrap(input));
            assert.deepEqual(parsed, expectedObject, 'parse');

            const emitted = formatFrontmatter(parsed ?? {});
            assert.equal(emitted, expectedOutput, 'emit');

            // Writing our own output back in must be a fixed point, otherwise
            // every fetch churns the file a little more.
            assert.deepEqual(extractFrontmatter(wrap(emitted)), expectedObject, 'idempotence');

            if (yaml) {
                assert.deepEqual(yaml.load(emitted), expectedObject, 'js-yaml agreement');
            }
        });
    }
});
