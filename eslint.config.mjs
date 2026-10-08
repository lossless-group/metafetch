// ESLint flat config — required by ESLint 10.x.
// Mirrors the rules ObsidianReviewBot enforces on every community-plugin
// submission. `obsidianmd.configs.recommended` is the review bot's own rule
// set (eslint-plugin-obsidianmd); the block after it keeps the type-aware
// rules from context-v/reminders (no-floating-promises, no-base-to-string,
// no-unnecessary-type-assertion), which need parserOptions.project.
//
// See ../../context-v/reminders/Obsidian-Type-Safety.md and
//     ../../context-v/reminders/Obsidian-Marketplace-Compliance.md

import tsParser from '@typescript-eslint/parser';
import obsidianmd from 'eslint-plugin-obsidianmd';

export default [
    {
        // Build outputs, build tooling, examples, tests, node_modules.
        ignores: [
            'node_modules/**',
            'main.js',
            'styles.css',
            'examples/**',
            'scripts/**',
            'tests/**',
            '.test-build/**',
            '*.mjs',
        ],
    },
    // Obsidian community-plugin rules — what ObsidianReviewBot enforces
    // server-side at submission time.
    ...obsidianmd.configs.recommended,
    {
        files: ['**/*.ts'],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module',
                project: './tsconfig.json',
                tsconfigRootDir: import.meta.dirname,
            },
        },
        linterOptions: {
            reportUnusedDisableDirectives: 'error',
        },
        rules: {
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-unnecessary-type-assertion': 'error',
            '@typescript-eslint/no-floating-promises': 'error',
            '@typescript-eslint/no-base-to-string': 'error',
            '@typescript-eslint/no-misused-promises': 'error',
            'no-console': ['error', { allow: ['warn', 'error', 'debug'] }],
            // Brand allowlist for sentence-case so proper nouns in UI
            // strings (OpenGraph.io, Microlink, …) aren't lowercased.
            'obsidianmd/ui/sentence-case': [
                'error',
                {
                    brands: [
                        'Metafetch', 'OpenGraph.io', 'Open Graph', 'Microlink', 'Obsidian',
                        'Twitter', 'URL', 'JSON-LD',
                    ],
                    acronyms: ['ID', 'URL', 'URLs', 'API', 'LLM', 'AI', 'YAML'],
                    allowAutoFix: true,
                },
            ],
        },
    },
];
