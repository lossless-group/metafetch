// Book recipes: Open Library (exact, then loose) and Google Books, looked up
// by a note's title and first author rather than its URL; the `[~regex]` path
// filter, `{{fm.<key>}}` variables, title matching, and a profile field's
// `format`. No network: requestUrl is the stub.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TFile } from 'obsidian';
import type { App } from 'obsidian';
import {
    ALL_BUNDLED_RECIPES, callData, frontmatterVars, mainTitle, matchKey, readPath, type ProviderSettings,
} from '../src/services/modelRecipes';
import { defaultProviderSettings } from '../src/services/modelProviderSettings';
import { formatRecipeValue, parseProfile } from '../src/services/frontmatterProfiles';
import { booksProfile, fetchBookDetails, fillFromProfile, type FillOptions } from '../src/commands/fillFromProfile';
import { extractFrontmatter, withFrontmatter } from '../src/utils/yamlFrontmatter';

interface Sent { url: string }

function serve(handler: (req: Sent) => { status?: number; json?: unknown }): Sent[] {
    const sent: Sent[] = [];
    (globalThis as { __requestUrl?: unknown }).__requestUrl = (req: Sent) => {
        sent.push(req);
        const r = handler(req);
        return { status: r.status ?? 200, headers: {}, text: JSON.stringify(r.json ?? {}), json: r.json ?? null, arrayBuffer: new ArrayBuffer(0) };
    };
    return sent;
}

const recipe = (id: string) => ALL_BUNDLED_RECIPES.find(r => r.id === id)!;
const providers = (): Record<string, ProviderSettings> => defaultProviderSettings();
const noKeys = () => null;

const CHIP_WAR = {
    key: '/works/OL27846746W',
    title: 'Chip War',
    author_name: ['Chris Miller'],
    first_publish_year: 2022,
    isbn: ['9786075696324', '1982172002', '9781982172008'],
    id_goodreads: ['60321447'],
    editions: { docs: [{ key: '/books/OL1M', publisher: ['Scribner'], isbn: ['1982172010', '9781982172015'] }] },
};

describe('reading book records', () => {
    test('[~regex] takes the first element whose text matches', () => {
        const isbns = ['1982172010', '9781982172015'];
        assert.equal(readPath({ isbns }, 'isbns[~^97\\d{11}$]'), '9781982172015');
        assert.equal(readPath({ isbns }, 'isbns[~^\\d{9}(\\d|X)$]'), '1982172010');
        assert.equal(readPath({ isbns }, 'isbns[~^0$]'), undefined);
    });

    test('titles match regardless of case, punctuation, and a run-on subtitle', () => {
        assert.equal(matchKey('A pattern language'), matchKey('A Pattern Language'));
        assert.equal(mainTitle('Blue Ocean Strategy: How to Create Uncontested Market Space'), 'Blue Ocean Strategy');
        assert.equal(mainTitle('Playing To Win  - How Strategy Really Works'), 'Playing To Win');
        assert.equal(mainTitle('Decisive. How To Make Better Choices'), 'Decisive');
        assert.equal(mainTitle('The Mythical Man-Month'), 'The Mythical Man-Month');
    });

    test('{{fm.<key>}} is the first author, as text, from a wikilink or a name map; a missing key is empty', () => {
        const r = recipe('open-library');
        assert.equal(frontmatterVars(r, { book_authors: ['[[People/Chris Miller|Chris Miller]]'] })['fm.book_authors'], 'Chris Miller');
        assert.equal(frontmatterVars(r, { book_authors: [{ name: 'B. Joseph Pine II', sort_as: 'Pine' }] })['fm.book_authors'], 'B. Joseph Pine II');
        assert.equal(frontmatterVars(r, {})['fm.book_authors'], '');
    });
});

