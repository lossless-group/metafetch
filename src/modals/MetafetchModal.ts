import type { App } from 'obsidian';
import { Modal } from 'obsidian';
import { OpenGraphService, OpenGraphServiceError } from '../services/openGraphService';
import type { PluginSettings, OpenGraphData } from '../types/open-graph-service';
import { extractFrontmatter, formatFrontmatter } from '../utils/yamlFrontmatter';
import { Typewriter } from '../utils/typewriter';

interface ModalOptions {
  overwriteExisting: boolean;
  createNewProperties: boolean;
  writeErrors: boolean;
  updateFetchDate: boolean;
}

interface MetafetchPlugin {
  settings: PluginSettings;
}

export class MetafetchModal extends Modal {
  private settings: PluginSettings;
  private service: OpenGraphService;
  private options: ModalOptions;
  private statusEl: HTMLElement | null = null;
  private progressBar: HTMLProgressElement | null = null;
  private processing: boolean = false;
  private cancelButton: HTMLButtonElement | null = null;
  private animationFrameId: number | null = null;
  private progressIntervalId: number | null = null;
  private loadingMessageIntervalId: number | null = null;
  private typedInstance: Typewriter | null = null;

  constructor(app: App, plugin: MetafetchPlugin) {
    super(app);
    this.settings = plugin.settings;
    this.service = new OpenGraphService(this.settings);
    this.options = {
      overwriteExisting: false,
      createNewProperties: true,
      writeErrors: true,
      updateFetchDate: true
    };
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    contentEl.empty();
    // Attach to modalEl (outer .modal element) so width rules apply to the popup itself.
    // See content-farm/context-v/issues/Widen-Modals-in-Obsidian-using-CSS.md
    modalEl.addClass('metafetch-modal');
    
    // Create header
    const header = contentEl.createDiv('opengraph-header');
    header.createEl('h2', { text: 'Metafetch', cls: 'opengraph-title' });

    // Create options section with table layout
    const optionsContainer = contentEl.createDiv('opengraph-options-container');
    const optionsTable = optionsContainer.createEl('table', { cls: 'opengraph-options-table' });
    
    const createCheckboxOption = (labelText: string, optionKey: keyof ModalOptions) => {
      const row = optionsTable.createEl('tr', { cls: 'opengraph-option-row' });
      const checkboxCell = row.createEl('td', { cls: 'opengraph-checkbox-cell' });
      const labelCell = row.createEl('td', { cls: 'opengraph-label-cell' });
      
      const checkbox = checkboxCell.createEl('input', { 
        type: 'checkbox',
        cls: 'opengraph-checkbox'
      });
      checkbox.checked = this.options[optionKey] as boolean;
      checkbox.onchange = (e: Event) => {
        const target = e.target as HTMLInputElement;
        const newValue = target.checked;
        (this.options[optionKey] as boolean) = newValue;
        
        // Prevent both overwriteExisting and createNewProperties from being unchecked
        this.handleCheckboxLogic(optionKey, newValue);
      };
      
      const label = labelCell.createEl('label', { 
        text: labelText,
        cls: 'opengraph-option-label'
      });
      label.setAttribute('for', optionKey);
      checkbox.id = optionKey;
    };

    createCheckboxOption('Overwrite Existing OpenGraph Data', 'overwriteExisting');
    createCheckboxOption('Create New YAML Properties if None Exist', 'createNewProperties');
    createCheckboxOption('Write Errors', 'writeErrors');
    createCheckboxOption('Update Fetch Date', 'updateFetchDate');



    // Status and progress
    this.statusEl = contentEl.createDiv('opengraph-status');
    this.statusEl.setText('Ready to fetch metadata');
    
    this.progressBar = contentEl.createEl('progress') as HTMLProgressElement;
    this.progressBar.addClass('opengraph-progress');
    this.progressBar.max = 100;
    this.progressBar.value = 0;

    // Buttons with Obsidian styling
    const buttonContainer = contentEl.createDiv('opengraph-button-container');
    const fetchButton = buttonContainer.createEl('button', { 
      text: 'Fetch for this File',
      cls: 'mod-cta opengraph-fetch-btn'
    });
    fetchButton.onclick = () => {
      this.fetchMetadata();
    };
    
    this.cancelButton = buttonContainer.createEl('button', { 
      text: 'Cancel',
      cls: 'mod-cta-outline opengraph-cancel-btn'
    });
    this.cancelButton.onclick = () => {
      this.close();
    };
    
    // CSS styles are built separately by esbuild and loaded by Obsidian
  }

