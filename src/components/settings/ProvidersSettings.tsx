/**
 * Providers Settings Component
 * Manage AI provider configurations and API keys
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Trash2,
  Edit,
  Eye,
  EyeOff,
  Check,
  X,
  Loader2,
  RefreshCw,
  Key,
  ExternalLink,
  Copy,
  XCircle,
  ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Select } from '@/components/ui/select';
import {
  useProviderStore,
  type ProviderAccount,
  type ProviderConfig,
  type ProviderVendorInfo,
} from '@/stores/providers';
import {
  PROVIDER_TYPE_INFO,
  getProviderDocsUrl,
  type ProviderType,
  getProviderIconUrl,
  resolveProviderApiKeyForSave,
  shouldShowProviderModelId,
  shouldInvertInDark,
} from '@/lib/providers';
import {
  buildProviderAccountId,
  buildProviderListItems,
  hasConfiguredCredentials,
  type ProviderListItem,
} from '@/lib/provider-accounts';
import {
  getStoredProviderModels,
  requiresManualProviderModelEntry,
  supportsProviderModelCatalog,
  syncProviderModelsToAccount,
  type ProviderModelCatalogEntry,
} from '@/lib/provider-models';
import {
  fetchProviderAuthChoiceGroups,
  flattenSupportedProviderChoices,
  getSupportedProviderChoiceDisplayLabel,
  resolveProviderOAuthStartPayload,
  type SupportedProviderChoice,
} from '@/lib/provider-auth-choices';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { invokeIpc } from '@/lib/api-client';
import { useSettingsStore } from '@/stores/settings';
import { hostApiFetch } from '@/lib/host-api';
import { subscribeHostEvent } from '@/lib/host-events';

const inputClasses = 'h-[44px] rounded-xl font-mono text-[13px] bg-[#eeece3] dark:bg-muted border-black/10 dark:border-white/10 focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:border-blue-500 shadow-sm transition-all text-foreground placeholder:text-foreground/40';
const labelClasses = 'text-[14px] text-foreground/80 font-bold';
type ArkMode = 'apikey' | 'codeplan';

function normalizeFallbackProviderIds(ids?: string[]): string[] {
  return Array.from(new Set((ids ?? []).filter(Boolean)));
}

function getProtocolBaseUrlPlaceholder(
  apiProtocol: ProviderAccount['apiProtocol'],
): string {
  if (apiProtocol === 'anthropic-messages') {
    return 'https://api.example.com/anthropic';
  }
  return 'https://api.example.com/v1';
}

function fallbackProviderIdsEqual(a?: string[], b?: string[]): boolean {
  const left = normalizeFallbackProviderIds(a).sort();
  const right = normalizeFallbackProviderIds(b).sort();
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function normalizeFallbackModels(models?: string[]): string[] {
  return Array.from(new Set((models ?? []).map((model) => model.trim()).filter(Boolean)));
}

function fallbackModelsEqual(a?: string[], b?: string[]): boolean {
  const left = normalizeFallbackModels(a);
  const right = normalizeFallbackModels(b);
  return left.length === right.length && left.every((model, index) => model === right[index]);
}

function getUserAgentHeader(headers?: Record<string, string>): string {
  if (!headers) return '';
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'user-agent') {
      return value;
    }
  }
  return '';
}

function mergeHeadersWithUserAgent(
  headers: Record<string, string> | undefined,
  userAgent: string,
): Record<string, string> {
  const next = Object.fromEntries(
    Object.entries(headers ?? {}).filter(([key]) => key.toLowerCase() !== 'user-agent'),
  );
  const normalizedUserAgent = userAgent.trim();
  if (normalizedUserAgent) {
    next['User-Agent'] = normalizedUserAgent;
  }
  return next;
}

function isArkCodePlanMode(
  vendorId: string,
  baseUrl: string | undefined,
  modelId: string | undefined,
  codePlanPresetBaseUrl?: string,
  codePlanPresetModelId?: string,
): boolean {
  if (vendorId !== 'ark' || !codePlanPresetBaseUrl || !codePlanPresetModelId) return false;
  return (baseUrl || '').trim() === codePlanPresetBaseUrl && (modelId || '').trim() === codePlanPresetModelId;
}

function shouldShowUserAgentField(account: ProviderAccount): boolean {
  return account.vendorId === 'custom';
}

function shouldShowUserAgentFieldForNewProvider(providerType: ProviderType | null): boolean {
  return providerType === 'custom';
}

function getAuthModeLabel(
  authMode: ProviderAccount['authMode'],
  t: (key: string) => string
): string {
  switch (authMode) {
    case 'api_key':
      return t('aiProviders.authModes.apiKey');
    case 'oauth_device':
      return t('aiProviders.authModes.oauthDevice');
    case 'oauth_browser':
      return t('aiProviders.authModes.oauthBrowser');
    case 'local':
      return t('aiProviders.authModes.local');
    default:
      return authMode;
  }
}

export function ProvidersSettings() {
  const { t } = useTranslation('settings');
  const devModeUnlocked = useSettingsStore((state) => state.devModeUnlocked);
  const {
    statuses,
    accounts,
    vendors,
    defaultAccountId,
    loading,
    refreshProviderSnapshot,
    createAccount,
    removeAccount,
    updateAccount,
    setDefaultAccount,
    validateAccountApiKey,
  } = useProviderStore();

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const vendorMap = new Map(vendors.map((vendor) => [vendor.id, vendor]));
  const existingVendorIds = new Set(accounts.map((account) => account.vendorId));
  const displayProviders = useMemo(
    () => buildProviderListItems(accounts, statuses, vendors, defaultAccountId),
    [accounts, statuses, vendors, defaultAccountId],
  );

  // Fetch providers on mount
  useEffect(() => {
    refreshProviderSnapshot();
  }, [refreshProviderSnapshot]);

  const handleAddProvider = async (
    type: ProviderType,
    name: string,
    apiKey: string,
    options?: {
      baseUrl?: string;
      model?: string;
      authMode?: ProviderAccount['authMode'];
      apiProtocol?: ProviderAccount['apiProtocol'];
      headers?: Record<string, string>;
      metadata?: ProviderAccount['metadata'];
    }
  ): Promise<{ accountId: string }> => {
    const vendor = vendorMap.get(type);
    const id = buildProviderAccountId(type, null, vendors);
    const effectiveApiKey = resolveProviderApiKeyForSave(type, apiKey);
    try {
      await createAccount({
        id,
        vendorId: type,
        label: name,
        authMode: options?.authMode || vendor?.defaultAuthMode || (type === 'ollama' ? 'local' : 'api_key'),
        baseUrl: options?.baseUrl,
        apiProtocol: options?.apiProtocol,
        headers: options?.headers,
        model: options?.model,
        metadata: options?.metadata,
        enabled: true,
        isDefault: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }, effectiveApiKey);

      // Auto-set as default if no default is currently configured
      if (!defaultAccountId) {
        await setDefaultAccount(id);
      }

      setShowAddDialog(false);
      toast.success(t('aiProviders.toast.added'));
      return { accountId: id };
    } catch (error) {
      toast.error(`${t('aiProviders.toast.failedAdd')}: ${error}`);
      throw error;
    }
  };

  const handleDeleteProvider = async (providerId: string) => {
    try {
      await removeAccount(providerId);
      toast.success(t('aiProviders.toast.deleted'));
    } catch (error) {
      toast.error(`${t('aiProviders.toast.failedDelete')}: ${error}`);
    }
  };

  const handleSetDefault = async (providerId: string) => {
    try {
      await setDefaultAccount(providerId);
      toast.success(t('aiProviders.toast.defaultUpdated'));
    } catch (error) {
      toast.error(`${t('aiProviders.toast.failedDefault')}: ${error}`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-serif text-foreground font-normal tracking-tight" style={{ fontFamily: 'Georgia, Cambria, "Times New Roman", Times, serif' }}>
          {t('aiProviders.title', 'AI Providers')}
        </h2>
        <Button onClick={() => setShowAddDialog(true)} className="rounded-full px-5 h-9 shadow-none font-medium text-[13px]">
          <Plus className="h-4 w-4 mr-2" />
          {t('aiProviders.add')}
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground bg-black/5 dark:bg-white/5 rounded-3xl border border-transparent border-dashed">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : displayProviders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground bg-black/5 dark:bg-white/5 rounded-3xl border border-transparent border-dashed">
          <Key className="h-12 w-12 mb-4 opacity-50" />
          <h3 className="text-[15px] font-medium mb-1 text-foreground">{t('aiProviders.empty.title')}</h3>
          <p className="text-[13px] text-center mb-6 max-w-sm">
            {t('aiProviders.empty.desc')}
          </p>
          <Button onClick={() => setShowAddDialog(true)} className="rounded-full px-6 h-10 bg-[#0a84ff] hover:bg-[#007aff] text-white">
            <Plus className="h-4 w-4 mr-2" />
            {t('aiProviders.empty.cta')}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {displayProviders.map((item) => (
            <ProviderCard
              key={item.account.id}
              item={item}
              allProviders={displayProviders}
              isDefault={item.account.id === defaultAccountId}
              isEditing={editingProvider === item.account.id}
              onEdit={() => setEditingProvider(item.account.id)}
              onCancelEdit={() => setEditingProvider(null)}
              onDelete={() => handleDeleteProvider(item.account.id)}
              onSetDefault={() => handleSetDefault(item.account.id)}
              onSaveEdits={async (payload) => {
                const updates: Partial<ProviderAccount> = {};
                if (payload.updates) {
                  if (payload.updates.baseUrl !== undefined) updates.baseUrl = payload.updates.baseUrl;
                  if (payload.updates.apiProtocol !== undefined) updates.apiProtocol = payload.updates.apiProtocol;
                  if (payload.updates.headers !== undefined) updates.headers = payload.updates.headers;
                  if (payload.updates.model !== undefined) updates.model = payload.updates.model;
                  if (payload.updates.fallbackModels !== undefined) updates.fallbackModels = payload.updates.fallbackModels;
                  if (payload.updates.fallbackProviderIds !== undefined) {
                    updates.fallbackAccountIds = payload.updates.fallbackProviderIds;
                  }
                }
                await updateAccount(
                  item.account.id,
                  updates,
                  payload.newApiKey
                );
                setEditingProvider(null);
              }}
              onValidateKey={(key, options) => validateAccountApiKey(item.account.id, key, options)}
              devModeUnlocked={devModeUnlocked}
            />
          ))}
        </div>
      )}

      {/* Add Provider Dialog */}
      {showAddDialog && (
        <AddProviderDialog
          existingVendorIds={existingVendorIds}
          vendors={vendors}
          onClose={() => setShowAddDialog(false)}
          onAdd={handleAddProvider}
          onValidateKey={(type, key, options) => validateAccountApiKey(type, key, options)}
          devModeUnlocked={devModeUnlocked}
        />
      )}
    </div>
  );
}

