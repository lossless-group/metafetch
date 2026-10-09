// Acceptance tests for the 0.2.0 settings tab, which moves to Obsidian 1.13's
// declarative getSettingDefinitions() API (same migration as Image Gin and
// Cite Wide 0.3.0). These walk the definition tree Obsidian renders and
// indexes for settings search, so a missing or mistyped setting fails here
// instead of silently vanishing from the screen.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MetafetchSettingTab, DEFAULT_SETTINGS } from '../src/settings/settings';
import type { MetafetchSettings } from '../src/settings/settings';
import type MetafetchPlugin from '../main';
import type { App } from 'obsidian';

// Loose structural view of the definition tree; the real types come from
// obsidian 1.13 but tests stay decoupled from them.
interface Def {
    type?: string;
    name?: string;
    heading?: string;
    desc?: unknown;
    control?: { type: string; key: string; min?: number; max?: number; step?: number };
    items?: Def[];
    visible?: boolean | (() => boolean);
}

type Tab = {
    getSettingDefinitions(): Def[];
    getControlValue(key: string): unknown;
    setControlValue(key: string, value: unknown): void | Promise<void>;
};

function makeTab(overrides: Partial<MetafetchSettings> = {}) {
    const settings: MetafetchSettings = { ...DEFAULT_SETTINGS, ...overrides };
    let saves = 0;
    const plugin = {
        settings,
        saveSettings: () => { saves++; return Promise.resolve(); },
    } as unknown as MetafetchPlugin;
    const app = { vault: {} } as unknown as App;
    const tab = new MetafetchSettingTab(app, plugin) as unknown as Tab;
    return { tab, settings, saves: () => saves };
}

/** Depth-first walk over groups, lists, and pages. */
function walk(defs: Def[], out: Def[] = []): Def[] {
    for (const d of defs) {
        out.push(d);
        if (d.items) walk(d.items, out);
    }
    return out;
}

const norm = (s: string) => s.trim().toLowerCase();
const shown = (d: Def) => d.visible === undefined || (typeof d.visible === 'function' ? d.visible() : d.visible);

// Every row in the 0.1.x display() tab. Compared case-insensitively because
// 0.2.0 moves the names to sentence case (marketplace lint), which is a
// wording change, not a missing setting.
const REQUIRED_NAMES = [
    'OpenGraph.io API key',
    'Base URL',
    'API URL',
    'Retries',
    'Rate limit',
    'Microlink API key (optional)',
    'Title field',
    'Description field',
    'Image field',
    'Favicon field',
    'Site name field',
    'Type field',
    'Authors field',
    'Published date field',
    'Fetch date field',
    'Stamp an identity code',
    'Identity code field',
    'Code length',
];

// The 0.1.x tab's collapsible sections, now groups.
const REQUIRED_HEADINGS = [
    'OpenGraph.io',
    'Microlink',
    'Direct fetch',
    'Field names',
    'Vault identity code',
];

// Stored settings with no row in 0.1.x either: internal tuning knobs.
const UNEXPOSED_KEYS = ['backoffDelay', 'cacheDuration'];

describe('declarative settings tab (Obsidian ≥ 1.13)', () => {
    test('uses getSettingDefinitions and does not override display()', () => {
        assert.ok(
            Object.prototype.hasOwnProperty.call(MetafetchSettingTab.prototype, 'getSettingDefinitions'),
            'MetafetchSettingTab must implement getSettingDefinitions()',
        );
        assert.ok(
            !Object.prototype.hasOwnProperty.call(MetafetchSettingTab.prototype, 'display'),
            'display() must not be overridden; Obsidian renders the definitions',
        );
    });

    test('every 0.1.x setting row is still present (searchable by name)', () => {
        const names = new Set(
            walk(makeTab().tab.getSettingDefinitions()).map(d => d.name).filter((n): n is string => !!n).map(norm),
        );
        const missing = REQUIRED_NAMES.filter(n => !names.has(norm(n)));
        assert.deepEqual(missing, []);
    });

    test('every 0.1.x section survives as a group heading', () => {
        const headings = walk(makeTab().tab.getSettingDefinitions()).map(d => norm(d.heading ?? ''));
        for (const h of REQUIRED_HEADINGS) {
            assert.ok(headings.some(x => x.includes(norm(h))), `missing heading: ${h}`);
        }
    });

    test('the OpenGraph.io key status reflects whether a key is set', () => {
        const status = (overrides: Partial<MetafetchSettings>) => walk(makeTab(overrides).tab.getSettingDefinitions())
            .filter(d => norm(d.name ?? '') === 'api key status' && shown(d))
            .map(d => (typeof d.desc === 'string' ? d.desc : ''));
        const without = status({ apiKey: '' });
        const withKey = status({ apiKey: 'og_test' });
        assert.equal(without.length, 1);
        assert.equal(withKey.length, 1);
        assert.match(without[0]!, /missing/i);
        assert.match(withKey[0]!, /configured/i);
    });

    test('every item is searchable: non-empty name; groups are not empty', () => {
        const defs = walk(makeTab().tab.getSettingDefinitions());
        assert.ok(defs.length > 0, 'getSettingDefinitions() returned nothing');
        for (const d of defs) {
            if (d.type === 'group') {
                assert.ok((d.items?.length ?? 0) > 0, `empty group: ${d.heading}`);
                continue;
            }
            if (d.type === 'list' || d.type === 'page') continue;
            assert.ok(d.name && d.name.trim(), `item without a name: ${JSON.stringify(d.control ?? d)}`);
        }
    });

    test('numeric rows keep their 0.1.x ranges', () => {
        const control = (key: string) => walk(makeTab().tab.getSettingDefinitions()).find(d => d.control?.key === key)?.control;
        assert.deepEqual(
            [control('retries')?.min, control('retries')?.max],
            [1, 10],
        );
        assert.deepEqual(
            [control('rateLimit')?.min, control('rateLimit')?.max],
            [10, 120],
        );
        assert.deepEqual(
            [control('hexCodeLength')?.min, control('hexCodeLength')?.max],
            [4, 12],
        );
    });
});

