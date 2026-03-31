#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const FEISHU_ACCOUNTS_BASE_URL = 'https://accounts.feishu.cn';
const FEISHU_OPEN_BASE_URL = 'https://open.feishu.cn';
const FEISHU_OPEN_APP_LIST_URL = `${FEISHU_OPEN_BASE_URL}/app`;
const FEISHU_LOGIN_URL = `${FEISHU_ACCOUNTS_BASE_URL}/accounts/page/login?app_id=7&force_login=1&no_trap=1&redirect_uri=${encodeURIComponent(`${FEISHU_OPEN_BASE_URL}/`)}`;
const FEISHU_QR_POLLING_STEP = 'qr_login_polling';
const FEISHU_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';
const DEFAULT_APP_NAME = 'TnymaAI Bot';
const DEFAULT_CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LOGIN_TIMEOUT_MS = 8 * 60_000;
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..', '..');

function printUsage() {
  console.log(`Usage: cleanup-feishu-tnyma-bots.sh [options]

Options:
  --target-name <name>  Exact app name to process. Default: ${DEFAULT_APP_NAME}
  --show-browser        Show the Chrome window instead of running in the background
  --help                Show this help message
`);
}

function parseArgs(argv) {
  let targetName = DEFAULT_APP_NAME;
  let showBrowser = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
    if (arg === '--show-browser') {
      showBrowser = true;
      continue;
    }
    if (arg === '--target-name') {
      const next = argv[i + 1];
      if (!next) {
        throw new Error('--target-name requires a value');
      }
      targetName = next;
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { targetName, showBrowser };
}

function resolveChromePath() {
  const candidate = process.env.CHROME_PATH || DEFAULT_CHROME_PATH;
  if (!fs.existsSync(candidate)) {
    throw new Error(`Chrome executable not found: ${candidate}`);
  }
  return candidate;
}

function getQrRenderDeps() {
  const projectRequire = createRequire(path.join(PROJECT_ROOT, 'package.json'));
  const openclawRequire = createRequire(projectRequire.resolve('openclaw'));
  const qrcodeTerminalPath = path.dirname(openclawRequire.resolve('qrcode-terminal/package.json'));
  return {
    QRCode: require(path.join(qrcodeTerminalPath, 'vendor', 'QRCode', 'index.js')),
    QRErrorCorrectLevel: require(path.join(qrcodeTerminalPath, 'vendor', 'QRCode', 'QRErrorCorrectLevel.js')),
  };
}

function createQrMatrix(input) {
  const { QRCode, QRErrorCorrectLevel } = getQrRenderDeps();
  const qr = new QRCode(-1, QRErrorCorrectLevel.Q);
  qr.addData(input);
  qr.make();
  return qr;
}

function buildQrContentFromToken(token) {
  return JSON.stringify({ qrlogin: { token } });
}

function renderQrToTerminal(input) {
  const qr = createQrMatrix(input);
  const modules = qr.getModuleCount();
  const margin = 2;
  const isDark = (row, col) => {
    if (row < 0 || col < 0 || row >= modules || col >= modules) {
      return false;
    }
    return qr.isDark(row, col);
  };

  const lines = [];
  for (let row = -margin; row < modules + margin; row += 2) {
    let line = '';
    for (let col = -margin; col < modules + margin; col += 1) {
      const top = isDark(row, col);
      const bottom = isDark(row + 1, col);
      if (top && bottom) {
        line += '█';
      } else if (top) {
        line += '▀';
      } else if (bottom) {
        line += '▄';
      } else {
        line += ' ';
      }
    }
    lines.push(line);
  }

  process.stdout.write('\x1Bc');
  console.log('Scan this Feishu QR code in the mobile app, then confirm login:\n');
  console.log(lines.join('\n'));
  console.log('');
}

function safeJsonParse(text, context) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${context} did not return JSON: ${String(error)}\n${text.slice(0, 500)}`);
  }
}

async function activateQrLogin(page) {
  return await page.evaluate(() => {
    const selectors = [
      '.switch-login-mode-box',
      '[class*="switch-login-mode"]',
      '[class*="qrcode-switch"]',
      '[class*="qr-switch"]',
      '[data-testid="qrcode-login"]',
      '[data-testid="qr-login"]',
    ];

    const isVisible = (node) => {
      if (!(node instanceof HTMLElement)) {
        return false;
      }
      const style = window.getComputedStyle(node);
      return style.display !== 'none' && style.visibility !== 'hidden' && node.offsetParent !== null;
    };

    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (node instanceof HTMLElement && isVisible(node)) {
        node.click();
        return true;
      }
    }

    if (
      document.querySelector('[class*="qrcode"]')
      || document.querySelector('[class*="qr-code"]')
      || document.querySelector('canvas')
    ) {
      return true;
    }

    return false;
  });
}

async function canAccessOpenPlatform(context) {
  const cookies = await context.cookies([FEISHU_ACCOUNTS_BASE_URL, FEISHU_OPEN_BASE_URL]);
  if (cookies.length === 0) {
    return false;
  }

  const cookieHeader = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
  const response = await fetch(FEISHU_OPEN_APP_LIST_URL, {
    headers: {
      Cookie: cookieHeader,
      'User-Agent': FEISHU_USER_AGENT,
    },
    redirect: 'follow',
  });

  return response.ok && response.url.startsWith(`${FEISHU_OPEN_BASE_URL}/app`);
}

async function waitForLogin(page) {
  let lastToken = '';
  let lastStatusKey = '';
  let settled = false;
  let resolveLogin;
  let rejectLogin;

  const finishResolve = (reason) => {
    if (settled) {
      return;
    }
    settled = true;
    console.log(`Login confirmed: ${reason}`);
    resolveLogin?.();
  };

  const finishReject = (error) => {
    if (settled) {
      return;
    }
    settled = true;
    rejectLogin?.(error);
  };

  const onResponse = async (response) => {
    const url = response.url();
    if (!url.includes('/accounts/qrlogin/init') && !url.includes('/accounts/qrlogin/polling')) {
      return;
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      return;
    }

    if (payload?.code !== 0) {
      return;
    }

    if (url.includes('/accounts/qrlogin/init')) {
      const token = payload?.data?.step_info?.token?.trim();
      if (token && token !== lastToken) {
        lastToken = token;
        renderQrToTerminal(buildQrContentFromToken(token));
      }
      return;
    }

    const nextStep = payload?.data?.next_step;
    const status = payload?.data?.step_info?.status;
    const statusKey = `${String(status)}:${String(nextStep || '')}`;
    if (statusKey !== lastStatusKey) {
      lastStatusKey = statusKey;
      console.log(`Login polling status: status=${String(status)} next_step=${String(nextStep || '')}`);
    }

    if (status === 3) {
      finishReject(new Error('Feishu QR login was cancelled.'));
      return;
    }

    if (status === 5) {
      console.log('QR code expired. Reloading login page...');
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
      await activateQrLogin(page).catch(() => {});
      return;
    }

    if ((nextStep && nextStep !== FEISHU_QR_POLLING_STEP) || status === 0) {
      finishResolve(`polling signaled next_step=${String(nextStep || '')} status=${String(status)}`);
    }
  };

  page.on('response', onResponse);

  const loginPromise = new Promise((resolve, reject) => {
    resolveLogin = resolve;
    rejectLogin = reject;
  });

  const loginTimer = delay(LOGIN_TIMEOUT_MS).then(() => {
    throw new Error('Timed out waiting for Feishu QR login confirmation.');
  });

  const navigationPromise = page.waitForURL((url) => {
    const value = url.toString();
    return value.startsWith(`${FEISHU_OPEN_BASE_URL}/`) || /^https:\/\/[^/]+\.feishu\.cn\/admin\//.test(value);
  }, { timeout: LOGIN_TIMEOUT_MS }).then(() => {
    finishResolve(`browser navigated to ${page.url()}`);
  }).catch(() => {});

  const openPlatformProbe = (async () => {
    while (!settled) {
      try {
        if (await canAccessOpenPlatform(page.context())) {
          finishResolve('open.feishu.cn session check passed');
          return;
        }
      } catch {
        // Ignore probe failures while login is still in progress.
      }
      await delay(1500);
    }
  })();

  await page.goto(FEISHU_LOGIN_URL, { waitUntil: 'domcontentloaded' });
  await activateQrLogin(page);

  try {
    await Promise.race([loginPromise, loginTimer, navigationPromise, openPlatformProbe]);
  } catch (error) {
    finishReject(error);
    throw error;
  } finally {
    page.off('response', onResponse);
  }
}

async function ensureOpenPlatformPage(page) {
  const listResponsePromise = page.waitForResponse((response) => {
    return response.request().method() === 'POST'
      && response.url().includes('/developers/v1/app/list');
  }, { timeout: 60_000 });

  await page.goto(FEISHU_OPEN_APP_LIST_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/open\.feishu\.cn\/app/, { timeout: 60_000 });
  const listResponse = await listResponsePromise;
  const requestHeaders = listResponse.request().headers();
  const reusableHeaders = {};

  for (const [key, value] of Object.entries(requestHeaders)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey === 'accept' || lowerKey === 'content-type' || lowerKey === 'x-requested-with' || lowerKey.startsWith('x-')) {
      reusableHeaders[key] = value;
    }
  }

  return { reusableHeaders };
}

async function browserJsonFetch(page, url, options = {}) {
  const {
    method = 'GET',
    body = undefined,
    headers = {},
    referrer = undefined,
  } = options;

  const result = await page.evaluate(async ({ url: requestUrl, method: requestMethod, body, headers, referrer }) => {
    const response = await fetch(requestUrl, {
      method: requestMethod,
      credentials: 'include',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      referrer,
    });

    return {
      ok: response.ok,
      status: response.status,
      text: await response.text(),
      finalUrl: response.url,
    };
  }, {
    url,
    method,
    body,
    headers,
    referrer,
  });

  const json = result.text ? safeJsonParse(result.text, url) : null;
  return {
    ...result,
    json,
  };
}

async function openPlatformApi(page, pathName, options = {}, baseHeaders = {}) {
  const requestUrl = `${FEISHU_OPEN_BASE_URL}${pathName}`;
  const headers = {
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/json;charset=UTF-8',
    'X-Requested-With': 'XMLHttpRequest',
    ...baseHeaders,
    ...(options.headers || {}),
  };

  const response = await browserJsonFetch(page, requestUrl, {
    ...options,
    headers,
  });

  if (!response.ok) {
    throw new Error(`Open Platform request failed: ${requestUrl} -> HTTP ${response.status} body=${response.text.slice(0, 500)}`);
  }

  if (response.json?.code !== 0) {
    throw new Error(`Open Platform API error: ${requestUrl} -> code=${String(response.json?.code)} msg=${String(response.json?.msg || '')}`);
  }

  return response.json;
}

async function listAllOpenApps(page, sceneType, reusableHeaders) {
  const items = [];
  let cursor = 0;
  const count = 10;
  let totalCount = Infinity;

  while (cursor < totalCount) {
    const payload = await openPlatformApi(page, '/developers/v1/app/list', {
      method: 'POST',
      body: {
        Count: count,
        Cursor: cursor,
        QueryFilter: {
          filterAppSceneTypeList: [sceneType],
      },
      OrderBy: 0,
    },
    referrer: FEISHU_OPEN_APP_LIST_URL,
    }, reusableHeaders);

    const apps = Array.isArray(payload?.data?.apps) ? payload.data.apps : [];
    totalCount = typeof payload?.data?.totalCount === 'number' ? payload.data.totalCount : apps.length;
    items.push(...apps);

    if (apps.length === 0) {
      break;
    }

    cursor += apps.length;
  }

  return items;
}

async function resolveSuiteAdminOrigin(page) {
  await page.goto('https://www.feishu.cn/admin/index', { waitUntil: 'domcontentloaded' });
  await page.waitForURL((url) => {
    return /https:\/\/[^/]+\.feishu\.cn\/admin\/index/.test(url.toString());
  }, { timeout: 60_000 });
  return new URL(page.url()).origin;
}

async function suiteAdminApi(page, suiteOrigin, pathName, baseHeaders = {}, options = {}) {
  const requestUrl = `${suiteOrigin}${pathName}`;
  const headers = {
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/json;charset=UTF-8',
    'X-Requested-With': 'XMLHttpRequest',
    ...baseHeaders,
    ...(options.headers || {}),
  };

  const response = await browserJsonFetch(page, requestUrl, {
    ...options,
    headers,
  });

  if (!response.ok) {
    throw new Error(`Suite Admin request failed: ${requestUrl} -> HTTP ${response.status} body=${response.text.slice(0, 500)}`);
  }

  if (response.json?.code !== 0) {
    throw new Error(`Suite Admin API error: ${requestUrl} -> code=${String(response.json?.code)} msg=${String(response.json?.message || '')}`);
  }

  return response.json;
}

async function loadSuiteAppDetail(page, suiteOrigin, appId) {
  const detailResponsePromise = page.waitForResponse((response) => {
    return response.request().method() === 'GET'
      && response.url().includes(`/suite/admin/appcenter/v4/app/${appId}/detail`);
  }, { timeout: 30_000 });

  const manageUrl = `${suiteOrigin}/admin/appCenter/manage/${appId}`;
  await page.goto(manageUrl, { waitUntil: 'domcontentloaded' });
  const detailResponse = await detailResponsePromise;
  const payload = await detailResponse.json();

  if (!detailResponse.ok() || payload?.code !== 0) {
    throw new Error(`Suite Admin detail request failed for ${appId}: HTTP ${detailResponse.status()}`);
  }

  const requestHeaders = detailResponse.request().headers();
  const reusableHeaders = {};
  for (const [key, value] of Object.entries(requestHeaders)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey === 'accept' || lowerKey === 'content-type' || lowerKey === 'x-requested-with' || lowerKey.startsWith('x-')) {
      reusableHeaders[key] = value;
    }
  }

  return { payload, reusableHeaders, manageUrl };
}

async function disableAppIfEnabled(page, suiteOrigin, appId) {
  const detailResult = await loadSuiteAppDetail(page, suiteOrigin, appId);
  const isEnabled = Boolean(detailResult.payload?.data?.config?.active?.open);

  if (!isEnabled) {
    return { changed: false };
  }

  await suiteAdminApi(page, suiteOrigin, `/suite/admin/appcenter/v4/app/${appId}/stop`, detailResult.reusableHeaders, {
    method: 'PUT',
    body: {},
    referrer: detailResult.manageUrl,
  });

  return { changed: true };
}

function createDeleteChallenge() {
  return crypto.randomBytes(64).toString('base64');
}

async function deleteApp(page, appId, reusableHeaders) {
  const baseInfoUrl = `${FEISHU_OPEN_BASE_URL}/app/${appId}/baseinfo`;
  await page.goto(baseInfoUrl, { waitUntil: 'domcontentloaded' });

  const payload = await openPlatformApi(page, `/developers/v1/app/delete/${appId}`, {
    method: 'POST',
    body: {
      challenge: createDeleteChallenge(),
    },
    referrer: baseInfoUrl,
  }, reusableHeaders);

  return payload;
}

function uniqByAppId(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const appId = item?.appID;
    if (!appId || seen.has(appId)) {
      continue;
    }
    seen.add(appId);
    result.push(item);
  }
  return result;
}

async function main() {
  const { targetName, showBrowser } = parseArgs(process.argv.slice(2));
  const executablePath = resolveChromePath();

  const browser = await chromium.launch({
    executablePath,
    headless: !showBrowser,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  const context = await browser.newContext({
    userAgent: FEISHU_USER_AGENT,
    viewport: { width: 1440, height: 960 },
  });

  const loginPage = await context.newPage();

  try {
    console.log('Opening Feishu login flow...');
    await waitForLogin(loginPage);
    console.log('Feishu QR login confirmed.');

    const openPlatformSession = await ensureOpenPlatformPage(loginPage);
    const suitePage = await context.newPage();
    const suiteOrigin = await resolveSuiteAdminOrigin(suitePage);
    console.log(`Resolved suite admin origin: ${suiteOrigin}`);

    const allApps = uniqByAppId([
      ...await listAllOpenApps(loginPage, 0, openPlatformSession.reusableHeaders),
      ...await listAllOpenApps(loginPage, 1, openPlatformSession.reusableHeaders),
    ]);

    const targetApps = allApps.filter((app) => app?.name === targetName);
    console.log(`Found ${targetApps.length} app(s) named "${targetName}".`);

    if (targetApps.length === 0) {
      await browser.close();
      return;
    }

    let disabledCount = 0;
    let deletedCount = 0;

    for (const app of targetApps) {
      const appId = app.appID;
      console.log(`\nProcessing ${appId} (${app.name})`);

      try {
        const disableResult = await disableAppIfEnabled(suitePage, suiteOrigin, appId);
        if (disableResult.changed) {
          disabledCount += 1;
          console.log(`Disabled ${appId}`);
        } else {
          console.log(`Already disabled: ${appId}`);
        }
      } catch (error) {
        console.warn(`Disable step failed for ${appId}: ${String(error)}`);
      }

      await deleteApp(loginPage, appId, openPlatformSession.reusableHeaders);
      deletedCount += 1;
      console.log(`Deleted ${appId}`);
    }

    console.log(`\nDone. Disabled ${disabledCount} app(s), deleted ${deletedCount} app(s).`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`Fatal: ${String(error)}`);
  process.exit(1);
});
