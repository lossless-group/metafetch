import { Notice, Plugin, Editor } from 'obsidian';
import { MetafetchModal } from './src/modals/MetafetchModal';
import { BatchMetafetchModal } from './src/modals/BatchMetafetchModal';
import { OpenGraphSettingTab, DEFAULT_SETTINGS, type OpenGraphSettings } from './src/settings/settings';

export default class MetafetchPlugin extends Plugin {
    settings!: OpenGraphSettings;

    async onload(): Promise<void> {
        await this.loadSettings();

        // Add ribbon icon
        const ribbonIconEl = this.addRibbonIcon(
            'external-link',
            'Fetch Open Graph Data',
            () => {
                new Notice('Metafetch is ready!');
            }
        );
        ribbonIconEl.addClass('metafetch-ribbon-icon');

        // This adds a settings tab so the user can configure various aspects of the plugin
        this.addSettingTab(new OpenGraphSettingTab(this.app, this));

        // Register commands
        this.registerCommands();
    }

    async loadSettings(): Promise<void> {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }

    private registerCommands(): void {
        // Command to fetch OpenGraph data for current file
        this.addCommand({
            id: 'fetch-opengraph-data',
            name: 'Fetch Open Graph Data for Current File',
            editorCallback: (_editor: Editor) => {
                new MetafetchModal(this.app, this).open();
            }
        });

        // Command to batch process multiple files for OpenGraph data
        this.addCommand({
            id: 'batch-fetch-opengraph-data',
            name: 'Batch Fetch Open Graph Data',
            callback: () => {
                new BatchMetafetchModal(this.app, this).open();
            }
        });
    }

    async onunload(): Promise<void> {
        // Clean up any resources if needed
    }
}
