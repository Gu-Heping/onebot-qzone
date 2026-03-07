import crypto from 'node:crypto';
import https from 'node:https';
import http from 'node:http';
import { WebSocket } from 'ws';
import pLimit from 'p-limit';
import type { BridgeConfig } from './config.js';
import type { ActionHandler } from './actions.js';
import type { EventHub, EventCallback } from './hub.js';
import type { OneBotEvent } from '../qzone/types.js';
import { log } from '../qzone/utils.js';

// ──────────────────────────────────────────────
// HTTP POST dispatch
// ──────────────────────────────────────────────
function hmacSha1(secret: string, body: string): string {
  return crypto.createHmac('sha1', secret).update(body, 'utf8').digest('hex');
}

async function httpPost(url: string, body: string, token: string): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'User-Agent': 'qzone-bridge/2.0' };
  if (token) headers['X-Signature'] = 'sha1=' + hmacSha1(token, body);
  const u = new URL(url);
  const mod = u.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method: 'POST',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
        timeout: 10000,
      },
      (res) => { res.resume(); res.on('end', resolve); res.on('error', reject); },
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('HTTP POST timeout')); });
    req.write(body);
    req.end();
  });
}

// ──────────────────────────────────────────────
// NetworkManager
// ──────────────────────────────────────────────
export class NetworkManager {
  private limit = pLimit(10);
  private wsConnections: WebSocket[] = [];
  private eventCb: EventCallback | null = null;

  constructor(
    private readonly config: BridgeConfig,
    private readonly handler: ActionHandler,
    private readonly hub: EventHub,
  ) {}

  start(): void {
    if (
      this.config.httpPostUrls.length === 0 &&
      this.config.wsReverseUrls.length === 0 &&
      this.config.wsReverseApiUrls.length === 0 &&
      this.config.wsReverseEventUrls.length === 0
    ) return;

    this.eventCb = async (event: OneBotEvent) => {
      const body = JSON.stringify(event);

      // HTTP POST
      for (const url of this.config.httpPostUrls) {
        this.limit(() =>
          httpPost(url, body, this.config.accessToken).catch(e =>
            log('WARNING', `HTTP POST 推送失败 ${url}: ${e}`),
          ),
        );
      }

      // WS reverse push
      for (const ws of this.wsConnections) {
        if (ws.readyState === WebSocket.OPEN) {
          try { ws.send(body); } catch { /* ignore */ }
        }
      }
    };
    this.hub.subscribe(this.eventCb);

    // Launch reverse WS loops
    for (const url of this.config.wsReverseUrls) {
      this.wsReverseLoop(url, 'universal').catch(() => { /* handled internally */ });
    }
    for (const url of this.config.wsReverseApiUrls) {
      this.wsReverseLoop(url, 'api').catch(() => { /* handled internally */ });
    }
    for (const url of this.config.wsReverseEventUrls) {
      this.wsReverseLoop(url, 'event').catch(() => { /* handled internally */ });
    }
  }

  stop(): void {
    if (this.eventCb) { this.hub.unsubscribe(this.eventCb); this.eventCb = null; }
    for (const ws of this.wsConnections) {
      try { ws.close(1000); } catch { /* ignore */ }
    }
    this.wsConnections = [];
  }

  private async wsReverseLoop(url: string, role: 'universal' | 'api' | 'event'): Promise<void> {
    const intervalMs = this.config.wsReverseReconnectInterval * 1000;
    while (true) {
      try {
        await this.connectReverseWs(url, role);
      } catch {
        /* ignore */
      }
      log('DEBUG', `[WS反向] 断开，${this.config.wsReverseReconnectInterval}s 后重连 ${url}`);
      await new Promise(r => setTimeout(r, intervalMs));
    }
  }

  private connectReverseWs(url: string, role: 'universal' | 'api' | 'event'): Promise<void> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {
        'X-Self-ID': '0',
        'X-Client-Role': role === 'api' ? 'API' : role === 'event' ? 'Event' : 'Universal',
      };
      if (this.config.accessToken) headers['Authorization'] = `Bearer ${this.config.accessToken}`;

      const ws = new WebSocket(url, { headers });
      this.wsConnections.push(ws);

      ws.on('error', (err) => {
        this.wsConnections = this.wsConnections.filter(c => c !== ws);
        reject(err);
      });

      ws.on('close', () => {
        this.wsConnections = this.wsConnections.filter(c => c !== ws);
        resolve();
      });

      ws.on('open', () => {
        log('INFO', `[WS反向] 已连接 (${role}): ${url}`);
      });

      if (role !== 'event') {
        ws.on('message', async (data) => {
          let req: Record<string, unknown>;
          try { req = JSON.parse(data.toString()) as Record<string, unknown>; }
          catch { return; }
          const action = String(req['action'] ?? '');
          const params = (req['params'] as Record<string, unknown>) ?? {};
          const echo = req['echo'] !== undefined ? String(req['echo']) : undefined;
          const resp = await this.handler.handle(action, params, echo);
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(resp));
        });
      }
    });
  }
}
