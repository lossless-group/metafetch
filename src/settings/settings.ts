// metafetch/src/settings/settings.ts
import { App, PluginSettingTab, Setting } from 'obsidian';
import MetafetchPlugin from '../../main';

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
};

export class MetafetchSettingTab extends PluginSettingTab {
    plugin: MetafetchPlugin;

    constructor(app: App, plugin: MetafetchPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    /**
     * Build a collapsible <details> section. Each provider gets its own; all
     * default-open for now since we have only a handful. Pass { open: false }
     * once the list grows past ~3 to keep the panel scannable.
     *
     * Uses document.createElement instead of containerEl.createEl because
     * Obsidian's typed createEl overloads for 'details'/'summary' do not
     * accept cls/attr options under exactOptionalPropertyTypes.
     */
    private createSection(title: string, opts: { open?: boolean } = {}): HTMLElement {
        const details = document.createElement('details');
        details.className = 'metafetch-settings-section';
        if (opts.open !== false) details.setAttribute('open', '');

        const summary = document.createElement('summary');
        summary.textContent = title;
        summary.className = 'metafetch-settings-summary';
        details.appendChild(summary);

        this.containerEl.appendChild(details);
        return details;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Metafetch Settings' });

        // ============================================================
        // Provider: OpenGraph.io
        // ============================================================
        const ogIo = this.createSection('Provider: OpenGraph.io');

        new Setting(ogIo)
            .setName('OpenGraph.io API Key')
            .setDesc('Required for the OpenGraph.io commands. Get a free key at https://www.opengraph.io/')
            .addText(text => text
                .setPlaceholder('Enter your API key')
                .setValue(this.plugin.settings.apiKey)
                .onChange(async (value) => {
                    this.plugin.settings.apiKey = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(ogIo)
            .setName('Base URL')
            .setDesc('OpenGraph.io API base URL')
            .addText(text => text
                .setPlaceholder('https://api.opengraph.io')
                .setValue(this.plugin.settings.baseUrl)
                .onChange(async (value) => {
                    this.plugin.settings.baseUrl = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(ogIo)
            .setName('API URL')
            .setDesc('OpenGraph.io API endpoint URL')
            .addText(text => text
                .setPlaceholder('https://opengraph.io/api/1.1/site')
                .setValue(this.plugin.settings.apiUrl)
                .onChange(async (value) => {
                    this.plugin.settings.apiUrl = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(ogIo)
            .setName('Retries')
            .setDesc('Number of retry attempts for failed requests')
            .addSlider(slider => slider
                .setLimits(1, 10, 1)
                .setValue(this.plugin.settings.retries)
                .onChange(async (value: number) => {
                    this.plugin.settings.retries = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(ogIo)
            .setName('Rate Limit')
            .setDesc('Maximum requests per minute')
            .addSlider(slider => slider
                .setLimits(10, 120, 10)
                .setValue(this.plugin.settings.rateLimit)
                .onChange(async (value: number) => {
                    this.plugin.settings.rateLimit = value;
                    await this.plugin.saveSettings();
                }));

        // ============================================================
        // Provider: Microlink
        // ============================================================
        const micro = this.createSection('Provider: Microlink');

        const microIntro = micro.createEl('p', {
            text: 'The free tier allows ~50 requests/day per IP without a key. Add a key here only if you need higher limits.',
        });
        microIntro.addClass('setting-item-description');

        new Setting(micro)
            .setName('Microlink API Key (optional)')
            .setDesc('Sent as the `x-api-key` header. Leave empty to use the anonymous free tier.')
            .addText(text => text
                .setPlaceholder('Optional — paste an API key from microlink.io')
                .setValue(this.plugin.settings.microlinkApiKey)
                .onChange(async (value) => {
                    this.plugin.settings.microlinkApiKey = value;
                    await this.plugin.saveSettings();
                }));

        // ============================================================
        // Provider: Direct Fetch (no settings — informational)
        // ============================================================
        const direct = this.createSection('Provider: Direct Fetch');
        const directIntro = direct.createEl('p', {
            text: 'Fetches the page HTML directly via Obsidian\'s requestUrl and parses Open Graph / Twitter / <title> meta tags inline. No API key, no rate limits, no third party. Best when the page is server-rendered.',
        });
        directIntro.addClass('setting-item-description');

        // ============================================================
        // Field Name Mappings (shared by every fetcher)
        // ============================================================
        const fields = this.createSection('Field Name Mappings', { open: false });

        const fieldsIntro = fields.createEl('p', {
            text: 'Frontmatter keys written by every fetch command. Defaults follow the og_* convention.',
        });
        fieldsIntro.addClass('setting-item-description');

        const fieldRows: Array<[label: string, desc: string, key: keyof MetafetchSettings, defaultPlaceholder: string]> = [
            ['Title', 'Open Graph title', 'titleFieldName', 'og_title'],
            ['Description', 'Open Graph description', 'descriptionFieldName', 'og_description'],
            ['Image', 'Open Graph image URL', 'imageFieldName', 'og_image'],
            ['Favicon', 'Site favicon / logo URL', 'faviconFieldName', 'og_favicon'],
            ['Site Name', 'Open Graph site_name (Microlink: publisher)', 'siteNameFieldName', 'og_site_name'],
            ['Type', 'Open Graph type (e.g. "article", "website")', 'typeFieldName', 'og_type'],
            ['Authors', 'Article authors. Always written as a YAML array (one entry or many).', 'authorsFieldName', 'authors'],
            ['Published Date', 'Article publication date (Microlink: data.date)', 'publishedDateFieldName', 'og_published'],
            ['Fetch Date', 'Timestamp of the last fetch', 'fetchDateFieldName', 'og_last_fetch'],
        ];

        for (const [label, desc, key, placeholder] of fieldRows) {
            new Setting(fields)
                .setName(`${label} field`)
                .setDesc(desc)
                .addText(text => text
                    .setPlaceholder(placeholder)
                    .setValue(this.plugin.settings[key] as string)
                    .onChange(async (value) => {
                        // never write an empty key — fall back to the default
                        (this.plugin.settings[key] as any) = value || placeholder;
                        await this.plugin.saveSettings();
                    }));
        }

        // ============================================================
        // Status
        // ============================================================
        const statusEl = containerEl.createEl('div', {
            text: this.plugin.settings.apiKey
                ? 'OpenGraph.io API key configured'
                : 'OpenGraph.io API key missing — that provider will not work. Microlink (anonymous) and Direct Fetch are unaffected.',
        });
        statusEl.addClass('setting-item-description');
        if (!this.plugin.settings.apiKey) statusEl.addClass('setting-item-warning');
    }
}
