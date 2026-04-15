import type { BrowserWindow } from 'electron';
import type { GatewayManager } from '../gateway/manager';
import type { ClawHubService } from '../gateway/clawhub';
import type { HostEventBus } from './event-bus';
import type { InstallerWebStackManager } from '../services/installer-web-stack';

export interface HostApiContext {
  gatewayManager: GatewayManager;
  clawHubService: ClawHubService;
  installerWebStackManager: InstallerWebStackManager;
  eventBus: HostEventBus;
  mainWindow: BrowserWindow | null;
}
