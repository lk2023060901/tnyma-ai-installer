import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayManager } from '@electron/gateway/manager';

const mocks = vi.hoisted(() => ({
  getProviderAccount: vi.fn(),
  getOpenClawProviderKeyForType: vi.fn(),
  getProviderSecret: vi.fn(),
  proxyAwareFetch: vi.fn(),
}));

vi.mock('@electron/services/providers/provider-store', () => ({
  getProviderAccount: mocks.getProviderAccount,
}));

vi.mock('@electron/utils/provider-keys', () => ({
  getOpenClawProviderKeyForType: mocks.getOpenClawProviderKeyForType,
}));

vi.mock('@electron/services/secrets/secret-store', () => ({
  getProviderSecret: mocks.getProviderSecret,
}));

vi.mock('@electron/utils/proxy-fetch', () => ({
  proxyAwareFetch: mocks.proxyAwareFetch,
}));

import { listProviderModels } from '@electron/services/providers/provider-model-catalog';

function createGatewayRpc(
  responses: Array<{ models?: Array<Record<string, unknown>> } | Error>,
): Pick<GatewayManager, 'rpc'> {
  const rpc = vi.fn();
  for (const response of responses) {
    if (response instanceof Error) {
      rpc.mockRejectedValueOnce(response);
    } else {
      rpc.mockResolvedValueOnce(response);
    }
  }
  return { rpc } as Pick<GatewayManager, 'rpc'>;
}

