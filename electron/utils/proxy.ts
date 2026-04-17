/**
 * Proxy helpers shared by the Electron main process and Gateway launcher.
 */

import { execFileSync } from 'node:child_process';

export interface ProxySettings {
  proxyEnabled: boolean;
  proxyServer: string;
  proxyHttpServer: string;
  proxyHttpsServer: string;
  proxyAllServer: string;
  proxyBypassRules: string;
}

export interface ResolvedProxySettings {
  httpProxy: string;
  httpsProxy: string;
  allProxy: string;
  bypassRules: string;
}

export interface ElectronProxyConfig {
  mode: 'direct' | 'fixed_servers';
  proxyRules?: string;
  proxyBypassRules?: string;
}

const BLANK_PROXY_ENV = {
  HTTP_PROXY: '',
  HTTPS_PROXY: '',
  ALL_PROXY: '',
  http_proxy: '',
  https_proxy: '',
  all_proxy: '',
  NO_PROXY: '',
  no_proxy: '',
};

const DEFAULT_LOCAL_BYPASS = '<local>;localhost;127.0.0.1;::1';

function trimValue(value: string | undefined | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Accept bare host:port values from users and normalize them to a valid URL.
 * Electron accepts scheme-less proxy rules in some cases, but child-process
 * env vars are more reliable when they are full URLs.
 */
export function normalizeProxyServer(proxyServer: string): string {
  const value = trimValue(proxyServer);
  if (!value) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
  return `http://${value}`;
}

export function resolveProxySettings(settings: ProxySettings): ResolvedProxySettings {
  const legacyProxy = normalizeProxyServer(settings.proxyServer);
  const allProxy = normalizeProxyServer(settings.proxyAllServer);
  const httpProxy = normalizeProxyServer(settings.proxyHttpServer) || legacyProxy || allProxy;
  const httpsProxy = normalizeProxyServer(settings.proxyHttpsServer) || legacyProxy || allProxy;

  return {
    httpProxy,
    httpsProxy,
    allProxy: allProxy || legacyProxy,
    bypassRules: trimValue(settings.proxyBypassRules),
  };
}

export function buildElectronProxyConfig(settings: ProxySettings): ElectronProxyConfig {
  if (!settings.proxyEnabled) {
    return { mode: 'direct' };
  }

  const resolved = resolveProxySettings(settings);
  const rules: string[] = [];

  if (resolved.httpProxy) {
    rules.push(`http=${resolved.httpProxy}`);
  }
  if (resolved.httpsProxy) {
    rules.push(`https=${resolved.httpsProxy}`);
  }

  // Fallback rule for protocols like ws/wss or when users only configured ALL_PROXY.
  const fallbackProxy = resolved.allProxy || resolved.httpsProxy || resolved.httpProxy;
  if (fallbackProxy) {
    rules.push(fallbackProxy);
  }

  if (rules.length === 0) {
    return { mode: 'direct' };
  }

  return {
    mode: 'fixed_servers',
    proxyRules: rules.join(';'),
    ...(resolved.bypassRules ? { proxyBypassRules: resolved.bypassRules } : {}),
  };
}

export function buildProxyEnv(settings: ProxySettings): Record<string, string> {
  if (!settings.proxyEnabled) {
    return BLANK_PROXY_ENV;
  }

  const resolved = resolveProxySettings(settings);
  return buildResolvedProxyEnv(resolved);
}

function buildResolvedProxyEnv(resolved: ResolvedProxySettings): Record<string, string> {
  const noProxy = resolved.bypassRules
    .split(/[,\n;]/)
    .map((rule) => rule.trim())
    .filter(Boolean)
    .join(',');

  return {
    HTTP_PROXY: resolved.httpProxy,
    HTTPS_PROXY: resolved.httpsProxy,
    ALL_PROXY: resolved.allProxy,
    http_proxy: resolved.httpProxy,
    https_proxy: resolved.httpsProxy,
    all_proxy: resolved.allProxy,
    NO_PROXY: noProxy,
    no_proxy: noProxy,
  };
}

function hasExplicitProxyServers(settings: ProxySettings): boolean {
  return [
    settings.proxyServer,
    settings.proxyHttpServer,
    settings.proxyHttpsServer,
    settings.proxyAllServer,
  ].some((value) => trimValue(value).length > 0);
}

function hasAnyResolvedProxy(resolved: ResolvedProxySettings | null | undefined): resolved is ResolvedProxySettings {
  return Boolean(resolved && (resolved.httpProxy || resolved.httpsProxy || resolved.allProxy));
}

function resolveProxySettingsFromEnv(env: NodeJS.ProcessEnv): ResolvedProxySettings | null {
  const httpProxy = trimValue(env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy);
  const httpsProxy = trimValue(env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy);
  const allProxy = trimValue(env.ALL_PROXY || env.all_proxy);
  const bypassRules = trimValue(env.NO_PROXY || env.no_proxy);

  if (!httpProxy && !httpsProxy && !allProxy) {
    return null;
  }

  return {
    httpProxy: normalizeProxyServer(httpProxy),
    httpsProxy: normalizeProxyServer(httpsProxy),
    allProxy: normalizeProxyServer(allProxy),
    bypassRules,
  };
}

function parseScutilProxyOutput(output: string): ResolvedProxySettings | null {
  if (!output.trim()) {
    return null;
  }

  const values = new Map<string, string>();
  const exceptions: string[] = [];
  let inExceptionsList = false;

  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('ExceptionsList')) {
      inExceptionsList = true;
      continue;
    }
    if (inExceptionsList) {
      if (line === '}') {
        inExceptionsList = false;
        continue;
      }
      const match = line.match(/^\d+\s*:\s*(.+)$/);
      if (match) {
        exceptions.push(match[1].trim());
      }
      continue;
    }

    const separator = line.indexOf(' : ');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 3).trim();
    values.set(key, value);
  }

  const httpProxy = values.get('HTTPEnable') === '1'
    ? normalizeProxyServer(`${values.get('HTTPProxy') || ''}:${values.get('HTTPPort') || ''}`.replace(/:$/, ''))
    : '';
  const httpsProxy = values.get('HTTPSEnable') === '1'
    ? normalizeProxyServer(`${values.get('HTTPSProxy') || ''}:${values.get('HTTPSPort') || ''}`.replace(/:$/, ''))
    : '';
  const allProxy = values.get('SOCKSEnable') === '1'
    ? normalizeProxyServer(`socks5://${values.get('SOCKSProxy') || ''}:${values.get('SOCKSPort') || ''}`.replace(/:$/, ''))
    : '';

  if (!httpProxy && !httpsProxy && !allProxy) {
    return null;
  }

  const bypassRules = [...exceptions, ...DEFAULT_LOCAL_BYPASS.split(';')]
    .map((rule) => rule.trim())
    .filter(Boolean)
    .filter((rule, index, array) => array.indexOf(rule) === index)
    .join(';');

  return {
    httpProxy,
    httpsProxy,
    allProxy,
    bypassRules,
  };
}

