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
): Promise<ProviderModelCatalogEntry[]> {
  const account = await getProviderAccount(accountId);
  if (!account) {
    throw new Error('Provider account not found');
  }

  const result = await gatewayManager.rpc<{ models?: ProviderModelCatalogEntry[] }>(
    'models.list',
    {},
  );
  const models = Array.isArray(result?.models) ? result.models : [];
  const providerKeys = new Set(resolveAccountProviderKeys(account));

  const filtered = models.filter((entry) => providerKeys.has(entry.provider));
  filtered.sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }) || left.id.localeCompare(right.id),
  );
  return filtered;
}
