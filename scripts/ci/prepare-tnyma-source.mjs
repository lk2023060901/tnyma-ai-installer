#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const DEFAULT_CHECKOUT_DIR = path.join(ROOT, '.ci', 'tnyma-ai');
const REQUESTED_SOURCE_ROOT = process.env.TNYMA_AI_SOURCE_ROOT?.trim();
const SOURCE_ROOT = path.resolve(REQUESTED_SOURCE_ROOT || DEFAULT_CHECKOUT_DIR);
const CHECKOUT_DIR = path.resolve(process.env.TNYMA_AI_CHECKOUT_DIR?.trim() || SOURCE_ROOT);
const GIT_URL = process.env.TNYMA_AI_GIT_URL?.trim() || '';
const INTERNAL_GIT_URL = process.env.TNYMA_AI_GIT_URL_INTERNAL?.trim() || '';
const REF = process.env.TNYMA_AI_REF?.trim() || 'main';
const METADATA_PATH = path.resolve(process.env.TNYMA_AI_METADATA_PATH?.trim() || path.join(ROOT, '.ci', 'tnyma-ai-source.json'));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
    env: {
      ...process.env,
      ...options.env,
    },
  });

  if (result.status !== 0) {
    const detail = options.capture
      ? (result.stderr?.trim() || result.stdout?.trim() || `exit code ${result.status ?? 'unknown'}`)
      : `exit code ${result.status ?? 'unknown'}`;
    throw new Error(`${command} ${args.join(' ')} failed with ${detail}`);
  }

  return result.stdout?.trim() || '';
}

function isDirectory(targetPath) {
  try {
    return statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}

function validateSourceRoot(targetPath) {
  const packageJsonPath = path.join(targetPath, 'package.json');
  if (!existsSync(packageJsonPath)) {
    throw new Error(`Tnyma AI source root is missing package.json: ${targetPath}`);
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const scripts = packageJson?.scripts ?? {};
  const hasBuildWeb = typeof scripts['build:web'] === 'string' && scripts['build:web'].trim();
  const hasBuild = typeof scripts.build === 'string' && scripts.build.trim();

  if (!hasBuildWeb && !hasBuild) {
    throw new Error(`Tnyma AI source root has neither "build:web" nor "build": ${targetPath}`);
  }

  return packageJson;
}

function resolveRevision(targetPath) {
  return run('git', ['-C', targetPath, 'rev-parse', 'HEAD'], { capture: true });
}

function resolveGitUrlCandidates() {
  const candidates = [];
  const seen = new Set();
  const runnerTags = (process.env.CI_RUNNER_TAGS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  function addCandidate(url) {
    if (!url || seen.has(url)) {
      return;
    }
    seen.add(url);
    candidates.push(url);
  }

  if (runnerTags.includes('docker')) {
    addCandidate(INTERNAL_GIT_URL);
  }

  addCandidate(GIT_URL);
  return candidates;
}

function ensureCheckout() {
  if (existsSync(path.join(SOURCE_ROOT, 'package.json'))) {
    return SOURCE_ROOT;
  }

  const gitUrlCandidates = resolveGitUrlCandidates();

  if (gitUrlCandidates.length === 0) {
    throw new Error(
      `Tnyma AI source root does not exist: ${SOURCE_ROOT}. ` +
      'Set TNYMA_AI_SOURCE_ROOT to an existing checkout or set TNYMA_AI_GIT_URL/TNYMA_AI_GIT_URL_INTERNAL so CI can clone it.',
    );
  }

  mkdirSync(path.dirname(CHECKOUT_DIR), { recursive: true });

  if (!existsSync(path.join(CHECKOUT_DIR, '.git'))) {
    if (existsSync(CHECKOUT_DIR) && isDirectory(CHECKOUT_DIR)) {
      throw new Error(`Checkout directory exists but is not a git repo: ${CHECKOUT_DIR}`);
    }

    let lastError = null;
    for (const gitUrl of gitUrlCandidates) {
      try {
        run('git', ['clone', '--no-checkout', gitUrl, CHECKOUT_DIR]);
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError) {
      throw lastError;
    }
  }

  let lastError = null;
  for (const gitUrl of gitUrlCandidates) {
    try {
      run('git', ['-C', CHECKOUT_DIR, 'remote', 'set-url', 'origin', gitUrl]);
      run('git', ['-C', CHECKOUT_DIR, 'fetch', '--depth', '1', 'origin', REF]);
      run('git', ['-C', CHECKOUT_DIR, 'checkout', '--force', 'FETCH_HEAD']);
      run('git', ['-C', CHECKOUT_DIR, 'clean', '-fdx']);
      return CHECKOUT_DIR;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

const effectiveSourceRoot = ensureCheckout();
const packageJson = validateSourceRoot(effectiveSourceRoot);
const resolvedRef = resolveRevision(effectiveSourceRoot);

mkdirSync(path.dirname(METADATA_PATH), { recursive: true });
writeFileSync(
  METADATA_PATH,
  JSON.stringify({
    sourceRoot: effectiveSourceRoot,
    requestedRef: REF,
    resolvedRef,
    gitUrl: GIT_URL || null,
    packageName: packageJson.name || 'tnyma-ai',
    packageVersion: packageJson.version || null,
  }, null, 2) + '\n',
  'utf8',
);

console.log(`Prepared Tnyma AI source: ${effectiveSourceRoot}`);
console.log(`Resolved ref: ${resolvedRef}`);
