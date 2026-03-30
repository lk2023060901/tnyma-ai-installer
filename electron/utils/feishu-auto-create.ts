import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';
import type { BrowserWindow, Cookie, Session } from 'electron';
import { getOpenClawResolvedDir } from './paths';
import { logger } from './logger';
import { buildElectronProxyConfig } from './proxy';
import { proxyAwareFetch } from './proxy-fetch';
import { getAllSettings } from './store';

const require = createRequire(import.meta.url);

const FEISHU_ACCOUNTS_BASE_URL = 'https://accounts.feishu.cn';
const FEISHU_OPEN_BASE_URL = 'https://open.feishu.cn';
const FEISHU_PASSPORT_BASE_URL = 'https://passport.feishu.cn';
const FEISHU_API_BASE_URL = `${FEISHU_OPEN_BASE_URL}/developers/v1`;
const FEISHU_IM_API_BASE_URL = `${FEISHU_OPEN_BASE_URL}/open-apis/im/v1`;
const FEISHU_TENANT_ACCESS_TOKEN_URL = `${FEISHU_OPEN_BASE_URL}/open-apis/auth/v3/tenant_access_token/internal`;
const FEISHU_APP_LIST_URL = `${FEISHU_OPEN_BASE_URL}/app`;
const FEISHU_OPEN_ROOT_URL = `${FEISHU_OPEN_BASE_URL}/`;
const FEISHU_QR_POLLING_STEP = 'qr_login_polling';
const FEISHU_EVENT_MODE_WEBSOCKET = 4;
const FEISHU_EVENT_FORMAT_V2 = 1;
const LOGIN_TIMEOUT_MS = 8 * 60_000;
const FIRST_QR_TIMEOUT_MS = 30_000;
const SESSION_TIMEOUT_MS = 15 * 60_000;
const DEBUGGER_ATTACH_TIMEOUT_MS = 3_000;
const WELCOME_MESSAGE_TIMEOUT_MS = 10_000;
const WELCOME_MESSAGE_RETRY_COUNT = 3;
const DEFAULT_APP_DESCRIPTION = 'Created by TnymaAI';
const DEFAULT_WELCOME_MESSAGE = '欢迎使用 TnymaAI！你的机器人已经创建完成，现在可以开始使用了。';
const FEISHU_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';

const FEISHU_REQUIRED_EVENT_NAMES = [
  'im.chat.member.bot.added_v1',
  'im.chat.member.bot.deleted_v1',
  'im.message.message_read_v1',
  'im.message.receive_v1',
] as const;

const REQUIRED_APP_SCOPE_NAMES = [
  'contact:contact.base:readonly',
  'docx:document:readonly',
  'im:chat:read',
  'im:chat:update',
  'im:message.group_at_msg:readonly',
  'im:message.p2p_msg:readonly',
  'im:message.reactions:read',
  'im:message:readonly',
  'im:message:recall',
  'im:message:send_as_bot',
  'im:message:send_multi_users',
  'im:message:send_sys_msg',
  'im:message:update',
  'im:resource',
  'application:application:self_manage',
  'cardkit:card:write',
  'cardkit:card:read',
] as const;

const REQUESTED_SCOPE_NAMES = [
  'bitable:app',
  'bitable:app:readonly',
  'cardkit:card:read',
  'cardkit:card:write',
  'cardkit:template:read',
  'contact:contact.base:readonly',
  'contact:user.base:readonly',
  'docx:document',
  'docx:document.block:convert',
  'docx:document:readonly',
  'drive:drive',
  'drive:drive:readonly',
  'im:chat:readonly',
  'im:datasync.feed_card.time_sensitive:write',
  'im:message',
  'im:message.group_at_msg:readonly',
  'im:message.group_msg',
  'im:message.p2p_msg:readonly',
  'im:message.reactions:read',
  'im:message:readonly',
  'im:message:recall',
  'im:message:send_as_bot',
  'im:message:update',
  'im:resource',
  'task:task:read',
  'task:task:write',
  'wiki:wiki',
  'wiki:wiki:readonly',
] as const;

const SCOPE_NAME_ALIASES: Record<string, string[]> = {
  'bitable:app': [
    'base:app:copy',
    'base:app:create',
    'base:app:read',
    'base:app:update',
    'base:field:create',
    'base:field:delete',
    'base:field:read',
    'base:field:update',
    'base:record:create',
    'base:record:delete',
    'base:record:retrieve',
    'base:record:update',
    'base:table:create',
    'base:table:delete',
    'base:table:read',
    'base:table:update',
    'base:view:read',
    'base:view:write_only',
  ],
  'bitable:app:readonly': [
    'base:app:read',
    'base:field:read',
    'base:record:retrieve',
    'base:table:read',
    'base:view:read',
  ],
  'docx:document': [
    'docx:document:create',
    'docx:document:readonly',
    'docx:document:write_only',
  ],
  'drive:drive': [
    'drive:drive.metadata:readonly',
    'drive:file:download',
    'drive:file:upload',
    'space:document:delete',
    'space:document:move',
    'space:document:retrieve',
  ],
  'drive:drive:readonly': [
    'drive:drive.metadata:readonly',
    'space:document:retrieve',
  ],
  'im:chat:readonly': ['im:chat:read'],
  'task:task:write': ['task:task:write', 'task:task:writeonly'],
  'wiki:wiki': [
    'wiki:node:copy',
    'wiki:node:create',
    'wiki:node:move',
    'wiki:node:read',
    'wiki:node:retrieve',
    'wiki:space:read',
    'wiki:space:retrieve',
    'wiki:space:write_only',
  ],
  'wiki:wiki:readonly': [
    'wiki:node:read',
    'wiki:node:retrieve',
    'wiki:space:read',
    'wiki:space:retrieve',
  ],
};

const FALLBACK_SCOPE_IDS: Record<string, string> = {
  'application:application:self_manage': '8108',
  'base:app:copy': '1014365',
  'base:app:create': '1014381',
  'base:app:read': '1014379',
  'base:app:update': '1014380',
  'base:field:create': '1014368',
  'base:field:delete': '1014374',
  'base:field:read': '1014373',
  'base:field:update': '1014375',
  'base:record:create': '1014367',
  'base:record:delete': '1014370',
  'base:record:retrieve': '1014369',
  'base:record:update': '1014371',
  'base:table:create': '1014378',
  'base:table:delete': '1014376',
  'base:table:read': '1014366',
  'base:table:update': '1014377',
  'base:view:read': '1014392',
  'base:view:write_only': '1014393',
  'board:whiteboard:node:create': '1013919',
  'board:whiteboard:node:read': '1013920',
  'calendar:calendar:read': '1014242',
  'cardkit:card:read': '1014131',
  'cardkit:card:write': '1014132',
  'contact:contact.base:readonly': '100032',
  'contact:user.base:readonly': '14',
  'docs:document.comment:create': '1014848',
  'docs:document.comment:read': '101588',
  'docs:document.comment:update': '1014849',
  'docs:document.media:download': '1013973',
  'docs:document.media:upload': '1013974',
  'docs:document:copy': '101592',
  'docs:document:export': '1013986',
  'docx:document:create': '1013971',
  'docx:document:readonly': '41003',
  'docx:document:write_only': '1014878',
  'drive:drive.metadata:readonly': '26004',
  'drive:file:download': '1013982',
  'drive:file:upload': '101589',
  'im:chat.members:read': '1014185',
  'im:chat:read': '1014181',
  'im:chat:update': '1014179',
  'im:message': '20001',
  'im:message.group_at_msg:readonly': '3001',
  'im:message.group_msg': '20012',
  'im:message.p2p_msg:readonly': '3000',
  'im:message.reactions:read': '1014176',
  'im:message:readonly': '20008',
  'im:message:recall': '20006',
  'im:message:send_as_bot': '1000',
  'im:message:send_multi_users': '1005',
  'im:message:send_sys_msg': '1014165',
  'im:message:update': '20004',
  'im:resource': '20009',
  'search:docs:read': '1014121',
  'search:message': '23104',
  'space:document:delete': '101596',
  'space:document:move': '101591',
  'space:document:retrieve': '101595',
  'task:comment:read': '16205',
  'task:comment:write': '16206',
  'task:task:read': '16201',
  'task:task:write': '16202',
  'task:task:writeonly': '1014840',
  'task:tasklist:read': '16203',
  'task:tasklist:write': '16204',
  'wiki:node:copy': '1014344',
  'wiki:node:create': '1014345',
  'wiki:node:move': '1014343',
  'wiki:node:read': '1014354',
  'wiki:node:retrieve': '1014346',
  'wiki:space:read': '1014353',
  'wiki:space:retrieve': '1014352',
  'wiki:space:write_only': '1014355',
};