describe('Open Library', () => {
    const run = (title: string, fm: Record<string, unknown>, id = 'open-library') =>
        callData({ recipe: recipe(id), recipes: ALL_BUNDLED_RECIPES, providers: providers(), getSecret: noKeys, note: { url: '', title, frontmatter: fm } });

    test('searched by main title and first author, with no key and no url; ISBNs and publisher from one edition', async () => {
        const sent = serve(() => ({ json: { docs: [CHIP_WAR] } }));
        const out = await run('Chip War: The Fight for the World\'s Most Critical Technology', { book_authors: ['Chris Miller'] });
        assert.equal(sent.length, 1);
        const url = new URL(sent[0]!.url);
        assert.equal(url.host, 'openlibrary.org');
        assert.equal(url.searchParams.get('q'), 'title:"Chip War" author:"Chris Miller"');
        assert.equal(out['isbn_13'], '9781982172015');
        assert.equal(out['isbn_10'], '1982172010');
        assert.equal(out['publisher'], 'Scribner');
        assert.equal(out['goodreads_id'], '60321447');
        assert.equal(out['first_publish_year'], 2022);
        assert.equal(out['work_key'], '/works/OL27846746W');
    });

    test('a result whose title differs is never kept', async () => {
        serve(() => ({ json: { docs: [{ ...CHIP_WAR, title: 'Chip War Summary' }] } }));
        assert.deepEqual(await run('Chip War', { book_authors: ['Chris Miller'] }), {});
    });

    test('the loose search prefers an English-language ISBN-13, and gives no ISBN-10, which could be from another printing', async () => {
        const sent = serve(() => ({ json: { docs: [CHIP_WAR] } }));
        const out = await run('Chip War', { book_authors: ['Chris Miller'] }, 'open-library-loose');
        assert.equal(new URL(sent[0]!.url).searchParams.get('author'), 'Chris Miller');
        assert.equal(out['isbn_13'], '9781982172008');
        assert.equal(out['isbn_10'], undefined);
    });

    test('Google Books needs a key, and says where to set it', async () => {
        serve(() => ({ json: {} }));
        await assert.rejects(run('Chip War', {}, 'google-books'), /no API key/);
    });
});

describe('the Books profile', () => {
    const PROFILE = `---
applies-to-paths: ["Sources/Books/**"]
---
\`\`\`metafetch-profile
fields:
  isbn_13: { from: [open-library, open-library-loose], value: isbn_13, aliases: [isbn] }
  publisher: { from: [open-library], value: publisher }
  goodreads_url: { from: [open-library], value: goodreads_id, format: "https://www.goodreads.com/book/show/{{value}}" }
  google_books_url: { from: [google-books], value: google_books_url }
\`\`\`
`;

    test('format wraps the value; a format without {{value}} is a problem', () => {
        const p = parseProfile(PROFILE, 'p.md')!;
        const gr = p.fields.find(f => f.key === 'goodreads_url')!;
        assert.equal(formatRecipeValue(gr, '123'), 'https://www.goodreads.com/book/show/123');
        const bad = parseProfile(PROFILE.replace('{{value}}', ''), 'p.md')!;
        assert.match(bad.problems.join(), /format needs \{\{value\}\}/);
    });

    test('fills a note with no url: one Open Library call, set fields untouched, the missing key reported', async () => {
        const files: Record<string, string> = {
            'zz-cf-lib/frontmatter/books.md': PROFILE,
            'Sources/Books/Chip War.md': '---\ntitle: Chip War\npublisher: Simon & Schuster\nbook_authors:\n  - Chris Miller\n---\nBody\n',
        };
        const objs = Object.keys(files).map(path => Object.assign(new TFile(), { path, basename: path.split('/').pop()!.replace(/\.md$/, ''), parent: { path: path.split('/').slice(0, -1).join('/') } }));
        const app = {
            workspace: { getActiveFile: () => objs[1] },
            vault: {
                getMarkdownFiles: () => objs,
                cachedRead: (f: { path: string }) => Promise.resolve(files[f.path] ?? ''),
                read: (f: { path: string }) => Promise.resolve(files[f.path] ?? ''),
            },
            fileManager: {
                processFrontMatter: (f: { path: string }, fn: (fm: Record<string, unknown>) => void) => {
                    const fm = extractFrontmatter(files[f.path] ?? '') ?? {};
                    fn(fm);
                    files[f.path] = withFrontmatter(files[f.path] ?? '', fm);
                    return Promise.resolve();
                },
            },
        } as unknown as App;
        const sent = serve(() => ({ json: { docs: [CHIP_WAR] } }));
        const options: FillOptions = { profilesRoot: 'zz-cf-lib/frontmatter', recipes: ALL_BUNDLED_RECIPES, providers: providers(), defaultModelProvider: 'anthropic', getSecret: noKeys };
        await fillFromProfile(app, options, ps => Promise.resolve(ps[0] ?? null));
        assert.equal(sent.length, 1);
        const fm = extractFrontmatter(files['Sources/Books/Chip War.md']!)!;
        assert.equal(fm['isbn_13'], '9781982172015');
        assert.equal(fm['goodreads_url'], 'https://www.goodreads.com/book/show/60321447');
        assert.equal(fm['publisher'], 'Simon & Schuster');
        assert.equal(fm['google_books_url'], undefined);
    });
});

