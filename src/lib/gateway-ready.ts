import { hostApiFetch } from './host-api';
import type { GatewayHealth, GatewayStatus } from '@/types/gateway';

const DEFAULT_GATEWAY_READY_RETRIES = 90;
const DEFAULT_GATEWAY_READY_INTERVAL_MS = 1000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type WaitForGatewayReadyOptions = {
  retries?: number;
  intervalMs?: number;
  startIfNeeded?: boolean;
};

export async function waitForGatewayReady(
  options: WaitForGatewayReadyOptions = {},
): Promise<GatewayHealth> {
  const retries = options.retries ?? DEFAULT_GATEWAY_READY_RETRIES;
  const intervalMs = options.intervalMs ?? DEFAULT_GATEWAY_READY_INTERVAL_MS;
  const startIfNeeded = options.startIfNeeded ?? true;
  let attemptedStart = false;
  let lastError = 'Gateway is not ready';

  for (let attempt = 0; attempt < retries; attempt += 1) {
    let status: GatewayStatus | null = null;
    try {
      status = await hostApiFetch<GatewayStatus>('/api/gateway/status');
    } catch (error) {
      lastError = String(error);
    }

    if (status?.state === 'error') {
      throw new Error(status.error || 'Gateway failed to start');
    }

    if (startIfNeeded && status?.state === 'stopped' && !attemptedStart) {
      attemptedStart = true;
      const startResult = await hostApiFetch<{ success: boolean; error?: string }>('/api/gateway/start', {
        method: 'POST',
      });
      if (!startResult.success) {
        throw new Error(startResult.error || 'Failed to start gateway');
      }
    }

    try {
      const health = await hostApiFetch<GatewayHealth>('/api/gateway/health');
      if (health.ok) {
        return health;
      }
      lastError = health.error || lastError;
    } catch (error) {
      lastError = String(error);
    }

    if (status?.state && status.state !== 'running') {
      lastError = status.error
        ? `${status.state}: ${status.error}`
        : `Gateway is ${status.state}`;
    }

    if (attempt < retries - 1) {
      await delay(intervalMs);
    }
  }

  throw new Error(lastError);
}
