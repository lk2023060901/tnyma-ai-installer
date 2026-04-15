#!/usr/bin/env zx

import 'zx/globals';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, rmSync, cpSync, writeFileSync } from 'node:fs';
import { join, dirname, basename, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform === 'win32' && !$.quote) {
  // zx 8.x requires an explicit quote function on Windows.
  $.shell = process.env.ComSpec || 'cmd.exe';
  $.prefix = '';
  $.quote = (arg) => {
    const s = String(arg);
    if (!/[\s"&|<>^%()!]/.test(s)) return s;
    return `"${s.replace(/"/g, '\\"')}"`;
  };
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const MANIFEST_PATH = join(ROOT, 'resources', 'skills', 'preinstalled-manifest.json');
const OUTPUT_ROOT = join(ROOT, 'build', 'preinstalled-skills');
const TMP_ROOT = join(ROOT, 'build', '.tmp-preinstalled-skills');

function findWindowsExecutable(names, fallbackPaths = []) {
  const normalizedNames = names.map((name) => name.toLowerCase().endsWith('.exe') ? name : `${name}.exe`);
  const candidates = [];
  const seen = new Set();

  const pushCandidate = (value) => {
    if (!value) return;
    const candidate = String(value).trim().replace(/^"+|"+$/g, '');
    if (!candidate) return;
    const key = candidate.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(candidate);
  };

  for (const name of normalizedNames) {
    try {
      const output = execFileSync('where.exe', [name], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      for (const line of output.split(/\r?\n/)) {
        pushCandidate(line);
      }
    } catch {
      // Ignore lookup failures and continue with PATH/common-location fallbacks.
    }
  }

  for (const entry of (process.env.PATH || '').split(delimiter)) {
    for (const name of normalizedNames) {
      pushCandidate(join(entry, name));
    }
  }

  for (const fallback of fallbackPaths) {
    pushCandidate(fallback);
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Unable to resolve ${normalizedNames.join(' or ')}. ` +
    'Install Git for Windows / bsdtar and ensure the .exe is available on PATH.',
  );
}

function resolveExecutable(names, fallbackPaths = []) {
  if (process.platform !== 'win32') {
    return names[0];
  }
  return findWindowsExecutable(names, fallbackPaths);
}

const WINDOWS_GIT_FALLBACKS = [
  process.env['ProgramFiles'] ? join(process.env['ProgramFiles'], 'Git', 'cmd', 'git.exe') : '',
  process.env['ProgramFiles'] ? join(process.env['ProgramFiles'], 'Git', 'bin', 'git.exe') : '',
  process.env['ProgramFiles(x86)'] ? join(process.env['ProgramFiles(x86)'], 'Git', 'cmd', 'git.exe') : '',
  process.env['ProgramFiles(x86)'] ? join(process.env['ProgramFiles(x86)'], 'Git', 'bin', 'git.exe') : '',
  process.env['LocalAppData'] ? join(process.env['LocalAppData'], 'Programs', 'Git', 'cmd', 'git.exe') : '',
  process.env['LocalAppData'] ? join(process.env['LocalAppData'], 'Programs', 'Git', 'bin', 'git.exe') : '',
];

const WINDOWS_TAR_FALLBACKS = [
  process.env.SystemRoot ? join(process.env.SystemRoot, 'System32', 'tar.exe') : '',
  process.env.SystemRoot ? join(process.env.SystemRoot, 'System32', 'bsdtar.exe') : '',
  process.env['ProgramFiles'] ? join(process.env['ProgramFiles'], 'Git', 'usr', 'bin', 'tar.exe') : '',
  process.env['ProgramFiles'] ? join(process.env['ProgramFiles'], 'Git', 'usr', 'bin', 'bsdtar.exe') : '',
];

const GIT_BIN = resolveExecutable(['git'], WINDOWS_GIT_FALLBACKS);
const TAR_BIN = resolveExecutable(['tar', 'bsdtar'], WINDOWS_TAR_FALLBACKS);
const BSDTAR_BIN = process.platform === 'win32'
  ? (() => {
      try {
        return findWindowsExecutable(['bsdtar'], WINDOWS_TAR_FALLBACKS);
      } catch {
        return TAR_BIN;
      }
    })()
  : 'bsdtar';

function loadManifest() {
  if (!existsSync(MANIFEST_PATH)) {
    throw new Error(`Missing manifest: ${MANIFEST_PATH}`);
  }
  const raw = readFileSync(MANIFEST_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.skills)) {
    throw new Error('Invalid preinstalled-skills manifest format');
  }
  for (const item of parsed.skills) {
    if (!item.slug || !item.repo || !item.repoPath) {
      throw new Error(`Invalid manifest entry: ${JSON.stringify(item)}`);
    }
  }
  return parsed.skills;
}

function groupByRepoRef(entries) {
  const grouped = new Map();
  for (const entry of entries) {
    const ref = entry.ref || 'main';
    const key = `${entry.repo}#${ref}`;
    if (!grouped.has(key)) grouped.set(key, { repo: entry.repo, ref, entries: [] });
    grouped.get(key).entries.push(entry);
  }
  return [...grouped.values()];
}

function createRepoDirName(repo, ref) {
  return `${repo.replace(/[\\/]/g, '__')}__${ref.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
}

function toGitPath(inputPath) {
  if (process.platform !== 'win32') return inputPath;
  // Git on Windows accepts forward slashes and avoids backslash escape quirks.
  return inputPath.replace(/\\/g, '/');
}

function normalizeRepoPath(repoPath) {
  return repoPath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

function shouldCopySkillFile(srcPath) {
  const base = basename(srcPath);
  if (base === '.git') return false;
  if (base === '.subset.tar') return false;
  return true;
}

async function extractArchive(archiveFileName, cwd) {
  const prevCwd = $.cwd;
  $.cwd = cwd;
  try {
    try {
      await $`${TAR_BIN} -xf ${archiveFileName}`;
      return;
    } catch (tarError) {
      if (process.platform === 'win32' && BSDTAR_BIN !== TAR_BIN) {
        // Some Windows images expose bsdtar instead of tar.
        await $`${BSDTAR_BIN} -xf ${archiveFileName}`;
        return;
      }
      throw tarError;
    }
  } finally {
    $.cwd = prevCwd;
  }
}

async function fetchSparseRepo(repo, ref, paths, checkoutDir) {
  const remote = `https://github.com/${repo}.git`;
  mkdirSync(checkoutDir, { recursive: true });
  const gitCheckoutDir = toGitPath(checkoutDir);
  const archiveFileName = '.subset.tar';
  const archivePath = join(checkoutDir, archiveFileName);
  const archivePaths = [...new Set(paths.map(normalizeRepoPath))];

  await $`${GIT_BIN} init ${gitCheckoutDir}`;
  await $`${GIT_BIN} -C ${gitCheckoutDir} remote add origin ${remote}`;
  await $`${GIT_BIN} -C ${gitCheckoutDir} fetch --depth 1 origin ${ref}`;
  // Do not checkout working tree on Windows: upstream repos may contain
  // Windows-invalid paths. Export only requested directories via git archive.
  await $`${GIT_BIN} -C ${gitCheckoutDir} archive --format=tar --output ${archiveFileName} FETCH_HEAD ${archivePaths}`;
  await extractArchive(archiveFileName, checkoutDir);
  rmSync(archivePath, { force: true });

  const commit = (await $`${GIT_BIN} -C ${gitCheckoutDir} rev-parse FETCH_HEAD`).stdout.trim();
  return commit;
}

echo`Bundling preinstalled skills...`;

if (process.env.SKIP_PREINSTALLED_SKILLS === '1') {
  echo`⏭  SKIP_PREINSTALLED_SKILLS=1 set, skipping skills fetch.`;
  process.exit(0);
}

const manifestSkills = loadManifest();

rmSync(OUTPUT_ROOT, { recursive: true, force: true });
mkdirSync(OUTPUT_ROOT, { recursive: true });
rmSync(TMP_ROOT, { recursive: true, force: true });
mkdirSync(TMP_ROOT, { recursive: true });

const lock = {
  generatedAt: new Date().toISOString(),
  skills: [],
};

const groups = groupByRepoRef(manifestSkills);
for (const group of groups) {
  const repoDir = join(TMP_ROOT, createRepoDirName(group.repo, group.ref));
  const sparsePaths = [...new Set(group.entries.map((entry) => entry.repoPath))];

  echo`Fetching ${group.repo} @ ${group.ref}`;
  const commit = await fetchSparseRepo(group.repo, group.ref, sparsePaths, repoDir);
  echo`   commit ${commit}`;

  for (const entry of group.entries) {
    const sourceDir = join(repoDir, entry.repoPath);
    const targetDir = join(OUTPUT_ROOT, entry.slug);

    if (!existsSync(sourceDir)) {
      throw new Error(`Missing source path in repo checkout: ${entry.repoPath}`);
    }

    rmSync(targetDir, { recursive: true, force: true });
    cpSync(sourceDir, targetDir, { recursive: true, dereference: true, filter: shouldCopySkillFile });

    const skillManifest = join(targetDir, 'SKILL.md');
    if (!existsSync(skillManifest)) {
      throw new Error(`Skill ${entry.slug} is missing SKILL.md after copy`);
    }

    const requestedVersion = (entry.version || '').trim();
    const resolvedVersion = !requestedVersion || requestedVersion === 'main'
      ? commit
      : requestedVersion;
    lock.skills.push({
      slug: entry.slug,
      version: resolvedVersion,
      repo: entry.repo,
      repoPath: entry.repoPath,
      ref: group.ref,
      commit,
    });

    echo`   OK ${entry.slug}`;
  }
}

writeFileSync(join(OUTPUT_ROOT, '.preinstalled-lock.json'), `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
rmSync(TMP_ROOT, { recursive: true, force: true });
echo`Preinstalled skills ready: ${OUTPUT_ROOT}`;
