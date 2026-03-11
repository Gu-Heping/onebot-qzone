import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { BridgeConfig } from './config.js';
import type { ActionHandler } from './actions.js';
import type { EventHub } from './hub.js';
import type { OneBotEvent, OneBotResponse } from '../qzone/types.js';
import type { QzoneClient } from '../qzone/client.js';
import { log } from '../qzone/utils.js';
import { safeInt } from './utils.js';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h${m}m`;
}

// ──────────────────────────────────────────────
// Auth check
// ──────────────────────────────────────────────
function checkAuth(token: string, req: http.IncomingMessage): boolean {
  if (!token) return true;
  const auth = req.headers['authorization'] ?? '';
  if (auth === `Bearer ${token}`) return true;
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (url.searchParams.get('access_token') === token) return true;
  return false;
}

// ──────────────────────────────────────────────
// createApp
// ──────────────────────────────────────────────
export function createApp(
  config: BridgeConfig,
  handler: ActionHandler,
  hub: EventHub,
  client?: QzoneClient,
): { server: http.Server; start: () => void; stop: () => Promise<void> } {
  const server = http.createServer();

  // HTTP handler
  server.on('request', async (req, res) => {
    if (!checkAuth(config.accessToken, req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'failed', retcode: 1401, data: null }));
      return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const action = url.pathname.replace(/^\/+/, '').replace(/\/+$/, '');

    // ── 健康检查 / 状态面板 ──
    if (action === 'status' || action === 'health') {
      const now = Date.now();
      const cookieAge = client?.cookiesLastUsed
        ? Math.round((now - client.cookiesLastUsed.getTime()) / 1000)
        : null;
      const secSinceRefresh = client?.secondsSinceLastRefresh ?? Infinity;
      const hasPskey = !!(client?.cookies?.['p_skey']);
      const hasSkey = !!(client?.cookies?.['skey']);
      const status = {
        ok: !!client?.loggedIn,
        qq: client?.qqNumber ?? null,
        cookie: {
          valid: hasPskey && hasSkey,
          p_skey: hasPskey,
          skey: hasSkey,
          age_seconds: cookieAge,
          age_human: cookieAge !== null ? formatDuration(cookieAge) : 'N/A',
        },
        refresh: {
          last_refresh_seconds_ago: isFinite(secSinceRefresh) ? Math.round(secSinceRefresh) : null,
          last_refresh_human: isFinite(secSinceRefresh) ? formatDuration(Math.round(secSinceRefresh)) + ' ago' : 'never',
          next_refresh_in: isFinite(secSinceRefresh) ? formatDuration(Math.max(0, 4 * 3600 - Math.round(secSinceRefresh))) : 'ASAP',
        },
        uptime_seconds: Math.round(process.uptime()),
        time: new Date().toISOString(),
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status, null, 2));
      return;
    }

    let params: Record<string, unknown> = {};

    // Query params → params
    for (const [k, v] of url.searchParams) params[k] = v;

    // Parse body if POST
    if (req.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const bodyStr = Buffer.concat(chunks).toString('utf8');
      if (bodyStr) {
        try {
          const ct = req.headers['content-type'] ?? '';
          if (ct.includes('application/json')) {
            params = { ...params, ...(JSON.parse(bodyStr) as Record<string, unknown>) };
          } else {
            const form = new URLSearchParams(bodyStr);
            for (const [k, v] of form) params[k] = v;
          }
        } catch { /* ignore malformed body */ }
      }
    }

    let onebotResp: OneBotResponse;
    try {
      onebotResp = await handler.handle(action, params);
    } catch (err) {
      onebotResp = { status: 'failed', retcode: 1500, data: null, message: String(err) };
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(onebotResp));
  });

  // WebSocket: universal API + Event
  // Use noServer mode to avoid path-match conflicts between multiple WSS instances
  const wssByPath = new Map<string, { wss: WebSocketServer; apiRole: boolean; eventRole: boolean }>();
  const eventCallbacks: Array<(event: OneBotEvent) => void | Promise<void>> = [];

  function attachWss(path: string, apiRole: boolean, eventRole: boolean): WebSocketServer {
    const wss = new WebSocketServer({ noServer: true });
    wssByPath.set(path, { wss, apiRole, eventRole });
    const connectedClients = new Set<WebSocket>();

    if (eventRole) {
      const eventCb = async (event: OneBotEvent) => {
        const msg = JSON.stringify(event);
        for (const ws of connectedClients) {
          if (ws.readyState === WebSocket.OPEN) ws.send(msg);
        }
      };
      hub.subscribe(eventCb);
      eventCallbacks.push(eventCb);
    }

    wss.on('connection', (ws, req) => {
      if (!checkAuth(config.accessToken, req)) {
        ws.close(1008, 'Unauthorized');
        return;
      }

      // send connect meta event
      ws.send(JSON.stringify({
        post_type: 'meta_event',
        meta_event_type: 'lifecycle',
        sub_type: 'connect',
        time: Math.floor(Date.now() / 1000),
        self_id: safeInt(client?.qqNumber ?? '0'),
      }));

      connectedClients.add(ws);
      ws.on('close', () => connectedClients.delete(ws));
      ws.on('error', () => connectedClients.delete(ws));

      if (apiRole) {
        ws.on('message', async (data) => {
          let req: Record<string, unknown>;
          try { req = JSON.parse(data.toString()) as Record<string, unknown>; }
          catch { return; }
          const action = String(req['action'] ?? '');
          const params = (req['params'] as Record<string, unknown>) ?? {};
          const echo = req['echo'] !== undefined ? String(req['echo']) : undefined;
          const resp = await handler.handle(action, params, echo);
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(resp));
        });
      }
    });

    return wss;
  }

  const wssUniversal = attachWss('/', true, true);
  const wssApi      = attachWss('/api', true, false);
  const wssEvent    = attachWss('/event', false, true);
  const wssWs       = attachWss('/ws', true, true);

  server.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`).pathname;
    const entry = wssByPath.get(pathname);
    if (!entry) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    entry.wss.handleUpgrade(req, socket, head, (ws) => {
      entry.wss.emit('connection', ws, req);
    });
  });

  function start(): void {
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        log('ERROR', `端口 ${config.port} 已被占用，请关闭占用该端口的进程或修改 ONEBOT_PORT`);
        process.exit(1);
      }
      throw err;
    });
    server.listen(config.port, config.host, () => {
      log('INFO', `HTTP/WS 服务器启动: http://${config.host}:${config.port}`);
    });
  }

  async function stop(): Promise<void> {
    // 取消所有事件订阅
    for (const cb of eventCallbacks) {
      hub.unsubscribe(cb);
    }
    eventCallbacks.length = 0;
    return new Promise(resolve => {
      wssUniversal.close();
      wssApi.close();
      wssEvent.close();
      wssWs.close();
      server.close(() => resolve());
    });
  }

  return { server, start, stop };
}
