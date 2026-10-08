// Bundles tests/**/*.test.ts with esbuild (already a devDependency),
// aliasing `obsidian` to a runtime stub, then runs them with node:test.
// No test framework dependency.
import esbuild from 'esbuild';
import { spawnSync } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const outdir = path.join(root, '.test-build');
const entryPoints = readdirSync(path.join(root, 'tests'))
    .filter(f => f.endsWith('.test.ts'))
    .map(f => path.join(root, 'tests', f));

rmSync(outdir, { recursive: true, force: true });
await esbuild.build({
    entryPoints,
    outdir,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    outExtension: { '.js': '.mjs' },
    alias: { obsidian: path.join(root, 'tests/stubs/obsidian.ts') },
    // The stub's YAML parser loads from node_modules at runtime; bundling its
    // CommonJS build into ESM breaks on a dynamic require.
    external: ['yaml'],
    logLevel: 'warning',
});

const files = readdirSync(outdir).filter(f => f.endsWith('.mjs')).map(f => path.join(outdir, f));
const result = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
