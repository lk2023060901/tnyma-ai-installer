/**
 * Provider Types & UI Metadata — single source of truth for the frontend.
 *
 * NOTE: Backend provider metadata is being refactored toward the new
 * account-based registry, but the renderer still keeps a local compatibility
 * layer so TypeScript project boundaries remain stable during the migration.
 */

export const PROVIDER_TYPES = [
  'anthropic',
  'openai',
  'google',
  'openrouter',
  'ark',
  'volcengine',
  'byteplus',
  'moonshot',
  'moonshot-global',
  'kimi-code',
  'siliconflow',
  'minimax-portal',
  'minimax-portal-cn',
  'qwen-portal',
  'xai',
  'mistral',
  'kilocode',
  'zai',
  'qianfan',
  'modelstudio',
  'vercel-ai-gateway',
  'xiaomi',
  'synthetic',
  'together',
  'huggingface',
  'venice',
  'litellm',
  'sglang',
  'vllm',
  'ollama',
  'custom',
] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

export const BUILTIN_PROVIDER_TYPES = [
  'anthropic',
  'openai',
  'google',
  'openrouter',
  'ark',
  'volcengine',
  'byteplus',
  'moonshot',
  'moonshot-global',
  'kimi-code',
  'siliconflow',
  'minimax-portal',
  'minimax-portal-cn',
  'qwen-portal',
  'xai',
  'mistral',
  'kilocode',
  'zai',
  'qianfan',
  'modelstudio',
  'vercel-ai-gateway',
  'xiaomi',
  'synthetic',
  'together',
  'huggingface',
  'venice',
  'litellm',
  'sglang',
  'vllm',
  'ollama',
] as const;

export const OLLAMA_PLACEHOLDER_API_KEY = 'ollama-local';

export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl?: string;
  apiProtocol?: 'openai-completions' | 'openai-responses' | 'anthropic-messages';
  headers?: Record<string, string>;
  model?: string;
  fallbackModels?: string[];
  fallbackProviderIds?: string[];
  metadata?: ProviderAccount['metadata'];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderWithKeyInfo extends ProviderConfig {
  hasKey: boolean;
  keyMasked: string | null;
}

export interface ProviderTypeInfo {
  id: ProviderType;
  name: string;
  icon: string;
  placeholder: string;
  model?: string;
  requiresApiKey: boolean;
  defaultBaseUrl?: string;
  showBaseUrl?: boolean;
  showModelId?: boolean;
  showModelIdInDevModeOnly?: boolean;
  modelIdPlaceholder?: string;
  defaultModelId?: string;
  isOAuth?: boolean;
  supportsApiKey?: boolean;
  apiKeyUrl?: string;
  docsUrl?: string;
  docsUrlZh?: string;
  codePlanPresetBaseUrl?: string;
  codePlanPresetModelId?: string;
  codePlanDocsUrl?: string;
}

export type ProviderAuthMode =
  | 'api_key'
  | 'oauth_device'
  | 'oauth_browser'
  | 'local';

export type ProviderVendorCategory =
  | 'official'
  | 'compatible'
  | 'local'
  | 'custom';

export interface ProviderVendorInfo extends ProviderTypeInfo {
  category: ProviderVendorCategory;
  envVar?: string;
  supportedAuthModes: ProviderAuthMode[];
  defaultAuthMode: ProviderAuthMode;
  supportsMultipleAccounts: boolean;
}

export interface ProviderAccount {
  id: string;
  vendorId: ProviderType;
  label: string;
  authMode: ProviderAuthMode;
  baseUrl?: string;
  apiProtocol?: 'openai-completions' | 'openai-responses' | 'anthropic-messages';
  headers?: Record<string, string>;
  model?: string;
  fallbackModels?: string[];
  fallbackAccountIds?: string[];
  enabled: boolean;
  isDefault: boolean;
  metadata?: {
    region?: string;
    email?: string;
    resourceUrl?: string;
    authChoiceId?: string;
    modelProviderKey?: string;
    customModels?: string[];
  };
  createdAt: string;
  updatedAt: string;
}

import { providerIcons } from '@/assets/providers';

