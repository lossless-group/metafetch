// The Direct Fetch extractor (src/services/directFetchService.ts): repeated
// scholarly tags, Last-First names, Highwire dates (ported from the 0.1.x
// directFetchService.test.mjs), the fixes copied back from Cite Wide's copy,
// and the share-image lookup that left og_image empty on pages that have one.
// No network: requestUrl is the obsidian stub, driven by __requestUrl.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    getMetaAll,
    normalizeAuthorName,
    normalizeDate,
    parseDirectFetchHtml,
    extractImage,
    extractBrandAssets,
    isJunkTitle,
    fetchDirectOpenGraph,
    DirectFetchError,
} from '../src/services/directFetchService';

const U = 'https://example.com/post';

// --- getMetaAll: the repeated-tag problem (0.1.x suite) -------------------
// Shaped like arXiv's actual markup.
const ARXIVISH = `
<meta name="citation_title" content="An Empirical Study of Agent Developer Practices" />
<meta name="citation_author" content="Wang, Yanlin" />
<meta name="citation_author" content="Xu, Xinyi" />
<meta name="citation_author" content="Chen, Jiachi" />
<meta name="citation_date" content="2025/12/01" />
<meta property="og:type" content="website" />
`;

describe('getMetaAll', () => {
    test('returns every repeated value in order', () => {
        assert.deepEqual(getMetaAll(ARXIVISH, 'name', 'citation_author'), ['Wang, Yanlin', 'Xu, Xinyi', 'Chen, Jiachi']);
    });

    test('single-value tag, and empty for an absent tag', () => {
        assert.deepEqual(getMetaAll(ARXIVISH, 'name', 'citation_date'), ['2025/12/01']);
        assert.deepEqual(getMetaAll(ARXIVISH, 'name', 'author'), []);
    });

    test('content-attribute-first ordering, and mixed orders stay in document order', () => {
        assert.deepEqual(getMetaAll('<meta content="Ada Lovelace" name="author">', 'name', 'author'), ['Ada Lovelace']);
        assert.deepEqual(
            getMetaAll('<meta name="a" content="1"><meta content="2" name="a"><meta name="a" content="3">', 'name', 'a'),
            ['1', '2', '3'],
        );
    });

    test('de-duplicates identical values', () => {
        assert.deepEqual(getMetaAll('<meta name="author" content="Ada"><meta name="author" content="Ada">', 'name', 'author'), ['Ada']);
    });

    test('does not match a different tag with a shared prefix', () => {
        assert.deepEqual(getMetaAll(ARXIVISH, 'name', 'citation_'), []);
    });

    test('an apostrophe inside a double-quoted value is kept (Cite Wide fix)', () => {
        // The old pattern stopped at either quote: "Kyle O'Brien" became "Kyle O".
        assert.deepEqual(getMetaAll('<meta name="author" content="Kyle O\'Brien">', 'name', 'author'), ["Kyle O'Brien"]);
    });

    test('unquoted attributes, as minified pages write them', () => {
        assert.deepEqual(getMetaAll('<meta data-rh=true property=og:url content=https://electronjs.org/ />', 'property', 'og:url'), ['https://electronjs.org/']);
    });

    test('a data-* attribute is not mistaken for the real one', () => {
        assert.deepEqual(getMetaAll('<meta data-name="author" name="description" content="x">', 'name', 'author'), []);
    });

    test('decodes numeric and named entities (named: Cite Wide fix)', () => {
        assert.deepEqual(getMetaAll('<meta name="author" content="Ben &amp; Jerry">', 'name', 'author'), ['Ben & Jerry']);
        const r = parseDirectFetchHtml('<meta property="og:title" content="What BMW&rsquo;s Corporate VC Offers &mdash; a look">', U);
        assert.equal(r.title, 'What BMW’s Corporate VC Offers — a look');
        assert.equal(parseDirectFetchHtml('<title>Tom &amp;amp; Jerry</title>', U).title, 'Tom &amp; Jerry', 'double-escaped stays single-escaped');
    });
});

