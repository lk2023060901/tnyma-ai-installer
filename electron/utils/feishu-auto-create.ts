import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserContext, Page, Request, Response } from 'playwright-core';
import { proxyAwareFetch } from './proxy-fetch';

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
const QR_CAPTURE_DELAY_MS = 400;
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

async function captureQrDataUrl(page: Page): Promise<string | null> {
  const selectors = [
    '.newLogin_scan-QR-code canvas',
    '.new-scan-qrcode-container canvas',
    '[class*="qrcode"] canvas',
    '[class*="qr-code"] canvas',
    'canvas',
  ];

  for (const selector of selectors) {
    try {
      const dataUrl = await page.evaluate((inputSelector) => {
        const canvas = document.querySelector(inputSelector) as HTMLCanvasElement | null;
        if (!canvas || canvas.width < 64 || canvas.height < 64) {
          return null;
        }
        return canvas.toDataURL('image/png');
      }, selector);

      if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/png;base64,')) {
        return dataUrl;
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function captureQrDataUrlWithRetry(page: Page, attempts = 8, delayMs = 250): Promise<string | null> {
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

async function waitForOpenPlatformNavigation(page: Page): Promise<void> {
  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const url = page.url();
    if (url.startsWith(FEISHU_OPEN_BASE_URL) && !url.startsWith(`${FEISHU_ACCOUNTS_BASE_URL}/accounts/page/login`)) {
      return;
    }
    await page.waitForTimeout(1000);
  }
  throw new Error('Timed out waiting for Feishu login confirmation.');
}

async function captureCredentials(context: BrowserContext, page: Page): Promise<Credentials> {
  let csrfToken = '';
  let requestCookieString = '';

  const onRequest = (request: Request) => {
    if (!request.url().includes('/developers/')) return;
    const headers = request.headers();
    if (!requestCookieString && typeof headers.cookie === 'string' && headers.cookie.trim()) {
      requestCookieString = headers.cookie.trim();
    }
    if (!csrfToken && typeof headers['x-csrf-token'] === 'string' && headers['x-csrf-token'].trim()) {
      csrfToken = headers['x-csrf-token'].trim();
    }
  };

  context.on('request', onRequest);
  try {
    await page.goto(FEISHU_APP_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

    const deadline = Date.now() + 15_000;
    while (!csrfToken && Date.now() < deadline) {
      await page.waitForTimeout(250);
    }

    const cookies = await context.cookies([
      FEISHU_OPEN_BASE_URL,
      FEISHU_PASSPORT_BASE_URL,
      FEISHU_ACCOUNTS_BASE_URL,
    ]);
    const contextCookieString = buildCookieStringFromContextCookies(cookies);
    const mergedCookieString = buildMergedCookieString(requestCookieString, contextCookieString);
    const csrfCookie = cookies.find((cookie) => cookie.name === 'lark_oapi_csrf_token' || cookie.name === 'swp_csrf_token');
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
  } finally {
    context.off('request', onRequest);
  }
}

class FeishuAutoCreateSession extends EventEmitter {
  readonly sessionKey = randomUUID();

  private readonly firstQr = createDeferred<string>();
  private readonly completion = createDeferred<FeishuAutoCreateResult>();
  private readonly tempUserDataDirPromise = mkdtemp(join(tmpdir(), 'tnyma-feishu-auto-create-'));
  private readonly runPromise: Promise<void>;
  private cancelled = false;
  private closed = false;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private latestQrDataUrl: string | null = null;
  private refreshInFlight: Promise<void> | null = null;
  private credentialsReadyHook: ((payload: FeishuCredentialsReadyPayload) => void | Promise<void>) | null = null;
  private firstQrDelivered = false;

  constructor(private readonly options: FeishuAutoCreateStartOptions) {
    super();
    this.runPromise = this.run();
    this.runPromise.catch((error) => {
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

    if (onQrRefresh) {
      this.on(SESSION_EVENT_QR, onQrRefresh);
      if (this.latestQrDataUrl) {
        void onQrRefresh({ qrcodeUrl: this.latestQrDataUrl });
      }
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
    }
  }

  async cancel(): Promise<void> {
    this.cancelled = true;
    await this.cleanup();
  }

  private async run(): Promise<void> {
    const { chromium } = await import('playwright-core');
    const executablePath = findChromeExecutable();
    const userDataDir = await this.tempUserDataDirPromise;

    this.context = await chromium.launchPersistentContext(userDataDir, {
      executablePath,
      headless: false,
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

    await this.page.goto(buildLoginUrl(FEISHU_APP_LIST_URL), {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });

    await waitForOpenPlatformNavigation(this.page);

    if (this.cancelled) {
      throw new Error('Feishu login was cancelled.');
    }

    const creds = await captureCredentials(this.context, this.page);
    const name = normalizeAppName(this.options.appName);
    const desc = normalizeAppDescription(this.options.appDescription);
    const avatar = await uploadDefaultAvatar(creds);
    const appId = await createFeishuApp(creds, name, desc, avatar);
    const appSecret = await getFeishuAppSecret(creds, appId);

    await enableFeishuBot(creds, appId);

    if (this.credentialsReadyHook) {
      await this.credentialsReadyHook({
        appId,
        appSecret,
        connectionMode: 'websocket',
      });
    }

    const unresolvedScopes = await updateFeishuScopes(creds, appId);
    await updateFeishuEvents(creds, appId);
    await switchFeishuCallbackMode(creds, appId);
    const creatorId = await getCurrentUserId(creds);
    const versionId = await createVersionAndPublish(creds, appId, creatorId);

    this.complete({
      appId,
      appSecret,
      versionId,
      name,
      desc,
      unresolvedScopes,
    });
  }

  private async handleResponse(response: Response): Promise<void> {
    if (this.cancelled || !this.page) return;

    const url = response.url();
    if (!url.startsWith(FEISHU_ACCOUNTS_BASE_URL)) return;
    if (response.request().resourceType() !== 'fetch' && response.request().resourceType() !== 'xhr') return;

    if (url.includes('/accounts/qrlogin/init')) {
      await delay(QR_CAPTURE_DELAY_MS);
      const qrcodeUrl = await captureQrDataUrlWithRetry(this.page);
      if (qrcodeUrl) {
        this.publishQr(qrcodeUrl);
      }
      return;
    }

    if (!url.includes('/accounts/qrlogin/polling')) return;

    try {
      const payload = await response.json() as {
        code?: number;
        data?: {
          step_info?: {
            status?: number;
          };
        };
      };

      const status = payload?.data?.step_info?.status;
      if (status === 5) {
        await this.refreshQr();
      }
    } catch {
      // Ignore transient parsing failures from polling requests.
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

  private complete(result: FeishuAutoCreateResult): void {
    if (this.closed) return;
    this.closed = true;
    this.completion.resolve(result);
    void this.cleanup();
  }

  private fail(error: unknown): void {
    if (this.closed) return;
    this.closed = true;
    this.firstQr.reject(error);
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
