/**
 * Minimal in-repo replacement for typed.js, covering exactly the surface the
 * metafetch modals use: cycle a list of strings with type/backspace animation,
 * a blinking cursor (styled by the existing .typed-cursor rule in styles.css),
 * and smart backspacing that only erases back to the common prefix shared
 * with the next string.
 *
 * typed.js v3 relicensed MIT → GPL-3.0, so the dependency was rebuilt here.
 * See content-farm/context-v/plans/Dependency-Upgrades-Across-Plugin-Family.md.
 */

export interface TypewriterOptions {
  strings: string[];
  /** ms per character while typing (default 25) */
  typeSpeed?: number;
  /** ms per character while backspacing (default 30) */
  backSpeed?: number;
  /** ms to hold a fully-typed string before backspacing (default 1000) */
  backDelay?: number;
  /** cycle back to the first string after the last (default true) */
  loop?: boolean;
  cursorChar?: string;
  /** only backspace to the common prefix with the next string (default true) */
  smartBackspace?: boolean;
}

export class Typewriter {
  private readonly el: HTMLElement;
  private readonly strings: string[];
  private readonly typeSpeed: number;
  private readonly backSpeed: number;
  private readonly backDelay: number;
  private readonly loop: boolean;
  private readonly smartBackspace: boolean;
  private cursorEl: HTMLElement | null = null;
  private timeoutId: number | null = null;

  constructor(el: HTMLElement, options: TypewriterOptions) {
    this.el = el;
    this.strings = options.strings.length > 0 ? options.strings : [''];
    this.typeSpeed = options.typeSpeed ?? 25;
    this.backSpeed = options.backSpeed ?? 30;
    this.backDelay = options.backDelay ?? 1000;
    this.loop = options.loop ?? true;
    this.smartBackspace = options.smartBackspace ?? true;

    this.cursorEl = el.ownerDocument.createElement('span');
    this.cursorEl.className = 'typed-cursor';
    this.cursorEl.textContent = options.cursorChar ?? '|';
    el.insertAdjacentElement('afterend', this.cursorEl);

    this.type(0, 0);
  }

  destroy(): void {
    if (this.timeoutId !== null) {
      window.clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.cursorEl?.remove();
    this.cursorEl = null;
    this.el.textContent = '';
  }

  private type(stringIndex: number, position: number): void {
    const current = this.strings[stringIndex] ?? '';
    this.el.textContent = current.slice(0, position);

    if (position < current.length) {
      this.schedule(() => this.type(stringIndex, position + 1), this.typeSpeed);
      return;
    }

    const isLast = stringIndex === this.strings.length - 1;
    if (isLast && !this.loop) return;

    const nextIndex = (stringIndex + 1) % this.strings.length;
    this.schedule(() => this.backspace(stringIndex, position, nextIndex), this.backDelay);
  }

  private backspace(stringIndex: number, position: number, nextIndex: number): void {
    const current = this.strings[stringIndex] ?? '';
    const stopAt = this.smartBackspace
      ? commonPrefixLength(current, this.strings[nextIndex] ?? '')
      : 0;

    if (position > stopAt) {
      this.el.textContent = current.slice(0, position - 1);
      this.schedule(() => this.backspace(stringIndex, position - 1, nextIndex), this.backSpeed);
      return;
    }

    this.type(nextIndex, position);
  }

  private schedule(fn: () => void, delay: number): void {
    this.timeoutId = window.setTimeout(fn, delay);
  }
}

function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i++;
  return i;
}