describe('normalizers (0.1.x suite)', () => {
    test('normalizeAuthorName flips Last, First', () => {
        assert.equal(normalizeAuthorName('Dennis, Simon'), 'Simon Dennis');
        assert.equal(normalizeAuthorName('  Wang ,  Yanlin '), 'Yanlin Wang');
    });

    test('normalizeAuthorName leaves natural names, mononyms, suffixes, and odd shapes alone', () => {
        assert.equal(normalizeAuthorName('Simon Dennis'), 'Simon Dennis');
        assert.equal(normalizeAuthorName('Prince'), 'Prince');
        assert.equal(normalizeAuthorName('Jane Doe, PhD'), 'Jane Doe, PhD');
        assert.equal(normalizeAuthorName('Jane Doe, Ph.D.'), 'Jane Doe, Ph.D.');
        assert.equal(normalizeAuthorName('John Smith, Jr.'), 'John Smith, Jr.');
        assert.equal(normalizeAuthorName('Doe, Jane, PhD'), 'Doe, Jane, PhD');
        assert.equal(normalizeAuthorName('Dennis,'), 'Dennis,');
    });

    test('normalizeDate turns Highwire slashes into ISO and passes the rest through', () => {
        assert.equal(normalizeDate('2025/12/01'), '2025-12-01');
        assert.equal(normalizeDate('2026/4/3'), '2026-04-03');
        assert.equal(normalizeDate('2026/04'), '2026-04');
        assert.equal(normalizeDate('2026-08-17'), '2026-08-17');
        assert.equal(normalizeDate('2026-08-17T21:27:05+00:00'), '2026-08-17T21:27:05+00:00');
        assert.equal(normalizeDate('  17 August 2026 '), '17 August 2026');
    });
});

// --- The share image ------------------------------------------------------
// Each fixture is where a real page kept its image. Before 0.2.0 only the
// first two were read, and only with the attribute the spec names.
describe('extractImage', () => {
    const img = (head: string) => extractImage(`<html><head>${head}</head></html>`, 'https://site.example/a/page');

    test('og:image under property, resolved against the page', () => {
        assert.equal(img('<meta property="og:image" content="/og/card.png">'), 'https://site.example/og/card.png');
    });

    test('og:image under name= (Wondershare Filmora)', () => {
        assert.equal(
            img('<meta name="og:image" content="https://images.wondershare.com/filmora/filmora15/wondershare-filmora.png">'),
            'https://images.wondershare.com/filmora/filmora15/wondershare-filmora.png',
        );
    });

    test('og:image with unquoted attributes (minified builds)', () => {
        assert.equal(img('<meta property=og:image content=https://cdn.site.example/card.jpg>'), 'https://cdn.site.example/card.jpg');
    });

    test('og:image:url and og:image:secure_url when bare og:image is absent', () => {
        assert.equal(img('<meta property="og:image:url" content="https://cdn.site.example/u.png">'), 'https://cdn.site.example/u.png');
        assert.equal(img('<meta property="og:image:secure_url" content="https://cdn.site.example/s.png">'), 'https://cdn.site.example/s.png');
    });

    test('og:image:width alone is not an image', () => {
        assert.equal(img('<meta property="og:image:width" content="1200">'), null);
    });

    test('twitter:image under name or property, and the older twitter:image:src', () => {
        assert.equal(img('<meta name="twitter:image" content="https://cdn.site.example/t.png">'), 'https://cdn.site.example/t.png');
        assert.equal(img('<meta property="twitter:image" content="https://cdn.site.example/tp.png">'), 'https://cdn.site.example/tp.png');
        assert.equal(img('<meta name="twitter:image:src" content="https://cdn.site.example/ts.png">'), 'https://cdn.site.example/ts.png');
    });

    test('schema.org microdata: <meta itemprop="image">', () => {
        assert.equal(img('<meta content="/images/branding/logo.png" itemprop="image">'), 'https://site.example/images/branding/logo.png');
    });

    test('<link rel="image_src">', () => {
        assert.equal(img('<link rel="image_src" href="/legacy/share.jpg">'), 'https://site.example/legacy/share.jpg');
    });

    test('JSON-LD image: a string, an ImageObject, a list, inside @graph', () => {
        const ld = (json: string) => img(`<script type="application/ld+json">${json}</script>`);
        assert.equal(ld('{"@type":"Article","image":"https://cdn.site.example/a.jpg"}'), 'https://cdn.site.example/a.jpg');
        assert.equal(ld('{"@type":"NewsArticle","image":{"@type":"ImageObject","url":"/b.jpg"}}'), 'https://site.example/b.jpg');
        assert.equal(ld('{"@type":"BlogPosting","image":["https://cdn.site.example/c1.jpg","https://cdn.site.example/c2.jpg"]}'), 'https://cdn.site.example/c1.jpg');
        assert.equal(ld('{"@graph":[{"@type":"WebSite"},{"@type":"WebPage","primaryImageOfPage":{"url":"https://cdn.site.example/d.jpg"}}]}'), 'https://cdn.site.example/d.jpg');
    });

    test("a publisher's JSON-LD logo is not mistaken for the page image", () => {
        assert.equal(img('<script type="application/ld+json">{"@type":"Organization","logo":"https://cdn.site.example/logo.png"}</script>'), null);
    });

    test('og:image wins over every fallback', () => {
        assert.equal(
            img('<meta name="twitter:image" content="/t.png"><link rel="image_src" href="/l.png"><meta property="og:image" content="/og.png">'),
            'https://site.example/og.png',
        );
    });

    test('a page with no share image yields null', () => {
        assert.equal(img('<meta property="og:title" content="Founders Fund"><link rel="icon" href="/favicon.png">'), null);
    });
});

