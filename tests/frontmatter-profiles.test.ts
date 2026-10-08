// Folder profiles: reading a profile file, choosing the profile that applies
// to a note, and deciding which fields to fill.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseProfile, resolveProfiles, planFill, needsSocials, type FrontmatterProfile } from '../src/services/frontmatterProfiles';
import { TOOLING_SOCIALS_PROFILE } from '../src/profiles/toolingSocials';
import type { SocialChoice, SocialPlatform } from '../src/services/socialLinks';
import { SOCIAL_PLATFORMS } from '../src/services/socialLinks';
import type { OpenGraphData } from '../src/types/open-graph-service';

const profileFile = (globs: string[], fields: string, title = 'P') =>
    `---\ntitle: ${title}\napplies-to-paths:\n${globs.map(g => `  - "${g}"`).join('\n')}\n---\n\nProse.\n\n\`\`\`metafetch-profile\nfields:\n${fields}\n\`\`\`\n`;

describe('parseProfile', () => {
    test('the bundled Tooling socials example parses with no problems', () => {
        const p = parseProfile(TOOLING_SOCIALS_PROFILE, 'zz-cf-lib/frontmatter/tooling-socials.md')!;
        assert.deepEqual(p.problems, []);
        assert.deepEqual(p.appliesToPaths, ['Tooling/**']);
        const keys = p.fields.map(f => f.key);
        assert.ok(keys.includes('github_profile_url') && keys.includes('github_repo_url') && keys.includes('linkedin_url'));
        assert.ok(!keys.includes('github_url'), 'github_url is left for the operator');
        assert.deepEqual(p.fields.find(f => f.key === 'github_profile_url')?.aliases, ['github_profle_url']);
    });

    test('a file without a metafetch-profile block is not a profile', () => {
        assert.equal(parseProfile('---\ntitle: README\n---\n\nJust docs.', 'zz-cf-lib/frontmatter/README.md'), null);
    });

    test('bad fields are reported and skipped; good ones still load', () => {
        const p = parseProfile(profileFile(['Tooling/**'], '  a: { platform: myspace }\n  b: { page: color }\n  c: {}\n  d: { platform: x }'), 'p.md')!;
        assert.deepEqual(p.fields.map(f => f.key), ['d']);
        assert.equal(p.problems.length, 3);
    });

    test('invalid YAML and missing globs are reported, not thrown', () => {
        const bad = parseProfile('---\ntitle: T\n---\n```metafetch-profile\nfields: [unclosed\n```\n', 'p.md')!;
        assert.match(bad.problems.join(' '), /not valid YAML/);
        assert.match(bad.problems.join(' '), /no applies-to-paths/);
    });

    test('a field whose from: list excludes direct is loaded but not runnable', () => {
        const p = parseProfile(profileFile(['T/**'], '  zinger: { page: description, from: [model] }'), 'p.md')!;
        assert.equal(p.fields[0]?.runnable, false);
    });
});

describe('resolveProfiles', () => {
    const tooling = parseProfile(profileFile(['Tooling/**'], '  x_url: { platform: x }', 'Tooling'), 'a.md')!;
    const agentic = parseProfile(profileFile(['Tooling/Agentic AI/**'], '  x_url: { platform: x }', 'Agentic'), 'b.md')!;
    const sources = parseProfile(profileFile(['Sources/**'], '  x_url: { platform: x }', 'Sources'), 'c.md')!;

    test('the most specific matching glob wins without asking', () => {
        const r = resolveProfiles([tooling, agentic, sources], 'Tooling/Agentic AI/Mastra.md');
        assert.deepEqual(r.matches.map(p => p.title), ['Agentic', 'Tooling']);
        assert.equal(r.tie, false);
    });

    test('equally specific matches are a tie for the user to pick', () => {
        const twin = { ...tooling, title: 'Tooling 2' };
        assert.equal(resolveProfiles([tooling, twin], 'Tooling/Mastra.md').tie, true);
    });

    test('no match outside the globs', () => {
        assert.deepEqual(resolveProfiles([tooling], 'Essays/x.md').matches, []);
    });
});

describe('planFill', () => {
    const profile = parseProfile(TOOLING_SOCIALS_PROFILE, 'p.md') as FrontmatterProfile;
    const none = (): Record<SocialPlatform, SocialChoice> =>
        Object.fromEntries(SOCIAL_PLATFORMS.map(p => [p, { url: undefined, candidates: [], ambiguous: false }])) as Record<SocialPlatform, SocialChoice>;
    const page: OpenGraphData = { title: 'Tina', description: '', image: 'https://tina.io/og.png', favicon: 'https://tina.io/favicon.svg', url: 'https://tina.io/', type: '', site_name: 'Tina' };

    test('fills empty fields only, and reports what it found, missed, and found twice', () => {
        const socials = none();
        socials['github-org'] = { url: 'https://github.com/tinacms', candidates: [], ambiguous: false };
        socials['linkedin-company'] = { url: 'https://www.linkedin.com/company/tinacms', candidates: [], ambiguous: false };
        socials.x = { url: undefined, candidates: [{ url: 'https://x.com/a', score: 30, placements: ['footer'], brandMatch: false }, { url: 'https://x.com/b', score: 30, placements: ['footer'], brandMatch: false }], ambiguous: true };

        const { values, report } = planFill(profile, { url: 'https://tina.io/', linkedin_url: 'https://www.linkedin.com/company/kept' }, page, socials);
        assert.equal(values['github_profile_url'], 'https://github.com/tinacms');
        assert.equal(values['linkedin_url'], undefined, 'an existing value is never replaced');
        assert.equal(values['og_image'], 'https://tina.io/og.png');
        assert.ok(report.alreadySet.includes('linkedin_url'));
        assert.deepEqual(report.ambiguous, [{ key: 'x_url', candidates: ['https://x.com/a', 'https://x.com/b'] }]);
        assert.ok(report.notFound.includes('discord_url'));
        assert.equal('x_url' in values, false);
    });

    test('an alias with a value counts as filled, and is not renamed', () => {
        const socials = none();
        socials['github-org'] = { url: 'https://github.com/new', candidates: [], ambiguous: false };
        const { values, report } = planFill(profile, { github_profle_url: 'https://github.com/old', image: 'https://x/i.png' }, page, socials);
        assert.equal(values['github_profile_url'], undefined);
        assert.equal(values['og_image'], undefined);
        assert.ok(report.alreadySet.includes('github_profile_url') && report.alreadySet.includes('og_image'));
    });

    test('github_url is neither read nor written', () => {
        const socials = none();
        socials['github-org'] = { url: 'https://github.com/tinacms', candidates: [], ambiguous: false };
        const { values } = planFill(profile, { github_url: 'https://github.com/tinacms/tinacms' }, page, socials);
        assert.equal(values['github_profile_url'], 'https://github.com/tinacms');
        assert.equal('github_url' in values, false);
    });

    test('needsSocials is false once every social field is set', () => {
        const fm: Record<string, unknown> = {};
        for (const f of profile.fields) if (f.platform) fm[f.key] = 'https://set.example/';
        assert.equal(needsSocials(profile, fm), false);
        assert.equal(needsSocials(profile, {}), true);
    });
});
