import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';
import type { BrowserWindow, Session } from 'electron';
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
const FEISHU_APP_LIST_URL = `${FEISHU_OPEN_BASE_URL}/app`;
const FEISHU_EVENT_MODE_WEBSOCKET = 4;
const FEISHU_EVENT_FORMAT_V2 = 1;
const LOGIN_TIMEOUT_MS = 8 * 60_000;
const FIRST_QR_TIMEOUT_MS = 30_000;
const SESSION_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_APP_DESCRIPTION = 'Created by TnymaAI';
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

function buildLoginUrl(redirectUri: string): string {
  return `${FEISHU_ACCOUNTS_BASE_URL}/accounts/page/login?app_id=7&no_trap=1&redirect_uri=${encodeURIComponent(redirectUri)}`;
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

async function createHiddenWindow(partition: string): Promise<BrowserWindow> {
  if (!process.versions.electron) {
    throw new Error('Feishu auto-create requires Electron main-process windows.');
  }

  const { BrowserWindow } = await import('electron');
  const window = new BrowserWindow({
    focusable: false,
    frame: false,
    hasShadow: false,
    roundedCorners: false,
    show: true,
    skipTaskbar: true,
    width: 960,
    height: 720,
    x: -10_000,
    y: -10_000,
    webPreferences: {
      backgroundThrottling: false,
      partition,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  window.webContents.setUserAgent(FEISHU_USER_AGENT);
  window.setIgnoreMouseEvents(true);
  return window;
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

function buildCookieStringFromContextCookies(cookies: Array<{ name: string; value: string }>): string {
  return cookies
    .filter((cookie) => cookie.name && cookie.value !== undefined)
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
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

async function waitForOpenPlatformNavigation(webContents: import('electron').WebContents): Promise<void> {
  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (webContents.isDestroyed()) {
      throw new Error('Feishu login window closed before the Open Platform page loaded.');
    }
    const url = webContents.getURL();
    if (url.startsWith(FEISHU_OPEN_BASE_URL) && !url.startsWith(`${FEISHU_ACCOUNTS_BASE_URL}/accounts/page/login`)) {
      return;
    }
    await delay(1000);
  }
  throw new Error('Timed out waiting for Feishu login confirmation.');
}

async function captureCredentials(
  networkSession: Session,
  requestCookieString: string,
  csrfToken: string,
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
  const mergedCookieString = buildMergedCookieString(requestCookieString, contextCookieString);
  const csrfCookie = Array.from(mergedCookies.values()).find((cookie) => cookie.name === 'lark_oapi_csrf_token' || cookie.name === 'swp_csrf_token');
  const finalCsrfToken = csrfToken || csrfCookie?.value?.trim() || '';

  if (!mergedCookieString) {
    throw new Error('Failed to capture Feishu cookies after login.');
  }
  if (!finalCsrfToken) {
    throw new Error('Failed to capture the Feishu CSRF token after login.');
  }

  const cookieString = mergedCookieString.includes('lark_oapi_csrf_token=')
    ? mergedCookieString
    : `${mergedCookieString}; lark_oapi_csrf_token=${finalCsrfToken}`;

  return {
    cookieString,
    csrfToken: finalCsrfToken,
    savedAt: Date.now(),
  };
}

class FeishuAutoCreateSession extends EventEmitter {
  readonly sessionKey = randomUUID();

  private readonly firstQr = createDeferred<string>();
  private readonly completion = createDeferred<FeishuAutoCreateResult>();
  private readonly runPromise: Promise<void>;
  private readonly sessionPartition = `feishu-auto-create:${this.sessionKey}`;
  private readonly trackedResponseUrls = new Map<string, string>();
  private cancelled = false;
  private closed = false;
  private cleanupPromise: Promise<void> | null = null;
  private networkSession: Session | null = null;
  private qrWindow: BrowserWindow | null = null;
  private latestQrDataUrl: string | null = null;
  private refreshInFlight: Promise<void> | null = null;
  private credentialsReadyHook: ((payload: FeishuCredentialsReadyPayload) => void | Promise<void>) | null = null;
  private firstQrDelivered = false;
  private requestCookieString = '';
  private csrfToken = '';
  private scanCompleted = false;

  private readonly onDebuggerMessage = (_event: unknown, method: string, params: Record<string, unknown>) => {
    void this.handleDebuggerMessage(method, params).catch((error) => {
      if (this.cancelled || this.closed) {
        return;
      }
      this.fail(error);
    });
  };

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
    this.publishProgress('waiting_for_scan', 'running');

    this.networkSession = await createRequestSession(this.sessionPartition);
    this.bindDeveloperRequestCapture();
    this.qrWindow = await createHiddenWindow(this.sessionPartition);
    this.bindWindowLifecycleHandlers(this.qrWindow);
    this.bindInitResponseCapture();
    await this.attachDebugger();
    await this.qrWindow.loadURL(buildLoginUrl(FEISHU_APP_LIST_URL));
    this.startTokenPollingFallback();

    await waitForOpenPlatformNavigation(this.qrWindow.webContents);

    if (this.cancelled) {
      throw new Error('Feishu login was cancelled.');
    }

    this.scanCompleted = true;
    this.publishProgress('waiting_for_scan', 'completed');
    this.publishProgress('creating_bot', 'running');

    await this.qrWindow.loadURL(FEISHU_APP_LIST_URL);
    await delay(1_500);

    const captureDeadline = Date.now() + 10_000;
    while (!this.csrfToken && Date.now() < captureDeadline) {
      await delay(250);
    }

    const creds = await captureCredentials(this.networkSession, this.requestCookieString, this.csrfToken);
    const name = normalizeAppName(this.options.appName);
    const desc = normalizeAppDescription(this.options.appDescription);
    const avatar = await uploadDefaultAvatar(creds);
    const appId = await createFeishuApp(creds, name, desc, avatar);
    const appSecret = await getFeishuAppSecret(creds, appId);

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
    this.publishProgress('publishing_bot', 'completed');

    this.complete({
      appId,
      appSecret,
      versionId,
      name,
      desc,
      unresolvedScopes,
    });
  }

  private bindDeveloperRequestCapture(): void {
    if (!this.networkSession) {
      return;
    }

    this.networkSession.webRequest.onBeforeSendHeaders(
      { urls: [`${FEISHU_OPEN_BASE_URL}/developers/*`] },
      (details, callback) => {
        const headers = details.requestHeaders ?? {};
        if (!this.requestCookieString) {
          const cookie = readHeaderValue(headers, 'cookie');
          if (cookie) {
            this.requestCookieString = cookie;
          }
        }
        if (!this.csrfToken) {
          const csrf = readHeaderValue(headers, 'x-csrf-token');
          if (csrf) {
            this.csrfToken = csrf;
          }
        }
        callback({ requestHeaders: details.requestHeaders });
      },
    );
  }

  private bindWindowLifecycleHandlers(qrWindow: BrowserWindow): void {
    qrWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || this.cancelled || this.closed) {
        return;
      }
      this.fail(new Error(`Feishu login page failed to load (${errorCode}): ${errorDescription || validatedURL}`));
    });

    qrWindow.webContents.on('render-process-gone', (_event, details) => {
      if (this.cancelled || this.closed) {
        return;
      }
      this.fail(new Error(`Feishu login page crashed: ${details.reason}`));
    });

    qrWindow.on('closed', () => {
      if (this.cancelled || this.closed) {
        return;
      }
      this.fail(new Error('Feishu login window closed unexpectedly.'));
    });
  }

  private async attachDebugger(): Promise<void> {
    if (!this.qrWindow) {
      throw new Error('Feishu hidden window was not created.');
    }

    try {
      const { debugger: debuggerApi } = this.qrWindow.webContents;
      if (!debuggerApi.isAttached()) {
        debuggerApi.attach('1.3');
      }
      debuggerApi.on('message', this.onDebuggerMessage);
      await debuggerApi.sendCommand('Network.enable');
      logger.info('Feishu CDP debugger attached successfully');
    } catch (error) {
      logger.warn('Feishu CDP debugger attach failed, relying on fallback token polling:', error);
    }
  }

  private bindInitResponseCapture(): void {
    if (!this.networkSession) {
      return;
    }

    this.networkSession.webRequest.onCompleted(
      { urls: [`${FEISHU_ACCOUNTS_BASE_URL}/accounts/qrlogin/*`] },
      (details) => {
        if (this.cancelled || this.closed || this.scanCompleted) {
          return;
        }
        const url = details.url || '';
        if (url.includes('/qrlogin/init')) {
          logger.info('Feishu qrlogin/init request completed (webRequest hook), will poll for token');
          void this.pollTokenFromPage();
        }
      },
    );
  }

  private async pollTokenFromPage(): Promise<void> {
    if (this.firstQrDelivered || this.cancelled || this.closed || !this.qrWindow) {
      return;
    }

    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (this.firstQrDelivered || this.cancelled || this.closed) {
        return;
      }

      const qrWindow = this.qrWindow;
      if (!qrWindow || qrWindow.isDestroyed() || qrWindow.webContents.isDestroyed()) {
        return;
      }

      try {
        const token = await qrWindow.webContents.executeJavaScript(`
          (() => {
            try {
              const selectors = [
                '[class*="qrcode"] canvas',
                '[class*="qr-code"] canvas',
                '.newLogin_scan-QR-code canvas',
                'canvas',
              ];
              for (const sel of selectors) {
                const c = document.querySelector(sel);
                if (c && c.width >= 64 && c.height >= 64) return '__CANVAS_FOUND__';
              }
            } catch {}
            return null;
          })();
        `, true);

        if (token === '__CANVAS_FOUND__' && !this.firstQrDelivered) {
          // Canvas found but we need the actual token. Try extracting from React internals.
          const extractedToken = await qrWindow.webContents.executeJavaScript(`
            (() => {
              try {
                // The QR code renders JSON.stringify({qrlogin: {token}}) - try to find it in React fiber
                const walk = (node) => {
                  if (!node) return null;
                  const props = node.memoizedProps || node.pendingProps || {};
                  if (props.value && typeof props.value === 'string' && props.value.includes('qrlogin')) {
                    try { const p = JSON.parse(props.value); if (p.qrlogin?.token) return p.qrlogin.token; } catch {}
                  }
                  if (props.children) {
                    if (Array.isArray(props.children)) {
                      for (const c of props.children) { const r = walk(c?._owner?.stateNode?.__fiber || c); if (r) return r; }
                    }
                  }
                  let child = node.child;
                  while (child) { const r = walk(child); if (r) return r; child = child.sibling; }
                  return null;
                };
                const root = document.querySelector('#root') || document.querySelector('#app');
                if (root && root._reactRootContainer) return walk(root._reactRootContainer._internalRoot?.current);
                if (root) {
                  const key = Object.keys(root).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
                  if (key) return walk(root[key]);
                }
              } catch {}
              return null;
            })();
          `, true);

          if (typeof extractedToken === 'string' && extractedToken.length > 0) {
            const qrContent = buildQrContentFromToken(extractedToken);
            const qrcodeUrl = renderQrPngDataUrl(qrContent);
            this.publishQr(qrcodeUrl);
            logger.info('Rendered Feishu QR code from page-extracted token (fallback)');
            return;
          }

          // Last resort: capture the canvas directly from the page
          const canvasDataUrl = await qrWindow.webContents.executeJavaScript(`
            (() => {
              const selectors = [
                '[class*="qrcode"] canvas',
                '[class*="qr-code"] canvas',
                '.newLogin_scan-QR-code canvas',
                'canvas',
              ];
              for (const sel of selectors) {
                const c = document.querySelector(sel);
                if (c && c instanceof HTMLCanvasElement && c.width >= 64 && c.height >= 64) {
                  try { return c.toDataURL('image/png'); } catch {}
                }
              }
              return null;
            })();
          `, true);

          if (typeof canvasDataUrl === 'string' && canvasDataUrl.startsWith('data:image/')) {
            this.publishQr(canvasDataUrl);
            logger.info('Captured Feishu QR code from canvas (fallback)');
            return;
          }
        }
      } catch {
        // Page not ready yet
      }

      await delay(500);
    }
  }

  private startTokenPollingFallback(): void {
    if (this.firstQrDelivered) {
      return;
    }

    const pollingPromise = (async () => {
      // Wait for the page to load
      await delay(2_000);
      if (this.firstQrDelivered || this.cancelled || this.closed) {
        return;
      }
      logger.info('Starting Feishu token polling fallback');
      await this.pollTokenFromPage();
    })();

    pollingPromise.catch((error) => {
      if (!this.cancelled && !this.closed) {
        logger.warn('Feishu token polling fallback failed:', error);
      }
    });
  }

  private async safeDebuggerCommand<T>(command: string, params?: Record<string, unknown>): Promise<T | null> {
    const qrWindow = this.qrWindow;
    if (!qrWindow || qrWindow.isDestroyed() || qrWindow.webContents.isDestroyed()) {
      return null;
    }

    const debuggerApi = qrWindow.webContents.debugger;
    if (!debuggerApi.isAttached()) {
      return null;
    }

    try {
      return await debuggerApi.sendCommand(command, params) as T;
    } catch (error) {
      if (!this.cancelled && !this.closed) {
        logger.warn(`Feishu debugger command failed: ${command}`, error);
      }
      return null;
    }
  }

  private async handleDebuggerMessage(method: string, params: Record<string, unknown>): Promise<void> {
    if (this.cancelled || this.closed) {
      return;
    }
    if (!this.qrWindow) {
      return;
    }

    if (method === 'Network.responseReceived') {
      const requestId = typeof params?.requestId === 'string' ? params.requestId : '';
      const url = typeof params?.response?.url === 'string' ? params.response.url : '';
      if (!requestId || !url.startsWith(FEISHU_ACCOUNTS_BASE_URL)) {
        return;
      }
      if (!url.includes('/accounts/qrlogin/init') && !url.includes('/accounts/qrlogin/polling')) {
        return;
      }
      this.trackedResponseUrls.set(requestId, url);
      return;
    }

    if (method === 'Network.loadingFailed') {
      const requestId = typeof params?.requestId === 'string' ? params.requestId : '';
      if (requestId) {
        this.trackedResponseUrls.delete(requestId);
      }
      return;
    }

    if (method !== 'Network.loadingFinished') {
      return;
    }

    const requestId = typeof params?.requestId === 'string' ? params.requestId : '';
    const url = this.trackedResponseUrls.get(requestId);
    if (!requestId || !url) {
      return;
    }

    this.trackedResponseUrls.delete(requestId);
    const bodyResult = await this.safeDebuggerCommand<{ body?: string; base64Encoded?: boolean }>('Network.getResponseBody', { requestId });
    if (!bodyResult || typeof bodyResult.body !== 'string') {
      return;
    }

    const body = bodyResult.base64Encoded
      ? Buffer.from(bodyResult.body, 'base64').toString('utf8')
      : bodyResult.body;
    await this.handleTrackedResponse(url, body);
  }

  private async handleTrackedResponse(url: string, body: string): Promise<void> {
    if (this.cancelled || this.closed || !this.qrWindow || this.scanCompleted) {
      return;
    }

    let payload: {
      code?: number;
      data?: {
        step_info?: {
          status?: number;
          token?: string;
        };
      };
    };

    try {
      payload = JSON.parse(body) as typeof payload;
    } catch {
      return;
    }

    if (url.includes('/accounts/qrlogin/init')) {
      const token = payload?.data?.step_info?.token?.trim();
      if (token) {
        try {
          const qrContent = buildQrContentFromToken(token);
          const qrcodeUrl = renderQrPngDataUrl(qrContent);
          this.publishQr(qrcodeUrl);
          logger.info('Rendered Feishu QR code from init token');
        } catch (error) {
          logger.warn('Failed to render Feishu QR code from token:', error);
        }
      } else {
        logger.warn('Feishu qrlogin/init response did not contain a token');
      }
      return;
    }

    if (!url.includes('/accounts/qrlogin/polling')) {
      return;
    }

    const status = payload?.data?.step_info?.status;
    if (status === 5) {
      this.publishProgress('waiting_for_scan', 'running');
      await this.refreshQr();
    }
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

  private async refreshQr(): Promise<void> {
    if (this.refreshInFlight || !this.qrWindow || this.cancelled || this.scanCompleted) {
      return;
    }

    this.refreshInFlight = (async () => {
      try {
        const qrWindow = this.qrWindow;
        if (!qrWindow || qrWindow.isDestroyed()) {
          return;
        }
        // Reload the login page. The new /qrlogin/init response will be
        // intercepted by handleTrackedResponse which captures the QR image.
        await qrWindow.loadURL(buildLoginUrl(FEISHU_APP_LIST_URL));
      } catch (error) {
        if (!this.cancelled && !this.closed) {
          throw error;
        }
      } finally {
        this.refreshInFlight = null;
      }
    })();

    await this.refreshInFlight;
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
      const qrWindow = this.qrWindow;
      this.qrWindow = null;

      if (qrWindow && !qrWindow.isDestroyed()) {
        try {
          const { debugger: debuggerApi } = qrWindow.webContents;
          debuggerApi.off('message', this.onDebuggerMessage);
          if (debuggerApi.isAttached()) {
            debuggerApi.detach();
          }
        } catch {
          // Ignore debugger detach errors during shutdown.
        }

        try {
          qrWindow.destroy();
        } catch {
          // Ignore window destroy errors during shutdown.
        }
      }

      const networkSession = this.networkSession;
      this.networkSession = null;
      this.trackedResponseUrls.clear();

      if (networkSession) {
        await networkSession.clearStorageData().catch(() => {});
        await networkSession.closeAllConnections().catch(() => {});
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
