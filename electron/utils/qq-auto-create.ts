import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';
import type { BrowserWindow, Cookie, Session } from 'electron';
import { getOpenClawResolvedDir } from './paths';
import { logger } from './logger';
import { buildElectronProxyConfig } from './proxy';
import { proxyAwareFetch } from './proxy-fetch';
import { getAllSettings } from './store';

const QQ_BASE_URL = 'https://q.qq.com';
const QQ_BOT_BASE_URL = 'https://bot.q.qq.com';
const QQ_API_BASE_URL = 'https://api.sgroup.qq.com';
const QQ_APP_ACCESS_TOKEN_URL = 'https://bots.qq.com/app/getAppAccessToken';
const QQ_LOGIN_URL = `${QQ_BASE_URL}/qqbot/openclaw/login.html`;
const QQ_INDEX_URL = `${QQ_BASE_URL}/qqbot/openclaw/index.html`;
const QQ_ENTITY_PICKER_URL = `${QQ_BASE_URL}/qqbot/openclaw/entity-picker.html`;
const QQ_CREATE_SESSION_URL = `${QQ_BASE_URL}/lite/create_session`;
const QQ_POLL_URL = `${QQ_BASE_URL}/lite/poll`;
const QQ_CREATE_BOT_URL = `${QQ_BOT_BASE_URL}/cgi-bin/lite_create`;
const QQ_UPLOAD_AVATAR_URL = `${QQ_BOT_BASE_URL}/cgi-bin/resource/lite_upload_avatar`;
const QQ_MODIFY_BOT_URL = `${QQ_BOT_BASE_URL}/cgi-bin/info/lite_modify`;
const QQ_DEVELOPER_SETTING_URL = `${QQ_BASE_URL}/qqbot/#/developer/developer-setting`;
const QQ_DEFAULT_BKN = '5381';
const QQ_LOGIN_EXPIRED_RETCODE = 10004;
const QQ_POLL_SUCCESS = 0;
const QQ_POLL_WAITING = 1;
const QQ_POLL_EXPIRED = 2;
const QQ_POLL_SCANNED = 3;
const QQ_POLL_REJECTED = 4;
const FIRST_QR_TIMEOUT_MS = 30_000;
const LOGIN_TIMEOUT_MS = 8 * 60_000;
const SESSION_TIMEOUT_MS = 10 * 60_000;
const QQ_POLL_INTERVAL_MS = 2_000;
const QQ_CREATE_SETTLE_MS = 1_200;
const QQ_CREDENTIAL_WAIT_ATTEMPTS = 12;
const QQ_POST_SUBMIT_RECONCILE_ATTEMPTS = 6;
const DEBUGGER_ATTACH_TIMEOUT_MS = 3_000;
const WELCOME_MESSAGE_TIMEOUT_MS = 10_000;
const WELCOME_MESSAGE_RETRY_COUNT = 3;
const DEFAULT_APP_DESCRIPTION = 'Created by TnymaAI';
const DEFAULT_WELCOME_MESSAGE = '欢迎使用 TnymaAI！你的机器人已经创建完成，现在可以开始使用了。';
const QQ_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';
const SESSION_EVENT_QR = 'qr';
const SESSION_EVENT_PROGRESS = 'progress';
const QQ_SECRET_BUTTON_HINTS = ['生成密钥', '查看密钥', '显示密钥', '生成 secret', '查看 secret', 'secret'];
const QQ_ACK_BUTTON_HINTS = ['我知道了', '知道了', '关闭'];
const QQ_ENTRY_BUTTON_HINTS = ['立即使用', '进入控制台', '进入开发台', '前往控制台', '开始创建', '创建机器人'];
const QQ_ENTRY_BLOCKED_BUTTON_HINTS = ['立即注册', '帮助文档', '查看全部公告'];
const QQ_COPY_APP_ID_BUTTON_HINTS = ['复制 AppID', '复制AppID', '复制应用ID', '复制机器人ID', '复制 Client ID'];
const QQ_COPY_SECRET_BUTTON_HINTS = [
  '复制 Client Secret',
  '复制Client Secret',
  '复制 App Secret',
  '复制App Secret',
  '复制 Secret',
  '复制Secret',
  '复制密钥',
] as const;
const QQ_BLOCKED_BUTTON_HINTS = ['取消', '返回', '关闭', '删除', '重置', '撤销'];
const require = createRequire(import.meta.url);

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

type QrRenderDeps = {
  QRCode: typeof import('qrcode-terminal/vendor/QRCode/index.js');
  QRErrorCorrectLevel: typeof import('qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel.js');
};

type SessionQrPayload = {
  qrcodeUrl: string;
};

export type AutoCreateProgressPayload = {
  status: 'running' | 'completed' | 'error';
  stepId: string;
};

type QQBotRequestContext = {
  bkn: string;
  cookieString: string;
  developerId: string;
};

type QQBotCreateResponse = {
  appid?: string;
  client_secret?: string;
};

type QqBotCredentials = {
  appId?: string;
  clientSecret?: string;
  developerId?: string;
};

type ChromeDebuggerEvent = {
  requestId?: string;
  response?: {
    mimeType?: string;
    url?: string;
  };
  errorText?: string;
};

type QQBotCreateSessionResponse = {
  code?: number;
  message?: string;
  session_id?: string;
};

type QQBotUploadAvatarResponse = {
  sign?: string;
  uri?: string;
};

type QQBotApiEnvelope<T> = {
  data?: T;
  msg?: string;
  retcode?: number;
};

type QQBotLoginPollPayload = {
  code?: number;
  developer_id?: string;
  message?: string;
};

type QQBotAccessTokenResponse = {
  access_token?: string;
  code?: number;
  expires_in?: number;
  message?: string;
};

export type QQBotAutoCreateStartOptions = {
  appDescription?: string;
  appName?: string;
};

export type QQBotAutoCreateStartResult = {
  message: string;
  qrcodeUrl?: string;
  sessionKey: string;
};

export type QQBotCredentialsReadyPayload = {
  appId: string;
  clientSecret: string;
};

