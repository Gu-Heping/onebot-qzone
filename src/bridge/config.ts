import 'dotenv/config';
import { QzoneClient } from '../qzone/client.js';

export interface BridgeConfig {
  // Server
  host: string;
  port: number;
  accessToken: string;

  // HTTP POST push
  httpPostUrls: string[];

  // Reverse WS
  wsReverseUrls: string[];        // universal (api+event)
  wsReverseApiUrls: string[];
  wsReverseEventUrls: string[];
  wsReverseReconnectInterval: number;  // seconds

  // Polling intervals (seconds)
  pollInterval: number;
  commentPollInterval: number;
  likePollInterval: number;
  friendFeedPollInterval: number;

  // Feature flags
  enableQr: boolean;
  emitMessageEvents: boolean;
  emitCommentEvents: boolean;
  emitLikeEvents: boolean;
  emitFriendFeedEvents: boolean;
  eventDebug: boolean;
  eventPollSource: 'pc' | 'mobile' | 'auto';
  /** 推送事件中是否附带图片 base64（默认 true，bot 无需再请求） */
  attachImageDataInEvents: boolean;

  // Paths
  cachePath: string;
}

function parseUrls(raw: string): string[] {
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

export function fromEnv(): BridgeConfig {
  const e = process.env;
  return {
    host:                     e['ONEBOT_HOST'] ?? '0.0.0.0',
    port:                     parseInt(e['ONEBOT_PORT'] ?? '8080', 10),
    accessToken:              e['ONEBOT_ACCESS_TOKEN'] ?? '',
    httpPostUrls:             parseUrls(e['ONEBOT_HTTP_POST_URLS'] ?? ''),
    wsReverseUrls:            parseUrls(e['ONEBOT_WS_REVERSE_URLS'] ?? ''),
    wsReverseApiUrls:         parseUrls(e['ONEBOT_WS_REVERSE_API_URLS'] ?? ''),
    wsReverseEventUrls:       parseUrls(e['ONEBOT_WS_REVERSE_EVENT_URLS'] ?? ''),
    wsReverseReconnectInterval: parseInt(e['ONEBOT_WS_REVERSE_RECONNECT_INTERVAL'] ?? '5', 10),
    pollInterval:             parseInt(e['ONEBOT_POLL_INTERVAL'] ?? '60', 10), // 新说说最多延迟此秒数被监听到，可设为 30 加快
    commentPollInterval:      parseInt(e['ONEBOT_COMMENT_POLL_INTERVAL'] ?? '120', 10),
    likePollInterval:         parseInt(e['ONEBOT_LIKE_POLL_INTERVAL'] ?? '180', 10),
    friendFeedPollInterval:   parseInt(e['ONEBOT_FRIEND_FEED_POLL_INTERVAL'] ?? '120', 10),
    enableQr:                 ['1', 'true', 'yes'].includes((e['QZONE_ENABLE_QR'] ?? '0').toString().trim().toLowerCase()),
    emitMessageEvents:        !['0', 'false', 'no'].includes((e['ONEBOT_EMIT_MESSAGE_EVENTS'] ?? '1').toLowerCase()),
    emitCommentEvents:        !['0', 'false', 'no'].includes((e['ONEBOT_EMIT_COMMENT_EVENTS'] ?? '1').toLowerCase()),
    emitLikeEvents:           !['0', 'false', 'no'].includes((e['ONEBOT_EMIT_LIKE_EVENTS'] ?? '1').toLowerCase()),
    emitFriendFeedEvents:     !['0', 'false', 'no'].includes((e['ONEBOT_EMIT_FRIEND_FEED_EVENTS'] ?? '0').toLowerCase()),
    eventDebug:               ['1', 'true', 'yes'].includes((e['ONEBOT_EVENT_DEBUG'] ?? '0').toLowerCase()),
    eventPollSource:          (['pc', 'mobile', 'auto'].includes(e['ONEBOT_EVENT_POLL_SOURCE'] ?? '')
                                ? e['ONEBOT_EVENT_POLL_SOURCE'] as 'pc' | 'mobile' | 'auto'
                                : 'auto'),
    attachImageDataInEvents:  !['0', 'false', 'no'].includes((e['ONEBOT_ATTACH_IMAGE_DATA'] ?? '1').toLowerCase()),
    cachePath:                e['QZONE_CACHE_PATH'] ?? './test_cache',
  };
}

export function buildClient(cfg: BridgeConfig): QzoneClient {
  return new QzoneClient({ cachePath: cfg.cachePath });
}
