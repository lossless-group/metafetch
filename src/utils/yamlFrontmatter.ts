import type { TFile } from 'obsidian';

/**
 * True when a value is an Obsidian wikilink (`[[Note]]`, `[[Note|Alias]]`,
 * `[[Note#Heading]]`). Wikilinks LOOK like a YAML flow sequence because they
 * open with `[` and close with `]`, but they are opaque strings — unquoted,
 * a real YAML parser reads `[[Ada Lovelace]]` as the nested array
 * `[["Ada Lovelace"]]`, not as a link. So they must never be parsed as a flow
 * sequence, and must always be written back quoted.
 */
function isWikilink(value: string): boolean {
  return value.startsWith('[[') && value.endsWith(']]');
}

/**
 * True when a string cannot be written as a bare YAML scalar — i.e. quoting is
 * required for correctness, not style.
 *
 * Used for sequence ITEMS only. Scalar values are still quoted unconditionally
 * (see formatFrontmatter) because URLs routinely carry YAML-unsafe characters
 * and blanket quoting there is the safer default. That reasoning never applied
 * to items like `- ai`, which produced noisy `- "ai"` churn on every write.
 */
function needsYamlQuoting(value: string): boolean {
  if (value === '') return true;
  if (value !== value.trim()) return true;                    // leading/trailing space
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(value)) return true;     // YAML indicator char first
  if (/:\s|\s#/.test(value)) return true;                     // reads as mapping / comment
  if (value.includes(',')) return true;                       // safe bare in block, not in flow
  if (/[\n\r]/.test(value)) return true;                      // multiline
  // Bare forms that would change TYPE when read back
  if (/^(true|false|null|~|yes|no|on|off)$/i.test(value)) return true;
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(value)) return true;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return true;          // date-ish
  return false;
}

/**
 * Strips one layer of matching quotes from a YAML scalar, unescaping \" and \\
 * for double-quoted values to mirror what formatFrontmatter wrote.
 */
function unquoteScalar(value: string): string {
  const isDoubleQuoted = value.startsWith('"') && value.endsWith('"') && value.length >= 2;
  const isSingleQuoted = value.startsWith("'") && value.endsWith("'") && value.length >= 2;
  if (isDoubleQuoted) {
    return value.substring(1, value.length - 1)
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
  if (isSingleQuoted) {
    return value.substring(1, value.length - 1);
  }
  return value;
}

/**
 * Splits the inside of a YAML flow sequence on commas that sit OUTSIDE quotes,
 * so `"a, b", c` yields two items rather than three.
 */
function splitFlowSequence(inner: string): string[] {
  const items: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (const char of inner) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\' && quote === '"') {
      current += char;
      escaped = true;
      continue;
    }
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      current += char;
      quote = char;
      continue;
    }
    if (char === ',') {
      items.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  items.push(current.trim());

  return items.filter(item => item !== '').map(unquoteScalar);
}

/**
 * Extracts frontmatter from markdown content using regex only - no YAML libraries
 * @param content The markdown content
 * @returns The extracted frontmatter as an object, or null if no frontmatter is found
 */