const SESSION_EVENT_QR = 'qr';
const SESSION_EVENT_PROGRESS = 'progress';

type Credentials = {
  cookieString: string;
  csrfToken: string;
  savedAt: number;
};

type FeishuScopeRecord = {
  id?: string;
  name?: string;
  scopeIdentityType?: number;
};

type FeishuApiResponse<T> = {
  code: number;
  msg?: string;
  data: T;
};

type FeishuTenantAccessTokenResponse = {
  code?: number;
  msg?: string;
  expire?: number;
  tenant_access_token?: string;
};

type FeishuApplicationRecord = {
  creator_id?: string;
  owner?: {
    owner_id?: string;
    owner_type?: number;
    type?: number;
  };
};

type FeishuQrStepInfo = {
  status?: number;
  token?: string;
};

type FeishuQrPollingPayload = {
  next_step?: string;
  step_info?: FeishuQrStepInfo;
  ttlogid?: string;
};

type FeishuLoginRequestContext = {
  cookieString: string;
  csrfToken: string;
};

type ChromeDebuggerEvent = {
  requestId?: string;
  response?: {
    url?: string;
  };
  errorText?: string;
  blockedReason?: string;
};

type LoginPageQrProbeResult = {
  qrcodeUrl: string | null;
  summary: string;
};

type ScopeResolutionResult = {
  appScopeIDs: string[];
  unresolvedScopes: string[];
};

type SessionQrPayload = {
  qrcodeUrl: string;
};

export type AutoCreateProgressPayload = {
  status: 'running' | 'completed' | 'error';
  stepId: string;
};

export type FeishuAutoCreateStartOptions = {
  appName: string;
  appDescription?: string;
};

export type FeishuAutoCreateStartResult = {
  sessionKey: string;
  qrcodeUrl?: string;
  message: string;
};

export type FeishuCredentialsReadyPayload = {
  appId: string;
  appSecret: string;
  connectionMode: 'websocket';
};

export type FeishuAutoCreateWaitOptions = {
  timeoutMs?: number;
  onQrRefresh?: (payload: SessionQrPayload) => void | Promise<void>;
  onCredentialsReady?: (payload: FeishuCredentialsReadyPayload) => void | Promise<void>;
  onProgress?: (payload: AutoCreateProgressPayload) => void | Promise<void>;
};

export type FeishuAutoCreateResult = {
  appId: string;
  appSecret: string;
  versionId: string;
  name: string;
  desc: string;
  unresolvedScopes: string[];
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  void promise.catch(() => {});
  return { promise, resolve, reject };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }) as Promise<T>;
}

function normalizeAppName(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : 'TnymaAI Bot';
}

function normalizeAppDescription(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_APP_DESCRIPTION;
}

function buildAutoCreateWelcomeMessage(botName: string): string {
  const trimmed = botName.trim();
  if (trimmed.length > 0) {
    return `欢迎使用 ${trimmed}！我是由 TnymaAI 创建的机器人，现在已经准备就绪。`;
  }
  return DEFAULT_WELCOME_MESSAGE;
}

function buildLoginUrl(redirectUri: string): string {
  return `${FEISHU_ACCOUNTS_BASE_URL}/accounts/page/login?app_id=7&force_login=1&no_trap=1&redirect_uri=${encodeURIComponent(redirectUri)}`;
}

async function createRequestSession(partition: string): Promise<Session> {
  if (!process.versions.electron) {
    throw new Error('Feishu auto-create requires Electron main-process networking.');
  }

  const { session } = await import('electron');
  const requestSession = session.fromPartition(partition, { cache: false });
  const appSettings = await getAllSettings().catch(() => null);
  if (appSettings) {
    await requestSession.setProxy(buildElectronProxyConfig(appSettings)).catch(() => {});
  }
  return requestSession;
}

async function createLoginWindow(partition: string): Promise<BrowserWindow> {
  if (!process.versions.electron) {
    throw new Error('Feishu auto-create requires Electron main-process windows.');
  }

  const { BrowserWindow } = await import('electron');
  const loginWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      backgroundThrottling: false,
      partition,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  loginWindow.webContents.setUserAgent(FEISHU_USER_AGENT);
  return loginWindow;
}

async function fetchWithSession(
  networkSession: Session,
  input: string,
  init: RequestInit,
): Promise<globalThis.Response> {
  return await networkSession.fetch(input, {
    ...init,
    credentials: 'include',
  });
}

async function proxyAwareFetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<globalThis.Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await proxyAwareFetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function executeOnLoginPage<T>(loginWindow: BrowserWindow, expression: string): Promise<T> {
  return await loginWindow.webContents.executeJavaScript(expression, true) as T;
}

type QrRenderDeps = {
  QRCode: typeof import('qrcode-terminal/vendor/QRCode/index.js');
  QRErrorCorrectLevel: typeof import('qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel.js');
};

let qrRenderDeps: QrRenderDeps | null = null;

function getQrRenderDeps(): QrRenderDeps {
  if (qrRenderDeps) {
    return qrRenderDeps;
  }
  const openclawRequire = createRequire(join(getOpenClawResolvedDir(), 'package.json'));
  const qrcodeTerminalPath = dirname(openclawRequire.resolve('qrcode-terminal/package.json'));
  qrRenderDeps = {
    QRCode: require(join(qrcodeTerminalPath, 'vendor', 'QRCode', 'index.js')),
    QRErrorCorrectLevel: require(join(qrcodeTerminalPath, 'vendor', 'QRCode', 'QRErrorCorrectLevel.js')),
  };
  return qrRenderDeps;
}

function createQrMatrix(input: string) {
  const { QRCode, QRErrorCorrectLevel } = getQrRenderDeps();
  const qr = new QRCode(-1, QRErrorCorrectLevel.Q);
  qr.addData(input);
  qr.make();
  return qr;
}

function fillPixel(buf: Buffer, x: number, y: number, width: number, r: number, g: number, b: number, a = 255) {
  const idx = (y * width + x) * 4;
  buf[idx] = r;
  buf[idx + 1] = g;
  buf[idx + 2] = b;
  buf[idx + 3] = a;
}

function crcTable() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = crcTable();

function crc32(buf: Buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = crc32(Buffer.concat([typeBuf, data]));
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePngRgba(buffer: Buffer, width: number, height: number) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const rawOffset = row * (stride + 1);
    raw[rawOffset] = 0;
    buffer.copy(raw, rawOffset + 1, row * stride, row * stride + stride);
  }
  const compressed = deflateSync(raw);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([signature, pngChunk('IHDR', ihdr), pngChunk('IDAT', compressed), pngChunk('IEND', Buffer.alloc(0))]);
}

function renderQrPngDataUrl(input: string, opts: { scale?: number; marginModules?: number } = {}): string {
  const { scale = 6, marginModules = 4 } = opts;
  const qr = createQrMatrix(input);
  const modules = qr.getModuleCount();
  const size = (modules + marginModules * 2) * scale;
  const buf = Buffer.alloc(size * size * 4, 255);
  for (let row = 0; row < modules; row += 1) {
    for (let col = 0; col < modules; col += 1) {
      if (!qr.isDark(row, col)) continue;
      const startX = (col + marginModules) * scale;
      const startY = (row + marginModules) * scale;
      for (let y = 0; y < scale; y += 1) {
        for (let x = 0; x < scale; x += 1) {
          fillPixel(buf, startX + x, startY + y, size, 0, 0, 0, 255);
        }
      }
    }
  }
  const png = encodePngRgba(buf, size, size);
  return `data:image/png;base64,${png.toString('base64')}`;
}