  onClose(): void {
    this.clearEventListeners();
    this.processing = false;
    // Cancel any ongoing animation
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    // Clear any ongoing progress interval
    if (this.progressIntervalId) {
      clearInterval(this.progressIntervalId);
      this.progressIntervalId = null;
    }
    // Clear any ongoing loading message interval
    this.stopLoadingMessages();
  }

  /**
   * Creative loading messages to cycle through while fetching
   */
  private readonly loadingMessages: string[] = [
    "Plucking the ripe OpenGraph data...",
    "Brewing a fresh cup of metadata...",
    "Summoning the digital spirits of the web...",
    "Decoding the ancient hieroglyphs of HTML...",
    "Teaching robots to read between the lines...",
    "Mining digital gold from the information superhighway...",
    "Consulting the oracle of structured data...",
    "Wrangling wild metadata into submission...",
    "Casting spells to extract hidden treasures...",
    "Navigating the labyrinth of web standards...",
    "Harvesting the fruits of the semantic web...",
    "Unleashing the power of the OpenGraph protocol..."
  ];

  /**
   * Start cycling through loading messages with typing animation
   */
  private startLoadingMessages(): void {
    if (!this.statusEl) return;
    
    // Clear any existing typed instance
    if (this.typedInstance) {
      this.typedInstance.destroy();
      this.typedInstance = null;
    }
    
    // Create a span element for the typing animation
    this.statusEl.empty();
    const typingElement = this.statusEl.createEl('span', { cls: 'typing-element' });
    
    // Cycle the loading messages with the in-repo typewriter animation
    this.typedInstance = new Typewriter(typingElement, {
      strings: this.loadingMessages,
      typeSpeed: 25,
      backSpeed: 30,
      backDelay: 1000,
      loop: true,
      cursorChar: '|',
      smartBackspace: true
    });
  }

  /**
   * Stop cycling loading messages and clean up typed instance
   */
  private stopLoadingMessages(): void {
    // Clear any ongoing interval
    if (this.loadingMessageIntervalId) {
      clearInterval(this.loadingMessageIntervalId);
      this.loadingMessageIntervalId = null;
    }
    
    // Destroy typed instance
    if (this.typedInstance) {
      this.typedInstance.destroy();
      this.typedInstance = null;
    }
  }

  /**
   * Handle checkbox logic to prevent both overwriteExisting and createNewProperties from being unchecked
   */
  private handleCheckboxLogic(changedOption: keyof ModalOptions, newValue: boolean): void {
    // Only handle the two specific options we care about
    if (changedOption !== 'overwriteExisting' && changedOption !== 'createNewProperties') {
      return;
    }

    // If the checkbox was unchecked and both would now be unchecked
    if (!newValue && !this.options.overwriteExisting && !this.options.createNewProperties) {
      // Check the other option to ensure at least one is checked
      const otherOption = changedOption === 'overwriteExisting' ? 'createNewProperties' : 'overwriteExisting';
      this.options[otherOption] = true;
      
      // Update the UI to reflect the change
      const otherCheckbox = document.getElementById(otherOption) as HTMLInputElement;
      if (otherCheckbox) {
        otherCheckbox.checked = true;
      }
    }
  }

  /**
   * Write error information to the file's frontmatter
   */
  private async writeErrorToFrontmatter(url: string, errorMessage: string, error: unknown): Promise<void> {
    try {
      const file = this.app.workspace.getActiveFile();
      if (!file) return;

      const content = await this.app.vault.read(file);
      const existingFrontmatter = extractFrontmatter(content);
      const frontmatterObject: Record<string, any> = existingFrontmatter || {};

      // Add error information
      frontmatterObject.og_error = errorMessage;
      frontmatterObject.og_error_timestamp = new Date().toISOString();
      
      // Add error code if available
      if (error instanceof OpenGraphServiceError) {
        frontmatterObject.og_error_code = error.code;
      }

      // Ensure URL is present
      if (!frontmatterObject.url) {
        frontmatterObject.url = url;
      }

      // Format and update frontmatter
      const newFrontmatter = formatFrontmatter(frontmatterObject);
      
      // Replace or add frontmatter. The `^` anchor matters: unanchored, this
      // matched a `---` thematic break in the BODY of a note that had no
      // frontmatter, mangling the body and then prepending a block on top.
      const newContent = content.replace(/^---\n((?:.|\n)*?)\n---/, `---\n${newFrontmatter}\n---`);
      const finalContent = newContent.startsWith('---') ? newContent : `---\n${newFrontmatter}\n---\n${content}`;
      
      await this.app.vault.modify(file, finalContent);
    } catch (writeError) {
      console.error('Failed to write error to frontmatter:', writeError);
    }
  }

