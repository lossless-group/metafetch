// Copied from Cite Wide's src/utils/authorNames.ts (each Lossless plugin
// ships standalone, so this is a copy, not an import). Rejects the non-names
// that fetched "authors" turn out to be: reading times, sentence fragments,
// links, CMS placeholders.

// Lowercase words allowed inside a personal or organizational name.
const NAME_PARTICLES = /^(de|da|das|do|dos|del|della|di|du|van|von|der|den|ter|le|la|les|bin|binti|al|el|y|e|and|of|the|for|&)$/i;
// Placeholder bylines content systems emit when no author is set.
const PLACEHOLDER_AUTHORS = /^(super ?user|admin(istrator)?|guest|staff|editor(ial)?( team)?|unknown|anonymous|author|user|contributor|webmaster|team)$/i;

/**
 * True when a string is shaped like a person or organization name. Rejects
 * what stored and fetched "authors" in the lossless vault turned out to be
 * (2026-10-06): reading times ("3 minutes", "over 4"), sentence fragments
 * ("completing the action below.", "a multi-model database."), lowercase
 * phrases ("training data"), markdown links and URLs, and CMS placeholders
 * ("Super User").
 */
export function isPlausibleAuthor(name: string | undefined): boolean {
  const t = name?.trim() ?? '';
  if (!t) return false;
  if (/^\[\[[^\]]+\]\]$/.test(t)) return true;
  if (/\]\(|https?:\/\/|\[\^|[<>{}|]/.test(t)) return false;
  if (/[\d?!;:%()“”"]/.test(t)) return false;
  if (/\.$/.test(t) && !/(^|\s)\p{Lu}\.$/u.test(t)) return false;
  if (PLACEHOLDER_AUTHORS.test(t)) return false;
  const words = t.split(/\s+/);
  if (words.length > 6) return false;
  if (!/^[\p{Lu}\p{Lt}]/u.test(t)) return false;
  return words.every(w => !/^\p{Ll}/u.test(w) || NAME_PARTICLES.test(w));
}
