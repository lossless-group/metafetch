// Loads main.ts's plugin class against the obsidian stub, whose
// addSettingTab() calls getSettingDefinitions() as Obsidian 1.13+ does, and
// asserts onload() completes and registers every command. A settings tab
// that throws while building its definitions fails here as it would in the
// app, where it takes the commands registered after it down too.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import MetafetchPlugin from '../main';
import { DEFAULT_SETTINGS } from '../src/settings/settings';

interface StubPlugin {
    commands: { id: string; name: string }[];
    settingTabs: { settingItems: unknown[] }[];
    ribbonIcons: { icon: string; title: string }[];
    storedData: unknown;
    settings: Record<string, unknown>;
    onload(): Promise<void>;
}

// Every command ID 0.1.7 registers. IDs are what user hotkeys bind to, so
// they must not change.
const COMMAND_IDS = [
    'fetch-opengraph-data',
    'batch-fetch-opengraph-data',
    'direct-fetch-from-script',
    'fetch-via-microlink',
    'fetch-from-frontmatter-url',
];

function makePlugin(storedData: unknown = null): StubPlugin {
    const app = { workspace: {}, vault: {}, metadataCache: {}, fileManager: {} };
    const manifest = { id: 'metafetch', name: 'Metafetch', version: '0.0.0' };
    const Ctor = MetafetchPlugin as unknown as new (app: unknown, manifest: unknown) => StubPlugin;
    const plugin = new Ctor(app, manifest);
    plugin.storedData = storedData;
    return plugin;
}

describe('plugin onload()', () => {
    test('registers every command, with no duplicates', async () => {
        const plugin = makePlugin();
        await plugin.onload();
        const ids = plugin.commands.map(c => c.id);
        assert.equal(ids.length, COMMAND_IDS.length);
        assert.deepEqual([...ids].sort(), [...COMMAND_IDS].sort());
        for (const c of plugin.commands) assert.ok(c.name.trim(), `command ${c.id} has no name`);
    });

    test('adds the settings tab and its definitions build during addSettingTab()', async () => {
        const plugin = makePlugin();
        await plugin.onload();
        assert.equal(plugin.settingTabs.length, 1);
        assert.ok(plugin.settingTabs[0]!.settingItems.length > 0, 'settings tab produced no definitions');
        assert.equal(plugin.ribbonIcons.length, 1);
    });

    test('loads with no data.json and with a stored data.json', async () => {
        const fresh = makePlugin(null);
        await fresh.onload();
        assert.deepEqual(fresh.settings, DEFAULT_SETTINGS);

        // Shaped like a 0.1.x data.json: a key, a renamed field, an opt-in.
        const stored = makePlugin({ apiKey: 'og_test', imageFieldName: 'cover', stampHexCode: true });
        await stored.onload();
        assert.equal(stored.settings['apiKey'], 'og_test');
        assert.equal(stored.settings['imageFieldName'], 'cover');
        assert.equal(stored.settings['stampHexCode'], true);
        assert.equal(stored.settings['titleFieldName'], DEFAULT_SETTINGS.titleFieldName);
        assert.equal(stored.commands.length, COMMAND_IDS.length);
    });

    test('editing loaded settings never mutates DEFAULT_SETTINGS', async () => {
        const plugin = makePlugin(null);
        await plugin.onload();
        plugin.settings['imageFieldName'] = 'changed';
        assert.equal(DEFAULT_SETTINGS.imageFieldName, 'og_image');
    });
});
