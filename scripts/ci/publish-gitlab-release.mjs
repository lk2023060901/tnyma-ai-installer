#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const RELEASE_DIR = path.resolve(process.env.CI_RELEASE_DIR?.trim() || path.join(ROOT, 'release'));
const RELEASE_NOTES_PATH = path.resolve(
  process.env.CI_RELEASE_NOTES_PATH?.trim() || path.join(ROOT, 'build', 'release-notes.md'),
);
const BUILD_METADATA_PATH = path.resolve(
  process.env.BUILD_METADATA_PATH?.trim() || path.join(ROOT, 'build', 'build-metadata.json'),
);
const PACKAGE_JSON_PATH = path.join(ROOT, 'package.json');
const packageJson = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8'));

const {
  CI_API_V4_URL,
  CI_COMMIT_TAG,
  CI_JOB_TOKEN,
  CI_PIPELINE_ID,
  CI_PIPELINE_URL,
  CI_PROJECT_ID,
  CI_PROJECT_URL,
} = process.env;

const PACKAGE_NAME = (process.env.CI_RELEASE_PACKAGE_NAME?.trim() || 'tnyma-ai-installer').replace(/\s+/g, '-');
const DIRECT_ASSET_PREFIX = (process.env.CI_RELEASE_ASSET_PATH_PREFIX?.trim() || '/installers').replace(/\/+$/, '');
const PUBLIC_DOWNLOAD_BASE_URL = (process.env.CI_PUBLIC_DOWNLOAD_BASE_URL?.trim() || '').replace(/\/+$/, '');
const DRY_RUN = ['1', 'true', 'yes'].includes((process.env.CI_RELEASE_DRY_RUN || '').trim().toLowerCase());

const REQUIRED_ENV = ['CI_API_V4_URL', 'CI_COMMIT_TAG', 'CI_JOB_TOKEN', 'CI_PROJECT_ID', 'CI_PROJECT_URL'];

const GROUP_ORDER = [
  'Features',
  'Bug Fixes',
  'Performance',
  'Refactors',
  'Documentation',
  'CI/CD',
  'Build System',
  'Maintenance',
  'Tests',
  'Other Changes',
];

