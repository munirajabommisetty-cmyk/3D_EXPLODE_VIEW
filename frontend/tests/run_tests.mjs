/**
 * Automated Test Runner for Gesture-Controlled 3D Machine Explorer
 * Uses Vite's internal SSR builder to bundle TypeScript tests with zero extra dependencies,
 * then executes the suite using Node's native test runner (node:test).
 */

import { build } from 'vite';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

async function run() {
  console.log('📦 Bundling TypeScript unit tests with Vite...');
  await build({
    root: rootDir,
    logLevel: 'warn',
    build: {
      ssr: true,
      write: true,
      outDir: path.resolve(__dirname, '.dist'),
      rollupOptions: {
        input: path.resolve(__dirname, 'index.test.ts'),
        output: { entryFileNames: 'test.mjs' },
        external: ['node:test', 'node:assert', 'node:assert/strict'],
      },
    },
  });

  console.log('🚀 Running Node.js native test suite (node:test)...');
  const testFile = path.resolve(__dirname, '.dist', 'test.mjs');
  const result = spawnSync(process.execPath, ['--test', testFile], {
    stdio: 'inherit',
    cwd: rootDir,
  });

  process.exit(result.status ?? 0);
}

run().catch((err) => {
  console.error('Test runner failure:', err);
  process.exit(1);
});
