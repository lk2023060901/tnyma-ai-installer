import { app, utilityProcess } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PORTS } from '../utils/config';
import {
  buildInstallerWebUiUrl,
  getInstallerLiveGatewayHealthUrl,
  getInstallerWebUiHealthUrl,
} from '../utils/installer-web-ui';
import { logger } from '../utils/logger';

type StackManifest = {
  web?: { entry?: string };
  liveGateway?: { entry?: string };
};

const HEALTH_POLL_INTERVAL_MS = 500;
const LIVE_GATEWAY_START_TIMEOUT_MS = 20_000;
const WEB_START_TIMEOUT_MS = 30_000;

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function isHealthy(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2_000);

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function waitForHealthy(url: string, timeoutMs: number, label: string) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isHealthy(url)) {
      return;
    }
    await delay(HEALTH_POLL_INTERVAL_MS);
  }
  throw new Error(`${label} did not become ready within ${timeoutMs}ms`);
}

export class InstallerWebStackManager {
  private liveGatewayChild: Electron.UtilityProcess | null = null;
  private webChild: Electron.UtilityProcess | null = null;
  private ensurePromise: Promise<string> | null = null;

  async ensureRunning(language?: string | null): Promise<string> {
    if (this.ensurePromise) {
      return await this.ensurePromise;
    }

    this.ensurePromise = this.ensureRunningInternal(language).finally(() => {
      this.ensurePromise = null;
    });
    return await this.ensurePromise;
  }

  async stop(): Promise<void> {
    await this.stopChild('web');
    await this.stopChild('live-gateway');
  }

  private async ensureRunningInternal(language?: string | null): Promise<string> {
    const uiUrl = buildInstallerWebUiUrl({ language });

    if (!(await isHealthy(getInstallerLiveGatewayHealthUrl()))) {
      this.startLiveGateway();
      await waitForHealthy(
        getInstallerLiveGatewayHealthUrl(),
        LIVE_GATEWAY_START_TIMEOUT_MS,
        'Tnyma live-gateway',
      );
    }

    if (!(await isHealthy(getInstallerWebUiHealthUrl()))) {
      this.startWeb();
      await waitForHealthy(
        getInstallerWebUiHealthUrl(),
        WEB_START_TIMEOUT_MS,
        'Tnyma web UI',
      );
    }

    return uiUrl;
  }

  private startLiveGateway() {
    if (this.liveGatewayChild) {
      return;
    }
    const { liveGatewayEntry } = this.resolveStackEntries();
    const child = utilityProcess.fork(liveGatewayEntry, [], {
      cwd: this.getStackRoot(),
      env: this.buildBaseEnv({
        LIVE_GATEWAY_HOST: '127.0.0.1',
        LIVE_GATEWAY_PORT: String(PORTS.TNYMA_AI_LIVE_GATEWAY),
      }),
      serviceName: 'Tnyma Live Gateway',
      stdio: 'pipe',
    });

    this.attachChildLogging('live-gateway', child, () => {
      this.liveGatewayChild = null;
    });
    this.liveGatewayChild = child;
  }

  private startWeb() {
    if (this.webChild) {
      return;
    }
    const { webEntry, webRoot } = this.resolveStackEntries();
    const child = utilityProcess.fork(webEntry, [], {
      cwd: webRoot,
      env: this.buildBaseEnv({
        HOSTNAME: '127.0.0.1',
        PORT: String(PORTS.TNYMA_AI_WEB),
        NODE_ENV: 'production',
        NEXT_TELEMETRY_DISABLED: '1',
        NEXT_PUBLIC_LIVE_GATEWAY_HTTP_URL: `http://127.0.0.1:${PORTS.TNYMA_AI_LIVE_GATEWAY}`,
        NEXT_PUBLIC_LIVE_GATEWAY_URL: `ws://127.0.0.1:${PORTS.TNYMA_AI_LIVE_GATEWAY}/ws`,
      }),
      serviceName: 'Tnyma Web UI',
      stdio: 'pipe',
    });

    this.attachChildLogging('web', child, () => {
      this.webChild = null;
    });
    this.webChild = child;
  }

  private attachChildLogging(
    label: string,
    child: Electron.UtilityProcess,
    onExit: () => void,
  ) {
    child.stdout?.on('data', (data) => {
      const text = data.toString().trim();
      if (text) {
        logger.info(`[tnyma-stack:${label}] ${text}`);
      }
    });

    child.stderr?.on('data', (data) => {
      const text = data.toString().trim();
      if (text) {
        logger.warn(`[tnyma-stack:${label}] ${text}`);
      }
    });

    child.on('exit', (code) => {
      logger.info(`[tnyma-stack:${label}] exited with code=${code}`);
      onExit();
    });

    child.on('error', (error) => {
      logger.error(`[tnyma-stack:${label}] process error`, error);
    });
  }

  private async stopChild(label: 'web' | 'live-gateway'): Promise<void> {
    const child = label === 'web' ? this.webChild : this.liveGatewayChild;
    if (!child) {
      return;
    }

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        resolve();
      };

      child.once('exit', () => finish());
      try {
        child.kill();
      } catch {
        finish();
        return;
      }

      setTimeout(() => finish(), 5_000).unref?.();
    });

    if (label === 'web') {
      this.webChild = null;
    } else {
      this.liveGatewayChild = null;
    }
  }

  private buildBaseEnv(extraEnv: Record<string, string>): NodeJS.ProcessEnv {
    const homeDir = app.getPath('home');
    const openClawHome = join(homeDir, '.openclaw');

    return {
      ...process.env,
      OPENCLAW_CONFIG: join(openClawHome, 'openclaw.json'),
      OPENCLAW_GATEWAY_URL: `ws://127.0.0.1:${PORTS.OPENCLAW_GATEWAY}`,
      OPENCLAW_ALLOW_INSECURE_PRIVATE_WS: '1',
      BRIDGE_OPENCLAW_STATE_DIR: join(openClawHome, 'tnyma-bridge'),
      ...extraEnv,
    };
  }

  private resolveStackEntries() {
    const stackRoot = this.getStackRoot();
    const manifestPath = join(stackRoot, 'manifest.json');
    let manifest: StackManifest = {};

    if (existsSync(manifestPath)) {
      try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as StackManifest;
      } catch (error) {
        logger.warn('Failed to parse bundled Tnyma stack manifest:', error);
      }
    }

    const webEntry = join(stackRoot, manifest.web?.entry || 'web/server.js');
    const liveGatewayEntry = join(stackRoot, manifest.liveGateway?.entry || 'live-gateway/server.mjs');
    const webRoot = join(stackRoot, 'web');

    if (!existsSync(webEntry)) {
      throw new Error(`Bundled Tnyma web entry is missing: ${webEntry}`);
    }
    if (!existsSync(liveGatewayEntry)) {
      throw new Error(`Bundled Tnyma live-gateway entry is missing: ${liveGatewayEntry}`);
    }

    return { webEntry, liveGatewayEntry, webRoot };
  }

  private getStackRoot() {
    return app.isPackaged
      ? join(process.resourcesPath, 'tnyma-web-stack')
      : join(__dirname, '../../build/tnyma-web-stack');
  }
}