  /**
   * Smoothly animate the progress bar to a target value
   */
  private animateProgressTo(targetValue: number, duration: number = 500): Promise<void> {
    return new Promise((resolve) => {
      if (!this.progressBar) {
        resolve();
        return;
      }

      const startValue = this.progressBar.value;
      const startTime = performance.now();
      const valueChange = targetValue - startValue;

      const animate = (currentTime: number) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Use ease-out cubic function for smooth animation
        const easeOutCubic = 1 - Math.pow(1 - progress, 3);
        const currentValue = startValue + (valueChange * easeOutCubic);
        
        this.progressBar!.value = currentValue;
        
        if (progress < 1) {
          this.animationFrameId = requestAnimationFrame(animate);
        } else {
          this.progressBar!.value = targetValue;
          this.animationFrameId = null;
          resolve();
        }
      };

      this.animationFrameId = requestAnimationFrame(animate);
    });
  }

  /**
   * Animate progress bar incrementally by 10% every 2 seconds, stopping at 90%
   */
  private startIncrementalProgress(): void {
    if (!this.progressBar) return;

    let currentProgress = 0;
    const increment = 10;
    const interval = 2000; // 2 seconds

    const progressInterval = setInterval(() => {
      if (!this.processing || currentProgress >= 90) {
        clearInterval(progressInterval);
        return;
      }

      currentProgress += increment;
      if (currentProgress > 90) currentProgress = 90;
      
      this.animateProgressTo(currentProgress, 300); // Quick 300ms animation for each increment
    }, interval);

    // Store the interval ID for cleanup
    this.progressIntervalId = progressInterval;
  }

  /**
   * Complete the progress bar animation to 100%
   */
  private completeProgress(): Promise<void> {
    // Clear any ongoing incremental progress
    if (this.progressIntervalId) {
      clearInterval(this.progressIntervalId);
      this.progressIntervalId = null;
    }
    
    // Animate to 100%
    return this.animateProgressTo(100, 600);
  }

  private async fetchMetadata(): Promise<void> {
    if (this.processing) return;

    // Validate that at least one action can be performed
    if (!this.options.overwriteExisting && !this.options.createNewProperties) {
      this.statusEl?.setText('Error: At least one action must be enabled (Overwrite Existing or Create New Properties)');
      return;
    }

    this.processing = true;
    
    // Reset progress bar to 0
    if (this.progressBar) {
      this.progressBar.value = 0;
    }
    
    // this.statusEl?.setText('Extracting URL from current file...');
    
    // Get the currently active file
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      this.statusEl?.setText('No active file found');
      this.processing = false;
      return;
    }

    // Extract URL from current file's frontmatter
    const url = await this.service.extractUrlFromCurrentFile(this.app, activeFile);
    if (!url) {
      this.statusEl?.setText('No URL found in current file\'s frontmatter');
      this.processing = false;
      return;
    }
    
    this.statusEl?.setText(`Processing URL: ${url}`);
    await this.processCurrentFile(url);
  }



  private async processCurrentFile(url: string): Promise<void> {
    if (!this.processing) return;

    try {
      // Start cycling loading messages
      this.startLoadingMessages();
      
      // Start incremental progress (10% every 2 seconds, stops at 90%)
      this.startIncrementalProgress();
      
      const data = await this.service.fetchMetadata(url, this.settings);
      
      // Stop loading messages before processing metadata
      this.stopLoadingMessages();
      
      await this.processMetadata(url, data);
      
      // Complete the progress to 100%
      await this.completeProgress();
      
      this.statusEl?.setText(`Successfully fetched and updated OpenGraph data for ${url}`);
      
      // Change Cancel button to Done with CTA styling after successful response
      if (this.cancelButton) {
        this.cancelButton.textContent = 'Done';
        this.cancelButton.removeClass('mod-cta-outline');
        this.cancelButton.addClass('mod-cta');
      }
    } catch (error: unknown) {
      // Stop loading messages on error
      this.stopLoadingMessages();
      
      const errorMessage = error instanceof OpenGraphServiceError 
        ? error.message 
        : 'Unexpected error occurred';
      
      this.statusEl?.setText(`Error processing ${url}: ${errorMessage}`);
      
      // Write error to frontmatter if enabled
      if (this.options.writeErrors) {
        await this.writeErrorToFrontmatter(url, errorMessage, error);
      }
    } finally {
      this.processing = false;
    }
  }

  private clearEventListeners(): void {
    // Clear any event listeners that need cleanup
    // In this case, we don't have any specific event listeners to clear
    // This method is required by the parent Modal class
  }

  private async processMetadata(url: string, data: OpenGraphData): Promise<void> {
    try {
      // Get the currently active file
      const file = this.app.workspace.getActiveFile();
      if (!file) {
        throw new OpenGraphServiceError('No active file found', 'NO_ACTIVE_FILE');
      }

      // Read file content
      const content = await this.app.vault.read(file);

      // Extract existing frontmatter
      const existingFrontmatter = extractFrontmatter(content);
      const frontmatterObject: Record<string, any> = existingFrontmatter || {};

      // Update with new OpenGraph data using configurable field names
      if (this.options.createNewProperties || !frontmatterObject.url) {
        frontmatterObject.url = url;
      }

      // Handle title field - only add if createNewProperties is enabled, or overwrite if enabled
      if ((this.options.createNewProperties && !frontmatterObject[this.settings.titleFieldName]) || 
          (this.options.overwriteExisting && frontmatterObject[this.settings.titleFieldName])) {
        frontmatterObject[this.settings.titleFieldName] = data.title || '';
      }

      // Handle description field - only add if createNewProperties is enabled, or overwrite if enabled
      if ((this.options.createNewProperties && !frontmatterObject[this.settings.descriptionFieldName]) || 
          (this.options.overwriteExisting && frontmatterObject[this.settings.descriptionFieldName])) {
        frontmatterObject[this.settings.descriptionFieldName] = data.description || '';
      }

      // Handle image field - only add if createNewProperties is enabled, or overwrite if enabled
      if ((this.options.createNewProperties && !frontmatterObject[this.settings.imageFieldName]) || 
          (this.options.overwriteExisting && frontmatterObject[this.settings.imageFieldName])) {
        frontmatterObject[this.settings.imageFieldName] = data.image || null;
      }

      // Handle favicon field - only add if createNewProperties is enabled, or overwrite if enabled
      if (data.favicon && ((this.options.createNewProperties && !frontmatterObject[this.settings.faviconFieldName]) || 
          (this.options.overwriteExisting && frontmatterObject[this.settings.faviconFieldName]))) {
        frontmatterObject[this.settings.faviconFieldName] = data.favicon;
      }

      // Handle fetch date - always update if enabled
      if (this.options.updateFetchDate) {
        frontmatterObject[this.settings.fetchDateFieldName] = new Date().toISOString();
      }

      // Clear any previous errors if this is a successful operation
      if (frontmatterObject.og_error) {
        delete frontmatterObject.og_error;
        delete frontmatterObject.og_error_timestamp;
      }

      // Format and update frontmatter
      const newFrontmatter = formatFrontmatter(frontmatterObject);
      
      // Get current content
      const currentContent = await this.app.vault.read(file);
      
      // Replace or add frontmatter
      const newContent = currentContent.replace(/---\n(.*?)\n---/s, `---\n${newFrontmatter}\n---`);
      
      // If no frontmatter was found, add it at the start
      const finalContent = newContent.startsWith('---') ? newContent : `---\n${newFrontmatter}\n---\n${newContent}`;
      
      await this.app.vault.modify(file, finalContent);
      
      // Status message will be set in processCurrentFile after completion
    } catch (error: unknown) {
      console.error('Error processing metadata:', error);
      if (error instanceof OpenGraphServiceError) {
        throw error;
      }
      throw new OpenGraphServiceError(
        `Failed to process metadata for ${url}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'METADATA_PROCESSING_FAILURE'
      );
    }
  }


}