export type QQBotAutoCreateWaitOptions = {
  onCredentialsReady?: (payload: QQBotCredentialsReadyPayload) => void | Promise<void>;
  onProgress?: (payload: AutoCreateProgressPayload) => void | Promise<void>;
  onQrRefresh?: (payload: SessionQrPayload) => void | Promise<void>;
  timeoutMs?: number;
};

export type QQBotAutoCreateResult = {
  appId: string;
  clientSecret: string;
  desc: string;
  developerId: string;
  name: string;
};

let qrRenderDeps: QrRenderDeps | null = null;

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
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

function normalizeBotName(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : 'TnymaAI QQ Bot';
}

function normalizeBotDescription(value: string | null | undefined): string {
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

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function mergeQqCredentials(primary: QqBotCredentials, fallback: QqBotCredentials = {}): QqBotCredentials {
  return {
    appId: normalizeOptionalString(primary.appId) || normalizeOptionalString(fallback.appId),
    clientSecret: normalizeOptionalString(primary.clientSecret) || normalizeOptionalString(fallback.clientSecret),
    developerId: normalizeOptionalString(primary.developerId) || normalizeOptionalString(fallback.developerId),
  };
}

function isPotentialAppId(value: string): boolean {
  return /^\d{5,}$/.test(value.trim());
}

function isPotentialSecret(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= 12 && /^[A-Za-z0-9_-]+$/.test(trimmed) && /[A-Za-z]/.test(trimmed);
}

function hasCompleteQqCredentials(credentials: QqBotCredentials): credentials is Required<Pick<QqBotCredentials, 'appId' | 'clientSecret'>> {
  return Boolean(credentials.appId && credentials.clientSecret);
}

function extractAppIdFromUrl(url: string): string | undefined {
  const match = url.match(/[?&#](?:appId|appid|clientId|client_id)=([^&#]+)/iu);
  const candidate = match?.[1] ? decodeURIComponent(match[1]).trim() : '';
  return isPotentialAppId(candidate) ? candidate : undefined;
}

export function extractQqCredentialsFromText(text: string): QqBotCredentials {
  const value = String(text || '');
  const trimmedValue = value.trim();
  if (isPotentialAppId(trimmedValue) || isPotentialSecret(trimmedValue)) {
    return {
      appId: isPotentialAppId(trimmedValue) ? trimmedValue : undefined,
      clientSecret: isPotentialSecret(trimmedValue) ? trimmedValue : undefined,
    };
  }

  const matches = [
    {
      key: 'appId' as const,
      patterns: [
        /(?:app[\s_-]*id|client[\s_-]*id)\s*["'=：:\s>]+(\d{5,})/iu,
        /(?:App\s*ID|AppID|Client\s*ID|ClientID|应用\s*ID|机器人\s*ID)\s*[:：]?\s*(\d{5,})/iu,
        /(?:appid|clientid)\s*[=:]\s*["']?(\d{5,})["']?/iu,
      ],
    },
    {
      key: 'clientSecret' as const,
      patterns: [
        /(?:app[\s_-]*secret|client[\s_-]*secret|secret)\s*["'=：:\s>]+([A-Za-z0-9_-]{12,})/iu,
        /(?:App\s*Secret|AppSecret|Client\s*Secret|ClientSecret|Secret|密钥)\s*[:：]?\s*([A-Za-z0-9_-]{12,})/iu,
        /(?:appsecret|clientsecret|secret)\s*[=:]\s*["']?([A-Za-z0-9_-]{12,})["']?/iu,
      ],
    },
    {
      key: 'developerId' as const,
      patterns: [
        /(?:developer[_\s-]*id|开发者\s*ID)\s*[:：]?\s*([A-Za-z0-9_-]{3,})/iu,
      ],
    },
  ];

  const result: QqBotCredentials = {};
  for (const entry of matches) {
    for (const pattern of entry.patterns) {
      const match = value.match(pattern);
      const candidate = match?.[1]?.trim();
      if (!candidate) continue;
      if (entry.key === 'appId' && !isPotentialAppId(candidate)) continue;
      if (entry.key === 'clientSecret' && !isPotentialSecret(candidate)) continue;
      result[entry.key] = candidate;
      break;
    }
  }

  if (!result.appId && isPotentialAppId(trimmedValue)) {
    result.appId = trimmedValue;
  }
  if (!result.clientSecret && isPotentialSecret(trimmedValue)) {
    result.clientSecret = trimmedValue;
  }

  return result;
}

export function extractQqCredentialsFromPayload(payload: unknown): QqBotCredentials {
  const result: QqBotCredentials = {};

  function visit(value: unknown, parentKey = '') {
    if (result.appId && result.clientSecret && result.developerId) {
      return;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        visit(entry, parentKey);
      }
      return;
    }

    if (typeof value === 'object' && value) {
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        const normalizedKey = key.toLowerCase();
        if (!result.appId && ['appid', 'app_id', 'clientid', 'client_id'].includes(normalizedKey)) {
          const candidate = normalizeOptionalString(nested);
          if (candidate && isPotentialAppId(candidate)) {
            result.appId = candidate;
          }
        }

        if (
          !result.clientSecret
          && ['appsecret', 'app_secret', 'clientsecret', 'client_secret', 'secret'].includes(normalizedKey)
        ) {
          const candidate = normalizeOptionalString(nested);
          if (candidate && isPotentialSecret(candidate)) {
            result.clientSecret = candidate;
          }
        }

        if (!result.developerId && ['developerid', 'developer_id'].includes(normalizedKey)) {
          const candidate = normalizeOptionalString(nested);
          if (candidate) {
            result.developerId = candidate;
          }
        }

        visit(nested, normalizedKey || parentKey);
      }
      return;
    }

    if (typeof value !== 'string') {
      return;
    }

    const candidate = value.trim();
    if (!candidate) {
      return;
    }

    if (!result.appId && parentKey && ['appid', 'app_id', 'clientid', 'client_id'].includes(parentKey)) {
      if (isPotentialAppId(candidate)) {
        result.appId = candidate;
      }
      return;
    }

    if (
      !result.clientSecret
      && parentKey
      && ['appsecret', 'app_secret', 'clientsecret', 'client_secret', 'secret'].includes(parentKey)
    ) {
      if (isPotentialSecret(candidate)) {
        result.clientSecret = candidate;
      }
      return;
    }

    if (!result.developerId && parentKey && ['developerid', 'developer_id'].includes(parentKey)) {
      result.developerId = candidate;
    }
  }

  visit(payload);
  return result;
}

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
  const qr = new QRCode(-1, QRErrorCorrectLevel.L);
  qr.addData(input);
  qr.make();
  return qr;
}

function fillPixel(
  buf: Buffer,
  x: number,
  y: number,
  width: number,
  r: number,
  g: number,
  b: number,
  a = 255,
) {
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

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

async function renderQrPngDataUrl(
  input: string,
  opts: { scale?: number; marginModules?: number } = {},
): Promise<string> {
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
        const pixelY = startY + y;
        for (let x = 0; x < scale; x += 1) {
          const pixelX = startX + x;
          fillPixel(buf, pixelX, pixelY, size, 0, 0, 0, 255);
        }
      }
    }
  }

  const png = encodePngRgba(buf, size, size);
  return `data:image/png;base64,${png.toString('base64')}`;
}

async function createRequestSession(partition: string): Promise<Session> {
  if (!process.versions.electron) {
    throw new Error('QQ bot auto-create requires Electron main-process networking.');
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
    throw new Error('QQ bot auto-create requires Electron main-process windows.');
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
      spellcheck: false,
    },
  });
  loginWindow.webContents.setUserAgent(QQ_USER_AGENT);
  return loginWindow;
}

