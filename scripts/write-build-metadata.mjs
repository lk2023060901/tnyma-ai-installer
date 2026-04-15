#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUTPUT_PATH = path.resolve(process.env.BUILD_METADATA_PATH?.trim() || path.join(ROOT, 'build', 'build-metadata.json'));
const packageJson = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const stackManifestPath = path.join(ROOT, 'build', 'tnyma-web-stack', 'manifest.json');
const stackManifest = existsSync(stackManifestPath)
  ? JSON.parse(readFileSync(stackManifestPath, 'utf8'))
  : null;

function resolveGitRevision(targetPath) {
  const result = spawnSync('git', ['-C', targetPath, 'rev-parse', 'HEAD'], {
    stdio: ['ignore', 'pipe', 'ignore'],
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    return null;
  }

  return result.stdout.trim() || null;
}

const metadata = {
  schemaVersion: 1,
  builtAt: new Date().toISOString(),
  installer: {
    name: packageJson.name,
    version: packageJson.version,
    revision: resolveGitRevision(ROOT),
  },
  TnymaAI: {
    npmPackage: 'TnymaAI',
    version: process.env.OPENCLAW_NPM_VERSION?.trim()
      || packageJson.devDependencies?.openclaw
      || packageJson.dependencies?.openclaw
      || null,
  },
  tnymaAi: stackManifest
    ? {
        project: stackManifest.sourceProject || 'tnyma-ai',
        version: stackManifest.sourceVersion || null,
        revision: stackManifest.sourceRevision || null,
        bridgeMode: stackManifest.bridge?.mode || 'embedded',
      }
    : null,
  ci: {
    commitSha: process.env.CI_COMMIT_SHA || null,
    commitTag: process.env.CI_COMMIT_TAG || null,
    pipelineId: process.env.CI_PIPELINE_ID || null,
    pipelineUrl: process.env.CI_PIPELINE_URL || null,
    runnerDescription: process.env.CI_RUNNER_DESCRIPTION || null,
    runnerTags: process.env.CI_RUNNER_TAGS
      ? process.env.CI_RUNNER_TAGS.split(',').map((value) => value.trim()).filter(Boolean)
      : [],
    platform: `${process.platform}/${process.arch}`,
  },
};

mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, JSON.stringify(metadata, null, 2) + '\n', 'utf8');

console.log(`Wrote build metadata: ${OUTPUT_PATH}`);
