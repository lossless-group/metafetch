import type { App } from 'obsidian';

/**
 * Vault-wide identity codes for fetched source notes.
 *
 * A `hex_code` is what lets a document be referenced from anywhere in the vault
 * — and across the sites the vault rolls up into — by something stabler than
 * its filename. `[[Some Note]]` is ambiguous the moment two notes share a title
 * or a file gets renamed; a minted code is not.
 *
 * ## Why this isn't hexadecimal
 *
 * The name is historical. We deliberately do NOT restrict to `[0-9a-f]`.
 * The full lowercase alphanumeric alphabet costs exactly the same six
 * characters on disk and buys three and a half more bits per character:
 *
 * | Alphabet        | Size | 6-char space  |
 * |-----------------|------|---------------|
 * | hex `[0-9a-f]`  | 16   | 16.7 million  |
 * | ours `[a-z0-9]` | 36   | 2.18 billion  |
 *
 * Same storage, ~130× the room, ~130× less likely to collide. There is no
 * reason to pay for the narrower alphabet.
 */

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const DEFAULT_LENGTH = 6;

/**
 * Largest multiple of the alphabet size that fits in a byte. Bytes at or above
 * this are rejected rather than folded in with `%`, which would make the first
 * few characters of the alphabet marginally more likely — a small bias, but a
 * pointless one to accept in an identifier whose whole job is not colliding.
 */
const REJECTION_CEILING = Math.floor(256 / ALPHABET.length) * ALPHABET.length;

/** Mints one code. Not vault-aware — use mintUniqueHexCode for that. */
export function generateHexCode(length: number = DEFAULT_LENGTH): string {
  let code = '';
  const buffer = new Uint8Array(length * 2);

  while (code.length < length) {
    crypto.getRandomValues(buffer);
    for (const byte of buffer) {
      if (byte >= REJECTION_CEILING) continue;
      code += ALPHABET[byte % ALPHABET.length];
      if (code.length === length) break;
    }
  }

  return code;
}

/**
 * Every value already in use for the given property across the vault.
 *
 * Read from Obsidian's metadata cache rather than by reading files, so this
 * stays cheap enough to call before each mint.
 */
export function collectExistingHexCodes(app: App, fieldName: string): Set<string> {
  const existing = new Set<string>();

  for (const file of app.vault.getMarkdownFiles()) {
    const value = app.metadataCache.getFileCache(file)?.frontmatter?.[fieldName];
    if (typeof value === 'string' && value) existing.add(value);
    // Tolerate a list-valued field rather than skipping it — a code that IS in
    // use must not be handed out again just because it's stored oddly.
    else if (Array.isArray(value)) {
      for (const item of value) if (typeof item === 'string' && item) existing.add(item);
    }
  }

  return existing;
}

/**
 * Mints a code that nothing in the vault is using.
 *
 * At 2.18 billion possibilities a collision is already remote; this closes the
 * gap rather than relying on the odds. After enough failures we widen by one
 * character instead of spinning — that only happens in a vault large enough
 * that the extra character is warranted anyway.
 */
export function mintUniqueHexCode(
  existing: Set<string>,
  length: number = DEFAULT_LENGTH
): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    const code = generateHexCode(length);
    if (!existing.has(code)) return code;
  }
  return generateHexCode(length + 1);
}

/** The subset of settings this module needs — avoids importing the whole shape. */
export interface HexCodeSettings {
  stampHexCode: boolean;
  hexCodeFieldName: string;
  hexCodeLength: number;
}

/**
 * Stamps a code onto frontmatter if the user opted in and the note doesn't
 * already have one. Shared by every write path so the policy lives once.
 *
 * **Write-once by design.** The value of the code is that it's a stable handle
 * for referencing this document from anywhere in the vault. A code regenerated
 * on the next fetch is worse than no code at all, because every reference to
 * the old one rots silently.
 */
export function stampIdentityCode(
  app: App,
  frontmatter: Record<string, unknown>,
  settings: HexCodeSettings,
  mintedThisRun?: Set<string>
): void {
  if (!settings.stampHexCode) return;
  if (frontmatter[settings.hexCodeFieldName]) return;

  const existing = collectExistingHexCodes(app, settings.hexCodeFieldName);

  // Obsidian's metadata cache lags `vault.modify`, so within a batch the codes
  // written seconds ago are not in it yet. Callers processing many files pass a
  // run-scoped set to cover that window; without it, two files in one batch
  // could be handed the same code.
  if (mintedThisRun) {
    for (const code of mintedThisRun) existing.add(code);
  }

  const code = mintUniqueHexCode(existing, settings.hexCodeLength);
  mintedThisRun?.add(code);
  frontmatter[settings.hexCodeFieldName] = code;
}