function buildQrContentFromToken(token: string): string {
  return JSON.stringify({ qrlogin: { token } });
}

function getAvatarCandidates(): string[] {
  const candidates = [
    join(process.cwd(), 'resources', 'icons', 'icon.png'),
    join(process.resourcesPath || '', 'resources', 'icons', 'icon.png'),
    join(process.resourcesPath || '', 'icons', 'icon.png'),
  ];
  return Array.from(new Set(candidates.filter(Boolean)));
}

async function readDefaultAvatar(): Promise<Buffer> {
  for (const candidate of getAvatarCandidates()) {
    if (!candidate || !existsSync(candidate)) continue;
    return await readFile(candidate);
  }
  throw new Error('Could not find the default TnymaAI icon for Feishu app creation.');
}

function buildMergedCookieString(primary: string, fallback: string): string {
  const merged = new Map<string, string>();
  for (const source of [fallback, primary]) {
    for (const pair of source.split(';')) {
      const trimmed = pair.trim();
      if (!trimmed) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex <= 0) continue;
      const name = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      if (!name) continue;
      merged.set(name, value);
    }
  }
  return Array.from(merged.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

function buildCookieStringFromCookies(cookies: Cookie[]): string {
  return cookies
    .filter((cookie) => cookie.name && cookie.value !== undefined)
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

function buildCookieStringFromContextCookies(cookies: Array<{ name: string; value: string }>): string {
  return cookies
    .filter((cookie) => cookie.name && cookie.value !== undefined)
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

function readHeaderValue(headers: Record<string, string | string[]>, ...names: string[]): string {
  for (const targetName of names) {
    for (const [name, value] of Object.entries(headers)) {
      if (name.toLowerCase() !== targetName.toLowerCase()) continue;
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
      if (Array.isArray(value)) {
        const joined = value.join('; ').trim();
        if (joined) {
          return joined;
        }
      }
    }
  }
  return '';
}

function isFeishuNavigationAbortError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('(-3)') || message.includes('ERR_ABORTED');
}

function getAllowedNavigationOrigins(requestedUrl: string): Set<string> {
  const allowedOrigins = new Set<string>();
  try {
    const url = new URL(requestedUrl);
    allowedOrigins.add(url.origin);
    const redirectUri = url.searchParams.get('redirect_uri');
    if (redirectUri) {
      allowedOrigins.add(new URL(redirectUri).origin);
    }
  } catch {
    // Ignore malformed URLs and let the caller time out naturally.
  }
  return allowedOrigins;
}

function matchesAllowedNavigationOrigin(currentUrl: string, requestedUrl: string): boolean {
  if (!currentUrl) {
    return false;
  }
  try {
    const currentOrigin = new URL(currentUrl).origin;
    return getAllowedNavigationOrigins(requestedUrl).has(currentOrigin);
  } catch {
    return false;
  }
}

async function loadFeishuLoginPage(loginWindow: BrowserWindow, loginUrl: string): Promise<void> {
  let navigationAborted = false;
  try {
    await loginWindow.loadURL(loginUrl, { userAgent: FEISHU_USER_AGENT });
  } catch (error) {
    if (!isFeishuNavigationAbortError(error)) {
      throw error;
    }
    navigationAborted = true;
    logger.warn(`Feishu navigation reported ERR_ABORTED while loading ${loginUrl}; checking redirected page readiness`);
  }

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const currentUrl = loginWindow.webContents.getURL();
    const ready = await executeOnLoginPage<boolean>(
      loginWindow,
      'document.readyState === "complete" || document.readyState === "interactive"',
    ).catch(() => false);
    if (ready && (!navigationAborted || matchesAllowedNavigationOrigin(currentUrl, loginUrl))) {
      await delay(750);
      if (navigationAborted) {
        logger.info(`Feishu navigation continued after ERR_ABORTED: requested=${loginUrl} final=${currentUrl || 'unknown'}`);
      }
      return;
    }
    await delay(250);
  }
  const finalUrl = loginWindow.webContents.getURL();
  if (navigationAborted) {
    throw new Error(
      `Timed out waiting for the redirected Feishu page to load (requested=${loginUrl} final=${finalUrl || 'unknown'}).`,
    );
  }
  throw new Error('Timed out waiting for the Feishu login page to load.');
}

async function activateFeishuQrLogin(loginWindow: BrowserWindow): Promise<boolean> {
  return await executeOnLoginPage<boolean>(
    loginWindow,
    `(() => {
      const selectors = [
        '.switch-login-mode-box',
        '[class*="switch-login-mode"]',
        '[class*="qrcode-switch"]',
        '[class*="qr-switch"]',
        '[class*="scan-switch"]',
        '[data-testid="qrcode-login"]',
      ];
      const textMatchers = ['扫码登录', '二维码登录', 'Scan QR Code', 'Log In With QR'];
      const findByText = () => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
        while (walker.nextNode()) {
          const node = walker.currentNode;
          const text = (node.textContent || '').trim();
          if (!text) continue;
          if (textMatchers.some((matcher) => text.includes(matcher))) {
            return node;
          }
        }
        return null;
      };
      const clickTarget = (target) => {
        if (!(target instanceof HTMLElement)) return false;
        target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        target.click();
        return true;
      };
      const hasQr = () => Boolean(
        document.querySelector('canvas')
        || document.querySelector('img[alt*="QR"], img[alt*="二维码"]')
        || document.querySelector('[class*="scan-QR-code"]')
        || document.querySelector('[class*="qrcode"]'),
      );
      if (hasQr()) {
        return true;
      }
      for (const selector of selectors) {
        const target = document.querySelector(selector);
        if (clickTarget(target)) {
          return true;
        }
      }
      return clickTarget(findByText());
    })()`,
  ).catch(() => false);
}

async function captureRenderedQrFromLoginPage(loginWindow: BrowserWindow): Promise<LoginPageQrProbeResult> {
  return await executeOnLoginPage<LoginPageQrProbeResult>(
    loginWindow,
    `(() => {
      const imageSelectors = [
        'img[alt*="QR"]',
        'img[alt*="二维码"]',
        '[class*="qrcode"] img',
        '[class*="qr-code"] img',
        '[class*="scan-QR-code"] img',
      ];
      const canvasSelectors = [
        '[class*="qrcode"] canvas',
        '[class*="qr-code"] canvas',
        '[class*="scan-QR-code"] canvas',
        'canvas',
      ];
      for (const selector of imageSelectors) {
        const node = document.querySelector(selector);
        if (!(node instanceof HTMLImageElement)) continue;
        const src = (node.currentSrc || node.src || '').trim();
        if (src.startsWith('data:image/') || src.startsWith('https://') || src.startsWith('http://')) {
          return { qrcodeUrl: src, summary: \`img:\${selector}\` };
        }
      }
      for (const selector of canvasSelectors) {
        const node = document.querySelector(selector);
        if (!(node instanceof HTMLCanvasElement)) continue;
        if (node.width < 64 || node.height < 64) continue;
        try {
          return {
            qrcodeUrl: node.toDataURL('image/png'),
            summary: \`canvas:\${selector}:\${node.width}x\${node.height}\`,
          };
        } catch {}
      }
      const bodyText = (document.body?.innerText || '').trim();
      const hasQrHints = Boolean(
        document.querySelector('[class*="qrcode"]')
        || document.querySelector('[class*="qr-code"]')
        || document.querySelector('[class*="scan-QR-code"]')
        || bodyText.includes('扫码登录')
        || bodyText.includes('二维码登录')
        || bodyText.includes('Scan QR Code')
        || bodyText.includes('Log In With QR')
      );
      return {
        qrcodeUrl: null,
        summary: hasQrHints ? 'qr-hints-present-no-exportable-image' : 'qr-not-found',
      };
    })()`,
  ).catch(() => ({ qrcodeUrl: null, summary: 'probe-failed' }));
}

async function getRelevantFeishuCookies(networkSession: Session): Promise<Cookie[]> {
  const [accountsCookies, openCookies, passportCookies] = await Promise.all([
    networkSession.cookies.get({ url: FEISHU_ACCOUNTS_BASE_URL }),
    networkSession.cookies.get({ url: FEISHU_OPEN_BASE_URL }),
    networkSession.cookies.get({ url: FEISHU_PASSPORT_BASE_URL }),
  ]);

  const merged = new Map<string, Cookie>();
  for (const cookie of [...accountsCookies, ...openCookies, ...passportCookies]) {
    merged.set(`${cookie.domain}|${cookie.path}|${cookie.name}`, cookie);
  }
  return Array.from(merged.values());
}

async function captureCredentialsFromSession(
  networkSession: Session,
  loginUrl: string,
  timeoutMs = 20_000,
): Promise<FeishuLoginRequestContext> {
  const deadline = Date.now() + timeoutMs;
  let lastCookieNames: string[] = [];
  let lastWarmupAt = 0;

  while (Date.now() < deadline) {
    if (Date.now() - lastWarmupAt >= 3_000) {
      lastWarmupAt = Date.now();
      await fetchWithSession(networkSession, FEISHU_APP_LIST_URL, {
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          Referer: loginUrl,
          'User-Agent': FEISHU_USER_AGENT,
        },
        method: 'GET',
      }).catch(() => {});
    }

    const cookies = await getRelevantFeishuCookies(networkSession);
    lastCookieNames = cookies.map((cookie) => cookie.name).filter(Boolean);

    const sessionCookie = cookies.find((cookie) => cookie.name === 'session')?.value?.trim() || '';
    const csrfToken = cookies.find((cookie) => cookie.name === 'lark_oapi_csrf_token')?.value?.trim()
      || cookies.find((cookie) => cookie.name === 'swp_csrf_token')?.value?.trim()
      || '';
    const cookieString = buildCookieStringFromCookies(cookies);

    if (sessionCookie && cookieString && csrfToken) {
      const mergedCookieString = cookieString.includes('lark_oapi_csrf_token=')
        ? cookieString
        : buildMergedCookieString(`lark_oapi_csrf_token=${csrfToken}`, cookieString);

      return {
        cookieString: mergedCookieString,
        csrfToken,
      };
    }

    await delay(500);
  }

  throw new Error(`Failed to capture the Feishu login cookies after QR confirmation. Cookies seen: ${lastCookieNames.join(', ')}`);
}

