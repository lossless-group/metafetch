// The example recipe "Create example model recipe" writes into the recipes
// folder: a model API that doesn't speak OpenAI's format, to show that a
// recipe can describe any JSON-over-HTTP API.

export const EXAMPLE_RECIPE_FILENAME = 'gemini.md';

export const EXAMPLE_RECIPE = `---
title: Google Gemini (example recipe)
---

# Google Gemini

An example model recipe. Metafetch, and any Lossless plugin that reads \`zz-cf-lib/recipes/\`, can call any model API described this way. Claude, OpenAI, TrustedRouter, and OpenAI-compatible endpoints are built in; this file adds Google's own Gemini API.

To use it:

1. In **Settings → Metafetch → Google Gemini**, choose or create the secret holding your Gemini API key.
2. Under **Approved hosts**, enter \`generativelanguage.googleapis.com\`. A recipe file's key goes nowhere until you approve its host.
3. Set **Default model provider** to Google Gemini, or add \`model: gemini\` to a profile.

Check the request against Google's current API docs before relying on it.

How a recipe works:

- \`request.url\`, \`headers\`, and \`body\` are sent as written, with \`{{model}}\`, \`{{system}}\`, \`{{prompt}}\`, \`{{schema}}\`, and \`{{baseUrl}}\` filled in. A value that is exactly \`"{{schema}}"\` becomes the JSON schema object itself.
- \`request.auth\` says where the key goes: \`bearer\`, \`header:<name>\`, \`query:<name>\`, or \`none\`.
- \`response.text\` is the path to the reply's text. \`[0]\` indexes a list, and \`[?type=text]\` takes the first item whose \`type\` is \`text\`.
- \`enforces-schema: true\` says the API holds the reply to the schema. Otherwise the prompt asks for JSON, and Metafetch reads the first JSON object in the reply.

\`\`\`cf-recipe
id: gemini
title: Google Gemini
description: Google's Gemini API (example recipe).
model: gemini-3.8-flash
enforces-schema: true
request:
  method: POST
  url: https://generativelanguage.googleapis.com/v1beta/models/{{model}}:generateContent
  auth: header:x-goog-api-key
  headers:
    content-type: application/json
  body:
    systemInstruction:
      parts: [{ text: "{{system}}" }]
    contents:
      - role: user
        parts: [{ text: "{{prompt}}" }]
    generationConfig:
      responseMimeType: application/json
      responseJsonSchema: "{{schema}}"
response:
  text: candidates[0].content.parts[0].text
\`\`\`
`;
