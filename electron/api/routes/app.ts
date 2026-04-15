import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { parseJsonBody } from '../route-utils';
import { setCorsHeaders, sendJson, sendNoContent } from '../route-utils';
import { runOpenClawDoctor, runOpenClawDoctorFix } from '../../utils/openclaw-doctor';
import { getSetting } from '../../utils/store';
import { PORTS } from '../../utils/config';

async function ensureGatewayRunning(ctx: HostApiContext) {
  const status = ctx.gatewayManager.getStatus().state;
  if (status === 'error') {
    await ctx.gatewayManager.restart();
    return;
  }
  if (status === 'stopped') {
    await ctx.gatewayManager.start();
  }
}

export async function handleAppRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/events' && req.method === 'GET') {
    setCorsHeaders(res);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    ctx.eventBus.addSseClient(res);
    // Send a current-state snapshot immediately so renderer subscribers do not
    // miss lifecycle transitions that happened before the SSE connection opened.
    res.write(`event: gateway:status\ndata: ${JSON.stringify(ctx.gatewayManager.getStatus())}\n\n`);
    return true;
  }

  if (url.pathname === '/api/app/openclaw-doctor' && req.method === 'POST') {
    const body = await parseJsonBody<{ mode?: 'diagnose' | 'fix' }>(req);
    const mode = body.mode === 'fix' ? 'fix' : 'diagnose';
    sendJson(res, 200, mode === 'fix' ? await runOpenClawDoctorFix() : await runOpenClawDoctor());
    return true;
  }

  if (url.pathname === '/api/app/control-ui' && req.method === 'GET') {
    await ensureGatewayRunning(ctx);
    const language = await getSetting('language');
    const controlUiUrl = await ctx.installerWebStackManager.ensureRunning(language);
    sendJson(res, 200, {
      success: true,
      url: controlUiUrl,
      webPort: PORTS.TNYMA_AI_WEB,
      liveGatewayPort: PORTS.TNYMA_AI_LIVE_GATEWAY,
    });
    return true;
  }

  if (req.method === 'OPTIONS') {
    sendNoContent(res);
    return true;
  }

  return false;
}
