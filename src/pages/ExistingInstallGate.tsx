import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { TitleBar } from '@/components/layout/TitleBar';
import { hostApiFetch } from '@/lib/host-api';
import { invokeIpc } from '@/lib/api-client';
import { useSettingsStore } from '@/stores/settings';

type ExistingInstallIndicator = {
  kind: 'path' | 'port';
  value: string;
};

type ExistingInstallCheckResponse = {
  success: true;
  detected: boolean;
  platform: string;
  indicators: ExistingInstallIndicator[];
};

type ExistingInstallUninstallResponse = {
  success: boolean;
  platform: string;
  removedPaths: string[];
  failures: string[];
  remainingIndicators: ExistingInstallIndicator[];
};

type ExistingInstallGateState = 'checking' | 'detected' | 'uninstalling' | 'error';

const EXISTING_INSTALL_WINDOW_LAYOUTS: Record<
  ExistingInstallGateState,
  { width: number; height: number; resizable: boolean }
> = {
  checking: { width: 460, height: 200, resizable: false },
  detected: { width: 620, height: 230, resizable: false },
  uninstalling: { width: 760, height: 340, resizable: false },
  error: { width: 760, height: 390, resizable: false },
};

const DRAG_REGION_STYLE = { ['WebkitAppRegion' as const]: 'drag' } as Record<string, string>;
const NO_DRAG_REGION_STYLE = { ['WebkitAppRegion' as const]: 'no-drag' } as Record<string, string>;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatExistingInstallIndicator(
  t: (key: string, options?: Record<string, unknown>) => string,
  indicator: ExistingInstallIndicator,
): string {
  return indicator.kind === 'port'
    ? t('existingInstall.indicatorPort', { value: indicator.value })
    : t('existingInstall.indicatorPath', { value: indicator.value });
}

function GateShell({ children }: { children: React.ReactNode }) {
  const isWindows = window.electron?.platform === 'win32';

  return (
    <div className="h-screen w-screen overflow-hidden bg-card text-foreground">
      {isWindows ? <TitleBar /> : null}
      <div className="h-full w-full">{children}</div>
    </div>
  );
}

