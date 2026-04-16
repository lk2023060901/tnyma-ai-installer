import { describe, expect, it, vi } from 'vitest';
import {
  getExistingPathIndicators,
  getInstalledProductCandidatePaths,
} from '@electron/services/installed-product';

describe('installed-product service helpers', () => {
  it('includes the known Windows install roots and runtime markers', () => {
    const paths = getInstalledProductCandidatePaths(
      'win32',
      {
        LOCALAPPDATA: 'C:\\Users\\liukai\\AppData\\Local',
        APPDATA: 'C:\\Users\\liukai\\AppData\\Roaming',
      } as NodeJS.ProcessEnv,
      'C:\\Users\\liukai',
    );

    expect(paths).toContain('C:\\Users\\liukai\\.openclaw');
    expect(paths).toContain('C:\\Users\\liukai\\AppData\\Local\\Programs\\TnymaAI');
    expect(paths).toContain('C:\\Users\\liukai\\AppData\\Local\\Programs\\OpenClaw');
    expect(paths).toContain('C:\\Users\\liukai\\AppData\\Roaming\\OpenClaw');
  });

  it('includes the known macOS app bundles and runtime markers', () => {
    const paths = getInstalledProductCandidatePaths('darwin', {} as NodeJS.ProcessEnv, '/Users/liukai');

    expect(paths).toContain('/Users/liukai/.openclaw');
    expect(paths).toContain('/Applications/TnymaAI.app');
    expect(paths).toContain('/Applications/OpenClaw.app');
    expect(paths).toContain('/Users/liukai/Applications/TnymaAI.app');
  });

  it('maps existing paths to install indicators', () => {
    const existsChecker = vi.fn((path: string) => path.endsWith('.openclaw') || path.endsWith('/opt/TnymaAI'));
    const indicators = getExistingPathIndicators(
      ['/Users/liukai/.openclaw', '/opt/TnymaAI', '/usr/local/bin/openclaw'],
      existsChecker,
    );

    expect(indicators).toEqual([
      { kind: 'path', value: '/Users/liukai/.openclaw' },
      { kind: 'path', value: '/opt/TnymaAI' },
    ]);
  });
});
