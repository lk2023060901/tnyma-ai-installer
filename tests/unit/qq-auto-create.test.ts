import { describe, expect, it } from 'vitest';

import {
  extractQqCredentialsFromPayload,
  extractQqCredentialsFromText,
} from '../../electron/utils/qq-auto-create';

describe('extractQqCredentialsFromText', () => {
  it('parses QQ app credentials from mixed developer settings text', () => {
    const credentials = extractQqCredentialsFromText(`
      开发设置
      AppID：123456789
      Client Secret: AbCdEf123456_secret
      developer_id: dev-42
    `);

    expect(credentials).toEqual({
      appId: '123456789',
      clientSecret: 'AbCdEf123456_secret',
      developerId: 'dev-42',
    });
  });

  it('parses QQ credentials from attribute-like and copied values', () => {
    const appIdFromAttributes = extractQqCredentialsFromText(`
      <button data-appid="123456789">复制 AppID</button>
    `);
    const appIdFromHref = extractQqCredentialsFromText(`
      <a href="/qqbot/#/developer/developer-setting?appId=123456789">进入开发设置</a>
    `);
    const secretFromAttributes = extractQqCredentialsFromText(`
      <button data-client-secret="SecretToken_123456">复制 Client Secret</button>
    `);
    const secretFromClipboard = extractQqCredentialsFromText('SecretToken_123456');

    expect(appIdFromAttributes).toEqual({
      appId: '123456789',
    });
    expect(appIdFromHref).toEqual({
      appId: '123456789',
    });
    expect(secretFromAttributes).toEqual({
      clientSecret: 'SecretToken_123456',
    });
    expect(secretFromClipboard).toEqual({
      clientSecret: 'SecretToken_123456',
    });
  });
});

describe('extractQqCredentialsFromPayload', () => {
  it('walks nested JSON payloads returned by QQ pages', () => {
    const credentials = extractQqCredentialsFromPayload({
      data: {
        app_id: '987654321',
        setting: {
          client_secret: 'SecretToken_123456',
        },
        profile: {
          developer_id: 'dev-007',
        },
      },
    });

    expect(credentials).toEqual({
      appId: '987654321',
      clientSecret: 'SecretToken_123456',
      developerId: 'dev-007',
    });
  });
});
