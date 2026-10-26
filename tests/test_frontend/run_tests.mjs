/**
 * Root-Level Test Entry Point for Frontend Tests (Task 6.1)
 *
 * Forwards execution to the authoritative Vite SSR test runner in frontend/tests/run_tests.mjs.
 * Propagates exit codes, errors, and standard streams cleanly.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');
const frontendDir = path.resolve(projectRoot, 'frontend');
const frontendRunner = path.resolve(frontendDir, 'tests', 'run_tests.mjs');

console.log('🚀 Executing frontend test suite from root entry point (tests/test_frontend/run_tests.mjs)...');

const child = spawn(process.execPath, [frontendRunner], {
  cwd: frontendDir,
  stdio: 'inherit',
});

child.on('close', (code) => {
  process.exit(code ?? 0);
});

child.on('error', (err) => {
  console.error('Failed to spawn frontend test runner:', err);
  process.exit(1);
});
