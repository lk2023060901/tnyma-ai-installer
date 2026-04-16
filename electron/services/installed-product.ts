import { exec } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import net from 'node:net';
import { PORTS } from '../utils/config';
import { logger } from '../utils/logger';

const execAsync = promisify(exec);
const POSIX_INSTALL_ROOTS = ['/opt/TnymaAI', '/opt/OpenClaw'];
const POSIX_SYMLINKS = ['/usr/local/bin/tnyma-ai', '/usr/local/bin/openclaw'];
const WINDOWS_PROCESS_IMAGES = ['TnymaAI.exe', 'OpenClaw.exe'];
const POSIX_PROCESS_NAMES = ['TnymaAI', 'OpenClaw', 'tnyma-ai', 'openclaw-gateway'];

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

  await rm(path, {
    force: true,
    recursive: true,
    maxRetries: 3,
    retryDelay: 300,
  });
  return true;
}

export async function detectInstalledProducts(): Promise<InstalledProductCheckResult> {
  const indicators = getExistingPathIndicators(
    excludeCurrentInstallMarkerPaths(getInstalledProductCandidatePaths()),
  );
  if (await isGatewayPortOccupied()) {
    indicators.push({ kind: 'port', value: `127.0.0.1:${PORTS.OPENCLAW_GATEWAY}` });
  }

  return {
    success: true,
    detected: indicators.length > 0,
    platform: process.platform,
    indicators,
  };
}

export async function uninstallInstalledProducts(): Promise<InstalledProductUninstallResult> {
  const candidatePaths = excludeCurrentInstallMarkerPaths(getInstalledProductCandidatePaths());
  const removedPaths: string[] = [];
  const failures: string[] = [];

  logger.info('Attempting to remove existing OpenClaw-compatible installation markers');

  await stopKnownProcesses();
  await stopListeningProcesses(PORTS.OPENCLAW_GATEWAY);

  for (const path of candidatePaths) {
    try {
      const removed = await removePathIfPresent(path);
      if (removed) {
        removedPaths.push(path);
      }
    } catch (error) {
      failures.push(`Failed to remove ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const remaining = await detectInstalledProducts();
  if (remaining.detected) {
    logger.warn('Existing install markers still present after uninstall attempt', remaining.indicators);
  }
  if (failures.length > 0) {
    logger.warn('Existing install uninstall encountered failures', failures);
  }

  return {
    success: !remaining.detected,
    platform: process.platform,
    removedPaths,
    failures,
    remainingIndicators: remaining.indicators,
  };
}
