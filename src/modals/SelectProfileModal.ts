import { SuggestModal } from 'obsidian';
import type { App } from 'obsidian';
import type { FrontmatterProfile } from '../services/frontmatterProfiles';

/** Shown only when two profiles apply to a note equally specifically. */
export class SelectProfileModal extends SuggestModal<FrontmatterProfile> {
  private chosen = false;

  constructor(app: App, private readonly profiles: FrontmatterProfile[], private readonly onDone: (p: FrontmatterProfile | null) => void) {
    super(app);
    this.setPlaceholder('Pick the frontmatter profile for this note');
  }

  getSuggestions(query: string): FrontmatterProfile[] {
    const q = query.toLowerCase();
    return this.profiles.filter(p => p.title.toLowerCase().includes(q) || p.path.toLowerCase().includes(q));
  }

  renderSuggestion(profile: FrontmatterProfile, el: HTMLElement): void {
    el.createDiv({ text: profile.title });
    el.createEl('small', { text: profile.description || profile.path });
  }

  onChooseSuggestion(profile: FrontmatterProfile): void {
    this.chosen = true;
    this.onDone(profile);
  }

  onClose(): void {
    // onChooseSuggestion runs after onClose in Obsidian; defer so a pick wins.
    window.setTimeout(() => { if (!this.chosen) this.onDone(null); }, 0);
  }
}
