import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';
import type { Cookie, Session } from 'electron';
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
const WELCOME_MESSAGE_TIMEOUT_MS = 10_000;
const WELCOME_MESSAGE_RETRY_COUNT = 3;
const DEFAULT_APP_DESCRIPTION = 'Created by TnymaAI';
const DEFAULT_WELCOME_MESSAGE = '欢迎使用 TnymaAI！你的机器人已经创建完成，现在可以开始使用了。';
const QQ_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';
const SESSION_EVENT_QR = 'qr';
const SESSION_EVENT_PROGRESS = 'progress';
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

async function createQqBot(ctx: QQBotRequestContext): Promise<{ appId: string; clientSecret: string }> {
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

  const appId = payload.data?.appid?.trim();
  const clientSecret = payload.data?.client_secret?.trim();
  if (!appId || !clientSecret) {
    throw new Error('QQ bot creation did not return App ID and Client Secret.');
  }

  return { appId, clientSecret };
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
    const { appId, clientSecret } = await createQqBot(requestContext);
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
