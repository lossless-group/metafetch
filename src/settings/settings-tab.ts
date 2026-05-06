import { PluginSettingTab, Setting, App } from 'obsidian';
import MetafetchPlugin from '../../main';

export class MetafetchPluginSettingsTab extends PluginSettingTab {
    plugin: MetafetchPlugin;

    constructor(app: App, plugin: MetafetchPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Metafetch Settings' });

        new Setting(containerEl)
            .setName('OpenGraph API Key')
            .setDesc('Your OpenGraph.io API key')
            .addText((text) => {
                text
                    .setPlaceholder('Enter your API key')
                    .setValue(this.plugin.settings.apiKey)
                    .onChange(async (value: string) => {
                        this.plugin.settings.apiKey = value;
                        this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName('Base URL')
            .setDesc('OpenGraph API base URL')
            .addText((text) => {
                text
                    .setPlaceholder('https://api.opengraph.io')
                    .setValue(this.plugin.settings.baseUrl)
                    .onChange(async (value: string) => {
                        this.plugin.settings.baseUrl = value;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName('Retries')
            .setDesc('Number of retries for failed requests')
            .addSlider((slider) => {
                slider
                    .setLimits(0, 10, 1)
                    .setValue(this.plugin.settings.retries)
                    .onChange(async (value: number) => {
                        this.plugin.settings.retries = value;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName('Backoff Delay (ms)')
            .setDesc('Delay between retries in milliseconds')
            .addSlider((slider) => {
                slider
                    .setLimits(0, 5000, 100)
                    .setValue(this.plugin.settings.backoffDelay)
                    .onChange(async (value: number) => {
                        this.plugin.settings.backoffDelay = value;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName('Rate Limit')
            .setDesc('Maximum requests per minute')
            .addSlider((slider) => {
                slider
                    .setLimits(0, 100, 1)
                    .setValue(this.plugin.settings.rateLimit)
                    .onChange(async (value: number) => {
                        this.plugin.settings.rateLimit = value;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName('Cache Duration (hours)')
            .setDesc('How long to cache responses')
            .addSlider((slider) => {
                slider
                    .setLimits(0, 24 * 7, 1)
                    .setValue(this.plugin.settings.cacheDuration / 3600)
                    .onChange(async (value: number) => {
                        this.plugin.settings.cacheDuration = value * 3600;
                        await this.plugin.saveSettings();
                    });
            });

        containerEl.empty();
        containerEl.createEl('h2', { text: 'Metafetch Settings' });

        new Setting(containerEl)
            .setName('OpenGraph API Key')
            .setDesc('Your OpenGraph.io API key')
            .addText((text) => {
                text
                    .setPlaceholder('Enter your API key')
                    .setValue(this.plugin.settings.apiKey)
                    .onChange(async (value: string) => {
                        this.plugin.settings.apiKey = value;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName('Base URL')
            .setDesc('Base URL for OpenGraph.io API')
            .addText((text) => {
                text
                    .setPlaceholder('Enter API base URL')
                    .setValue(this.plugin.settings.baseUrl)
                    .onChange(async (value: string) => {
                        this.plugin.settings.baseUrl = value;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName('Retries')
            .setDesc('Number of retry attempts for failed requests')
            .addSlider((slider) => {
                slider
                    .setLimits(0, 10, 1)
                    .setValue(this.plugin.settings.retries)
                    .onChange(async (value: number) => {
                        this.plugin.settings.retries = value;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName('Backoff Delay')
            .setDesc('Delay between retry attempts (in milliseconds)')
            .addSlider((slider) => {
                slider
                    .setLimits(0, 5000, 100)
                    .setValue(this.plugin.settings.backoffDelay)
                    .onChange(async (value: number) => {
                        this.plugin.settings.backoffDelay = value;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName('Rate Limit')
            .setDesc('Maximum requests per minute')
            .addSlider((slider) => {
                slider
                    .setLimits(0, 100, 1)
                    .setValue(this.plugin.settings.rateLimit)
                    .onChange(async (value: number) => {
                        this.plugin.settings.rateLimit = value;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName('Cache Duration')
            .setDesc('Cache duration in seconds')
            .addSlider((slider) => {
                slider
                    .setLimits(0, 86400, 3600)
                    .setValue(this.plugin.settings.cacheDuration)
                    .onChange(async (value: number) => {
                        this.plugin.settings.cacheDuration = value;
                        await this.plugin.saveSettings();
                    });
            });

        containerEl.empty();
        containerEl.createEl('h2', { text: 'Metafetch Settings' });

        new Setting(containerEl)
            .setName('OpenGraph API Key')
            .setDesc('Your OpenGraph.io API key')
            .addText((text) => {
                text
                    .setPlaceholder('Enter your API key')
                    .setValue(this.plugin.settings.apiKey)
                    .onChange(async (value: string) => {
                        this.plugin.settings.apiKey = value;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName('Base URL')
            .setDesc('Base URL for OpenGraph.io API')
            .addText((text) => {
                text
                    .setPlaceholder('Enter API base URL')
                    .setValue(this.plugin.settings.baseUrl)
                    .onChange(async (value: string) => {
                        this.plugin.settings.baseUrl = value;
                        await this.plugin.saveSettings();
                    });
            });


        new Setting(containerEl)
            .setName('Backoff Delay')
            .setDesc('Delay between retry attempts (in milliseconds)')
            .addSlider((slider) => {
                slider
                    .setLimits(0, 5000, 100)
                    .setValue(this.plugin.settings.backoffDelay)
                    .onChange(async (value: number) => {
                        this.plugin.settings.backoffDelay = value;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName('Rate Limit')
            .setDesc('Maximum requests per minute')
            .addSlider((slider) => {
                slider
                    .setLimits(0, 100, 1)
                    .setValue(this.plugin.settings.rateLimit)
                    .onChange(async (value: number) => {
                        this.plugin.settings.rateLimit = value;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName('Cache Duration')
            .setDesc('Cache duration in seconds')
            .addSlider((slider) => {
                slider
                    .setLimits(0, 86400, 3600)
                    .setValue(this.plugin.settings.cacheDuration)
                    .onChange(async (value: number) => {
                        this.plugin.settings.cacheDuration = value;
                        await this.plugin.saveSettings();
                    });
            });
    }
}