describe('extractBrandAssets (Cite Wide fix)', () => {
    test('the favicon is never the apple-touch-icon, even when that link comes first', () => {
        const b = extractBrandAssets('<link rel="apple-touch-icon" href="/touch.png"><link rel="icon" href="/fav.png">', 'https://example.com/a');
        assert.equal(b.favicon, 'https://example.com/fav.png');
        assert.equal(b.appIcon, 'https://example.com/touch.png');
    });

    test('prefers an SVG favicon; falls back to /favicon.ico when none is declared', () => {
        const svg = extractBrandAssets('<link rel="icon" sizes="32x32" href="/f.png"><link rel="icon" type="image/svg+xml" href="/f.svg">', 'https://example.com/');
        assert.equal(svg.favicon, 'https://example.com/f.svg');
        assert.equal(extractBrandAssets('<html></html>', 'https://example.com/x').favicon, 'https://example.com/favicon.ico');
    });

    test('href-before-rel order is read', () => {
        assert.equal(extractBrandAssets('<link href="https://cdn.blog.example.com/fav.ico" rel="shortcut icon">', U).favicon, 'https://cdn.blog.example.com/fav.ico');
    });
});

describe('parseDirectFetchHtml', () => {
    const SCHOLARLY = `<!doctype html><html><head>
<title>Ignored &amp; fallback title</title>
<link rel="icon" href="/static/favicon-32.png">
<meta property="og:title" content="Battery Ventures OpenCloud Report 2021 | PDF">
<meta content="Scribd" property="og:site_name" />
<meta property='og:image' content='/images/cover.jpg'>
<meta property="og:type" content="article">
<meta name="author" content="Danel Dayan">
<meta name="citation_author" content="Dayan, Danel">
<meta content="Ng, Neeraj" name="citation_author">
<meta name="citation_publication_date" content="2021/11/3">
</head></html>`;

    test('scholarly page: citation authors win and are normalized; image and favicon resolved', () => {
        const m = parseDirectFetchHtml(SCHOLARLY, 'https://www.scribd.com/document/536774580/x');
        assert.equal(m.title, 'Battery Ventures OpenCloud Report 2021 | PDF');
        assert.deepEqual(m.authors, ['Danel Dayan', 'Neeraj Ng']);
        assert.equal(m.published, '2021-11-03');
        assert.equal(m.site_name, 'Scribd');
        assert.equal(m.type, 'article');
        assert.equal(m.image, 'https://www.scribd.com/images/cover.jpg');
        assert.equal(m.favicon, 'https://www.scribd.com/static/favicon-32.png');
    });

    test('URL-valued article:author is dropped; <title> is the last-resort title', () => {
        const m = parseDirectFetchHtml('<title>Just a title</title><meta property="article:author" content="https://x.com/a">', U);
        assert.equal(m.title, 'Just a title');
        assert.equal(m.authors, undefined);
        assert.equal(m.image, null);
    });

    test('author fallbacks: JSON-LD, twitter:data1 only when labelled, visible byline (Cite Wide fix)', () => {
        assert.deepEqual(
            parseDirectFetchHtml('<script type="application/ld+json">{"@type":"BlogPosting","author":{"@type":"Person","name":"Akshaya Seshadri"}}</script>', U).authors,
            ['Akshaya Seshadri'],
        );
        assert.deepEqual(
            parseDirectFetchHtml('<meta name="twitter:label1" content="Written by"><meta name="twitter:data1" content="Kyle O\'Brien">', U).authors,
            ["Kyle O'Brien"],
        );
        assert.equal(
            parseDirectFetchHtml('<meta name="twitter:label1" content="Est. reading time"><meta name="twitter:data1" content="3 minutes">', U).authors,
            undefined,
            'a reading time is not an author',
        );
        assert.deepEqual(parseDirectFetchHtml('<div class="post-author__name">Chen Cuello</div>', U).authors, ['Chen Cuello']);
    });

    test('comma-joined bylines split; placeholder authors are dropped', () => {
        assert.deepEqual(parseDirectFetchHtml('<meta name="author" content="Lee Ying Shan,Dylan Butts">', U).authors, ['Lee Ying Shan', 'Dylan Butts']);
        assert.equal(parseDirectFetchHtml('<meta name="author" content="Super User">', U).authors, undefined);
    });
});

