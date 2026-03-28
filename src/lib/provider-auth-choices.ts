import { hostApiFetch } from '@/lib/host-api';
import type {
  ProviderAccount,
  ProviderAuthMode,
  ProviderType,
} from '@/lib/providers';

export interface UpstreamProviderAuthChoiceOption {
  value: string;
  label: string;
  hint?: string;
}

export interface UpstreamProviderAuthChoiceGroup {
  value: string;
  label: string;
  hint?: string;
  options: UpstreamProviderAuthChoiceOption[];
}

type ProviderChoicePreset = {
  vendorId: ProviderType;
  authMode: ProviderAuthMode;
  defaultBaseUrl?: string;
  defaultModelId?: string;
  apiProtocol?: ProviderAccount['apiProtocol'];
  headers?: Record<string, string>;
  skipValidation?: boolean;
  modelProviderKey?: string;
};

export interface SupportedProviderChoice extends ProviderChoicePreset {
  id: string;
  label: string;
  hint?: string;
  groupId: string;
  groupLabel: string;
  groupHint?: string;
}

export interface ProviderOAuthStartPayload {
  provider: 'openai' | 'google' | 'minimax-portal' | 'minimax-portal-cn' | 'qwen-portal';
  region?: 'global' | 'cn';
}

const CHOICE_PRESETS: Record<string, ProviderChoicePreset> = {
  'openai-codex': { vendorId: 'openai', authMode: 'oauth_browser' },
  'openai-api-key': { vendorId: 'openai', authMode: 'api_key' },
  token: { vendorId: 'anthropic', authMode: 'api_key', skipValidation: true },
  apiKey: { vendorId: 'anthropic', authMode: 'api_key' },
  'minimax-global-oauth': { vendorId: 'minimax-portal', authMode: 'oauth_device' },
  'minimax-global-api': { vendorId: 'minimax-portal', authMode: 'api_key' },
  'minimax-cn-oauth': { vendorId: 'minimax-portal-cn', authMode: 'oauth_device' },
  'minimax-cn-api': { vendorId: 'minimax-portal-cn', authMode: 'api_key' },
  'moonshot-api-key': {
    vendorId: 'moonshot-global',
    authMode: 'api_key',
    defaultBaseUrl: 'https://api.moonshot.ai/v1',
    defaultModelId: 'kimi-k2.5',
  },
  'moonshot-api-key-cn': {
    vendorId: 'moonshot',
    authMode: 'api_key',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    defaultModelId: 'kimi-k2.5',
  },
  'kimi-code-api-key': {
    vendorId: 'kimi-code',
    authMode: 'api_key',
    defaultBaseUrl: 'https://api.kimi.com/coding/',
    defaultModelId: 'kimi-code',
    apiProtocol: 'anthropic-messages',
    headers: {
      'User-Agent': 'claude-code/0.1.0',
    },
  },
  'gemini-api-key': { vendorId: 'google', authMode: 'api_key' },
  'google-gemini-cli': { vendorId: 'google', authMode: 'oauth_browser' },
  'xai-api-key': { vendorId: 'xai', authMode: 'api_key' },
  'mistral-api-key': { vendorId: 'mistral', authMode: 'api_key' },
  'volcengine-api-key': {
    vendorId: 'volcengine',
    authMode: 'api_key',
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
    defaultModelId: 'ark-code-latest',
    modelProviderKey: 'volcengine-plan',
  },
  'byteplus-api-key': {
    vendorId: 'byteplus',
    authMode: 'api_key',
    defaultBaseUrl: 'https://ark.ap-southeast.bytepluses.com/api/coding/v3',
    defaultModelId: 'ark-code-latest',
    modelProviderKey: 'byteplus-plan',
  },
  'openrouter-api-key': { vendorId: 'openrouter', authMode: 'api_key' },
  'kilocode-api-key': {
    vendorId: 'kilocode',
    authMode: 'api_key',
    defaultBaseUrl: 'https://api.kilo.ai/api/gateway/',
    defaultModelId: 'kilo/auto',
  },
  'qwen-portal': { vendorId: 'qwen-portal', authMode: 'oauth_device' },
  'zai-coding-global': {
    vendorId: 'zai',
    authMode: 'api_key',
    defaultBaseUrl: 'https://api.z.ai/api/coding/paas/v4',
    defaultModelId: 'glm-5',
  },
  'zai-coding-cn': {
    vendorId: 'zai',
    authMode: 'api_key',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    defaultModelId: 'glm-5',
  },
  'zai-global': {
    vendorId: 'zai',
    authMode: 'api_key',
    defaultBaseUrl: 'https://api.z.ai/api/paas/v4',
    defaultModelId: 'glm-5',
  },
  'zai-cn': {
    vendorId: 'zai',
    authMode: 'api_key',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModelId: 'glm-5',
  },
  'qianfan-api-key': { vendorId: 'qianfan', authMode: 'api_key' },
  'modelstudio-api-key-cn': {
    vendorId: 'modelstudio',
    authMode: 'api_key',
    defaultBaseUrl: 'https://coding.dashscope.aliyuncs.com/v1',
    defaultModelId: 'qwen3.5-plus',
  },
  'modelstudio-api-key': {
    vendorId: 'modelstudio',
    authMode: 'api_key',
    defaultBaseUrl: 'https://coding-intl.dashscope.aliyuncs.com/v1',
    defaultModelId: 'qwen3.5-plus',
  },
  'ai-gateway-api-key': {
    vendorId: 'vercel-ai-gateway',
    authMode: 'api_key',
    defaultBaseUrl: 'https://ai-gateway.vercel.sh',
    defaultModelId: 'anthropic/claude-opus-4.6',
    apiProtocol: 'anthropic-messages',
  },
  'xiaomi-api-key': { vendorId: 'xiaomi', authMode: 'api_key' },
  'synthetic-api-key': {
    vendorId: 'synthetic',
    authMode: 'api_key',
    apiProtocol: 'anthropic-messages',
  },
  'together-api-key': { vendorId: 'together', authMode: 'api_key' },
  'huggingface-api-key': { vendorId: 'huggingface', authMode: 'api_key' },
  'venice-api-key': { vendorId: 'venice', authMode: 'api_key' },
  'litellm-api-key': { vendorId: 'litellm', authMode: 'api_key' },
  'custom-api-key': { vendorId: 'custom', authMode: 'api_key' },
  ollama: { vendorId: 'ollama', authMode: 'local' },
  sglang: { vendorId: 'sglang', authMode: 'local' },
  vllm: { vendorId: 'vllm', authMode: 'local' },
};

