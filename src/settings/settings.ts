// metafetch/src/settings/settings.ts
import { App, PluginSettingTab, Setting } from 'obsidian';
import MetafetchPlugin from '../../main';

export interface MetafetchSettings {
    apiKey: string;
    baseUrl: string;
    apiUrl: string;
    retries: number;
    backoffDelay: number;
    rateLimit: number;
    cacheDuration: number;
    // Field name mappings
    titleFieldName: string;
    descriptionFieldName: string;
    imageFieldName: string;
    faviconFieldName: string;
    fetchDateFieldName: string;
}

export const DEFAULT_SETTINGS: MetafetchSettings = {
    apiKey: '',
    baseUrl: 'https://api.opengraph.io',
    apiUrl: 'https://opengraph.io/api/1.1/site',
    retries: 3,
    backoffDelay: 1000,
    rateLimit: 60,
    cacheDuration: 86400, // 24 hours
    // Default field names
    titleFieldName: 'og_title',
    descriptionFieldName: 'og_description',
    imageFieldName: 'og_image',
    faviconFieldName: 'og_favicon',
    fetchDateFieldName: 'og_last_fetch'
};

export class MetafetchSettingTab extends PluginSettingTab {
    plugin: MetafetchPlugin;

    constructor(app: App, plugin: MetafetchPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Metafetch Settings' });

        // API Key setting
        new Setting(containerEl)
            .setName('OpenGraph.io API Key')
            .setDesc('Enter your OpenGraph.io API key. Get your free key from https://www.opengraph.io/')
            .addText(text => text
                .setPlaceholder('Enter your API key')
                .setValue(this.plugin.settings.apiKey)
                .onChange(async (value) => {
                    this.plugin.settings.apiKey = value;
                    await this.plugin.saveSettings();
                }));

        // Base URL setting
        new Setting(containerEl)
            .setName('Base URL')
            .setDesc('OpenGraph.io API base URL')
            .addText(text => text
                .setPlaceholder('https://api.opengraph.io')
                .setValue(this.plugin.settings.baseUrl)
                .onChange(async (value) => {
                    this.plugin.settings.baseUrl = value;
                    await this.plugin.saveSettings();
                }));

        // API URL setting
        new Setting(containerEl)
            .setName('API URL')
            .setDesc('OpenGraph.io API endpoint URL')
            .addText(text => text
                .setPlaceholder('https://opengraph.io/api/1.1/site')
                .setValue(this.plugin.settings.apiUrl)
                .onChange(async (value) => {
                    this.plugin.settings.apiUrl = value;
                    await this.plugin.saveSettings();
                }));

        // Retries setting
        new Setting(containerEl)
            .setName('Retries')
            .setDesc('Number of retry attempts for failed requests')
            .addSlider(slider => slider
                .setLimits(1, 10, 1)
                .setValue(this.plugin.settings.retries)
                .onChange(async (value: number) => {
                    this.plugin.settings.retries = value;
                    await this.plugin.saveSettings();
                }));

        // Rate limit setting
        new Setting(containerEl)
            .setName('Rate Limit')
            .setDesc('Maximum requests per minute')
            .addSlider(slider => slider
                .setLimits(10, 120, 10)
                .setValue(this.plugin.settings.rateLimit)
                .onChange(async (value: number) => {
                    this.plugin.settings.rateLimit = value;
                    await this.plugin.saveSettings();
                }));

        // Field name mappings section
        containerEl.createEl('h3', { text: 'Field Name Mappings' });
        const fieldMappingDesc = containerEl.createEl('p', { 
            text: 'Customize the field names used in your frontmatter for OpenGraph metadata.'
        });
        fieldMappingDesc.addClass('setting-item-description');

        // Title field name
        new Setting(containerEl)
            .setName('Title Field Name')
            .setDesc('Field name for the OpenGraph title')
            .addText(text => text
                .setPlaceholder('og_title')
                .setValue(this.plugin.settings.titleFieldName)
                .onChange(async (value) => {
                    this.plugin.settings.titleFieldName = value || 'og_title';
                    await this.plugin.saveSettings();
                }));

        // Description field name
        new Setting(containerEl)
            .setName('Description Field Name')
            .setDesc('Field name for the OpenGraph description')
            .addText(text => text
                .setPlaceholder('og_description')
                .setValue(this.plugin.settings.descriptionFieldName)
                .onChange(async (value) => {
                    this.plugin.settings.descriptionFieldName = value || 'og_description';
                    await this.plugin.saveSettings();
                }));

        // Image field name
        new Setting(containerEl)
            .setName('Image Field Name')
            .setDesc('Field name for the OpenGraph image URL')
            .addText(text => text
                .setPlaceholder('og_image')
                .setValue(this.plugin.settings.imageFieldName)
                .onChange(async (value) => {
                    this.plugin.settings.imageFieldName = value || 'og_image';
                    await this.plugin.saveSettings();
                }));

        // Favicon field name
        new Setting(containerEl)
            .setName('Favicon Field Name')
            .setDesc('Field name for the website favicon URL')
            .addText(text => text
                .setPlaceholder('og_favicon')
                .setValue((this.plugin.settings as any).faviconFieldName || 'og_favicon')
                .onChange(async (value) => {
                    (this.plugin.settings as any).faviconFieldName = value || 'og_favicon';
                    await this.plugin.saveSettings();
                }));

        // Fetch date field name
        new Setting(containerEl)
            .setName('Fetch Date Field Name')
            .setDesc('Field name for the last fetch timestamp')
            .addText(text => text
                .setPlaceholder('og_last_fetch')
                .setValue(this.plugin.settings.fetchDateFieldName)
                .onChange(async (value) => {
                    this.plugin.settings.fetchDateFieldName = value || 'og_last_fetch';
                    await this.plugin.saveSettings();
                }));

        // Status message
        const statusEl = containerEl.createEl('div', { 
            text: this.plugin.settings.apiKey 
                ? '✅ API key configured'
                : '⚠️ No API key configured - OpenGraph fetching will not work'
        });
        statusEl.addClass('setting-item-description');
        
        // Add warning styling for missing API key
        if (!this.plugin.settings.apiKey) {
            statusEl.addClass('setting-item-warning');
        }
    }
}
