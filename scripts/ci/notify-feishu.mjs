#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const BUILD_METADATA_PATH = path.join(ROOT, 'build', 'build-metadata.json');
const RELEASE_NOTES_PATH = path.join(ROOT, 'build', 'release-notes.md');
const FEISHU_OPEN_BASE_URL = 'https://open.feishu.cn';
const FEISHU_IM_API_BASE_URL = `${FEISHU_OPEN_BASE_URL}/open-apis/im/v1`;
const FEISHU_TENANT_ACCESS_TOKEN_URL = `${FEISHU_OPEN_BASE_URL}/open-apis/auth/v3/tenant_access_token/internal`;

const mode = (process.argv[2] || 'build-success').trim().toLowerCase();

function loadJson(targetPath) {
  try {
    return JSON.parse(readFileSync(targetPath, 'utf8'));
  } catch {
    return null;
  }
}

function packageJsonVersion() {
  const packageJson = loadJson(path.join(ROOT, 'package.json'));
  return packageJson?.version || 'unknown';
}

function requiredBotConfig(prefix) {
  return {
    appId: process.env[`${prefix}_APP_ID`]?.trim() || '',
    appSecret: process.env[`${prefix}_APP_SECRET`]?.trim() || '',
    chatId: process.env[`${prefix}_CHAT_ID`]?.trim() || '',
    chatName: process.env[`${prefix}_CHAT_NAME`]?.trim() || '',
  };
}

function getBotConfig() {
  if (mode.startsWith('release-')) {
    return requiredBotConfig('FEISHU_RELEASE_BOT');
  }
  return requiredBotConfig('FEISHU_BUILD_BOT');
}

function releaseUrl() {
  if (!process.env.CI_PROJECT_URL || !process.env.CI_COMMIT_TAG) {
    return '';
  }
  return `${process.env.CI_PROJECT_URL}/-/releases/${encodeURIComponent(process.env.CI_COMMIT_TAG)}`;
}

async function fetchTenantAccessToken(appId, appSecret) {
  const response = await fetch(FEISHU_TENANT_ACCESS_TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      app_id: appId,
      app_secret: appSecret,
    }),
  });

  const payload = await response.json();
  if (!response.ok || payload.code !== 0 || !payload.tenant_access_token?.trim()) {
    throw new Error(`Failed to get Feishu tenant access token: HTTP ${response.status} code=${String(payload.code ?? 'unknown')} msg=${payload.msg || 'unknown'}`);
  }

  return payload.tenant_access_token.trim();
}

