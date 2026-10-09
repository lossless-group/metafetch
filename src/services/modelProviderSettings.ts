// Settings rows for model providers, for Obsidian 1.13's declarative
// settings API. Paired with modelRecipes.ts; together they're meant to be
// copied into any Lossless plugin that calls a model (copied, not imported:
// each plugin ships standalone).
//
// Keys are chosen with Obsidian's secret component, which stores the
// secret's *name* in plugin settings and the key itself in Obsidian's
// keychain. The keychain is vault-wide, so one secret named "anthropic"
// serves every plugin that uses it.

import { SecretComponent } from 'obsidian';
import type { App, SettingDefinitionItem, SettingGroupItem } from 'obsidian';
import { BUNDLED_RECIPES, type ModelRecipe, type ProviderSettings } from './modelRecipes';

export const PROVIDERS_KEY = 'modelProviders';
export const DEFAULT_PROVIDER_KEY = 'defaultModelProvider';

export function defaultProviderSettings(): Record<string, ProviderSettings> {
  return Object.fromEntries(BUNDLED_RECIPES.map(r => [r.id, { secret: '', model: r.defaultModel, baseUrl: r.defaultBaseUrl, approvedHosts: '' }]));
}

/** A provider's settings, filled in for recipes added since the settings were saved. */
export function providerSettings(all: Record<string, ProviderSettings>, recipe: ModelRecipe): ProviderSettings {
  const saved = all[recipe.id];
  return {
    secret: saved?.secret ?? '',
    model: saved?.model ?? recipe.defaultModel,
    baseUrl: saved?.baseUrl ?? recipe.defaultBaseUrl,
    approvedHosts: saved?.approvedHosts ?? '',
  };
}

/** Merges saved provider settings onto the defaults, keeping unknown (vault-recipe) entries. */
export function mergeProviderSettings(saved: unknown): Record<string, ProviderSettings> {
  const out = defaultProviderSettings();
  if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
    for (const [id, v] of Object.entries(saved as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue;
      const r = v as Record<string, unknown>;
      const base = out[id] ?? { secret: '', model: '', baseUrl: '', approvedHosts: '' };
      out[id] = {
        secret: typeof r['secret'] === 'string' ? r['secret'] : base.secret,
        model: typeof r['model'] === 'string' ? r['model'] : base.model,
        baseUrl: typeof r['baseUrl'] === 'string' ? r['baseUrl'] : base.baseUrl,
        approvedHosts: typeof r['approvedHosts'] === 'string' ? r['approvedHosts'] : base.approvedHosts,
      };
    }
  }
  return out;
}

export interface ProviderRowsOptions {
  app: App;
  recipes: ModelRecipe[];
  providers: Record<string, ProviderSettings>;
  /** Persists a provider's secret name (the secret row can't be a declarative control). */
  setSecretName: (recipeId: string, name: string) => Promise<void>;
  /** Re-scans the recipes folder and redraws the tab. */
  rescan: () => void;
  recipesRoot: string;
}

/** Control keys for nested provider settings: `modelProviders.<id>.<field>`. */
export const providerKey = (id: string, field: keyof ProviderSettings) => `${PROVIDERS_KEY}.${id}.${field}`;

export function providerDefinitions(o: ProviderRowsOptions): SettingDefinitionItem[] {
  const options: Record<string, string> = {};
  for (const r of o.recipes) options[r.id] = r.title;

  const items: SettingDefinitionItem[] = [
    {
      type: 'group',
      heading: 'Model providers',
      items: [
        {
          name: 'Default model provider',
          desc: 'Used for profile fields with from: [model], unless the profile names another with model: <id>.',
          control: { type: 'dropdown', key: DEFAULT_PROVIDER_KEY, options },
        },
        {
          name: 'Recipes folder',
          desc: `Add any other model API as a recipe file here. ${o.recipes.filter(r => r.origin === 'vault').length} found.`,
          control: { type: 'folder', key: 'recipesRoot', placeholder: o.recipesRoot },
        },
        {
          name: 'Rescan recipes',
          desc: 'Reads the recipes folder again, after you add or edit a recipe file.',
          render: setting => {
            setting.addButton(b => b.setButtonText('Rescan').onClick(() => o.rescan()));
          },
        },
      ],
    },
  ];

  for (const recipe of o.recipes) {
    const p = providerSettings(o.providers, recipe);
    const rows: SettingGroupItem[] = [
      { name: `About ${recipe.title}`, desc: recipe.description },
    ];
    if (recipe.request.auth !== 'none') {
      rows.push({
        name: 'API key',
        desc: 'Stored in Obsidian\'s keychain, never in plugin files. Pick an existing secret or create one; every plugin can share it.',
        render: setting => {
          setting.addComponent(el => new SecretComponent(o.app, el)
            .setValue(p.secret)
            .onChange(name => { void o.setSecretName(recipe.id, name); }));
        },
      });
    }
    rows.push({
      name: 'Model',
      desc: recipe.defaultModel ? `Default: ${recipe.defaultModel}.` : 'The model name your endpoint expects.',
      control: { type: 'text', key: providerKey(recipe.id, 'model'), placeholder: recipe.defaultModel || 'Model name' },
    });
    if (recipe.request.url.includes('{{baseUrl}}')) {
      rows.push({
        name: 'Base URL',
        desc: 'The address before /chat/completions. The key is only ever sent to this host; plain http is allowed only for localhost.',
        control: { type: 'text', key: providerKey(recipe.id, 'baseUrl'), placeholder: recipe.defaultBaseUrl || 'https://' },
      });
    }
    if (recipe.origin === 'vault') {
      rows.push({
        name: 'Approved hosts',
        desc: `This recipe is a vault file, so its key goes nowhere until you approve the host. It sends to: ${recipe.request.url}`,
        control: { type: 'text', key: providerKey(recipe.id, 'approvedHosts'), placeholder: 'api.example.com' },
      });
    }
    items.push({ type: 'group', heading: recipe.title, items: rows });
  }
  return items;
}
