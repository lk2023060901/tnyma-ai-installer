import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';

const runOpenClawDoctorMock = vi.fn();
const runOpenClawDoctorFixMock = vi.fn();
const detectInstalledProductsMock = vi.fn();
const uninstallInstalledProductsMock = vi.fn();
const sendJsonMock = vi.fn();
const sendNoContentMock = vi.fn();

vi.mock('@electron/utils/openclaw-doctor', () => ({
  runOpenClawDoctor: (...args: unknown[]) => runOpenClawDoctorMock(...args),
  runOpenClawDoctorFix: (...args: unknown[]) => runOpenClawDoctorFixMock(...args),
}));

vi.mock('@electron/services/installed-product', () => ({
  detectInstalledProducts: (...args: unknown[]) => detectInstalledProductsMock(...args),
  uninstallInstalledProducts: (...args: unknown[]) => uninstallInstalledProductsMock(...args),
}));

vi.mock('@electron/api/route-utils', () => ({
  setCorsHeaders: vi.fn(),
  parseJsonBody: vi.fn().mockResolvedValue({}),
  sendJson: (...args: unknown[]) => sendJsonMock(...args),
  sendNoContent: (...args: unknown[]) => sendNoContentMock(...args),
}));

describe('handleAppRoutes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('runs openclaw doctor through the host api', async () => {
    runOpenClawDoctorMock.mockResolvedValueOnce({ success: true, exitCode: 0 });
    const { handleAppRoutes } = await import('@electron/api/routes/app');

    const handled = await handleAppRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:3210/api/app/openclaw-doctor'),
      {} as never,
    );

    expect(handled).toBe(true);
    expect(runOpenClawDoctorMock).toHaveBeenCalledTimes(1);
    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 200, { success: true, exitCode: 0 });
  });

  it('runs openclaw doctor fix when requested', async () => {
    const { parseJsonBody } = await import('@electron/api/route-utils');
    vi.mocked(parseJsonBody).mockResolvedValueOnce({ mode: 'fix' });
    runOpenClawDoctorFixMock.mockResolvedValueOnce({ success: false, exitCode: 1 });
    const { handleAppRoutes } = await import('@electron/api/routes/app');

    const handled = await handleAppRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:3210/api/app/openclaw-doctor'),
      {} as never,
    );

    expect(handled).toBe(true);
    expect(runOpenClawDoctorFixMock).toHaveBeenCalledTimes(1);
    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 200, { success: false, exitCode: 1 });
  });

  it('returns installed product detection status through the host api', async () => {
    detectInstalledProductsMock.mockResolvedValueOnce({
      success: true,
      detected: true,
      platform: 'darwin',
      indicators: [{ kind: 'path', value: '/Users/test/.openclaw' }],
    });
    const { handleAppRoutes } = await import('@electron/api/routes/app');

    const handled = await handleAppRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:3210/api/app/installed-products'),
      {} as never,
    );

    expect(handled).toBe(true);
    expect(detectInstalledProductsMock).toHaveBeenCalledTimes(1);
    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 200, {
      success: true,
      detected: true,
      platform: 'darwin',
      indicators: [{ kind: 'path', value: '/Users/test/.openclaw' }],
    });
  });

  it('runs installed product uninstall through the host api', async () => {
    uninstallInstalledProductsMock.mockResolvedValueOnce({
      success: true,
      platform: 'win32',
      removedPaths: ['C:\\Users\\test\\.openclaw'],
      failures: [],
      remainingIndicators: [],
    });
    const { handleAppRoutes } = await import('@electron/api/routes/app');

    const handled = await handleAppRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:3210/api/app/installed-products/uninstall'),
      {} as never,
    );

    expect(handled).toBe(true);
    expect(uninstallInstalledProductsMock).toHaveBeenCalledTimes(1);
    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 200, {
      success: true,
      platform: 'win32',
      removedPaths: ['C:\\Users\\test\\.openclaw'],
      failures: [],
      remainingIndicators: [],
    });
  });
});
