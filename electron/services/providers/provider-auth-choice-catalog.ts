import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { getOpenClawResolvedDir } from '../../utils/paths';

export interface UpstreamProviderAuthChoiceOption {
  value: string;
  label: string;
  hint?: string;
}

export interface UpstreamProviderAuthChoiceGroup {
  value: string;
  label: string;
  hint?: string;
  options: UpstreamProviderAuthChoiceOption[];
}

type OpenClawAuthChoiceModule = {
  buildAuthChoiceGroups?: (params: { store: object; includeSkip: boolean }) => {
    groups?: UpstreamProviderAuthChoiceGroup[];
  };
  t?: (params: { store: object; includeSkip: boolean }) => {
    groups?: UpstreamProviderAuthChoiceGroup[];
  };
};

let authChoiceModulePromise: Promise<OpenClawAuthChoiceModule> | null = null;

function withIsolatedOpenClawEnv<T>(run: () => Promise<T>): Promise<T> {
  const previous = {
    OPENCLAW_CONFIG_PATH: process.env.OPENCLAW_CONFIG_PATH,
    OPENCLAW_HOME: process.env.OPENCLAW_HOME,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
  };

  const isolatedHome = join(tmpdir(), 'tnyma-ai-openclaw-auth-choice-home');
  process.env.OPENCLAW_CONFIG_PATH = join(tmpdir(), 'tnyma-ai-openclaw-auth-choice.json');
  process.env.OPENCLAW_HOME = isolatedHome;
  process.env.HOME = isolatedHome;
  process.env.USERPROFILE = isolatedHome;

  return run().finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}

async function loadAuthChoiceModule(): Promise<OpenClawAuthChoiceModule> {
  if (!authChoiceModulePromise) {
    authChoiceModulePromise = withIsolatedOpenClawEnv(async () => {
      const distDir = join(getOpenClawResolvedDir(), 'dist');
      const entry = (await readdir(distDir)).find((file) => /^auth-choice-options-.*\.js$/.test(file));
      if (!entry) {
        throw new Error(`OpenClaw auth-choice module not found in ${distDir}`);
      }
      return await import(pathToFileURL(join(distDir, entry)).href) as OpenClawAuthChoiceModule;
    });
  }

  return authChoiceModulePromise;
}

export async function listUpstreamProviderAuthChoiceGroups(): Promise<UpstreamProviderAuthChoiceGroup[]> {
  const mod = await loadAuthChoiceModule();
  const buildGroups = mod.buildAuthChoiceGroups ?? mod.t;
  if (!buildGroups) {
    throw new Error('OpenClaw auth-choice groups export not found');
  }

  const result = buildGroups({
    store: {},
    includeSkip: false,
  });

  const groups = Array.isArray(result?.groups) ? result.groups : [];
  return groups
    .filter((group) => Array.isArray(group.options) && group.options.length > 0)
    .map((group) => ({
      value: group.value,
      label: group.label,
      ...(group.hint ? { hint: group.hint } : {}),
      options: group.options.map((option) => ({
        value: option.value,
        label: option.label,
        ...(option.hint ? { hint: option.hint } : {}),
      })),
    }));
}
