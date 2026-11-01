// "Fetch via <recipe>": runs one data recipe for the active note and writes what
// it found into the note's body, as a JSON fence under the recipe's heading.
// For answers too large to be frontmatter properties, such as funding rounds.

import { Notice, TFile } from 'obsidian';
import type { App } from 'obsidian';
import { fetchRecords, type ModelRecipe, type ProviderSettings } from '../services/modelRecipes';
import { editBody, insertJsonUnderHeading } from '../utils/jsonUnderHeading';
import { extractFrontmatter } from '../utils/yamlFrontmatter';

export interface RecipeCommandOptions {
  recipes: ModelRecipe[];
  providers: Record<string, ProviderSettings>;
  getSecret: (name: string) => string | null;
}

export async function fetchRecipeIntoNote(app: App, recipeId: string, options: RecipeCommandOptions): Promise<void> {
  const recipe = options.recipes.find(r => r.id === recipeId);
  if (!recipe?.writeJsonUnder) {
    new Notice(`Metafetch: the recipe "${recipeId}" is gone. Reload the plugin to remove this command.`);
    return;
  }
  const heading = recipe.writeJsonUnder;
  const file = app.workspace.getActiveFile();
  if (!(file instanceof TFile)) {
    new Notice('Metafetch: no active file');
    return;
  }
  const fm = extractFrontmatter(await app.vault.read(file)) ?? {};
  const url = typeof fm['url'] === 'string' ? fm['url'].trim() : '';
  if (!url) {
    new Notice(`Metafetch (${recipe.title}): this note has no url in its frontmatter.`);
    return;
  }

  const pending = new Notice(`Metafetch (${recipe.title}): looking up ${url}…`, 0);
  let records: unknown[];
  try {
    records = await fetchRecords({
      recipe,
      recipes: options.recipes,
      providers: options.providers,
      getSecret: options.getSecret,
      note: { url, title: typeof fm['title'] === 'string' ? fm['title'] : file.basename },
    });
  } catch (err) {
    new Notice(`Metafetch: ${err instanceof Error ? err.message : `${recipe.title} failed`}`, 15000);
    return;
  } finally {
    pending.hide();
  }

  // Nothing found leaves the note alone, including any block from an earlier run.
  if (records.length === 0) {
    new Notice(`Metafetch (${recipe.title}): nothing found for ${url}.`, 15000);
    return;
  }
  const value = { [recipe.jsonKey ?? 'records']: records };
  await app.vault.process(file, content => editBody(content, body => insertJsonUnderHeading(body, heading, value)));
  new Notice(`Metafetch (${recipe.title}): wrote ${records.length} ${records.length === 1 ? 'record' : 'records'} under "${heading}".`, 15000);
}
