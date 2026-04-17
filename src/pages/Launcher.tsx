import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { TitleBar } from '@/components/layout/TitleBar';
import appIcon from '@/assets/logo.svg';
import { invokeIpc } from '@/lib/api-client';
import { useGatewayStore } from '@/stores/gateway';
import { useSettingsStore } from '@/stores/settings';
import { waitForGatewayReady } from '@/lib/gateway-ready';
import { hostApiFetch } from '@/lib/host-api';

const CONTROL_UI_POLL_RETRIES = 5;
const CONTROL_UI_POLL_INTERVAL_MS = 1000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchControlUiUrl(): Promise<string> {
  const result = await hostApiFetch<{
    success: boolean;
    url?: string;
    error?: string;
  }>('/api/app/control-ui');

  if (!result.success || !result.url) {
    throw new Error(result.error || 'Installer web UI is unavailable');
  }

  return result.url;
}

async function waitForControlUiUrl(retries = CONTROL_UI_POLL_RETRIES): Promise<string> {
  await waitForGatewayReady({ startIfNeeded: false });
  let lastError: unknown = null;

  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      return await fetchControlUiUrl();
    } catch (error) {
      lastError = error;
      if (attempt < retries - 1) {
        await delay(CONTROL_UI_POLL_INTERVAL_MS);
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Installer web UI did not become ready in time');
}

async function ensureGatewayRunning(): Promise<void> {
  await useGatewayStore.getState().init();
  const currentStatus = useGatewayStore.getState().status.state;

  if (currentStatus === 'error') {
    await useGatewayStore.getState().restart();
    return;
  }

  if (currentStatus === 'stopped') {
    await useGatewayStore.getState().start();
  }
}

type GatewayServiceInstallResponse = {
  success: boolean;
  skipped?: boolean;
  alreadyInstalled?: boolean;
  loaded?: boolean;
  error?: string;
};

async function ensureGatewayServiceInstalled(forceRefresh = false): Promise<void> {
  const result = await hostApiFetch<GatewayServiceInstallResponse>('/api/app/gateway-service/install', {
    method: 'POST',
    body: JSON.stringify({ forceRefresh }),
  });

  if (!result.success) {
    throw new Error(result.error || 'Failed to install OpenClaw gateway LaunchAgent');
  }
}

function ensureGatewayServiceInstalledInBackground(forceRefresh = false): void {
  void ensureGatewayServiceInstalled(forceRefresh).catch((error) => {
    console.warn('Failed to install OpenClaw gateway LaunchAgent in background:', error);
  });
}

async function prepareGatewayControlUi(): Promise<string> {
  await persistBackgroundGatewayStartupSettings();
  ensureGatewayServiceInstalledInBackground(false);
  await ensureGatewayRunning();
  return await waitForControlUiUrl();
}

const BACKGROUND_GATEWAY_STARTUP_SETTINGS = {
  gatewayAutoStart: true,
  launchAtStartup: true,
} as const;

async function persistBackgroundGatewayStartupSettings(): Promise<void> {
  useSettingsStore.setState(BACKGROUND_GATEWAY_STARTUP_SETTINGS);
  await invokeIpc('settings:setMany', BACKGROUND_GATEWAY_STARTUP_SETTINGS);
}

export function LauncherPage() {
  const { t } = useTranslation('setup');
  const [openingControlUi, setOpeningControlUi] = useState(false);

  const openControlUi = useCallback(async () => {
    if (openingControlUi) {
      return;
    }

    setOpeningControlUi(true);
    try {
      const controlUiUrl = await prepareGatewayControlUi();
      await invokeIpc('shell:openExternal', controlUiUrl);
      await invokeIpc('window:close');
    } finally {
      setOpeningControlUi(false);
    }
  }, [openingControlUi]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <TitleBar />
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="w-full max-w-md rounded-2xl border bg-card p-10 text-center shadow-sm">
          <div className="mb-4 flex justify-center">
            <img src={appIcon} alt="TnymaAI" className="h-16 w-16" />
          </div>
          <h1 className="mb-3 text-3xl font-bold">{t('launcher.title')}</h1>
          <p className="mb-8 text-muted-foreground">{t('launcher.subtitle')}</p>
          <Button
            size="lg"
            className="w-full"
            onClick={() => {
              void openControlUi().catch((error) => {
                toast.error(String(error));
              });
            }}
            disabled={openingControlUi}
          >
            {openingControlUi ? t('launcher.opening') : t('nav.getStarted')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default LauncherPage;
