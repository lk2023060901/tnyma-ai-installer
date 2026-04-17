import type { ProviderAccount } from '@/lib/providers';
import { hostApiFetch } from '@/lib/host-api';
import { waitForGatewayReady } from '@/lib/gateway-ready';

export interface ProviderModelCatalogEntry {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  reasoning?: boolean;
  input?: Array<'text' | 'image' | 'document'>;
}

const PROVIDER_MODELS_HEALTH_RETRIES = 10;
const PROVIDER_MODELS_HEALTH_DELAY_MS = 800;
const PROVIDER_MODELS_FETCH_RETRIES = 8;
const PROVIDER_MODELS_FETCH_WAIT_TIMEOUT_MS = 10_000;
const OAUTH_PROVIDER_MODEL_CATALOG_VENDOR_IDS = new Set([
  'google',
  'openai',
]);

export function supportsProviderModelCatalog(
  account: Pick<ProviderAccount, 'authMode' | 'vendorId' | 'metadata'> | null | undefined,
): boolean {
  if (!account) {
    return false;
  }

  if (account.authMode !== 'oauth_browser') {
    return true;
  }

  if (account.metadata?.modelProviderKey?.trim()) {
    return true;
  }

  return OAUTH_PROVIDER_MODEL_CATALOG_VENDOR_IDS.has(account.vendorId);
}

export function requiresManualProviderModelEntry(
  account: Pick<ProviderAccount, 'authMode' | 'vendorId' | 'metadata'> | null | undefined,
): boolean {
  return !supportsProviderModelCatalog(account);
}

export function getStoredProviderModels(
  account: Pick<ProviderAccount, 'authMode' | 'vendorId' | 'metadata'> | null | undefined,
): ProviderModelCatalogEntry[] {
  if (!supportsProviderModelCatalog(account)) {
    return [];
  }
  return (account?.metadata?.customModels ?? []).map((id) => ({
    id,
    name: id,
    provider: '',
  }));
}

export function resolvePreferredProviderModelId(params: {
  currentModel?: string;
  defaultModelId?: string;
  models: ProviderModelCatalogEntry[];
}): string | undefined {
  const currentModel = params.currentModel?.trim();
  if (currentModel) {
    return currentModel;
  }

  const defaultModelId = params.defaultModelId?.trim();
  if (defaultModelId && params.models.some((model) => model.id === defaultModelId)) {
    return defaultModelId;
  }

  return params.models[0]?.id;
}

export async function ensureGatewayReadyForProviderModels(): Promise<void> {
  await waitForGatewayReady({
    retries: PROVIDER_MODELS_HEALTH_RETRIES,
    intervalMs: PROVIDER_MODELS_HEALTH_DELAY_MS,
    startIfNeeded: true,
  });
}

export async function fetchProviderModels(
  accountId: string,
): Promise<ProviderModelCatalogEntry[]> {
  const result = await hostApiFetch<{
    models?: ProviderModelCatalogEntry[];
    error?: string;
  }>(`/api/provider-models/${encodeURIComponent(accountId)}`);
  if (result.error) {
    throw new Error(result.error);
  }
  return Array.isArray(result.models) ? result.models : [];
}

async function waitForGatewayStableForProviderModels(): Promise<void> {
  const result = await hostApiFetch<{ success: boolean; error?: string }>(
    '/api/gateway/wait-until-stable',
    {
      method: 'POST',
      body: JSON.stringify({
        timeoutMs: PROVIDER_MODELS_FETCH_WAIT_TIMEOUT_MS,
      }),
    },
  );
  if (!result.success) {
    throw new Error(result.error || 'Gateway did not become stable');
  }
}

function shouldRetryProviderModelsFetch(error: unknown): boolean {
  const message = String(error).toLowerCase();
  return message.includes('gateway not connected')
    || message.includes('gateway is not ready')
    || message.includes('gateway is stopped')
    || message.includes('gateway is starting')
    || message.includes('gateway is reconnecting');
}

async function fetchProviderModelsWithRetry(
  accountId: string,
): Promise<ProviderModelCatalogEntry[]> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < PROVIDER_MODELS_FETCH_RETRIES; attempt += 1) {
    try {
      return await fetchProviderModels(accountId);
    } catch (error) {
      lastError = error;
      if (!shouldRetryProviderModelsFetch(error) || attempt === PROVIDER_MODELS_FETCH_RETRIES - 1) {
        throw error;
      }
      await waitForGatewayStableForProviderModels();
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function syncProviderModelsToAccount(params: {
  accountId: string;
  defaultModelId?: string;
}): Promise<{
  models: ProviderModelCatalogEntry[];
  selectedModelId?: string;
}> {
  await ensureGatewayReadyForProviderModels();
  const account = await hostApiFetch<ProviderAccount | null>(
    `/api/provider-accounts/${encodeURIComponent(params.accountId)}`,
  );
  if (!account) {
    throw new Error('Provider account not found');
  }
  if (!supportsProviderModelCatalog(account)) {
    return {
      models: [],
      selectedModelId: account.model?.trim() || params.defaultModelId?.trim(),
    };
  }

  const models = await fetchProviderModelsWithRetry(params.accountId);
  if (models.length === 0) {
    return { models: [], selectedModelId: account.model };
  }

  const selectedModelId = resolvePreferredProviderModelId({
    currentModel: account.model,
    defaultModelId: params.defaultModelId,
    models,
  });

  const saveResult = await hostApiFetch<{ success: boolean; error?: string }>(
    `/api/provider-accounts/${encodeURIComponent(params.accountId)}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        updates: {
          model: selectedModelId,
          metadata: {
            ...(account.metadata ?? {}),
            customModels: models.map((model) => model.id),
          },
        },
      }),
    },
  );
  if (!saveResult.success) {
    throw new Error(saveResult.error || 'Failed to save provider models');
  }

  return { models, selectedModelId };
}
