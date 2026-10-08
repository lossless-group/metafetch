// "Fill frontmatter from folder profile" end to end: a stubbed vault with a
// profile and a Tooling note, stubbed pages, and the note written back.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { TFile, TFolder, Notice } from 'obsidian';
import { fillFromProfile, createExampleProfile, siteRoot } from '../src/commands/fillFromProfile';
import { TOOLING_SOCIALS_PROFILE } from '../src/profiles/toolingSocials';
import type { App } from 'obsidian';
import { extractFrontmatter, withFrontmatter } from '../src/utils/yamlFrontmatter';

const ROOT = 'zz-cf-lib/frontmatter';

interface FakeFile { path: string; parent: { path: string } }

function makeVault(files: Record<string, string>, active: string) {
    const objs = new Map<string, FakeFile>();
    for (const path of Object.keys(files)) {
        const f = Object.assign(new TFile(), { path, parent: { path: path.split('/').slice(0, -1).join('/') } }) as unknown as FakeFile;
        objs.set(path, f);
    }
    const folders = new Set<string>();
    const app = {
        workspace: { getActiveFile: () => objs.get(active) ?? null },
        vault: {
            getMarkdownFiles: () => [...objs.values()],
            cachedRead: (f: FakeFile) => Promise.resolve(files[f.path] ?? ''),
            read: (f: FakeFile) => Promise.resolve(files[f.path] ?? ''),
            modify: (f: FakeFile, next: string) => { files[f.path] = next; return Promise.resolve(); },
            getAbstractFileByPath: (p: string) => objs.get(p) ?? (folders.has(p) ? new TFolder() : null),
            createFolder: (p: string) => { folders.add(p); return Promise.resolve(); },
            create: (p: string, data: string) => { files[p] = data; return Promise.resolve(); },
        },
        // Stand-in for Obsidian's processFrontMatter: parse, let the callback
        // edit, write back. Byte-preservation of untouched lines is
        // Obsidian's job and isn't modelled here.
        fileManager: {
            processFrontMatter: (f: FakeFile, fn: (fm: Record<string, unknown>) => void) => {
                const fm = extractFrontmatter(files[f.path] ?? '') ?? {};
                fn(fm);
                files[f.path] = withFrontmatter(files[f.path] ?? '', fm);
                return Promise.resolve();
            },
        },
    } as unknown as App;
    return { app, files };
}

function servePages(pages: Record<string, string>): string[] {
    const seen: string[] = [];
    (globalThis as { __requestUrl?: unknown }).__requestUrl = (req: { url: string }) => {
        seen.push(req.url);
        const text = pages[req.url];
        return { status: text === undefined ? 404 : 200, headers: { 'content-type': 'text/html' }, text: text ?? '', json: null, arrayBuffer: new ArrayBuffer(0) };
    };
    return seen;
}

const line = (note: string, key: string) => note.split('\n').find(l => l.startsWith(`${key}:`));
const noPick = () => Promise.resolve(null);

const TINA_HOME = `<html><head><title>Tina</title><meta property="og:site_name" content="Tina"><meta property="og:image" content="/og.png"></head><body>
<header><nav><a href="https://github.com/tinacms/tinacms">GitHub</a></nav></header>
<section class="customers"><a href="https://www.linkedin.com/company/some-customer">Customer</a></section>
<footer><a href="https://x.com/tinacms">X</a><a href="https://www.linkedin.com/company/tinacms">LinkedIn</a><a href="https://discord.com/invite/zumN63Ybpf">Discord</a></footer>
</body></html>`;

