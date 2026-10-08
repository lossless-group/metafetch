// metafetch/src/settings/settings.ts
import type { App, SettingDefinition, SettingDefinitionItem } from 'obsidian';
import { PluginSettingTab } from 'obsidian';
import type MetafetchPlugin from '../../main';

export interface MetafetchSettings {
    // Provider: OpenGraph.io
    apiKey: string;
    baseUrl: string;
    apiUrl: string;
    retries: number;
    backoffDelay: number;
    rateLimit: number;
    cacheDuration: number;

    // Provider: Microlink
    microlinkApiKey: string;

    // Field name mappings (used by every fetcher)
    titleFieldName: string;
    descriptionFieldName: string;
    imageFieldName: string;
    faviconFieldName: string;
    fetchDateFieldName: string;
    siteNameFieldName: string;
    typeFieldName: string;
    authorsFieldName: string;
    publishedDateFieldName: string;

    /** Mint a vault-unique identity code on fetched notes. Off by default. */
    stampHexCode: boolean;
    hexCodeFieldName: string;
    hexCodeLength: number;
}

export const DEFAULT_SETTINGS: MetafetchSettings = {
    apiKey: '',
    baseUrl: 'https://api.opengraph.io',
    apiUrl: 'https://opengraph.io/api/1.1/site',
    retries: 3,
    backoffDelay: 1000,
    rateLimit: 60,
    cacheDuration: 86400, // 24 hours

    microlinkApiKey: '',

    titleFieldName: 'og_title',
    descriptionFieldName: 'og_description',
    imageFieldName: 'og_image',
    faviconFieldName: 'og_favicon',
    fetchDateFieldName: 'og_last_fetch',
    siteNameFieldName: 'og_site_name',
    typeFieldName: 'og_type',
    authorsFieldName: 'authors',
    publishedDateFieldName: 'og_published',

    // Opt-in: this writes a property the note didn't ask for, and it's an
    // identity commitment rather than fetched metadata.
    stampHexCode: false,
    hexCodeFieldName: 'hex_code',
    hexCodeLength: 6,
};

type SettingKey = keyof MetafetchSettings;

function isSettingKey(key: string): key is SettingKey {
    return Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key);
}

/** Frontmatter keys the fetchers write. An emptied one falls back to its default. */
const FIELD_ROWS: Array<[name: string, desc: string, key: SettingKey]> = [
    ['Title field', 'Open Graph title.', 'titleFieldName'],
    ['Description field', 'Open Graph description.', 'descriptionFieldName'],
    ['Image field', 'Open Graph image URL.', 'imageFieldName'],
    ['Favicon field', 'Site favicon URL.', 'faviconFieldName'],
    ['Site name field', 'Open Graph site_name (Microlink: publisher).', 'siteNameFieldName'],
    ['Type field', 'Open Graph type, such as "article" or "website".', 'typeFieldName'],
    ['Authors field', 'Article authors. Always written as a YAML list, one entry or many.', 'authorsFieldName'],
    ['Published date field', 'Article publication date (Microlink: data.date).', 'publishedDateFieldName'],
    ['Fetch date field', 'Timestamp of the last fetch.', 'fetchDateFieldName'],
];

const FIELD_NAME_KEYS = new Set<SettingKey>([...FIELD_ROWS.map(([, , key]) => key), 'hexCodeFieldName']);

/**
 * Declarative settings tab (Obsidian 1.13+). Obsidian renders these
 * definitions and indexes every row for settings search; there is no
 * display() override.
 */
export class MetafetchSettingTab extends PluginSettingTab {
    plugin: MetafetchPlugin;

