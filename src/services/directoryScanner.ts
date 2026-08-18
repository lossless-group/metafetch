import type { App, TFile, Vault } from 'obsidian';
import type { PluginSettings } from '../types/open-graph-service';
import { extractFrontmatter } from '../utils/yamlFrontmatter';

export interface FileInfo {
  path: string;
  name: string;
  url: string;
  hasOpenGraphData: boolean;
  missingFields: string[];
}

export class DirectoryScanner {
  private vault: Vault;
  private app: App;
  
  constructor(vault: Vault, app: App) {
    this.vault = vault;
    this.app = app;
  }

  async scanForEligibleFiles(directory: string, settings: PluginSettings): Promise<FileInfo[]> {
    const files = this.vault.getMarkdownFiles();
    const eligibleFiles: FileInfo[] = [];

    for (const file of files) {
      // Filter by directory if specified
      if (directory && !file.path.startsWith(directory)) {
        continue;
      }

      const fileInfo = await this.analyzeFile(file, settings);
      if (fileInfo) {
        eligibleFiles.push(fileInfo);
      }
    }

    return eligibleFiles;
  }

  private async analyzeFile(file: TFile, settings: PluginSettings): Promise<FileInfo | null> {
    try {
      const content = await this.vault.read(file);
      const frontmatter = extractFrontmatter(content);

      // Check if file has a URL
      const url = frontmatter?.url;
      if (!url || typeof url !== 'string') {
        return null;
      }

      // Check for missing OpenGraph fields
      const missingFields = this.checkMissingOpenGraphFields(frontmatter, settings);
      const hasOpenGraphData = missingFields.length === 0;

      return {
        path: file.path,
        name: file.name,
        url: url,
        hasOpenGraphData: hasOpenGraphData,
        missingFields: missingFields
      };
    } catch (error) {
      console.error(`Error analyzing file ${file.path}:`, error);
      return null;
    }
  }

  private checkMissingOpenGraphFields(frontmatter: any, settings: PluginSettings): string[] {
    const missingFields: string[] = [];
    
    // Check each configurable field
    const fieldsToCheck = [
      { key: settings.titleFieldName, name: 'title' },
      { key: settings.descriptionFieldName, name: 'description' },
      { key: settings.imageFieldName, name: 'image' }
    ];

    for (const field of fieldsToCheck) {
      if (!frontmatter[field.key] || frontmatter[field.key] === '') {
        missingFields.push(field.name);
      }
    }

    return missingFields;
  }

  async getCurrentWorkingDirectory(): Promise<string> {
    // Get the current active file's directory
    const activeFile = this.app.workspace.getActiveFile();
    
    if (activeFile) {
      const file = this.vault.getAbstractFileByPath(activeFile.path);
      if (file && 'parent' in file && file.parent) {
        return file.parent.path;
      }
    }
    
    // Default to root if no active file
    return '';
  }
}