async function captureInitializedCredentials(
  networkSession: Session,
  requestCookieString: string,
  csrfToken: string,
  fallbackContext: FeishuLoginRequestContext,
): Promise<Credentials> {
  const cookieBuckets = await Promise.all([
    networkSession.cookies.get({ url: `${FEISHU_API_BASE_URL}/app/list` }),
    networkSession.cookies.get({ url: FEISHU_OPEN_BASE_URL }),
    networkSession.cookies.get({ url: FEISHU_PASSPORT_BASE_URL }),
    networkSession.cookies.get({ url: FEISHU_ACCOUNTS_BASE_URL }),
  ]);

  const mergedCookies = new Map<string, { name: string; value: string }>();
  for (const bucket of cookieBuckets) {
    for (const cookie of bucket) {
      mergedCookies.set(`${cookie.domain}|${cookie.path}|${cookie.name}`, {
        name: cookie.name,
        value: cookie.value,
      });
    }
  }

  const contextCookieString = buildCookieStringFromContextCookies(Array.from(mergedCookies.values()));
  const baseCookieString = requestCookieString || fallbackContext.cookieString;
  const mergedCookieString = contextCookieString
    ? buildMergedCookieString(baseCookieString, contextCookieString)
    : baseCookieString;
  const csrfCookie = Array.from(mergedCookies.values()).find((cookie) => cookie.name === 'lark_oapi_csrf_token' || cookie.name === 'swp_csrf_token');
  const finalCsrfToken = csrfToken || csrfCookie?.value?.trim() || fallbackContext.csrfToken;

  if (!mergedCookieString) {
    throw new Error('Failed to capture Feishu cookies after login.');
  }
  if (!finalCsrfToken) {
    throw new Error('Failed to capture the Feishu CSRF token after login.');
  }

  const cookieString = mergedCookieString.includes('lark_oapi_csrf_token=')
    ? mergedCookieString
    : buildMergedCookieString(`lark_oapi_csrf_token=${finalCsrfToken}`, mergedCookieString);

  return {
    cookieString,
    csrfToken: finalCsrfToken,
    savedAt: Date.now(),
  };
}

