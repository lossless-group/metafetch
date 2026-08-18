/**
 * ESLint flat config.
 *
 * Migrated from `.eslintrc` — ESLint 9 dropped eslintrc as the default and
 * ESLint 10 removed it entirely, so the old config had stopped being read at
 * all. Lint was silently a no-op rather than failing loudly.
 *
 * Three tiers, because the plugin source and the build/test scripts are
 * genuinely different environments:
 *
 *   1. `**\/*.ts`   — plugin source. Type-aware linting against tsconfig.json,
 *                     DOM + browser globals (Obsidian plugins run in Electron's
 *                     renderer, so `document` and `window` are real).
 *   2. `*.mjs`      — build and test scripts. Node globals, NO type-aware
 *                     rules: these files aren't in tsconfig's `include`, and
 *                     pointing a typed rule at a file outside the program is an
 *                     error, not a lint finding.
 *   3. ignores      — the built bundle and deps.
 */
import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import globals from 'globals';

/** Rule overrides carried over verbatim from the old `.eslintrc`. */
const losslessOverrides = {
  // The base rule misfires on TS constructs; the TS-aware version replaces it.
  'no-unused-vars': 'off',
  '@typescript-eslint/no-unused-vars': ['error', { args: 'none' }],
  '@typescript-eslint/ban-ts-comment': 'off',
  'no-prototype-builtins': 'off',
  '@typescript-eslint/no-empty-function': 'off',
  '@typescript-eslint/no-explicit-any': 'warn',
  '@typescript-eslint/no-non-null-assertion': 'off',
  '@typescript-eslint/consistent-type-imports': 'error',
};

export default [
  {
    ignores: ['node_modules/**', 'main.js', 'styles.css'],
  },

  // 1. Plugin source — type-aware
  js.configs.recommended,
  ...tsPlugin.configs['flat/recommended'],
  ...tsPlugin.configs['flat/strict'],
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        project: './tsconfig.json',
      },
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
    },
    rules: losslessOverrides,
  },

  // 2. Build + test scripts — Node, untyped
  {
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
  },
];