async function executeInLoginWindow<T>(
  loginWindow: BrowserWindow,
  functionBody: string,
  payload?: unknown,
): Promise<T> {
  const payloadLiteral = JSON.stringify(payload ?? null);
  return await loginWindow.webContents.executeJavaScript(`(${functionBody})(${payloadLiteral})`, true) as T;
}

function isNavigationAbortError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('(-3)') || message.includes('ERR_ABORTED');
}

async function loadQqPage(loginWindow: BrowserWindow, url: string): Promise<void> {
  try {
    await loginWindow.loadURL(url, { userAgent: QQ_USER_AGENT });
  } catch (error) {
    if (!isNavigationAbortError(error)) {
      throw error;
    }
  }
  await delay(QQ_CREATE_SETTLE_MS);
}

const clickButtonByHintsInPage = `
(payload) => {
  const { allowed, blocked, matchIndex = 0 } = payload || {};
  const normalizedAllowed = Array.isArray(allowed) ? allowed.map((entry) => String(entry).toLowerCase()) : [];
  const normalizedBlocked = Array.isArray(blocked) ? blocked.map((entry) => String(entry).toLowerCase()) : [];
  const candidateAttributes = [
    'aria-label',
    'title',
    'name',
    'id',
    'data-title',
    'data-label',
    'data-name',
    'data-testid',
    'data-copy-text',
    'data-clipboard-text',
    'data-content',
    'data-value',
  ];
  const nodes = Array.from(
    document.querySelectorAll("button, [role='button'], a, input[type='button'], input[type='submit']"),
  );

  let matchedIndex = 0;
  for (const rawNode of nodes) {
    const node = rawNode;
    const style = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    const isVisible = style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    if (!isVisible) continue;

    const inputValue = node instanceof HTMLInputElement ? node.value : '';
    const fragments = [
      node.innerText || '',
      node.textContent || '',
      inputValue,
      node.parentElement?.textContent || '',
      node.closest('label')?.textContent || '',
      ...candidateAttributes.map((attributeName) => node.getAttribute(attributeName) || ''),
    ];
    const descriptor = fragments.join(' ').toLowerCase();
    if (!descriptor) continue;
    if (normalizedBlocked.some((hint) => descriptor.includes(hint))) continue;
    if (!normalizedAllowed.some((hint) => descriptor.includes(hint))) continue;
    if (matchedIndex < matchIndex) {
      matchedIndex += 1;
      continue;
    }

    node.click();
    return true;
  }

  return false;
}
`;

const extractQqCredentialsSnapshotInPage = `
() => {
  const candidateAttributes = [
    'data-appid',
    'data-app-id',
    'data-client-id',
    'data-clientid',
    'data-secret',
    'data-app-secret',
    'data-client-secret',
    'data-clientsecret',
    'data-clipboard-text',
    'data-copy-text',
    'data-value',
    'data-content',
    'title',
    'aria-label',
    'href',
  ];

  const inputs = Array.from(document.querySelectorAll('input, textarea'))
    .map((field) => {
      const element = field;
      const labels = [
        element.placeholder,
        element.getAttribute('aria-label') || '',
        element.getAttribute('name') || '',
        element.id || '',
        element.closest('label')?.textContent || '',
        element.parentElement?.textContent || '',
        element.value || '',
      ];
      return labels.join(' ');
    })
    .join('\\n');

  const attributeText = Array.from(document.querySelectorAll('*'))
    .flatMap((node) =>
      candidateAttributes
        .map((attributeName) => node.getAttribute(attributeName) || '')
        .filter(Boolean),
    )
    .join('\\n');

  return {
    text: \`\${document.body?.innerText || ''}\\n\${inputs}\\n\${attributeText}\`,
    url: window.location.href,
  };
}
`;

const extractQqCredentialDebugInPage = `
() => {
  const nodes = Array.from(
    document.querySelectorAll("button, [role='button'], a, input[type='button'], input[type='submit']"),
  );

  const buttons = nodes
    .map((node) => {
      const element = node;
      const text = [
        element.innerText || '',
        element.textContent || '',
        element.getAttribute('aria-label') || '',
        element.getAttribute('title') || '',
        element.getAttribute('data-copy-text') || '',
        element.getAttribute('data-clipboard-text') || '',
      ]
        .join(' ')
        .replace(/\\s+/g, ' ')
        .trim();
      return text;
    })
    .filter(Boolean)
    .slice(0, 12);

  return {
    url: window.location.href,
    buttons,
  };
}
`;