describe('Fetch book reference details for frontmatter', () => {
    function vault(files: Record<string, string>, active: string) {
        const objs = Object.keys(files).map(path => Object.assign(new TFile(), { path, basename: path.split('/').pop()!.replace(/\.md$/, ''), parent: { path: path.split('/').slice(0, -1).join('/') } }));
        const app = {
            workspace: { getActiveFile: () => objs.find(o => o.path === active) },
            vault: {
                getMarkdownFiles: () => objs,
                getAbstractFileByPath: (p: string) => objs.find(o => o.path === p) ?? null,
                cachedRead: (f: { path: string }) => Promise.resolve(files[f.path] ?? ''),
                read: (f: { path: string }) => Promise.resolve(files[f.path] ?? ''),
            },
            fileManager: {
                processFrontMatter: (f: { path: string }, fn: (fm: Record<string, unknown>) => void) => {
                    const fm = extractFrontmatter(files[f.path] ?? '') ?? {};
                    fn(fm);
                    files[f.path] = withFrontmatter(files[f.path] ?? '', fm);
                    return Promise.resolve();
                },
            },
        } as unknown as App;
        return app;
    }
    const options: FillOptions = { profilesRoot: 'zz-cf-lib/frontmatter', recipes: ALL_BUNDLED_RECIPES, providers: providers(), defaultModelProvider: 'anthropic', getSecret: noKeys };
    const NOTE = '---\ntitle: Chip War\nbook_authors:\n  - Chris Miller\n---\n';

    test('works on a note in any folder, with nothing in the vault: the bundled profile', async () => {
        const files: Record<string, string> = { 'Reading/Chip War.md': NOTE };
        serve(() => ({ json: { docs: [CHIP_WAR] } }));
        await fetchBookDetails(vault(files, 'Reading/Chip War.md'), options);
        const fm = extractFrontmatter(files['Reading/Chip War.md']!)!;
        assert.equal(fm['isbn_13'], '9781982172015');
        assert.equal(fm['year_first_published'], 2022);
        assert.equal(fm['goodreads_url'], 'https://www.goodreads.com/book/show/60321447');
        assert.equal(fm['open_library_url'], 'https://openlibrary.org/works/OL27846746W');
    });

    test('a books.md in the profiles folder takes the bundled one\'s place', async () => {
        const files: Record<string, string> = {
            'zz-cf-lib/frontmatter/books.md': '---\napplies-to-paths: ["Sources/Books/**"]\n---\n```metafetch-profile\nfields:\n  isbn: { from: [open-library], value: isbn_13 }\n```\n',
            'Reading/Chip War.md': NOTE,
        };
        serve(() => ({ json: { docs: [CHIP_WAR] } }));
        assert.equal((await booksProfile(vault(files, 'Reading/Chip War.md'), 'zz-cf-lib/frontmatter')).fields.length, 1);
        await fetchBookDetails(vault(files, 'Reading/Chip War.md'), options);
        const fm = extractFrontmatter(files['Reading/Chip War.md']!)!;
        assert.equal(fm['isbn'], '9781982172015');
        assert.equal(fm['isbn_13'], undefined);
    });
});
