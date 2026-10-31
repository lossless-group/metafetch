// Data recipes: the bundled Firecrawl, Firecrawl Branding, and Fireround
// requests; reading outputs by path; borrowed keys staying on their host;
// vault data recipe files; and the data step of "Fill frontmatter from folder
// profile". No network: requestUrl is the stub.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Notice, TFile } from 'obsidian';
import type { App } from 'obsidian';
import {
    ALL_BUNDLED_RECIPES, acceptDataValue, callData, domainOf, keyHolderFor, parseRecipe, readPath,
    type ModelRecipe, type ProviderSettings,
} from '../src/services/modelRecipes';
import { defaultProviderSettings } from '../src/services/modelProviderSettings';
import { parseProfile, planFill } from '../src/services/frontmatterProfiles';
import { fillFromProfile, type FillOptions } from '../src/commands/fillFromProfile';
import { extractFrontmatter, withFrontmatter } from '../src/utils/yamlFrontmatter';

interface Sent { url: string; method?: string; headers?: Record<string, string>; body?: string }

function serve(handler: (req: Sent) => { status?: number; json?: unknown; html?: string }): Sent[] {
    const sent: Sent[] = [];
    (globalThis as { __requestUrl?: unknown }).__requestUrl = (req: Sent) => {
        sent.push(req);
        const r = handler(req);
        const text = r.html ?? JSON.stringify(r.json ?? {});
        return { status: r.status ?? 200, headers: {}, text, json: r.json ?? null, arrayBuffer: new ArrayBuffer(0) };
    };
    return sent;
}

const recipe = (id: string) => ALL_BUNDLED_RECIPES.find(r => r.id === id)!;
const providers = (secret = 'firecrawl'): Record<string, ProviderSettings> => ({
    ...defaultProviderSettings(),
    firecrawl: { secret, model: '', baseUrl: '', approvedHosts: '' },
});
const getSecret = (n: string) => (n === 'firecrawl' ? 'fc-test' : null);
const run = (r: ModelRecipe, url = 'https://www.firecrawl.dev/', recipes = ALL_BUNDLED_RECIPES) =>
    callData({ recipe: r, recipes, providers: providers(), getSecret, note: { url, title: 'Firecrawl' } });

const ROUND = {
    id: 'firecrawl:series_b:2026-09-22',
    url: 'https://fireround.dev/companies/firecrawl.dev',
    company: { name: 'Firecrawl', domain: 'firecrawl.dev', sector: 'ai', headquarters: 'San Francisco, CA' },
    stage: 'series_b',
    stage_as_written: 'Series B',
    amount: { usd_millions: 75, as_written: '$75M' },
    valuation: null,
    announced_on: '2026-09-22',
    lead_investors: ['Smash Capital'],
    other_investors: ['Altos Ventures', 'Y Combinator'],
    sources: [{ url: 'https://www.firecrawl.dev/blog/introducing-alexandria-series-b' }, { url: 'https://siliconangle.com/x' }],
    previous_rounds: [{ stage_as_written: 'Series A' }],
};
const alexandria = (records: unknown[]) => ({ success: true, data: { alexandria: [{ provider: 'fireround', data: { data: records } }] } });

afterEach(() => { delete (globalThis as { __requestUrl?: unknown }).__requestUrl; Notice.shown.length = 0; });

describe('reading outputs', () => {
    test('[*] reads the rest of the path from every element', () => {
        assert.deepEqual(readPath({ a: [{ b: 'x' }, { b: 'y' }, {}] }, 'a[*].b'), ['x', 'y']);
        assert.equal(readPath({ a: 'no list' }, 'a[*].b'), undefined);
    });

    test('values fit for frontmatter: text, numbers, lists; never objects or inline data: blobs', () => {
        assert.equal(acceptDataValue('  Series B '), 'Series B');
        assert.equal(acceptDataValue(75), 75);
        assert.deepEqual(acceptDataValue(['a', 'a', ' b ', {}]), ['a', 'b']);
        assert.equal(acceptDataValue({ as_written: '$75M' }), undefined);
        assert.equal(acceptDataValue('data:image/svg+xml;utf8,<svg/>'), undefined);
        assert.equal(acceptDataValue(''), undefined);
        assert.equal(acceptDataValue([]), undefined);
    });

    test('domainOf drops www', () => {
        assert.equal(domainOf('https://www.firecrawl.dev/blog'), 'firecrawl.dev');
        assert.equal(domainOf('not a url'), '');
    });
});

