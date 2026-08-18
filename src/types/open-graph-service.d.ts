import type { PluginSettingTab } from 'obsidian';

export interface PluginSettings {
  apiKey: string;
  baseUrl: string;
  apiUrl: string;
  retries: number;
  backoffDelay: number;
  rateLimit: number;
  cacheDuration: number;
  // Field name mappings
  titleFieldName: string;
  descriptionFieldName: string;
  imageFieldName: string;
  faviconFieldName: string;
  fetchDateFieldName: string;
  // Vault identity code — see src/utils/hexCode.ts
  stampHexCode: boolean;
  hexCodeFieldName: string;
  hexCodeLength: number;
}

export interface OpenGraphData {
  title: string;
  description: string;
  image: string | null;
  favicon: string | null;
  url: string;
  type: string;
  site_name: string;
  authors?: string[];
  published?: string;
  error?: string;
  date?: string;
  fetchDate?: string;
}

export interface MetafetchPluginSettingsTab extends PluginSettingTab {
  plugin: MetafetchPlugin;
}
