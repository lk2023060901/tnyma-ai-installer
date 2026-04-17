import type { GatewayManager } from '../../gateway/manager';
import { getProviderAccount } from './provider-store';
import { getOpenClawProviderKeyForType } from '../../utils/provider-keys';
import { getProviderSecret } from '../secrets/secret-store';
import { proxyAwareFetch } from '../../utils/proxy-fetch';

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
  baseUrl?: string;
  apiProtocol?: string;
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

function normalizeProviderModelsBaseUrl(
  baseUrl: string,
  apiProtocol: string | undefined,
): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  if (apiProtocol === 'openai-responses') {
    return normalized.replace(/\/responses?$/i, '');
  }
  if (apiProtocol === 'openai-completions') {
    return normalized.replace(/\/chat\/completions$/i, '');
  }
  if (apiProtocol === 'anthropic-messages') {
    return normalized.replace(/\/v1\/messages$/i, '').replace(/\/messages$/i, '');
  }
  return normalized;
}

function buildDirectModelsUrls(
  baseUrl: string,
  apiProtocol: string | undefined,
): string[] {
  const rootBase = normalizeProviderModelsBaseUrl(baseUrl, apiProtocol);
  if (apiProtocol === 'anthropic-messages') {
    const anthropicBase = rootBase.endsWith('/v1') ? rootBase : `${rootBase}/v1`;
    return [`${anthropicBase}/models?limit=200`];
  }

  const urls = new Set<string>();
  urls.add(`${rootBase}/models?limit=200`);

  if (!/\/v\d+(\/|$)/i.test(rootBase) && !/\/models$/i.test(rootBase)) {
    urls.add(`${rootBase}/v1/models?limit=200`);
  }

  return [...urls];
}

function parseDirectModelCatalog(
  payload: unknown,
  provider: string,
): ProviderModelCatalogEntry[] {
  const container = payload as
    | { data?: Array<Record<string, unknown>>; models?: Array<Record<string, unknown>>; items?: Array<Record<string, unknown>> }
    | null
    | undefined;
  const source = Array.isArray(container?.data)
    ? container.data
    : Array.isArray(container?.models)
      ? container.models
      : Array.isArray(container?.items)
        ? container.items
        : [];

  const seen = new Set<string>();
  const models: ProviderModelCatalogEntry[] = [];
  for (const entry of source) {
    const idValue = typeof entry.id === 'string'
      ? entry.id.trim()
      : (typeof entry.name === 'string' ? entry.name.trim() : '');
    if (!idValue || seen.has(idValue)) {
      continue;
    }
    seen.add(idValue);
    models.push({
      id: idValue,
      name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : idValue,
      provider,
      ...(typeof entry.context_window === 'number' ? { contextWindow: entry.context_window } : {}),
      ...(typeof entry.contextWindow === 'number' ? { contextWindow: entry.contextWindow } : {}),
    });
  }
  models.sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }) || left.id.localeCompare(right.id),
  );
  return models;
}

function sortProviderModels(
  models: ProviderModelCatalogEntry[],
): ProviderModelCatalogEntry[] {
  models.sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }) || left.id.localeCompare(right.id),
  );
  return models;
}

function mergeProviderModelCatalogs(
  primary: ProviderModelCatalogEntry[],
  secondary: ProviderModelCatalogEntry[],
): ProviderModelCatalogEntry[] {
  const merged = new Map<string, ProviderModelCatalogEntry>();

  for (const entry of secondary) {
    merged.set(entry.id, entry);
  }
  for (const entry of primary) {
    merged.set(entry.id, entry);
  }

  return sortProviderModels([...merged.values()]);
}

async function listCustomProviderModelsDirect(account: {
  id: string;
  vendorId: string;
  baseUrl?: string;
  apiProtocol?: string;
}): Promise<ProviderModelCatalogEntry[]> {
  if (account.vendorId !== 'custom' || !account.baseUrl?.trim()) {
    return [];
  }

  const secret = await getProviderSecret(account.id);
  const apiKey = secret?.type === 'api_key'
    ? secret.apiKey
    : (secret?.type === 'local' ? secret.apiKey : undefined);
  if (!apiKey?.trim()) {
    return [];
  }

  const providerKey = getOpenClawProviderKeyForType(account.vendorId, account.id);
  const urls = buildDirectModelsUrls(account.baseUrl, account.apiProtocol);
  const headers: Record<string, string> = {};
  if (account.apiProtocol === 'anthropic-messages') {
    headers['x-api-key'] = apiKey.trim();
    headers['anthropic-version'] = '2023-06-01';
  } else {
    headers.Authorization = `Bearer ${apiKey.trim()}`;
  }

  let lastError: Error | null = null;
  for (const url of urls) {
    const response = await proxyAwareFetch(url, { headers });
    if (!response.ok) {
      lastError = new Error(`Failed to load direct model catalog from ${url}: HTTP ${response.status}`);
      continue;
    }

    const payload = await response.json().catch(() => null);
    if (!payload) {
      lastError = new Error(`Failed to parse direct model catalog from ${url}`);
      continue;
    }

    const models = parseDirectModelCatalog(payload, providerKey);
    if (models.length > 0) {
      return models;
    }
  }

  if (lastError) {
    throw lastError;
  }
  return [];
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

      if (account.vendorId === 'custom') {
        let directModels: ProviderModelCatalogEntry[] = [];
        try {
          directModels = await listCustomProviderModelsDirect(account);
        } catch (error) {
          lastError = error;
          if (filtered.length === 0 && attempt === retries - 1) {
            throw error;
          }
        }

        const merged = mergeProviderModelCatalogs(directModels, filtered);
        if (merged.length > 0 || attempt === retries - 1) {
          return merged;
        }
      }

      if (filtered.length > 0 || attempt === retries - 1) {
        return sortProviderModels(filtered);
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
