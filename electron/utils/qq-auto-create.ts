import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserContext, Page, Response as PlaywrightResponse } from 'playwright-core';
import { proxyAwareFetch } from './proxy-fetch';

const QQ_BASE_URL = 'https://q.qq.com';
const QQ_BOT_BASE_URL = 'https://bot.q.qq.com';
const QQ_LOGIN_URL = `${QQ_BASE_URL}/qqbot/openclaw/login.html`;
const QQ_INDEX_URL = `${QQ_BASE_URL}/qqbot/openclaw/index.html`;
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
const QR_CAPTURE_DELAY_MS = 400;
const QR_CAPTURE_RETRIES = 8;
const DEFAULT_APP_DESCRIPTION = 'Created by TnymaAI';
const QQ_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';
const SESSION_EVENT_QR = 'qr';
const SESSION_EVENT_PROGRESS = 'progress';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

type SessionQrPayload = {
  qrcodeUrl: string;
};

export type AutoCreateProgressPayload = {
  status: 'running' | 'completed' | 'error';
  stepId: string;
};

type QQBotCookieCredentials = {
  bkn: string;
  cookieString: string;
  developerId: string;
};

type QQBotCreateResponse = {
  appid?: string;
  client_secret?: string;
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

function findChromeExecutable(): string {
  const envPath = process.env.CHROME_PATH?.trim();
  const candidates = [
    envPath,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/microsoft-edge',
    '/usr/bin/microsoft-edge-stable',
  ];

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error('Chrome or Edge was not found. Set CHROME_PATH or install Chrome first.');
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

function extractCookieValue(cookieString: string, name: string): string | null {
  for (const pair of cookieString.split(';')) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) continue;
    const cookieName = trimmed.slice(0, eqIndex).trim();
    if (cookieName !== name) continue;
    return trimmed.slice(eqIndex + 1).trim();
  }
  return null;
}

function computeBkn(skey: string | null | undefined): string {
  const value = skey ?? '';
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash += (hash << 5) + value.charCodeAt(index);
  }
  return String(hash & 0x7fffffff);
}