export function extractFrontmatter(content: string): Record<string, any> | null {
  if (!content) return null;

  const frontmatterRegex = /^---\n((?:.|\n)*?)\n---/;
  const match = content.match(frontmatterRegex);
  if (!match || !match[1]) return null;

  const frontmatterContent = match[1].trim();
  const frontmatterObject: Record<string, any> = {};
  
  const lines = frontmatterContent.split('\n');
  let currentArrayProperty: string | null = null;
  let arrayValues: any[] = [];
  
  for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    
    if (line.startsWith('- ') && currentArrayProperty) {
      arrayValues.push(unquoteScalar(line.substring(2).trim()));
      continue;
    }
    
    if (currentArrayProperty && !line.startsWith('- ')) {
      frontmatterObject[currentArrayProperty] = arrayValues;
      currentArrayProperty = null;
      arrayValues = [];
    }
    
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.substring(0, colonIndex).trim();
      const value = line.substring(colonIndex + 1).trim();
      
      if (!value) {
        currentArrayProperty = key;
        arrayValues = [];
        continue;
      }
      
      if (value === 'null') {
        frontmatterObject[key] = null;
      } else if (value === 'true') {
        frontmatterObject[key] = true;
      } else if (value === 'false') {
        frontmatterObject[key] = false;
      } else if (!isNaN(Number(value)) && !value.startsWith('0')) {
        frontmatterObject[key] = value.includes('.') ? parseFloat(value) : parseInt(value);
      } else if (value.startsWith('[') && value.endsWith(']') && !isWikilink(value)) {
        // Inline flow sequence: `tags: [a, b]`. Without this branch it fell
        // through to the string case and was written back as the quoted string
        // "[a, b]" — silently destroying the array. The isWikilink guard keeps
        // `related: [[Some Note]]` a link rather than a nested sequence.
        const inner = value.substring(1, value.length - 1).trim();
        frontmatterObject[key] = inner === '' ? [] : splitFlowSequence(inner);
      } else {
        frontmatterObject[key] = unquoteScalar(value);
      }
    }
  }
  
  if (currentArrayProperty) {
    frontmatterObject[currentArrayProperty] = arrayValues;
  }
  
  return frontmatterObject;
}

/**
 * Formats frontmatter as YAML with consistent quoting
 * @param frontmatter The frontmatter object
 * @returns Formatted YAML string
 */
export function formatFrontmatter(frontmatter: Record<string, any>): string {
  return Object.entries(frontmatter)
    .map(([key, value]) => {
      if (value === null) return `${key}: null`;
      if (value === true) return `${key}: true`;
      if (value === false) return `${key}: false`;
      if (typeof value === 'number') return `${key}: ${value}`;
      if (Array.isArray(value)) {
        if (value.length === 0) {
          return `${key}: []`;
        }
        // Block-style YAML array. Items are quoted ONLY when YAML requires it
        // (see needsYamlQuoting) — the blanket-quote rule used for scalars was
        // never needed here and turned every `- ai` into a churny `- "ai"`.
        // Wikilinks keep their quotes: they open with `[`, so the indicator
        // check catches them, and unquoted they would parse as nested arrays.
        const items = value.map(item => {
          const raw = String(item);
          if (!needsYamlQuoting(raw)) return `  - ${raw}`;
          const escaped = raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          return `  - "${escaped}"`;
        }).join('\n');
        return `${key}:\n${items}`;
      }
      // Always double-quote string values. URLs (og_image, og_favicon, etc.)
      // routinely contain ?, =, +, (, ), # and other YAML-unsafe chars; quoting
      // unconditionally is simpler and safer than enumerating every risky case.
      if (typeof value === 'string') {
        const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        return `${key}: "${escaped}"`;
      }
      // Fallback for other types
      const escapedFallback = String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      return `${key}: "${escapedFallback}"`;
    })
    .join('\n');
}

/**
 * Updates a file with new frontmatter content
 * @param file The Obsidian file
 * @param newFrontmatter The new frontmatter content
 * @returns Promise<void>
 */
export async function updateFileFrontmatter(file: TFile, newFrontmatter: string): Promise<void> {
  const content = await file.vault.read(file);
  const frontmatterRegex = /^---\n((?:.|\n)*?)\n---/;
  
  // If file has frontmatter, replace it
  if (content.match(frontmatterRegex)) {
    const newContent = content.replace(frontmatterRegex, `---\n${newFrontmatter}\n---`);
    await file.vault.modify(file, newContent);
  } else {
    // If no frontmatter, add it at the start
    const newContent = `---\n${newFrontmatter}\n---\n${content}`;
    await file.vault.modify(file, newContent);
  }
}