describe('bundled data recipes', () => {
    test('Fireround: one Firecrawl call, keyed by the note\'s domain, outputs from the matching record', async () => {
        const sent = serve(() => ({ json: alexandria([{ ...ROUND, company: { domain: 'firecrawl.com' } }, ROUND]) }));
        const out = await run(recipe('fireround'));
        assert.equal(sent.length, 1);
        assert.equal(sent[0]?.url, 'https://api.firecrawl.dev/v2/scrape');
        assert.equal(sent[0]?.headers?.['authorization'], 'Bearer fc-test', 'Fireround uses the Firecrawl key');
        const body = JSON.parse(sent[0]?.body ?? '{}') as { alexandria: { provider: string; options: { q: string } } };
        assert.equal(body.alexandria.provider, 'fireround');
        assert.equal(body.alexandria.options.q, 'firecrawl.dev');
        assert.equal(out['round'], 'Series B');
        assert.equal(out['amount'], '$75M');
        assert.equal(out['amount_usd_millions'], 75);
        assert.deepEqual(out['lead_investors'], ['Smash Capital']);
        assert.deepEqual(out['previous_rounds'], ['Series A']);
        assert.deepEqual(out['sources'], ['https://www.firecrawl.dev/blog/introducing-alexandria-series-b', 'https://siliconangle.com/x']);
        assert.equal(out['valuation'], undefined, 'an undisclosed valuation stays empty');
    });

    test('Fireround: a near-miss company is never written', async () => {
        serve(() => ({ json: alexandria([{ ...ROUND, company: { domain: 'firecrawl.com' } }]) }));
        assert.deepEqual(await run(recipe('fireround')), {});
    });

    test('Fireround: a provider error inside a 200 is reported', async () => {
        serve(() => ({ json: { success: true, data: { alexandria: [{ provider: 'fireround', error: { code: 'TERMS', message: 'accept the terms' } }] } } }));
        await assert.rejects(run(recipe('fireround')), /Fireround: .*accept the terms/);
    });

    test('Firecrawl: page values from metadata, whichever spelling the page used', async () => {
        const sent = serve(() => ({ json: { success: true, data: { metadata: { title: 'Tina', 'og:image': 'https://tina.io/og.png', favicon: 'https://tina.io/f.ico', ogSiteName: 'TinaCMS' } } } }));
        const out = await run(recipe('firecrawl'), 'https://tina.io/');
        assert.equal(JSON.parse(sent[0]?.body ?? '{}').url, 'https://tina.io/');
        assert.deepEqual(out, { title: 'Tina', image: 'https://tina.io/og.png', favicon: 'https://tina.io/f.ico', site_name: 'TinaCMS' });
    });

    test('Firecrawl Branding: colours and fonts; an inline logo is never written', async () => {
        serve(() => ({ json: { data: { branding: {
            colorScheme: 'light',
            colors: { primary: '#EC4815' },
            fonts: [{ family: 'Inter' }, { family: 'IBM Plex Sans' }],
            images: { logo: 'data:image/svg+xml;utf8,<svg/>', logoHref: 'https://tina.io/logo.svg' },
        } } } }));
        const out = await run(recipe('firecrawl-branding'), 'https://tina.io/');
        assert.equal(out['primary_color'], '#EC4815');
        assert.deepEqual(out['fonts'], ['Inter', 'IBM Plex Sans']);
        assert.equal(out['logo'], undefined);
    });

    test('no Firecrawl key: a clear error naming where to set it', async () => {
        await assert.rejects(
            callData({ recipe: recipe('fireround'), recipes: ALL_BUNDLED_RECIPES, providers: providers(''), getSecret, note: { url: 'https://firecrawl.dev', title: '' } }),
            /no API key\. Choose one under Firecrawl/
        );
    });
});

