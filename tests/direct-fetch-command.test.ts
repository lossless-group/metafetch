// The "Direct Fetch from Script" command end to end: a note's frontmatter
// in, the fetched page through the stubbed requestUrl, the note written back.
// Guards the og_image report: a page with no share image used to write
// `og_image: null` over the image the note already had.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { TFile } from 'obsidian';
import MetafetchPlugin from '../main';

interface Runnable {
    storedData: unknown;
    onload(): Promise<void>;
    runFetchScript(provider: 'direct' | 'microlink', explicitUrl?: string): Promise<void>;
}

/** Runs the direct command on one note served one page; returns the note afterwards. */
async function fetchInto(note: string, pageHtml: string): Promise<string> {
    let content = note;
    const file = new TFile();
    const app = {
        workspace: { getActiveFile: () => file, onLayoutReady: (cb: () => void) => cb() },
        vault: {
            getMarkdownFiles: () => [],
            read: () => Promise.resolve(content),
            modify: (_f: unknown, next: string) => { content = next; return Promise.resolve(); },
        },
    };
    (globalThis as { __requestUrl?: unknown }).__requestUrl = () => ({
        status: 200, headers: { 'content-type': 'text/html' }, text: pageHtml, json: null, arrayBuffer: new ArrayBuffer(0),
    });
    const Ctor = MetafetchPlugin as unknown as new (app: unknown, manifest: unknown) => Runnable;
    const plugin = new Ctor(app, { id: 'metafetch', version: '0.0.0' });
    await plugin.onload();
    await plugin.runFetchScript('direct');
    return content;
}

const frontmatterLine = (note: string, key: string) => note.split('\n').find(l => l.startsWith(`${key}:`));

describe('Direct Fetch from Script', () => {
    afterEach(() => { delete (globalThis as { __requestUrl?: unknown }).__requestUrl; });

    test('writes the share image a page declares under name="og:image"', async () => {
        const out = await fetchInto(
            '---\nurl: "https://filmora.example/"\n---\nBody',
            '<meta property="og:title" content="Filmora"><meta name="og:image" content="https://images.example/filmora.png">',
        );
        assert.equal(frontmatterLine(out, 'og_image'), 'og_image: "https://images.example/filmora.png"');
        assert.equal(frontmatterLine(out, 'og_title'), 'og_title: "Filmora"');
        assert.ok(out.endsWith('\nBody'), 'the body is untouched');
    });

    test('a page with no share image keeps the image the note already has', async () => {
        const out = await fetchInto(
            '---\nurl: "https://foundersfund.example/"\nog_image: "https://cdn.example/kept.png"\nog_description: "Kept"\n---\n',
            '<meta property="og:title" content="Founders Fund">',
        );
        assert.equal(frontmatterLine(out, 'og_image'), 'og_image: "https://cdn.example/kept.png"');
        assert.equal(frontmatterLine(out, 'og_description'), 'og_description: "Kept"', 'an empty description does not blank a stored one');
        assert.equal(frontmatterLine(out, 'og_title'), 'og_title: "Founders Fund"');
    });

    test('a note that never had an image still gets the og_image placeholder', async () => {
        const out = await fetchInto('---\nurl: "https://semver.example/"\n---\n', '<meta property="og:title" content="Semantic Versioning">');
        assert.equal(frontmatterLine(out, 'og_image'), 'og_image: null');
    });

    test('a bot-check page leaves the note untouched', async () => {
        const note = '---\nurl: "https://blocked.example/"\nog_title: "Real Title"\n---\n';
        assert.equal(await fetchInto(note, '<title>Just a moment...</title>'), note);
    });
});
