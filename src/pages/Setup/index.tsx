import {
  forwardRef,
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  useImperativeHandle,
} from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertCircle,
  Eye,
  EyeOff,
  RefreshCw,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Copy,
} from 'lucide-react';
import { TitleBar } from '@/components/layout/TitleBar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useGatewayStore } from '@/stores/gateway';
import { useSettingsStore } from '@/stores/settings';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { SUPPORTED_LANGUAGES } from '@/i18n';
import { toast } from 'sonner';
import { invokeIpc } from '@/lib/api-client';
import { hostApiFetch } from '@/lib/host-api';
import { subscribeHostEvent } from '@/lib/host-events';
import { waitForGatewayReady } from '@/lib/gateway-ready';
interface SetupStep {
  id: string;
  title: string;
  description: string;
}

const STEP = {
  WELCOME: 0,
  RUNTIME: 1,
  PROVIDER: 2,
  MODEL: 3,
  CHANNEL: 4,
  INSTALLING: 5,
  COMPLETE: 6,
} as const;

const getSteps = (t: TFunction): SetupStep[] => [
  {
    id: 'welcome',
    title: t('steps.welcome.title'),
    description: t('steps.welcome.description'),
  },
  {
    id: 'runtime',
    title: t('steps.runtime.title'),
    description: t('steps.runtime.description'),
  },
  {
    id: 'provider',
    title: t('steps.provider.title'),
    description: t('steps.provider.description'),
  },
  {
    id: 'model',
    title: t('steps.model.title'),
    description: t('steps.model.description'),
  },
  {
    id: 'channel',
    title: t('steps.channel.title'),
    description: t('steps.channel.description'),
  },
  {
    id: 'installing',
    title: t('steps.installing.title'),
    description: t('steps.installing.description'),
  },
  {
    id: 'complete',
    title: t('steps.complete.title'),
    description: t('steps.complete.description'),
  },
];

// Default skills to auto-install (no additional API keys required)
interface DefaultSkill {
  id: string;
  name: string;
  description: string;
}

const getDefaultSkills = (t: TFunction): DefaultSkill[] => [
  { id: 'opencode', name: t('defaultSkills.opencode.name'), description: t('defaultSkills.opencode.description') },
  { id: 'python-env', name: t('defaultSkills.python-env.name'), description: t('defaultSkills.python-env.description') },
  { id: 'code-assist', name: t('defaultSkills.code-assist.name'), description: t('defaultSkills.code-assist.description') },
  { id: 'file-tools', name: t('defaultSkills.file-tools.name'), description: t('defaultSkills.file-tools.description') },
  { id: 'terminal', name: t('defaultSkills.terminal.name'), description: t('defaultSkills.terminal.description') },
];

import {
  SETUP_PROVIDERS,
  type ProviderAccount,
  type ProviderType,
  type ProviderTypeInfo,
  getProviderDocsUrl,
  getProviderIconUrl,
  resolveProviderApiKeyForSave,
  shouldInvertInDark,
  shouldShowProviderModelId,
} from '@/lib/providers';
import {
  buildProviderAccountId,
  fetchProviderSnapshot,
  hasConfiguredCredentials,
  pickPreferredAccount,
} from '@/lib/provider-accounts';
import {
  ensureGatewayReadyForProviderModels,
  fetchProviderModels,
  getStoredProviderModels,
  type ProviderModelCatalogEntry,
} from '@/lib/provider-models';
import {
  fetchProviderAuthChoiceGroups,
  flattenSupportedProviderChoices,
  getSupportedProviderChoiceDisplayLabel,
  resolveProviderChoiceFromAccount,
  resolveProviderOAuthStartPayload,
  type SupportedProviderChoice,
} from '@/lib/provider-auth-choices';
import { CHANNEL_META, CHANNEL_NAMES, type ChannelType } from '@/types/channel';
import appIcon from '@/assets/logo.svg';
import feishuIcon from '@/assets/channels/feishu.svg';
import qqIcon from '@/assets/channels/qq.svg';

// Use the shared provider registry for setup providers
const providers = SETUP_PROVIDERS;
const CONTROL_UI_POLL_RETRIES = 5;
const CONTROL_UI_POLL_INTERVAL_MS = 1000;
type SetupManagedChannelType = Extract<ChannelType, 'feishu' | 'qqbot'>;
type SetupChannelMode = 'auto' | 'manual';
type AutoSetupProgressStatus = 'pending' | 'running' | 'completed' | 'error';
type AutoSetupProgressPayload = {
  status: Exclude<AutoSetupProgressStatus, 'pending'>;
  stepId: string;
};
type AutoSetupProgressEntry = {
  error?: string;
  status: AutoSetupProgressStatus;
  stepId: string;
};

const SETUP_MANAGED_CHANNELS: Array<{
  type: SetupManagedChannelType;
  iconSrc: string;
  iconClassName?: string;
  hintKey: string;
}> = [
  {
    type: 'feishu',
    iconSrc: feishuIcon,
    iconClassName: 'dark:invert',
    hintKey: 'channels:dialog.feishuAutoHint',
  },
  {
    type: 'qqbot',
    iconSrc: qqIcon,
    hintKey: 'channels:dialog.qqbotAutoHint',
  },
];
const CHANNEL_AUTO_STEP_ORDER: Record<SetupManagedChannelType, string[]> = {
  feishu: ['waiting_for_scan', 'creating_bot', 'saving_credentials', 'configuring_bot', 'publishing_bot'],
  qqbot: ['waiting_for_scan', 'creating_bot', 'saving_credentials', 'updating_profile'],
};
const setupChannelInputClasses = 'bg-background border-input';

