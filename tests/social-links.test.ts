// The social-link extractor: per-platform recognition and canonical form,
// and the ranking that picks a company's own profile and refuses to guess.
// Fixtures mirror what 80 Tooling homepages in the lossless vault did
// (2026-10-08).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { classifySocialUrl, chooseSocialLinks, brandTokens } from '../src/services/socialLinks';

describe('classifySocialUrl', () => {
    test('GitHub: an org link names the org; a repo link names the repo and its org', () => {
        assert.deepEqual(classifySocialUrl('https://www.github.com/glideapps')['github-org']?.url, 'https://github.com/glideapps');
        const repo = classifySocialUrl('https://github.com/tinacms/tinacms/');
        assert.equal(repo['github-repo']?.url, 'https://github.com/tinacms/tinacms');
        assert.equal(repo['github-org']?.url, 'https://github.com/tinacms');
    });

    test("GitHub's own pages are not orgs", () => {
        for (const href of ['https://github.com/features/actions', 'https://github.com/sponsors/colinhacks', 'https://github.com/user-attachments/assets/x', 'https://github.com/'])
            assert.equal(classifySocialUrl(href)['github-org'], undefined, href);
    });

    test('LinkedIn: company, school, and showcase pages, with sub-pages and query stripped', () => {
        assert.equal(classifySocialUrl('https://linkedin.com/company/wizainc/about/?trk=x')['linkedin-company']?.url, 'https://www.linkedin.com/company/wizainc');
        assert.equal(classifySocialUrl('https://uk.linkedin.com/company/tyk')['linkedin-company']?.url, 'https://www.linkedin.com/company/tyk');
        assert.equal(classifySocialUrl('https://www.linkedin.com/in/someone')['linkedin-company'], undefined, 'a person is not a company page');
        assert.equal(classifySocialUrl('https://www.linkedin.com/shareArticle?url=x')['linkedin-company'], undefined);
    });

    test('X: twitter.com becomes x.com; intent and share links are buttons', () => {
        assert.equal(classifySocialUrl('https://twitter.com/brexHQ/')?.x?.url, 'https://x.com/brexHQ');
        assert.equal(classifySocialUrl('https://x.com/intent/tweet?text=hi').x, undefined);
        assert.equal(classifySocialUrl('https://twitter.com/share').x, undefined);
        assert.equal(classifySocialUrl('https://x.com/someone/status/123').x, undefined, 'a post is not a profile');
    });

    test('YouTube, Discord, Instagram, Facebook, Bluesky, Crunchbase', () => {
        assert.equal(classifySocialUrl('https://youtube.com/@wizacom').youtube?.url, 'https://www.youtube.com/@wizacom');
        assert.equal(classifySocialUrl('https://www.youtube.com/c/tinacms').youtube?.url, 'https://www.youtube.com/c/tinacms');
        assert.equal(classifySocialUrl('https://www.youtube.com/watch?v=abc').youtube, undefined);
        assert.equal(classifySocialUrl('https://discord.com/invite/zumN63Ybpf').discord?.url, 'https://discord.gg/zumN63Ybpf');
        assert.equal(classifySocialUrl('https://www.instagram.com/tinacms_/').instagram?.url, 'https://www.instagram.com/tinacms_');
        assert.equal(classifySocialUrl('https://www.instagram.com/p/xyz').instagram, undefined);
        assert.equal(classifySocialUrl('https://www.facebook.com/sharer/sharer.php?u=x').facebook, undefined);
        assert.equal(classifySocialUrl('https://www.facebook.com/profile.php?id=100064').facebook?.url, 'https://www.facebook.com/profile.php?id=100064');
        assert.equal(classifySocialUrl('https://www.facebook.com/profile.php').facebook, undefined, 'no id, no identity');
        assert.equal(classifySocialUrl('https://bsky.app/profile/tina.io').bluesky?.url, 'https://bsky.app/profile/tina.io');
        assert.equal(classifySocialUrl('https://www.crunchbase.com/organization/brex').crunchbase?.url, 'https://www.crunchbase.com/organization/brex');
    });
});

