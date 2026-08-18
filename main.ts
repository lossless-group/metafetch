import type { Editor } from 'obsidian';
import { Notice, Plugin, TFile } from 'obsidian';
import { MetafetchModal } from './src/modals/MetafetchModal';
import { BatchMetafetchModal } from './src/modals/BatchMetafetchModal';
import { MetafetchSettingTab, DEFAULT_SETTINGS, type MetafetchSettings } from './src/settings/settings';
import { fetchDirectOpenGraph } from './src/services/directFetchService';
import { fetchMicrolinkOpenGraph } from './src/services/microlinkFetchService';
import type { OpenGraphData } from './src/types/open-graph-service';
import { extractFrontmatter, formatFrontmatter } from './src/utils/yamlFrontmatter';
import { collectFrontmatterUrls } from './src/utils/frontmatterUrls';
import { SelectUrlModal } from './src/modals/SelectUrlModal';
import type { FetchProvider } from './src/modals/SelectUrlModal';
import { stampIdentityCode } from './src/utils/hexCode';

export default class MetafetchPlugin extends Plugin {
    // Obsidian 1.13.0 added `settings?: unknown` to the Plugin base class and
    // asks subclasses to narrow it to a concrete type. `declare` does exactly
    // that — a type-only refinement of the inherited property. Without it TS
    // emits a real field declaration that would clobber the base with
    // `undefined` at construction.
    declare settings: MetafetchSettings;

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

        // Command: pick which frontmatter URL to fetch. Source notes key their
        // URL under whatever property fits the source — arxiv, ssrn, nature,
        // techcrunch — and often carry several at once, so we show them all
        // rather than guessing a precedence order.
        this.addCommand({
            id: 'fetch-from-frontmatter-url',
            name: 'Fetch from a frontmatter URL…',
            editorCallback: (_editor: Editor) => {
                void this.chooseFrontmatterUrl();
            }
        });
    }

    /**
     * Opens the URL picker for the active note. Image-valued fields are kept
     * out of the list so metafetch never offers to fetch its own output.
     */
    private async chooseFrontmatterUrl(): Promise<void> {
        const file = this.app.workspace.getActiveFile();
        if (!file || !(file instanceof TFile)) {
            new Notice('Metafetch: no active file');
            return;
        }

        const content = await this.app.vault.read(file);
        const fm = extractFrontmatter(content);
        const urls = collectFrontmatterUrls(fm, [
            this.settings.imageFieldName,
            this.settings.faviconFieldName,
        ]);

        new SelectUrlModal(this.app, urls, (url, provider) => {
            void this.runFetchScript(provider, url);
        }).open();
    }

    /**
     * @param explicitUrl When given (from the URL picker), fetch this instead
     *                    of the note's `url` property. Without it the two
     *                    single-key commands behave exactly as before.
     */
    private async runFetchScript(provider: FetchProvider, explicitUrl?: string): Promise<void> {
        const file = this.app.workspace.getActiveFile();
        if (!file || !(file instanceof TFile)) {
            new Notice('Metafetch: no active file');
            return;
        }

        const content = await this.app.vault.read(file);
        const fm = extractFrontmatter(content) ?? {};
        const url = explicitUrl ?? (typeof fm.url === 'string' ? fm.url : null);
        if (!url) {
            new Notice('Metafetch: no `url` field in frontmatter — try "Fetch from a frontmatter URL…" to pick another property');
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
            // Only claim the `url` key when the URL came from it (or nothing
            // holds it yet). Fetching the `arxiv:` property shouldn't quietly
            // mint a duplicate `url:` the note never had.
            if (!explicitUrl || !fm.url) next.url = url;
            next[s.titleFieldName] = data.title;
            next[s.descriptionFieldName] = data.description;
            next[s.imageFieldName] = data.image;
            if (data.favicon) next[s.faviconFieldName] = data.favicon;
            if (data.site_name) next[s.siteNameFieldName] = data.site_name;
            if (data.type) next[s.typeFieldName] = data.type;
            if (data.authors && data.authors.length > 0) next[s.authorsFieldName] = data.authors;
            if (data.published) next[s.publishedDateFieldName] = data.published;
            next[s.fetchDateFieldName] = new Date().toISOString();
            stampIdentityCode(this.app, next, s);
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