interface SetupStepHandle {
  submit: () => Promise<boolean>;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchControlUiUrl(): Promise<string> {
  const result = await hostApiFetch<{
    success: boolean;
    url?: string;
    error?: string;
  }>('/api/gateway/control-ui');

  if (!result.success || !result.url) {
    throw new Error(result.error || 'OpenClaw Control UI is unavailable');
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
    : new Error('OpenClaw Control UI did not become ready in time');
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

function getProtocolBaseUrlPlaceholder(
  apiProtocol: ProviderAccount['apiProtocol'],
): string {
  if (apiProtocol === 'anthropic-messages') {
    return 'https://api.example.com/anthropic';
  }
  return 'https://api.example.com/v1';
}

// NOTE: Full channel management lives in Settings > Channels page
// NOTE: Skill bundles moved to Settings > Skills page - auto-install essential skills during setup

export function Setup() {
  const { t } = useTranslation(['setup', 'channels']);
  const setupComplete = useSettingsStore((state) => state.setupComplete);
  const markSetupComplete = useSettingsStore((state) => state.markSetupComplete);
  const setGatewayAutoStart = useSettingsStore((state) => state.setGatewayAutoStart);
  const [currentStep, setCurrentStep] = useState<number>(
    setupComplete ? STEP.COMPLETE : STEP.WELCOME,
  );

  // Setup state
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [providerStepReady, setProviderStepReady] = useState(false);
  const [modelStepReady, setModelStepReady] = useState(false);
  const [channelStepBusy, setChannelStepBusy] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [stepSubmitting, setStepSubmitting] = useState(false);
  // Installation state for the Installing step
  const [installedSkills, setInstalledSkills] = useState<string[]>([]);
  // Runtime check status
  const [runtimeChecksPassed, setRuntimeChecksPassed] = useState(false);
  const providerStepRef = useRef<SetupStepHandle | null>(null);
  const modelStepRef = useRef<SetupStepHandle | null>(null);

  const steps = getSteps(t);
  const safeStepIndex = Number.isInteger(currentStep)
    ? Math.min(Math.max(currentStep, STEP.WELCOME), steps.length - 1)
    : STEP.WELCOME;
  const step = steps[safeStepIndex] ?? steps[STEP.WELCOME];
  const isFirstStep = safeStepIndex === STEP.WELCOME;
  const isLastStep = safeStepIndex === steps.length - 1;

  // Derive canProceed based on current step - computed directly to avoid useEffect
  const canProceed = useMemo(() => {
    switch (safeStepIndex) {
      case STEP.WELCOME:
        return true;
      case STEP.RUNTIME:
        return runtimeChecksPassed;
      case STEP.PROVIDER:
        return providerStepReady && !stepSubmitting;
      case STEP.MODEL:
        return modelStepReady && !stepSubmitting;
      case STEP.CHANNEL:
        return !stepSubmitting && !channelStepBusy;
      case STEP.INSTALLING:
        return false; // Cannot manually proceed, auto-proceeds when done
      case STEP.COMPLETE:
        return true;
      default:
        return true;
    }
  }, [channelStepBusy, modelStepReady, providerStepReady, runtimeChecksPassed, safeStepIndex, stepSubmitting]);

  useEffect(() => {
    if (setupComplete) {
      setCurrentStep(STEP.COMPLETE);
    }
  }, [setupComplete]);

  const openControlUi = useCallback(async () => {
    setGatewayAutoStart(true);
    await ensureGatewayRunning();
    const controlUiUrl = await waitForControlUiUrl();
    await invokeIpc('shell:openExternal', controlUiUrl);
  }, [setGatewayAutoStart]);

  const handleNext = async () => {
    if (isLastStep) {
      markSetupComplete();
      try {
        await openControlUi();
        toast.success(t('complete.title'));
      } catch (error) {
        toast.error(String(error));
      }
      return;
    }

    if (safeStepIndex === STEP.PROVIDER) {
      if (!providerStepRef.current) {
        return;
      }
      setStepSubmitting(true);
      try {
        const success = await providerStepRef.current.submit();
        if (success) {
          setCurrentStep((i) => i + 1);
        }
      } finally {
        setStepSubmitting(false);
      }
      return;
    }

    if (safeStepIndex === STEP.MODEL) {
      if (!modelStepRef.current) {
        return;
      }
      setStepSubmitting(true);
      try {
        const success = await modelStepRef.current.submit();
        if (success) {
          setCurrentStep((i) => i + 1);
        }
      } finally {
        setStepSubmitting(false);
      }
      return;
    }

    setCurrentStep((i) => i + 1);
  };

  const handleBack = () => {
    setCurrentStep((i) => Math.max(i - 1, 0));
  };

  const handleSkip = () => {
    setGatewayAutoStart(true);
    markSetupComplete();
    setCurrentStep(STEP.COMPLETE);
  };

  const handleChannelConfigured = useCallback(() => {
    setCurrentStep((stepIndex) => (
      stepIndex === STEP.CHANNEL ? stepIndex + 1 : stepIndex
    ));
  }, []);

  // Auto-proceed when installation is complete
  const handleInstallationComplete = useCallback((skills: string[]) => {
    setInstalledSkills(skills);
    // Auto-proceed to next step after a short delay
    setTimeout(() => {
      setCurrentStep((i) => i + 1);
    }, 1000);
  }, []);


  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <TitleBar />
      <div className="flex-1 overflow-auto">
        {/* Progress Indicator */}
        <div className="flex justify-center pt-8">
          <div className="flex items-center gap-2">
            {steps.map((s, i) => (
              <div key={s.id} className="flex items-center">
                <div
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full border-2 transition-colors',
                    i < safeStepIndex
                      ? 'border-primary bg-primary text-primary-foreground'
                      : i === safeStepIndex
                        ? 'border-primary text-primary'
                        : 'border-slate-600 text-slate-600'
                  )}
                >
                  {i < safeStepIndex ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <span className="text-sm">{i + 1}</span>
                  )}
                </div>
                {i < steps.length - 1 && (
                  <div
                    className={cn(
                      'h-0.5 w-8 transition-colors',
                      i < safeStepIndex ? 'bg-primary' : 'bg-slate-600'
                    )}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Step Content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={step.id}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="mx-auto max-w-2xl p-8"
          >
            <div className="text-center mb-8">
              <h1 className="text-3xl font-bold mb-2">{t(`steps.${step.id}.title`)}</h1>
              <p className="text-slate-400">{t(`steps.${step.id}.description`)}</p>
            </div>

            {/* Step-specific content */}
            <div className="rounded-xl bg-card text-card-foreground border shadow-sm p-8 mb-8">
              {safeStepIndex === STEP.WELCOME && <WelcomeContent />}
              {safeStepIndex === STEP.RUNTIME && <RuntimeContent onStatusChange={setRuntimeChecksPassed} />}
              {safeStepIndex === STEP.PROVIDER && (
                <ProviderContent
                  ref={providerStepRef}
                  providers={providers}
                  selectedProvider={selectedProvider}
                  onSelectProvider={setSelectedProvider}
                  apiKey={apiKey}
                  onApiKeyChange={setApiKey}
                  onCanProceedChange={setProviderStepReady}
                />
              )}
              {safeStepIndex === STEP.MODEL && (
                <ModelContent
                  ref={modelStepRef}
                  providers={providers}
                  selectedProvider={selectedProvider}
                  onCanProceedChange={setModelStepReady}
                />
              )}
              {safeStepIndex === STEP.CHANNEL && (
                <ChannelContent
                  onBusyChange={setChannelStepBusy}
                  onComplete={handleChannelConfigured}
                />
              )}
              {safeStepIndex === STEP.INSTALLING && (
                <InstallingContent
                  skills={getDefaultSkills(t)}
                  onComplete={handleInstallationComplete}
                  onSkip={() => setCurrentStep((i) => i + 1)}
                />
              )}
              {safeStepIndex === STEP.COMPLETE && (
                <CompleteContent
                  selectedProvider={selectedProvider}
                  installedSkills={installedSkills}
                />
              )}
            </div>

            {/* Navigation - hidden during installation step */}
            {safeStepIndex !== STEP.INSTALLING && (
              <div className="flex justify-between">
                <div>
                  {!isFirstStep && (
                    <Button variant="ghost" onClick={handleBack} disabled={stepSubmitting || channelStepBusy}>
                      <ChevronLeft className="h-4 w-4 mr-2" />
                      {t('nav.back')}
                    </Button>
                  )}
                </div>
                <div className="flex gap-2">
                  {!isLastStep && safeStepIndex !== STEP.RUNTIME && (
                    <Button variant="ghost" onClick={handleSkip} disabled={stepSubmitting || channelStepBusy}>
                      {t('nav.skipSetup')}
                    </Button>
                  )}
                  <Button onClick={handleNext} disabled={!canProceed || stepSubmitting || channelStepBusy}>
                    {isLastStep ? (
                      t('nav.getStarted')
                    ) : stepSubmitting ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        {t('nav.next')}
                      </>
                    ) : (
                      <>
                        {t('nav.next')}
                        <ChevronRight className="h-4 w-4 ml-2" />
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ==================== Step Content Components ====================

function WelcomeContent() {
  const { t } = useTranslation(['setup', 'settings']);
  const { language, setLanguage } = useSettingsStore();

  return (
    <div className="text-center space-y-4">
      <div className="mb-4 flex justify-center">
        <img src={appIcon} alt="TnymaAI" className="h-16 w-16" />
      </div>
      <h2 className="text-xl font-semibold">{t('welcome.title')}</h2>
      <p className="text-muted-foreground">
        {t('welcome.description')}
      </p>

      {/* Language Selector */}
      <div className="flex justify-center gap-2 py-2">
        {SUPPORTED_LANGUAGES.map((lang) => (
          <Button
            key={lang.code}
            variant={language === lang.code ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setLanguage(lang.code)}
            className="h-7 text-xs"
          >
            {lang.label}
          </Button>
        ))}
      </div>

      <ul className="text-left space-y-2 text-muted-foreground pt-2">
        <li className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-green-400" />
          {t('welcome.features.noCommand')}
        </li>
        <li className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-green-400" />
          {t('welcome.features.modernUI')}
        </li>
        <li className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-green-400" />
          {t('welcome.features.bundles')}
        </li>
        <li className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-green-400" />
          {t('welcome.features.crossPlatform')}
        </li>
      </ul>
    </div>
  );
}

interface RuntimeContentProps {
  onStatusChange: (canProceed: boolean) => void;
}

function RuntimeContent({ onStatusChange }: RuntimeContentProps) {
  const { t } = useTranslation('setup');
  const gatewayStatus = useGatewayStore((state) => state.status);
  const startGateway = useGatewayStore((state) => state.start);

  const [checks, setChecks] = useState({
    nodejs: { status: 'checking' as 'checking' | 'success' | 'error', message: '' },
    openclaw: { status: 'checking' as 'checking' | 'success' | 'error', message: '' },
    gateway: { status: 'checking' as 'checking' | 'success' | 'error', message: '' },
  });
  const [showLogs, setShowLogs] = useState(false);
  const [logContent, setLogContent] = useState('');
  const [openclawDir, setOpenclawDir] = useState('');
  const gatewayTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const runChecks = useCallback(async () => {
    let openclawReady = false;

    // Reset checks
    setChecks({
      nodejs: { status: 'checking', message: '' },
      openclaw: { status: 'checking', message: '' },
      gateway: { status: 'checking', message: '' },
    });

    // Check Node.js — always available in Electron
    setChecks((prev) => ({
      ...prev,
      nodejs: { status: 'success', message: t('runtime.status.success') },
    }));

    // Check OpenClaw package status
    try {
      const openclawStatus = await invokeIpc('openclaw:status') as {
        packageExists: boolean;
        isBuilt: boolean;
        dir: string;
        version?: string;
      };

      setOpenclawDir(openclawStatus.dir);

      if (!openclawStatus.packageExists) {
        setChecks((prev) => ({
          ...prev,
          openclaw: {
            status: 'error',
            message: `OpenClaw package not found at: ${openclawStatus.dir}`
          },
        }));
      } else if (!openclawStatus.isBuilt) {
        setChecks((prev) => ({
          ...prev,
          openclaw: {
            status: 'error',
            message: 'OpenClaw package found but dist is missing'
          },
        }));
      } else {
        openclawReady = true;
        const versionLabel = openclawStatus.version ? ` v${openclawStatus.version}` : '';
        setChecks((prev) => ({
          ...prev,
          openclaw: {
            status: 'success',
            message: `OpenClaw package ready${versionLabel}`
          },
        }));
      }
    } catch (error) {
      setChecks((prev) => ({
        ...prev,
        openclaw: { status: 'error', message: `Check failed: ${error}` },
      }));
    }

    // Check Gateway — read directly from store to avoid stale closure
    // Don't immediately report error; gateway may still be initializing
    const currentGateway = useGatewayStore.getState().status;
    if (currentGateway.state === 'running') {
      setChecks((prev) => ({
        ...prev,
        gateway: { status: 'success', message: `Running on port ${currentGateway.port}` },
      }));
    } else if (currentGateway.state === 'error') {
      setChecks((prev) => ({
        ...prev,
        gateway: { status: 'error', message: currentGateway.error || t('runtime.status.error') },
      }));
    } else if (currentGateway.state === 'stopped' && openclawReady) {
      setChecks((prev) => ({
        ...prev,
        gateway: { status: 'checking', message: 'Starting...' },
      }));
      try {
        await startGateway();
      } catch (error) {
        setChecks((prev) => ({
          ...prev,
          gateway: { status: 'error', message: String(error) },
        }));
      }
    } else {
      setChecks((prev) => ({
        ...prev,
        gateway: {
          status: 'checking',
          message: currentGateway.state === 'starting' ? t('runtime.status.checking') : 'Waiting for gateway...'
        },
      }));
    }
  }, [startGateway, t]);

  useEffect(() => {
    runChecks();
  }, [runChecks]);

  // Update canProceed when gateway status changes
  useEffect(() => {
    const allPassed = checks.nodejs.status === 'success'
      && checks.openclaw.status === 'success'
      && (checks.gateway.status === 'success' || gatewayStatus.state === 'running');
    onStatusChange(allPassed);
  }, [checks, gatewayStatus, onStatusChange]);

  // Update gateway check when gateway status changes
  useEffect(() => {
    if (gatewayStatus.state === 'running') {
      setChecks((prev) => ({
        ...prev,
        gateway: { status: 'success', message: t('runtime.status.gatewayRunning', { port: gatewayStatus.port }) },
      }));
    } else if (gatewayStatus.state === 'error') {
      setChecks((prev) => ({
        ...prev,
        gateway: { status: 'error', message: gatewayStatus.error || 'Failed to start' },
      }));
    } else if (gatewayStatus.state === 'starting' || gatewayStatus.state === 'reconnecting') {
      setChecks((prev) => ({
        ...prev,
        gateway: { status: 'checking', message: 'Starting...' },
      }));
    }
    // 'stopped' state: keep current check status (likely 'checking') to allow startup time
  }, [gatewayStatus, t]);

  // Gateway startup timeout — show error only after giving enough time to initialize
  useEffect(() => {
    if (gatewayTimeoutRef.current) {
      clearTimeout(gatewayTimeoutRef.current);
      gatewayTimeoutRef.current = null;
    }

    // If gateway is already in a terminal state, no timeout needed
    if (gatewayStatus.state === 'running' || gatewayStatus.state === 'error') {
      return;
    }

    // Set timeout for non-terminal states (stopped, starting, reconnecting)
    gatewayTimeoutRef.current = setTimeout(() => {
      setChecks((prev) => {
        if (prev.gateway.status === 'checking') {
          return {
            ...prev,
            gateway: { status: 'error', message: 'Gateway startup timed out' },
          };
        }
        return prev;
      });
    }, 600 * 1000); // 600 seconds — enough for gateway to fully initialize

    return () => {
      if (gatewayTimeoutRef.current) {
        clearTimeout(gatewayTimeoutRef.current);
        gatewayTimeoutRef.current = null;
      }
    };
  }, [gatewayStatus.state]);

  const handleStartGateway = async () => {
    setChecks((prev) => ({
      ...prev,
      gateway: { status: 'checking', message: 'Starting...' },
    }));
    await startGateway();
  };

  const handleShowLogs = async () => {
    try {
      const logs = await hostApiFetch<{ content: string }>('/api/logs?tailLines=100');
      setLogContent(logs.content);
      setShowLogs(true);
    } catch {
      setLogContent('(Failed to load logs)');
      setShowLogs(true);
    }
  };

  const handleOpenLogDir = async () => {
    try {
      const { dir: logDir } = await hostApiFetch<{ dir: string | null }>('/api/logs/dir');
      if (logDir) {
        await invokeIpc('shell:showItemInFolder', logDir);
      }
    } catch {
      // ignore
    }
  };

  const ERROR_TRUNCATE_LEN = 30;

  const renderStatus = (status: 'checking' | 'success' | 'error', message: string) => {
    if (status === 'checking') {
      return (
        <span className="flex items-center gap-2 text-yellow-400 whitespace-nowrap">
          <Loader2 className="h-5 w-5 flex-shrink-0 animate-spin" />
          {message || 'Checking...'}
        </span>
      );
    }
    if (status === 'success') {
      return (
        <span className="flex items-center gap-2 text-green-400 whitespace-nowrap">
          <CheckCircle2 className="h-5 w-5 flex-shrink-0" />
          {message}
        </span>
      );
    }

    const isLong = message.length > ERROR_TRUNCATE_LEN;
    const displayMsg = isLong ? message.slice(0, ERROR_TRUNCATE_LEN) : message;

    return (
      <span className="flex items-center gap-2 text-red-400 whitespace-nowrap">
        <XCircle className="h-5 w-5 flex-shrink-0" />
        <span>{displayMsg}</span>
        {isLong && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-pointer text-red-300 hover:text-red-200 font-medium">...</span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-sm whitespace-normal break-words text-xs">
              {message}
            </TooltipContent>
          </Tooltip>
        )}
      </span>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">{t('runtime.title')}</h2>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={handleShowLogs}>
            {t('runtime.viewLogs')}
          </Button>
          <Button variant="ghost" size="sm" onClick={runChecks}>
            <RefreshCw className="h-4 w-4 mr-2" />
            {t('runtime.recheck')}
          </Button>
        </div>
      </div>
      <div className="space-y-3">
        <div className="grid grid-cols-[1fr_auto] items-center gap-4 p-3 rounded-lg bg-muted/50">
          <span className="text-left">{t('runtime.nodejs')}</span>
          <div className="flex justify-end">
            {renderStatus(checks.nodejs.status, checks.nodejs.message)}
          </div>
        </div>
        <div className="grid grid-cols-[1fr_auto] items-center gap-4 p-3 rounded-lg bg-muted/50">
          <div className="text-left min-w-0">
            <span>{t('runtime.openclaw')}</span>
            {openclawDir && (
              <p className="text-xs text-muted-foreground mt-0.5 font-mono break-all">
                {openclawDir}
              </p>
            )}
          </div>
          <div className="flex justify-end self-start mt-0.5">
            {renderStatus(checks.openclaw.status, checks.openclaw.message)}
          </div>
        </div>
        <div className="grid grid-cols-[1fr_auto] items-center gap-4 p-3 rounded-lg bg-muted/50">
          <div className="flex items-center gap-2 text-left">
            <span>{t('runtime.gateway')}</span>
            {checks.gateway.status === 'error' && (
              <Button variant="outline" size="sm" onClick={handleStartGateway}>
                {t('runtime.startGateway')}
              </Button>
            )}
          </div>
          <div className="flex justify-end">
            {renderStatus(checks.gateway.status, checks.gateway.message)}
          </div>
        </div>
      </div>

      {(checks.nodejs.status === 'error' || checks.openclaw.status === 'error') && (
        <div className="mt-4 p-4 rounded-lg bg-red-900/20 border border-red-500/20">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-5 w-5 text-red-400 mt-0.5" />
            <div>
              <p className="font-medium text-red-400">{t('runtime.issue.title')}</p>
              <p className="text-sm text-muted-foreground mt-1">
                {t('runtime.issue.desc')}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Log viewer panel */}
      {showLogs && (
        <div className="mt-4 p-4 rounded-lg bg-black/40 border border-border">
          <div className="flex items-center justify-between mb-2">
            <p className="font-medium text-foreground text-sm">{t('runtime.logs.title')}</p>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleOpenLogDir}>
                <ExternalLink className="h-3 w-3 mr-1" />
                {t('runtime.logs.openFolder')}
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowLogs(false)}>
                {t('runtime.logs.close')}
              </Button>
            </div>
          </div>
          <pre className="text-xs text-slate-300 bg-black/50 p-3 rounded max-h-60 overflow-auto whitespace-pre-wrap font-mono">
            {logContent || t('runtime.logs.noLogs')}
          </pre>
        </div>
      )}
    </div>
  );
}

interface ProviderContentProps {
  providers: ProviderTypeInfo[];
  selectedProvider: string | null;
  onSelectProvider: (id: string | null) => void;
  apiKey: string;
  onApiKeyChange: (key: string) => void;
  onCanProceedChange: (canProceed: boolean) => void;
}

const ProviderContent = forwardRef<SetupStepHandle, ProviderContentProps>(function ProviderContent({
  providers,
  selectedProvider,
  onSelectProvider,
  apiKey,
  onApiKeyChange,
  onCanProceedChange,
}: ProviderContentProps, ref) {
  const { t, i18n } = useTranslation(['setup', 'settings']);
  const [showKey, setShowKey] = useState(false);
  const [keyValid, setKeyValid] = useState<boolean | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [activeAccount, setActiveAccount] = useState<ProviderAccount | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [modelId, setModelId] = useState('');
  const [apiProtocol, setApiProtocol] = useState<ProviderAccount['apiProtocol']>('openai-completions');
  const [providerMenuOpen, setProviderMenuOpen] = useState(false);
  const providerMenuRef = useRef<HTMLDivElement | null>(null);
  const [supportedChoices, setSupportedChoices] = useState<SupportedProviderChoice[]>([]);
  const [choicesLoading, setChoicesLoading] = useState(false);
  const [selectedChoiceId, setSelectedChoiceId] = useState<string | null>(null);
  const [arkMode, setArkMode] = useState<'apikey' | 'codeplan'>('apikey');

  // OAuth Flow State
  const [oauthFlowing, setOauthFlowing] = useState(false);
  const [oauthData, setOauthData] = useState<{
    mode: 'device';
    verificationUri: string;
    userCode: string;
    expiresIn: number;
  } | {
    mode: 'manual';
    authorizationUrl: string;
    message?: string;
  } | null>(null);
  const [manualCodeInput, setManualCodeInput] = useState('');
  const [oauthError, setOauthError] = useState<string | null>(null);
  const pendingOAuthRef = useRef<{ accountId: string; label: string } | null>(null);
  const selectedChoiceRef = useRef<SupportedProviderChoice | null>(null);

  const selectedChoice = useMemo(
    () => supportedChoices.find((choice) => choice.id === selectedChoiceId) ?? null,
    [selectedChoiceId, supportedChoices],
  );
  const selectedProviderData = providers.find(
    (provider) => provider.id === (selectedChoice?.vendorId ?? selectedProvider),
  );
  const providerDocsUrl = getProviderDocsUrl(selectedProviderData, i18n.language);
  const effectiveProviderDocsUrl = selectedProvider === 'ark' && arkMode === 'codeplan'
    ? (selectedProviderData?.codePlanDocsUrl || providerDocsUrl)
    : providerDocsUrl;
  const selectedProviderIconUrl = selectedProviderData
    ? getProviderIconUrl(selectedProviderData.id)
    : undefined;
  const showBaseUrlField = selectedProviderData?.showBaseUrl ?? false;
  const codePlanPreset = selectedProviderData?.codePlanPresetBaseUrl && selectedProviderData?.codePlanPresetModelId
    ? {
      baseUrl: selectedProviderData.codePlanPresetBaseUrl,
      modelId: selectedProviderData.codePlanPresetModelId,
    }
    : null;
  const useOAuthFlow = selectedChoice?.authMode === 'oauth_browser'
    || selectedChoice?.authMode === 'oauth_device';
  const requiresApiKey = selectedChoice?.authMode === 'api_key'
    && (selectedProviderData?.requiresApiKey ?? true);
  const resolvedApiProtocol = selectedChoice?.apiProtocol
    || ((selectedProviderData?.id === 'custom' || selectedProviderData?.id === 'ollama')
      ? apiProtocol
      : undefined);
  const effectiveModelId = (() => {
    const trimmedModelId = modelId.trim();
    if (trimmedModelId) {
      return trimmedModelId;
    }
    return selectedChoice?.defaultModelId || selectedProviderData?.defaultModelId || undefined;
  })();
  const oauthConfigured = useMemo(() => {
    if (!useOAuthFlow || !selectedChoice || !activeAccount || !selectedAccountId) {
      return false;
    }
    return resolveProviderChoiceFromAccount(activeAccount) === selectedChoice.id;
  }, [activeAccount, selectedAccountId, selectedChoice, useOAuthFlow]);
  const canProceed = useMemo(() => {
    if (!selectedChoice) {
      return false;
    }
    if (useOAuthFlow) {
      return oauthConfigured;
    }
    return requiresApiKey ? apiKey.trim().length > 0 : true;
  }, [apiKey, oauthConfigured, requiresApiKey, selectedChoice, useOAuthFlow]);

  useEffect(() => {
    selectedChoiceRef.current = selectedChoice;
  }, [selectedChoice]);

  useEffect(() => {
    onCanProceedChange(canProceed);
  }, [canProceed, onCanProceedChange]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setChoicesLoading(true);
      try {
        const groups = await fetchProviderAuthChoiceGroups();
        const choices = flattenSupportedProviderChoices(groups);
        if (!cancelled) {
          setSupportedChoices(choices);
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load provider auth choices:', error);
          toast.error(String(error));
          setSupportedChoices([]);
        }
      } finally {
        if (!cancelled) {
          setChoicesLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Manage OAuth events
  useEffect(() => {
    const handleCode = (data: unknown) => {
      const payload = data as Record<string, unknown>;
      if (payload?.mode === 'manual') {
        setOauthData({
          mode: 'manual',
          authorizationUrl: String(payload.authorizationUrl || ''),
          message: typeof payload.message === 'string' ? payload.message : undefined,
        });
      } else {
        setOauthData({
          mode: 'device',
          verificationUri: String(payload.verificationUri || ''),
          userCode: String(payload.userCode || ''),
          expiresIn: Number(payload.expiresIn || 300),
        });
      }
      setOauthError(null);
    };

    const handleSuccess = async (data: unknown) => {
      setOauthFlowing(false);
      setOauthData(null);
      setManualCodeInput('');
      setKeyValid(true);

      const payload = (data as { accountId?: string } | undefined) || undefined;
      const accountId = payload?.accountId || pendingOAuthRef.current?.accountId;
      const latestChoice = selectedChoiceRef.current;

      if (accountId) {
        try {
          const existingAccount = await hostApiFetch<ProviderAccount | null>(
            `/api/provider-accounts/${encodeURIComponent(accountId)}`,
          );
          if (latestChoice) {
            const updates: Partial<ProviderAccount> = {
              metadata: {
                ...(existingAccount?.metadata ?? {}),
                authChoiceId: latestChoice.id,
                ...(latestChoice.modelProviderKey
                  ? { modelProviderKey: latestChoice.modelProviderKey }
                  : {}),
              },
            };
          if (latestChoice.apiProtocol && !existingAccount?.apiProtocol) {
            updates.apiProtocol = latestChoice.apiProtocol;
          }
          if (latestChoice.headers && !existingAccount?.headers) {
            updates.headers = latestChoice.headers;
          }
          if (latestChoice.defaultBaseUrl && !existingAccount?.baseUrl) {
            updates.baseUrl = latestChoice.defaultBaseUrl;
          }
          await hostApiFetch(`/api/provider-accounts/${encodeURIComponent(accountId)}`, {
            method: 'PUT',
            body: JSON.stringify({ updates }),
          });
        }
          await hostApiFetch('/api/provider-accounts/default', {
            method: 'PUT',
            body: JSON.stringify({ accountId }),
        });
        setSelectedAccountId(accountId);
        setActiveAccount(await hostApiFetch<ProviderAccount | null>(
          `/api/provider-accounts/${encodeURIComponent(accountId)}`,
        ));
      } catch (error) {
        console.error('Failed to set default provider account:', error);
      }
    }

      pendingOAuthRef.current = null;
    if (latestChoice) {
      setSelectedChoiceId(latestChoice.id);
      onSelectProvider(latestChoice.vendorId);
    }
    toast.success(t('provider.valid'));
  };

    const handleError = (data: unknown) => {
      setOauthError((data as { message: string }).message);
      setOauthData(null);
      pendingOAuthRef.current = null;
    };

    const offCode = subscribeHostEvent('oauth:code', handleCode);
    const offSuccess = subscribeHostEvent('oauth:success', handleSuccess);
    const offError = subscribeHostEvent('oauth:error', handleError);

    return () => {
      offCode();
      offSuccess();
      offError();
    };
  }, [onSelectProvider, t]);

  const handleStartOAuth = async () => {
    if (!selectedChoice) return;

    const oauthPayload = resolveProviderOAuthStartPayload(selectedChoice);
    if (!oauthPayload) {
      toast.error(t('provider.invalid'));
      return;
    }

    try {
      const snapshot = await fetchProviderSnapshot();
      const existingVendorIds = new Set(snapshot.accounts.map((account) => account.vendorId));
      if (selectedChoice.vendorId === 'minimax-portal' && existingVendorIds.has('minimax-portal-cn')) {
        toast.error(t('settings:aiProviders.toast.minimaxConflict'));
        return;
      }
      if (selectedChoice.vendorId === 'minimax-portal-cn' && existingVendorIds.has('minimax-portal')) {
        toast.error(t('settings:aiProviders.toast.minimaxConflict'));
        return;
      }
    } catch {
      // ignore check failure
    }

    setOauthFlowing(true);
    setOauthData(null);
    setManualCodeInput('');
    setOauthError(null);

    try {
      const snapshot = await fetchProviderSnapshot();
      const accountId = buildProviderAccountId(
        selectedChoice.vendorId,
        selectedAccountId,
        snapshot.vendors,
      );
      const label = getSupportedProviderChoiceDisplayLabel(selectedChoice);
      pendingOAuthRef.current = { accountId, label };
      await hostApiFetch('/api/providers/oauth/start', {
        method: 'POST',
        body: JSON.stringify({
          provider: oauthPayload.provider,
          region: oauthPayload.region,
          accountId,
          label,
        }),
      });
    } catch (e) {
      setOauthError(String(e));
      setOauthFlowing(false);
      pendingOAuthRef.current = null;
    }
  };

  const handleCancelOAuth = async () => {
    setOauthFlowing(false);
    setOauthData(null);
    setManualCodeInput('');
    setOauthError(null);
    pendingOAuthRef.current = null;
    await hostApiFetch('/api/providers/oauth/cancel', { method: 'POST' });
  };

  const handleSubmitManualOAuthCode = async () => {
    const value = manualCodeInput.trim();
    if (!value) return;
    try {
      await hostApiFetch('/api/providers/oauth/submit', {
        method: 'POST',
        body: JSON.stringify({ code: value }),
      });
      setOauthError(null);
    } catch (error) {
      setOauthError(String(error));
    }
  };

  // On mount, try to restore previously configured provider
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snapshot = await fetchProviderSnapshot();
        const statusMap = new Map(snapshot.statuses.map((status) => [status.id, status]));
        const setupProviderTypes = new Set<string>(providers.map((p) => p.id));
        const setupCandidates = snapshot.accounts.filter((account) => setupProviderTypes.has(account.vendorId));
        const preferred =
          (snapshot.defaultAccountId
            && setupCandidates.find((account) => account.id === snapshot.defaultAccountId))
          || setupCandidates.find((account) => hasConfiguredCredentials(account, statusMap.get(account.id)))
          || setupCandidates[0];
        if (preferred && !cancelled) {
          const restoredChoiceId = resolveProviderChoiceFromAccount(preferred);
          onSelectProvider(preferred.vendorId);
          setSelectedAccountId(preferred.id);
          setActiveAccount(preferred);
          setSelectedChoiceId(restoredChoiceId);
        const typeInfo = providers.find((p) => p.id === preferred.vendorId);
        const restoredChoice = supportedChoices.find((choice) => choice.id === restoredChoiceId) ?? null;
        const storedKey = (await hostApiFetch<{ apiKey: string | null }>(
          `/api/providers/${encodeURIComponent(preferred.id)}/api-key`,
        )).apiKey;
        onApiKeyChange(storedKey || '');
        setBaseUrl(preferred.baseUrl || restoredChoice?.defaultBaseUrl || typeInfo?.defaultBaseUrl || '');
        setModelId(preferred.model || restoredChoice?.defaultModelId || typeInfo?.defaultModelId || '');
        setApiProtocol(preferred.apiProtocol || restoredChoice?.apiProtocol || 'openai-completions');
      } else if (!cancelled) {
        setSelectedChoiceId(null);
        onSelectProvider(null);
        setSelectedAccountId(null);
        onApiKeyChange('');
        setActiveAccount(null);
      }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load provider list:', error);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [onApiKeyChange, onSelectProvider, providers, supportedChoices]);

  // When provider changes, load stored key + reset base URL
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!selectedChoice) {
        setSelectedAccountId(null);
        setActiveAccount(null);
        return;
      }
      setApiProtocol('openai-completions');
      try {
        const snapshot = await fetchProviderSnapshot();
        const statusMap = new Map(snapshot.statuses.map((status) => [status.id, status]));
        const preferredAccount = pickPreferredAccount(
          snapshot.accounts,
          snapshot.defaultAccountId,
          selectedChoice.vendorId,
          statusMap,
        );
        const accountIdForLoad = preferredAccount?.id || selectedChoice.vendorId;
        const preferredChoiceId = preferredAccount
          ? resolveProviderChoiceFromAccount(preferredAccount)
          : null;
        const sameChoiceAccount = preferredChoiceId === selectedChoice.id;
        setSelectedAccountId(preferredAccount?.id || null);
        setActiveAccount(preferredAccount ?? null);

        const storedKey = (await hostApiFetch<{ apiKey: string | null }>(
          `/api/providers/${encodeURIComponent(accountIdForLoad)}/api-key`,
      )).apiKey;
      if (!cancelled) {
        onApiKeyChange(sameChoiceAccount ? (storedKey || '') : '');

        const info = providers.find((p) => p.id === selectedChoice.vendorId);
        const nextBaseUrl = sameChoiceAccount
            ? (preferredAccount?.baseUrl || selectedChoice.defaultBaseUrl || info?.defaultBaseUrl || '')
            : (selectedChoice.defaultBaseUrl || info?.defaultBaseUrl || '');
          const nextModelId = sameChoiceAccount
            ? (preferredAccount?.model || selectedChoice.defaultModelId || info?.defaultModelId || '')
            : (selectedChoice.defaultModelId || info?.defaultModelId || '');
          setBaseUrl(nextBaseUrl);
          setModelId(nextModelId);
          setApiProtocol(
            (sameChoiceAccount ? preferredAccount?.apiProtocol : undefined)
            || selectedChoice.apiProtocol
            || 'openai-completions',
          );
          if (
            selectedChoice.vendorId === 'ark'
            && info?.codePlanPresetBaseUrl
            && info?.codePlanPresetModelId
            && nextBaseUrl.trim() === info.codePlanPresetBaseUrl
            && nextModelId.trim() === info.codePlanPresetModelId
          ) {
            setArkMode('codeplan');
          } else {
            setArkMode('apikey');
          }
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load provider key:', error);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [onApiKeyChange, providers, selectedChoice]);

  useEffect(() => {
    if (!providerMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (providerMenuRef.current && !providerMenuRef.current.contains(event.target as Node)) {
        setProviderMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setProviderMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [providerMenuOpen]);

  const handleValidateAndSave = useCallback(async (): Promise<boolean> => {
    if (!selectedChoice) {
      return false;
    }

    if (useOAuthFlow) {
      if (oauthConfigured) {
        setKeyValid(true);
        return true;
      }
      toast.error(t('provider.completeLoginFirst'));
      return false;
    }

    try {
      const snapshot = await fetchProviderSnapshot();
      const existingVendorIds = new Set(snapshot.accounts.map((account) => account.vendorId));
      if (selectedChoice.vendorId === 'minimax-portal' && existingVendorIds.has('minimax-portal-cn')) {
        toast.error(t('settings:aiProviders.toast.minimaxConflict'));
        return false;
      }
      if (selectedChoice.vendorId === 'minimax-portal-cn' && existingVendorIds.has('minimax-portal')) {
        toast.error(t('settings:aiProviders.toast.minimaxConflict'));
        return false;
      }
    } catch {
      // ignore check failure
    }

    setKeyValid(null);

    try {
      if (requiresApiKey && !apiKey.trim()) {
        toast.error(t('provider.invalid'));
        return false;
      }

      if (requiresApiKey && apiKey.trim() && !selectedChoice.skipValidation) {
        const result = await invokeIpc(
          'provider:validateKey',
          selectedAccountId || selectedChoice.vendorId,
          apiKey,
          {
            baseUrl: baseUrl.trim() || undefined,
            apiProtocol: resolvedApiProtocol,
          }
        ) as { valid: boolean; error?: string };

        setKeyValid(result.valid);

        if (!result.valid) {
          toast.error(result.error || t('provider.invalid'));
          return false;
        }
      } else {
        setKeyValid(true);
      }

      const snapshot = await fetchProviderSnapshot();
      const accountIdForSave = buildProviderAccountId(
        selectedChoice.vendorId,
        selectedAccountId,
        snapshot.vendors,
      );

      const effectiveApiKey = resolveProviderApiKeyForSave(selectedChoice.vendorId, apiKey);
      const accountPayload: ProviderAccount = {
        id: accountIdForSave,
        vendorId: selectedChoice.vendorId as ProviderType,
        label: getSupportedProviderChoiceDisplayLabel(selectedChoice),
        authMode: selectedChoice.authMode,
        baseUrl: baseUrl.trim() || selectedChoice.defaultBaseUrl || undefined,
        apiProtocol: resolvedApiProtocol,
        headers: selectedChoice.headers,
        model: selectedChoice.vendorId === 'ark' && arkMode === 'codeplan'
          ? effectiveModelId
          : activeAccount?.model,
        enabled: true,
        isDefault: false,
        metadata: {
          ...(activeAccount?.metadata ?? {}),
          authChoiceId: selectedChoice.id,
          ...(selectedChoice.modelProviderKey
            ? { modelProviderKey: selectedChoice.modelProviderKey }
            : {}),
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const saveResult = selectedAccountId
        ? await hostApiFetch<{ success: boolean; error?: string }>(
          `/api/provider-accounts/${encodeURIComponent(accountIdForSave)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              updates: {
                label: accountPayload.label,
                authMode: accountPayload.authMode,
                baseUrl: accountPayload.baseUrl,
                apiProtocol: accountPayload.apiProtocol,
                headers: accountPayload.headers,
                model: accountPayload.model,
                enabled: accountPayload.enabled,
                metadata: accountPayload.metadata,
              },
              apiKey: effectiveApiKey,
            }),
          },
        )
        : await hostApiFetch<{ success: boolean; error?: string }>('/api/provider-accounts', {
          method: 'POST',
          body: JSON.stringify({ account: accountPayload, apiKey: effectiveApiKey }),
        });

      if (!saveResult.success) {
        throw new Error(saveResult.error || 'Failed to save provider config');
      }

      const defaultResult = await hostApiFetch<{ success: boolean; error?: string }>(
        '/api/provider-accounts/default',
        {
          method: 'PUT',
          body: JSON.stringify({ accountId: accountIdForSave }),
        },
      );

      if (!defaultResult.success) {
        throw new Error(defaultResult.error || 'Failed to set default provider');
      }

      setSelectedAccountId(accountIdForSave);
      setActiveAccount({
        ...(activeAccount ?? accountPayload),
        ...accountPayload,
        id: accountIdForSave,
        updatedAt: new Date().toISOString(),
      });
      toast.success(t('provider.valid'));
      return true;
    } catch (error) {
      setKeyValid(false);
      toast.error('Configuration failed: ' + String(error));
      return false;
    }
  }, [
    activeAccount,
    apiKey,
    arkMode,
    baseUrl,
    effectiveModelId,
    oauthConfigured,
    requiresApiKey,
    resolvedApiProtocol,
    selectedAccountId,
    selectedChoice,
    t,
    useOAuthFlow,
  ]);

  useImperativeHandle(ref, () => ({
    submit: handleValidateAndSave,
  }), [handleValidateAndSave]);

  const handleSelectProviderChoice = (choice: SupportedProviderChoice) => {
    const typeInfo = providers.find((provider) => provider.id === choice.vendorId);
    onSelectProvider(choice.vendorId);
    setSelectedChoiceId(choice.id);
    setSelectedAccountId(null);
    setActiveAccount(null);
    onApiKeyChange('');
    setKeyValid(null);
    setShowKey(false);
    setProviderMenuOpen(false);
    setArkMode('apikey');
    setBaseUrl(choice.defaultBaseUrl || typeInfo?.defaultBaseUrl || '');
    setModelId(choice.defaultModelId || typeInfo?.defaultModelId || '');
    setApiProtocol(choice.apiProtocol || 'openai-completions');
    setOauthFlowing(false);
    setOauthData(null);
    setManualCodeInput('');
    setOauthError(null);
  };

  return (
    <div className="space-y-6">
      {/* Provider selector — dropdown */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label>{t('provider.label')}</Label>
          {selectedChoice && effectiveProviderDocsUrl && (
            <a
              href={effectiveProviderDocsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[13px] text-blue-500 hover:text-blue-600 font-medium inline-flex items-center gap-1"
            >
              {t('settings:aiProviders.dialog.customDoc')}
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
        <div className="relative" ref={providerMenuRef}>
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={providerMenuOpen}
            onClick={() => setProviderMenuOpen((open) => !open)}
            className={cn(
              'w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
              'flex items-center justify-between gap-2',
              'focus:outline-none focus:ring-2 focus:ring-ring'
            )}
            disabled={choicesLoading}
          >
            <div className="flex items-center gap-2 min-w-0">
              {selectedChoice && selectedProviderData ? (
                selectedProviderIconUrl ? (
                  <img
                    src={selectedProviderIconUrl}
                    alt={selectedProviderData.name}
                    className={cn('h-4 w-4 shrink-0', shouldInvertInDark(selectedProviderData.id) && 'dark:invert')}
                  />
                ) : (
                  <span className="text-sm leading-none shrink-0">{selectedProviderData.icon}</span>
                )
              ) : (
                <span className="text-xs text-muted-foreground shrink-0">—</span>
              )}
              <span className={cn('truncate text-left', !selectedChoice && 'text-muted-foreground')}>
                {selectedChoice
                  ? getSupportedProviderChoiceDisplayLabel(selectedChoice)
                  : choicesLoading
                    ? 'Loading provider choices...'
                    : t('provider.selectPlaceholder')}
              </span>
            </div>
            <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform', providerMenuOpen && 'rotate-180')} />
          </button>

          {providerMenuOpen && (
            <div
              role="listbox"
              className="absolute z-20 mt-1 w-full rounded-md border border-border bg-popover shadow-md max-h-64 overflow-auto"
            >
              {supportedChoices.map((choice) => {
                const iconUrl = getProviderIconUrl(choice.vendorId);
                const isSelected = selectedChoiceId === choice.id;
                const choiceProvider = providers.find((provider) => provider.id === choice.vendorId);

                return (
                  <button
                    key={choice.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelectProviderChoice(choice)}
                    className={cn(
                      'w-full px-3 py-2 text-left text-sm flex items-center justify-between gap-2',
                      'hover:bg-accent transition-colors',
                      isSelected && 'bg-accent/60'
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {iconUrl ? (
                        <img
                          src={iconUrl}
                          alt={choice.groupLabel}
                          className={cn('h-4 w-4 shrink-0', shouldInvertInDark(choice.vendorId) && 'dark:invert')}
                        />
                      ) : (
                        <span className="text-sm leading-none shrink-0">{choiceProvider?.icon ?? '•'}</span>
                      )}
                      <div className="min-w-0">
                        <p className="truncate">{getSupportedProviderChoiceDisplayLabel(choice)}</p>
                        {choice.hint && (
                          <p className="truncate text-xs text-muted-foreground">{choice.hint}</p>
                        )}
                      </div>
                    </div>
                    {isSelected && <Check className="h-4 w-4 text-primary shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Dynamic config fields based on selected provider */}
      {selectedChoice && (
        <motion.div
          key={selectedChoice.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          {codePlanPreset && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label>{t('provider.codePlanPreset')}</Label>
                {selectedProviderData?.codePlanDocsUrl && (
                  <a
                    href={selectedProviderData.codePlanDocsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[13px] text-blue-500 hover:text-blue-600 font-medium inline-flex items-center gap-1"
                  >
                    {t('provider.codePlanDoc')}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
              <div className="flex gap-2 text-sm">
                <button
                  type="button"
                  onClick={() => {
                    setArkMode('apikey');
                    setBaseUrl(selectedProviderData?.defaultBaseUrl || '');
                    if (modelId.trim() === codePlanPreset.modelId) {
                      setModelId(selectedProviderData?.defaultModelId || '');
                    }
                    setKeyValid(null);
                  }}
                  className={cn(
                    'flex-1 py-2 px-3 rounded-lg border transition-colors',
                    arkMode === 'apikey'
                      ? 'bg-primary/10 border-primary/30 font-medium'
                      : 'border-border bg-muted/40 text-muted-foreground hover:bg-muted'
                  )}
                >
                  {t('settings:aiProviders.authModes.apiKey')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setArkMode('codeplan');
                    setBaseUrl(codePlanPreset.baseUrl);
                    setModelId(codePlanPreset.modelId);
                    setKeyValid(null);
                  }}
                  className={cn(
                    'flex-1 py-2 px-3 rounded-lg border transition-colors',
                    arkMode === 'codeplan'
                      ? 'bg-primary/10 border-primary/30 font-medium'
                      : 'border-border bg-muted/40 text-muted-foreground hover:bg-muted'
                  )}
                >
                  {t('provider.codePlanMode')}
                </button>
              </div>
              {arkMode === 'codeplan' && (
                <p className="text-xs text-muted-foreground">
                  {t('provider.codePlanPresetDesc')}
                </p>
              )}
            </div>
          )}

          {/* Base URL field (for siliconflow, ollama, custom) */}
          {showBaseUrlField && (
            <div className="space-y-2">
              <Label htmlFor="baseUrl">{t('provider.baseUrl')}</Label>
              <Input
                id="baseUrl"
                type="text"
                placeholder={getProtocolBaseUrlPlaceholder(apiProtocol)}
                value={baseUrl}
                onChange={(e) => {
                  setBaseUrl(e.target.value);
                  setKeyValid(null);
                }}
                autoComplete="off"
                className="bg-background border-input"
              />
            </div>
          )}

          {selectedChoice.vendorId === 'custom' && (
            <div className="space-y-2">
              <Label>{t('provider.protocol')}</Label>
              <div className="flex gap-2 text-sm">
                <button
                  type="button"
                  onClick={() => {
                    setApiProtocol('openai-completions');
                    setKeyValid(null);
                  }}
                  className={cn(
                    'flex-1 py-2 px-3 rounded-lg border transition-colors',
                    apiProtocol === 'openai-completions'
                      ? 'bg-primary/10 border-primary/30 font-medium'
                      : 'border-border bg-muted/40 text-muted-foreground hover:bg-muted'
                  )}
                >
                  {t('provider.protocols.openaiCompletions')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setApiProtocol('openai-responses');
                    setKeyValid(null);
                  }}
                  className={cn(
                    'flex-1 py-2 px-3 rounded-lg border transition-colors',
                    apiProtocol === 'openai-responses'
                      ? 'bg-primary/10 border-primary/30 font-medium'
                      : 'border-border bg-muted/40 text-muted-foreground hover:bg-muted'
                  )}
                >
                  {t('provider.protocols.openaiResponses')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setApiProtocol('anthropic-messages');
                    setKeyValid(null);
                  }}
                  className={cn(
                    'flex-1 py-2 px-3 rounded-lg border transition-colors',
                    apiProtocol === 'anthropic-messages'
                      ? 'bg-primary/10 border-primary/30 font-medium'
                      : 'border-border bg-muted/40 text-muted-foreground hover:bg-muted'
                  )}
                >
                  {t('provider.protocols.anthropic')}
                </button>
              </div>
            </div>
          )}

          {/* API Key field (hidden for ollama) */}
          {requiresApiKey && (
            <div className="space-y-2">
              <Label htmlFor="apiKey">{t('provider.apiKey')}</Label>
              <div className="relative">
                <Input
                  id="apiKey"
                  type={showKey ? 'text' : 'password'}
                  placeholder={selectedProviderData?.placeholder}
                  value={apiKey}
                  onChange={(e) => {
                    onApiKeyChange(e.target.value);
                    setKeyValid(null);
                  }}
                  autoComplete="off"
                  className="pr-10 bg-background border-input"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          )}

          {/* Device OAuth Trigger */}
          {useOAuthFlow && (
            <div className="space-y-4 pt-2">
              <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 p-4 text-center">
                <p className="text-sm text-blue-200 mb-3 block">
                  This provider requires signing in via your browser.
                </p>
                <Button
                  onClick={handleStartOAuth}
                  disabled={oauthFlowing}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                >
                  {oauthFlowing ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Waiting...</>
                  ) : (
                    'Login with Browser'
                  )}
                </Button>
              </div>

              {/* OAuth Active State Modal / Inline View */}
              {oauthFlowing && (
                <div className="mt-4 p-4 border rounded-xl bg-card relative overflow-hidden">
                  {/* Background pulse effect */}
                  <div className="absolute inset-0 bg-primary/5 animate-pulse" />

                  <div className="relative z-10 flex flex-col items-center justify-center text-center space-y-4">
                    {oauthError ? (
                      <div className="text-red-400 space-y-2">
                        <XCircle className="h-8 w-8 mx-auto" />
                        <p className="font-medium">Authentication Failed</p>
                        <p className="text-sm opacity-80">{oauthError}</p>
                        <Button variant="outline" size="sm" onClick={handleCancelOAuth} className="mt-2">
                          Try Again
                        </Button>
                      </div>
                    ) : !oauthData ? (
                      <div className="space-y-3 py-4">
                        <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
                        <p className="text-sm text-muted-foreground animate-pulse">Requesting secure login code...</p>
                      </div>
                    ) : oauthData.mode === 'manual' ? (
                      <div className="space-y-4 w-full">
                        <div className="space-y-1">
                          <h3 className="font-medium text-lg">Complete OpenAI Login</h3>
                          <p className="text-sm text-muted-foreground text-left mt-2">
                            {oauthData.message || 'Open the authorization page, complete login, then paste the callback URL or code below.'}
                          </p>
                        </div>

                        <Button
                          variant="secondary"
                          className="w-full"
                          onClick={() => invokeIpc('shell:openExternal', oauthData.authorizationUrl)}
                        >
                          <ExternalLink className="h-4 w-4 mr-2" />
                          Open Authorization Page
                        </Button>

                        <Input
                          placeholder="Paste callback URL or code"
                          value={manualCodeInput}
                          onChange={(e) => setManualCodeInput(e.target.value)}
                        />

                        <Button
                          className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                          onClick={handleSubmitManualOAuthCode}
                          disabled={!manualCodeInput.trim()}
                        >
                          Submit Code
                        </Button>

                        <Button variant="ghost" size="sm" className="w-full mt-2" onClick={handleCancelOAuth}>
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-4 w-full">
                        <div className="space-y-1">
                          <h3 className="font-medium text-lg">Approve Login</h3>
                          <div className="text-sm text-muted-foreground text-left mt-2 space-y-1">
                            <p>1. Copy the authorization code below.</p>
                            <p>2. Open the login page in your browser.</p>
                            <p>3. Paste the code to approve access.</p>
                          </div>
                        </div>

                        <div className="flex items-center justify-center gap-2 p-3 bg-background border rounded-lg">
                          <code className="text-2xl font-mono tracking-widest font-bold text-primary">
                            {oauthData.userCode}
                          </code>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              navigator.clipboard.writeText(oauthData.userCode);
                              toast.success('Code copied to clipboard');
                            }}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                        </div>

                        <Button
                          variant="secondary"
                          className="w-full"
                          onClick={() => invokeIpc('shell:openExternal', oauthData.verificationUri)}
                        >
                          <ExternalLink className="h-4 w-4 mr-2" />
                          Open Login Page
                        </Button>

                        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground pt-2">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          <span>Waiting for approval in browser...</span>
                        </div>

                        <Button variant="ghost" size="sm" className="w-full mt-2" onClick={handleCancelOAuth}>
                          Cancel
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {keyValid !== null && (
            <p className={cn('text-sm text-center', keyValid ? 'text-green-400' : 'text-red-400')}>
              {keyValid ? `✓ ${t('provider.valid')}` : `✗ ${t('provider.invalid')}`}
            </p>
          )}

          <p className="text-sm text-muted-foreground text-center">
            {t('provider.storedLocally')}
          </p>
        </motion.div>
      )}
    </div>
  );
});

interface ModelContentProps {
  providers: ProviderTypeInfo[];
  selectedProvider: string | null;
  onCanProceedChange: (canProceed: boolean) => void;
}

const ModelContent = forwardRef<SetupStepHandle, ModelContentProps>(function ModelContent({
  providers,
  selectedProvider,
  onCanProceedChange,
}: ModelContentProps, ref) {
  const { t } = useTranslation(['setup', 'settings']);
  const devModeUnlocked = useSettingsStore((state) => state.devModeUnlocked);
  const [account, setAccount] = useState<ProviderAccount | null>(null);
  const [modelId, setModelId] = useState('');
  const [availableModels, setAvailableModels] = useState<ProviderModelCatalogEntry[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const providerData = providers.find((provider) => provider.id === (account?.vendorId ?? selectedProvider));
  const hasDiscoveredModels = availableModels.length > 0;
  const showModelIdField = shouldShowProviderModelId(providerData, devModeUnlocked) || hasDiscoveredModels;
  const effectiveModelId = modelId.trim();
  const canProceed = Boolean(account && effectiveModelId);

  useEffect(() => {
    onCanProceedChange(canProceed);
  }, [canProceed, onCanProceedChange]);

  const loadModels = useCallback(async (nextAccount: ProviderAccount) => {
    const nextProvider = providers.find((provider) => provider.id === nextAccount.vendorId);
    const fallbackModels = getStoredProviderModels(nextAccount);

    setModelsLoading(true);
    setLoadError(null);
    try {
      await ensureGatewayReadyForProviderModels();
      const models = await fetchProviderModels(nextAccount.id);
      const refreshedAccount = await hostApiFetch<ProviderAccount | null>(
        `/api/provider-accounts/${encodeURIComponent(nextAccount.id)}`,
      );
      const resolvedAccount = refreshedAccount ?? nextAccount;
      const resolvedModels = models.length > 0 ? models : getStoredProviderModels(resolvedAccount);
      const resolvedModelId = models[0]?.id
        || resolvedAccount.model?.trim()
        || nextProvider?.defaultModelId?.trim()
        || resolvedModels[0]?.id
        || '';

      setAccount(resolvedAccount);
      setAvailableModels(resolvedModels);
      setModelId(resolvedModelId);
    } catch (error) {
      console.error('Failed to load provider models:', error);
      const fallbackModelId = nextAccount.model?.trim()
        || nextProvider?.defaultModelId?.trim()
        || fallbackModels[0]?.id
        || '';
      setAccount(nextAccount);
      setAvailableModels(fallbackModels);
      setModelId(fallbackModelId);
      setLoadError(String(error));
    } finally {
      setModelsLoading(false);
    }
  }, [providers]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snapshot = await fetchProviderSnapshot();
        const statusMap = new Map(snapshot.statuses.map((status) => [status.id, status]));
        const preferredAccount = selectedProvider
          ? pickPreferredAccount(snapshot.accounts, snapshot.defaultAccountId, selectedProvider, statusMap)
          : (snapshot.defaultAccountId
            ? snapshot.accounts.find((candidate) => candidate.id === snapshot.defaultAccountId) ?? null
            : snapshot.accounts[0] ?? null);

        if (!preferredAccount) {
          throw new Error(t('model.noProviderConfigured'));
        }

        if (cancelled) {
          return;
        }

        await loadModels(preferredAccount);
      } catch (error) {
        if (!cancelled) {
          setAccount(null);
          setAvailableModels([]);
          setModelId('');
          setLoadError(String(error));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadModels, selectedProvider, t]);

  const handleSaveModel = useCallback(async (): Promise<boolean> => {
    if (!account) {
      toast.error(t('model.noProviderConfigured'));
      return false;
    }

    if (!effectiveModelId) {
      toast.error(t('model.required'));
      return false;
    }

    setSaving(true);
    try {
      const updates: Partial<ProviderAccount> = {
        model: effectiveModelId,
        metadata: {
          ...(account.metadata ?? {}),
          ...(availableModels.length > 0
            ? { customModels: availableModels.map((model) => model.id) }
            : {}),
        },
      };
      const result = await hostApiFetch<{ success: boolean; error?: string }>(
        `/api/provider-accounts/${encodeURIComponent(account.id)}`,
        {
          method: 'PUT',
          body: JSON.stringify({ updates }),
        },
      );
      if (!result.success) {
        throw new Error(result.error || 'Failed to save model');
      }

      setAccount({
        ...account,
        model: effectiveModelId,
        metadata: updates.metadata ?? account.metadata,
        updatedAt: new Date().toISOString(),
      });
      return true;
    } catch (error) {
      toast.error(t('model.saveFailed', { error: String(error) }));
      return false;
    } finally {
      setSaving(false);
    }
  }, [account, availableModels, effectiveModelId, t]);

  useImperativeHandle(ref, () => ({
    submit: handleSaveModel,
  }), [handleSaveModel]);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="setup-model-id">{t('provider.modelId')}</Label>
          {account && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => void loadModels(account)}
              disabled={modelsLoading || saving}
            >
              {modelsLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              <span className="ml-1">{t('settings:aiProviders.dialog.refreshModels')}</span>
            </Button>
          )}
        </div>
        {showModelIdField && hasDiscoveredModels ? (
          <Select
            id="setup-model-id"
            value={modelId}
            onChange={(event) => setModelId(event.target.value)}
            className="bg-background border-input"
            disabled={modelsLoading || saving}
          >
            <option value="" disabled>{t('settings:aiProviders.dialog.selectModel')}</option>
            {availableModels.map((model) => (
              <option key={model.id} value={model.id}>{model.name || model.id}</option>
            ))}
          </Select>
        ) : (
          <Input
            id="setup-model-id"
            type="text"
            placeholder={providerData?.modelIdPlaceholder || 'e.g. openai/gpt-5.4'}
            value={modelId}
            onChange={(event) => setModelId(event.target.value)}
            autoComplete="off"
            className="bg-background border-input"
            disabled={saving}
          />
        )}
        <p className="text-xs text-muted-foreground">
          {t('provider.modelIdDesc')}
        </p>
      </div>

      {loadError && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-200">
          {t('model.syncFailed', { error: loadError })}
        </div>
      )}
    </div>
  );
});

interface ChannelContentProps {
  onBusyChange: (busy: boolean) => void;
  onComplete: () => void;
}

function ChannelContent({ onBusyChange, onComplete }: ChannelContentProps) {
  const { t } = useTranslation(['setup', 'channels']);
  const [configuredTypes, setConfiguredTypes] = useState<SetupManagedChannelType[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<SetupManagedChannelType | ''>('');
  const [setupMode, setSetupMode] = useState<SetupChannelMode>('auto');
  const [manualConfigValues, setManualConfigValues] = useState<Record<string, string>>({});
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [manualSaving, setManualSaving] = useState(false);
  const [autoFlowState, setAutoFlowState] = useState<'idle' | 'starting' | 'running' | 'success' | 'error'>('idle');
  const [autoError, setAutoError] = useState<string | null>(null);
  const [progressEntries, setProgressEntries] = useState<AutoSetupProgressEntry[]>([]);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [qrDialogOpen, setQrDialogOpen] = useState(false);
  const activeChannelRef = useRef<SetupManagedChannelType | null>(null);
  const completeTimerRef = useRef<number | null>(null);

  const isBusy = manualSaving || autoFlowState === 'starting' || autoFlowState === 'running';
  const selectedChannelMeta = selectedChannel ? CHANNEL_META[selectedChannel] : null;
  const selectedChannelInfo = selectedChannel
    ? SETUP_MANAGED_CHANNELS.find((channel) => channel.type === selectedChannel) ?? null
    : null;
  const isConfigured = selectedChannel ? configuredTypes.includes(selectedChannel) : false;

  useEffect(() => {
    onBusyChange(isBusy);
  }, [isBusy, onBusyChange]);

  const loadConfiguredTypes = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await hostApiFetch<{ success: boolean; channels?: string[] }>('/api/channels/configured');
      const configured = (result.channels ?? []).filter(
        (channelType): channelType is SetupManagedChannelType => (
          channelType === 'feishu' || channelType === 'qqbot'
        ),
      );
      setConfiguredTypes(configured);
    } catch (error) {
      setConfiguredTypes([]);
      setLoadError(String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadChannelConfig = useCallback(async (channelType: SetupManagedChannelType) => {
    try {
      const result = await hostApiFetch<{ success: boolean; values?: Record<string, string> }>(
        `/api/channels/config/${encodeURIComponent(channelType)}`,
      );
      setManualConfigValues(result.success && result.values ? result.values : {});
    } catch {
      setManualConfigValues({});
    }
  }, []);

  const cancelAutoDeploy = useCallback(async (channelType?: SetupManagedChannelType | null) => {
    const targetChannel = channelType ?? activeChannelRef.current;
    if (!targetChannel) {
      return;
    }
    activeChannelRef.current = null;
    try {
      await hostApiFetch(`/api/channels/${encodeURIComponent(targetChannel)}/cancel`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
    } catch {
      // Ignore cancel failures during mode switching/unmount.
    }
  }, []);

  useEffect(() => {
    void loadConfiguredTypes();
  }, [loadConfiguredTypes]);

  useEffect(() => {
    return () => {
      if (completeTimerRef.current) {
        window.clearTimeout(completeTimerRef.current);
      }
      void cancelAutoDeploy();
    };
  }, [cancelAutoDeploy]);

  useEffect(() => {
    if (!selectedChannel) {
      setManualConfigValues({});
      setShowSecrets({});
      setAutoFlowState('idle');
      setAutoError(null);
      setProgressEntries([]);
      setQrCode(null);
      setQrDialogOpen(false);
      return;
    }

    void loadChannelConfig(selectedChannel);
  }, [loadChannelConfig, selectedChannel]);

  const handleOpenDocs = useCallback(async (channelType: SetupManagedChannelType) => {
    const docsUrl = t(CHANNEL_META[channelType].docsUrl);
    try {
      await invokeIpc('shell:openExternal', docsUrl);
    } catch {
      window.open(docsUrl, '_blank', 'noopener,noreferrer');
    }
  }, [t]);

  const getInitialProgressEntries = useCallback((channelType: SetupManagedChannelType): AutoSetupProgressEntry[] => (
    CHANNEL_AUTO_STEP_ORDER[channelType].map((stepId, index) => ({
      stepId,
      status: index === 0 ? 'running' : 'pending',
    }))
  ), []);

  const updateProgressEntries = useCallback((
    channelType: SetupManagedChannelType,
    payload: AutoSetupProgressPayload & { error?: string },
  ) => {
    const stepOrder = CHANNEL_AUTO_STEP_ORDER[channelType];
    setProgressEntries((previous) => {
      const existing = new Map(previous.map((entry) => [entry.stepId, entry]));
      const nextEntries = stepOrder.map((stepId) => existing.get(stepId) ?? {
        stepId,
        status: 'pending' as const,
      });

      if (!stepOrder.includes(payload.stepId)) {
        return nextEntries;
      }

      return nextEntries.map((entry) => (
        entry.stepId === payload.stepId
          ? {
              ...entry,
              status: payload.status,
              ...(payload.error ? { error: payload.error } : {}),
            }
          : entry
      ));
    });
  }, []);

  const beginAutoDeploy = useCallback(async (channelType: SetupManagedChannelType) => {
    await cancelAutoDeploy();
    activeChannelRef.current = channelType;
    setAutoFlowState('starting');
    setAutoError(null);
    setQrCode(null);
    setQrDialogOpen(true);
    setProgressEntries(getInitialProgressEntries(channelType));

    try {
      const response = await hostApiFetch<{ success?: boolean; error?: string }>(
        `/api/channels/${encodeURIComponent(channelType)}/start`,
        {
          method: 'POST',
          body: JSON.stringify({
            appDescription: t(`channels:meta.${channelType}.autoAppDescription`),
          }),
        },
      );

      if (response && response.success === false) {
        throw new Error(response.error || t('channel.auto.startFailed'));
      }

      setAutoFlowState('running');
    } catch (error) {
      activeChannelRef.current = null;
      setAutoFlowState('error');
      setQrDialogOpen(false);
      setAutoError(String(error));
      setProgressEntries((previous) => previous.map((entry, index) => (
        index === 0 && entry.status === 'running'
          ? { ...entry, status: 'error', error: String(error) }
          : entry
      )));
      toast.error(t('channel.auto.startFailed', { error: String(error) }));
    }
  }, [cancelAutoDeploy, getInitialProgressEntries, t]);

  const handleSelectChannel = useCallback(async (value: string) => {
    const nextChannel = (value === 'feishu' || value === 'qqbot')
      ? value
      : '';

    if (completeTimerRef.current) {
      window.clearTimeout(completeTimerRef.current);
      completeTimerRef.current = null;
    }

    await cancelAutoDeploy();
    setSelectedChannel(nextChannel);
    setSetupMode('auto');
    setAutoFlowState('idle');
    setAutoError(null);
    setQrCode(null);
    setQrDialogOpen(false);
    setProgressEntries([]);
    setShowSecrets({});

    if (nextChannel) {
      void beginAutoDeploy(nextChannel);
    }
  }, [beginAutoDeploy, cancelAutoDeploy]);

  const handleSwitchMode = useCallback(async (nextMode: SetupChannelMode) => {
    setSetupMode(nextMode);
    setAutoError(null);
    setQrCode(null);
    setQrDialogOpen(false);

    if (completeTimerRef.current) {
      window.clearTimeout(completeTimerRef.current);
      completeTimerRef.current = null;
    }

    if (nextMode === 'manual') {
      setAutoFlowState('idle');
      setProgressEntries([]);
      await cancelAutoDeploy();
      return;
    }

    if (selectedChannel) {
      void beginAutoDeploy(selectedChannel);
    }
  }, [beginAutoDeploy, cancelAutoDeploy, selectedChannel]);

  useEffect(() => {
    if (!selectedChannel) {
      return () => {};
    }

    const channelType = selectedChannel;
    const removeQrListener = subscribeHostEvent<{ qr?: string; raw?: string }>(
      `channel:${channelType}-qr`,
      (payload) => {
        const nextQr = typeof payload.qr === 'string' && payload.qr.trim()
          ? payload.qr.trim()
          : (typeof payload.raw === 'string' ? payload.raw.trim() : '');
        if (!nextQr) {
          return;
        }
        setQrCode(nextQr.startsWith('data:image') ? nextQr : `data:image/png;base64,${nextQr}`);
        setQrDialogOpen(true);
        setAutoFlowState('running');
      },
    );

    const removeProgressListener = subscribeHostEvent<AutoSetupProgressPayload>(
      `channel:${channelType}-progress`,
      (payload) => {
        updateProgressEntries(channelType, payload);
        if (payload.stepId === 'waiting_for_scan' && payload.status === 'completed') {
          setQrDialogOpen(false);
          setQrCode(null);
        }
      },
    );

    const removeSuccessListener = subscribeHostEvent(
      `channel:${channelType}-success`,
      () => {
        activeChannelRef.current = null;
        setAutoFlowState('success');
        setQrDialogOpen(false);
        setQrCode(null);
        setAutoError(null);
        void loadConfiguredTypes();
        toast.success(t('channel.connected', { name: CHANNEL_NAMES[channelType] }));
        if (completeTimerRef.current) {
          window.clearTimeout(completeTimerRef.current);
        }
        completeTimerRef.current = window.setTimeout(() => {
          completeTimerRef.current = null;
          onComplete();
        }, 600);
      },
    );

    const removeErrorListener = subscribeHostEvent<string>(
      `channel:${channelType}-error`,
      (error) => {
        activeChannelRef.current = null;
        setQrDialogOpen(false);
        setQrCode(null);
        setAutoFlowState('error');
        setAutoError(String(error));
        setProgressEntries((previous) => {
          const nextEntries = [...previous];
          const runningIndex = nextEntries.findIndex((entry) => entry.status === 'running');
          if (runningIndex >= 0) {
            nextEntries[runningIndex] = {
              ...nextEntries[runningIndex],
              status: 'error',
              error: String(error),
            };
          }
          return nextEntries;
        });
        toast.error(t('channel.auto.startFailed', { error: String(error) }));
      },
    );

    return () => {
      removeQrListener();
      removeProgressListener();
      removeSuccessListener();
      removeErrorListener();
    };
  }, [loadConfiguredTypes, onComplete, selectedChannel, t, updateProgressEntries]);

  const handleManualFieldChange = useCallback((key: string, value: string) => {
    setManualConfigValues((previous) => ({ ...previous, [key]: value }));
  }, []);

  const handleSaveManual = useCallback(async () => {
    if (!selectedChannel || !selectedChannelMeta) {
      return;
    }

    const missingRequiredField = selectedChannelMeta.configFields.find(
      (field) => field.required && !(manualConfigValues[field.key] || '').trim(),
    );
    if (missingRequiredField) {
      toast.error(t('channel.manual.required'));
      return;
    }

    setManualSaving(true);
    try {
      const result = await hostApiFetch<{ success?: boolean; error?: string; warning?: string }>(
        '/api/channels/config',
        {
          method: 'POST',
          body: JSON.stringify({
            channelType: selectedChannel,
            config: {
              ...manualConfigValues,
              enabled: true,
            },
          }),
        },
      );

      if (!result?.success) {
        throw new Error(result?.error || t('channel.manual.saveFailed'));
      }

      if (result.warning) {
        toast.warning(result.warning);
      }

      await loadConfiguredTypes();
      toast.success(t('channel.connected', { name: CHANNEL_NAMES[selectedChannel] }));
      onComplete();
    } catch (error) {
      toast.error(t('channel.manual.saveFailed', { error: String(error) }));
    } finally {
      setManualSaving(false);
    }
  }, [loadConfiguredTypes, manualConfigValues, onComplete, selectedChannel, selectedChannelMeta, t]);

  const getProgressLabel = useCallback((channelType: SetupManagedChannelType, entry: AutoSetupProgressEntry): string => {
    if (entry.status === 'error') {
      return t('channel.auto.failed', { error: entry.error || '' });
    }

    const key = `channel.auto.steps.${entry.stepId}.${entry.status}`;
    const fallbackKey = `channel.auto.steps.${entry.stepId}.running`;
    return t([key, fallbackKey], { name: CHANNEL_NAMES[channelType] });
  }, [t]);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">{t('channel.subtitle')}</p>
        <p className="text-xs text-muted-foreground/80">{t('steps.channel.description')}</p>
      </div>

      {loadError && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-200">
          {loadError}
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="setup-channel-type">{t('channel.selectLabel')}</Label>
        <Select
          id="setup-channel-type"
          value={selectedChannel}
          onChange={(event) => {
            void handleSelectChannel(event.target.value);
          }}
          className="bg-background border-input"
          disabled={loading || isBusy}
        >
          <option value="">{t('channel.selectPlaceholder')}</option>
          {SETUP_MANAGED_CHANNELS.map((channel) => (
            <option key={channel.type} value={channel.type}>
              {CHANNEL_NAMES[channel.type]}
            </option>
          ))}
        </Select>
      </div>

      {!selectedChannel ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/10 px-5 py-10 text-center text-sm text-muted-foreground">
          {t('channel.selectHint')}
        </div>
      ) : (
        <div className="space-y-4 rounded-2xl border border-border bg-muted/15 p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-border bg-background">
                {selectedChannelInfo && (
                  <img
                    src={selectedChannelInfo.iconSrc}
                    alt={CHANNEL_NAMES[selectedChannel]}
                    className={cn('h-6 w-6 object-contain', selectedChannelInfo.iconClassName)}
                  />
                )}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-base font-semibold">{CHANNEL_NAMES[selectedChannel]}</p>
                  {isConfigured && (
                    <span className="inline-flex items-center rounded-full border border-green-500/20 bg-green-500/15 px-2 py-0.5 text-[11px] font-medium text-green-400">
                      {t('channels:configuredBadge')}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t(selectedChannelMeta?.description || '')}
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleOpenDocs(selectedChannel)}
              disabled={isBusy}
            >
              {t('channel.viewDocs')}
            </Button>
          </div>

          <div className="space-y-3">
            <Label>{t('channel.deployMode')}</Label>
            <div className="grid grid-cols-2 gap-2 rounded-2xl border border-border bg-background/70 p-1">
              <button
                type="button"
                onClick={() => void handleSwitchMode('auto')}
                disabled={isBusy && setupMode === 'auto'}
                className={cn(
                  'rounded-xl px-4 py-2 text-sm transition-colors',
                  setupMode === 'auto'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted'
                )}
              >
                {t('channel.auto.tab')}
              </button>
              <button
                type="button"
                onClick={() => void handleSwitchMode('manual')}
                disabled={isBusy && setupMode === 'auto'}
                className={cn(
                  'rounded-xl px-4 py-2 text-sm transition-colors',
                  setupMode === 'manual'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted'
                )}
              >
                {t('channel.manual.tab')}
              </button>
            </div>
          </div>

          {setupMode === 'auto' ? (
            <div className="space-y-4 rounded-2xl border border-border bg-background/70 p-5">
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  {t(selectedChannelInfo?.hintKey || '')}
                </p>
                {autoError && (
                  <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                    {autoError}
                  </div>
                )}
              </div>

              <div className="space-y-3">
                {progressEntries.filter((entry) => entry.status !== 'pending').map((entry) => (
                  <div key={entry.stepId} className="flex items-center gap-3 rounded-xl border border-border/70 bg-muted/20 px-4 py-3">
                    {entry.status === 'completed' ? (
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-green-500/20 text-green-400">
                        <Check className="h-4 w-4" />
                      </span>
                    ) : entry.status === 'running' ? (
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-500/15 text-blue-400">
                        <Loader2 className="h-4 w-4 animate-spin" />
                      </span>
                    ) : (
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-red-400">
                        <XCircle className="h-4 w-4" />
                      </span>
                    )}
                    <p className="text-sm">{getProgressLabel(selectedChannel, entry)}</p>
                  </div>
                ))}
              </div>

              {autoFlowState === 'error' && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void beginAutoDeploy(selectedChannel)}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  {t('channel.auto.retry')}
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-4 rounded-2xl border border-border bg-background/70 p-5">
              <p className="text-sm text-muted-foreground">
                {t(`channels:dialog.${selectedChannel}ManualHint`)}
              </p>
              {selectedChannelMeta?.configFields.map((field) => {
                const isPassword = field.type === 'password';
                return (
                  <div key={field.key} className="space-y-2">
                    <Label htmlFor={`setup-${selectedChannel}-${field.key}`}>
                      {t(field.label)}
                      {field.required && <span className="ml-1 text-destructive">*</span>}
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        id={`setup-${selectedChannel}-${field.key}`}
                        type={isPassword && !showSecrets[field.key] ? 'password' : 'text'}
                        value={manualConfigValues[field.key] || ''}
                        onChange={(event) => handleManualFieldChange(field.key, event.target.value)}
                        placeholder={field.placeholder ? t(field.placeholder) : undefined}
                        className={setupChannelInputClasses}
                        disabled={manualSaving}
                      />
                      {isPassword && (
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => setShowSecrets((previous) => ({
                            ...previous,
                            [field.key]: !previous[field.key],
                          }))}
                          disabled={manualSaving}
                        >
                          {showSecrets[field.key] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                      )}
                    </div>
                    {field.description && (
                      <p className="text-xs text-muted-foreground">{t(field.description)}</p>
                    )}
                  </div>
                );
              })}

              <Button type="button" onClick={() => void handleSaveManual()} disabled={manualSaving}>
                {manualSaving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('channel.manual.saving')}
                  </>
                ) : (
                  t('channel.manual.save')
                )}
              </Button>
            </div>
          )}
        </div>
      )}

      {selectedChannel && qrDialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              void cancelAutoDeploy(selectedChannel);
              setQrDialogOpen(false);
              setQrCode(null);
              setAutoFlowState('idle');
            }
          }}
        >
          <div
            className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="space-y-2 text-center">
              <h3 className="text-xl font-semibold">{t('channel.qr.title', { name: CHANNEL_NAMES[selectedChannel] })}</h3>
              <p className="text-sm text-muted-foreground">{t('channel.qr.description', { name: CHANNEL_NAMES[selectedChannel] })}</p>
            </div>

            <div className="mt-6 flex min-h-[288px] items-center justify-center rounded-2xl border border-border bg-background">
              {qrCode ? (
                <img src={qrCode} alt={`${CHANNEL_NAMES[selectedChannel]} QR`} className="h-72 w-72 rounded-2xl object-contain" />
              ) : (
                <div className="flex flex-col items-center gap-3 text-muted-foreground">
                  <Loader2 className="h-8 w-8 animate-spin" />
                  <p className="text-sm">{t('channel.qr.loading')}</p>
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-center">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  void cancelAutoDeploy(selectedChannel);
                  setQrDialogOpen(false);
                  setQrCode(null);
                  setAutoFlowState('idle');
                }}
              >
                {t('channel.qr.cancel')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// NOTE: SkillsContent component removed - auto-install essential skills

// Installation status for each skill
type InstallStatus = 'pending' | 'installing' | 'completed' | 'failed';

interface SkillInstallState {
  id: string;
  name: string;
  description: string;
  status: InstallStatus;
}

interface InstallingContentProps {
  skills: DefaultSkill[];
  onComplete: (installedSkills: string[]) => void;
  onSkip: () => void;
}

function InstallingContent({ skills, onComplete, onSkip }: InstallingContentProps) {
  const { t } = useTranslation('setup');
  const setGatewayAutoStart = useSettingsStore((state) => state.setGatewayAutoStart);
  const [skillStates, setSkillStates] = useState<SkillInstallState[]>(
    skills.map((s) => ({ ...s, status: 'pending' as InstallStatus }))
  );
  const [overallProgress, setOverallProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const installStarted = useRef(false);

  // Real installation process
  useEffect(() => {
    if (installStarted.current) return;
    installStarted.current = true;

    const runRealInstall = async () => {
      try {
        setGatewayAutoStart(true);
        setSkillStates(prev => prev.map(s => ({ ...s, status: 'installing' })));
        setOverallProgress(10);

        const result = await invokeIpc('uv:install-all') as {
          success: boolean;
          error?: string
        };

        if (!result.success) {
          throw new Error(result.error || 'Unknown error during installation');
        }

        setOverallProgress(70);
        await ensureGatewayRunning();
        setOverallProgress(90);
        await waitForControlUiUrl();

        setSkillStates(prev => prev.map(s => ({ ...s, status: 'completed' })));
        setOverallProgress(100);

        await delay(800);
        onComplete(skills.map(s => s.id));
      } catch (error) {
        setSkillStates(prev => prev.map(s => ({ ...s, status: 'failed' })));
        setErrorMessage(error instanceof Error ? error.message : String(error));
        toast.error('Installation error');
      }
    };

    runRealInstall();
  }, [onComplete, setGatewayAutoStart, skills]);

  const getStatusIcon = (status: InstallStatus) => {
    switch (status) {
      case 'pending':
        return <div className="h-5 w-5 rounded-full border-2 border-slate-500" />;
      case 'installing':
        return <Loader2 className="h-5 w-5 text-primary animate-spin" />;
      case 'completed':
        return <CheckCircle2 className="h-5 w-5 text-green-400" />;
      case 'failed':
        return <XCircle className="h-5 w-5 text-red-400" />;
    }
  };

  const getStatusText = (skill: SkillInstallState) => {
    switch (skill.status) {
      case 'pending':
        return <span className="text-muted-foreground">{t('installing.status.pending')}</span>;
      case 'installing':
        return <span className="text-primary">{t('installing.status.installing')}</span>;
      case 'completed':
        return <span className="text-green-400">{t('installing.status.installed')}</span>;
      case 'failed':
        return <span className="text-red-400">{t('installing.status.failed')}</span>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="text-4xl mb-4">⚙️</div>
        <h2 className="text-xl font-semibold mb-2">{t('installing.title')}</h2>
        <p className="text-muted-foreground">
          {t('installing.subtitle')}
        </p>
      </div>

      {/* Progress bar */}
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">{t('installing.progress')}</span>
          <span className="text-primary">{overallProgress}%</span>
        </div>
        <div className="h-2 bg-secondary rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-primary"
            initial={{ width: 0 }}
            animate={{ width: `${overallProgress}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
      </div>

      {/* Skill list */}
      <div className="space-y-2 max-h-48 overflow-y-auto">
        {skillStates.map((skill) => (
          <motion.div
            key={skill.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
              'flex items-center justify-between p-3 rounded-lg',
              skill.status === 'installing' ? 'bg-muted' : 'bg-muted/50'
            )}
          >
            <div className="flex items-center gap-3">
              {getStatusIcon(skill.status)}
              <div>
                <p className="font-medium">{skill.name}</p>
                <p className="text-xs text-muted-foreground">{skill.description}</p>
              </div>
            </div>
            {getStatusText(skill)}
          </motion.div>
        ))}
      </div>

      {/* Error Message Display */}
      {errorMessage && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="p-4 rounded-lg bg-red-900/30 border border-red-500/50 text-red-200 text-sm"
        >
          <div className="flex items-start gap-2">
            <AlertCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold">{t('installing.error')}</p>
              <pre className="text-xs bg-black/30 p-2 rounded overflow-x-auto whitespace-pre-wrap font-monospace">
                {errorMessage}
              </pre>
              <Button
                variant="link"
                className="text-red-400 p-0 h-auto text-xs underline"
                onClick={() => window.location.reload()}
              >
                {t('installing.restart')}
              </Button>
            </div>
          </div>
        </motion.div>
      )}

      {!errorMessage && (
        <p className="text-sm text-slate-400 text-center">
          {t('installing.wait')}
        </p>
      )}
      <div className="flex justify-end">
        <Button
          variant="ghost"
          className="text-muted-foreground"
          onClick={onSkip}
        >
          {t('installing.skip')}
        </Button>
      </div>
    </div>
  );
}
interface CompleteContentProps {
  selectedProvider: string | null;
  installedSkills: string[];
}

function CompleteContent({ selectedProvider, installedSkills }: CompleteContentProps) {
  const { t } = useTranslation(['setup', 'settings']);
  const gatewayStatus = useGatewayStore((state) => state.status);

  const providerData = providers.find((p) => p.id === selectedProvider);
  const installedSkillNames = getDefaultSkills(t)
    .filter((s: DefaultSkill) => installedSkills.includes(s.id))
    .map((s: DefaultSkill) => s.name)
    .join(', ');

  return (
    <div className="text-center space-y-6">
      <div className="text-6xl mb-4">🎉</div>
      <h2 className="text-xl font-semibold">{t('complete.title')}</h2>
      <p className="text-muted-foreground">
        {t('complete.subtitle')}
      </p>

      <div className="space-y-3 text-left max-w-md mx-auto">
        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
          <span>{t('complete.provider')}</span>
          <span className="text-green-400">
            {providerData ? <span className="flex items-center gap-1.5">{getProviderIconUrl(providerData.id) ? <img src={getProviderIconUrl(providerData.id)} alt={providerData.name} className={`h-4 w-4 inline-block ${shouldInvertInDark(providerData.id) ? 'dark:invert' : ''}`} /> : providerData.icon} {providerData.id === 'custom' ? t('settings:aiProviders.custom') : providerData.name}</span> : '—'}
          </span>
        </div>
        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
          <span>{t('complete.components')}</span>
          <span className="text-green-400">
            {installedSkillNames || `${installedSkills.length} ${t('installing.status.installed')}`}
          </span>
        </div>
        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
          <span>{t('complete.gateway')}</span>
          <span className={gatewayStatus.state === 'running' ? 'text-green-400' : 'text-yellow-400'}>
            {gatewayStatus.state === 'running' ? `✓ ${t('complete.running')}` : gatewayStatus.state}
          </span>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        {t('complete.footer')}
      </p>
    </div>
  );
}

export default Setup;