function requireEnv() {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing required CI environment variables: ${missing.join(', ')}`);
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT,
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

function tryRun(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    env: {
      ...process.env,
      ...options.env,
    },
  });

  return {
    status: result.status ?? 1,
    stdout: result.stdout?.trim() || '',
    stderr: result.stderr?.trim() || '',
  };
}

function ensureGitHistory() {
  const shallowPath = path.join(ROOT, '.git', 'shallow');

  if (existsSync(shallowPath)) {
    const unshallow = tryRun('git', ['fetch', '--tags', '--force', '--prune', '--unshallow', 'origin']);
    if (unshallow.status === 0) {
      return;
    }
  }

  run('git', ['fetch', '--tags', '--force', '--prune', 'origin']);
}

function getCurrentTagCommit() {
  return run('git', ['rev-list', '-n', '1', CI_COMMIT_TAG], { capture: true });
}

function getPreviousTag(currentCommit) {
  const previous = tryRun('git', ['describe', '--tags', '--abbrev=0', `${currentCommit}^`]);
  return previous.status === 0 ? previous.stdout : null;
}

function getCommitRows(previousTag) {
  const args = ['log', '--no-merges', '--pretty=format:%H%x09%s'];
  if (previousTag) {
    args.push(`${previousTag}..${CI_COMMIT_TAG}`);
  } else {
    args.push(CI_COMMIT_TAG);
  }

  const output = run('git', args, { capture: true });
  if (!output) {
    return [];
  }

  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sha, subject] = line.split('\t');
      return {
        sha,
        shortSha: sha.slice(0, 8),
        subject: subject || sha,
      };
    });
}

function classifyCommit(subject) {
  const match = subject.match(/^([a-z]+)(?:\([^)]+\))?!?:\s+(.*)$/i);
  const rawType = match?.[1]?.toLowerCase() || 'other';

  switch (rawType) {
    case 'feat':
      return 'Features';
    case 'fix':
      return 'Bug Fixes';
    case 'perf':
      return 'Performance';
    case 'refactor':
      return 'Refactors';
    case 'docs':
      return 'Documentation';
    case 'ci':
      return 'CI/CD';
    case 'build':
      return 'Build System';
    case 'chore':
      return 'Maintenance';
    case 'test':
      return 'Tests';
    default:
      return 'Other Changes';
  }
}

function loadBuildMetadata() {
  if (!existsSync(BUILD_METADATA_PATH)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(BUILD_METADATA_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function isPrimaryDownloadAsset(filename) {
  return /\.(dmg|zip|exe|AppImage|deb|rpm)$/i.test(filename);
}

function sortAssets(a, b) {
  const rank = (asset) => {
    const name = asset.filename.toLowerCase();
    if (name.includes('-mac-')) return 0;
    if (name.includes('-win')) return 1;
    if (name.includes('-linux')) return 2;
    return 3;
  };

  const rankDiff = rank(a) - rank(b);
  if (rankDiff !== 0) {
    return rankDiff;
  }

  return a.filename.localeCompare(b.filename);
}

function collectAssets() {
  if (!existsSync(RELEASE_DIR)) {
    throw new Error(`Release directory does not exist: ${RELEASE_DIR}`);
  }

  const files = readdirSync(RELEASE_DIR)
    .map((name) => path.join(RELEASE_DIR, name))
    .filter((targetPath) => statSync(targetPath).isFile());

  const assets = files
    .map((targetPath) => ({
      path: targetPath,
      filename: path.basename(targetPath),
    }))
    .filter(({ filename }) => isPrimaryDownloadAsset(filename))
    .map((asset) => ({
      ...asset,
      packageUrl: `${CI_API_V4_URL}/projects/${encodeURIComponent(CI_PROJECT_ID)}/packages/generic/${encodeURIComponent(PACKAGE_NAME)}/${encodeURIComponent(CI_COMMIT_TAG)}/${encodeURIComponent(asset.filename)}`,
      directAssetPath: `${DIRECT_ASSET_PREFIX}/${asset.filename}`,
      directDownloadUrl: PUBLIC_DOWNLOAD_BASE_URL
        ? `${PUBLIC_DOWNLOAD_BASE_URL}/${encodeURIComponent(CI_COMMIT_TAG)}/${encodeURIComponent(asset.filename)}`
        : `${CI_PROJECT_URL}/-/releases/${encodeURIComponent(CI_COMMIT_TAG)}/downloads${DIRECT_ASSET_PREFIX}/${encodeURIComponent(asset.filename)}`,
      releaseLinkUrl: PUBLIC_DOWNLOAD_BASE_URL
        ? `${PUBLIC_DOWNLOAD_BASE_URL}/${encodeURIComponent(CI_COMMIT_TAG)}/${encodeURIComponent(asset.filename)}`
        : `${CI_PROJECT_URL}/-/releases/${encodeURIComponent(CI_COMMIT_TAG)}/downloads${DIRECT_ASSET_PREFIX}/${encodeURIComponent(asset.filename)}`,
      linkType: 'package',
      primary: isPrimaryDownloadAsset(asset.filename),
    }))
    .sort(sortAssets);

  if (assets.length === 0) {
    throw new Error(`No release assets found in ${RELEASE_DIR}`);
  }

  return assets;
}

function humanLabel(filename) {
  const lower = filename.toLowerCase();

  if (lower.includes('-mac-arm64')) return 'macOS arm64';
  if (lower.includes('-mac-x64')) return 'macOS x64';
  if (lower.includes('-win-arm64')) return 'Windows arm64';
  if (lower.includes('-win-x64')) return 'Windows x64';
  if (lower.includes('-linux-arm64')) return 'Linux arm64';
  if (lower.includes('-linux-x86_64') || lower.includes('-linux-amd64')) return 'Linux x64';
  if (lower.endsWith('.dmg')) return 'macOS';
  if (lower.endsWith('.exe')) return 'Windows';
  if (lower.endsWith('.appimage') || lower.endsWith('.deb') || lower.endsWith('.rpm')) return 'Linux';
  if (lower.endsWith('.zip')) return 'Archive';
  if (lower.endsWith('.yml')) return 'Update feed';
  return 'Download';
}

function buildDownloadsMarkdown(assets) {
  const primary = assets.filter((asset) => asset.primary);
  if (primary.length === 0) {
    return '';
  }

  const lines = [
    '## Downloads',
    '',
    '| Platform | File | Link |',
    '| --- | --- | --- |',
  ];

  for (const asset of primary) {
    lines.push(`| ${humanLabel(asset.filename)} | \`${asset.filename}\` | [Download](${asset.directDownloadUrl}) |`);
  }

  return lines.join('\n');
}

