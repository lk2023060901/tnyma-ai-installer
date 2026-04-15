#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const SKIP_VERIFY = process.env.SKIP_OPENCLAW_NPM_VERIFY === '1';

const packageJson = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const declaredVersion = packageJson.devDependencies?.openclaw || packageJson.dependencies?.openclaw;
const expectedVersion = process.env.OPENCLAW_NPM_VERSION?.trim() || declaredVersion;

if (!declaredVersion) {
  throw new Error('Unable to determine the declared TnymaAI dependency version from package.json');
}

if (process.env.OPENCLAW_NPM_VERSION?.trim() && process.env.OPENCLAW_NPM_VERSION.trim() !== declaredVersion) {
  throw new Error(
    `OPENCLAW_NPM_VERSION (${process.env.OPENCLAW_NPM_VERSION.trim()}) does not match package.json (${declaredVersion})`,
  );
}

if (SKIP_VERIFY) {
  console.log(`Skipping npm verification for openclaw@${expectedVersion}`);
  process.exit(0);
}

const result = spawnSync('npm', ['view', `openclaw@${expectedVersion}`, 'version', '--json'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});

if (result.status !== 0) {
  const detail = result.stderr?.trim() || result.stdout?.trim() || `exit code ${result.status ?? 'unknown'}`;
  throw new Error(`npm view failed for openclaw@${expectedVersion}: ${detail}`);
}

const resolved = JSON.parse(result.stdout);
if (resolved !== expectedVersion) {
  throw new Error(`npm resolved TnymaAI version ${resolved}, expected ${expectedVersion}`);
}

console.log(`Verified openclaw@${expectedVersion} on npm`);
