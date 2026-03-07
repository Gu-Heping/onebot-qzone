/**
 * NapCat 原生插件：QZone Bridge
 *
 * 这是一个双向代理插件：
 * - 接收来自 NapCat 下游的 OneBot v11 HTTP 请求，转发到 QZone Bridge REST API
 * - 订阅 QZone Bridge 的 WebSocket 事件流，推送给下游 WS 客户端
 *
 * NapCat 插件 API 兼容约定：
 *   plugin_init(ctx)     初始化
 *   plugin_cleanup(ctx)  清理
 *   plugin_config_ui     配置字段描述
 */

import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';

// ──────────────────────────────────────────────
// NapCat plugin context 类型（最小化声明）
// ──────────────────────────────────────────────
interface NapCatContext {
  pluginManager: { config?: Record<string, unknown> };
  logger: { log: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
  // 用于 cleanup 的存储槽
  _qzoneBridgeServer?: http.Server;
  _qzoneBridgeWs?: WebSocket;
}

// ──────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────
function jsonResponse(res: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function makeResponse(data: unknown, ok = true, retcode = 0): Record<string, unknown> {
  return { status: ok ? 'ok' : 'failed', retcode, data };
}

async function forwardToBridge(
  bridgeRest: string,
  action: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`/${action}`, bridgeRest);
  const resp = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(15000),
  });
  return resp.json();
}

// ──────────────────────────────────────────────
// plugin_init
// ──────────────────────────────────────────────
export const plugin_init = async (ctx: NapCatContext): Promise<void> => {
  const cfg = ctx.pluginManager.config ?? {};
  const bridgeRest     = String(cfg['bridgeRest']     ?? 'http://127.0.0.1:5700');
  const bridgeWsEvent  = String(cfg['bridgeWsEvent']  ?? 'ws://127.0.0.1:5700/event');
  const listenHost     = String(cfg['listenHost']     ?? '0.0.0.0');
  const listenPort     = Number(cfg['listenPort']     ?? 5800);
  const accessToken    = String(cfg['accessToken']    ?? '');
  const reconnectDelay = Number(cfg['reconnectDelay'] ?? 5) * 1000;

  // ── HTTP server ─────────────────────────────
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const action = url.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
    if (!action) { jsonResponse(res, 404, makeResponse(null, false, 1404)); return; }

    // Auth
    const token =
      (req.headers['x-access-token'] as string | undefined) ??
      (req.headers['authorization'] as string | undefined)?.replace(/^Bearer\s+/i, '') ??
      url.searchParams.get('access_token') ?? '';
    if (accessToken && token !== accessToken) {
      jsonResponse(res, 403, makeResponse(null, false, 1403));
      return;
    }

    // Read body
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const bodyStr = Buffer.concat(chunks).toString('utf8');
    let params: Record<string, unknown> = {};
    if (bodyStr) {
      try { params = JSON.parse(bodyStr) as Record<string, unknown>; }
      catch { jsonResponse(res, 400, makeResponse(null, false, 1400)); return; }
    }
    // Merge query params
    for (const [k, v] of url.searchParams) params[k] = v;

    try {
      const data = await forwardToBridge(bridgeRest, action, params);
      jsonResponse(res, 200, data);
    } catch (err) {
      jsonResponse(res, 200, makeResponse({ error: String(err) }, false, 1));
    }
  });

  // ── WebSocket server (local downstream) ─────
  const wss = new WebSocketServer({ server, path: '/event' });

  // ── Bridge event WS connection (with auto-reconnect) ──
  let bridgeWs: WebSocket | null = null;
  let stopped = false;

  function connectBridge(): void {
    if (stopped) return;
    bridgeWs = new WebSocket(bridgeWsEvent);
    bridgeWs.on('open', () => ctx.logger.log(`[qzone-plugin] 连接到 bridge 事件流: ${bridgeWsEvent}`));
    bridgeWs.on('message', (data) => {
      const msg = data.toString();
      for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) client.send(msg);
      }
    });
    bridgeWs.on('error', (err) => ctx.logger.error('[qzone-plugin] bridge ws error:', err));
    bridgeWs.on('close', () => {
      if (!stopped) setTimeout(connectBridge, reconnectDelay);
    });
  }
  connectBridge();

  server.listen(listenPort, listenHost, () => {
    ctx.logger.log(`[qzone-plugin] 代理监听 ${listenHost}:${listenPort} → bridge ${bridgeRest}`);
  });

  ctx._qzoneBridgeServer = server;
  ctx._qzoneBridgeWs = bridgeWs ?? undefined;

  // cleanup hook：把 stopped 闭包暴露出去
  (ctx as unknown as Record<string, unknown>)['_qzoneBridgeStopped'] = () => { stopped = true; };
};

// ──────────────────────────────────────────────
// plugin_cleanup
// ──────────────────────────────────────────────
export const plugin_cleanup = (ctx: NapCatContext): void => {
  const stopFn = (ctx as unknown as Record<string, unknown>)['_qzoneBridgeStopped'];
  if (typeof stopFn === 'function') stopFn();
  ctx._qzoneBridgeWs?.close();
  ctx._qzoneBridgeServer?.close();
};

// ──────────────────────────────────────────────
// plugin_config_ui
// ──────────────────────────────────────────────
export const plugin_config_ui = [
  { key: 'bridgeRest',     label: 'Bridge REST URL',             type: 'string', default: 'http://127.0.0.1:5700' },
  { key: 'bridgeWsEvent',  label: 'Bridge WS Event URL',         type: 'string', default: 'ws://127.0.0.1:5700/event' },
  { key: 'listenHost',     label: '本地监听 Host',               type: 'string', default: '0.0.0.0' },
  { key: 'listenPort',     label: '本地监听端口',                type: 'number', default: 5800 },
  { key: 'accessToken',    label: 'Access Token',                type: 'string', default: '' },
  { key: 'reconnectDelay', label: 'WS 重连间隔（秒）',           type: 'number', default: 5 },
];