function buildRequestHeaders(
  creds: Credentials,
  referer: string,
  contentType = 'application/json',
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain, */*',
    Cookie: creds.cookieString,
    Origin: FEISHU_OPEN_BASE_URL,
    Referer: referer,
    'User-Agent': FEISHU_USER_AGENT,
    'x-csrf-token': creds.csrfToken,
    'x-timezone-offset': '-480',
  };

  if (contentType) {
    headers['Content-Type'] = contentType;
  }

  return headers;
}

async function parseJsonResponse<T>(response: globalThis.Response, path: string): Promise<FeishuApiResponse<T>> {
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Feishu request failed (${path}): HTTP ${response.status} ${response.statusText} ${text.slice(0, 500)}`);
  }

  const payload = await response.json() as FeishuApiResponse<T>;
  if (payload.code !== 0) {
    throw new Error(`Feishu API error (${path}): code=${payload.code}, msg=${payload.msg || ''}`);
  }
  return payload;
}

async function postFeishuApi<T>(
  creds: Credentials,
  path: string,
  body: Record<string, unknown> = {},
  referer = FEISHU_APP_LIST_URL,
): Promise<FeishuApiResponse<T>> {
  const response = await proxyAwareFetch(`${FEISHU_API_BASE_URL}${path}`, {
    method: 'POST',
    headers: buildRequestHeaders(creds, referer),
    body: JSON.stringify(body),
  });
  return await parseJsonResponse<T>(response, path);
}

async function uploadDefaultAvatar(creds: Credentials): Promise<string> {
  const buffer = await readDefaultAvatar();
  const formData = new FormData();
  const blob = new Blob([buffer], { type: 'image/png' });
  formData.append('file', blob, 'tnyma-ai.png');
  formData.append('uploadType', '4');
  formData.append('isIsv', 'false');
  formData.append('scale', JSON.stringify({ width: 240, height: 240 }));

  const headers = buildRequestHeaders(creds, FEISHU_APP_LIST_URL, '');
  delete headers['Content-Type'];

  const response = await proxyAwareFetch(`${FEISHU_API_BASE_URL}/app/upload/image`, {
    method: 'POST',
    headers,
    body: formData,
  });

  const payload = await parseJsonResponse<{ url?: string }>(response, '/app/upload/image');
  const avatarUrl = payload.data.url?.trim();
  if (!avatarUrl) {
    throw new Error('Feishu did not return an avatar URL during app creation.');
  }
  return avatarUrl;
}

async function createFeishuApp(creds: Credentials, name: string, desc: string, avatar: string): Promise<string> {
  const response = await postFeishuApi<{ ClientID?: string }>(creds, '/app/create', {
    appSceneType: 0,
    name,
    desc,
    avatar,
    i18n: {
      zh_cn: {
        name,
        description: desc,
      },
    },
    primaryLang: 'zh_cn',
  });

  const appId = response.data.ClientID?.trim();
  if (!appId) {
    throw new Error('Feishu did not return an App ID.');
  }
  return appId;
}

async function getFeishuAppSecret(creds: Credentials, appId: string): Promise<string> {
  const response = await postFeishuApi<{ secret?: string }>(creds, `/secret/${appId}`, {}, `${FEISHU_OPEN_BASE_URL}/app/${appId}/baseinfo`);
  const appSecret = response.data.secret?.trim();
  if (!appSecret) {
    throw new Error('Feishu did not return an App Secret.');
  }
  return appSecret;
}

async function enableFeishuBot(creds: Credentials, appId: string): Promise<void> {
  const referer = `${FEISHU_OPEN_BASE_URL}/app/${appId}/baseinfo`;
  await postFeishuApi(creds, `/robot/switch/${appId}`, { enable: true }, referer);
  await postFeishuApi(creds, `/robot/${appId}`, {}, referer);
}

async function fetchAvailableScopes(creds: Credentials, appId: string): Promise<FeishuScopeRecord[]> {
  const response = await postFeishuApi<{ scopes?: FeishuScopeRecord[] }>(
    creds,
    `/scope/all/${appId}`,
    {},
    `${FEISHU_OPEN_BASE_URL}/app/${appId}/auth`,
  );
  return Array.isArray(response.data.scopes) ? response.data.scopes : [];
}

function resolveScopeIds(scopes: FeishuScopeRecord[]): ScopeResolutionResult {
  const scopeIds = new Set<string>();
  const scopeNames = new Map<string, Set<string>>();

  for (const scope of scopes) {
    const name = scope.name?.trim();
    const id = scope.id?.trim();
    if (!name || !id) continue;
    if (!scopeNames.has(name)) {
      scopeNames.set(name, new Set());
    }
    scopeNames.get(name)?.add(id);
  }

  const requestedNames = Array.from(new Set([...REQUESTED_SCOPE_NAMES, ...REQUIRED_APP_SCOPE_NAMES]));
  const unresolvedScopes: string[] = [];

  for (const requestedName of requestedNames) {
    const candidateNames = Array.from(new Set([requestedName, ...(SCOPE_NAME_ALIASES[requestedName] || [])]));
    let resolvedAny = false;

    for (const candidateName of candidateNames) {
      const resolvedIds = scopeNames.get(candidateName);
      if (resolvedIds && resolvedIds.size > 0) {
        resolvedAny = true;
        for (const id of resolvedIds) {
          scopeIds.add(id);
        }
        continue;
      }

      const fallbackId = FALLBACK_SCOPE_IDS[candidateName];
      if (fallbackId) {
        resolvedAny = true;
        scopeIds.add(fallbackId);
      }
    }

    if (!resolvedAny) {
      unresolvedScopes.push(requestedName);
    }
  }

  return {
    appScopeIDs: Array.from(scopeIds),
    unresolvedScopes,
  };
}

async function updateFeishuScopes(creds: Credentials, appId: string): Promise<string[]> {
  const availableScopes = await fetchAvailableScopes(creds, appId);
  const resolution = resolveScopeIds(availableScopes);
  if (resolution.appScopeIDs.length === 0) {
    throw new Error('Failed to resolve any Feishu scope IDs for the new bot.');
  }

  await postFeishuApi(
    creds,
    `/scope/update/${appId}`,
    {
      appScopeIDs: resolution.appScopeIDs,
      userScopeIDs: [],
      scopeIds: [],
      operation: 'add',
      isDeveloperPanel: true,
    },
    `${FEISHU_OPEN_BASE_URL}/app/${appId}/auth`,
  );

  return resolution.unresolvedScopes;
}

async function updateFeishuEvents(creds: Credentials, appId: string): Promise<void> {
  const referer = `${FEISHU_OPEN_BASE_URL}/app/${appId}/event`;
  await postFeishuApi(
    creds,
    `/event/update/${appId}`,
    {
      operation: 'add',
      events: [],
      appEvents: FEISHU_REQUIRED_EVENT_NAMES,
      userEvents: [],
      eventMode: FEISHU_EVENT_FORMAT_V2,
    },
    referer,
  );
}

async function switchFeishuCallbackMode(creds: Credentials, appId: string): Promise<void> {
  await postFeishuApi(
    creds,
    `/event/switch/${appId}`,
    { eventMode: FEISHU_EVENT_MODE_WEBSOCKET },
    `${FEISHU_OPEN_BASE_URL}/app/${appId}/event?tab=callback`,
  );
}

async function getCurrentUserId(creds: Credentials): Promise<string> {
  const response = await proxyAwareFetch(
    `${FEISHU_PASSPORT_BASE_URL}/accounts/web/user?app_id=7&support_anonymous=0&_t=${Date.now()}`,
    {
      headers: {
        Accept: 'application/json',
        Cookie: creds.cookieString,
        Origin: FEISHU_OPEN_BASE_URL,
        Referer: `${FEISHU_OPEN_BASE_URL}/`,
        'User-Agent': FEISHU_USER_AGENT,
        'X-Api-Version': '1.0.28',
        'X-App-Id': '7',
        'X-Device-Info': 'platform=websdk',
      },
    },
  );

  const payload = await parseJsonResponse<{ user?: { id?: string } }>(response, '/accounts/web/user');
  const userId = payload.data.user?.id?.trim();
  if (!userId) {
    throw new Error('Failed to read the current Feishu user ID.');
  }
  return userId;
}

async function createVersionAndPublish(creds: Credentials, appId: string, creatorId: string): Promise<string> {
  const referer = `${FEISHU_OPEN_BASE_URL}/app/${appId}/version/create`;
  const createResponse = await postFeishuApi<{ versionId?: string }>(
    creds,
    `/app_version/create/${appId}`,
    {
      appVersion: '0.0.1',
      mobileDefaultAbility: 'bot',
      pcDefaultAbility: 'bot',
      changeLog: '0.0.1',
      visibleSuggest: {
        departments: [],
        members: [creatorId],
        groups: [],
        isAll: 0,
      },
      applyReasonConfig: {
        apiPrivilegeNeedReason: false,
        contactPrivilegeNeedReason: false,
        dataPrivilegeReasonMap: {},
        visibleScopeNeedReason: false,
        apiPrivilegeReasonMap: {},
        contactPrivilegeReason: '',
        isDataPrivilegeExpandMap: {},
        visibleScopeReason: '',
        dataPrivilegeNeedReason: false,
        isAutoAudit: false,
        isContactExpand: false,
      },
      b2cShareSuggest: false,
      autoPublish: false,
      blackVisibleSuggest: {
        departments: [],
        members: [],
        groups: [],
        isAll: 0,
      },
    },
    referer,
  );

  const versionId = createResponse.data.versionId?.trim();
  if (!versionId) {
    throw new Error('Feishu did not return a version ID during publish.');
  }

  await postFeishuApi(
    creds,
    `/publish/commit/${appId}/${versionId}`,
    {},
    `${FEISHU_OPEN_BASE_URL}/app/${appId}/version/${versionId}`,
  );

  return versionId;
}

async function fetchFeishuTenantAccessToken(appId: string, appSecret: string): Promise<string> {
  const response = await proxyAwareFetchWithTimeout(
    FEISHU_TENANT_ACCESS_TOKEN_URL,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': FEISHU_USER_AGENT,
      },
      body: JSON.stringify({
        app_id: appId,
        app_secret: appSecret,
      }),
    },
    WELCOME_MESSAGE_TIMEOUT_MS,
  );

  const raw = await response.text();
  let payload: FeishuTenantAccessTokenResponse;
  try {
    payload = JSON.parse(raw) as FeishuTenantAccessTokenResponse;
  } catch (error) {
    throw new Error(`Failed to parse Feishu tenant token response: ${String(error)}`, { cause: error });
  }

  if (!response.ok || payload.code !== 0 || !payload.tenant_access_token?.trim()) {
    throw new Error(
      `Failed to get Feishu tenant access token: HTTP ${response.status} code=${String(payload.code ?? 'unknown')} msg=${payload.msg || raw.slice(0, 200)}`,
    );
  }

  return payload.tenant_access_token.trim();
}

async function fetchFeishuAppOwnerOpenId(appId: string, tenantAccessToken: string): Promise<string> {
  const response = await proxyAwareFetchWithTimeout(
    `${FEISHU_OPEN_BASE_URL}/open-apis/application/v6/applications/${encodeURIComponent(appId)}?lang=zh_cn`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${tenantAccessToken}`,
        'User-Agent': FEISHU_USER_AGENT,
      },
    },
    WELCOME_MESSAGE_TIMEOUT_MS,
  );

  const payload = await parseJsonResponse<{ app?: FeishuApplicationRecord }>(
    response,
    `/open-apis/application/v6/applications/${appId}`,
  );
  const app = payload.data?.app;
  const creatorId = app?.creator_id?.trim() || '';
  const ownerId = app?.owner?.owner_id?.trim() || '';
  const ownerType = app?.owner?.owner_type ?? app?.owner?.type;
  const effectiveOwnerOpenId = ownerType === 2 && ownerId
    ? ownerId
    : (ownerId.startsWith('ou_') ? ownerId : (creatorId.startsWith('ou_') ? creatorId : ''));

  if (!effectiveOwnerOpenId) {
    throw new Error(
      `Feishu application owner open_id was not available (ownerType=${String(ownerType ?? 'unknown')} ownerId=${ownerId || 'missing'} creatorId=${creatorId || 'missing'})`,
    );
  }

  return effectiveOwnerOpenId;
}

function getFeishuReceiveIdTypes(creatorId: string): string[] {
  if (creatorId.startsWith('ou_')) {
    return ['open_id', 'user_id'];
  }
  return ['user_id', 'open_id'];
}

async function sendFeishuWelcomeMessage(
  appId: string,
  appSecret: string,
  creatorId: string,
  content: string,
): Promise<void> {
  const tenantAccessToken = await fetchFeishuTenantAccessToken(appId, appSecret);
  const ownerOpenId = await fetchFeishuAppOwnerOpenId(appId, tenantAccessToken).catch((error) => {
    logger.warn(`Feishu auto-create failed to resolve owner open_id from app info: ${String(error)}`);
    return '';
  });
  const candidateIds = Array.from(new Set([ownerOpenId, creatorId].map((value) => value.trim()).filter(Boolean)));
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= WELCOME_MESSAGE_RETRY_COUNT; attempt += 1) {
    for (const candidateId of candidateIds) {
      const receiveIdTypes = getFeishuReceiveIdTypes(candidateId);
      for (const receiveIdType of receiveIdTypes) {
        try {
          const response = await proxyAwareFetchWithTimeout(
            `${FEISHU_IM_API_BASE_URL}/messages?receive_id_type=${encodeURIComponent(receiveIdType)}`,
            {
              method: 'POST',
              headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${tenantAccessToken}`,
                'Content-Type': 'application/json',
                'User-Agent': FEISHU_USER_AGENT,
              },
              body: JSON.stringify({
                content: JSON.stringify({ text: content }),
                msg_type: 'text',
                receive_id: candidateId,
              }),
            },
            WELCOME_MESSAGE_TIMEOUT_MS,
          );
          const payload = await parseJsonResponse<{ message_id?: string }>(
            response,
            `/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`,
          );
          const messageId = payload.data.message_id?.trim() || 'unknown';
          logger.info(
            `Feishu auto-create sent welcome message: appId=${appId} receiveIdType=${receiveIdType} receiveId=${candidateId} messageId=${messageId}`,
          );
          return;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
        }
      }
    }

    if (attempt < WELCOME_MESSAGE_RETRY_COUNT) {
      await delay(1_500);
    }
  }

  throw lastError ?? new Error('Failed to send Feishu welcome message.');
}

class FeishuAutoCreateSession extends EventEmitter {
  readonly sessionKey = randomUUID();

  private readonly firstQr = createDeferred<string>();
  private readonly loginConfirmed = createDeferred<void>();
  private readonly completion = createDeferred<FeishuAutoCreateResult>();
  private readonly runPromise: Promise<void>;
  private cancelled = false;
  private closed = false;
  private cleanupPromise: Promise<void> | null = null;
  private loginWindow: BrowserWindow | null = null;
  private networkSession: Session | null = null;
  private readonly sessionPartition = `feishu-auto-create:${this.sessionKey}`;
  private loginUrl = buildLoginUrl(FEISHU_OPEN_ROOT_URL);
  private latestQrDataUrl: string | null = null;
  private latestQrContent: string | null = null;
  private credentialsReadyHook: ((payload: FeishuCredentialsReadyPayload) => void | Promise<void>) | null = null;
  private firstQrDelivered = false;
  private refreshingLoginPage = false;
  private requestCookieString = '';
  private csrfToken = '';
  private readonly pendingDebugRequests = new Map<string, string>();

  constructor(private readonly options: FeishuAutoCreateStartOptions) {
    super();
    this.runPromise = this.run();
    this.runPromise.catch((error) => {
      if (this.cancelled || this.closed) {
        return;
      }
      this.fail(error);
    });
  }

  async start(): Promise<FeishuAutoCreateStartResult> {
    logger.info(`Feishu auto-create session start requested: sessionKey=${this.sessionKey}`);
    const qrcodeUrl = await withTimeout(
      this.firstQr.promise,
      FIRST_QR_TIMEOUT_MS,
      'Timed out waiting for the initial Feishu QR code.',
    );

    return {
      sessionKey: this.sessionKey,
      qrcodeUrl,
      message: 'Scan the QR code with Feishu to create and publish the bot automatically.',
    };
  }

  async wait(options: FeishuAutoCreateWaitOptions): Promise<FeishuAutoCreateResult> {
    this.credentialsReadyHook = options.onCredentialsReady ?? null;

    const onQrRefresh = options.onQrRefresh
      ? async (payload: SessionQrPayload) => {
          try {
            await options.onQrRefresh?.(payload);
          } catch {
            // Ignore UI callback failures and keep the login session alive.
          }
        }
      : null;

    const onProgress = options.onProgress
      ? async (payload: AutoCreateProgressPayload) => {
          try {
            await options.onProgress?.(payload);
          } catch {
            // Ignore UI callback failures and keep the login session alive.
          }
        }
      : null;

    if (onQrRefresh) {
      this.on(SESSION_EVENT_QR, onQrRefresh);
      if (this.latestQrDataUrl) {
        void onQrRefresh({ qrcodeUrl: this.latestQrDataUrl });
      }
    }

    if (onProgress) {
      this.on(SESSION_EVENT_PROGRESS, onProgress);
    }

    try {
      return await withTimeout(
        this.completion.promise,
        options.timeoutMs ?? SESSION_TIMEOUT_MS,
        'Timed out waiting for Feishu bot creation to finish.',
      );
    } finally {
      if (onQrRefresh) {
        this.off(SESSION_EVENT_QR, onQrRefresh);
      }
      if (onProgress) {
        this.off(SESSION_EVENT_PROGRESS, onProgress);
      }
    }
  }

  async cancel(): Promise<void> {
    if (this.cancelled) {
      await this.cleanup();
      return;
    }
    this.cancelled = true;
    const error = new Error('Feishu login was cancelled.');
    if (!this.closed) {
      this.closed = true;
      this.firstQr.reject(error);
      this.completion.reject(error);
    }
    await this.cleanup();
  }

  private async run(): Promise<void> {
    logger.info(`Feishu auto-create session boot: sessionKey=${this.sessionKey}`);
    this.publishProgress('waiting_for_scan', 'running');

    this.networkSession = await createRequestSession(this.sessionPartition);
    logger.info(`Feishu auto-create session created request session: partition=${this.sessionPartition}`);
    this.bindDeveloperRequestCapture();
    this.loginWindow = await createLoginWindow(this.sessionPartition);
    logger.info('Feishu auto-create session created hidden login window');
    await loadFeishuLoginPage(this.loginWindow, this.loginUrl);
    logger.info(`Feishu auto-create login page loaded: ${this.loginUrl}`);
    await this.attachLoginDebuggerBestEffort();
    const qrActivated = await activateFeishuQrLogin(this.loginWindow);
    logger.info(`Feishu auto-create QR login activation attempted: activated=${String(qrActivated)}`);
    await this.publishExistingQrFromLoginPage('after initial qr activation');
    await this.waitForInitialQrFromLoginPage();
    await withTimeout(
      this.firstQr.promise,
      FIRST_QR_TIMEOUT_MS,
      'Timed out waiting for the initial Feishu QR code.',
    );
    logger.info('Feishu auto-create initial QR delivered to renderer');

    const requestContextPromise = captureCredentialsFromSession(
      this.networkSession,
      this.loginUrl,
      LOGIN_TIMEOUT_MS,
    );
    await Promise.race([
      requestContextPromise.then(() => {
        logger.info('Feishu auto-create login inferred from session cookies');
      }),
      withTimeout(
        this.loginConfirmed.promise,
        LOGIN_TIMEOUT_MS,
        'Timed out waiting for Feishu login confirmation.',
      ).then(() => {
        logger.info('Feishu auto-create login confirmed by QR polling state');
      }),
    ]);
    const requestContext = await requestContextPromise;
    logger.info('Feishu auto-create captured Feishu credentials from session cookies');

    this.publishProgress('waiting_for_scan', 'completed');
    this.publishProgress('creating_bot', 'running');
    const creds = await this.initializeOpenPlatformCredentials(requestContext);
    const name = normalizeAppName(this.options.appName);
    const desc = normalizeAppDescription(this.options.appDescription);
    const avatar = await uploadDefaultAvatar(creds);
    const appId = await createFeishuApp(creds, name, desc, avatar);
    const appSecret = await getFeishuAppSecret(creds, appId);
    logger.info(`Feishu auto-create created app: appId=${appId}`);

    await enableFeishuBot(creds, appId);
    this.publishProgress('creating_bot', 'completed');
    this.publishProgress('saving_credentials', 'running');

    if (this.credentialsReadyHook) {
      await this.credentialsReadyHook({
        appId,
        appSecret,
        connectionMode: 'websocket',
      });
    }
    this.publishProgress('saving_credentials', 'completed');

    this.publishProgress('configuring_bot', 'running');
    const unresolvedScopes = await updateFeishuScopes(creds, appId);
    await updateFeishuEvents(creds, appId);
    await switchFeishuCallbackMode(creds, appId);
    this.publishProgress('configuring_bot', 'completed');
    this.publishProgress('publishing_bot', 'running');
    const creatorId = await getCurrentUserId(creds);
    const versionId = await createVersionAndPublish(creds, appId, creatorId);
    logger.info(`Feishu auto-create published app version: appId=${appId} versionId=${versionId}`);
    this.publishProgress('publishing_bot', 'completed');
    await sendFeishuWelcomeMessage(appId, appSecret, creatorId, buildAutoCreateWelcomeMessage(name)).catch((error) => {
      logger.warn(`Feishu auto-create welcome message failed: ${String(error)}`);
    });

    this.complete({
      appId,
      appSecret,
      versionId,
      name,
      desc,
      unresolvedScopes,
    });
  }

  private async publishQrContent(qrContent: string, logMessage?: string): Promise<void> {
    if (qrContent === this.latestQrContent) {
      return;
    }
    this.latestQrContent = qrContent;
    const qrcodeUrl = renderQrPngDataUrl(qrContent);
    this.publishQr(qrcodeUrl);
    if (logMessage) {
      logger.info(logMessage);
    }
  }

  private async publishQrToken(token: string, logMessage?: string): Promise<void> {
    await this.publishQrContent(buildQrContentFromToken(token), logMessage);
  }

  private publishQr(qrcodeUrl: string): void {
    this.latestQrDataUrl = qrcodeUrl;
    if (!this.firstQrDelivered) {
      this.firstQrDelivered = true;
      this.firstQr.resolve(qrcodeUrl);
    }
    this.emit(SESSION_EVENT_QR, { qrcodeUrl });
  }

  private publishProgress(stepId: string, status: AutoCreateProgressPayload['status']): void {
    this.emit(SESSION_EVENT_PROGRESS, { stepId, status });
  }

  private async publishExistingQrFromLoginPage(reason: string): Promise<void> {
    if (this.firstQrDelivered || this.cancelled || this.closed || !this.loginWindow) {
      return;
    }
    const probe = await captureRenderedQrFromLoginPage(this.loginWindow);
    if (probe.qrcodeUrl) {
      this.publishQr(probe.qrcodeUrl);
      logger.info(`Captured Feishu QR code from login page DOM (${reason}; ${probe.summary})`);
      return;
    }
    logger.info(`Feishu QR DOM probe did not find a renderable QR (${reason}; ${probe.summary})`);
  }

  private bindDeveloperRequestCapture(): void {
    if (!this.networkSession) {
      return;
    }

    this.networkSession.webRequest.onBeforeSendHeaders(
      { urls: [`${FEISHU_OPEN_BASE_URL}/developers/*`] },
      (details, callback) => {
        const headers = details.requestHeaders ?? {};
        const cookie = readHeaderValue(headers, 'cookie');
        if (cookie) {
          this.requestCookieString = cookie;
        }
        const csrf = readHeaderValue(headers, 'x-csrf-token');
        if (csrf) {
          this.csrfToken = csrf;
        }
        callback({ requestHeaders: details.requestHeaders });
      },
    );
  }

  private async initializeOpenPlatformCredentials(
    fallbackContext: FeishuLoginRequestContext,
  ): Promise<Credentials> {
    if (!this.loginWindow || !this.networkSession) {
      throw new Error('Feishu login session is not available.');
    }

    logger.info('Feishu auto-create loading Open Platform app page to initialize developer request credentials');
    await loadFeishuLoginPage(this.loginWindow, FEISHU_APP_LIST_URL);

    const deadline = Date.now() + 10_000;
    while (!this.csrfToken && Date.now() < deadline) {
      await delay(250);
    }

    const creds = await captureInitializedCredentials(
      this.networkSession,
      this.requestCookieString,
      this.csrfToken,
      fallbackContext,
    );
    logger.info(
      'Feishu auto-create initialized Open Platform credentials '
      + `(csrf=${this.csrfToken ? 'header' : 'cookie-fallback'} cookie=${this.requestCookieString ? 'request-header' : 'session-cookie'})`,
    );
    return creds;
  }

  private async waitForInitialQrFromLoginPage(): Promise<void> {
    if (this.firstQrDelivered || this.cancelled || this.closed || !this.loginWindow) {
      return;
    }

    const deadline = Date.now() + FIRST_QR_TIMEOUT_MS;
    let attempt = 0;
    while (!this.firstQrDelivered && !this.cancelled && !this.closed && Date.now() < deadline) {
      attempt += 1;
      await this.publishExistingQrFromLoginPage(`initial qr poll #${attempt}`);
      if (this.firstQrDelivered) {
        return;
      }
      if (attempt % 6 === 0) {
        const qrActivated = await activateFeishuQrLogin(this.loginWindow).catch(() => false);
        logger.info(`Feishu auto-create QR login re-activation attempted during QR wait: activated=${String(qrActivated)}`);
      }
      await delay(500);
    }

    if (!this.firstQrDelivered && !this.cancelled && !this.closed) {
      throw new Error('Timed out waiting for the initial Feishu QR code.');
    }
  }

  private async attachLoginDebuggerBestEffort(): Promise<void> {
    logger.info('Feishu auto-create session attempting debugger attach after login page load');
    await withTimeout(
      this.attachLoginDebugger(),
      DEBUGGER_ATTACH_TIMEOUT_MS,
      'Timed out while attaching the Feishu login debugger.',
    )
      .then(() => {
        logger.info('Feishu auto-create session attached debugger after login page load');
      })
      .catch((error) => {
        logger.warn(`Feishu auto-create session continuing without debugger: ${String(error)}`);
      });
  }

  private async attachLoginDebugger(): Promise<void> {
    const loginWindow = this.loginWindow;
    if (!loginWindow) {
      throw new Error('Feishu login window is not available.');
    }

    if (!loginWindow.webContents.debugger.isAttached()) {
      loginWindow.webContents.debugger.attach('1.3');
    }
    loginWindow.webContents.debugger.on('message', (_event, method, params) => {
      void this.handleDebuggerMessage(method, params as ChromeDebuggerEvent);
    });
    await loginWindow.webContents.debugger.sendCommand('Network.enable');
  }

  private async handleDebuggerMessage(method: string, params: ChromeDebuggerEvent): Promise<void> {
    if (this.cancelled || this.closed) {
      return;
    }

    if (method === 'Network.responseReceived') {
      const requestId = params.requestId;
      const url = params.response?.url || '';
      if (!requestId) {
        return;
      }
      if (url.includes('/accounts/qrlogin/init')) {
        logger.info('Feishu login page observed /accounts/qrlogin/init response');
        this.pendingDebugRequests.set(requestId, 'init');
      } else if (url.includes('/accounts/qrlogin/polling')) {
        logger.info('Feishu login page observed /accounts/qrlogin/polling response');
        this.pendingDebugRequests.set(requestId, 'poll');
      }
      return;
    }

    if (method === 'Network.loadingFailed') {
      const requestId = params.requestId;
      if (!requestId) {
        return;
      }
      const kind = this.pendingDebugRequests.get(requestId);
      if (!kind) {
        return;
      }
      this.pendingDebugRequests.delete(requestId);
      logger.warn(
        `Feishu ${kind} request failed in login page: ${params.errorText || 'unknown error'}`
        + (params.blockedReason ? ` blocked=${params.blockedReason}` : ''),
      );
      return;
    }

    if (method !== 'Network.loadingFinished') {
      return;
    }

    const requestId = params.requestId;
    if (!requestId) {
      return;
    }

    const kind = this.pendingDebugRequests.get(requestId);
    if (!kind) {
      return;
    }
    this.pendingDebugRequests.delete(requestId);

    const loginWindow = this.loginWindow;
    if (!loginWindow || loginWindow.isDestroyed() || !loginWindow.webContents.debugger.isAttached()) {
      return;
    }

    const bodyResult = await loginWindow.webContents.debugger.sendCommand('Network.getResponseBody', { requestId }).catch(() => null);
    const rawBody = typeof bodyResult?.body === 'string'
      ? (bodyResult.base64Encoded ? Buffer.from(bodyResult.body, 'base64').toString('utf8') : bodyResult.body)
      : '';
    if (!rawBody) {
      return;
    }

    let payload: FeishuApiResponse<FeishuQrPollingPayload>;
    try {
      payload = JSON.parse(rawBody) as FeishuApiResponse<FeishuQrPollingPayload>;
    } catch {
      logger.warn(`Feishu debugger response body was not valid JSON for request kind=${kind}`);
      return;
    }
    if (payload.code !== 0) {
      logger.warn(`Feishu debugger response returned non-zero code for kind=${kind}: code=${payload.code} msg=${payload.msg || ''}`);
      return;
    }

    if (kind === 'init') {
      const token = payload.data?.step_info?.token?.trim();
      if (token) {
        await this.publishQrToken(token, 'Rendered Feishu QR code from official login-page init response');
      } else {
        logger.warn('Feishu debugger init response did not include a QR token');
      }
      return;
    }

    const nextStep = payload.data?.next_step;
    const status = payload.data?.step_info?.status;
    logger.info(`Feishu QR polling status received: status=${String(status)} nextStep=${nextStep || ''}`);
    if (!this.firstQrDelivered) {
      await this.publishExistingQrFromLoginPage('after qr polling response');
    }
    if (nextStep && nextStep !== FEISHU_QR_POLLING_STEP) {
      logger.info(`Feishu QR flow advanced to next_step=${nextStep}`);
      this.loginConfirmed.resolve();
      return;
    }

    if (status === 0) {
      logger.info('Feishu QR polling reported login success');
      this.loginConfirmed.resolve();
      return;
    }
    if (status === 5) {
      await this.refreshLoginPage();
      return;
    }
    if (status === 3) {
      this.loginConfirmed.reject(new Error('Feishu QR authorization was cancelled.'));
      return;
    }
    if (status === 4) {
      this.loginConfirmed.reject(new Error('Feishu QR login failed.'));
    }
  }

  private async refreshLoginPage(): Promise<void> {
    if (this.refreshingLoginPage || this.cancelled || this.closed || !this.loginWindow) {
      return;
    }
    this.refreshingLoginPage = true;
    try {
      logger.info('Feishu QR expired, reloading login page to refresh QR');
      await loadFeishuLoginPage(this.loginWindow, this.loginUrl);
      const qrActivated = await activateFeishuQrLogin(this.loginWindow);
      logger.info(`Feishu QR login activation attempted after refresh: activated=${String(qrActivated)}`);
      await this.publishExistingQrFromLoginPage('after qr refresh');
    } finally {
      this.refreshingLoginPage = false;
    }
  }

  private complete(result: FeishuAutoCreateResult): void {
    if (this.closed) return;
    this.closed = true;
    this.completion.resolve(result);
    void this.cleanup();
  }

  private fail(error: unknown): void {
    if (this.closed) return;
    this.closed = true;
    logger.error(`Feishu auto-create session failed: ${String(error)}`);
    this.publishProgress('failed', 'error');
    this.firstQr.reject(error);
    this.completion.reject(error);
    void this.cleanup();
  }

  private async cleanup(): Promise<void> {
    if (this.cleanupPromise) {
      await this.cleanupPromise;
      return;
    }

    this.cleanupPromise = (async () => {
      const loginWindow = this.loginWindow;
      this.loginWindow = null;
      const networkSession = this.networkSession;
      this.networkSession = null;

      if (loginWindow && !loginWindow.isDestroyed()) {
        if (loginWindow.webContents.debugger.isAttached()) {
          try {
            loginWindow.webContents.debugger.detach();
          } catch {
            // Ignore debugger detach errors during cleanup.
          }
        }
        loginWindow.destroy();
      }
      logger.info('Feishu auto-create cleanup finished');

      if (networkSession) {
        await networkSession.clearStorageData().catch(() => {});
      }
    })();

    try {
      await this.cleanupPromise;
    } finally {
      this.cleanupPromise = null;
    }
  }
}

const feishuAutoCreateSessions = new Map<string, FeishuAutoCreateSession>();

export async function startFeishuAutoCreateSession(
  options: FeishuAutoCreateStartOptions,
): Promise<FeishuAutoCreateStartResult> {
  const session = new FeishuAutoCreateSession(options);
  feishuAutoCreateSessions.set(session.sessionKey, session);

  try {
    return await session.start();
  } catch (error) {
    feishuAutoCreateSessions.delete(session.sessionKey);
    await session.cancel().catch(() => {});
    throw error;
  }
}

export async function waitForFeishuAutoCreateSession(
  sessionKey: string,
  options: FeishuAutoCreateWaitOptions = {},
): Promise<FeishuAutoCreateResult> {
  const session = feishuAutoCreateSessions.get(sessionKey);
  if (!session) {
    throw new Error(`Feishu auto-create session "${sessionKey}" was not found.`);
  }

  try {
    return await session.wait(options);
  } finally {
    feishuAutoCreateSessions.delete(sessionKey);
  }
}

export async function cancelFeishuAutoCreateSession(sessionKey: string): Promise<void> {
  const session = feishuAutoCreateSessions.get(sessionKey);
  feishuAutoCreateSessions.delete(sessionKey);
  if (!session) return;
  await session.cancel();
}
