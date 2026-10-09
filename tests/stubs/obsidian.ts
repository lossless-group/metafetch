// Minimal runtime stand-in for the `obsidian` module, which ships types
// only and cannot load under Node. scripts/run-tests.mjs aliases
// `obsidian` to this file. Tests drive network behavior by assigning
// a handler to `globalThis.__requestUrl`.
//
// Copied from Cite Wide's harness (itself from Image Gin's), plus a Plugin stand-in whose
// addSettingTab() mirrors Obsidian 1.13+/1.14: it calls tab.update(), which
// calls getSettingDefinitions() immediately, so a settings tab that throws
// while building its definitions fails onload() here as it would in the app.

import { parse as parseYamlText } from 'yaml';

export interface StubRequest {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string | ArrayBuffer;
    throw?: boolean;
}

export interface StubResponse {
    status: number;
    headers: Record<string, string>;
    text: string;
    json: unknown;
    arrayBuffer: ArrayBuffer;
}

// Plugin code uses window.setTimeout (popout-window safe, per the review
// bot); under Node, `window` is the global object.
(globalThis as { window?: unknown }).window ??= globalThis;

type Handler = (req: StubRequest) => StubResponse | Promise<StubResponse>;

export async function requestUrl(req: StubRequest): Promise<StubResponse> {
    const handler = (globalThis as { __requestUrl?: Handler }).__requestUrl;
    if (!handler) throw new Error(`requestUrl called with no test handler: ${req.url}`);
    const res = await handler(req);
    if (req.throw !== false && res.status >= 400) {
        throw new Error(`Request failed, status ${res.status}`);
    }
    return res;
}

export class Notice {
    /** Every notice shown, so tests can assert what the user was told. */
    static shown: string[] = [];
    constructor(public message?: string, _duration?: number) {
        if (message) Notice.shown.push(message);
    }
    hide(): void {}
}

export class Modal {
    constructor(public app?: unknown) {}
    open(): void {}
    close(): void {}
}

export class SuggestModal<T> extends Modal {
    setPlaceholder(_text: string): void {}
    getSuggestions(_query: string): T[] { return []; }
}

// The real parseYaml is Obsidian's bundled YAML parser; tests use the
// `yaml` package (a devDependency only, never in main.js).
export function parseYaml(text: string): unknown {
    return parseYamlText(text) as unknown;
}

export class SecretComponent {
    constructor(_app: unknown, _el: unknown) {
        return chain() as SecretComponent;
    }
}

export class ButtonComponent {
    constructor(_containerEl: unknown) {
        return chain() as ButtonComponent;
    }
}

export class Setting {
    constructor(_containerEl: unknown) {
        const names = (globalThis as { __settingNames?: string[] }).__settingNames;
        return chain((prop, args) => {
            if (prop === 'setName' && names) names.push(String(args[0]));
        }) as Setting;
    }
}

export class PluginSettingTab {
    containerEl: unknown = chain();
    settingItems: unknown[] = [];
    /** Count of update() calls, so tests can assert a rebuild was requested. */
    updates = 0;
    constructor(public app: unknown, public plugin: unknown) {}
    getSettingDefinitions(): unknown[] { return []; }
    /** Obsidian 1.13+: collect definitions for rendering and search indexing. */
    update(): void {
        this.updates++;
        this.settingItems = this.getSettingDefinitions();
    }
    refreshDomState(): void {}
    getControlValue(key: string): unknown {
        return (this.plugin as { settings: Record<string, unknown> }).settings[key];
    }
    setControlValue(key: string, value: unknown): void | Promise<void> {
        (this.plugin as { settings: Record<string, unknown> }).settings[key] = value;
    }
}

export interface StubCommand {
    id: string;
    name: string;
    [key: string]: unknown;
}

export class Plugin {
    settings?: unknown;
    /** Every command passed to addCommand(), in registration order. */
    commands: StubCommand[] = [];
    settingTabs: PluginSettingTab[] = [];
    ribbonIcons: { icon: string; title: string }[] = [];
    /** What loadData() resolves to; tests set this to simulate data.json. */
    storedData: unknown = null;
    savedData: unknown[] = [];

    constructor(public app: unknown, public manifest: unknown) {}

    addCommand(command: StubCommand): StubCommand {
        this.commands.push(command);
        return command;
    }

    addSettingTab(tab: PluginSettingTab): void {
        this.settingTabs.push(tab);
        tab.update();
    }

    addRibbonIcon(icon: string, title: string, _callback: unknown): unknown {
        this.ribbonIcons.push({ icon, title });
        return chain();
    }

    loadData(): Promise<unknown> {
        return Promise.resolve(this.storedData);
    }

    saveData(data: unknown): Promise<void> {
        this.savedData.push(data);
        return Promise.resolve();
    }

    register(_cb: unknown): void {}
    registerEvent(_ref: unknown): void {}
}

export class TFile {}
export class TFolder {}
export function normalizePath(p: string): string {
    return p.replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
}

// --- Chainable UI stand-ins for rendering under Node ---------------------
// Every method returns the same proxy; callbacks handed to addText/addToggle
// etc. are invoked with a component proxy. Setting names are recorded in
// globalThis.__settingNames so tests can assert which rows rendered.

function chain(onCall?: (prop: string, args: unknown[]) => void): unknown {
    const target = function () { /* callable */ };
    const proxy: unknown = new Proxy(target, {
        get(_t, prop) {
            if (prop === 'then') return undefined;
            if (prop === 'inputEl' || prop === 'settingEl' || prop === 'controlEl' || prop === 'buttonEl') return chain();
            return (...args: unknown[]) => {
                onCall?.(String(prop), args);
                for (const a of args) if (typeof a === 'function' && !String(prop).startsWith('on') && prop !== 'addEventListener') (a as (c: unknown) => void)(chain());
                return proxy;
            };
        },
        set() { return true; },
    });
    return proxy;
}

export function makeStubElement(): unknown {
    return chain();
}

export const SettingNames: string[] = [];
(globalThis as { __settingNames?: string[] }).__settingNames = SettingNames;