describe('provider-model-catalog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderAccount.mockResolvedValue({
      id: 'acct-openai',
      vendorId: 'openai',
      authMode: 'api_key',
      metadata: {},
    });
    mocks.getOpenClawProviderKeyForType.mockReturnValue('openai-acct-openai');
    mocks.getProviderSecret.mockResolvedValue(null);
  });

  it('retries when the first catalog response does not include the saved provider yet', async () => {
    const gateway = createGatewayRpc([
      {
        models: [
          { id: 'other-model', name: 'Other Model', provider: 'someone-else' },
        ],
      },
      {
        models: [
          { id: 'gpt-5.4', name: 'GPT-5.4', provider: 'openai-acct-openai' },
        ],
      },
    ]);

    const models = await listProviderModels(gateway as GatewayManager, 'acct-openai', {
      retries: 2,
      delayMs: 0,
    });

    expect(gateway.rpc).toHaveBeenCalledTimes(2);
    expect(models).toEqual([
      { id: 'gpt-5.4', name: 'GPT-5.4', provider: 'openai-acct-openai' },
    ]);
  });

  it('retries after a transient gateway rpc failure and then returns sorted provider models', async () => {
    const gateway = createGatewayRpc([
      new Error('Gateway is reloading'),
      {
        models: [
          { id: 'gpt-5.4', name: 'GPT-5.4', provider: 'openai-acct-openai' },
          { id: 'gpt-4.1', name: 'gpt-4.1', provider: 'openai-acct-openai' },
        ],
      },
    ]);

    const models = await listProviderModels(gateway as GatewayManager, 'acct-openai', {
      retries: 2,
      delayMs: 0,
    });

    expect(gateway.rpc).toHaveBeenCalledTimes(2);
    expect(models).toEqual([
      { id: 'gpt-4.1', name: 'gpt-4.1', provider: 'openai-acct-openai' },
      { id: 'gpt-5.4', name: 'GPT-5.4', provider: 'openai-acct-openai' },
    ]);
  });

  it('deduplicates oauth browser models that arrive under multiple provider aliases', async () => {
    mocks.getProviderAccount.mockResolvedValue({
      id: 'acct-openai',
      vendorId: 'openai',
      authMode: 'oauth_browser',
      metadata: {},
    });

    const gateway = createGatewayRpc([
      {
        models: [
          { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex', provider: 'openai' },
          { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex', provider: 'openai-codex' },
          { id: 'gpt-5.4', name: 'GPT-5.4', provider: 'openai-codex' },
        ],
      },
    ]);

    const models = await listProviderModels(gateway as GatewayManager, 'acct-openai', {
      retries: 1,
      delayMs: 0,
    });

    expect(models).toEqual([
      { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex', provider: 'openai-codex' },
      { id: 'gpt-5.4', name: 'GPT-5.4', provider: 'openai-codex' },
    ]);
  });

  it('falls back to direct /models fetch for custom openai-compatible providers when gateway catalog is empty', async () => {
    mocks.getProviderAccount.mockResolvedValue({
      id: 'custom-12345678',
      vendorId: 'custom',
      authMode: 'api_key',
      baseUrl: 'https://provider.example/v1',
      apiProtocol: 'openai-completions',
      metadata: {},
    });
    mocks.getOpenClawProviderKeyForType.mockReturnValue('custom-custom12');
    mocks.getProviderSecret.mockResolvedValue({
      type: 'api_key',
      accountId: 'custom-12345678',
      apiKey: 'sk-test',
    });
    mocks.proxyAwareFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: [
          { id: 'provider-large', name: 'Provider Large' },
          { id: 'provider-small' },
        ],
      }),
    });
    const gateway = createGatewayRpc([
      { models: [] },
    ]);

    const models = await listProviderModels(gateway as GatewayManager, 'custom-12345678', {
      retries: 1,
      delayMs: 0,
    });

    expect(mocks.proxyAwareFetch).toHaveBeenCalledWith(
      'https://provider.example/v1/models?limit=200',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-test',
        }),
      }),
    );
    expect(models).toEqual([
      { id: 'provider-large', name: 'Provider Large', provider: 'custom-custom12' },
      { id: 'provider-small', name: 'provider-small', provider: 'custom-custom12' },
    ]);
  });

  it('falls back to /v1/models when the root /models endpoint is not a usable catalog', async () => {
    mocks.getProviderAccount.mockResolvedValue({
      id: 'custom-12345678',
      vendorId: 'custom',
      authMode: 'api_key',
      baseUrl: 'https://provider.example',
      apiProtocol: 'openai-completions',
      metadata: {},
    });
    mocks.getOpenClawProviderKeyForType.mockReturnValue('custom-custom12');
    mocks.getProviderSecret.mockResolvedValue({
      type: 'api_key',
      accountId: 'custom-12345678',
      apiKey: 'sk-test',
    });
    mocks.proxyAwareFetch
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockRejectedValue(new Error('not json')),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [{ id: 'provider-large', name: 'Provider Large' }],
        }),
      });

    const gateway = createGatewayRpc([{ models: [] }]);

    const models = await listProviderModels(gateway as GatewayManager, 'custom-12345678', {
      retries: 1,
      delayMs: 0,
    });

    expect(mocks.proxyAwareFetch).toHaveBeenNthCalledWith(
      1,
      'https://provider.example/models?limit=200',
      expect.any(Object),
    );
    expect(mocks.proxyAwareFetch).toHaveBeenNthCalledWith(
      2,
      'https://provider.example/v1/models?limit=200',
      expect.any(Object),
    );
    expect(models).toEqual([
      { id: 'provider-large', name: 'Provider Large', provider: 'custom-custom12' },
    ]);
  });

  it('prefers direct custom provider catalog over stale gateway models', async () => {
    mocks.getProviderAccount.mockResolvedValue({
      id: 'custom-12345678',
      vendorId: 'custom',
      authMode: 'api_key',
      baseUrl: 'https://provider.example',
      apiProtocol: 'openai-completions',
      metadata: {},
    });
    mocks.getOpenClawProviderKeyForType.mockReturnValue('custom-custom12');
    mocks.getProviderSecret.mockResolvedValue({
      type: 'api_key',
      accountId: 'custom-12345678',
      apiKey: 'sk-test',
    });
    mocks.proxyAwareFetch
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockRejectedValue(new Error('not json')),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [
            { id: 'provider-large', name: 'Provider Large' },
            { id: 'provider-small', name: 'Provider Small' },
          ],
        }),
      });

    const gateway = createGatewayRpc([
      {
        models: [{ id: 'provider-small', name: 'Provider Small', provider: 'custom-custom12' }],
      },
    ]);

    const models = await listProviderModels(gateway as GatewayManager, 'custom-12345678', {
      retries: 1,
      delayMs: 0,
    });

    expect(models).toEqual([
      { id: 'provider-large', name: 'Provider Large', provider: 'custom-custom12' },
      { id: 'provider-small', name: 'Provider Small', provider: 'custom-custom12' },
    ]);
  });

  it('merges custom direct catalog with gateway catalog when the direct endpoint is incomplete', async () => {
    mocks.getProviderAccount.mockResolvedValue({
      id: 'custom-12345678',
      vendorId: 'custom',
      authMode: 'api_key',
      baseUrl: 'https://provider.example',
      apiProtocol: 'openai-completions',
      metadata: {},
    });
    mocks.getOpenClawProviderKeyForType.mockReturnValue('custom-custom12');
    mocks.getProviderSecret.mockResolvedValue({
      type: 'api_key',
      accountId: 'custom-12345678',
      apiKey: 'sk-test',
    });
    mocks.proxyAwareFetch
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockRejectedValue(new Error('not json')),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [{ id: 'provider-haiku', name: 'Claude Haiku' }],
        }),
      });

    const gateway = createGatewayRpc([
      {
        models: [
          { id: 'provider-sonnet', name: 'Claude Sonnet', provider: 'custom-custom12' },
          { id: 'provider-haiku', name: 'Claude Haiku', provider: 'custom-custom12' },
        ],
      },
    ]);

    const models = await listProviderModels(gateway as GatewayManager, 'custom-12345678', {
      retries: 1,
      delayMs: 0,
    });

    expect(models).toEqual([
      { id: 'provider-haiku', name: 'Claude Haiku', provider: 'custom-custom12' },
      { id: 'provider-sonnet', name: 'Claude Sonnet', provider: 'custom-custom12' },
    ]);
  });
});