describe('Fill frontmatter from folder profile', () => {
    afterEach(() => { delete (globalThis as { __requestUrl?: unknown }).__requestUrl; Notice.shown.length = 0; });

    test("fills a Tooling note's socials from the homepage, leaving set fields and the body alone", async () => {
        const { app, files } = makeVault({
            [`${ROOT}/tooling-socials.md`]: TOOLING_SOCIALS_PROFILE,
            'Tooling/CMS/Tina.md': '---\nurl: "https://tina.io/"\nx_url: "https://x.com/kept"\ngithub_url: "https://github.com/hand/sorted"\n---\nBody stays.',
        }, 'Tooling/CMS/Tina.md');
        servePages({ 'https://tina.io/': TINA_HOME });

        await fillFromProfile(app, ROOT, noPick);
        const note = files['Tooling/CMS/Tina.md']!;
        assert.equal(line(note, 'github_profile_url'), 'github_profile_url: "https://github.com/tinacms"');
        assert.equal(line(note, 'github_repo_url'), 'github_repo_url: "https://github.com/tinacms/tinacms"');
        assert.equal(line(note, 'linkedin_url'), 'linkedin_url: "https://www.linkedin.com/company/tinacms"', "the company's own page, not the customer's");
        assert.equal(line(note, 'discord_url'), 'discord_url: "https://discord.gg/zumN63Ybpf"');
        assert.equal(line(note, 'og_image'), 'og_image: "https://tina.io/og.png"');
        assert.equal(line(note, 'x_url'), 'x_url: "https://x.com/kept"');
        assert.equal(line(note, 'github_url'), 'github_url: "https://github.com/hand/sorted"');
        assert.ok(note.endsWith('\nBody stays.'));
        assert.match(Notice.shown.at(-1) ?? '', /filled .*linkedin_url/);
    });

    test('a deep URL: page fields from the page, socials from the site root', async () => {
        const { app, files } = makeVault({
            [`${ROOT}/tooling-socials.md`]: TOOLING_SOCIALS_PROFILE,
            'Tooling/Tina.md': '---\nurl: "https://tina.io/docs/intro"\n---\n',
        }, 'Tooling/Tina.md');
        const seen = servePages({
            'https://tina.io/docs/intro': '<meta property="og:image" content="https://tina.io/docs-card.png"><title>Docs</title>',
            'https://tina.io/': TINA_HOME,
        });
        await fillFromProfile(app, ROOT, noPick);
        assert.deepEqual(seen, ['https://tina.io/docs/intro', 'https://tina.io/']);
        assert.equal(line(files['Tooling/Tina.md']!, 'og_image'), 'og_image: "https://tina.io/docs-card.png"');
        assert.equal(line(files['Tooling/Tina.md']!, 'x_url'), 'x_url: "https://x.com/tinacms"');
    });

    test('a note outside every profile: told so, nothing fetched', async () => {
        const { app } = makeVault({ [`${ROOT}/tooling-socials.md`]: TOOLING_SOCIALS_PROFILE, 'Essays/x.md': '---\nurl: "https://a.example/"\n---\n' }, 'Essays/x.md');
        const seen = servePages({});
        await fillFromProfile(app, ROOT, noPick);
        assert.deepEqual(seen, []);
        assert.match(Notice.shown.at(-1) ?? '', /no frontmatter profile/);
    });

    test('nothing found: the note is not rewritten', async () => {
        const note = '---\nurl: "https://plain.example/"\nog_favicon: "https://plain.example/f.svg"\n---\n';
        const { app, files } = makeVault({ [`${ROOT}/tooling-socials.md`]: TOOLING_SOCIALS_PROFILE, 'Tooling/P.md': note }, 'Tooling/P.md');
        servePages({ 'https://plain.example/': '<title>Plain</title><p>no links</p>' });
        await fillFromProfile(app, ROOT, noPick);
        assert.equal(files['Tooling/P.md'], note);
    });

    test('a bot-check page fills nothing from it', async () => {
        const note = '---\nurl: "https://blocked.example/"\n---\n';
        const { app, files } = makeVault({ [`${ROOT}/tooling-socials.md`]: TOOLING_SOCIALS_PROFILE, 'Tooling/B.md': note }, 'Tooling/B.md');
        servePages({ 'https://blocked.example/': '<title>Just a moment...</title><footer><a href="https://x.com/cloudflare">x</a></footer>' });
        await fillFromProfile(app, ROOT, noPick);
        assert.equal(files['Tooling/B.md'], note);
    });
});

describe('Create example frontmatter profile', () => {
    test('writes the Tooling socials profile once, never over an existing file', async () => {
        const { app, files } = makeVault({}, '');
        await createExampleProfile(app, ROOT);
        assert.equal(files[`${ROOT}/tooling-socials.md`], TOOLING_SOCIALS_PROFILE);

        const existing = makeVault({ [`${ROOT}/tooling-socials.md`]: 'my edits' }, '');
        await createExampleProfile(existing.app, ROOT);
        assert.equal(existing.files[`${ROOT}/tooling-socials.md`], 'my edits');
    });
});

test('siteRoot', () => {
    assert.equal(siteRoot('https://tina.io/docs/intro?x=1'), 'https://tina.io/');
    assert.equal(siteRoot('not a url'), null);
});

test('a blocked homepage contributes no socials, even when the deep page was readable', async () => {
    const { app, files } = makeVault({
        [`${ROOT}/tooling-socials.md`]: TOOLING_SOCIALS_PROFILE,
        'Tooling/D.md': '---\nurl: "https://deep.example/product"\n---\n',
    }, 'Tooling/D.md');
    servePages({
        'https://deep.example/product': '<title>Product</title><meta property="og:image" content="/card.png">',
        'https://deep.example/': '<title>Just a moment...</title><footer><a href="https://x.com/cloudflare">x</a></footer>',
    });
    await fillFromProfile(app, ROOT, noPick);
    assert.equal(line(files['Tooling/D.md']!, 'x_url'), undefined);
    assert.equal(line(files['Tooling/D.md']!, 'og_image'), 'og_image: "https://deep.example/card.png"');
    delete (globalThis as { __requestUrl?: unknown }).__requestUrl;
});
