import { Notice, Plugin, Editor, TFile } from 'obsidian';
import { MetafetchModal } from './src/modals/MetafetchModal';
import { BatchMetafetchModal } from './src/modals/BatchMetafetchModal';
import { MetafetchSettingTab, DEFAULT_SETTINGS, type MetafetchSettings } from './src/settings/settings';
import { fetchDirectOpenGraph } from './src/services/directFetchService';
import { fetchMicrolinkOpenGraph } from './src/services/microlinkFetchService';
import { OpenGraphData } from './src/types/open-graph-service';
import { extractFrontmatter, formatFrontmatter } from './src/utils/yamlFrontmatter';

export default class MetafetchPlugin extends Plugin {
    settings!: MetafetchSettings;

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
        this.addSettingTab(new MetafetchSettingTab(this.app, this));

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

        // Command: parse Open Graph meta tags directly from page HTML, no third-party API
        this.addCommand({
            id: 'direct-fetch-from-script',
            name: 'Direct Fetch from Script',
            editorCallback: (_editor: Editor) => {
                void this.runFetchScript('direct');
            }
        });

        // Command: fetch via Microlink API (free tier 50/day, anonymous)
        this.addCommand({
            id: 'fetch-via-microlink',
            name: 'Fetch via Microlink',
            editorCallback: (_editor: Editor) => {
                void this.runFetchScript('microlink');
            }
        });
    }

    private async runFetchScript(provider: 'direct' | 'microlink'): Promise<void> {
        const file = this.app.workspace.getActiveFile();
        if (!file || !(file instanceof TFile)) {
            new Notice('Metafetch: no active file');
            return;
        }

        const content = await this.app.vault.read(file);
        const fm = extractFrontmatter(content) ?? {};
        const url = typeof fm.url === 'string' ? fm.url : null;
        if (!url) {
            new Notice('Metafetch: no `url` field in frontmatter');
            return;
        }

        const label = provider === 'microlink' ? 'Microlink' : 'direct';
        const pending = new Notice(`Metafetch (${label}): fetching ${url}…`, 0);
        try {
            const data: OpenGraphData =
                provider === 'microlink'
                    ? await fetchMicrolinkOpenGraph(url, this.settings.microlinkApiKey)
                    : await fetchDirectOpenGraph(url);
            const s = this.settings;

            const next: Record<string, any> = { ...fm };
            next.url = url;
            next[s.titleFieldName] = data.title;
            next[s.descriptionFieldName] = data.description;
            next[s.imageFieldName] = data.image;
            if (data.favicon) next[s.faviconFieldName] = data.favicon;
            if (data.site_name) next[s.siteNameFieldName] = data.site_name;
            if (data.type) next[s.typeFieldName] = data.type;
            if (data.authors && data.authors.length > 0) next[s.authorsFieldName] = data.authors;
            if (data.published) next[s.publishedDateFieldName] = data.published;
            next[s.fetchDateFieldName] = new Date().toISOString();
            delete next.og_error;
            delete next.og_error_timestamp;
            delete next.og_error_code;

            const newFrontmatter = formatFrontmatter(next);
            const frontmatterRegex = /^---\n((?:.|\n)*?)\n---/;
            const newContent = content.match(frontmatterRegex)
                ? content.replace(frontmatterRegex, `---\n${newFrontmatter}\n---`)
                : `---\n${newFrontmatter}\n---\n${content}`;
            await this.app.vault.modify(file, newContent);

            pending.hide();
            new Notice(`Metafetch (${label}): ${data.title || url}`);
        } catch (err) {
            pending.hide();
            const msg = err instanceof Error ? err.message : 'Unknown error';
            new Notice(`Metafetch (${label}) failed — ${msg}`);
            console.error(`Metafetch ${label} fetch error:`, err);
        }
    }

    async onunload(): Promise<void> {
        // Clean up any resources if needed
    }
}
