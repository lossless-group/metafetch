import type { App } from 'obsidian';
import { Modal, TFile } from 'obsidian';
import { OpenGraphService, OpenGraphServiceError } from '../services/openGraphService';
import type { FileInfo } from '../services/directoryScanner';
import { DirectoryScanner } from '../services/directoryScanner';
import type { PluginSettings } from '../types/open-graph-service';
import type { BatchOptions, BatchProgress, ProcessingResult } from '../types/batch-processing';
import { extractFrontmatter, formatFrontmatter } from '../utils/yamlFrontmatter';
import { stampIdentityCode } from '../utils/hexCode';
import { Typewriter } from '../utils/typewriter';

// Type helper for DOM elements
type ObsidianHTMLElement = HTMLElement & {
  createEl: <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    options?: Partial<HTMLElementTagNameMap[K]>,
    callback?: (el: HTMLElementTagNameMap[K]) => void
  ) => HTMLElementTagNameMap[K];
  setText: (text: string) => void;
  addClass: (cls: string) => void;
  toggleClass: (cls: string, condition: boolean) => void;
  find: (selector: string) => HTMLElement | null;
  findAll: (selector: string) => HTMLElement[];
  empty: () => void;
  closest: (selector: string) => HTMLElement | null;
};

interface MetafetchPlugin {
  settings: PluginSettings;
}

export class BatchMetafetchModal extends Modal {
  private settings: PluginSettings;
  private service: OpenGraphService;
  private scanner: DirectoryScanner;
  private targetDirectory: string = '';
  private eligibleFiles: FileInfo[] = [];
  private selectedFiles: Set<string> = new Set();
  private options: BatchOptions;
  private progress: BatchProgress;
  
  // UI Elements
  private directoryEl: HTMLElement | null = null;
  private fileListEl: HTMLElement | null = null;
  private progressEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private progressBar: HTMLProgressElement | null = null;
  private processButton: HTMLButtonElement | null = null;
  private cancelButton: HTMLButtonElement | null = null;
  private animationFrameId: number | null = null;
  private progressIntervalId: number | null = null;
  private loadingMessageIntervalId: number | null = null;
  private typedInstance: Typewriter | null = null;
  /** Identity codes minted during this batch, ahead of the metadata cache. */
  private readonly mintedHexCodes: Set<string> = new Set();

  constructor(app: App, plugin: MetafetchPlugin) {
    super(app);
    this.settings = plugin.settings;
    this.service = new OpenGraphService(this.settings);
    this.scanner = new DirectoryScanner(this.app.vault, this.app);
    
    this.options = {
      overwriteExisting: false,
      createNewProperties: true,
      writeErrors: true,
      updateFetchDate: true,
      batchDelay: 1000
    };

    this.progress = {
      currentFileIndex: 0,
      totalFiles: 0,
      successCount: 0,
      errorCount: 0,
      currentFileName: '',
      isProcessing: false,
      isPaused: false
    };
  }

  async onOpen(): Promise<void> {
    const contentEl = this.contentEl as unknown as ObsidianHTMLElement;
    const { modalEl } = this;
    contentEl.empty();
    // Attach to modalEl (outer .modal element) so width rules apply to the popup itself.
    // See content-farm/context-v/issues/Widen-Modals-in-Obsidian-using-CSS.md
    modalEl.addClass('batch-metafetch-modal');
    
    await this.createHeader(contentEl);
    await this.createDirectorySection(contentEl);
    await this.createFileListSection(contentEl);
    this.createOptionsSection(contentEl);
    this.createProgressSection(contentEl);
    this.createButtonSection(contentEl);
    
    // Initial directory scan
    if (this.targetDirectory) {
      await this.scanCurrentDirectory();
    }
  }