test('junk titles: bot checks, error pages, and login walls (Cite Wide fix)', () => {
    for (const t of ['Just a moment...', 'Client Challenge', 'Not Found', 'Page not found | MRU', '404 Not Found', 'Sign Up | LinkedIn', 'Access Denied', 'An error occurred.'])
        assert.equal(isJunkTitle(t), true, t);
    for (const t of ['The Economics of Open Source', 'Error Handling in Rust', 'Notfound: a study of absence', 'Signals and Noise'])
        assert.equal(isJunkTitle(t), false, t);
});

describe('fetchDirectOpenGraph', () => {
    afterEach(() => { delete (globalThis as { __requestUrl?: unknown }).__requestUrl; });

    function respond(status: number, text: string): void {
        (globalThis as { __requestUrl?: unknown }).__requestUrl = (req: { throw?: boolean }) => {
            assert.equal(req.throw, false);
            return { status, headers: { 'content-type': 'text/html' }, text, json: null, arrayBuffer: new ArrayBuffer(0) };
        };
    }

    test('parses a successful response', async () => {
        respond(200, '<meta property="og:title" content="A Post"><meta name="og:image" content="/card.png">');
        const m = await fetchDirectOpenGraph('https://blog.example.com/p');
        assert.equal(m.title, 'A Post');
        assert.equal(m.image, 'https://blog.example.com/card.png');
    });

    test('a bot-check page is a failed fetch, not metadata', async () => {
        respond(200, '<title>Just a moment...</title>');
        await assert.rejects(fetchDirectOpenGraph('https://example.com/a'), (e: unknown) => e instanceof DirectFetchError && e.code === 'BLOCKED_PAGE');
    });

    test('HTTP, network, and empty responses throw DirectFetchError', async () => {
        respond(403, 'Forbidden');
        await assert.rejects(fetchDirectOpenGraph('https://example.com/a'), (e: unknown) => e instanceof DirectFetchError && e.code === 'HTTP_ERROR');
        respond(200, '');
        await assert.rejects(fetchDirectOpenGraph('https://example.com/a'), (e: unknown) => e instanceof DirectFetchError && e.code === 'EMPTY_RESPONSE');
        (globalThis as { __requestUrl?: unknown }).__requestUrl = () => { throw new Error('offline'); };
        await assert.rejects(fetchDirectOpenGraph('https://example.com/a'), (e: unknown) => e instanceof DirectFetchError && e.code === 'NETWORK_ERROR');
    });
});