export function ExistingInstallGatePage() {
  const { t } = useTranslation('setup');
  const [state, setState] = useState<ExistingInstallGateState>('checking');
  const [indicators, setIndicators] = useState<ExistingInstallIndicator[]>([]);
  const [failures, setFailures] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorSource, setErrorSource] = useState<'check' | 'uninstall'>('check');

  const details = useMemo(
    () => indicators.map((indicator) => formatExistingInstallIndicator(t, indicator)),
    [indicators, t],
  );

  useEffect(() => {
    const layout = EXISTING_INSTALL_WINDOW_LAYOUTS[state];
    void invokeIpc('window:setContentSize', layout).catch(() => {});
  }, [state]);

  const proceedAfterExistingInstallCheck = useCallback(async () => {
    await invokeIpc('app:proceedAfterExistingInstall');
  }, []);

  const proceedAfterSuccessfulUninstall = useCallback(async () => {
    const resetPatch = {
      setupComplete: false,
      gatewayAutoStart: false,
      launchAtStartup: false,
    } as const;

    useSettingsStore.setState(resetPatch);
    await invokeIpc('settings:setMany', resetPatch);
    await invokeIpc('app:proceedToSetup');
  }, []);

  const handleExitInstaller = useCallback(async () => {
    await invokeIpc('app:quit');
  }, []);

  const runExistingInstallCheck = useCallback(async () => {
    setState('checking');
    setErrorMessage(null);
    setFailures([]);

    try {
      const result = await hostApiFetch<ExistingInstallCheckResponse>('/api/app/installed-products');
      setIndicators(result.indicators);
      if (result.detected) {
        setState('detected');
        return;
      }

      await proceedAfterExistingInstallCheck();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorSource('check');
      setErrorMessage(message);
      setState('error');
    }
  }, [proceedAfterExistingInstallCheck]);

  const startExistingInstallUninstall = useCallback(async () => {
    setState('uninstalling');
    setErrorMessage(null);
    setFailures([]);
    setProgress(8);

    const progressTimer = setInterval(() => {
      setProgress((current) => (current >= 92 ? current : current + 6));
    }, 350);

    try {
      const result = await hostApiFetch<ExistingInstallUninstallResponse>(
        '/api/app/installed-products/uninstall',
        { method: 'POST' },
      );

      clearInterval(progressTimer);
      setFailures(result.failures);

      if (!result.success) {
        setIndicators(result.remainingIndicators);
        setErrorSource('uninstall');
        setErrorMessage(result.failures[0] || t('existingInstall.uninstallFailedDescription'));
        setState('error');
        return;
      }

      setProgress(100);
      await delay(450);
      setIndicators([]);
      await proceedAfterSuccessfulUninstall();
    } catch (error) {
      clearInterval(progressTimer);
      const message = error instanceof Error ? error.message : String(error);
      setErrorSource('uninstall');
      setErrorMessage(message);
      setState('error');
    }
  }, [proceedAfterSuccessfulUninstall, t]);

  const retry = useCallback(async () => {
    if (errorSource === 'uninstall') {
      await startExistingInstallUninstall();
      return;
    }
    setIndicators([]);
    setFailures([]);
    await runExistingInstallCheck();
  }, [errorSource, runExistingInstallCheck, startExistingInstallUninstall]);

  useEffect(() => {
    void runExistingInstallCheck();
  }, [runExistingInstallCheck]);

  if (state === 'detected') {
    return (
      <GateShell>
        <div
          className="flex h-full w-full flex-col justify-center bg-card px-5 py-4"
          style={DRAG_REGION_STYLE}
        >
          <h2 className="text-lg font-semibold">{t('existingInstall.dialogTitle')}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {t('existingInstall.dialogMessage', {
              details: details.join('；'),
            })}
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => void handleExitInstaller()}
              style={NO_DRAG_REGION_STYLE}
            >
              {t('existingInstall.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void startExistingInstallUninstall()}
              style={NO_DRAG_REGION_STYLE}
            >
              {t('existingInstall.confirm')}
            </Button>
          </div>
        </div>
      </GateShell>
    );
  }

  const isChecking = state === 'checking';
  const isUninstalling = state === 'uninstalling';
  const isError = state === 'error';

  return (
    <GateShell>
      <div
        className="flex h-full w-full flex-col justify-center bg-card px-6 py-5"
        style={DRAG_REGION_STYLE}
      >
        <div className="mb-6 text-center">
          <div className="mb-4 flex justify-center">
            {isError ? (
              <AlertCircle className="h-12 w-12 text-destructive" />
            ) : (
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
            )}
          </div>
          <h1 className="mb-2 text-2xl font-semibold">
            {isChecking && t('existingInstall.checkingTitle')}
            {isUninstalling && t('existingInstall.uninstallingTitle')}
            {isError && t('existingInstall.uninstallFailedTitle')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isChecking && t('existingInstall.checkingDescription')}
            {isUninstalling && t('existingInstall.uninstallingDescription')}
            {isError && t('existingInstall.uninstallFailedDescription')}
          </p>
        </div>

        <div className="space-y-4">
          {details.length > 0 && (
            <div className="rounded-lg border bg-muted/40 p-4">
              <p className="mb-2 text-sm font-medium">{t('existingInstall.detectedItemsTitle')}</p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                {details.map((detail) => (
                  <li key={detail} className="break-all">
                    {detail}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {isUninstalling && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t('existingInstall.progress')}</span>
                <span className="text-primary">{Math.round(progress)}%</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>
          )}

          {isError && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
              <p className="font-medium">{errorMessage || t('existingInstall.uninstallFailedDescription')}</p>
              {failures.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs">
                  {failures.map((failure) => (
                    <li key={failure}>{failure}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {isChecking && (
            <div className="flex items-center justify-center gap-3 rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{t('existingInstall.checkingHint')}</span>
            </div>
          )}

          {isError && (
            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => void handleExitInstaller()}
                style={NO_DRAG_REGION_STYLE}
              >
                {t('existingInstall.exit')}
              </Button>
              <Button
                onClick={() => void retry()}
                style={NO_DRAG_REGION_STYLE}
              >
                {t('existingInstall.retry')}
              </Button>
            </div>
          )}
        </div>
      </div>
    </GateShell>
  );
}

export default ExistingInstallGatePage;