export async function fetchProviderAuthChoiceGroups(): Promise<UpstreamProviderAuthChoiceGroup[]> {
  const result = await hostApiFetch<{
    groups?: UpstreamProviderAuthChoiceGroup[];
  }>('/api/provider-auth-choices');

  return Array.isArray(result?.groups) ? result.groups : [];
}

export function flattenSupportedProviderChoices(
  groups: UpstreamProviderAuthChoiceGroup[],
): SupportedProviderChoice[] {
  const supported: SupportedProviderChoice[] = [];

  for (const group of groups) {
    for (const option of group.options ?? []) {
      const preset = CHOICE_PRESETS[option.value];
      if (!preset) {
        continue;
      }

      supported.push({
        id: option.value,
        label: option.label,
        ...(option.hint ? { hint: option.hint } : {}),
        groupId: group.value,
        groupLabel: group.label,
        ...(group.hint ? { groupHint: group.hint } : {}),
        ...preset,
      });
    }
  }

  return supported;
}

export function resolveProviderChoiceFromAccount(
  account: Pick<ProviderAccount, 'vendorId' | 'authMode' | 'baseUrl' | 'metadata'>,
): string | null {
  const storedChoiceId = account.metadata?.authChoiceId?.trim();
  if (storedChoiceId && CHOICE_PRESETS[storedChoiceId]) {
    return storedChoiceId;
  }

  if (account.vendorId === 'openai') {
    return account.authMode === 'oauth_browser' ? 'openai-codex' : 'openai-api-key';
  }
  if (account.vendorId === 'google') {
    return account.authMode === 'oauth_browser' ? 'google-gemini-cli' : 'gemini-api-key';
  }
  if (account.vendorId === 'anthropic') {
    return 'apiKey';
  }
  if (account.vendorId === 'minimax-portal') {
    return account.authMode === 'oauth_device' ? 'minimax-global-oauth' : 'minimax-global-api';
  }
  if (account.vendorId === 'minimax-portal-cn') {
    return account.authMode === 'oauth_device' ? 'minimax-cn-oauth' : 'minimax-cn-api';
  }
  if (account.vendorId === 'moonshot-global') {
    return 'moonshot-api-key';
  }
  if (account.vendorId === 'moonshot') {
    return 'moonshot-api-key-cn';
  }
  if (account.vendorId === 'kimi-code') {
    return 'kimi-code-api-key';
  }
  if (account.vendorId === 'qwen-portal') {
    return 'qwen-portal';
  }
  if (account.vendorId === 'zai') {
    const baseUrl = account.baseUrl?.trim() ?? '';
    if (baseUrl.includes('/api/coding/paas/v4')) {
      return baseUrl.includes('open.bigmodel.cn') ? 'zai-coding-cn' : 'zai-coding-global';
    }
    return baseUrl.includes('open.bigmodel.cn') ? 'zai-cn' : 'zai-global';
  }
  if (account.vendorId === 'modelstudio') {
    return account.baseUrl?.includes('coding.dashscope.aliyuncs.com')
      ? 'modelstudio-api-key-cn'
      : 'modelstudio-api-key';
  }

  const fallbackMap: Partial<Record<ProviderType, string>> = {
    xai: 'xai-api-key',
    mistral: 'mistral-api-key',
    volcengine: 'volcengine-api-key',
    byteplus: 'byteplus-api-key',
    openrouter: 'openrouter-api-key',
    kilocode: 'kilocode-api-key',
    qianfan: 'qianfan-api-key',
    'vercel-ai-gateway': 'ai-gateway-api-key',
    xiaomi: 'xiaomi-api-key',
    synthetic: 'synthetic-api-key',
    together: 'together-api-key',
    huggingface: 'huggingface-api-key',
    venice: 'venice-api-key',
    litellm: 'litellm-api-key',
    custom: 'custom-api-key',
    ollama: 'ollama',
    sglang: 'sglang',
    vllm: 'vllm',
  };

  return fallbackMap[account.vendorId] ?? null;
}

export function resolveProviderOAuthStartPayload(
  choice: Pick<SupportedProviderChoice, 'id' | 'authMode'>,
): ProviderOAuthStartPayload | null {
  if (choice.authMode !== 'oauth_device' && choice.authMode !== 'oauth_browser') {
    return null;
  }

  switch (choice.id) {
    case 'openai-codex':
      return { provider: 'openai' };
    case 'google-gemini-cli':
      return { provider: 'google' };
    case 'minimax-global-oauth':
      return { provider: 'minimax-portal', region: 'global' };
    case 'minimax-cn-oauth':
      return { provider: 'minimax-portal-cn', region: 'cn' };
    case 'qwen-portal':
      return { provider: 'qwen-portal' };
    default:
      return null;
  }
}

export function getSupportedProviderChoiceDisplayLabel(
  choice: Pick<SupportedProviderChoice, 'groupLabel' | 'label'>,
): string {
  return choice.groupLabel === choice.label
    ? choice.label
    : `${choice.groupLabel} - ${choice.label}`;
}