const VAULT_RECIPE = (provider: string, url = 'https://api.firecrawl.dev/v2/scrape') => `# Some catalogue entry
\`\`\`cf-recipe
id: yc-record
kind: data
provider: ${provider}
title: YC record
request:
  url: ${url}
  body:
    alexandria: { provider: yc, capability: companies/get, options: { domain: "{{domain}}" } }
response:
  error: data.alexandria[0].error
  records: data.alexandria[0].data.data
  match: { domain: "{{domain}}" }
  outputs:
    batch: batch
    yc_url: [url, link]
\`\`\`
`;

describe('vault data recipes', () => {
    test('a recipe file borrowing the Firecrawl key: parsed, run, and kept to Firecrawl\'s host', async () => {
        const parsed = parseRecipe(VAULT_RECIPE('firecrawl'), 'zz-cf-lib/recipes/yc.md');
        assert.deepEqual(parsed?.problems, []);
        const r = parsed!.recipe!;
        assert.equal(r.kind, 'data');
        assert.equal(r.provider, 'firecrawl');
        assert.deepEqual(r.outputs, { batch: ['batch'], yc_url: ['url', 'link'] });
        assert.equal(keyHolderFor(r, [...ALL_BUNDLED_RECIPES, r])?.id, 'firecrawl');

        const sent = serve(() => ({ json: { data: { alexandria: [{ data: { data: [{ domain: 'tina.io', batch: 'W21', link: 'https://ycombinator.com/companies/tina' }] } }] } } }));
        const out = await run(r, 'https://tina.io', [...ALL_BUNDLED_RECIPES, r]);
        assert.deepEqual(out, { batch: 'W21', yc_url: 'https://ycombinator.com/companies/tina' });
        assert.equal(sent[0]?.headers?.['authorization'], 'Bearer fc-test');
    });

    test('a recipe file cannot send a borrowed key anywhere else', async () => {
        const r = parseRecipe(VAULT_RECIPE('firecrawl', 'https://evil.example/collect'), 'x.md')!.recipe!;
        const sent = serve(() => ({ json: {} }));
        await assert.rejects(run(r, 'https://tina.io', [...ALL_BUNDLED_RECIPES, r]), /Firecrawl key may only go to api\.firecrawl\.dev/);
        assert.equal(sent.length, 0);
    });

    test('a data recipe needs outputs; a model recipe cannot borrow a key', () => {
        assert.match(parseRecipe('```cf-recipe\nkind: data\nrequest: { url: "https://x.dev" }\n```', 'a.md')?.problems.join() ?? '', /response\.outputs/);
        const m = parseRecipe('```cf-recipe\nprovider: firecrawl\nrequest: { url: "https://x.dev" }\nresponse: { text: a }\n```', 'm.md')!.recipe!;
        assert.equal(m.provider, 'm', 'provider: is ignored on model recipes');
    });
});

describe('profiles with data sources', () => {
    test('from: lists recipes after direct; value: names the output; page: doubles as the output name', () => {
        const p = parseProfile(`---
applies-to-paths: ["Tooling/**"]
---
\`\`\`metafetch-profile
fields:
  og_image: { page: image, from: [direct, firecrawl] }
  latest_round: { from: [fireround], value: round }
  bad: { from: [fireround] }
\`\`\`
`, 'p.md')!;
        assert.match(p.problems.join(), /bad: from: \[fireround\] needs value/);
        const [img, round] = p.fields;
        assert.deepEqual(img?.recipes, ['firecrawl']);
        assert.equal(img?.runnable, true);
        assert.deepEqual(round?.recipes, ['fireround']);
        assert.equal(round?.runnable, false);
        const { report } = planFill(p, {}, null, null);
        assert.deepEqual(report.forRecipes, ['og_image', 'latest_round'], 'an unread page leaves both for their recipes');
    });
});

