import type { GatewayManager } from '../../gateway/manager';
import { getProviderAccount } from './provider-store';
import { getOpenClawProviderKeyForType } from '../../utils/provider-keys';

export interface ProviderModelCatalogEntry {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  reasoning?: boolean;
  input?: Array<'text' | 'image' | 'document'>;
}

const PROVIDER_MODEL_LIST_RETRIES = 6;
const PROVIDER_MODEL_LIST_DELAY_MS = 700;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveAccountProviderKeys(account: {
  id: string;
  vendorId: string;
  authMode: string;
  metadata?: {
    modelProviderKey?: string;
  };
}): string[] {
  const keys = new Set<string>();

  if (account.vendorId === 'google' && account.authMode === 'oauth_browser') {
    keys.add('google-gemini-cli');
  }
  if (account.vendorId === 'openai' && account.authMode === 'oauth_browser') {
    keys.add('openai-codex');
  }

  keys.add(getOpenClawProviderKeyForType(account.vendorId, account.id));
  if (account.metadata?.modelProviderKey?.trim()) {
    keys.add(account.metadata.modelProviderKey.trim());
  }
  return [...keys];
}

export async function listProviderModels(
  gatewayManager: GatewayManager,
  accountId: string,
  options?: {
    retries?: number;
    delayMs?: number;
  },
): Promise<ProviderModelCatalogEntry[]> {
  const account = await getProviderAccount(accountId);
  if (!account) {
    throw new Error('Provider account not found');
  }

  const providerKeys = new Set(resolveAccountProviderKeys(account));
  const retries = Math.max(1, options?.retries ?? PROVIDER_MODEL_LIST_RETRIES);
  const delayMs = Math.max(0, options?.delayMs ?? PROVIDER_MODEL_LIST_DELAY_MS);

  let lastError: unknown = null;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const result = await gatewayManager.rpc<{ models?: ProviderModelCatalogEntry[] }>(
        'models.list',
        {},
      );
      const models = Array.isArray(result?.models) ? result.models : [];
      const filtered = models.filter((entry) => providerKeys.has(entry.provider));

      if (filtered.length > 0 || attempt === retries - 1) {
        filtered.sort((left, right) =>
          left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }) || left.id.localeCompare(right.id),
        );
        return filtered;
      }
    } catch (error) {
      lastError = error;
      if (attempt === retries - 1) {
        throw error;
      }
    }

    await delay(delayMs);
  }

  if (lastError) {
    throw lastError;
  }
  return [];
}
