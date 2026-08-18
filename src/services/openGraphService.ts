import type { TFile, App } from 'obsidian';
import { Notice, requestUrl } from 'obsidian';
import type { PluginSettings, OpenGraphData } from '../types/open-graph-service';
import { extractFrontmatter } from '../utils/yamlFrontmatter';

export class OpenGraphServiceError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'OpenGraphServiceError';
  }
}

export class OpenGraphService {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly settings: PluginSettings;
  private readonly cache: Map<string, OpenGraphData>;
  private readonly cacheDuration: number;

  constructor(settings: PluginSettings) {
    this.apiKey = settings.apiKey;
    this.baseUrl = settings.baseUrl;
    this.settings = settings;
    this.cache = new Map();
    this.cacheDuration = settings.cacheDuration;
  }

  private async fetchWithRetry(
    url: string,
    maxRetries: number,
    backoffDelay: number
  ): Promise<OpenGraphData> {
    let currentDelay = backoffDelay;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Use configurable API endpoint format
        const apiUrl = `${this.settings.apiUrl}/${encodeURIComponent(url)}?app_id=${this.apiKey}`;
        
        // Use Obsidian's requestUrl (not browser fetch) per marketplace
        // requirement — bypasses CORS/CSP and threads the request through
        // Obsidian's electron context. `throw: false` keeps non-2xx from
        // throwing so we surface status in the same shape the prior fetch
        // code expected.
        const response = await requestUrl({
          url: apiUrl,
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
          throw: false,
        });

        if (response.status < 200 || response.status >= 300) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = response.json;
        
        // Validate response structure - check for any available data source
        if (!data.hybridGraph && !data.openGraph && !data.htmlInferred) {
          throw new Error('Invalid API response: missing metadata');
        }
        
        // Use hybridGraph as primary source, with fallbacks to openGraph and htmlInferred
        const hybrid = data.hybridGraph || {};
        const og = data.openGraph || {};
        const inferred = data.htmlInferred || {};
        
        // Extract and normalize OpenGraph data using priority: hybridGraph > openGraph > htmlInferred
        const ogData: OpenGraphData = {
          title: hybrid.title || og.title || inferred.title || '',
          description: hybrid.description || og.description || inferred.description || '',
          image: hybrid.image || og.image?.url || og.image || inferred.image || '',
          favicon: hybrid.favicon || og.favicon || inferred.favicon || data.favicon || null,
          url: hybrid.url || og.url || inferred.url || url,
          site_name: hybrid.site_name || og.site_name || inferred.site_name || '',
          type: hybrid.type || og.type || inferred.type || '',
          date: new Date().toISOString()
        };
        
        return ogData;
      } catch (error: unknown) {
        console.error(`OpenGraph fetch attempt ${attempt + 1}/${maxRetries} failed:`, error);
        if (attempt === maxRetries - 1) break;

        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, currentDelay));
        currentDelay *= 2;
      }
    }

    throw new OpenGraphServiceError(
      `Failed to fetch OpenGraph data after ${maxRetries} attempts`,
      'FETCH_FAILURE'
    );
  }

  private isCacheValid(url: string): boolean {
    const cached = this.cache.get(url);
    if (!cached) return false;

    const now = Date.now();
    const cachedTime = Date.parse(cached.date ?? now.toString());
    return now - cachedTime < this.cacheDuration * 1000;
  }

  async fetchMetadata(url: string, settings: PluginSettings): Promise<OpenGraphData> {
    // Check if API key is provided
    if (!this.apiKey || this.apiKey.trim() === '') {
      throw new OpenGraphServiceError(
        'No API key configured. Please add your OpenGraph.io API key in the plugin settings.',
        'NO_API_KEY'
      );
    }

    // Check cache first
    if (this.isCacheValid(url)) {
      return this.cache.get(url)!;
    }

    try {
      const data = await this.fetchWithRetry(
        url,
        settings.retries,
        settings.backoffDelay
      );

      // Add timestamp for cache validation
      data.date = new Date().toISOString();
      
      this.cache.set(url, data);
      return data;
    } catch (error) {
      console.error('OpenGraph fetch error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      new Notice(`Failed to fetch OpenGraph data: ${errorMessage}`);
      throw error;
    }
  }

  async fetchScreenshot(url: string): Promise<string> {
    // Check if API key is provided
    if (!this.apiKey || this.apiKey.trim() === '') {
      throw new OpenGraphServiceError(
        'No API key configured. Please add your OpenGraph.io API key in the plugin settings.',
        'NO_API_KEY'
      );
    }

    try {
      // Obsidian's requestUrl over native fetch (marketplace requirement).
      const response = await requestUrl({
        url: `${this.baseUrl}/v1/screenshot`,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url }),
        throw: false,
      });

      if (response.status < 200 || response.status >= 300) {
        throw new Error(`Screenshot fetch failed: ${response.status}`);
      }

      const data = response.json;
      return data.url;
    } catch (error: unknown) {
      console.error('Screenshot fetch error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      throw new OpenGraphServiceError(
        `Failed to fetch screenshot for ${url}: ${errorMessage}`,
        'SCREENSHOT_FAILURE'
      );
    }
  }

  clearCache(): void {
    this.cache.clear();
  }

  invalidateCacheEntry(url: string): void {
    this.cache.delete(url);
  }

  /**
   * Extract URL from the current file's YAML frontmatter
   */
  async extractUrlFromCurrentFile(app: App, file: TFile): Promise<string | null> {
    try {
      const content = await app.vault.read(file);
      const frontmatter = extractFrontmatter(content);
      
      if (frontmatter && frontmatter.url && typeof frontmatter.url === 'string') {
        return frontmatter.url;
      }
      
      return null;
    } catch (error) {
      console.error(`Error extracting URL from file ${file.path}:`, error);
      return null;
    }
  }

  /**
   * Find URLs in all files within a target directory
   * This will be implemented later as requested
   */
  async findUrlsInTargetDir(_app: App, _targetPath: string): Promise<string[]> {
    // TODO: Implement this method when needed
    // Should search for URLs in frontmatter of files in the specified directory
    return [];
  }
}
