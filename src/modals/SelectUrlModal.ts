import type { App } from 'obsidian';
import { Modal, Setting } from 'obsidian';
import type { FrontmatterUrl } from '../utils/frontmatterUrls';

export type FetchProvider = 'direct' | 'microlink';

/**
 * Picks which frontmatter URL to fetch, and with which provider.
 *
 * Source notes don't reliably key their URL as `url`. A paper might be under
 * `arxiv:`, a journal article under `nature:` or `ssrn:`, a news piece under
 * `techcrunch:` — and a single note often carries several. Rather than guess a
 * precedence order, we show what's there and let the human choose.
 *
 * Built from Obsidian's `Setting` component rather than custom markup: the
 * plugin's own stylesheet doesn't currently ship (see the CSS note in the
 * source-note spec), and native components are styled by the app regardless of
 * that, in whatever theme the user runs.
 */
export class SelectUrlModal extends Modal {
  private readonly urls: FrontmatterUrl[];
  private readonly onChoose: (url: string, provider: FetchProvider) => void;
  private provider: FetchProvider = 'direct';

  constructor(
    app: App,
    urls: FrontmatterUrl[],
    onChoose: (url: string, provider: FetchProvider) => void
  ) {
    super(app);
    this.urls = urls;
    this.onChoose = onChoose;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.setTitle('Fetch metadata from frontmatter URL');

    if (this.urls.length === 0) {
      contentEl.createEl('p', {
        text: 'No http(s) URLs found in this note\'s frontmatter. Add one under any property name — url, arxiv, doi, techcrunch — and run this again.',
      });
      new Setting(contentEl).addButton((btn) =>
        btn.setButtonText('Close').onClick(() => this.close())
      );
      return;
    }

    new Setting(contentEl)
      .setName('Provider')
      .setDesc('Direct parses the page HTML itself. Microlink uses their API (free tier ~50/day).')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('direct', 'Direct fetch')
          .addOption('microlink', 'Microlink')
          .setValue(this.provider)
          .onChange((value) => {
            this.provider = value as FetchProvider;
          })
      );

    contentEl.createEl('p', {
      text: this.urls.length === 1
        ? 'One URL found:'
        : `${this.urls.length} URLs found — choose one:`,
    });

    for (const entry of this.urls) {
      new Setting(contentEl)
        .setName(entry.key)
        .setDesc(entry.url)
        .addButton((btn) => {
          btn.setButtonText('Fetch').onClick(() => {
            this.close();
            this.onChoose(entry.url, this.provider);
          });
          // Single candidate is almost certainly the intended one — make it the
          // call-to-action so the choice is one click, not a hunt.
          if (this.urls.length === 1) btn.setCta();
        });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
