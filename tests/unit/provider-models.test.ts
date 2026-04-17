import { describe, expect, it } from 'vitest';

import {
  requiresManualProviderModelEntry,
  supportsProviderModelCatalog,
} from '@/lib/provider-models';
import type { ProviderAccount } from '@/lib/providers';

function createAccount(
  overrides: Partial<Pick<ProviderAccount, 'authMode' | 'vendorId' | 'metadata'>> = {},
): Pick<ProviderAccount, 'authMode' | 'vendorId' | 'metadata'> {
  return {
    authMode: 'api_key',
    vendorId: 'openai',
    metadata: undefined,
    ...overrides,
  };
}

describe('provider-models helpers', () => {
  it('supports provider model catalogs for openai oauth browser accounts', () => {
    const account = createAccount({
      authMode: 'oauth_browser',
      vendorId: 'openai',
    });

    expect(supportsProviderModelCatalog(account)).toBe(true);
    expect(requiresManualProviderModelEntry(account)).toBe(false);
  });

  it('supports provider model catalogs for google oauth browser accounts', () => {
    const account = createAccount({
      authMode: 'oauth_browser',
      vendorId: 'google',
    });

    expect(supportsProviderModelCatalog(account)).toBe(true);
    expect(requiresManualProviderModelEntry(account)).toBe(false);
  });

  it('keeps unsupported oauth browser providers on manual model entry', () => {
    const account = createAccount({
      authMode: 'oauth_browser',
      vendorId: 'custom',
    });

    expect(supportsProviderModelCatalog(account)).toBe(false);
    expect(requiresManualProviderModelEntry(account)).toBe(true);
  });

  it('allows oauth browser providers with explicit model provider keys', () => {
    const account = createAccount({
      authMode: 'oauth_browser',
      vendorId: 'custom',
      metadata: {
        modelProviderKey: 'custom-oauth-models',
      },
    });

    expect(supportsProviderModelCatalog(account)).toBe(true);
    expect(requiresManualProviderModelEntry(account)).toBe(false);
  });
});
