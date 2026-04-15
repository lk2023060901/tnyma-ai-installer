#!/usr/bin/env zx

import 'zx/globals';

import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUTPUT_ROOT = path.join(ROOT, 'build', 'tnyma-web-stack');
const HOME_DIR = os.homedir();

function resolveSourceRoot() {
  const envSourceRoot = process.env.TNYMA_AI_SOURCE_ROOT?.trim();
  const candidates = [
    envSourceRoot,
    path.resolve(ROOT, '..', '..', 'ai', 'tnyma-ai'),
    path.resolve(ROOT, '..', 'tnyma-ai'),
    path.join(HOME_DIR, 'ai', 'tnyma-ai'),
    path.join(HOME_DIR, 'github', 'tnyma-ai'),
    path.join(HOME_DIR, 'Desktop', 'tnyma-ai'),
  ].filter(Boolean).map((candidate) => path.resolve(candidate));

  return candidates.find((candidate) => existsSync(path.join(candidate, 'package.json')));
}

const SOURCE_ROOT = resolveSourceRoot();

const WEB_SOURCE_ROOT = SOURCE_ROOT ? path.join(SOURCE_ROOT, 'apps', 'web') : null;
const WEB_STANDALONE_ROOT = WEB_SOURCE_ROOT ? path.join(WEB_SOURCE_ROOT, '.next', 'standalone') : null;
const WEB_STATIC_ROOT = WEB_SOURCE_ROOT ? path.join(WEB_SOURCE_ROOT, '.next', 'static') : null;
const WEB_PUBLIC_ROOT = WEB_SOURCE_ROOT ? path.join(WEB_SOURCE_ROOT, 'public') : null;

const WEB_OUTPUT_ROOT = path.join(OUTPUT_ROOT, 'web');
const LIVE_GATEWAY_OUTPUT_ROOT = path.join(OUTPUT_ROOT, 'live-gateway');
const LIVE_GATEWAY_ENTRY = path.join(LIVE_GATEWAY_OUTPUT_ROOT, 'server.mjs');
const RUNTIME_NODE_MODULES_ROOT = path.join(OUTPUT_ROOT, 'node_modules');

function ensureExists(targetPath, description) {
  if (!existsSync(targetPath)) {
    throw new Error(`${description} not found: ${targetPath}`);
  }
}

function ensureSourceRoot() {
  if (!SOURCE_ROOT) {
    const expectedPaths = [
      process.env.TNYMA_AI_SOURCE_ROOT?.trim() ? `TNYMA_AI_SOURCE_ROOT=${process.env.TNYMA_AI_SOURCE_ROOT.trim()}` : null,
      path.resolve(ROOT, '..', '..', 'ai', 'tnyma-ai'),
      path.resolve(ROOT, '..', 'tnyma-ai'),
      path.join(HOME_DIR, 'ai', 'tnyma-ai'),
      path.join(HOME_DIR, 'github', 'tnyma-ai'),
      path.join(HOME_DIR, 'Desktop', 'tnyma-ai'),
    ].filter(Boolean);

    throw new Error(
      'Tnyma AI source repository not found. ' +
      `Set TNYMA_AI_SOURCE_ROOT or place the repo in one of: ${expectedPaths.join(', ')}`,
    );
  }
}

function runPnpmBuildWeb() {
  const command = process.platform === 'win32'
    ? (process.env.ComSpec || 'cmd.exe')
    : 'pnpm';
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'pnpm build:web']
    : ['build:web'];
  const result = spawnSync(command, args, {
    cwd: SOURCE_ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: '1',
    },
  });

  if (result.status !== 0) {
    const failureDetail = result.error?.message || `exit code ${result.status ?? 'unknown'}`;
    throw new Error(`pnpm build:web failed with ${failureDetail}`);
  }
}

function cleanOutput() {
  rmSync(OUTPUT_ROOT, { recursive: true, force: true });
  mkdirSync(OUTPUT_ROOT, { recursive: true });
}

function copyWebRuntime() {
  ensureExists(WEB_STANDALONE_ROOT, 'Next standalone output');
  ensureExists(WEB_STATIC_ROOT, 'Next static output');
  ensureExists(WEB_PUBLIC_ROOT, 'Web public assets');

  cpSync(WEB_STANDALONE_ROOT, WEB_OUTPUT_ROOT, { recursive: true, dereference: true });
  cpSync(WEB_STATIC_ROOT, path.join(WEB_OUTPUT_ROOT, '.next', 'static'), {
    recursive: true,
    dereference: true,
  });
  cpSync(WEB_PUBLIC_ROOT, path.join(WEB_OUTPUT_ROOT, 'public'), {
    recursive: true,
    dereference: true,
  });

  flattenSymlinks(WEB_OUTPUT_ROOT);
}

