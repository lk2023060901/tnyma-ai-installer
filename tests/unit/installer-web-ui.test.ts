import { describe, expect, it } from 'vitest';

import {
  buildInstallerWebUiUrl,
  getInstallerLiveGatewayHealthUrl,
  getInstallerWebUiHealthUrl,
} from '@electron/utils/installer-web-ui';

describe('installer-web-ui', () => {
  it('builds the zh-CN agents URL for zh language', () => {
    expect(buildInstallerWebUiUrl({ language: 'zh' })).toBe('http://127.0.0.1:23000/zh-CN/agents');
  });

  it('falls back to en for unsupported locales', () => {
    expect(buildInstallerWebUiUrl({ language: 'ja' })).toBe('http://127.0.0.1:23000/en/agents');
  });

  it('exposes stable health URLs', () => {
    expect(getInstallerWebUiHealthUrl()).toBe('http://127.0.0.1:23000/');
    expect(getInstallerLiveGatewayHealthUrl()).toBe('http://127.0.0.1:43116/health');
  });
});