  onClose(): void {
    this.progress.isProcessing = false;
    this.clearEventListeners();
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
      if (!this.progress.isProcessing || currentProgress >= 90) {
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

  /**
   * Handle checkbox logic to prevent both overwriteExisting and createNewProperties from being unchecked
   */
  private handleCheckboxLogic(changedOption: keyof BatchOptions, newValue: boolean): void {
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
      const otherCheckbox = document.querySelector(`input[type="checkbox"][data-option="${otherOption}"]`) as HTMLInputElement;
      if (otherCheckbox) {
        otherCheckbox.checked = true;
      }
    }
  }

  private clearEventListeners(): void {
    // Clear any event listeners that need cleanup
    // In this case, we don't have any specific event listeners to clear
    // This method is required by the parent Modal class
  }

  private async createHeader(contentEl: ObsidianHTMLElement): Promise<void> {
    const header = contentEl.createDiv('opengraph-header');
    header.createEl('h2', { 
      text: 'Metafetch — Batch',
      cls: 'opengraph-title' 
    });
  }

  private async createDirectorySection(contentEl: ObsidianHTMLElement): Promise<void> {
    const section = contentEl.createDiv('opengraph-options-container');
    
    this.directoryEl = section.createDiv('opengraph-directory-info');
    
    const buttonContainer = section.createDiv('opengraph-button-group');
    
    const refreshButton = buttonContainer.createEl('button', { 
      text: 'Refresh Scan',
      cls: 'mod-cta opengraph-fetch-btn'
    });
    refreshButton.onclick = () => this.scanCurrentDirectory();
    
    const selectAllBtn = buttonContainer.createEl('button', { 
      text: 'Select All',
      cls: 'mod-cta opengraph-fetch-btn'
    });
    selectAllBtn.onclick = () => this.selectAllFiles();
    
    const deselectAllBtn = buttonContainer.createEl('button', { 
      text: 'Deselect All',
      cls: 'mod-cta-outline opengraph-cancel-btn'
    });
    deselectAllBtn.onclick = () => this.deselectAllFiles();
  }

  private async createFileListSection(contentEl: ObsidianHTMLElement): Promise<void> {
    const section = contentEl.createDiv('opengraph-file-section');
    section.createEl('h3', { text: 'Eligible Files', cls: 'opengraph-subtitle' });
    
    this.fileListEl = section.createDiv('opengraph-file-list');
  }



  private createOptionsSection(contentEl: ObsidianHTMLElement): void {
    const section = contentEl.createDiv('opengraph-options-section');
    section.createEl('h3', { text: 'Processing Options', cls: 'opengraph-subtitle' });
    
    const optionsTable = section.createEl('table', { cls: 'opengraph-options-table' });
    const optionsGrid = optionsTable.createEl('tbody');
    
    // Create checkbox options
    const createCheckbox = (key: keyof BatchOptions, label: string, description: string) => {
      const row = optionsGrid.createEl('tr', { cls: 'opengraph-option-row' });
      const checkboxCell = row.createEl('td', { cls: 'opengraph-checkbox-cell' });
      const labelCell = row.createEl('td', { cls: 'opengraph-label-cell' });
      
      const container = labelCell.createDiv('opengraph-option-container');
      const checkbox = checkboxCell.createEl('input', {
        type: 'checkbox',
        cls: 'opengraph-checkbox'
      });
      checkbox.setAttribute('data-option', key);
      checkbox.checked = Boolean(this.options[key]);
      checkbox.onchange = (e: Event) => {
        const target = e.target as HTMLInputElement;
        const newValue = target.checked;
        (this.options[key] as boolean) = newValue;
        
        // Prevent both overwriteExisting and createNewProperties from being unchecked
        this.handleCheckboxLogic(key, newValue);
      };
      
      container.createEl('label', {
        text: label,
        cls: 'opengraph-option-label'
      });
      if (description) {
        container.createEl('div', {
          text: description,
          cls: 'opengraph-option-description'
        });
      }
    };

    createCheckbox('overwriteExisting', 'Overwrite Existing Data', 'Replace existing OpenGraph fields');
    createCheckbox('createNewProperties', 'Create New Properties', 'Add OpenGraph fields if missing');
    createCheckbox('writeErrors', 'Write Errors to YAML', 'Include error information in frontmatter');
    createCheckbox('updateFetchDate', 'Update Fetch Date', 'Record when data was fetched');

    // Batch delay slider
    const delayContainer = section.createDiv('batch-delay-container');
    delayContainer.createEl('label', { text: 'Batch Delay (ms):' });
    const delaySlider = delayContainer.createEl('input', { type: 'range' });
    delaySlider.min = '100';
    delaySlider.max = '5000';
    delaySlider.value = this.options.batchDelay.toString();
    const delayValue = delayContainer.createEl('span', { text: this.options.batchDelay.toString() });
    
    delaySlider.oninput = () => {
      this.options.batchDelay = parseInt(delaySlider.value);
      delayValue.textContent = delaySlider.value;
    };
  }

  private createProgressSection(contentEl: ObsidianHTMLElement): void {
    const section = contentEl.createDiv('opengraph-progress-section');
    
    this.statusEl = section.createDiv('opengraph-status');
    
    this.progressBar = section.createEl('progress', {
      cls: 'opengraph-progress',
      value: '0'
    });
    this.progressBar.max = 100;
    
    this.updateProgressDisplay();
  }

  private createButtonSection(contentEl: ObsidianHTMLElement): void {
    const section = contentEl.createDiv('opengraph-button-container');
    section.style.display = 'flex';
    section.style.justifyContent = 'space-between';
    section.style.marginTop = '1em';
    
    const buttonWrapper = section.createDiv('opengraph-button-wrapper');
    buttonWrapper.style.display = 'flex';
    buttonWrapper.style.gap = '8px';
    
    this.processButton = buttonWrapper.createEl('button', {
      text: 'Start Processing',
      cls: 'mod-cta opengraph-fetch-btn'
    });
    this.processButton.onclick = () => this.startBatchProcessing();
    
    this.cancelButton = buttonWrapper.createEl('button', {
      text: 'Cancel',
      cls: 'mod-cta-outline opengraph-cancel-btn'
    });
    this.cancelButton.onclick = () => this.cancelProcessing();
    this.cancelButton.disabled = true;
  }

  private async scanCurrentDirectory(): Promise<void> {
    try {
      this.targetDirectory = await this.scanner.getCurrentWorkingDirectory();
      this.eligibleFiles = await this.scanner.scanForEligibleFiles(this.targetDirectory, this.settings);
      
      this.updateDirectoryDisplay();
      this.updateFileListDisplay();
      this.updateProgressDisplay();
    } catch (error) {
      console.error('Error scanning directory:', error);
      this.statusEl?.setText('Error scanning directory');
    }
  }

  private updateDirectoryDisplay(): void {
    if (!this.directoryEl) return;
    
    this.directoryEl.empty();
    this.directoryEl.createEl('p', { 
      text: `Current Directory: ${this.targetDirectory || 'Root'}` 
    });
    this.directoryEl.createEl('p', { 
      text: `Found ${this.eligibleFiles.length} eligible files` 
    });
  }

  private updateFileListDisplay(): void {
    if (!this.fileListEl) return;
    
    this.fileListEl.empty();
    
    if (this.eligibleFiles.length === 0) {
      this.fileListEl.createEl('p', { 
        text: 'No files found with URLs missing OpenGraph data.',
        cls: 'batch-no-files'
      });
      return;
    }

    const optionsTable = this.fileListEl.createEl('table', { cls: 'opengraph-options-table' });
    const optionsGrid = optionsTable.createEl('tbody');
    
    for (const file of this.eligibleFiles) {
      const row = optionsGrid.createEl('tr', { cls: 'opengraph-option-row' });
      const checkboxCell = row.createEl('td', { cls: 'opengraph-checkbox-cell' });
      const labelCell = row.createEl('td', { cls: 'opengraph-label-cell' });
      
      const container = labelCell.createDiv('opengraph-option-container');
      
      const checkbox = checkboxCell.createEl('input', {
        type: 'checkbox',
        cls: 'opengraph-checkbox'
      });
      checkbox.checked = this.selectedFiles.has(file.path);
      checkbox.onchange = () => {
        if (checkbox.checked) {
          this.selectedFiles.add(file.path);
        } else {
          this.selectedFiles.delete(file.path);
        }
        this.updateProgressDisplay();
      };
      
      // File name
      container.createEl('div', {
        text: file.name,
        cls: 'opengraph-option-label'
      });
      
      // File path
      container.createEl('div', {
        text: file.path,
        cls: 'opengraph-option-description'
      });
      
      // URL
      container.createEl('div', {
        text: `URL: ${file.url}`,
        cls: 'opengraph-option-description'
      });
      
      // Missing fields
      if (file.missingFields.length > 0) {
        container.createEl('div', {
          text: `Missing: ${file.missingFields.join(', ')}`,
          cls: 'opengraph-option-description'
        });
      }
    }
  }



  private selectAllFiles(): void {
    this.selectedFiles.clear();
    for (const file of this.eligibleFiles) {
      this.selectedFiles.add(file.path);
    }
    this.updateFileListDisplay();
    this.updateProgressDisplay();
  }

  private deselectAllFiles(): void {
    this.selectedFiles.clear();
    this.updateFileListDisplay();
    this.updateProgressDisplay();
  }

  private updateProgressDisplay(): void {
    if (!this.progressEl || !this.statusEl) return;
    
    const selectedCount = this.selectedFiles.size;
    this.progressEl.setText(`Selected: ${selectedCount} files`);
    
    if (this.progress.isProcessing) {
      const percentage = this.progress.totalFiles > 0 
        ? Math.round((this.progress.currentFileIndex / this.progress.totalFiles) * 100)
        : 0;
      
      if (this.progressBar) {
        this.progressBar.value = percentage;
      }
      
      this.statusEl.setText(
        `Processing: ${this.progress.currentFileName} ` +
        `(${this.progress.currentFileIndex}/${this.progress.totalFiles}) - ` +
        `Success: ${this.progress.successCount}, Errors: ${this.progress.errorCount}`
      );
    } else {
      if (this.progressBar) {
        this.progressBar.value = 0;
      }
      this.statusEl.setText('Ready to process selected files');
    }
  }

  private async startBatchProcessing(): Promise<void> {
    if (this.selectedFiles.size === 0) {
      this.statusEl?.setText('No files selected for processing');
      return;
    }

    // Validate that at least one action can be performed
    if (!this.options.overwriteExisting && !this.options.createNewProperties) {
      this.statusEl?.setText('Error: At least one action must be enabled (Overwrite Existing or Create New Properties)');
      return;
    }

    this.progress.isProcessing = true;
    this.progress.currentFileIndex = 0;
    this.progress.totalFiles = this.selectedFiles.size;
    this.progress.successCount = 0;
    this.progress.errorCount = 0;
    
    this.processButton!.disabled = true;
    this.cancelButton!.disabled = false;
    
    // Reset progress bar to 0
    if (this.progressBar) {
      this.progressBar.value = 0;
    }
    
    // Start cycling loading messages
    this.startLoadingMessages();
    
    // Start incremental progress (10% every 2 seconds, stops at 90%)
    this.startIncrementalProgress();
    
    const selectedFilePaths = Array.from(this.selectedFiles);
    
    try {
      for (let i = 0; i < selectedFilePaths.length && this.progress.isProcessing; i++) {
        const filePath = selectedFilePaths[i];
        const fileInfo = this.eligibleFiles.find(f => f.path === filePath);
        
        if (!fileInfo) continue;
        
        this.progress.currentFileIndex = i + 1;
        this.progress.currentFileName = fileInfo.name;
        this.updateProgressDisplay();
        
        const result = await this.processFile(fileInfo);
        
        if (result.success) {
          this.progress.successCount++;
        } else {
          this.progress.errorCount++;
        }
        
        // Delay between files
        if (i < selectedFilePaths.length - 1 && this.progress.isProcessing) {
          await new Promise(resolve => setTimeout(resolve, this.options.batchDelay));
        }
      }
      
      // Stop loading messages before completing
      this.stopLoadingMessages();
      
      // Complete the progress to 100%
      await this.completeProgress();
      
      this.finishProcessing();
    } catch {
      // Stop loading messages on error
      this.stopLoadingMessages();
      this.finishProcessing();
    }
  }

  private async processFile(fileInfo: FileInfo): Promise<ProcessingResult> {
    try {
      const data = await this.service.fetchMetadata(fileInfo.url, this.settings);
      await this.updateFileMetadata(fileInfo.path, fileInfo.url, data);
      
      return {
        success: true,
        filePath: fileInfo.path
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof OpenGraphServiceError 
        ? error.message 
        : 'Unknown error occurred';
      
      // Write error to frontmatter if enabled
      if (this.options.writeErrors) {
        await this.writeErrorToFrontmatter(fileInfo.path, fileInfo.url, errorMessage, error);
      }
      
      return {
        success: false,
        error: errorMessage,
        filePath: fileInfo.path
      };
    }
  }

  private async updateFileMetadata(filePath: string, url: string, data: any): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!file || !(file instanceof TFile)) return; // Ensure it's a file, not a folder
    
    const content = await this.app.vault.read(file as any);
    const frontmatter = extractFrontmatter(content);
    
    if (!frontmatter) return;
    
    // Save the original tags if they exist
    const originalTags = frontmatter.tags;
    
    // Update with new OpenGraph data using configurable field names
    if (this.options.createNewProperties || !frontmatter.url) {
      frontmatter.url = url;
    }

    // Handle title field - only add if createNewProperties is enabled, or overwrite if enabled
    if ((this.options.createNewProperties && !frontmatter[this.settings.titleFieldName]) || 
        (this.options.overwriteExisting && frontmatter[this.settings.titleFieldName])) {
      frontmatter[this.settings.titleFieldName] = data.title || '';
    }

    // Handle description field - only add if createNewProperties is enabled, or overwrite if enabled
    if ((this.options.createNewProperties && !frontmatter[this.settings.descriptionFieldName]) || 
        (this.options.overwriteExisting && frontmatter[this.settings.descriptionFieldName])) {
      frontmatter[this.settings.descriptionFieldName] = data.description || '';
    }

    // Handle image field - only add if createNewProperties is enabled, or overwrite if enabled
    if ((this.options.createNewProperties && !frontmatter[this.settings.imageFieldName]) || 
        (this.options.overwriteExisting && frontmatter[this.settings.imageFieldName])) {
      frontmatter[this.settings.imageFieldName] = data.image || null;
    }

    // Handle favicon field - only add if createNewProperties is enabled, or overwrite if enabled
    if (data.favicon && ((this.options.createNewProperties && !frontmatter[this.settings.faviconFieldName]) || 
        (this.options.overwriteExisting && frontmatter[this.settings.faviconFieldName]))) {
      frontmatter[this.settings.faviconFieldName] = data.favicon;
    }

    // Handle fetch date - always update if enabled
    if (this.options.updateFetchDate) {
      frontmatter[this.settings.fetchDateFieldName] = new Date().toISOString();
    }

    // Mint a vault identity code if the user opted in. The run-scoped set
    // covers the window where a code written moments ago hasn't reached
    // Obsidian's metadata cache yet.
    stampIdentityCode(this.app, frontmatter, this.settings, this.mintedHexCodes);

    // Clear any previous errors if this is a successful operation
    if (frontmatter.og_error) {
      delete frontmatter.og_error;
      delete frontmatter.og_error_timestamp;
      delete frontmatter.og_error_code;
    }

    // Restore the original tags if they existed
    if (originalTags !== undefined) {
      frontmatter.tags = originalTags;
    }

    // Get the original content to preserve formatting
    const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
    const match = content.match(frontmatterRegex);
    
    if (match) {
      // Replace only the frontmatter part while preserving the rest of the content
      const updatedFrontmatter = formatFrontmatter(frontmatter);
      const updatedContent = content.replace(frontmatterRegex, `---\n${updatedFrontmatter}\n---`);
      await this.app.vault.modify(file as any, updatedContent);
    } else {
      // Fallback to the original behavior if no frontmatter is found
      const updatedContent = formatFrontmatter(frontmatter);
      await this.app.vault.modify(file as any, updatedContent);
    }
  }