function buildChangelogMarkdown(previousTag, commits) {
  if (commits.length === 0) {
    return '## Changes\n\n- No new commits were detected for this tag.\n';
  }

  const groups = new Map();
  for (const groupName of GROUP_ORDER) {
    groups.set(groupName, []);
  }

  for (const commit of commits) {
    groups.get(classifyCommit(commit.subject)).push(commit);
  }

  const lines = ['## Changes', ''];

  for (const groupName of GROUP_ORDER) {
    const entries = groups.get(groupName);
    if (!entries || entries.length === 0) {
      continue;
    }

    lines.push(`### ${groupName}`);
    lines.push('');
    for (const commit of entries) {
      lines.push(`- ${commit.subject} ([\`${commit.shortSha}\`](${CI_PROJECT_URL}/-/commit/${commit.sha}))`);
    }
    lines.push('');
  }

  if (previousTag) {
    lines.push(`Full diff: [${previousTag}...${CI_COMMIT_TAG}](${CI_PROJECT_URL}/-/compare/${encodeURIComponent(previousTag)}...${encodeURIComponent(CI_COMMIT_TAG)})`);
    lines.push('');
  }

  return lines.join('\n').trimEnd() + '\n';
}

function buildReleaseNotes(previousTag, commits, assets, metadata) {
  const runtimeVersion = packageJson.devDependencies?.openclaw
    || packageJson.dependencies?.openclaw
    || null;
  const tnymaRevision = metadata?.tnymaAi?.revision || null;
  const downloadsMarkdown = buildDownloadsMarkdown(assets);
  const changelogMarkdown = buildChangelogMarkdown(previousTag, commits);

  const lines = [
    `# TnymaAI ${CI_COMMIT_TAG}`,
    '',
    '## Build Info',
    '',
    `- Installer version: \`${packageJson.version}\``,
    `- Bundled openclaw npm package: \`openclaw@${runtimeVersion || 'unknown'}\``,
    `- Bundled tnyma-ai revision: \`${tnymaRevision || 'unknown'}\``,
    `- Pipeline: [#${CI_PIPELINE_ID || 'unknown'}](${CI_PIPELINE_URL || CI_PROJECT_URL})`,
    '',
  ];

  if (downloadsMarkdown) {
    lines.push(downloadsMarkdown, '');
  }

  lines.push(changelogMarkdown.trimEnd());

  return lines.join('\n').trim() + '\n';
}