describe('the data step of Fill frontmatter from folder profile', () => {
    const PROFILE = `---
applies-to-paths: ["Tooling/**"]
---
\`\`\`metafetch-profile
fields:
  og_image: { page: image, from: [direct, firecrawl] }
  latest_round: { from: [fireround], value: round }
  lead_investors: { from: [fireround], value: lead_investors }
  brand_color: { from: [firecrawl-branding], value: primary_color }
\`\`\`
`;

    function vault(note: string) {
        const files: Record<string, string> = { 'zz-cf-lib/frontmatter/p.md': PROFILE, 'Tooling/Firecrawl.md': note };
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
        return { app, files };
    }

    const OPTIONS: FillOptions = { profilesRoot: 'zz-cf-lib/frontmatter', recipes: ALL_BUNDLED_RECIPES, providers: providers(), defaultModelProvider: 'anthropic', getSecret };

    test('a site that refuses a plain fetch: Firecrawl fills the page value, Fireround the round; each called once', async () => {
        const { app, files } = vault('---\nurl: "https://www.firecrawl.dev/"\n---\n');
        const sent = serve(req => {
            if (!req.url.startsWith('https://api.firecrawl.dev/')) return { status: 403, html: 'Forbidden' };
            const body = JSON.parse(req.body ?? '{}') as { alexandria?: unknown; formats?: string[] };
            if (body.alexandria) return { json: alexandria([ROUND]) };
            if (body.formats?.includes('branding')) return { json: { data: { branding: { colors: { primary: '#FA5D19' } } } } };
            return { json: { data: { metadata: { ogImage: 'https://www.firecrawl.dev/og.png' } } } };
        });
        await fillFromProfile(app, OPTIONS, () => Promise.resolve(null));

        const fm = extractFrontmatter(files['Tooling/Firecrawl.md']!) ?? {};
        assert.equal(fm['og_image'], 'https://www.firecrawl.dev/og.png');
        assert.equal(fm['latest_round'], 'Series B');
        assert.deepEqual(fm['lead_investors'], ['Smash Capital']);
        assert.equal(fm['brand_color'], '#FA5D19');
        assert.equal(sent.filter(r => r.url.startsWith('https://api.firecrawl.dev/')).length, 3, 'Fireround is called once for two fields');
    });

    test('set fields are left alone, and a recipe nobody needs is never called', async () => {
        const { app } = vault('---\nurl: "https://www.firecrawl.dev/"\nog_image: x\nlatest_round: Seed\nlead_investors: [A]\n---\n');
        const sent = serve(req => (req.url.startsWith('https://api.firecrawl.dev/') ? { json: { data: { branding: { colors: { primary: '#000' } } } } } : { status: 403, html: '' }));
        await fillFromProfile(app, OPTIONS, () => Promise.resolve(null));
        const api = sent.filter(r => r.url.startsWith('https://api.firecrawl.dev/'));
        assert.equal(api.length, 1);
        assert.match(api[0]?.body ?? '', /branding/);
    });
});

describe('the example Tooling profile', () => {
    test('its commented-out data fields parse cleanly once uncommented', async () => {
        const { TOOLING_SOCIALS_PROFILE } = await import('../src/profiles/toolingSocials');
        const p = parseProfile(TOOLING_SOCIALS_PROFILE.replace(/^ {2}# /gm, '  '), 'zz-cf-lib/frontmatter/tooling-socials.md')!;
        assert.deepEqual(p.problems, []);
        assert.deepEqual(p.fields.find(f => f.key === 'lead_investors')?.recipes, ['fireround']);
        assert.equal(parseProfile(TOOLING_SOCIALS_PROFILE, 'x.md')!.fields.some(f => f.recipes.length), false, 'commented out by default');
    });
});