interface ProviderCardProps {
  item: ProviderListItem;
  allProviders: ProviderListItem[];
  isDefault: boolean;
  isEditing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
  onSetDefault: () => void;
  onSaveEdits: (payload: { newApiKey?: string; updates?: Partial<ProviderConfig> }) => Promise<void>;
  onValidateKey: (
    key: string,
    options?: { baseUrl?: string; apiProtocol?: ProviderAccount['apiProtocol'] }
  ) => Promise<{ valid: boolean; error?: string }>;
  devModeUnlocked: boolean;
}



function ProviderCard({
  item,
  allProviders,
  isDefault,
  isEditing,
  onEdit,
  onCancelEdit,
  onDelete,
  onSetDefault,
  onSaveEdits,
  onValidateKey,
  devModeUnlocked,
}: ProviderCardProps) {
  const { t, i18n } = useTranslation('settings');
  const { account, vendor, status } = item;
  const [newKey, setNewKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(account.baseUrl || '');
  const [apiProtocol, setApiProtocol] = useState<ProviderAccount['apiProtocol']>(account.apiProtocol || 'openai-completions');
  const [userAgent, setUserAgent] = useState(getUserAgentHeader(account.headers));
  const [modelId, setModelId] = useState(account.model || '');
  const [fallbackModelsText, setFallbackModelsText] = useState(
    normalizeFallbackModels(account.fallbackModels).join('\n')
  );
  const [fallbackProviderIds, setFallbackProviderIds] = useState<string[]>(
    normalizeFallbackProviderIds(account.fallbackAccountIds)
  );
  const [showKey, setShowKey] = useState(false);
  const [showFallback, setShowFallback] = useState(false);
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [arkMode, setArkMode] = useState<ArkMode>('apikey');
  const [availableModels, setAvailableModels] = useState<ProviderModelCatalogEntry[]>(
    getStoredProviderModels(account),
  );
  const [modelsLoading, setModelsLoading] = useState(false);

  const typeInfo = PROVIDER_TYPE_INFO.find((t) => t.id === account.vendorId);
  const providerDocsUrl = getProviderDocsUrl(typeInfo, i18n.language);
  const showModelIdField = shouldShowProviderModelId(typeInfo, devModeUnlocked)
    || requiresManualProviderModelEntry(account);
  const codePlanPreset = typeInfo?.codePlanPresetBaseUrl && typeInfo?.codePlanPresetModelId
    ? {
      baseUrl: typeInfo.codePlanPresetBaseUrl,
      modelId: typeInfo.codePlanPresetModelId,
    }
    : null;
  const effectiveDocsUrl = account.vendorId === 'ark' && arkMode === 'codeplan'
    ? (typeInfo?.codePlanDocsUrl || providerDocsUrl)
    : providerDocsUrl;
  const hasDiscoveredModels = availableModels.length > 0;
  const canEditModelConfig = Boolean(typeInfo?.showBaseUrl || showModelIdField || hasDiscoveredModels);
  const showUserAgentField = shouldShowUserAgentField(account);
  const canSyncModels = supportsProviderModelCatalog(account);

  const refreshProviderModels = async () => {
    setModelsLoading(true);
    try {
      const { models, selectedModelId } = await syncProviderModelsToAccount({
        accountId: account.id,
        defaultModelId: typeInfo?.defaultModelId,
      });
      setAvailableModels(models);
      if (selectedModelId) {
        setModelId(selectedModelId);
      }
      toast.success(t('aiProviders.toast.modelsLoaded', { count: models.length }));
    } catch (error) {
      toast.error(t('aiProviders.toast.modelsLoadFailed', { error: String(error) }));
    } finally {
      setModelsLoading(false);
    }
  };

  useEffect(() => {
    if (isEditing) {
      setNewKey('');
      setShowKey(false);
      setBaseUrl(account.baseUrl || '');
      setApiProtocol(account.apiProtocol || 'openai-completions');
      setUserAgent(getUserAgentHeader(account.headers));
      setModelId(account.model || '');
      setFallbackModelsText(normalizeFallbackModels(account.fallbackModels).join('\n'));
      setFallbackProviderIds(normalizeFallbackProviderIds(account.fallbackAccountIds));
      setArkMode(
        isArkCodePlanMode(
          account.vendorId,
          account.baseUrl,
          account.model,
          typeInfo?.codePlanPresetBaseUrl,
          typeInfo?.codePlanPresetModelId,
        ) ? 'codeplan' : 'apikey'
      );
      setAvailableModels(getStoredProviderModels(account));
    }
  }, [isEditing, account.baseUrl, account.headers, account.fallbackModels, account.fallbackAccountIds, account.model, account.apiProtocol, account.vendorId, typeInfo?.codePlanPresetBaseUrl, typeInfo?.codePlanPresetModelId]);

  const fallbackOptions = allProviders.filter((candidate) => candidate.account.id !== account.id);

  const toggleFallbackProvider = (providerId: string) => {
    setFallbackProviderIds((current) => (
      current.includes(providerId)
        ? current.filter((id) => id !== providerId)
        : [...current, providerId]
    ));
  };

  const handleSaveEdits = async () => {
    setSaving(true);
    try {
      const payload: { newApiKey?: string; updates?: Partial<ProviderConfig> } = {};
      const normalizedFallbackModels = normalizeFallbackModels(fallbackModelsText.split('\n'));

      if (newKey.trim()) {
        setValidating(true);
        const result = await onValidateKey(newKey, {
          baseUrl: baseUrl.trim() || undefined,
          apiProtocol: account.apiProtocol || ((account.vendorId === 'custom' || account.vendorId === 'ollama')
            ? apiProtocol
            : undefined),
        });
        setValidating(false);
        if (!result.valid) {
          toast.error(result.error || t('aiProviders.toast.invalidKey'));
          setSaving(false);
          return;
        }
        payload.newApiKey = newKey.trim();
      }

      {
        if ((showModelIdField || hasDiscoveredModels) && !modelId.trim()) {
          toast.error(t('aiProviders.toast.modelRequired'));
          setSaving(false);
          return;
        }

        const updates: Partial<ProviderConfig> = {};
        if (typeInfo?.showBaseUrl && (baseUrl.trim() || undefined) !== (account.baseUrl || undefined)) {
          updates.baseUrl = baseUrl.trim() || undefined;
        }
        if ((account.vendorId === 'custom' || account.vendorId === 'ollama') && apiProtocol !== account.apiProtocol) {
          updates.apiProtocol = apiProtocol;
        }
        if ((showModelIdField || hasDiscoveredModels) && (modelId.trim() || undefined) !== (account.model || undefined)) {
          updates.model = modelId.trim() || undefined;
        }
        const existingUserAgent = getUserAgentHeader(account.headers).trim();
        const nextUserAgent = userAgent.trim();
        if (nextUserAgent !== existingUserAgent) {
          updates.headers = mergeHeadersWithUserAgent(account.headers, nextUserAgent);
        }
        if (!fallbackModelsEqual(normalizedFallbackModels, account.fallbackModels)) {
          updates.fallbackModels = normalizedFallbackModels;
        }
        if (!fallbackProviderIdsEqual(fallbackProviderIds, account.fallbackAccountIds)) {
          updates.fallbackProviderIds = normalizeFallbackProviderIds(fallbackProviderIds);
        }
        if (Object.keys(updates).length > 0) {
          payload.updates = updates;
        }
      }

      // Keep Ollama key optional in UI, but persist a placeholder when
      // editing legacy configs that have no stored key.
      if (account.vendorId === 'ollama' && !status?.hasKey && !payload.newApiKey) {
        payload.newApiKey = resolveProviderApiKeyForSave(account.vendorId, '') as string;
      }

      if (!payload.newApiKey && !payload.updates) {
        onCancelEdit();
        setSaving(false);
        return;
      }

      await onSaveEdits(payload);
      setNewKey('');
      toast.success(t('aiProviders.toast.updated'));
    } catch (error) {
      toast.error(`${t('aiProviders.toast.failedUpdate')}: ${error}`);
    } finally {
      setSaving(false);
      setValidating(false);
    }
  };

  const currentInputClasses = isDefault
    ? "h-[40px] rounded-xl font-mono text-[13px] bg-white dark:bg-card border-black/10 dark:border-white/10 focus-visible:ring-2 focus-visible:ring-blue-500/50 shadow-sm"
    : inputClasses;

  const currentLabelClasses = isDefault ? "text-[13px] text-muted-foreground" : labelClasses;
  const currentSectionLabelClasses = isDefault ? "text-[14px] font-bold text-foreground/80" : labelClasses;

  return (
    <div
      className={cn(
        "group flex flex-col p-4 rounded-2xl transition-all relative overflow-hidden hover:bg-black/5 dark:hover:bg-white/5",
        isDefault
          ? "bg-black/[0.04] dark:bg-white/[0.06] border border-transparent"
          : "bg-transparent border border-transparent"
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="h-[42px] w-[42px] shrink-0 flex items-center justify-center text-foreground border border-black/5 dark:border-white/10 rounded-full bg-black/5 dark:bg-white/5 shadow-sm group-hover:scale-105 transition-transform">
            {getProviderIconUrl(account.vendorId) ? (
              <img src={getProviderIconUrl(account.vendorId)} alt={typeInfo?.name || account.vendorId} className={cn('h-5 w-5', shouldInvertInDark(account.vendorId) && 'dark:invert')} />
            ) : (
              <span className="text-xl">{vendor?.icon || typeInfo?.icon || '⚙️'}</span>
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-[15px]">{account.label}</span>
              {isDefault && (
                <span className="flex items-center gap-1 font-mono text-[10px] font-medium px-2 py-0.5 rounded-full bg-black/[0.04] dark:bg-white/[0.08] border-0 shadow-none text-foreground/70">
                  <Check className="h-3 w-3" />
                  {t('aiProviders.card.default')}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5 text-[13px] text-muted-foreground">
              <span className="capitalize">{vendor?.name || account.vendorId}</span>
              <span className="w-1 h-1 rounded-full bg-black/20 dark:bg-white/20" />
              <span>{getAuthModeLabel(account.authMode, t)}</span>
              {account.model && (
                <>
                  <span className="w-1 h-1 rounded-full bg-black/20 dark:bg-white/20" />
                  <span className="truncate max-w-[200px]">{account.model}</span>
                </>
              )}
              <span className="w-1 h-1 rounded-full bg-black/20 dark:bg-white/20" />
              <span className="flex items-center gap-1">
                {hasConfiguredCredentials(account, status) ? (
                  <><div className="w-1.5 h-1.5 rounded-full bg-green-500" /> {t('aiProviders.card.configured')}</>
                ) : (
                  <><div className="w-1.5 h-1.5 rounded-full bg-red-500" /> {t('aiProviders.dialog.apiKeyMissing')}</>
                )}
              </span>
              {((account.fallbackModels?.length ?? 0) > 0 || (account.fallbackAccountIds?.length ?? 0) > 0) && (
                <>
                  <span className="w-1 h-1 rounded-full bg-black/20 dark:bg-white/20" />
                  <span className="truncate max-w-[150px]" title={t('aiProviders.sections.fallback')}>
                    {t('aiProviders.sections.fallback')}: {[
                      ...normalizeFallbackModels(account.fallbackModels),
                      ...normalizeFallbackProviderIds(account.fallbackAccountIds)
                        .map((fallbackId) => allProviders.find((candidate) => candidate.account.id === fallbackId)?.account.label)
                        .filter(Boolean),
                    ].join(', ')}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {!isEditing && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {!isDefault && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full text-muted-foreground hover:text-blue-600 hover:bg-white dark:hover:bg-card shadow-sm"
                onClick={onSetDefault}
                title={t('aiProviders.card.setDefault')}
              >
                <Check className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-white dark:hover:bg-card shadow-sm"
              onClick={onEdit}
              title={t('aiProviders.card.editKey')}
            >
              <Edit className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full text-muted-foreground hover:text-destructive hover:bg-white dark:hover:bg-card shadow-sm"
              onClick={onDelete}
              title={t('aiProviders.card.delete')}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {isEditing && (
        <div className="space-y-6 mt-4 pt-4 border-t border-black/5 dark:border-white/5">
          {effectiveDocsUrl && (
            <div className="flex justify-end -mt-2 mb-2">
              <a
                href={effectiveDocsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[12px] text-blue-500 hover:text-blue-600 font-medium inline-flex items-center gap-1"
              >
                {t('aiProviders.dialog.customDoc')}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
          {canEditModelConfig && (
            <div className="space-y-3">
              <p className={currentSectionLabelClasses}>{t('aiProviders.sections.model')}</p>
              {typeInfo?.showBaseUrl && (
                <div className="space-y-1.5">
                  <Label className={currentLabelClasses}>{t('aiProviders.dialog.baseUrl')}</Label>
                  <Input
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder={getProtocolBaseUrlPlaceholder(apiProtocol)}
                    className={currentInputClasses}
                  />
                </div>
              )}
              {(showModelIdField || hasDiscoveredModels) && (
                <div className="space-y-1.5 pt-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label className={currentLabelClasses}>{t('aiProviders.dialog.modelId')}</Label>
                    {canSyncModels && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-[12px]"
                        onClick={refreshProviderModels}
                        disabled={modelsLoading}
                      >
                        {modelsLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        <span className="ml-1">{t('aiProviders.dialog.refreshModels')}</span>
                      </Button>
                    )}
                  </div>
                  {hasDiscoveredModels ? (
                    <Select
                      value={modelId}
                      onChange={(e) => setModelId(e.target.value)}
                      className={currentInputClasses}
                    >
                      <option value="" disabled>{t('aiProviders.dialog.selectModel')}</option>
                      {availableModels.map((model) => (
                        <option key={model.id} value={model.id}>{model.name || model.id}</option>
                      ))}
                    </Select>
                  ) : (
                    <Input
                      value={modelId}
                      onChange={(e) => setModelId(e.target.value)}
                      placeholder={typeInfo?.modelIdPlaceholder || 'provider/model-id'}
                      className={currentInputClasses}
                    />
                  )}
                </div>
              )}
              {account.vendorId === 'ark' && codePlanPreset && (
                <div className="space-y-1.5 pt-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label className={currentLabelClasses}>{t('aiProviders.dialog.codePlanPreset')}</Label>
                    {typeInfo?.codePlanDocsUrl && (
                      <a
                        href={typeInfo.codePlanDocsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[12px] text-blue-500 hover:text-blue-600 font-medium inline-flex items-center gap-1"
                      >
                        {t('aiProviders.dialog.codePlanDoc')}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                  <div className="flex gap-2 text-[13px]">
                    <button
                      type="button"
                      onClick={() => {
                        setArkMode('apikey');
                        setBaseUrl(typeInfo?.defaultBaseUrl || '');
                        if (modelId.trim() === codePlanPreset.modelId) {
                          setModelId(typeInfo?.defaultModelId || '');
                        }
                      }}
                      className={cn("flex-1 py-1.5 px-3 rounded-lg border transition-colors", arkMode === 'apikey' ? "bg-white dark:bg-card border-black/20 dark:border-white/20 shadow-sm font-medium" : "border-transparent bg-black/5 dark:bg-white/5 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10")}
                    >
                      {t('aiProviders.authModes.apiKey')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setArkMode('codeplan');
                        setBaseUrl(codePlanPreset.baseUrl);
                        setModelId(codePlanPreset.modelId);
                      }}
                      className={cn("flex-1 py-1.5 px-3 rounded-lg border transition-colors", arkMode === 'codeplan' ? "bg-white dark:bg-card border-black/20 dark:border-white/20 shadow-sm font-medium" : "border-transparent bg-black/5 dark:bg-white/5 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10")}
                    >
                      {t('aiProviders.dialog.codePlanMode')}
                    </button>
                  </div>
                  {arkMode === 'codeplan' && (
                    <p className="text-[12px] text-muted-foreground">
                      {t('aiProviders.dialog.codePlanPresetDesc')}
                    </p>
                  )}
                </div>
              )}
              {account.vendorId === 'custom' && (
                <div className="space-y-1.5 pt-2">
                  <Label className={currentLabelClasses}>{t('aiProviders.dialog.protocol', 'Protocol')}</Label>
                  <div className="flex gap-2 text-[13px]">
                    <button
                      type="button"
                      onClick={() => setApiProtocol('openai-completions')}
                      className={cn("flex-1 py-1.5 px-3 rounded-lg border transition-colors", apiProtocol === 'openai-completions' ? "bg-white dark:bg-card border-black/20 dark:border-white/20 shadow-sm font-medium" : "border-transparent bg-black/5 dark:bg-white/5 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10")}
                    >
                      {t('aiProviders.protocols.openaiCompletions', 'OpenAI Completions')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setApiProtocol('openai-responses')}
                      className={cn("flex-1 py-1.5 px-3 rounded-lg border transition-colors", apiProtocol === 'openai-responses' ? "bg-white dark:bg-card border-black/20 dark:border-white/20 shadow-sm font-medium" : "border-transparent bg-black/5 dark:bg-white/5 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10")}
                    >
                      {t('aiProviders.protocols.openaiResponses', 'OpenAI Responses')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setApiProtocol('anthropic-messages')}
                      className={cn("flex-1 py-1.5 px-3 rounded-lg border transition-colors", apiProtocol === 'anthropic-messages' ? "bg-white dark:bg-card border-black/20 dark:border-white/20 shadow-sm font-medium" : "border-transparent bg-black/5 dark:bg-white/5 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10")}
                    >
                      {t('aiProviders.protocols.anthropic', 'Anthropic')}
                    </button>
                  </div>
                </div>
              )}
              {showUserAgentField && (
                <div className="space-y-1.5 pt-2">
                  <Label className={currentLabelClasses}>{t('aiProviders.dialog.userAgent')}</Label>
                  <Input
                    value={userAgent}
                    onChange={(e) => setUserAgent(e.target.value)}
                    placeholder={t('aiProviders.dialog.userAgentPlaceholder')}
                    className={currentInputClasses}
                  />
                </div>
              )}
            </div>
          )}
          <div className="space-y-3">
            <button
              onClick={() => setShowFallback(!showFallback)}
              className="flex items-center justify-between w-full text-[14px] font-bold text-foreground/80 hover:text-foreground transition-colors"
            >
              <span>{t('aiProviders.sections.fallback')}</span>
              <ChevronDown className={cn("h-4 w-4 transition-transform", showFallback && "rotate-180")} />
            </button>
            {showFallback && (
              <div className="space-y-3 pt-2">
                <div className="space-y-1.5">
                  <Label className={currentLabelClasses}>{t('aiProviders.dialog.fallbackModelIds')}</Label>
                  <textarea
                    value={fallbackModelsText}
                    onChange={(e) => setFallbackModelsText(e.target.value)}
                    placeholder={t('aiProviders.dialog.fallbackModelIdsPlaceholder')}
                    className={isDefault
                      ? "min-h-24 w-full rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-card px-3 py-2 text-[13px] font-mono outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 shadow-sm"
                      : "min-h-24 w-full rounded-xl border border-black/10 dark:border-white/10 bg-[#eeece3] dark:bg-muted px-3 py-2 text-[13px] font-mono outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:border-blue-500 shadow-sm transition-all text-foreground placeholder:text-foreground/40"}
                  />
                  <p className="text-[12px] text-muted-foreground">
                    {t('aiProviders.dialog.fallbackModelIdsHelp')}
                  </p>
                </div>
                <div className="space-y-2 pt-1">
                  <Label className={currentLabelClasses}>{t('aiProviders.dialog.fallbackProviders')}</Label>
                  {fallbackOptions.length === 0 ? (
                    <p className="text-[13px] text-muted-foreground">{t('aiProviders.dialog.noFallbackOptions')}</p>
                  ) : (
                    <div className={cn("space-y-2 rounded-xl border border-black/10 dark:border-white/10 p-3 shadow-sm", isDefault ? "bg-white dark:bg-card" : "bg-[#eeece3] dark:bg-muted")}>
                      {fallbackOptions.map((candidate) => (
                        <label key={candidate.account.id} className="flex items-center gap-3 text-[13px] cursor-pointer group/label">
                          <input
                            type="checkbox"
                            checked={fallbackProviderIds.includes(candidate.account.id)}
                            onChange={() => toggleFallbackProvider(candidate.account.id)}
                            className="rounded border-black/20 dark:border-white/20 text-blue-500 focus:ring-blue-500/50"
                          />
                          <span className="font-medium group-hover/label:text-blue-500 transition-colors">{candidate.account.label}</span>
                          <span className="text-[12px] text-muted-foreground">
                            {candidate.account.model || candidate.vendor?.name || candidate.account.vendorId}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label className={currentSectionLabelClasses}>{t('aiProviders.dialog.apiKey')}</Label>
                <p className="text-[12px] text-muted-foreground">
                  {hasConfiguredCredentials(account, status)
                    ? t('aiProviders.dialog.apiKeyConfigured')
                    : t('aiProviders.dialog.apiKeyMissing')}
                </p>
              </div>
              {hasConfiguredCredentials(account, status) ? (
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-green-600 dark:text-green-500 bg-green-500/10 px-2 py-1 rounded-md">
                  <div className="w-1.5 h-1.5 rounded-full bg-current" />
                  {t('aiProviders.card.configured')}
                </div>
              ) : null}
            </div>
            {typeInfo?.apiKeyUrl && (
              <div className="flex justify-start">
                <a
                  href={typeInfo.apiKeyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[13px] text-blue-500 hover:text-blue-600 hover:underline flex items-center gap-1"
                  tabIndex={-1}
                >
                  {t('aiProviders.oauth.getApiKey')} <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
            <div className="space-y-1.5 pt-1">
              <Label className={currentLabelClasses}>{t('aiProviders.dialog.replaceApiKey')}</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type={showKey ? 'text' : 'password'}
                    placeholder={typeInfo?.requiresApiKey ? typeInfo?.placeholder : (typeInfo?.id === 'ollama' ? t('aiProviders.notRequired') : t('aiProviders.card.editKey'))}
                    value={newKey}
                    onChange={(e) => setNewKey(e.target.value)}
                    className={cn(currentInputClasses, 'pr-10')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <Button
                  variant="outline"
                  onClick={handleSaveEdits}
                  className={cn(
                    "rounded-xl px-4 border-black/10 dark:border-white/10",
                    isDefault
                      ? "h-[40px] bg-white dark:bg-card hover:bg-black/5 dark:hover:bg-white/10"
                      : "h-[44px] bg-[#eeece3] dark:bg-muted hover:bg-black/5 dark:hover:bg-white/10 shadow-sm"
                  )}
                  disabled={
                    validating
                    || saving
                    || (
                      !newKey.trim()
                      && (baseUrl.trim() || undefined) === (account.baseUrl || undefined)
                      && userAgent.trim() === getUserAgentHeader(account.headers).trim()
                      && (modelId.trim() || undefined) === (account.model || undefined)
                      && fallbackModelsEqual(normalizeFallbackModels(fallbackModelsText.split('\n')), account.fallbackModels)
                      && fallbackProviderIdsEqual(fallbackProviderIds, account.fallbackAccountIds)
                    )
                    || Boolean((showModelIdField || hasDiscoveredModels) && !modelId.trim())
                  }
                >
                  {validating || saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4 text-green-500" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  onClick={onCancelEdit}
                  className={cn(
                    "p-0 rounded-xl",
                    isDefault
                      ? "h-[40px] w-[40px] hover:bg-black/5 dark:hover:bg-white/10"
                      : "h-[44px] w-[44px] bg-[#eeece3] dark:bg-muted border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10 shadow-sm text-muted-foreground hover:text-foreground"
                  )}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-[12px] text-muted-foreground">
                {t('aiProviders.dialog.replaceApiKeyHelp')}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface AddProviderDialogProps {
  existingVendorIds: Set<string>;
  vendors: ProviderVendorInfo[];
  onClose: () => void;
  onAdd: (
    type: ProviderType,
    name: string,
    apiKey: string,
    options?: {
      baseUrl?: string;
      model?: string;
      authMode?: ProviderAccount['authMode'];
      apiProtocol?: ProviderAccount['apiProtocol'];
      headers?: Record<string, string>;
      metadata?: ProviderAccount['metadata'];
    }
  ) => Promise<{ accountId: string }>;
  onValidateKey: (
    type: string,
    apiKey: string,
    options?: { baseUrl?: string; apiProtocol?: ProviderAccount['apiProtocol'] }
  ) => Promise<{ valid: boolean; error?: string }>;
  devModeUnlocked: boolean;
}

function AddProviderDialog({
  existingVendorIds,
  vendors,
  onClose,
  onAdd,
  onValidateKey,
  devModeUnlocked,
}: AddProviderDialogProps) {
  const { t, i18n } = useTranslation('settings');
  const [selectedChoiceId, setSelectedChoiceId] = useState<string | null>(null);
  const [supportedChoices, setSupportedChoices] = useState<SupportedProviderChoice[]>([]);
  const [choicesLoading, setChoicesLoading] = useState(false);
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [modelId, setModelId] = useState('');
  const [apiProtocol, setApiProtocol] = useState<ProviderAccount['apiProtocol']>('openai-completions');
  const [showAdvancedConfig, setShowAdvancedConfig] = useState(false);
  const [userAgent, setUserAgent] = useState('');
  const [arkMode, setArkMode] = useState<ArkMode>('apikey');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

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
  const selectedChoice = useMemo(
    () => supportedChoices.find((choice) => choice.id === selectedChoiceId) ?? null,
    [selectedChoiceId, supportedChoices],
  );
  const selectedType = selectedChoice?.vendorId ?? null;
  const typeInfo = PROVIDER_TYPE_INFO.find((type) => type.id === selectedType);
  const providerDocsUrl = getProviderDocsUrl(typeInfo, i18n.language);
  const showModelIdField = shouldShowProviderModelId(typeInfo, devModeUnlocked);
  const codePlanPreset = typeInfo?.codePlanPresetBaseUrl && typeInfo?.codePlanPresetModelId
    ? {
      baseUrl: typeInfo.codePlanPresetBaseUrl,
      modelId: typeInfo.codePlanPresetModelId,
    }
    : null;
  const effectiveDocsUrl = selectedType === 'ark' && arkMode === 'codeplan'
    ? (typeInfo?.codePlanDocsUrl || providerDocsUrl)
    : providerDocsUrl;
  const vendorMap = new Map(vendors.map((vendor) => [vendor.id, vendor]));
  const showUserAgentInAddDialog = shouldShowUserAgentFieldForNewProvider(selectedType);
  const useOAuthFlow = selectedChoice?.authMode === 'oauth_browser'
    || selectedChoice?.authMode === 'oauth_device';
  const requiresApiKey = selectedChoice?.authMode === 'api_key'
    && (typeInfo?.requiresApiKey ?? true);
  const resolvedApiProtocol = selectedChoice?.apiProtocol
    || ((selectedType === 'custom' || selectedType === 'ollama') ? apiProtocol : undefined);
  const effectiveHeaders = showUserAgentInAddDialog
    ? mergeHeadersWithUserAgent(selectedChoice?.headers, userAgent)
    : (selectedChoice?.headers ?? undefined);
  const effectiveModelId = modelId.trim() || selectedChoice?.defaultModelId || typeInfo?.defaultModelId || undefined;
  const latestChoiceRef = React.useRef<SupportedProviderChoice | null>(null);

  useEffect(() => {
    if (selectedType !== 'ark') {
      setArkMode('apikey');
      return;
    }
    setArkMode(
      isArkCodePlanMode(
        'ark',
        baseUrl,
        modelId,
        typeInfo?.codePlanPresetBaseUrl,
        typeInfo?.codePlanPresetModelId,
      ) ? 'codeplan' : 'apikey'
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedType]);

  useEffect(() => {
    latestChoiceRef.current = selectedChoice;
  }, [selectedChoice]);

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

  // Keep refs to the latest values so event handlers see the current dialog state.
  const latestRef = React.useRef({ selectedType, typeInfo, onClose, t, name });
  const pendingOAuthRef = React.useRef<{ accountId: string; label: string } | null>(null);
  useEffect(() => {
    latestRef.current = { selectedType, typeInfo, onClose, t, name };
  });

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
      setValidationError(null);

      const { onClose: close, t: translate, name: latestName } = latestRef.current;
      const payload = (data as { accountId?: string } | undefined) || undefined;
      const accountId = payload?.accountId || pendingOAuthRef.current?.accountId;
      const latestChoice = latestChoiceRef.current;

      try {
        const existingAccount = accountId
          ? await hostApiFetch<ProviderAccount | null>(
            `/api/provider-accounts/${encodeURIComponent(accountId)}`,
          )
          : null;
        if (accountId && latestChoice) {
          const updates: Partial<ProviderAccount> = {
            metadata: {
              ...(existingAccount?.metadata ?? {}),
              authChoiceId: latestChoice.id,
              ...(latestChoice.modelProviderKey ? { modelProviderKey: latestChoice.modelProviderKey } : {}),
            },
          };
          if (latestName.trim() && latestName.trim() !== (existingAccount?.label ?? '')) {
            updates.label = latestName.trim();
          }
          if (latestChoice.apiProtocol && !existingAccount?.apiProtocol) {
            updates.apiProtocol = latestChoice.apiProtocol;
          }
          if (latestChoice.headers && !existingAccount?.headers) {
            updates.headers = latestChoice.headers;
          }
          if (latestChoice.defaultBaseUrl && !existingAccount?.baseUrl) {
            updates.baseUrl = latestChoice.defaultBaseUrl;
          }
          if (latestChoice.defaultModelId && !existingAccount?.model) {
            updates.model = latestChoice.defaultModelId;
          }
          await hostApiFetch(`/api/provider-accounts/${encodeURIComponent(accountId)}`, {
            method: 'PUT',
            body: JSON.stringify({ updates }),
          });
        }

        const store = useProviderStore.getState();
        await store.refreshProviderSnapshot();

        if (accountId) {
          await store.setDefaultAccount(accountId);
          await syncProviderModelsToAccount({
            accountId,
            defaultModelId: latestChoice?.defaultModelId || latestRef.current.typeInfo?.defaultModelId,
          });
          await store.refreshProviderSnapshot();
        }
      } catch (err) {
        console.error('Failed to refresh providers after OAuth:', err);
      }

      pendingOAuthRef.current = null;
      close();
      toast.success(translate('aiProviders.toast.added'));
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
  }, []);

  const handleStartOAuth = async () => {
    if (!selectedChoice || !selectedType) return;

    const oauthPayload = resolveProviderOAuthStartPayload(selectedChoice);
    if (!oauthPayload) {
      toast.error(t('aiProviders.toast.invalidKey'));
      return;
    }

    const hasMinimax = existingVendorIds.has('minimax-portal') || existingVendorIds.has('minimax-portal-cn');
    if ((selectedType === 'minimax-portal' || selectedType === 'minimax-portal-cn') && hasMinimax) {
      toast.error(t('aiProviders.toast.minimaxConflict'));
      return;
    }

    setOauthFlowing(true);
    setOauthData(null);
    setManualCodeInput('');
    setOauthError(null);

    try {
      const vendor = vendorMap.get(selectedType);
      const supportsMultipleAccounts = vendor?.supportsMultipleAccounts ?? selectedType === 'custom';
      const accountId = supportsMultipleAccounts ? `${selectedType}-${crypto.randomUUID()}` : selectedType;
      const label = name || getSupportedProviderChoiceDisplayLabel(selectedChoice);
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
    await hostApiFetch('/api/providers/oauth/cancel', {
      method: 'POST',
    });
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

  const availableChoices = supportedChoices.filter((choice) => {
    // MiniMax portal variants are mutually exclusive — hide BOTH variants
    // when either one already exists (account may have vendorId of either variant).
    const hasMinimax = existingVendorIds.has('minimax-portal') || existingVendorIds.has('minimax-portal-cn');
    if ((choice.vendorId === 'minimax-portal' || choice.vendorId === 'minimax-portal-cn') && hasMinimax) return false;

    const vendor = vendorMap.get(choice.vendorId);
    if (!vendor) {
      return !existingVendorIds.has(choice.vendorId) || choice.vendorId === 'custom';
    }
    return vendor.supportsMultipleAccounts || !existingVendorIds.has(choice.vendorId);
  });

  const handleAdd = async () => {
    if (!selectedType || !selectedChoice) return;

    const hasMinimax = existingVendorIds.has('minimax-portal') || existingVendorIds.has('minimax-portal-cn');
    if ((selectedType === 'minimax-portal' || selectedType === 'minimax-portal-cn') && hasMinimax) {
      toast.error(t('aiProviders.toast.minimaxConflict'));
      return;
    }

    setSaving(true);
    setValidationError(null);

    try {
      if (requiresApiKey && !apiKey.trim()) {
        setValidationError(t('aiProviders.toast.invalidKey'));
        setSaving(false);
        return;
      }
      if (requiresApiKey && apiKey.trim() && !selectedChoice.skipValidation) {
        const result = await onValidateKey(selectedType, apiKey, {
          baseUrl: baseUrl.trim() || undefined,
          apiProtocol: resolvedApiProtocol,
        });
        if (!result.valid) {
          setValidationError(result.error || t('aiProviders.toast.invalidKey'));
          setSaving(false);
          return;
        }
      }

      const requiresModel = showModelIdField;
      if (requiresModel && !effectiveModelId) {
        setValidationError(t('aiProviders.toast.modelRequired'));
        setSaving(false);
        return;
      }

      const { accountId } = await onAdd(
        selectedType,
        name || getSupportedProviderChoiceDisplayLabel(selectedChoice),
        apiKey.trim(),
        {
          baseUrl: baseUrl.trim() || selectedChoice.defaultBaseUrl || undefined,
          apiProtocol: resolvedApiProtocol,
          headers: effectiveHeaders,
          model: effectiveModelId,
          authMode: selectedChoice.authMode,
          metadata: {
            authChoiceId: selectedChoice.id,
            ...(selectedChoice.modelProviderKey ? { modelProviderKey: selectedChoice.modelProviderKey } : {}),
          },
        }
      );

      try {
        await syncProviderModelsToAccount({
          accountId,
          defaultModelId: selectedChoice.defaultModelId || typeInfo?.defaultModelId,
        });
        await useProviderStore.getState().refreshProviderSnapshot();
      } catch (error) {
        console.error('Failed to sync provider model catalog after add:', error);
      }
    } catch {
      // error already handled via toast in parent
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-3xl border-0 shadow-2xl bg-[#f3f1e9] dark:bg-card overflow-hidden">
        <CardHeader className="relative pb-2 shrink-0">
          <CardTitle className="text-2xl font-serif font-normal">{t('aiProviders.dialog.title')}</CardTitle>
          <CardDescription className="text-[15px] mt-1 text-foreground/70">
            {t('aiProviders.dialog.desc')}
          </CardDescription>
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-4 top-4 rounded-full h-8 w-8 -mr-2 -mt-2 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="overflow-y-auto flex-1 p-6">
          {!selectedChoice ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {availableChoices.map((choice) => {
                const choiceType = PROVIDER_TYPE_INFO.find((type) => type.id === choice.vendorId);
                const iconUrl = getProviderIconUrl(choice.vendorId);

                return (
                <button
                  key={choice.id}
                  onClick={() => {
                    setSelectedChoiceId(choice.id);
                    setName(getSupportedProviderChoiceDisplayLabel(choice));
                    setApiKey('');
                    setBaseUrl(choice.defaultBaseUrl || choiceType?.defaultBaseUrl || '');
                    setModelId(choice.defaultModelId || choiceType?.defaultModelId || '');
                    setApiProtocol(choice.apiProtocol || 'openai-completions');
                    setUserAgent('');
                    setShowKey(false);
                    setShowAdvancedConfig(false);
                    setArkMode('apikey');
                    setValidationError(null);
                    setOauthError(null);
                    setOauthData(null);
                    setOauthFlowing(false);
                    setManualCodeInput('');
                  }}
                  className="p-4 rounded-2xl border border-black/5 dark:border-white/5 hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-center group"
                >
                  <div className="h-12 w-12 mx-auto mb-3 flex items-center justify-center bg-black/5 dark:bg-white/5 rounded-xl shadow-sm border border-black/5 dark:border-white/5 group-hover:scale-105 transition-transform">
                    {iconUrl ? (
                      <img src={iconUrl} alt={choice.groupLabel} className={cn('h-6 w-6', shouldInvertInDark(choice.vendorId) && 'dark:invert')} />
                    ) : (
                      <span className="text-2xl">{choiceType?.icon || '•'}</span>
                    )}
                  </div>
                  <p className="font-medium text-[13px]">{getSupportedProviderChoiceDisplayLabel(choice)}</p>
                  {choice.hint && (
                    <p className="mt-1 text-[11px] text-muted-foreground line-clamp-2">{choice.hint}</p>
                  )}
                </button>
                );
              })}
              {choicesLoading && (
                <div className="col-span-full flex items-center justify-center py-8 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center gap-3 p-4 rounded-2xl bg-white dark:bg-card border border-black/5 dark:border-white/5 shadow-sm">
                <div className="h-10 w-10 shrink-0 flex items-center justify-center bg-black/5 dark:bg-white/5 rounded-xl">
                  {selectedType && getProviderIconUrl(selectedType) ? (
                    <img src={getProviderIconUrl(selectedType)} alt={typeInfo?.name} className={cn('h-6 w-6', shouldInvertInDark(selectedType) && 'dark:invert')} />
                  ) : (
                    <span className="text-xl">{typeInfo?.icon}</span>
                  )}
                </div>
                <div>
                  <p className="font-semibold text-[15px]">{getSupportedProviderChoiceDisplayLabel(selectedChoice)}</p>
                  <button
                  onClick={() => {
                    setSelectedChoiceId(null);
                    setApiKey('');
                    setValidationError(null);
                    setBaseUrl('');
                    setModelId('');
                    setUserAgent('');
                    setShowKey(false);
                    setShowAdvancedConfig(false);
                    setArkMode('apikey');
                    setOauthData(null);
                    setOauthFlowing(false);
                    setManualCodeInput('');
                    setOauthError(null);
                  }}
                  className="text-[13px] text-blue-500 hover:text-blue-600 font-medium"
                >
                    {t('aiProviders.dialog.change')}
                  </button>
                  {effectiveDocsUrl && (
                    <>
                      <span className="mx-2 text-foreground/20">|</span>
                      <a
                        href={effectiveDocsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[13px] text-blue-500 hover:text-blue-600 font-medium inline-flex items-center gap-1"
                      >
                        {t('aiProviders.dialog.customDoc')}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </>
                  )}
                </div>
              </div>

              <div className="space-y-6 bg-transparent p-0">
                <div className="space-y-2.5">
                  <Label htmlFor="name" className={labelClasses}>{t('aiProviders.dialog.displayName')}</Label>
                  <Input
                    id="name"
                    placeholder={typeInfo?.id === 'custom' ? t('aiProviders.custom') : typeInfo?.name}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className={inputClasses}
                  />
                </div>

                {/* Auth mode toggle for providers supporting both */}
                {/* API Key input */}
                {requiresApiKey && (
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="apiKey" className={labelClasses}>{t('aiProviders.dialog.apiKey')}</Label>
                      {typeInfo?.apiKeyUrl && (
                        <a
                          href={typeInfo.apiKeyUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[13px] text-blue-500 hover:text-blue-600 font-medium flex items-center gap-1"
                          tabIndex={-1}
                        >
                          {t('aiProviders.oauth.getApiKey')} <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    <div className="relative">
                      <Input
                        id="apiKey"
                        type={showKey ? 'text' : 'password'}
                        placeholder={typeInfo?.id === 'ollama' ? t('aiProviders.notRequired') : typeInfo?.placeholder}
                        value={apiKey}
                        onChange={(e) => {
                          setApiKey(e.target.value);
                          setValidationError(null);
                        }}
                        className={inputClasses}
                      />
                      <button
                        type="button"
                        onClick={() => setShowKey(!showKey)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    {validationError && (
                      <p className="text-[13px] text-red-500 font-medium">{validationError}</p>
                    )}
                    <p className="text-[12px] text-muted-foreground">
                      {t('aiProviders.dialog.apiKeyStored')}
                    </p>
                  </div>
                )}

                {typeInfo?.showBaseUrl && (
                  <div className="space-y-2.5">
                    <Label htmlFor="baseUrl" className={labelClasses}>{t('aiProviders.dialog.baseUrl')}</Label>
                    <Input
                      id="baseUrl"
                      placeholder={getProtocolBaseUrlPlaceholder(apiProtocol)}
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                      className={inputClasses}
                    />
                  </div>
                )}

                {showModelIdField && (
                  <div className="space-y-2.5">
                    <Label htmlFor="modelId" className={labelClasses}>{t('aiProviders.dialog.modelId')}</Label>
                    <Input
                      id="modelId"
                      placeholder={typeInfo?.modelIdPlaceholder || 'provider/model-id'}
                      value={modelId}
                      onChange={(e) => {
                        setModelId(e.target.value);
                        setValidationError(null);
                      }}
                      className={inputClasses}
                    />
                  </div>
                )}
                {selectedType === 'ark' && codePlanPreset && (
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label className={labelClasses}>{t('aiProviders.dialog.codePlanPreset')}</Label>
                      {typeInfo?.codePlanDocsUrl && (
                        <a
                          href={typeInfo.codePlanDocsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[13px] text-blue-500 hover:text-blue-600 font-medium inline-flex items-center gap-1"
                          tabIndex={-1}
                        >
                          {t('aiProviders.dialog.codePlanDoc')}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    <div className="flex gap-2 text-[13px]">
                      <button
                        type="button"
                        onClick={() => {
                          setArkMode('apikey');
                          setBaseUrl(typeInfo?.defaultBaseUrl || '');
                          if (modelId.trim() === codePlanPreset.modelId) {
                            setModelId(typeInfo?.defaultModelId || '');
                          }
                          setValidationError(null);
                        }}
                        className={cn("flex-1 py-1.5 px-3 rounded-lg border transition-colors", arkMode === 'apikey' ? "bg-white dark:bg-card border-black/20 dark:border-white/20 shadow-sm font-medium" : "border-transparent bg-black/5 dark:bg-white/5 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10")}
                      >
                        {t('aiProviders.authModes.apiKey')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setArkMode('codeplan');
                          setBaseUrl(codePlanPreset.baseUrl);
                          setModelId(codePlanPreset.modelId);
                          setValidationError(null);
                        }}
                        className={cn("flex-1 py-1.5 px-3 rounded-lg border transition-colors", arkMode === 'codeplan' ? "bg-white dark:bg-card border-black/20 dark:border-white/20 shadow-sm font-medium" : "border-transparent bg-black/5 dark:bg-white/5 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10")}
                      >
                        {t('aiProviders.dialog.codePlanMode')}
                      </button>
                    </div>
                    {arkMode === 'codeplan' && (
                      <p className="text-[12px] text-muted-foreground">
                        {t('aiProviders.dialog.codePlanPresetDesc')}
                      </p>
                    )}
                  </div>
                )}
                {selectedType === 'custom' && (
                <div className="space-y-2.5">
                  <Label className={labelClasses}>{t('aiProviders.dialog.protocol', 'Protocol')}</Label>
                  <div className="flex gap-2 text-[13px]">
                    <button
                      type="button"
                        onClick={() => setApiProtocol('openai-completions')}
                        className={cn("flex-1 py-1.5 px-3 rounded-lg border transition-colors", apiProtocol === 'openai-completions' ? "bg-white dark:bg-card border-black/20 dark:border-white/20 shadow-sm font-medium" : "border-transparent bg-black/5 dark:bg-white/5 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10")}
                    >
                      {t('aiProviders.protocols.openaiCompletions', 'OpenAI Completions')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setApiProtocol('openai-responses')}
                      className={cn("flex-1 py-1.5 px-3 rounded-lg border transition-colors", apiProtocol === 'openai-responses' ? "bg-white dark:bg-card border-black/20 dark:border-white/20 shadow-sm font-medium" : "border-transparent bg-black/5 dark:bg-white/5 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10")}
                    >
                      {t('aiProviders.protocols.openaiResponses', 'OpenAI Responses')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setApiProtocol('anthropic-messages')}
                      className={cn("flex-1 py-1.5 px-3 rounded-lg border transition-colors", apiProtocol === 'anthropic-messages' ? "bg-white dark:bg-card border-black/20 dark:border-white/20 shadow-sm font-medium" : "border-transparent bg-black/5 dark:bg-white/5 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10")}
                      >
                        {t('aiProviders.protocols.anthropic', 'Anthropic')}
                      </button>
                    </div>
                  </div>
                )}
                {showUserAgentInAddDialog && (
                  <div className="space-y-2.5">
                    <button
                      type="button"
                      onClick={() => setShowAdvancedConfig((value) => !value)}
                      className="flex items-center justify-between w-full text-[14px] font-bold text-foreground/80 hover:text-foreground transition-colors"
                    >
                      <span>{t('aiProviders.dialog.advancedConfig')}</span>
                      <ChevronDown className={cn("h-4 w-4 transition-transform", showAdvancedConfig && "rotate-180")} />
                    </button>
                    {showAdvancedConfig && (
                      <div className="space-y-2.5 pt-1">
                        <Label htmlFor="userAgent" className={labelClasses}>{t('aiProviders.dialog.userAgent')}</Label>
                        <Input
                          id="userAgent"
                          placeholder={t('aiProviders.dialog.userAgentPlaceholder')}
                          value={userAgent}
                          onChange={(e) => setUserAgent(e.target.value)}
                          className={inputClasses}
                        />
                      </div>
                    )}
                  </div>
                )}
                {/* Device OAuth Trigger — only shown when in OAuth mode */}
                {useOAuthFlow && (
                  <div className="space-y-4 pt-2">
                    <div className="rounded-xl bg-blue-500/10 border border-blue-500/20 p-5 text-center">
                      <p className="text-[13px] font-medium text-blue-600 dark:text-blue-400 mb-4 block">
                        {t('aiProviders.oauth.loginPrompt')}
                      </p>
                      <Button
                        onClick={handleStartOAuth}
                        disabled={oauthFlowing}
                        className="w-full rounded-full h-[42px] font-semibold bg-[#0a84ff] hover:bg-[#007aff] text-white shadow-sm"
                      >
                        {oauthFlowing ? (
                          <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{t('aiProviders.oauth.waiting')}</>
                        ) : (
                          t('aiProviders.oauth.loginButton')
                        )}
                      </Button>
                    </div>

                    {/* OAuth Active State Modal / Inline View */}
                    {oauthFlowing && (
                      <div className="mt-4 p-5 border border-black/10 dark:border-white/10 rounded-2xl bg-white dark:bg-card shadow-sm relative overflow-hidden">
                        {/* Background pulse effect */}
                        <div className="absolute inset-0 bg-blue-500/5 animate-pulse" />

                        <div className="relative z-10 flex flex-col items-center justify-center text-center space-y-5">
                          {oauthError ? (
                            <div className="text-red-500 space-y-3">
                              <XCircle className="h-10 w-10 mx-auto" />
                              <p className="font-semibold text-[15px]">{t('aiProviders.oauth.authFailed')}</p>
                              <p className="text-[13px] opacity-80">{oauthError}</p>
                              <Button variant="outline" size="sm" onClick={handleCancelOAuth} className="mt-2 rounded-full px-6 h-9">
                                Try Again
                              </Button>
                            </div>
                          ) : !oauthData ? (
                            <div className="space-y-4 py-6">
                              <Loader2 className="h-10 w-10 animate-spin text-blue-500 mx-auto" />
                              <p className="text-[13px] font-medium text-muted-foreground animate-pulse">{t('aiProviders.oauth.requestingCode')}</p>
                            </div>
                          ) : oauthData.mode === 'manual' ? (
                            <div className="space-y-4 w-full">
                              <div className="space-y-2">
                                <h3 className="font-semibold text-[16px] text-foreground">Complete OpenAI Login</h3>
                                <p className="text-[13px] text-muted-foreground text-left bg-black/5 dark:bg-white/5 p-4 rounded-xl">
                                  {oauthData.message || 'Open the authorization page, complete login, then paste the callback URL or code below.'}
                                </p>
                              </div>

                              <Button
                                variant="secondary"
                                className="w-full rounded-full h-[42px] font-semibold"
                                onClick={() => invokeIpc('shell:openExternal', oauthData.authorizationUrl)}
                              >
                                <ExternalLink className="h-4 w-4 mr-2" />
                                Open Authorization Page
                              </Button>

                              <Input
                                placeholder="Paste callback URL or code"
                                value={manualCodeInput}
                                onChange={(e) => setManualCodeInput(e.target.value)}
                                className={inputClasses}
                              />

                              <Button
                                className="w-full rounded-full h-[42px] font-semibold bg-[#0a84ff] hover:bg-[#007aff] text-white"
                                onClick={handleSubmitManualOAuthCode}
                                disabled={!manualCodeInput.trim()}
                              >
                                Submit Code
                              </Button>

                              <Button variant="ghost" className="w-full rounded-full h-[42px] font-semibold text-muted-foreground" onClick={handleCancelOAuth}>
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <div className="space-y-5 w-full">
                              <div className="space-y-2">
                                <h3 className="font-semibold text-[16px] text-foreground">{t('aiProviders.oauth.approveLogin')}</h3>
                                <div className="text-[13px] text-muted-foreground text-left mt-2 space-y-1.5 bg-black/5 dark:bg-white/5 p-4 rounded-xl">
                                  <p>1. {t('aiProviders.oauth.step1')}</p>
                                  <p>2. {t('aiProviders.oauth.step2')}</p>
                                  <p>3. {t('aiProviders.oauth.step3')}</p>
                                </div>
                              </div>

                              <div className="flex items-center justify-center gap-3 p-4 bg-[#eeece3] dark:bg-muted border border-black/5 dark:border-white/5 rounded-xl shadow-inner">
                                <code className="text-3xl font-mono tracking-[0.2em] font-bold text-foreground">
                                  {oauthData.userCode}
                                </code>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-10 w-10 rounded-full hover:bg-black/5 dark:hover:bg-white/10"
                                  onClick={() => {
                                    navigator.clipboard.writeText(oauthData.userCode);
                                    toast.success(t('aiProviders.oauth.codeCopied'));
                                  }}
                                >
                                  <Copy className="h-5 w-5" />
                                </Button>
                              </div>

                              <Button
                                variant="secondary"
                                className="w-full rounded-full h-[42px] font-semibold"
                                onClick={() => invokeIpc('shell:openExternal', oauthData.verificationUri)}
                              >
                                <ExternalLink className="h-4 w-4 mr-2" />
                                {t('aiProviders.oauth.openLoginPage')}
                              </Button>

                              <div className="flex items-center justify-center gap-2 text-[13px] font-medium text-muted-foreground pt-2">
                                <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                                <span>{t('aiProviders.oauth.waitingApproval')}</span>
                              </div>

                              <Button variant="ghost" className="w-full rounded-full h-[42px] font-semibold text-muted-foreground" onClick={handleCancelOAuth}>
                                Cancel
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <Separator className="bg-black/10 dark:bg-white/10" />

              <div className="flex justify-end gap-3">
                <Button
                  onClick={handleAdd}
                  className={cn("rounded-full px-8 h-[42px] text-[13px] font-semibold bg-[#0a84ff] hover:bg-[#007aff] text-white shadow-sm", useOAuthFlow && "hidden")}
                  disabled={!selectedChoice || saving || (showModelIdField && !effectiveModelId)}
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : null}
                  {t('aiProviders.dialog.add')}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