    constructor(app: App, plugin: MetafetchPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    getControlValue(key: string): unknown {
        return isSettingKey(key) ? this.plugin.settings[key] : undefined;
    }

    async setControlValue(key: string, value: unknown): Promise<void> {
        if (!isSettingKey(key)) return;
        const settings = this.plugin.settings as unknown as Record<SettingKey, unknown>;
        const fallback = DEFAULT_SETTINGS[key];

        if (typeof fallback === 'number') {
            if (typeof value !== 'number' || !Number.isFinite(value)) return;
            settings[key] = value;
        } else if (typeof fallback === 'boolean') {
            settings[key] = value === true;
        } else {
            const text = typeof value === 'string' ? value : '';
            // Never write an empty frontmatter key: fall back to the default.
            settings[key] = FIELD_NAME_KEYS.has(key) ? (text.trim() || fallback) : text;
        }
        await this.plugin.saveSettings();
        // The key-status rows' `visible` predicates depend on the key.
        // refreshDomState() toggles them in place, so typing keeps focus.
        if (key === 'apiKey') this.refreshDomState();
    }

    getSettingDefinitions(): SettingDefinitionItem[] {
        const hasApiKey = () => this.plugin.settings.apiKey.trim().length > 0;
        const fieldRows: SettingDefinition[] = FIELD_ROWS.map(([name, desc, key]) => ({
            name,
            desc,
            control: { type: 'text', key, placeholder: String(DEFAULT_SETTINGS[key]) },
        }));

        return [
            {
                type: 'group',
                heading: 'OpenGraph.io',
                items: [
                    {
                        name: 'OpenGraph.io API key',
                        desc: 'Required for the OpenGraph.io commands. Get a free key at https://www.opengraph.io/',
                        control: { type: 'text', key: 'apiKey', placeholder: 'Enter your API key' },
                    },
                    {
                        name: 'API key status',
                        desc: 'OpenGraph.io API key configured.',
                        visible: hasApiKey,
                    },
                    {
                        name: 'API key status',
                        desc: 'OpenGraph.io API key missing, so that provider will not work. Microlink and Direct Fetch are unaffected.',
                        visible: () => !hasApiKey(),
                    },
                    {
                        name: 'Base URL',
                        desc: 'OpenGraph.io API base URL.',
                        control: { type: 'text', key: 'baseUrl', placeholder: DEFAULT_SETTINGS.baseUrl },
                    },
                    {
                        name: 'API URL',
                        desc: 'OpenGraph.io API endpoint URL.',
                        control: { type: 'text', key: 'apiUrl', placeholder: DEFAULT_SETTINGS.apiUrl },
                    },
                    {
                        name: 'Retries',
                        desc: 'Number of retry attempts for failed requests.',
                        control: { type: 'slider', key: 'retries', min: 1, max: 10, step: 1 },
                    },
                    {
                        name: 'Rate limit',
                        desc: 'Maximum requests per minute.',
                        control: { type: 'slider', key: 'rateLimit', min: 10, max: 120, step: 10 },
                    },
                ],
            },
            {
                type: 'group',
                heading: 'Microlink',
                items: [
                    {
                        name: 'Microlink API key (optional)',
                        desc: 'The free tier allows about 50 requests a day per IP without a key. A key, sent as the x-api-key header, raises the limit.',
                        control: { type: 'text', key: 'microlinkApiKey', placeholder: 'Optional: an API key from microlink.io' },
                    },
                ],
            },
            {
                type: 'group',
                heading: 'Direct fetch',
                items: [
                    {
                        name: 'How Direct Fetch works',
                        desc: 'Fetches the page HTML through Obsidian and reads its Open Graph, Twitter, schema.org, and <title> tags. No API key, no rate limits, no third party. Best when the page is server-rendered. It has no settings.',
                    },
                ],
            },
            {
                type: 'group',
                heading: 'Field names',
                items: [
                    {
                        name: 'Frontmatter keys',
                        desc: 'The properties every fetch command writes. Defaults follow the og_* convention.',
                    },
                    ...fieldRows,
                ],
            },
            {
                type: 'group',
                heading: 'Vault identity code',
                items: [
                    {
                        name: 'Stamp an identity code',
                        desc: 'Mint a short, vault-unique code on each fetched note, so it can be referenced by something steadier than its filename. Written once: an existing code is never overwritten. Off by default, because it writes a property the note did not ask for.',
                        control: { type: 'toggle', key: 'stampHexCode' },
                    },
                    {
                        name: 'Identity code field',
                        desc: 'Frontmatter key that holds the code.',
                        control: { type: 'text', key: 'hexCodeFieldName', placeholder: DEFAULT_SETTINGS.hexCodeFieldName },
                    },
                    {
                        name: 'Code length',
                        desc: 'Characters drawn from a-z and 0-9: 36 possibilities each, not 16. Despite the "hex" name these are not hexadecimal. The wider alphabet costs the same on disk and makes collisions far less likely: 6 characters give 2.18 billion combinations, against 16.7 million for true hex.',
                        control: { type: 'slider', key: 'hexCodeLength', min: 4, max: 12, step: 1 },
                    },
                ],
            },
        ];
    }
}
