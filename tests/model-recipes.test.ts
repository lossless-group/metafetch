// Model recipes: the request each bundled recipe sends, where keys may go,
// reading the reply, vault recipe files, and the model step of "Fill
// frontmatter from folder profile". No network: requestUrl is the stub.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    BUNDLED_RECIPES, callModel, parseRecipe, readPath, parseJsonObject, substitute, ModelCallError,
    type ModelRecipe, type ProviderSettings,
} from '../src/services/modelRecipes';
import { acceptModelValue, modelSchema, parseProfile } from '../src/services/frontmatterProfiles';
import { EXAMPLE_RECIPE } from '../src/profiles/exampleRecipe';

interface Sent { url: string; method?: string; headers?: Record<string, string>; body?: string }

function reply(status: number, json: unknown): Sent[] {
    const sent: Sent[] = [];
    (globalThis as { __requestUrl?: unknown }).__requestUrl = (req: Sent) => {
        sent.push(req);
        return { status, headers: {}, text: JSON.stringify(json), json, arrayBuffer: new ArrayBuffer(0) };
    };
    return sent;
}

const recipe = (id: string) => BUNDLED_RECIPES.find(r => r.id === id)!;
const provider = (o: Partial<ProviderSettings> = {}): ProviderSettings => ({ secret: 'k', model: '', baseUrl: '', approvedHosts: '', ...o });
const SCHEMA = { type: 'object', properties: { zinger: { anyOf: [{ type: 'string' }, { type: 'null' }] } }, required: ['zinger'], additionalProperties: false };
const call = (r: ModelRecipe, p = provider(), secret: string | null = 'sk-test') =>
    callModel({ recipe: r, provider: p, getSecret: () => secret, system: 'SYS', prompt: 'PROMPT', schema: SCHEMA });

afterEach(() => { delete (globalThis as { __requestUrl?: unknown }).__requestUrl; });