function flattenSymlinks(rootDir) {
  const queue = [rootDir];

  while (queue.length > 0) {
    const currentPath = queue.shift();
    const entries = readdirSync(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      const stat = lstatSync(entryPath);

      if (stat.isSymbolicLink()) {
        const targetPath = readlinkSync(entryPath);
        const resolvedTargetPath = path.isAbsolute(targetPath)
          ? realpathSync(targetPath)
          : realpathSync(path.resolve(path.dirname(entryPath), targetPath));

        unlinkSync(entryPath);
        cpSync(resolvedTargetPath, entryPath, {
          recursive: true,
          dereference: true,
        });

        const replacedStat = statSync(entryPath);
        if (replacedStat.isDirectory()) {
          queue.push(entryPath);
        }
        continue;
      }

      if (stat.isDirectory()) {
        queue.push(entryPath);
      }
    }
  }
}

function normalizePackageName(specifier) {
  if (!specifier || specifier.startsWith('node:') || specifier.startsWith('.') || path.isAbsolute(specifier)) {
    return null;
  }

  if (specifier.startsWith('@')) {
    const segments = specifier.split('/');
    return segments.length >= 2 ? `${segments[0]}/${segments[1]}` : specifier;
  }

  return specifier.split('/')[0] || null;
}

function copyRuntimePackage(packageName) {
  const packageSegments = packageName.split('/');
  const sourcePath = path.join(SOURCE_ROOT, 'node_modules', ...packageSegments);
  const destinationPath = path.join(RUNTIME_NODE_MODULES_ROOT, ...packageSegments);

  ensureExists(sourcePath, `Runtime package ${packageName}`);
  mkdirSync(path.dirname(destinationPath), { recursive: true });
  cpSync(sourcePath, destinationPath, {
    recursive: true,
    dereference: true,
  });
}

function findRelativeServerEntry(rootDir) {
  const queue = [''];
  while (queue.length > 0) {
    const relativeDir = queue.shift();
    const absoluteDir = path.join(rootDir, relativeDir);
    const entries = readdirSync(absoluteDir);

    for (const entry of entries) {
      const nextRelativePath = path.join(relativeDir, entry);
      const nextAbsolutePath = path.join(rootDir, nextRelativePath);
      const stat = statSync(nextAbsolutePath);

      if (stat.isDirectory()) {
        queue.push(nextRelativePath);
        continue;
      }

      if (entry === 'server.js') {
        return nextRelativePath.replaceAll(path.sep, '/');
      }
    }
  }

  return null;
}

async function bundleLiveGateway() {
  mkdirSync(LIVE_GATEWAY_OUTPUT_ROOT, { recursive: true });

  const result = await build({
    absWorkingDir: SOURCE_ROOT,
    entryPoints: [path.join(SOURCE_ROOT, 'apps', 'gateway', 'src', 'server.ts')],
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile: LIVE_GATEWAY_ENTRY,
    metafile: true,
    sourcemap: false,
    logLevel: 'info',
  });

  mkdirSync(RUNTIME_NODE_MODULES_ROOT, { recursive: true });

  const packageNames = new Set();
  for (const output of Object.values(result.metafile.outputs)) {
    for (const imported of output.imports ?? []) {
      if (!imported.external) {
        continue;
      }
      const packageName = normalizePackageName(imported.path);
      if (packageName) {
        packageNames.add(packageName);
      }
    }
  }

  for (const packageName of [...packageNames].sort()) {
    copyRuntimePackage(packageName);
  }
}

function writeManifest() {
  const webEntry = findRelativeServerEntry(WEB_OUTPUT_ROOT);
  if (!webEntry) {
    throw new Error(`Unable to find bundled web server.js under ${WEB_OUTPUT_ROOT}`);
  }

  const manifest = {
    sourceRoot: SOURCE_ROOT,
    builtAt: new Date().toISOString(),
    web: {
      root: 'web',
      entry: `web/${webEntry}`,
    },
    liveGateway: {
      entry: 'live-gateway/server.mjs',
    },
  };

  writeFileSync(
    path.join(OUTPUT_ROOT, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8',
  );
}

echo`📦 Bundling Tnyma local web stack...`;
ensureSourceRoot();
ensureExists(SOURCE_ROOT, 'Tnyma AI source repository');
ensureExists(path.join(SOURCE_ROOT, 'package.json'), 'Tnyma AI package.json');
ensureExists(path.join(SOURCE_ROOT, 'node_modules'), 'Tnyma AI node_modules');

cleanOutput();
runPnpmBuildWeb();
copyWebRuntime();
await bundleLiveGateway();
writeManifest();

echo`✅ Tnyma local web stack bundled at ${OUTPUT_ROOT}`;
