import { app, utilityProcess } from 'electron';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';
import { getOpenClawDir, getOpenClawEntryPath } from './paths';
import { logger } from './logger';
import { getUvMirrorEnv } from './uv-env';
import { unloadLaunchctlGatewayService } from '../gateway/supervisor';

const execFileAsync = promisify(execFile);
const OPENCLAW_GATEWAY_INSTALL_TIMEOUT_MS = 120_000;
const LAUNCHD_LABEL = 'ai.openclaw.gateway';

export interface OpenClawGatewayServiceInstallResult {
  success: boolean;
  skipped?: boolean;
  alreadyInstalled?: boolean;
  loaded?: boolean;
  forceRefresh?: boolean;
  command: string;
  cwd: string;
  plistPath?: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  error?: string;
}

function getBundledBinPath(): string {
  const target = `${process.platform}-${process.arch}`;
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bin')
    : path.join(process.cwd(), 'resources', 'bin', target);
}

function getGatewayLaunchAgentPlistPath(): string {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);
}

function getGatewayLaunchctlTarget(uid: number): string {
  return `gui/${uid}/${LAUNCHD_LABEL}`;
}

async function isLaunchctlGatewayLoaded(uid: number): Promise<boolean> {
  try {
    await execFileAsync('launchctl', ['print', getGatewayLaunchctlTarget(uid)], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

async function ensureLaunchctlGatewayLoaded(plistPath: string): Promise<boolean> {
  const uid = process.getuid?.();
  if (uid === undefined) {
    throw new Error('launchctl bootstrap is unavailable because the current uid is unknown');
  }

  const target = getGatewayLaunchctlTarget(uid);
  const loadedBefore = await isLaunchctlGatewayLoaded(uid);

  if (!loadedBefore) {
    try {
      await execFileAsync('launchctl', ['bootstrap', `gui/${uid}`, plistPath], { timeout: 15_000 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/already bootstrapped|service already loaded/i.test(message)) {
        throw error;
      }
    }
  }

  try {
    await execFileAsync('launchctl', ['kickstart', '-k', target], { timeout: 15_000 });
  } catch (error) {
    logger.warn(`launchctl kickstart failed for ${target}:`, error);
  }

  return await isLaunchctlGatewayLoaded(uid);
}

async function runGatewayInstallCommand(): Promise<{
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: string;
}> {
  const openclawDir = getOpenClawDir();
  const entryScript = getOpenClawEntryPath();

  if (!existsSync(entryScript)) {
    return {
      success: false,
      stdout: '',
      stderr: '',
      exitCode: null,
      error: `OpenClaw entry script not found at ${entryScript}`,
    };
  }

  const binPath = getBundledBinPath();
  const finalPath = existsSync(binPath)
    ? `${binPath}${path.delimiter}${process.env.PATH || ''}`
    : (process.env.PATH || '');
  const uvEnv = await getUvMirrorEnv();

  return await new Promise((resolve) => {
    const child = utilityProcess.fork(entryScript, ['gateway', 'install'], {
      cwd: openclawDir,
      stdio: 'pipe',
      env: {
        ...process.env,
        ...uvEnv,
        PATH: finalPath,
        OPENCLAW_NO_RESPAWN: '1',
      } as NodeJS.ProcessEnv,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (result: {
      success: boolean;
      stdout: string;
      stderr: string;
      exitCode: number | null;
      error?: string;
    }) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const timeout = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      finish({
        success: false,
        stdout,
        stderr,
        exitCode: null,
        error: `Timed out after ${OPENCLAW_GATEWAY_INSTALL_TIMEOUT_MS}ms`,
      });
    }, OPENCLAW_GATEWAY_INSTALL_TIMEOUT_MS);

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      finish({
        success: false,
        stdout,
        stderr,
        exitCode: null,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    child.on('exit', (code) => {
      clearTimeout(timeout);
      finish({
        success: code === 0,
        stdout,
        stderr,
        exitCode: code,
      });
    });
  });
}

export async function ensureOpenClawGatewayServiceInstalled(
  forceRefresh = false,
): Promise<OpenClawGatewayServiceInstallResult> {
  const startedAt = Date.now();
  const command = 'openclaw gateway install';
  const cwd = getOpenClawDir();

  if (process.platform !== 'darwin') {
    return {
      success: true,
      skipped: true,
      forceRefresh,
      command,
      cwd,
      stdout: '',
      stderr: '',
      exitCode: 0,
      durationMs: Date.now() - startedAt,
    };
  }

  const uid = process.getuid?.();
  const plistPath = getGatewayLaunchAgentPlistPath();
  const loadedBefore = uid !== undefined ? await isLaunchctlGatewayLoaded(uid) : false;
  const plistExistsBefore = existsSync(plistPath);

  if (!forceRefresh && loadedBefore && plistExistsBefore) {
    return {
      success: true,
      alreadyInstalled: true,
      loaded: true,
      forceRefresh,
      command,
      cwd,
      plistPath,
      stdout: '',
      stderr: '',
      exitCode: 0,
      durationMs: Date.now() - startedAt,
    };
  }

  if (forceRefresh && (loadedBefore || plistExistsBefore)) {
    await unloadLaunchctlGatewayService();
  }

  logger.info(
    `Ensuring OpenClaw gateway LaunchAgent is installed (forceRefresh=${forceRefresh ? 'yes' : 'no'})`,
  );
  const installResult = await runGatewayInstallCommand();
  if (!installResult.success) {
    return {
      success: false,
      forceRefresh,
      command,
      cwd,
      plistPath,
      stdout: installResult.stdout,
      stderr: installResult.stderr,
      exitCode: installResult.exitCode,
      durationMs: Date.now() - startedAt,
      error: installResult.error || installResult.stderr || installResult.stdout || 'openclaw gateway install failed',
    };
  }

  if (!existsSync(plistPath)) {
    return {
      success: false,
      forceRefresh,
      command,
      cwd,
      plistPath,
      stdout: installResult.stdout,
      stderr: installResult.stderr,
      exitCode: installResult.exitCode,
      durationMs: Date.now() - startedAt,
      error: `Gateway LaunchAgent plist was not created at ${plistPath}`,
    };
  }

  try {
    const loaded = await ensureLaunchctlGatewayLoaded(plistPath);
    return {
      success: loaded,
      forceRefresh,
      loaded,
      command,
      cwd,
      plistPath,
      stdout: installResult.stdout,
      stderr: installResult.stderr,
      exitCode: installResult.exitCode,
      durationMs: Date.now() - startedAt,
      error: loaded ? undefined : `launchctl did not report ${LAUNCHD_LABEL} as loaded`,
    };
  } catch (error) {
    return {
      success: false,
      forceRefresh,
      command,
      cwd,
      plistPath,
      stdout: installResult.stdout,
      stderr: installResult.stderr,
      exitCode: installResult.exitCode,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
