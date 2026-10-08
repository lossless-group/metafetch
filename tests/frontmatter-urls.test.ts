// Guards src/utils/frontmatterUrls.ts: finding fetchable URLs in a note.
//
// The cases that matter are the exclusions. A source note that has already
// been fetched carries og_image and og_favicon URLs, and offering those as
// fetch targets would be worse than useless.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { collectFrontmatterUrls } from '../src/utils/frontmatterUrls';

// Defaults from settings.ts: what main.ts passes as the exclusion list.
const EXCLUDE = ['og_image', 'og_favicon'];

type Expected = Array<[string, string]>;

interface Case {
    name: string;
    frontmatter: Record<string, unknown> | null;
    exclude: string[];
    expected: Expected;
}

const cases: Case[] = [
    {
        name: 'plain url property',
        frontmatter: { url: 'https://example.com/post' },
        exclude: EXCLUDE,
        expected: [['url', 'https://example.com/post']],
    },
    {
        name: 'journal-keyed property is found',
        frontmatter: { arxiv: 'https://arxiv.org/abs/2604.27891' },
        exclude: EXCLUDE,
        expected: [['arxiv', 'https://arxiv.org/abs/2604.27891']],
    },
    {
        name: 'several journals in one note, in frontmatter order',
        frontmatter: { arxiv: 'https://arxiv.org/abs/1', ssrn: 'https://ssrn.com/2', techcrunch: 'https://techcrunch.com/3' },
        exclude: EXCLUDE,
        expected: [['arxiv', 'https://arxiv.org/abs/1'], ['ssrn', 'https://ssrn.com/2'], ['techcrunch', 'https://techcrunch.com/3']],
    },
    {
        name: 'metafetch output is excluded by field name',
        frontmatter: { url: 'https://example.com/post', og_image: 'https://cdn.example.com/card', og_favicon: 'https://example.com/fav' },
        exclude: EXCLUDE,
        expected: [['url', 'https://example.com/post']],
    },
    {
        name: 'image URLs excluded by extension even under a renamed field',
        frontmatter: { url: 'https://example.com/post', banner: 'https://cdn.example.com/card.jpg', icon: 'https://example.com/favicon.ico' },
        exclude: EXCLUDE,
        expected: [['url', 'https://example.com/post']],
    },
    {
        name: 'image extension with a query string still excluded',
        frontmatter: { hero: 'https://cdn.example.com/x.png?v=2' },
        exclude: EXCLUDE,
        expected: [],
    },
    {
        name: 'array values are enumerated with an index',
        frontmatter: { mirrors: ['https://arxiv.org/abs/1', 'https://arxiv.org/pdf/1'] },
        exclude: EXCLUDE,
        expected: [['mirrors[0]', 'https://arxiv.org/abs/1'], ['mirrors[1]', 'https://arxiv.org/pdf/1']],
    },
    {
        name: 'non-URL values are ignored',
        frontmatter: { title: 'Some Paper', tags: ['ai', 'agents'], year: 2026, doi: '10.1234/abcd', url: 'https://example.com' },
        exclude: EXCLUDE,
        expected: [['url', 'https://example.com']],
    },
    {
        name: 'http is accepted, other schemes are not',
        frontmatter: { a: 'http://example.com', b: 'ftp://example.com', c: 'mailto:x@example.com', d: 'obsidian://open' },
        exclude: EXCLUDE,
        expected: [['a', 'http://example.com']],
    },
    {
        name: 'whitespace is trimmed',
        frontmatter: { url: '  https://example.com/post  ' },
        exclude: EXCLUDE,
        expected: [['url', 'https://example.com/post']],
    },
    {
        name: 'same URL under two properties keeps both: that is informative',
        frontmatter: { url: 'https://example.com/x', canonical: 'https://example.com/x' },
        exclude: EXCLUDE,
        expected: [['url', 'https://example.com/x'], ['canonical', 'https://example.com/x']],
    },
    {
        name: 'no frontmatter at all',
        frontmatter: null,
        exclude: EXCLUDE,
        expected: [],
    },
    {
        name: 'frontmatter with no URLs',
        frontmatter: { title: 'Note', tags: ['a'] },
        exclude: EXCLUDE,
        expected: [],
    },
];

describe('collectFrontmatterUrls', () => {
    for (const { name, frontmatter, exclude, expected } of cases) {
        test(name, () => {
            const got = collectFrontmatterUrls(frontmatter, exclude).map((entry): [string, string] => [entry.key, entry.url]);
            assert.deepEqual(got, expected);
        });
    }

    // `property` strips the array index so callers can group or prefix by source.
    test('array entry exposes bare property alongside indexed key', () => {
        const arrayEntry = collectFrontmatterUrls({ mirrors: ['https://a.example'] }, EXCLUDE)[0];
        assert.equal(arrayEntry?.property, 'mirrors');
        assert.equal(arrayEntry?.key, 'mirrors[0]');
    });
});