  private cancelProcessing(): void {
    this.progress.isProcessing = false;
    this.finishProcessing();
  }

  private finishProcessing(): void {
    this.progress.isProcessing = false;
    this.processButton!.disabled = false;
    
    // Change Cancel button to Done with CTA styling after successful completion
    if (this.cancelButton) {
      this.cancelButton.textContent = 'Done';
      this.cancelButton.removeClass('mod-cta-outline');
      this.cancelButton.addClass('mod-cta');
      this.cancelButton.disabled = false;
      // Change the onclick handler to close the modal
      this.cancelButton.onclick = () => this.close();
    }
    
    this.statusEl?.setText(
      `Batch processing complete! Successfully processed ${this.progress.successCount} files${this.progress.errorCount > 0 ? `, ${this.progress.errorCount} errors` : ''}`
    );
    
    this.updateProgressDisplay();
  }

  /**
   * Write error information to a file's frontmatter
   */
  private async writeErrorToFrontmatter(filePath: string, url: string, errorMessage: string, error: unknown): Promise<void> {
    try {
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (!file || !(file instanceof TFile)) return;

      const content = await this.app.vault.read(file as any);
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
      
      // Replace or add frontmatter
      const newContent = content.replace(/---\n(.*?)\n---/s, `---\n${newFrontmatter}\n---`);
      const finalContent = newContent.startsWith('---') ? newContent : `---\n${newFrontmatter}\n---\n${content}`;
      
      await this.app.vault.modify(file as any, finalContent);
    } catch (writeError) {
      console.error('Failed to write error to frontmatter:', writeError);
    }
  }
}
