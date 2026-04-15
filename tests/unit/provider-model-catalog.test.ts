import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayManager } from '@electron/gateway/manager';

const mocks = vi.hoisted(() => ({
  getProviderAccount: vi.fn(),
  getOpenClawProviderKeyForType: vi.fn(),
}));

vi.mock('@electron/services/providers/provider-store', () => ({
  getProviderAccount: mocks.getProviderAccount,
}));

vi.mock('@electron/utils/provider-keys', () => ({
  getOpenClawProviderKeyForType: mocks.getOpenClawProviderKeyForType,
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
});