describe('bundled recipes', () => {
    test('Claude: x-api-key, version header, schema-held reply, text block after thinking', async () => {
        const sent = reply(200, { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"zinger":"Ship apps faster."}' }] });
        const out = await call(recipe('anthropic'));
        assert.deepEqual(out, { values: { zinger: 'Ship apps faster.' }, model: 'claude-opus-5-5' });
        const req = sent[0]!;
        assert.equal(req.url, 'https://api.anthropic.com/v1/messages');
        assert.equal(req.headers?.['x-api-key'], 'sk-test');
        assert.equal(req.headers?.['anthropic-version'], '2023-06-01');
        const body = JSON.parse(req.body ?? '{}') as Record<string, unknown>;
        assert.equal(body['model'], 'claude-opus-5-5');
        assert.equal(body['system'], 'SYS');
        assert.deepEqual(body['output_config'], { format: { type: 'json_schema', schema: SCHEMA } });
    });

    test('OpenAI: bearer key, strict json_schema, choices[0].message.content', async () => {
        const sent = reply(200, { choices: [{ finish_reason: 'stop', message: { content: '{"zinger":"x"}' } }] });
        const out = await call(recipe('openai'), provider({ model: 'gpt-6.1-sol' }));
        assert.equal(out.model, 'gpt-6.1-sol', 'the settings model wins over the default');
        assert.equal(sent[0]?.headers?.['authorization'], 'Bearer sk-test');
        const body = JSON.parse(sent[0]?.body ?? '{}') as { response_format: { json_schema: { strict: boolean; schema: unknown } } };
        assert.equal(body.response_format.json_schema.strict, true);
        assert.deepEqual(body.response_format.json_schema.schema, SCHEMA);
    });

    test('TrustedRouter and OpenAI-compatible: no schema enforcement, so the prompt asks for JSON and prose is tolerated', async () => {
        const sent = reply(200, { choices: [{ message: { content: 'Sure!\n```json\n{"zinger":"y"}\n```' } }] });
        const out = await call(recipe('trustedrouter'));
        assert.deepEqual(out.values, { zinger: 'y' });
        assert.equal(sent[0]?.url, 'https://api.trustedrouter.com/v1/chat/completions');
        const body = JSON.parse(sent[0]?.body ?? '{}') as { messages: { content: string }[] };
        assert.match(body.messages[1]?.content ?? '', /Reply with only a JSON object matching this schema/);
    });

    test('OpenAI-compatible: the key goes only to the configured base URL; plain http only for localhost', async () => {
        const sent = reply(200, { choices: [{ message: { content: '{"zinger":"z"}' } }] });
        await call(recipe('openai-compatible'), provider({ model: 'qwen3', baseUrl: 'http://localhost:1234/v1/' }));
        assert.equal(sent[0]?.url, 'http://localhost:1234/v1/chat/completions');
        await assert.rejects(
            call(recipe('openai-compatible'), provider({ model: 'm', baseUrl: 'http://gateway.example/v1' })),
            (e: unknown) => e instanceof ModelCallError && e.code === 'INSECURE_URL',
        );
    });
});

describe('failures are explained, not thrown raw', () => {
    test('no key, no model, HTTP errors, refusals, and replies without JSON', async () => {
        reply(200, {});
        await assert.rejects(call(recipe('anthropic'), provider(), null), (e: unknown) => e instanceof ModelCallError && e.code === 'NO_KEY');
        await assert.rejects(call(recipe('openai-compatible'), provider({ baseUrl: 'http://localhost:1/v1' })), (e: unknown) => e instanceof ModelCallError && e.code === 'NO_MODEL');
        reply(401, { error: { message: 'invalid x-api-key' } });
        await assert.rejects(call(recipe('anthropic')), (e: unknown) => e instanceof ModelCallError && e.code === 'HTTP_ERROR' && /401.*invalid x-api-key/.test(e.message));
        reply(200, { stop_reason: 'refusal', content: [] });
        await assert.rejects(call(recipe('anthropic')), (e: unknown) => e instanceof ModelCallError && e.code === 'REFUSED');
        reply(200, { choices: [{ message: { content: 'I cannot help with that.' } }] });
        await assert.rejects(call(recipe('openai')), (e: unknown) => e instanceof ModelCallError && e.code === 'BAD_RESPONSE');
    });

    test('an HTTP error message never echoes the key', async () => {
        reply(500, { error: 'boom' });
        await assert.rejects(call(recipe('openai')), (e: unknown) => e instanceof Error && !e.message.includes('sk-test'));
    });
});

describe('vault recipes', () => {
    const FILE = `---
title: Gemini via proxy
---

\`\`\`metafetch-recipe
id: gemini-proxy
title: Gemini (proxy)
model: gemini-3.8-flash
request:
  url: https://llm.example.com/v1/generate?model={{model}}
  auth: header:x-goog-api-key
  headers:
    content-type: application/json
  body:
    contents: [{ parts: [{ text: "{{system}}\\n\\n{{prompt}}" }] }]
response:
  text: candidates[0].content.parts[0].text
\`\`\`
`;

    test('parses into a recipe', () => {
        const r = parseRecipe(FILE, 'zz-cf-lib/recipes/gemini.md')!.recipe!;
        assert.equal(r.id, 'gemini-proxy');
        assert.equal(r.origin, 'vault');
        assert.equal(r.request.auth, 'header:x-goog-api-key');
        assert.equal(r.defaultModel, 'gemini-3.8-flash');
    });

    test("its key goes nowhere until the host is approved in settings", async () => {
        const r = parseRecipe(FILE, 'g.md')!.recipe!;
        reply(200, { candidates: [{ content: { parts: [{ text: '{"zinger":"g"}' }] } }] });
        await assert.rejects(call(r), (e: unknown) => e instanceof ModelCallError && e.code === 'HOST_NOT_APPROVED');
        const sent = reply(200, { candidates: [{ content: { parts: [{ text: '{"zinger":"g"}' }] } }] });
        const out = await call(r, provider({ approvedHosts: 'llm.example.com' }));
        assert.deepEqual(out.values, { zinger: 'g' });
        assert.equal(sent[0]?.headers?.['x-goog-api-key'], 'sk-test');
        assert.equal(sent[0]?.url, 'https://llm.example.com/v1/generate?model=gemini-3.8-flash');
        const body = JSON.parse(sent[0]?.body ?? '{}') as { contents: { parts: { text: string }[] }[] };
        assert.match(body.contents[0]?.parts[0]?.text ?? '', /^SYS\n\nPROMPT/);
    });

    test('bad files are reported, and a bundled id cannot be taken over', () => {
        assert.match(parseRecipe('```metafetch-recipe\nrequest: {}\n```', 'x.md')!.problems.join(' '), /url is missing/);
        assert.match(parseRecipe('```metafetch-recipe\nid: anthropic\nrequest: { url: "https://evil.example" }\nresponse: { text: a }\n```', 'x.md')!.problems.join(' '), /taken by a bundled recipe/);
        assert.equal(parseRecipe('no recipe here', 'x.md'), null);
    });
});

describe('helpers', () => {
    test('substitute: whole-string variables keep their type; unknown ones fail loudly', () => {
        assert.deepEqual(substitute({ a: '{{schema}}', b: 'Model {{model}}' }, { schema: { x: 1 }, model: 'm' }), { a: { x: 1 }, b: 'Model m' });
        assert.throws(() => substitute('{{modle}}', { model: 'm' }), /Unknown recipe variable/);
    });

    test('readPath: dots, indexes, negative indexes, and [?key=value]', () => {
        const d = { content: [{ type: 'thinking' }, { type: 'text', text: 'hi' }], list: [1, 2, 3] };
        assert.equal(readPath(d, 'content[?type=text].text'), 'hi');
        assert.equal(readPath(d, 'list[-1]'), 3);
        assert.equal(readPath(d, '$.content[0].type'), 'thinking');
        assert.equal(readPath(d, 'missing.deep'), undefined);
    });

    test('parseJsonObject: bare, fenced, and wrapped in prose', () => {
        assert.deepEqual(parseJsonObject('{"a":1}'), { a: 1 });
        assert.deepEqual(parseJsonObject('```json\n{"a":2}\n```'), { a: 2 });
        assert.deepEqual(parseJsonObject('Here you go: {"a":3} Thanks.'), { a: 3 });
        assert.equal(parseJsonObject('no json'), null);
    });
});

describe('model fields in a profile', () => {
    const profile = parseProfile(`---
applies-to-paths: ["Tooling/**"]
---
\`\`\`metafetch-profile
model: openai
fields:
  zinger: { from: [model], describe: "One punchy line." }
  pricing_model: { from: [model], type: enum, values: [free, freemium, paid], describe: "How it charges." }
  categories: { from: [model], type: list, values: [CMS, Database, Hosting], describe: "Which apply." }
  linkedin_url: { platform: linkedin-company, from: [model], describe: "x" }
\`\`\`
`, 'p.md')!;

    test('URLs are never asked of a model', () => {
        assert.deepEqual(profile.fields.map(f => f.key), ['zinger', 'pricing_model', 'categories']);
        assert.match(profile.problems.join(' '), /linkedin_url: social links come from the page/);
        assert.equal(profile.modelProvider, 'openai');
    });

    test('the schema: every field nullable and required, enums and lists constrained', () => {
        const s = modelSchema(profile.fields) as { required: string[]; properties: Record<string, { anyOf: unknown[] }> };
        assert.deepEqual(s.required, ['zinger', 'pricing_model', 'categories']);
        assert.deepEqual(s.properties['pricing_model']?.anyOf[0], { type: 'string', enum: ['free', 'freemium', 'paid'] });
        assert.deepEqual(s.properties['zinger']?.anyOf[1], { type: 'null' });
    });

    test('values outside the profile are dropped, not written', () => {
        const [zinger, pricing, cats] = profile.fields;
        assert.equal(acceptModelValue(zinger!, '  Ship it.  '), 'Ship it.');
        assert.equal(acceptModelValue(zinger!, null), undefined);
        assert.equal(acceptModelValue(pricing!, 'expensive'), undefined);
        assert.equal(acceptModelValue(pricing!, 'paid'), 'paid');
        assert.deepEqual(acceptModelValue(cats!, ['CMS', 'Spaceships', 'CMS']), ['CMS']);
        assert.equal(acceptModelValue(cats!, 'CMS'), undefined);
    });
});

test('the bundled example recipe parses cleanly', () => {
    const parsed = parseRecipe(EXAMPLE_RECIPE, 'zz-cf-lib/recipes/gemini.md')!;
    assert.deepEqual(parsed.problems, []);
    assert.equal(parsed.recipe?.id, 'gemini');
    assert.equal(parsed.recipe?.enforcesSchema, true);
});