function buildRequestHeaders(
  creds: QQBotCookieCredentials,
  referer: string,
  contentType = 'application/json',
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain, */*',
    Cookie: creds.cookieString,
    Origin: QQ_BASE_URL,
    Referer: referer,
    'User-Agent': QQ_USER_AGENT,
  };

  if (contentType) {
    headers['Content-Type'] = contentType;
  }

  return headers;
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

async function postQqJson<T>(
  creds: QQBotCookieCredentials,
  url: string,
  body: Record<string, unknown>,
  referer: string,
): Promise<QQBotApiEnvelope<T>> {
  const response = await proxyAwareFetch(`${url}?bkn=${encodeURIComponent(creds.bkn)}`, {
    body: JSON.stringify(body),
    headers: buildRequestHeaders(creds, referer),
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(`QQ request failed with ${response.status} for ${url}`);
  }

  return await parseJsonResponse<T>(response, url);
}

async function createQqBot(creds: QQBotCookieCredentials): Promise<{ appId: string; clientSecret: string }> {
  const payload = await postQqJson<QQBotCreateResponse>(
    creds,
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

async function uploadDefaultAvatar(creds: QQBotCookieCredentials): Promise<QQBotUploadAvatarResponse | null> {
  try {
    const avatar = await readDefaultAvatar();
    const form = new FormData();
    form.set('file', new Blob([avatar], { type: 'image/png' }), 'avatar.png');
    form.set('type', '0');

    const response = await proxyAwareFetch(`${QQ_UPLOAD_AVATAR_URL}?bkn=${encodeURIComponent(creds.bkn)}`, {
      body: form,
      headers: buildRequestHeaders(creds, QQ_INDEX_URL, ''),
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
  creds: QQBotCookieCredentials,
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
    creds,
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

async function captureQrDataUrl(page: Page): Promise<string | null> {
  const dataUrl = await page.evaluate(() => {
    const candidates = [
      '.mobile-login-box__qrcode canvas',
      '.mobile-login-box__qrcode svg',
      '.mobile-login-box__qrcode img',
      '.mobile-login-box__qrcode-container canvas',
      '.mobile-login-box__qrcode-container svg',
      '[class*="qrcode"] canvas',
      '[class*="qrcode"] svg',
      '[class*="qrcode"] img',
    ];

    for (const selector of candidates) {
      const node = document.querySelector(selector);
      if (!node) continue;

      if (node instanceof HTMLCanvasElement && node.width >= 64 && node.height >= 64) {
        return node.toDataURL('image/png');
      }

      if (node instanceof SVGElement) {
        const serialized = new XMLSerializer().serializeToString(node);
        if (!serialized) continue;
        return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(serialized)))}`;
      }

      if (node instanceof HTMLImageElement && node.src) {
        return node.src;
      }
    }

    return null;
  });

  if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image')) {
    return dataUrl;
  }

  const screenshotSelectors = [
    '.mobile-login-box__qrcode',
    '.mobile-login-box__qrcode-container',
    '[class*="qrcode"]',
  ];

  for (const selector of screenshotSelectors) {
    try {
      const locator = page.locator(selector).first();
      await locator.waitFor({ state: 'visible', timeout: 1_500 });
      const box = await locator.boundingBox();
      if (!box || box.width < 64 || box.height < 64) {
        continue;
      }
      const buffer = await locator.screenshot({ type: 'png' });
      return `data:image/png;base64,${buffer.toString('base64')}`;
    } catch {
      continue;
    }
  }

  return null;
}

async function captureQrDataUrlWithRetry(page: Page, attempts = QR_CAPTURE_RETRIES, delayMs = 250): Promise<string | null> {
  for (let index = 0; index < attempts; index += 1) {
    const qrcodeUrl = await captureQrDataUrl(page);
    if (qrcodeUrl) {
      return qrcodeUrl;
    }
    if (index < attempts - 1) {
      await delay(delayMs);
    }
  }
  return null;
}

async function captureCredentials(context: BrowserContext, developerId: string): Promise<QQBotCookieCredentials> {
  const deadline = Date.now() + 15_000;
  let cookieString = '';
  let skey = '';

  while (Date.now() < deadline) {
    const cookies = await context.cookies([QQ_BASE_URL, QQ_BOT_BASE_URL]);
    cookieString = buildCookieStringFromContextCookies(cookies);
    skey = cookies.find((cookie) => cookie.name === 'skey')?.value?.trim()
      || cookies.find((cookie) => cookie.name === 'p_skey')?.value?.trim()
      || extractCookieValue(cookieString, 'skey')
      || '';

    if (cookieString) {
      break;
    }

    await delay(250);
  }

  if (!cookieString) {
    cookieString = `developer_id_lite=${developerId}`;
  } else if (!cookieString.includes('developer_id_lite=')) {
    cookieString = buildMergedCookieString(`developer_id_lite=${developerId}`, cookieString);
  }

  return {
    bkn: computeBkn(skey) || QQ_DEFAULT_BKN,
    cookieString,
    developerId,
  };
}

class QQBotAutoCreateSession extends EventEmitter {
  readonly sessionKey = randomUUID();

  private readonly completion = createDeferred<QQBotAutoCreateResult>();
  private readonly firstQr = createDeferred<string>();
  private readonly loginSuccess = createDeferred<{ developerId: string }>();
  private readonly runPromise: Promise<void>;
  private readonly tempUserDataDirPromise = mkdtemp(join(tmpdir(), 'tnyma-qq-auto-create-'));
  private cancelled = false;
  private closed = false;
  private context: BrowserContext | null = null;
  private credentialsReadyHook: ((payload: QQBotCredentialsReadyPayload) => void | Promise<void>) | null = null;
  private firstQrDelivered = false;
  private latestQrDataUrl: string | null = null;
  private page: Page | null = null;
  private refreshInFlight: Promise<void> | null = null;

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

    const { chromium } = await import('playwright-core');
    const executablePath = findChromeExecutable();
    const userDataDir = await this.tempUserDataDirPromise;

    this.context = await chromium.launchPersistentContext(userDataDir, {
      executablePath,
      headless: true,
      viewport: { width: 960, height: 720 },
      args: [
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-blink-features=AutomationControlled',
      ],
    });

    this.page = this.context.pages()[0] ?? await this.context.newPage();
    this.page.on('response', (response) => {
      void this.handleResponse(response);
    });

    await this.page.goto(QQ_LOGIN_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });

    const { developerId } = await withTimeout(
      this.loginSuccess.promise,
      LOGIN_TIMEOUT_MS,
      'Timed out waiting for QQ login confirmation.',
    );

    if (this.cancelled) {
      throw new Error('QQ login was cancelled.');
    }

    this.publishProgress('waiting_for_scan', 'completed');
    this.publishProgress('creating_bot', 'running');

    await this.context.addCookies([{
      name: 'developer_id_lite',
      value: developerId,
      domain: '.q.qq.com',
      path: '/',
      expires: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
      httpOnly: false,
      secure: true,
      sameSite: 'Lax',
    }]).catch(() => {});

    await this.page.goto(QQ_INDEX_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    }).catch(() => {});

    const creds = await captureCredentials(this.context, developerId);
    const name = normalizeBotName(this.options.appName);
    const desc = normalizeBotDescription(this.options.appDescription);
    const { appId, clientSecret } = await createQqBot(creds);
    this.publishProgress('creating_bot', 'completed');
    this.publishProgress('saving_credentials', 'running');

    if (this.credentialsReadyHook) {
      await this.credentialsReadyHook({ appId, clientSecret });
    }
    this.publishProgress('saving_credentials', 'completed');

    this.publishProgress('updating_profile', 'running');
    const avatar = await uploadDefaultAvatar(creds);
    await modifyQqBotProfile(creds, appId, name, desc, avatar).catch(() => {});
    this.publishProgress('updating_profile', 'completed');

    this.complete({
      appId,
      clientSecret,
      desc,
      developerId,
      name,
    });
  }

  private async handleResponse(response: PlaywrightResponse): Promise<void> {
    if (this.cancelled || !this.page) return;

    const url = response.url();
    if (response.request().resourceType() !== 'fetch' && response.request().resourceType() !== 'xhr') {
      return;
    }

    if (url.startsWith(QQ_CREATE_SESSION_URL)) {
      await delay(QR_CAPTURE_DELAY_MS);
      const qrcodeUrl = await captureQrDataUrlWithRetry(this.page);
      if (qrcodeUrl) {
        this.publishQr(qrcodeUrl);
      }
      return;
    }

    if (!url.startsWith(QQ_POLL_URL)) {
      return;
    }

    try {
      const payload = await response.json() as QQBotApiEnvelope<QQBotLoginPollPayload>;
      const code = payload.data?.code;

      switch (code) {
        case QQ_POLL_SUCCESS: {
          const developerId = payload.data?.developer_id?.trim();
          if (!developerId) {
            throw new Error('QQ login succeeded but no developer ID was returned.');
          }
          this.loginSuccess.resolve({ developerId });
          break;
        }
        case QQ_POLL_EXPIRED:
        case QQ_POLL_REJECTED:
          this.publishProgress('waiting_for_scan', 'running');
          await this.refreshQr();
          break;
        case QQ_POLL_WAITING:
        case QQ_POLL_SCANNED:
        default:
          break;
      }
    } catch (error) {
      if (!this.closed) {
        this.fail(error);
      }
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
    if (this.refreshInFlight || !this.page || this.cancelled) {
      return;
    }

    this.refreshInFlight = (async () => {
      try {
        await this.page?.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
      } finally {
        this.refreshInFlight = null;
      }
    })();

    await this.refreshInFlight;
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
    this.loginSuccess.reject(error);
    this.completion.reject(error);
    void this.cleanup();
  }

  private async cleanup(): Promise<void> {
    const context = this.context;
    this.context = null;
    this.page = null;

    if (context) {
      try {
        await context.close();
      } catch {
        // Ignore close errors during cancellation/shutdown.
      }
    }

    const userDataDir = await this.tempUserDataDirPromise.catch(() => null);
    if (userDataDir) {
      await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
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
