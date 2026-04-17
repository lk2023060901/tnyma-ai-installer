import { exec, execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import net from 'node:net';
import { PORTS } from '../utils/config';
import { logger } from '../utils/logger';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const POSIX_INSTALL_ROOTS = ['/opt/TnymaAI', '/opt/OpenClaw'];
const POSIX_SYMLINKS = ['/usr/local/bin/tnyma-ai', '/usr/local/bin/openclaw'];
const WINDOWS_PROCESS_IMAGES = ['TnymaAI.exe', 'OpenClaw.exe'];
const POSIX_PROCESS_NAMES = ['TnymaAI', 'OpenClaw', 'tnyma-ai', 'openclaw-gateway'];
const LAUNCHD_LABELS = ['ai.openclaw.gateway', 'ai.openclaw.codexdoc'];
const LAUNCHD_PLIST_NAMES = ['ai.openclaw.gateway.plist', 'ai.openclaw.codexdoc.plist'];
const LOGIN_ITEM_NAMES = ['TnymaAI', 'OpenClaw'];

export type InstalledProductIndicatorKind = 'path' | 'port';

export interface InstalledProductIndicator {
  kind: InstalledProductIndicatorKind;
  value: string;
}

export interface InstalledProductCheckResult {
  success: true;
  detected: boolean;
  platform: NodeJS.Platform;
  indicators: InstalledProductIndicator[];
}

export interface InstalledProductUninstallResult {
  success: boolean;
  platform: NodeJS.Platform;
  removedPaths: string[];
  failures: string[];
  remainingIndicators: InstalledProductIndicator[];
}

interface InstalledProductOptions {
  ignoredProcessIds?: number[];
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.filter(Boolean))];
}