test('brandTokens: the domain core and the site name', () => {
    assert.deepEqual(brandTokens('https://www.glideapps.com/', 'Glide'), ['glideapps', 'glide']);
    assert.deepEqual(brandTokens('https://tina.io/'), ['tina']);
    assert.deepEqual(brandTokens('https://shop.example.co.uk/'), ['example']);
});

describe('chooseSocialLinks', () => {
    const page = (body: string) => `<html><head><meta property="og:site_name" content="Glide"></head><body>${body}</body></html>`;
    const URL_ = 'https://www.glideapps.com/';

    test('footer links are chosen and canonicalized', () => {
        const c = chooseSocialLinks(page('<main>…</main><footer><a href="https://www.twitter.com/glideapps">X</a><a href="https://www.linkedin.com/company/glideapps/">in</a><a href="https://www.github.com/glideapps">gh</a></footer>'), URL_, 'Glide');
        assert.equal(c.x.url, 'https://x.com/glideapps');
        assert.equal(c['linkedin-company'].url, 'https://www.linkedin.com/company/glideapps');
        assert.equal(c['github-org'].url, 'https://github.com/glideapps');
    });

    test('JSON-LD sameAs on the Organization wins over a footer link', () => {
        const html = page(`<script type="application/ld+json">{"@type":"Organization","sameAs":["https://x.com/glide_official"]}</script>
            <footer><a href="https://x.com/someoneelse">x</a></footer>`);
        assert.equal(chooseSocialLinks(html, URL_, 'Glide').x.url, 'https://x.com/glide_official');
    });

    test("a body-only link that doesn't resemble the brand is never chosen (customer logos, partners)", () => {
        const c = chooseSocialLinks(page('<section class="customers"><a href="https://www.linkedin.com/company/acme-corp">Acme</a></section>'), URL_, 'Glide');
        assert.equal(c['linkedin-company'].url, undefined);
        assert.equal(c['linkedin-company'].ambiguous, false);
    });

    test('a body-only link that does resemble the brand is chosen', () => {
        assert.equal(chooseSocialLinks(page('<p>Follow <a href="https://x.com/GlideApps">us</a></p>'), URL_, 'Glide').x.url, 'https://x.com/GlideApps');
    });

    test('the owner of a brand-named repo is the org even when its name differs (zod.dev)', () => {
        const c = chooseSocialLinks('<p><a href="https://github.com/colinhacks/zod">GitHub</a><a href="https://github.com/colinhacks/zshy">zshy</a></p>', 'https://zod.dev/', 'Zod');
        assert.equal(c['github-org'].url, 'https://github.com/colinhacks');
        assert.equal(c['github-repo'].url, 'https://github.com/colinhacks/zod');
    });

    test('two equally strong candidates: nothing chosen, both reported', () => {
        const c = chooseSocialLinks(page('<footer><a href="https://x.com/alpha">a</a><a href="https://x.com/beta">b</a></footer>'), URL_, 'Glide');
        assert.equal(c.x.url, undefined);
        assert.equal(c.x.ambiguous, true);
        assert.deepEqual(c.x.candidates.map(x => x.url).sort(), ['https://x.com/alpha', 'https://x.com/beta']);
    });

    test('a repeated link outranks a single one in the same place', () => {
        const c = chooseSocialLinks(page('<footer><a href="https://x.com/alpha">a</a><a href="https://x.com/beta">b</a><a href="https://x.com/beta">b</a></footer>'), URL_, 'Glide');
        assert.equal(c.x.url, 'https://x.com/beta');
    });

    test('unquoted and relative hrefs, share buttons ignored', () => {
        const c = chooseSocialLinks(page('<footer><a href=https://x.com/glideapps>x</a><a href="https://twitter.com/intent/tweet?url=x">share</a><a href="/about">about</a></footer>'), URL_, 'Glide');
        assert.equal(c.x.url, 'https://x.com/glideapps');
        assert.equal(c.x.ambiguous, false);
    });
});