describe('control bindings', () => {
    test('every control key exists in the settings shape, and every exposed setting has a control', () => {
        const keys = walk(makeTab().tab.getSettingDefinitions())
            .map(d => d.control?.key)
            .filter((k): k is string => !!k);
        // Provider rows are nested (modelProviders.<id>.<field>); count them
        // under their top-level key.
        const topLevel = [...new Set(keys.map(k => k.split('.')[0] ?? k))];
        const expected = Object.keys(DEFAULT_SETTINGS).filter(k => !UNEXPOSED_KEYS.includes(k));
        assert.deepEqual(topLevel.sort(), expected.sort());
        for (const k of keys) assert.ok(k.split('.')[0]! in DEFAULT_SETTINGS, k);
    });

    test('getControlValue reads the stored value for every control', () => {
        const { tab, settings } = makeTab({ apiKey: 'og_test', imageFieldName: 'cover', hexCodeLength: 8, stampHexCode: true });
        for (const k of (Object.keys(DEFAULT_SETTINGS) as (keyof MetafetchSettings)[]).filter(k => k !== 'modelProviders')) {
            assert.deepEqual(tab.getControlValue(k), settings[k], k);
        }
    });

    test('setControlValue persists each kind of value', async () => {
        const { tab, settings, saves } = makeTab();
        await tab.setControlValue('apiKey', 'og_test');
        await tab.setControlValue('retries', 5);
        await tab.setControlValue('stampHexCode', true);
        await tab.setControlValue('imageFieldName', 'cover');
        assert.equal(settings.apiKey, 'og_test');
        assert.equal(settings.retries, 5);
        assert.equal(settings.stampHexCode, true);
        assert.equal(settings.imageFieldName, 'cover');
        assert.equal(saves(), 4);
    });

    test('an emptied field name falls back to its default rather than writing an empty key', async () => {
        const { tab, settings } = makeTab({ imageFieldName: 'cover', hexCodeFieldName: 'id' });
        await tab.setControlValue('imageFieldName', '   ');
        await tab.setControlValue('hexCodeFieldName', '');
        assert.equal(settings.imageFieldName, 'og_image');
        assert.equal(settings.hexCodeFieldName, 'hex_code');
    });

    test('unknown keys are ignored and not saved', async () => {
        const { tab, settings, saves } = makeTab();
        await tab.setControlValue('notASetting', 'x');
        assert.equal((settings as unknown as Record<string, unknown>)['notASetting'], undefined);
        assert.equal(saves(), 0);
    });
});

describe('model provider rows', () => {
    test('every bundled provider gets a group with a key row and a model row', () => {
        const defs = walk(makeTab().tab.getSettingDefinitions());
        for (const heading of ['Model providers', 'Claude (Anthropic)', 'OpenAI', 'TrustedRouter', 'OpenAI-compatible endpoint']) {
            const group = defs.find(d => d.type === 'group' && d.heading === heading);
            assert.ok(group, `missing group ${heading}`);
            if (heading === 'Model providers') continue;
            const names = (group.items ?? []).map(i => i.name);
            assert.ok(names.includes('API key') && names.includes('Model'), `${heading}: ${names.join(', ')}`);
        }
        const compatible = defs.find(d => d.heading === 'OpenAI-compatible endpoint');
        assert.ok(compatible?.items?.some(i => i.name === 'Base URL'));
    });

    test('nested provider settings read and write through the control keys', async () => {
        const { tab, settings, saves } = makeTab();
        assert.equal(tab.getControlValue('modelProviders.anthropic.model'), 'claude-opus-5-5');
        await tab.setControlValue('modelProviders.openai.model', ' gpt-6.1-sol ');
        assert.equal(settings.modelProviders['openai']?.model, 'gpt-6.1-sol');
        await tab.setControlValue('modelProviders.anthropic.secret', 'leaked-into-settings');
        assert.equal(settings.modelProviders['anthropic']?.secret, '', 'the secret name is set only by the keychain row, never a text control');
        assert.equal(saves(), 1);
    });

    test('the default provider dropdown lists every recipe', () => {
        const dd = walk(makeTab().tab.getSettingDefinitions()).find(d => d.control?.key === 'defaultModelProvider');
        assert.equal(dd?.control?.type, 'dropdown');
    });
});