function normalizePathForComparison(targetPath: string, platform: NodeJS.Platform): string {
  const normalized = platform === 'win32'
    ? path.win32.normalize(targetPath)
    : path.posix.normalize(targetPath);
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function getWindowsLocalAppData(env = process.env, homeDir = homedir()): string {
  return env.LOCALAPPDATA?.trim() || path.win32.join(homeDir, 'AppData', 'Local');
}

function getWindowsRoamingAppData(env = process.env, homeDir = homedir()): string {
  return env.APPDATA?.trim() || path.win32.join(homeDir, 'AppData', 'Roaming');
}

function getMacAppBundles(homeDir: string): string[] {
  return [
    '/Applications/TnymaAI.app',
    path.posix.join(homeDir, 'Applications', 'TnymaAI.app'),
    '/Applications/OpenClaw.app',
    path.posix.join(homeDir, 'Applications', 'OpenClaw.app'),
  ];
}

export function getCurrentInstallMarkerPaths(
  platform: NodeJS.Platform = process.platform,
  execPathValue = process.execPath,
): string[] {
  if (!execPathValue) {
    return [];
  }

  if (platform === 'darwin') {
    const marker = `.app${path.posix.sep}Contents${path.posix.sep}`;
    const normalized = path.posix.normalize(execPathValue);
    const markerIndex = normalized.indexOf(marker);
    if (markerIndex >= 0) {
      return [normalized.slice(0, markerIndex + '.app'.length)];
    }
    return [];
  }

  if (platform === 'win32') {
    const normalized = path.win32.normalize(execPathValue);
    return [path.win32.dirname(normalized)];
  }

  const normalized = path.posix.normalize(execPathValue);
  return POSIX_INSTALL_ROOTS.filter((root) => normalized === root || normalized.startsWith(`${root}/`));
}

export function excludeCurrentInstallMarkerPaths(
  candidatePaths: string[],
  platform: NodeJS.Platform = process.platform,
  execPathValue = process.execPath,
): string[] {
  const currentMarkers = new Set(
    getCurrentInstallMarkerPaths(platform, execPathValue).map((targetPath) => normalizePathForComparison(targetPath, platform)),
  );

  if (currentMarkers.size === 0) {
    return candidatePaths;
  }

  return candidatePaths.filter(
    (targetPath) => !currentMarkers.has(normalizePathForComparison(targetPath, platform)),
  );
}

function joinForPlatform(platform: NodeJS.Platform, ...segments: string[]): string {
  if (platform === 'win32') {
    return path.win32.join(...segments);
  }
  return path.posix.join(...segments);
}

export function getInstalledProductCandidatePaths(
  platform: NodeJS.Platform = process.platform,
  env = process.env,
  homeDir = homedir(),
): string[] {
  const commonPaths = [
    joinForPlatform(platform, homeDir, '.openclaw'),
    joinForPlatform(platform, homeDir, '.tnyma-ai'),
  ];

  if (platform === 'darwin') {
    return uniquePaths([
      ...commonPaths,
      ...getMacAppBundles(homeDir),
      joinForPlatform(platform, homeDir, 'Library', 'Application Support', 'TnymaAI'),
      joinForPlatform(platform, homeDir, 'Library', 'Application Support', 'OpenClaw'),
      joinForPlatform(platform, homeDir, 'Library', 'Application Support', 'openclaw-office-installer'),
      joinForPlatform(platform, homeDir, 'Library', 'Caches', 'TnymaAI'),
      joinForPlatform(platform, homeDir, 'Library', 'Caches', 'OpenClaw'),
      joinForPlatform(platform, homeDir, 'Library', 'Logs', 'TnymaAI'),
      joinForPlatform(platform, homeDir, 'Library', 'Logs', 'OpenClaw'),
      joinForPlatform(platform, homeDir, 'Library', 'Preferences', 'app.tnyma-ai.desktop.plist'),
      joinForPlatform(platform, homeDir, 'Library', 'Preferences', 'ai.openclaw.mac.plist'),
      joinForPlatform(platform, homeDir, 'Library', 'Saved Application State', 'app.tnyma-ai.desktop.savedState'),
      joinForPlatform(platform, homeDir, 'Library', 'Saved Application State', 'ai.openclaw.mac.savedState'),
      joinForPlatform(platform, homeDir, 'Library', 'WebKit', 'app.tnyma-ai.desktop'),
      joinForPlatform(platform, homeDir, 'Library', 'WebKit', 'ai.openclaw.mac'),
      joinForPlatform(platform, homeDir, 'Library', 'HTTPStorages', 'app.tnyma-ai.desktop'),
      joinForPlatform(platform, homeDir, 'Library', 'HTTPStorages', 'ai.openclaw.mac'),
      joinForPlatform(platform, homeDir, '.local', 'bin', 'openclaw'),
      ...LAUNCHD_PLIST_NAMES.map((name) => joinForPlatform(platform, homeDir, 'Library', 'LaunchAgents', name)),
    ]);
  }

  if (platform === 'win32') {
    const localAppData = getWindowsLocalAppData(env, homeDir);
    const roamingAppData = getWindowsRoamingAppData(env, homeDir);
    const programsDir = joinForPlatform(platform, localAppData, 'Programs');

    return uniquePaths([
      ...commonPaths,
      joinForPlatform(platform, programsDir, 'TnymaAI'),
      joinForPlatform(platform, programsDir, 'OpenClaw'),
      joinForPlatform(platform, localAppData, 'tnyma-ai'),
      joinForPlatform(platform, localAppData, 'TnymaAI'),
      joinForPlatform(platform, localAppData, 'OpenClaw'),
      joinForPlatform(platform, roamingAppData, 'tnyma-ai'),
      joinForPlatform(platform, roamingAppData, 'TnymaAI'),
      joinForPlatform(platform, roamingAppData, 'OpenClaw'),
    ]);
  }

  return uniquePaths([
    ...commonPaths,
    ...POSIX_INSTALL_ROOTS,
    ...POSIX_SYMLINKS,
    joinForPlatform(platform, homeDir, '.local', 'bin', 'openclaw'),
    joinForPlatform(platform, homeDir, '.local', 'share', 'applications', 'tnyma-ai.desktop'),
  ]);
}

export function getExistingPathIndicators(
  candidatePaths: string[],
  existsChecker: (path: string) => boolean = existsSync,
): InstalledProductIndicator[] {
  return candidatePaths
    .filter((path) => existsChecker(path))
    .map((path) => ({ kind: 'path' as const, value: path }));
}

export async function isGatewayPortOccupied(port = PORTS.OPENCLAW_GATEWAY): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let resolved = false;

    const finish = (value: boolean) => {
      if (resolved) return;
      resolved = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(500);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function getListeningProcessIds(port: number): Promise<string[]> {
  const command = process.platform === 'win32'
    ? `netstat -ano | findstr :${port}`
    : `lsof -i :${port} -sTCP:LISTEN -t`;

  try {
    const { stdout } = await execAsync(command, { timeout: 5000, windowsHide: true });
    const trimmed = stdout.trim();
    if (!trimmed) {
      return [];
    }

    if (process.platform === 'win32') {
      return [
        ...new Set(
          trimmed
            .split(/\r?\n/)
            .map((line) => line.trim().split(/\s+/))
            .filter((parts) => parts.length >= 5 && parts[3] === 'LISTENING')
            .map((parts) => parts[4]),
        ),
      ];
    }

    return [...new Set(trimmed.split(/\r?\n/).map((value) => value.trim()).filter(Boolean))];
  } catch {
    return [];
  }
}

async function getProcessIdsByImage(image: string): Promise<number[]> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execAsync(`tasklist /FO CSV /NH /FI "IMAGENAME eq ${image}"`, {
        timeout: 5000,
        windowsHide: true,
      });

      return stdout
        .trim()
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.replace(/^"|"$/g, '').split('","'))
        .filter((parts) => parts.length >= 2 && parts[0].toLowerCase() === image.toLowerCase())
        .map((parts) => Number.parseInt(parts[1], 10))
        .filter((pid) => Number.isInteger(pid) && pid > 0);
    }

    const { stdout } = await execAsync(`pgrep -x "${image}"`, { timeout: 5000 });
    return stdout
      .trim()
      .split(/\r?\n/)
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return [];
  }
}

