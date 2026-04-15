import { resolveSupportedLanguage, type LanguageCode } from '../../shared/language';
import { PORTS } from './config';

type InstallerWebLocale = 'en' | 'zh-CN';

function resolveInstallerWebLocale(language?: string | null): InstallerWebLocale {
  const normalized = resolveSupportedLanguage(language);
  return normalized === 'zh' ? 'zh-CN' : 'en';
}

export function buildInstallerWebUiUrl(input?: {
  language?: string | null;
  port?: number;
  path?: string;
}): string {
  const port = input?.port ?? PORTS.TNYMA_AI_WEB;
  const locale = resolveInstallerWebLocale(input?.language);
  const path = input?.path?.trim() || 'agents';
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path;

  return `http://127.0.0.1:${port}/${locale}/${normalizedPath}`;
}

export function getInstallerWebUiHealthUrl(port = PORTS.TNYMA_AI_WEB): string {
  return `http://127.0.0.1:${port}/`;
}

export function getInstallerLiveGatewayHealthUrl(port = PORTS.TNYMA_AI_LIVE_GATEWAY): string {
  return `http://127.0.0.1:${port}/health`;
}

export function resolveInstallerWebLanguage(language?: string | null): LanguageCode {
  return resolveSupportedLanguage(language);
}