async function listChats(tenantAccessToken) {
  const chats = [];
  let pageToken = '';

  for (;;) {
    const url = new URL(`${FEISHU_IM_API_BASE_URL}/chats`);
    url.searchParams.set('page_size', '100');
    if (pageToken) {
      url.searchParams.set('page_token', pageToken);
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${tenantAccessToken}`,
      },
    });

    const payload = await response.json();
    if (!response.ok || payload.code !== 0) {
      throw new Error(`Failed to list Feishu chats: HTTP ${response.status} code=${String(payload.code ?? 'unknown')} msg=${payload.msg || 'unknown'}`);
    }

    for (const item of payload.data?.items || []) {
      chats.push({
        chatId: item.chat_id?.trim() || '',
        name: item.name?.trim() || '',
      });
    }

    if (!payload.data?.has_more || !payload.data?.page_token) {
      break;
    }

    pageToken = payload.data.page_token;
  }

  return chats.filter((chat) => chat.chatId);
}

async function resolveChatId(botConfig, tenantAccessToken) {
  if (botConfig.chatId) {
    return botConfig.chatId;
  }

  const chats = await listChats(tenantAccessToken);
  if (botConfig.chatName) {
    const matched = chats.find((chat) => chat.name === botConfig.chatName);
    if (matched) {
      return matched.chatId;
    }
    throw new Error(`Unable to find Feishu chat named "${botConfig.chatName}"`);
  }

  if (chats.length === 1) {
    return chats[0].chatId;
  }

  throw new Error('Unable to resolve Feishu target chat automatically. Set FEISHU_*_CHAT_ID or FEISHU_*_CHAT_NAME.');
}

async function sendMessage(tenantAccessToken, chatId, content) {
  const response = await fetch(`${FEISHU_IM_API_BASE_URL}/messages?receive_id_type=chat_id`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${tenantAccessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      receive_id: chatId,
      msg_type: 'text',
      content: JSON.stringify({ text: content }),
    }),
  });

  const payload = await response.json();
  if (!response.ok || payload.code !== 0) {
    throw new Error(`Failed to send Feishu message: HTTP ${response.status} code=${String(payload.code ?? 'unknown')} msg=${payload.msg || 'unknown'}`);
  }

  return payload.data?.message_id?.trim() || '';
}

async function fetchPipelineJobSummary() {
  if (!process.env.CI_API_V4_URL || !process.env.CI_PROJECT_ID || !process.env.CI_PIPELINE_ID || !process.env.CI_JOB_TOKEN) {
    return [];
  }

  const url = `${process.env.CI_API_V4_URL}/projects/${encodeURIComponent(process.env.CI_PROJECT_ID)}/pipelines/${encodeURIComponent(process.env.CI_PIPELINE_ID)}/jobs?per_page=100`;
  const response = await fetch(url, {
    headers: {
      'JOB-TOKEN': process.env.CI_JOB_TOKEN,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    return [];
  }

  const jobs = await response.json();
  const names = new Set(['verify:installer', 'bundle:services', 'package:mac', 'package:win', 'package:linux', 'release:gitlab']);
  return (Array.isArray(jobs) ? jobs : [])
    .filter((job) => names.has(job.name))
    .map((job) => ({
      name: job.name,
      status: job.status,
      stage: job.stage,
      url: job.web_url || '',
    }));
}

function loadReleaseDownloadLinks() {
  try {
    const lines = readFileSync(RELEASE_NOTES_PATH, 'utf8').split('\n');
    return lines
      .filter((line) => /\|\s+\[Download]\(/.test(line))
      .slice(0, 8)
      .map((line) => {
        const columns = line.split('|').map((value) => value.trim()).filter(Boolean);
        const platform = columns[0] || 'Download';
        const linkMatch = line.match(/\[Download]\(([^)]+)\)/);
        return {
          platform,
          url: linkMatch?.[1] || '',
        };
      })
      .filter((entry) => entry.url);
  } catch {
    return [];
  }
}

function buildBuildSuccessMessage(metadata, jobSummary) {
  const lines = [
    'TnymaAI 版本构建成功',
    `版本: ${process.env.CI_COMMIT_TAG || packageJsonVersion()}`,
    `流水线: ${process.env.CI_PIPELINE_URL || 'unknown'}`,
  ];

  if (metadata?.TnymaAI?.version) {
    lines.push(`OpenClaw: ${metadata.TnymaAI.version}`);
  }

  if (metadata?.tnymaAi?.revision) {
    lines.push(`tnyma-ai: ${metadata.tnymaAi.revision.slice(0, 8)}`);
  }

  if (jobSummary.length > 0) {
    lines.push(`任务: ${jobSummary.map((job) => `${job.name}=${job.status}`).join(', ')}`);
  }

  return lines.join('\n');
}

function buildReleaseSuccessMessage(metadata, jobSummary) {
  const lines = [
    'TnymaAI 版本发布成功',
    `版本: ${process.env.CI_COMMIT_TAG || packageJsonVersion()}`,
    `Release 页面: ${releaseUrl() || 'unknown'}`,
    `流水线: ${process.env.CI_PIPELINE_URL || 'unknown'}`,
  ];

  if (metadata?.TnymaAI?.version) {
    lines.push(`OpenClaw: ${metadata.TnymaAI.version}`);
  }

  if (metadata?.tnymaAi?.revision) {
    lines.push(`tnyma-ai: ${metadata.tnymaAi.revision.slice(0, 8)}`);
  }

  const downloads = loadReleaseDownloadLinks();
  if (downloads.length > 0) {
    lines.push('', '下载链接:');
    for (const download of downloads.slice(0, 6)) {
      lines.push(`- ${download.platform}: ${download.url}`);
    }
  }

  const releaseJob = jobSummary.find((job) => job.name === 'release:gitlab');
  if (releaseJob) {
    lines.push('', `Release 任务: ${releaseJob.status}`);
  }

  try {
    const notes = readFileSync(RELEASE_NOTES_PATH, 'utf8')
      .split('\n')
      .filter((line) => line.startsWith('- ') || line.startsWith('### '))
      .slice(0, 8);
    if (notes.length > 0) {
      lines.push('', '摘要:');
      lines.push(...notes);
    }
  } catch {
    // Ignore missing notes
  }

  return lines.join('\n');
}

function buildReleaseFailureMessage(metadata, jobSummary) {
  const lines = [
    'TnymaAI 版本发布失败',
    `版本: ${process.env.CI_COMMIT_TAG || packageJsonVersion()}`,
    `流水线: ${process.env.CI_PIPELINE_URL || 'unknown'}`,
  ];

  if (metadata?.TnymaAI?.version) {
    lines.push(`OpenClaw: ${metadata.TnymaAI.version}`);
  }

  if (metadata?.tnymaAi?.revision) {
    lines.push(`tnyma-ai: ${metadata.tnymaAi.revision.slice(0, 8)}`);
  }

  const failingJobs = jobSummary.filter((job) => ['failed', 'canceled'].includes(job.status));
  if (failingJobs.length > 0) {
    lines.push('', '失败任务:');
    for (const job of failingJobs.slice(0, 8)) {
      const suffix = job.url ? ` ${job.url}` : '';
      lines.push(`- ${job.name}=${job.status}${suffix}`);
    }
  }

  if (releaseUrl()) {
    lines.push('', `Release 页面: ${releaseUrl()}`);
  }

  return lines.join('\n');
}

async function main() {
  const botConfig = getBotConfig();
  if (!botConfig.appId || !botConfig.appSecret) {
    console.log(`Feishu ${mode} bot credentials are not configured, skipping notification.`);
    return;
  }

  const metadata = loadJson(BUILD_METADATA_PATH);
  const jobSummary = await fetchPipelineJobSummary();
  let content = '';

  if (mode === 'build-success') {
    content = buildBuildSuccessMessage(metadata, jobSummary);
  } else if (mode === 'release-success') {
    content = buildReleaseSuccessMessage(metadata, jobSummary);
  } else if (mode === 'release-failure') {
    content = buildReleaseFailureMessage(metadata, jobSummary);
  } else {
    throw new Error(`Unsupported Feishu notification mode: ${mode}`);
  }

  const tenantAccessToken = await fetchTenantAccessToken(botConfig.appId, botConfig.appSecret);
  const chatId = await resolveChatId(botConfig, tenantAccessToken);
  const messageId = await sendMessage(tenantAccessToken, chatId, content);
  console.log(`Sent Feishu ${mode} notification: chatId=${chatId} messageId=${messageId || 'unknown'}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
