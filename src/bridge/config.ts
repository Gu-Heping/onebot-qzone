import 'dotenv/config';
import { QzoneClient } from '../qzone/client.js';

export interface BridgeConfig {
  host: string;
  port: number;
  accessToken: string;
  httpPostUrls: string[];
  wsReverseUrls: string[];
  wsReverseApiUrls: string[];
  wsReverseEventUrls: string[];
  wsReverseReconnectInterval: number;
  pollInterval: number;
  commentPollInterval: number;
  likePollInterval: number;
  friendFeedPollInterval: number;
  maxRequestBodyBytes: number;
  baselineOnFirstRun: boolean;
  enableQr: boolean;
  emitMessageEvents: boolean;
  emitCommentEvents: boolean;
  emitLikeEvents: boolean;
  emitFriendFeedEvents: boolean;
  emitHeartbeatEvents: boolean;
  eventDebug: boolean;
  eventPollSource: 'pc' | 'mobile' | 'auto';
  attachImageDataInEvents: boolean;
  cachePath: string;
  proxyUrl?: string;
  proxyPool?: string[];
  imageProxyUrl?: string;
}

function parseUrls(raw: string): string[] {
  return raw
    .split(/[,\r\n]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

function intEnv(name: string, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const raw = (process.env[name] ?? '').trim();
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < min || value > max) return fallback;
  return value;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = (process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return fallback;
}

export function fromEnv(): BridgeConfig {
  const e = process.env;
  return {
    host: e['ONEBOT_HOST'] ?? '0.0.0.0',
    port: intEnv('ONEBOT_PORT', 8080, 1, 65535),
    accessToken: e['ONEBOT_ACCESS_TOKEN'] ?? '',
    httpPostUrls: parseUrls(e['ONEBOT_HTTP_POST_URLS'] ?? ''),
    wsReverseUrls: parseUrls(e['ONEBOT_WS_REVERSE_URLS'] ?? ''),
    wsReverseApiUrls: parseUrls(e['ONEBOT_WS_REVERSE_API_URLS'] ?? ''),
    wsReverseEventUrls: parseUrls(e['ONEBOT_WS_REVERSE_EVENT_URLS'] ?? ''),
    wsReverseReconnectInterval: intEnv('ONEBOT_WS_REVERSE_RECONNECT_INTERVAL', 5, 1),
    pollInterval: intEnv('ONEBOT_POLL_INTERVAL', 60, 1),
    commentPollInterval: intEnv('ONEBOT_COMMENT_POLL_INTERVAL', 120, 1),
    likePollInterval: intEnv('ONEBOT_LIKE_POLL_INTERVAL', 180, 1),
    friendFeedPollInterval: intEnv('ONEBOT_FRIEND_FEED_POLL_INTERVAL', 120, 1),
    maxRequestBodyBytes: intEnv('ONEBOT_MAX_REQUEST_BODY_BYTES', 64 * 1024 * 1024, 1024),
    baselineOnFirstRun: boolEnv('ONEBOT_BASELINE_ON_FIRST_RUN', true),
    enableQr: boolEnv('QZONE_ENABLE_QR', false),
    emitMessageEvents: boolEnv('ONEBOT_EMIT_MESSAGE_EVENTS', true),
    emitCommentEvents: boolEnv('ONEBOT_EMIT_COMMENT_EVENTS', true),
    emitLikeEvents: boolEnv('ONEBOT_EMIT_LIKE_EVENTS', true),
    emitFriendFeedEvents: boolEnv('ONEBOT_EMIT_FRIEND_FEED_EVENTS', false),
    emitHeartbeatEvents: boolEnv('ONEBOT_EMIT_HEARTBEAT_EVENTS', true),
    eventDebug: boolEnv('ONEBOT_EVENT_DEBUG', false),
    eventPollSource: (['pc', 'mobile', 'auto'].includes(e['ONEBOT_EVENT_POLL_SOURCE'] ?? '')
      ? e['ONEBOT_EVENT_POLL_SOURCE'] as 'pc' | 'mobile' | 'auto'
      : 'auto'),
    attachImageDataInEvents: boolEnv('ONEBOT_ATTACH_IMAGE_DATA', true),
    cachePath: e['QZONE_CACHE_PATH'] ?? './test_cache',
    proxyUrl: e['QZONE_PROXY_URL'] ?? undefined,
    proxyPool: parseUrls(e['QZONE_PROXY_POOL'] ?? ''),
    imageProxyUrl: e['QZONE_IMAGE_PROXY'] ?? undefined,
  };
}

export function buildClient(cfg: BridgeConfig): QzoneClient {
  return new QzoneClient({
    cachePath: cfg.cachePath,
    proxyUrl: cfg.proxyUrl,
    proxyPool: cfg.proxyPool,
    imageProxyUrl: cfg.imageProxyUrl,
  });
}