const clickQqEntityByNameInPage = `
(payload) => {
  const normalizedName = String(payload?.name || '').trim().toLowerCase();
  if (!normalizedName) {
    return false;
  }

  const nodes = Array.from(document.querySelectorAll("a, button, [role='button'], [data-appid], [data-client-id], [data-app-id]"));
  for (const rawNode of nodes) {
    const node = rawNode;
    const descriptor = [
      node.textContent || '',
      node.getAttribute('aria-label') || '',
      node.getAttribute('title') || '',
      node.getAttribute('href') || '',
      node.getAttribute('data-title') || '',
      node.getAttribute('data-label') || '',
      node.parentElement?.textContent || '',
    ]
      .join(' ')
      .toLowerCase();
    if (!descriptor.includes(normalizedName)) continue;

    const style = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    const isVisible = style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    if (!isVisible) continue;

    node.click();
    return true;
  }

  return false;
}
`;

function buildRequestHeaders(referer: string, contentType = 'application/json'): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain, */*',
    Origin: QQ_BASE_URL,
    Referer: referer,
    'User-Agent': QQ_USER_AGENT,
  };

  if (contentType) {
    headers['Content-Type'] = contentType;
  }

  return headers;
}

function buildCookieStringFromCookies(cookies: Cookie[]): string {
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

async function clickButtonByHints(
  loginWindow: BrowserWindow,
  allowed: readonly string[],
  blocked: readonly string[] = [],
  matchIndex = 0,
): Promise<boolean> {
  return await executeInLoginWindow<boolean>(loginWindow, clickButtonByHintsInPage, {
    allowed,
    blocked,
    matchIndex,
  }).catch(() => false);
}

async function clickQqEntityByName(loginWindow: BrowserWindow, name: string): Promise<boolean> {
  return await executeInLoginWindow<boolean>(loginWindow, clickQqEntityByNameInPage, { name }).catch(() => false);
}

async function extractQqCredentialsFromWindow(loginWindow: BrowserWindow): Promise<QqBotCredentials> {
  const snapshot = await executeInLoginWindow<{ text: string; url: string }>(loginWindow, extractQqCredentialsSnapshotInPage);
  const textCredentials = extractQqCredentialsFromText(snapshot.text);
  return mergeQqCredentials(
    {
      ...textCredentials,
      appId: textCredentials.appId || extractAppIdFromUrl(snapshot.url),
    },
    {},
  );
}

async function buildQqCredentialFailureSummary(
  loginWindow: BrowserWindow,
  responseState: QqBotCredentials,
): Promise<string> {
  const [snapshot, debug] = await Promise.all([
    executeInLoginWindow<{ text: string; url: string }>(loginWindow, extractQqCredentialsSnapshotInPage)
      .catch(() => ({ text: '', url: loginWindow.webContents.getURL() })),
    executeInLoginWindow<{ url: string; buttons: string[] }>(loginWindow, extractQqCredentialDebugInPage)
      .catch(() => ({ url: loginWindow.webContents.getURL(), buttons: [] })),
  ]);
  const snapshotCredentials = extractQqCredentialsFromText(snapshot.text);
  const merged = mergeQqCredentials(snapshotCredentials, responseState);
  return [
    `url=${debug.url || snapshot.url || loginWindow.webContents.getURL()}`,
    `appId=${merged.appId || '-'}`,
    `clientSecret=${merged.clientSecret ? '[captured]' : '-'}`,
    `buttons=${debug.buttons.join(' | ').slice(0, 240) || '-'}`,
  ].join('; ');
}

type QqCredentialTracker = {
  state: QqBotCredentials;
  stop: () => void;
};

async function attachQqCredentialTracker(loginWindow: BrowserWindow): Promise<QqCredentialTracker> {
  const pendingRequests = new Set<string>();
  const state: QqBotCredentials = {};

  if (!loginWindow.webContents.debugger.isAttached()) {
    loginWindow.webContents.debugger.attach('1.3');
  }

  const handleMessage = async (_event: Electron.Event, method: string, params: ChromeDebuggerEvent) => {
    if (method === 'Network.responseReceived') {
      const requestId = params.requestId;
      const url = params.response?.url || '';
      const mimeType = String(params.response?.mimeType || '').toLowerCase();
      if (!requestId) return;
      if (!url.startsWith(QQ_BASE_URL) && !url.startsWith(QQ_BOT_BASE_URL)) return;
      if (!mimeType.includes('json') && !/cgi-bin|developer|lite_/iu.test(url)) return;
      pendingRequests.add(requestId);
      return;
    }

    if (method === 'Network.loadingFailed') {
      if (params.requestId) {
        pendingRequests.delete(params.requestId);
      }
      return;
    }

    if (method !== 'Network.loadingFinished' || !params.requestId || !pendingRequests.has(params.requestId)) {
      return;
    }

    pendingRequests.delete(params.requestId);
    if (!loginWindow.webContents.debugger.isAttached()) {
      return;
    }

    const bodyResult = await loginWindow.webContents.debugger
      .sendCommand('Network.getResponseBody', { requestId: params.requestId })
      .catch(() => null);
    const rawBody = typeof bodyResult?.body === 'string'
      ? (bodyResult.base64Encoded ? Buffer.from(bodyResult.body, 'base64').toString('utf8') : bodyResult.body)
      : '';
    if (!rawBody) {
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return;
    }

    const merged = mergeQqCredentials(extractQqCredentialsFromPayload(payload), state);
    state.appId = merged.appId;
    state.clientSecret = merged.clientSecret;
    state.developerId = merged.developerId;
  };

  loginWindow.webContents.debugger.on('message', handleMessage);
  await loginWindow.webContents.debugger.sendCommand('Network.enable');

  return {
    state,
    stop() {
      loginWindow.webContents.debugger.off('message', handleMessage);
      if (loginWindow.webContents.debugger.isAttached()) {
        try {
          loginWindow.webContents.debugger.detach();
        } catch {
          // Ignore debugger detach failures during cleanup.
        }
      }
    },
  };
}

async function attachQqCredentialTrackerBestEffort(loginWindow: BrowserWindow): Promise<QqCredentialTracker | null> {
  return await withTimeout(
    attachQqCredentialTracker(loginWindow),
    DEBUGGER_ATTACH_TIMEOUT_MS,
    'Timed out while attaching the QQ credential tracker.',
  ).catch((error) => {
    logger.warn(`QQ auto-create continuing without credential tracker: ${String(error)}`);
    return null;
  });
}

async function readCurrentQqCredentials(
  loginWindow: BrowserWindow,
  responseState: QqBotCredentials,
): Promise<QqBotCredentials> {
  const pageCredentials = await extractQqCredentialsFromWindow(loginWindow);
  return mergeQqCredentials(pageCredentials, responseState);
}

async function waitForQqCredentials(
  loginWindow: BrowserWindow,
  responseState: QqBotCredentials,
  attempts = QQ_CREDENTIAL_WAIT_ATTEMPTS,
): Promise<QqBotCredentials> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let credentials = await readCurrentQqCredentials(loginWindow, responseState);
    if (hasCompleteQqCredentials(credentials)) {
      return credentials;
    }

    if (!credentials.clientSecret) {
      await clickButtonByHints(loginWindow, QQ_SECRET_BUTTON_HINTS, QQ_BLOCKED_BUTTON_HINTS).catch(() => false);
      await delay(300);
      credentials = mergeQqCredentials(await readCurrentQqCredentials(loginWindow, responseState), credentials);
    }

    if (!credentials.appId) {
      await clickButtonByHints(loginWindow, QQ_COPY_APP_ID_BUTTON_HINTS, QQ_BLOCKED_BUTTON_HINTS).catch(() => false);
      await delay(200);
      credentials = mergeQqCredentials(await readCurrentQqCredentials(loginWindow, responseState), credentials);
    }

    if (!credentials.clientSecret) {
      await clickButtonByHints(loginWindow, QQ_COPY_SECRET_BUTTON_HINTS, QQ_BLOCKED_BUTTON_HINTS).catch(() => false);
      await delay(200);
      credentials = mergeQqCredentials(await readCurrentQqCredentials(loginWindow, responseState), credentials);
    }

    if (hasCompleteQqCredentials(credentials)) {
      return credentials;
    }

    await delay(QQ_CREATE_SETTLE_MS);
  }

  throw new Error(
    `QQ 创建流程已完成，但自动读取 AppID / Client Secret 失败。${await buildQqCredentialFailureSummary(loginWindow, responseState)}`,
  );
}

async function tryReadQqCredentials(
  loginWindow: BrowserWindow,
  responseState: QqBotCredentials,
  attempts = 2,
): Promise<QqBotCredentials | undefined> {
  try {
    const credentials = await waitForQqCredentials(loginWindow, responseState, attempts);
    return hasCompleteQqCredentials(credentials) ? credentials : undefined;
  } catch {
    return undefined;
  }
}

function buildQqDeveloperSettingUrl(appId?: string): string {
  if (!appId) {
    return QQ_DEVELOPER_SETTING_URL;
  }
  return `${QQ_DEVELOPER_SETTING_URL}?appId=${encodeURIComponent(appId)}`;
}

async function reconcileQqProvisioningResult(
  partition: string,
  botName: string,
  responseState: QqBotCredentials,
): Promise<QqBotCredentials> {
  const loginWindow = await createLoginWindow(partition);
  const tracker = await attachQqCredentialTrackerBestEffort(loginWindow);
  try {
    await loadQqPage(loginWindow, buildQqDeveloperSettingUrl(responseState.appId));
    let credentials = mergeQqCredentials(
      (await tryReadQqCredentials(loginWindow, mergeQqCredentials(tracker?.state || {}, responseState), 3)) || {},
      responseState,
    );
    if (hasCompleteQqCredentials(credentials)) {
      return credentials;
    }

    for (let attempt = 1; attempt <= QQ_POST_SUBMIT_RECONCILE_ATTEMPTS; attempt += 1) {
      await clickButtonByHints(loginWindow, QQ_ACK_BUTTON_HINTS).catch(() => false);

      credentials = mergeQqCredentials(
        (await tryReadQqCredentials(loginWindow, mergeQqCredentials(tracker?.state || {}, credentials), 2)) || {},
        credentials,
      );
      if (hasCompleteQqCredentials(credentials)) {
        return credentials;
      }

      await loadQqPage(loginWindow, QQ_INDEX_URL);
      await clickButtonByHints(
        loginWindow,
        QQ_ENTRY_BUTTON_HINTS,
        QQ_ENTRY_BLOCKED_BUTTON_HINTS,
        Math.max(0, attempt - 1),
      ).catch(() => false);
      await delay(QQ_CREATE_SETTLE_MS);

      if (botName) {
        await clickQqEntityByName(loginWindow, botName).catch(() => false);
        await delay(QQ_CREATE_SETTLE_MS);
      }

      credentials = mergeQqCredentials(
        (await tryReadQqCredentials(loginWindow, mergeQqCredentials(tracker?.state || {}, credentials), 2)) || {},
        credentials,
      );
      if (hasCompleteQqCredentials(credentials)) {
        return credentials;
      }

      await loadQqPage(loginWindow, buildQqDeveloperSettingUrl(credentials.appId));
      credentials = mergeQqCredentials(
        (await tryReadQqCredentials(loginWindow, mergeQqCredentials(tracker?.state || {}, credentials), 2)) || {},
        credentials,
      );
      if (hasCompleteQqCredentials(credentials)) {
        return credentials;
      }
    }

    throw new Error(
      `QQ 创建已提交，但未能确认最终 AppID / Client Secret。${await buildQqCredentialFailureSummary(loginWindow, mergeQqCredentials(tracker?.state || {}, responseState))}`,
    );
  } finally {
    tracker?.stop();
    if (!loginWindow.isDestroyed()) {
      loginWindow.destroy();
    }
  }
}

async function parseJsonResponse<T>(response: globalThis.Response, label: string): Promise<QQBotApiEnvelope<T>> {
  const raw = await response.text();
  let payload: QQBotApiEnvelope<T>;
  try {
    payload = JSON.parse(raw) as QQBotApiEnvelope<T>;
  } catch (error) {
    throw new Error(`Failed to parse QQ response for ${label}: ${String(error)}`, { cause: error });
  }

  return payload;
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

async function postQqJson<T>(
  ctx: QQBotRequestContext,
  url: string,
  body: Record<string, unknown>,
  referer: string,
): Promise<QQBotApiEnvelope<T>> {
  const response = await proxyAwareFetch(`${url}?bkn=${encodeURIComponent(ctx.bkn)}`, {
    body: JSON.stringify(body),
    headers: {
      ...buildRequestHeaders(referer),
      Cookie: ctx.cookieString,
    },
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(`QQ request failed with ${response.status} for ${url}`);
  }

  return await parseJsonResponse<T>(response, url);
}

async function getQqJson<T>(networkSession: Session, url: string, referer: string): Promise<QQBotApiEnvelope<T>> {
  const response = await fetchWithSession(networkSession, url, {
    headers: buildRequestHeaders(referer, ''),
    method: 'GET',
  });

  if (!response.ok) {
    throw new Error(`QQ request failed with ${response.status} for ${url}`);
  }

  return await parseJsonResponse<T>(response, url);
}

async function createQqBot(ctx: QQBotRequestContext): Promise<QqBotCredentials> {
  const payload = await postQqJson<QQBotCreateResponse>(
    ctx,
    QQ_CREATE_BOT_URL,
    {
      apply_source: 1,
      idempotency_key: Date.now().toString(),
    },
    QQ_INDEX_URL,
  );

  if (payload.retcode === QQ_LOGIN_EXPIRED_RETCODE) {
    throw new Error('QQ login expired before bot creation completed.');
  }
  if (payload.retcode !== 0) {
    throw new Error(payload.msg || `QQ bot creation failed with retcode ${String(payload.retcode ?? 'unknown')}.`);
  }

  return mergeQqCredentials(
    {
      appId: payload.data?.appid?.trim(),
      clientSecret: payload.data?.client_secret?.trim(),
      developerId: ctx.developerId,
    },
    extractQqCredentialsFromPayload(payload),
  );
}

async function uploadDefaultAvatar(ctx: QQBotRequestContext): Promise<QQBotUploadAvatarResponse | null> {
  try {
    const avatar = await readDefaultAvatar();
    const form = new FormData();
    form.set('file', new Blob([avatar], { type: 'image/png' }), 'avatar.png');
    form.set('type', '0');

    const response = await proxyAwareFetch(`${QQ_UPLOAD_AVATAR_URL}?bkn=${encodeURIComponent(ctx.bkn)}`, {
      body: form,
      headers: {
        ...buildRequestHeaders(QQ_INDEX_URL, ''),
        Cookie: ctx.cookieString,
      },
      method: 'POST',
    });

    if (!response.ok) {
      return null;
    }

    const payload = await parseJsonResponse<QQBotUploadAvatarResponse>(response, QQ_UPLOAD_AVATAR_URL);
    if (payload.retcode !== 0) {
      return null;
    }

    const uri = payload.data?.uri?.trim();
    const sign = payload.data?.sign?.trim();
    if (!uri || !sign) {
      return null;
    }

    return { sign, uri };
  } catch {
    return null;
  }
}

async function modifyQqBotProfile(
  ctx: QQBotRequestContext,
  appId: string,
  name: string,
  desc: string,
  avatar: QQBotUploadAvatarResponse | null,
): Promise<void> {
  const payload: Record<string, unknown> = {
    bot_appid: appId,
    bot_desc: desc,
    bot_name: name,
  };

  if (avatar?.uri && avatar.sign) {
    payload.avatar_url = avatar.uri;
    payload.avatar_url_sign = avatar.sign;
  }

  const response = await postQqJson<Record<string, never>>(
    ctx,
    QQ_MODIFY_BOT_URL,
    payload,
    QQ_INDEX_URL,
  );

  if (response.retcode === QQ_LOGIN_EXPIRED_RETCODE) {
    return;
  }
  if (response.retcode !== 0) {
    throw new Error(response.msg || 'Failed to update the QQ bot profile.');
  }
}

async function fetchQqAppAccessToken(appId: string, clientSecret: string): Promise<string> {
  const response = await proxyAwareFetchWithTimeout(
    QQ_APP_ACCESS_TOKEN_URL,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': QQ_USER_AGENT,
      },
      body: JSON.stringify({
        appId,
        clientSecret,
      }),
    },
    WELCOME_MESSAGE_TIMEOUT_MS,
  );

  const raw = await response.text();
  let payload: QQBotAccessTokenResponse;
  try {
    payload = JSON.parse(raw) as QQBotAccessTokenResponse;
  } catch (error) {
    throw new Error(`Failed to parse QQ bot access token response: ${String(error)}`, { cause: error });
  }

  if (!response.ok || !payload.access_token?.trim()) {
    throw new Error(
      `Failed to get QQ bot access token: HTTP ${response.status} code=${String(payload.code ?? 'unknown')} msg=${payload.message || raw.slice(0, 200)}`,
    );
  }

  return payload.access_token.trim();
}

async function sendQqWelcomeMessage(
  appId: string,
  clientSecret: string,
  developerId: string,
  content: string,
): Promise<void> {
  const accessToken = await fetchQqAppAccessToken(appId, clientSecret);
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= WELCOME_MESSAGE_RETRY_COUNT; attempt += 1) {
    try {
      const response = await proxyAwareFetchWithTimeout(
        `${QQ_API_BASE_URL}/v2/users/${encodeURIComponent(developerId)}/messages`,
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            Authorization: `QQBot ${accessToken}`,
            'Content-Type': 'application/json',
            'User-Agent': QQ_USER_AGENT,
          },
          body: JSON.stringify({
            content,
            msg_type: 0,
          }),
        },
        WELCOME_MESSAGE_TIMEOUT_MS,
      );

      const raw = await response.text();
      let payload: Record<string, unknown> = {};
      if (raw.trim()) {
        try {
          payload = JSON.parse(raw) as Record<string, unknown>;
        } catch (error) {
          throw new Error(`Failed to parse QQ proactive welcome response: ${String(error)}`, { cause: error });
        }
      }

      if (!response.ok) {
        const message = typeof payload.message === 'string' && payload.message.trim()
          ? payload.message
          : raw.slice(0, 200);
        throw new Error(`QQ welcome message request failed: HTTP ${response.status} ${message}`);
      }

      logger.info(`QQ auto-create sent welcome message: appId=${appId} developerId=${developerId}`);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < WELCOME_MESSAGE_RETRY_COUNT) {
        await delay(1_500);
      }
    }
  }

  throw lastError ?? new Error('Failed to send QQ welcome message.');
}

function computeBkn(skey: string | null | undefined): string {
  const value = skey ?? '';
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash += (hash << 5) + value.charCodeAt(index);
  }
  return String(hash & 0x7fffffff);
}

function buildQrRawValue(sessionId: string): string {
  return `${QQ_ENTITY_PICKER_URL}?session_id=${encodeURIComponent(sessionId)}&_wv=16777218`;
}

async function primeLoginSession(networkSession: Session): Promise<void> {
  await fetchWithSession(networkSession, QQ_LOGIN_URL, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'User-Agent': QQ_USER_AGENT,
    },
    method: 'GET',
  }).catch(() => {});
}

async function createLoginSession(networkSession: Session): Promise<{ qrcodeUrl: string; sessionId: string }> {
  const payload = await getQqJson<QQBotCreateSessionResponse>(
    networkSession,
    `${QQ_CREATE_SESSION_URL}?bkn=${encodeURIComponent(QQ_DEFAULT_BKN)}`,
    QQ_LOGIN_URL,
  );

  if (payload.retcode !== 0) {
    throw new Error(payload.msg || `QQ login session creation failed with retcode ${String(payload.retcode ?? 'unknown')}.`);
  }

  const sessionCode = payload.data?.code;
  const sessionId = payload.data?.session_id?.trim();
  if (sessionCode !== 0 || !sessionId) {
    throw new Error(payload.data?.message || 'QQ login session creation did not return a valid session_id.');
  }

  return {
    qrcodeUrl: await renderQrPngDataUrl(buildQrRawValue(sessionId)),
    sessionId,
  };
}

async function pollLoginSession(networkSession: Session, sessionId: string): Promise<QQBotLoginPollPayload> {
  const payload = await getQqJson<QQBotLoginPollPayload>(
    networkSession,
    `${QQ_POLL_URL}?session_id=${encodeURIComponent(sessionId)}&bkn=${encodeURIComponent(QQ_DEFAULT_BKN)}`,
    QQ_LOGIN_URL,
  );

  if (payload.retcode !== 0) {
    throw new Error(payload.msg || `QQ login poll failed with retcode ${String(payload.retcode ?? 'unknown')}.`);
  }

  return payload.data ?? {};
}

async function getRelevantCookies(networkSession: Session): Promise<Cookie[]> {
  const [qqCookies, qqBotCookies] = await Promise.all([
    networkSession.cookies.get({ url: QQ_BASE_URL }),
    networkSession.cookies.get({ url: QQ_BOT_BASE_URL }),
  ]);

  const merged = new Map<string, Cookie>();
  for (const cookie of [...qqCookies, ...qqBotCookies]) {
    merged.set(`${cookie.domain}|${cookie.path}|${cookie.name}`, cookie);
  }
  return Array.from(merged.values());
}

async function captureRequestContext(networkSession: Session, developerId: string): Promise<QQBotRequestContext> {
  const deadline = Date.now() + 15_000;
  let cookieString = '';
  let skey = '';

  while (Date.now() < deadline) {
    const cookies = await getRelevantCookies(networkSession);
    cookieString = buildCookieStringFromCookies(cookies);
    skey = cookies.find((cookie) => cookie.name === 'skey')?.value?.trim()
      || cookies.find((cookie) => cookie.name === 'p_skey')?.value?.trim()
      || '';

    if (cookieString) {
      break;
    }

    await delay(250);
  }

  if (!cookieString) {
    throw new Error('Failed to capture QQ login cookies after QR confirmation.');
  }

  if (!cookieString.includes('developer_id_lite=')) {
    cookieString = buildMergedCookieString(`developer_id_lite=${developerId}`, cookieString);
  }

  return {
    bkn: computeBkn(skey) || QQ_DEFAULT_BKN,
    cookieString,
    developerId,
  };
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
  throw new Error('Could not find the default TnymaAI icon for QQ bot creation.');
}

class QQBotAutoCreateSession extends EventEmitter {
  readonly sessionKey = randomUUID();

  private readonly completion = createDeferred<QQBotAutoCreateResult>();
  private readonly firstQr = createDeferred<string>();
  private readonly runPromise: Promise<void>;
  private cancelled = false;
  private closed = false;
  private credentialsReadyHook: ((payload: QQBotCredentialsReadyPayload) => void | Promise<void>) | null = null;
  private firstQrDelivered = false;
  private latestQrDataUrl: string | null = null;
  private networkSession: Session | null = null;
  private readonly sessionPartition = `qq-auto-create:${this.sessionKey}`;

  constructor(private readonly options: QQBotAutoCreateStartOptions) {
    super();
    this.runPromise = this.run();
    this.runPromise.catch((error) => {
      this.fail(error);
    });
  }

  async start(): Promise<QQBotAutoCreateStartResult> {
    const qrcodeUrl = await withTimeout(
      this.firstQr.promise,
      FIRST_QR_TIMEOUT_MS,
      'Timed out waiting for the initial QQ QR code.',
    );

    return {
      message: 'Scan the QR code with QQ to create the bot automatically.',
      qrcodeUrl,
      sessionKey: this.sessionKey,
    };
  }

  async wait(options: QQBotAutoCreateWaitOptions): Promise<QQBotAutoCreateResult> {
    this.credentialsReadyHook = options.onCredentialsReady ?? null;

    const onQrRefresh = options.onQrRefresh
      ? async (payload: SessionQrPayload) => {
          try {
            await options.onQrRefresh?.(payload);
          } catch {
            // Ignore UI callback errors and keep the session alive.
          }
        }
      : null;

    const onProgress = options.onProgress
      ? async (payload: AutoCreateProgressPayload) => {
          try {
            await options.onProgress?.(payload);
          } catch {
            // Ignore UI callback errors and keep the session alive.
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
        'Timed out waiting for QQ bot creation to finish.',
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
    this.cancelled = true;
    await this.cleanup();
  }

  private async run(): Promise<void> {
    this.publishProgress('waiting_for_scan', 'running');

    this.networkSession = await createRequestSession(this.sessionPartition);
    await primeLoginSession(this.networkSession);

    let currentLogin = await createLoginSession(this.networkSession);
    this.publishQr(currentLogin.qrcodeUrl);

    const loginDeadline = Date.now() + LOGIN_TIMEOUT_MS;
    let developerId: string | null = null;

    while (Date.now() < loginDeadline) {
      if (this.cancelled) {
        throw new Error('QQ login was cancelled.');
      }

      const payload = await pollLoginSession(this.networkSession, currentLogin.sessionId);
      const code = payload.code;

      switch (code) {
        case QQ_POLL_SUCCESS: {
          developerId = payload.developer_id?.trim() || null;
          if (!developerId) {
            throw new Error('QQ login succeeded but no developer ID was returned.');
          }
          break;
        }
        case QQ_POLL_EXPIRED:
        case QQ_POLL_REJECTED:
          this.publishProgress('waiting_for_scan', 'running');
          currentLogin = await createLoginSession(this.networkSession);
          this.publishQr(currentLogin.qrcodeUrl);
          break;
        case QQ_POLL_WAITING:
        case QQ_POLL_SCANNED:
        default:
          break;
      }

      if (developerId) {
        break;
      }

      await delay(QQ_POLL_INTERVAL_MS);
    }

    if (!developerId) {
      throw new Error('Timed out waiting for QQ login confirmation.');
    }

    if (this.cancelled) {
      throw new Error('QQ login was cancelled.');
    }

    this.publishProgress('waiting_for_scan', 'completed');
    this.publishProgress('creating_bot', 'running');

    await this.networkSession.cookies.set({
      domain: '.q.qq.com',
      expirationDate: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
      name: 'developer_id_lite',
      path: '/',
      sameSite: 'lax',
      secure: true,
      url: QQ_BASE_URL,
      value: developerId,
    }).catch(() => {});

    await fetchWithSession(this.networkSession, QQ_INDEX_URL, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        Referer: QQ_LOGIN_URL,
        'User-Agent': QQ_USER_AGENT,
      },
      method: 'GET',
    }).catch(() => {});

    const requestContext = await captureRequestContext(this.networkSession, developerId);
    const name = normalizeBotName(this.options.appName);
    const desc = normalizeBotDescription(this.options.appDescription);
    let credentials = await createQqBot(requestContext);
    if (!hasCompleteQqCredentials(credentials)) {
      credentials = mergeQqCredentials(
        await reconcileQqProvisioningResult(this.sessionPartition, name, credentials),
        credentials,
      );
    }
    if (!hasCompleteQqCredentials(credentials)) {
      throw new Error('QQ bot creation did not return App ID and Client Secret.');
    }

    const { appId, clientSecret } = credentials;
    this.publishProgress('creating_bot', 'completed');
    this.publishProgress('saving_credentials', 'running');

    if (this.credentialsReadyHook) {
      await this.credentialsReadyHook({ appId, clientSecret });
    }
    this.publishProgress('saving_credentials', 'completed');

    this.publishProgress('updating_profile', 'running');
    const avatar = await uploadDefaultAvatar(requestContext);
    await modifyQqBotProfile(requestContext, appId, name, desc, avatar).catch(() => {});
    this.publishProgress('updating_profile', 'completed');
    await sendQqWelcomeMessage(appId, clientSecret, developerId, buildAutoCreateWelcomeMessage(name)).catch((error) => {
      logger.warn(`QQ auto-create welcome message failed: ${String(error)}`);
    });

    this.complete({
      appId,
      clientSecret,
      desc,
      developerId,
      name,
    });
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

  private complete(result: QQBotAutoCreateResult): void {
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
    const networkSession = this.networkSession;
    this.networkSession = null;

    if (networkSession) {
      await networkSession.clearStorageData().catch(() => {});
      await networkSession.closeAllConnections().catch(() => {});
    }
  }
}

const qqBotAutoCreateSessions = new Map<string, QQBotAutoCreateSession>();

export async function startQQBotAutoCreateSession(
  options: QQBotAutoCreateStartOptions,
): Promise<QQBotAutoCreateStartResult> {
  const session = new QQBotAutoCreateSession(options);
  qqBotAutoCreateSessions.set(session.sessionKey, session);

  try {
    return await session.start();
  } catch (error) {
    qqBotAutoCreateSessions.delete(session.sessionKey);
    await session.cancel().catch(() => {});
    throw error;
  }
}

export async function waitForQQBotAutoCreateSession(
  sessionKey: string,
  options: QQBotAutoCreateWaitOptions = {},
): Promise<QQBotAutoCreateResult> {
  const session = qqBotAutoCreateSessions.get(sessionKey);
  if (!session) {
    throw new Error(`QQ bot auto-create session "${sessionKey}" was not found.`);
  }

  try {
    return await session.wait(options);
  } finally {
    qqBotAutoCreateSessions.delete(sessionKey);
  }
}

export async function cancelQQBotAutoCreateSession(sessionKey: string): Promise<void> {
  const session = qqBotAutoCreateSessions.get(sessionKey);
  qqBotAutoCreateSessions.delete(sessionKey);
  if (session) {
    await session.cancel();
  }
}