async function apiRequest(pathname, options = {}) {
  const response = await fetch(`${CI_API_V4_URL}${pathname}`, {
    method: options.method || 'GET',
    headers: {
      'JOB-TOKEN': CI_JOB_TOKEN,
      ...(options.json ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
    body: options.json ? JSON.stringify(options.json) : options.body,
  });

  const text = await response.text();
  const contentType = response.headers.get('content-type') || '';
  let parsed = null;

  if (text && contentType.includes('application/json')) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    const message = parsed?.message || text || `${response.status} ${response.statusText}`;
    const error = new Error(`GitLab API ${options.method || 'GET'} ${pathname} failed: ${message}`);
    error.status = response.status;
    error.body = parsed || text;
    throw error;
  }

  return parsed ?? text;
}

async function uploadAsset(asset) {
  const response = await fetch(asset.packageUrl, {
    method: 'PUT',
    headers: {
      'JOB-TOKEN': CI_JOB_TOKEN,
      'Content-Type': 'application/octet-stream',
    },
    duplex: 'half',
    body: createReadStream(asset.path),
  });

  const body = await response.text();
  if (response.status === 200 || response.status === 201) {
    console.log(`Uploaded package asset: ${asset.filename}`);
    return;
  }

  if ((response.status === 400 || response.status === 409) && /already exists|duplicate|taken/i.test(body)) {
    console.log(`Package asset already exists, keeping current file: ${asset.filename}`);
    return;
  }

  throw new Error(`Failed to upload package asset ${asset.filename}: ${response.status} ${body}`);
}

async function upsertRelease(releaseName, description) {
  const releasePath = `/projects/${encodeURIComponent(CI_PROJECT_ID)}/releases/${encodeURIComponent(CI_COMMIT_TAG)}`;

  try {
    await apiRequest(releasePath, { method: 'GET' });
    await apiRequest(releasePath, {
      method: 'PUT',
      json: {
        name: releaseName,
        description,
      },
    });
    console.log(`Updated GitLab release: ${CI_COMMIT_TAG}`);
    return;
  } catch (error) {
    if (error.status !== 404) {
      throw error;
    }
  }

  await apiRequest(`/projects/${encodeURIComponent(CI_PROJECT_ID)}/releases`, {
    method: 'POST',
    json: {
      tag_name: CI_COMMIT_TAG,
      name: releaseName,
      description,
    },
  });
  console.log(`Created GitLab release: ${CI_COMMIT_TAG}`);
}

async function syncReleaseLinks(assets) {
  const basePath = `/projects/${encodeURIComponent(CI_PROJECT_ID)}/releases/${encodeURIComponent(CI_COMMIT_TAG)}/assets/links`;
  const existingLinks = await apiRequest(basePath, { method: 'GET' });

  for (const asset of assets) {
    const existing = existingLinks.find((link) => (
      link.name === asset.filename
      || link.url === asset.packageUrl
      || link.url === asset.releaseLinkUrl
      || link.direct_asset_url === asset.directDownloadUrl
    ));
    const payload = {
      name: asset.filename,
      url: asset.releaseLinkUrl,
      link_type: asset.linkType,
    };

    if (!PUBLIC_DOWNLOAD_BASE_URL) {
      payload.direct_asset_path = asset.directAssetPath;
    }

    if (existing) {
      await apiRequest(`${basePath}/${existing.id}`, {
        method: 'PUT',
        json: payload,
      });
      console.log(`Updated release asset link: ${asset.filename}`);
      continue;
    }

    await apiRequest(basePath, {
      method: 'POST',
      json: payload,
    });
    console.log(`Created release asset link: ${asset.filename}`);
  }
}

async function collectReleaseEvidence() {
  try {
    await apiRequest(`/projects/${encodeURIComponent(CI_PROJECT_ID)}/releases/${encodeURIComponent(CI_COMMIT_TAG)}/evidence`, {
      method: 'POST',
    });
    console.log(`Collected release evidence: ${CI_COMMIT_TAG}`);
  } catch (error) {
    console.warn(`Skipping release evidence collection: ${error.message}`);
  }
}

async function main() {
  requireEnv();
  ensureGitHistory();

  const currentCommit = getCurrentTagCommit();
  const previousTag = getPreviousTag(currentCommit);
  const commits = getCommitRows(previousTag);
  const assets = collectAssets();
  const metadata = loadBuildMetadata();
  const notes = buildReleaseNotes(previousTag, commits, assets, metadata);

  mkdirSync(path.dirname(RELEASE_NOTES_PATH), { recursive: true });
  writeFileSync(RELEASE_NOTES_PATH, notes, 'utf8');
  console.log(`Wrote release notes: ${RELEASE_NOTES_PATH}`);

  if (DRY_RUN) {
    console.log('Dry-run enabled, skipping GitLab upload/release API calls.');
    for (const asset of assets) {
      console.log(`[dry-run] ${asset.filename} -> ${asset.directDownloadUrl}`);
    }
    return;
  }

  for (const asset of assets) {
    await uploadAsset(asset);
  }

  await upsertRelease(`TnymaAI ${CI_COMMIT_TAG}`, notes);
  await syncReleaseLinks(assets);
  await collectReleaseEvidence();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