function resolveMacOsSystemProxySettings(scutilOutput?: string): ResolvedProxySettings | null {
  if (process.platform !== 'darwin') {
    return null;
  }

  try {
    const output = scutilOutput ?? execFileSync('scutil', ['--proxy'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return parseScutilProxyOutput(output);
  } catch {
    return null;
  }
}

export function resolveRuntimeProxySettings(
  settings: ProxySettings,
  options?: {
    env?: NodeJS.ProcessEnv;
    scutilOutput?: string;
  },
): ResolvedProxySettings | null {
  if (settings.proxyEnabled) {
    const configured = resolveProxySettings(settings);
    return hasAnyResolvedProxy(configured) ? configured : null;
  }

  if (hasExplicitProxyServers(settings)) {
    return null;
  }

  const inherited = resolveProxySettingsFromEnv(options?.env ?? process.env);
  if (hasAnyResolvedProxy(inherited)) {
    return inherited;
  }

  const system = resolveMacOsSystemProxySettings(options?.scutilOutput);
  return hasAnyResolvedProxy(system) ? system : null;
}

export function buildRuntimeElectronProxyConfig(
  settings: ProxySettings,
  options?: {
    env?: NodeJS.ProcessEnv;
    scutilOutput?: string;
  },
): ElectronProxyConfig {
  const resolved = resolveRuntimeProxySettings(settings, options);
  if (!resolved) {
    return { mode: 'direct' };
  }

  const rules: string[] = [];
  if (resolved.httpProxy) {
    rules.push(`http=${resolved.httpProxy}`);
  }
  if (resolved.httpsProxy) {
    rules.push(`https=${resolved.httpsProxy}`);
  }

  const fallbackProxy = resolved.allProxy || resolved.httpsProxy || resolved.httpProxy;
  if (fallbackProxy) {
    rules.push(fallbackProxy);
  }

  if (rules.length === 0) {
    return { mode: 'direct' };
  }

  return {
    mode: 'fixed_servers',
    proxyRules: rules.join(';'),
    ...(resolved.bypassRules ? { proxyBypassRules: resolved.bypassRules } : {}),
  };
}

export function buildRuntimeProxyEnv(
  settings: ProxySettings,
  options?: {
    env?: NodeJS.ProcessEnv;
    scutilOutput?: string;
  },
): Record<string, string> {
  const resolved = resolveRuntimeProxySettings(settings, options);
  if (!resolved) {
    return hasExplicitProxyServers(settings) ? BLANK_PROXY_ENV : {};
  }

  return buildResolvedProxyEnv({
    ...resolved,
    bypassRules: resolved.bypassRules || DEFAULT_LOCAL_BYPASS,
  });
}