/** All supported provider types with UI metadata */
export const PROVIDER_TYPE_INFO: ProviderTypeInfo[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    icon: '🤖',
    placeholder: 'sk-ant-api03-...',
    model: 'Claude',
    requiresApiKey: true,
    docsUrl: 'https://platform.claude.com/docs/en/api/overview',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    icon: '💚',
    placeholder: 'sk-proj-...',
    model: 'GPT',
    requiresApiKey: true,
    isOAuth: true,
    supportsApiKey: true,
    apiKeyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'google',
    name: 'Google',
    icon: '🔷',
    placeholder: 'AIza...',
    model: 'Gemini',
    requiresApiKey: true,
    isOAuth: true,
    supportsApiKey: true,
    defaultModelId: 'gemini-3.1-pro-preview',
    apiKeyUrl: 'https://aistudio.google.com/app/apikey',
  },
  { id: 'openrouter', name: 'OpenRouter', icon: '🌐', placeholder: 'sk-or-v1-...', model: 'Multi-Model', requiresApiKey: true, showModelId: true, modelIdPlaceholder: 'openai/gpt-5.4', defaultModelId: 'openai/gpt-5.4', docsUrl: 'https://openrouter.ai/models' },
  { id: 'minimax-portal-cn', name: 'MiniMax (CN)', icon: '☁️', placeholder: 'sk-...', model: 'MiniMax', requiresApiKey: false, isOAuth: true, supportsApiKey: true, defaultModelId: 'MiniMax-M2.5', apiKeyUrl: 'https://platform.minimaxi.com/' },
  { id: 'volcengine', name: 'Volcano Engine', icon: 'V', placeholder: 'your-volcengine-api-key', model: 'Doubao Code', requiresApiKey: true, defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3', defaultModelId: 'ark-code-latest', docsUrl: 'https://www.volcengine.com/docs/82379/1928261?lang=zh' },
  { id: 'moonshot', name: 'Moonshot (CN)', icon: '🌙', placeholder: 'sk-...', model: 'Kimi', requiresApiKey: true, defaultBaseUrl: 'https://api.moonshot.cn/v1', defaultModelId: 'kimi-k2.5', docsUrl: 'https://platform.moonshot.cn/' },
  { id: 'moonshot-global', name: 'Moonshot', icon: '🌙', placeholder: 'sk-...', model: 'Kimi', requiresApiKey: true, defaultBaseUrl: 'https://api.moonshot.ai/v1', defaultModelId: 'kimi-k2.5', docsUrl: 'https://platform.moonshot.ai/' },
  { id: 'kimi-code', name: 'Kimi Code', icon: 'K', placeholder: 'sk-...', model: 'Kimi Code', requiresApiKey: true, defaultBaseUrl: 'https://api.kimi.com/coding/', defaultModelId: 'kimi-code', docsUrl: 'https://platform.moonshot.ai/' },
  { id: 'siliconflow', name: 'SiliconFlow (CN)', icon: '🌊', placeholder: 'sk-...', model: 'Multi-Model', requiresApiKey: true, defaultBaseUrl: 'https://api.siliconflow.cn/v1', showModelId: true, modelIdPlaceholder: 'deepseek-ai/DeepSeek-V3', defaultModelId: 'deepseek-ai/DeepSeek-V3', docsUrl: 'https://docs.siliconflow.cn/cn/userguide/introduction' },
  { id: 'minimax-portal', name: 'MiniMax (Global)', icon: '☁️', placeholder: 'sk-...', model: 'MiniMax', requiresApiKey: false, isOAuth: true, supportsApiKey: true, defaultModelId: 'MiniMax-M2.5', apiKeyUrl: 'https://intl.minimaxi.com/' },
  { id: 'qwen-portal', name: 'Qwen (Global)', icon: '☁️', placeholder: 'sk-...', model: 'Qwen', requiresApiKey: false, isOAuth: true, defaultModelId: 'coder-model' },
  { id: 'xai', name: 'xAI (Grok)', icon: '𝕏', placeholder: 'xai-...', model: 'Grok', requiresApiKey: true, defaultBaseUrl: 'https://api.x.ai/v1', defaultModelId: 'grok-4', docsUrl: 'https://docs.x.ai/docs/api-reference' },
  { id: 'mistral', name: 'Mistral AI', icon: 'M', placeholder: 'mistral-...', model: 'Mistral', requiresApiKey: true, defaultBaseUrl: 'https://api.mistral.ai/v1', defaultModelId: 'mistral-large-latest', docsUrl: 'https://docs.mistral.ai/' },
  { id: 'byteplus', name: 'BytePlus', icon: 'B', placeholder: 'byteplus-...', model: 'BytePlus Code', requiresApiKey: true, defaultBaseUrl: 'https://ark.ap-southeast.bytepluses.com/api/coding/v3', defaultModelId: 'ark-code-latest', docsUrl: 'https://docs.byteplus.com/' },
  { id: 'kilocode', name: 'Kilo Gateway', icon: 'K', placeholder: 'sk-...', model: 'Gateway', requiresApiKey: true, defaultBaseUrl: 'https://api.kilo.ai/api/gateway/', defaultModelId: 'kilo/auto', docsUrl: 'https://docs.kilo.ai/' },
  { id: 'zai', name: 'Z.AI', icon: 'Z', placeholder: 'zai-...', model: 'GLM', requiresApiKey: true, defaultBaseUrl: 'https://api.z.ai/api/paas/v4', defaultModelId: 'glm-5', showBaseUrl: true, docsUrl: 'https://docs.z.ai/' },
  { id: 'qianfan', name: 'Qianfan', icon: '千', placeholder: 'qf-...', model: 'Qianfan', requiresApiKey: true, defaultBaseUrl: 'https://qianfan.baidubce.com/v2', defaultModelId: 'deepseek-v3.2', docsUrl: 'https://cloud.baidu.com/doc/WENXINWORKSHOP/index.html' },
  { id: 'modelstudio', name: 'Alibaba Cloud Model Studio', icon: 'Q', placeholder: 'sk-...', model: 'Qwen', requiresApiKey: true, defaultBaseUrl: 'https://coding-intl.dashscope.aliyuncs.com/v1', defaultModelId: 'qwen3.5-plus', showBaseUrl: true, docsUrl: 'https://www.alibabacloud.com/help/en/model-studio/' },
  { id: 'vercel-ai-gateway', name: 'Vercel AI Gateway', icon: 'V', placeholder: 'vgw-...', model: 'Gateway', requiresApiKey: true, defaultBaseUrl: 'https://ai-gateway.vercel.sh', defaultModelId: 'anthropic/claude-opus-4.6', docsUrl: 'https://vercel.com/docs/ai-gateway' },
  { id: 'xiaomi', name: 'Xiaomi', icon: 'X', placeholder: 'sk-...', model: 'MiMo', requiresApiKey: true, defaultBaseUrl: 'https://api.xiaomimimo.com/v1', defaultModelId: 'mimo-v2-flash', docsUrl: 'https://platform.miliao.com/' },
  { id: 'synthetic', name: 'Synthetic', icon: 'S', placeholder: 'synthetic-...', model: 'Anthropic-compatible', requiresApiKey: true, defaultBaseUrl: 'https://api.synthetic.new/anthropic', defaultModelId: 'hf:MiniMaxAI/MiniMax-M2.5', docsUrl: 'https://docs.synthetic.new/' },
  { id: 'together', name: 'Together AI', icon: 'T', placeholder: 'together-...', model: 'Multi-Model', requiresApiKey: true, defaultBaseUrl: 'https://api.together.xyz/v1', defaultModelId: 'moonshotai/Kimi-K2.5', docsUrl: 'https://docs.together.ai/' },
  { id: 'huggingface', name: 'Hugging Face', icon: '🤗', placeholder: 'hf_...', model: 'Multi-Model', requiresApiKey: true, defaultBaseUrl: 'https://router.huggingface.co/v1', defaultModelId: 'deepseek-ai/DeepSeek-R1', docsUrl: 'https://huggingface.co/docs/inference-providers/index' },
  { id: 'venice', name: 'Venice AI', icon: 'V', placeholder: 'venice-...', model: 'Venice', requiresApiKey: true, defaultBaseUrl: 'https://api.venice.ai/api/v1', defaultModelId: 'kimi-k2-5', docsUrl: 'https://docs.venice.ai/' },
  { id: 'litellm', name: 'LiteLLM', icon: 'L', placeholder: 'sk-...', model: 'Gateway', requiresApiKey: true, defaultBaseUrl: 'http://localhost:4000', defaultModelId: 'claude-opus-4-6', showBaseUrl: true, docsUrl: 'https://docs.litellm.ai/' },
  { id: 'sglang', name: 'SGLang', icon: 'S', placeholder: 'Not required', model: 'Self-hosted', requiresApiKey: false, defaultBaseUrl: 'http://127.0.0.1:30000/v1', showBaseUrl: true, showModelId: true, modelIdPlaceholder: 'Qwen/Qwen3-8B', docsUrl: 'https://docs.sglang.ai/' },
  { id: 'vllm', name: 'vLLM', icon: 'v', placeholder: 'Not required', model: 'Self-hosted', requiresApiKey: false, defaultBaseUrl: 'http://127.0.0.1:8000/v1', showBaseUrl: true, showModelId: true, modelIdPlaceholder: 'meta-llama/Meta-Llama-3-8B-Instruct', docsUrl: 'https://docs.vllm.ai/' },
  { id: 'ark', name: 'ByteDance Ark', icon: 'A', placeholder: 'your-ark-api-key', model: 'Doubao', requiresApiKey: true, defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3', showBaseUrl: true, showModelId: true, modelIdPlaceholder: 'ep-20260228000000-xxxxx', docsUrl: 'https://www.volcengine.com/', codePlanPresetBaseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3', codePlanPresetModelId: 'ark-code-latest', codePlanDocsUrl: 'https://www.volcengine.com/docs/82379/1928261?lang=zh' },
  { id: 'ollama', name: 'Ollama', icon: '🦙', placeholder: 'Not required', requiresApiKey: false, defaultBaseUrl: 'http://localhost:11434/v1', showBaseUrl: true, showModelId: true, modelIdPlaceholder: 'qwen3:latest' },
  {
    id: 'custom',
    name: 'Custom',
    icon: '⚙️',
    placeholder: 'API key...',
    requiresApiKey: true,
    showBaseUrl: true,
    showModelId: true,
    modelIdPlaceholder: 'your-provider/model-id',
    docsUrl: 'https://icnnp7d0dymg.feishu.cn/wiki/BmiLwGBcEiloZDkdYnGc8RWnn6d#Ee1ldfvKJoVGvfxc32mcILwenth',
    docsUrlZh: 'https://icnnp7d0dymg.feishu.cn/wiki/BmiLwGBcEiloZDkdYnGc8RWnn6d#IWQCdfe5fobGU3xf3UGcgbLynGh',
  },
];

/** Get the SVG logo URL for a provider type, falls back to undefined */
export function getProviderIconUrl(type: ProviderType | string): string | undefined {
  return providerIcons[type];
}

/** Whether a provider's logo needs CSS invert in dark mode (all logos are monochrome) */
export function shouldInvertInDark(_type: ProviderType | string): boolean {
  return true;
}

/** Provider list shown in the Setup wizard */
export const SETUP_PROVIDERS = PROVIDER_TYPE_INFO;

/** Get type info by provider type id */
export function getProviderTypeInfo(type: ProviderType): ProviderTypeInfo | undefined {
  return PROVIDER_TYPE_INFO.find((t) => t.id === type);
}

export function getProviderDocsUrl(
  provider: Pick<ProviderTypeInfo, 'docsUrl' | 'docsUrlZh'> | undefined,
  language: string
): string | undefined {
  if (!provider?.docsUrl) {
    return undefined;
  }

  if (language.startsWith('zh') && provider.docsUrlZh) {
    return provider.docsUrlZh;
  }

  return provider.docsUrl;
}

export function shouldShowProviderModelId(
  provider: Pick<ProviderTypeInfo, 'showModelId' | 'showModelIdInDevModeOnly'> | undefined,
  devModeUnlocked: boolean
): boolean {
  if (!provider?.showModelId) return false;
  if (provider.showModelIdInDevModeOnly && !devModeUnlocked) return false;
  return true;
}

export function resolveProviderModelForSave(
  provider: Pick<ProviderTypeInfo, 'defaultModelId' | 'showModelId' | 'showModelIdInDevModeOnly'> | undefined,
  modelId: string,
  devModeUnlocked: boolean
): string | undefined {
  if (!shouldShowProviderModelId(provider, devModeUnlocked)) {
    return undefined;
  }

  const trimmedModelId = modelId.trim();
  return trimmedModelId || provider?.defaultModelId || undefined;
}

/** Normalize provider API key before saving; Ollama uses a local placeholder when blank. */
export function resolveProviderApiKeyForSave(type: ProviderType | string, apiKey: string): string | undefined {
  const trimmed = apiKey.trim();
  if (type === 'ollama') {
    return trimmed || OLLAMA_PLACEHOLDER_API_KEY;
  }
  return trimmed || undefined;
}