async function killProcessesByCommandPattern(pattern: string): Promise<void> {
  if (!pattern.trim()) {
    return;
  }

  try {
    const { stdout } = await execAsync(`pgrep -f '${pattern.replace(/'/g, `'\\''`)}'`, { timeout: 5000 });
    const processIds = stdout
      .trim()
      .split(/\r?\n/)
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);

    for (const processId of processIds) {
      try {
        process.kill(processId, 'SIGTERM');
      } catch {
        // Ignore already-stopped processes.
      }
    }
  } catch {
    // Ignore missing matches.
  }
}

async function stopMacAppBundleProcesses(candidatePaths: string[]): Promise<void> {
  if (process.platform !== 'darwin') {
    return;
  }

  const appBundlePaths = candidatePaths.filter((targetPath) => targetPath.endsWith('.app'));
  for (const appBundlePath of appBundlePaths) {
    const normalized = path.posix.normalize(appBundlePath);
    await killProcessesByCommandPattern(`${normalized}/Contents/MacOS/`);
    await killProcessesByCommandPattern(`${normalized}/Contents/Frameworks/`);
  }
}

async function stopListeningProcesses(port: number): Promise<void> {
  const processIds = await getListeningProcessIds(port);
  for (const processId of processIds) {
    try {
      if (process.platform === 'win32') {
        await execAsync(`taskkill /F /PID ${processId} /T`, { timeout: 5000, windowsHide: true });
      } else {
        process.kill(Number.parseInt(processId, 10), 'SIGTERM');
      }
    } catch {
      // Best effort only.
    }
  }

  if (process.platform !== 'win32' && processIds.length > 0) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    const remainingProcessIds = await getListeningProcessIds(port);
    for (const processId of remainingProcessIds) {
      try {
        process.kill(Number.parseInt(processId, 10), 'SIGKILL');
      } catch {
        // Best effort only.
      }
    }
  }
}

async function stopKnownProcesses(): Promise<void> {
  if (process.platform === 'win32') {
    for (const image of WINDOWS_PROCESS_IMAGES) {
      const processIds = await getProcessIdsByImage(image);
      for (const processId of processIds) {
        if (processId === process.pid) {
          continue;
        }
        try {
          await execAsync(`taskkill /F /PID ${processId} /T`, { timeout: 5000, windowsHide: true });
        } catch {
          // Ignore already-stopped processes.
        }
      }
    }
    return;
  }

  for (const name of POSIX_PROCESS_NAMES) {
    const processIds = await getProcessIdsByImage(name);
    for (const processId of processIds) {
      if (processId === process.pid) {
        continue;
      }
      try {
        process.kill(processId, 'SIGTERM');
      } catch {
        // Ignore already-stopped processes.
      }
    }
  }
}

async function removePathIfPresent(path: string): Promise<boolean> {
  if (!existsSync(path)) {
    return false;
  }

  try {
    await rm(path, {
      force: true,
      recursive: true,
      maxRetries: 3,
      retryDelay: 300,
    });
  } catch (error) {
    if (process.platform !== 'darwin' || !existsSync(path)) {
      throw error;
    }

    await execFileAsync('/bin/rm', ['-rf', path], { timeout: 10000 });
  }

  if (existsSync(path)) {
    throw new Error(`Failed to remove ${path}: path still exists after uninstall attempt`);
  }

  return true;
}

function normalizeIgnoredProcessIds(options?: InstalledProductOptions): Set<string> {
  return new Set(
    (options?.ignoredProcessIds ?? [])
      .filter((pid) => Number.isInteger(pid) && pid > 0)
      .map((pid) => String(pid)),
  );
}

async function getExternalListeningProcessIds(port: number, options?: InstalledProductOptions): Promise<string[]> {
  const ignored = normalizeIgnoredProcessIds(options);
  const processIds = await getListeningProcessIds(port);
  return processIds.filter((pid) => !ignored.has(pid));
}

export async function detectInstalledProducts(options?: InstalledProductOptions): Promise<InstalledProductCheckResult> {
  const indicators = getExistingPathIndicators(
    excludeCurrentInstallMarkerPaths(getInstalledProductCandidatePaths()),
  );
  if ((await getExternalListeningProcessIds(PORTS.OPENCLAW_GATEWAY, options)).length > 0) {
    indicators.push({ kind: 'port', value: `127.0.0.1:${PORTS.OPENCLAW_GATEWAY}` });
  }

  return {
    success: true,
    detected: indicators.length > 0,
    platform: process.platform,
    indicators,
  };
}

async function bootoutLaunchdServices(): Promise<void> {
  if (process.platform !== 'darwin') {
    return;
  }

  const uid = process.getuid?.();
  if (uid === undefined) {
    return;
  }

  for (const label of LAUNCHD_LABELS) {
    const serviceTarget = `gui/${uid}/${label}`;
    try {
      await execAsync(`launchctl bootout ${serviceTarget}`, { timeout: 10000 });
      logger.info(`Unloaded launchd service: ${serviceTarget}`);
    } catch {
      // Service may not be loaded — that's fine.
    }
  }
}

async function removeMacLoginItems(): Promise<void> {
  if (process.platform !== 'darwin') {
    return;
  }

  for (const name of LOGIN_ITEM_NAMES) {
    try {
      await execAsync(
        `osascript -e 'tell application "System Events" to delete login item "${name}"'`,
        { timeout: 5000 },
      );
    } catch {
      // Login item may not exist — that's fine.
    }
  }
}

async function waitForProcessesDead(checkFn: () => Promise<boolean>, timeoutMs = 5000, pollMs = 300): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await checkFn()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

async function forceKillProcesses(processIds: number[]): Promise<void> {
  for (const pid of processIds) {
    if (pid === process.pid) {
      continue;
    }
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already dead.
    }
  }
}

async function collectAllTargetPids(options?: InstalledProductOptions): Promise<number[]> {
  const pids = new Set<number>();
  const ignored = normalizeIgnoredProcessIds(options);

  // By image name
  for (const name of (process.platform === 'win32' ? WINDOWS_PROCESS_IMAGES : POSIX_PROCESS_NAMES)) {
    for (const pid of await getProcessIdsByImage(name)) {
      if (!ignored.has(String(pid))) {
        pids.add(pid);
      }
    }
  }

  // By port
  for (const pidStr of await getExternalListeningProcessIds(PORTS.OPENCLAW_GATEWAY, options)) {
    const pid = Number.parseInt(pidStr, 10);
    if (Number.isInteger(pid) && pid > 0) {
      pids.add(pid);
    }
  }

  pids.delete(process.pid);
  return [...pids];
}

export async function uninstallInstalledProducts(options?: InstalledProductOptions): Promise<InstalledProductUninstallResult> {
  const candidatePaths = excludeCurrentInstallMarkerPaths(getInstalledProductCandidatePaths());
  const removedPaths: string[] = [];
  const failures: string[] = [];

  logger.info('Attempting to remove existing OpenClaw-compatible installation markers');

  // ── Step 1: Disable watchdogs so they can't respawn gateway ──
  await bootoutLaunchdServices();
  await removeMacLoginItems();

  // ── Step 2: Kill all known processes (SIGTERM) ──
  const pids = await collectAllTargetPids(options);
  for (const pid of pids) {
    try {
      if (process.platform === 'win32') {
        await execAsync(`taskkill /F /PID ${pid} /T`, { timeout: 5000, windowsHide: true });
      } else {
        process.kill(pid, 'SIGTERM');
      }
    } catch {
      // Already dead.
    }
  }

  // Also kill .app bundle child processes on macOS
  await stopMacAppBundleProcesses(candidatePaths);

  // ── Step 3: Wait for processes to die, SIGKILL stragglers ──
  await waitForProcessesDead(async () => (await collectAllTargetPids(options)).length === 0, 3000, 500);

  const remaining = await collectAllTargetPids(options);
  if (remaining.length > 0) {
    await forceKillProcesses(remaining);
    await waitForProcessesDead(async () => (await collectAllTargetPids(options)).length === 0, 3000, 500);
  }

  // ── Step 4: Remove directories and files ──
  for (const targetPath of candidatePaths) {
    try {
      const removed = await removePathIfPresent(targetPath);
      if (removed) {
        removedPaths.push(targetPath);
      }
    } catch (error) {
      failures.push(`Failed to remove ${targetPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const check = await detectInstalledProducts(options);
  if (check.detected) {
    logger.warn('Existing install markers still present after uninstall attempt', check.indicators);
  }
  if (failures.length > 0) {
    logger.warn('Existing install uninstall encountered failures', failures);
  }

  return {
    success: !check.detected,
    platform: process.platform,
    removedPaths,
    failures,
    remainingIndicators: check.indicators,
  };
}
