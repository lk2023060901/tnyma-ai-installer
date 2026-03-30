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

export function getStoredProviderModels(
  account: Pick<ProviderAccount, 'metadata'> | null | undefined,
): ProviderModelCatalogEntry[] {
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

  const models = await fetchProviderModels(params.accountId);
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
