/* ─────────────────────────────────────────────
   qzone 模块 barrel re-export
   ───────────────────────────────────────────── */

// Core client
export { QzoneClient } from './client.js';

// Types
export type {
  ApiResponse,
  NormalizedItem,
  UploadImageResult,
  Routes,
  QzoneEmotion,
  QzoneComment,
  QzoneLike,
  PictureMeta,
  DeviceInfo,
  VideoMeta,
  Mention,
  ReplyComment,
  EnhancedComment,
  MusicShareMeta,
  PostMeta,
} from './types.js';

// Infra
export { QzoneError, NetworkError, AuthError, SessionExpiredError, RateLimitError, AntiCrawlError, ApiBusinessError, ParseError, isQzoneError, isRetryable } from './infra/errors.js';
export { withRetry } from './infra/retry.js';

// Config
export { CACHE_TTL, HTTP_DEFAULTS, ANTI_CRAWL_PATTERNS, AUTH_FAILURE_CODES, RATE_LIMIT_CODES, USER_AGENTS, QZONE_DOMAINS, API_PATHS, LIMITS } from './config/constants.js';
export { env } from './config/env.js';

// Parsing / Helpers
export {
  parseFeeds3Items,
  parseFeeds3Comments,
  parseFeeds3Likes,
  extractFriendsFromFeeds3FromText,
  extractExternparam,
  parseMentions,
  extractVideos,
  parseReplyComments,
  parseEnhancedComment,
  extractDeviceInfo,
} from './feeds3Parser.js';
export type {
  Feeds3Like,
  Mention,
  VideoInfo,
  ReplyComment,
  EnhancedComment,
  DeviceInfo,
  Feeds3Comment,
} from './feeds3Parser.js';
export { launchPlaywright } from './playwrightHelper.js';
export type { PlaywrightHandle } from './playwrightHelper.js';

// Utilities
export { calcGtk, parseJsonp, safeDecodeJsonResponse, log, htmlUnescape } from './utils.js';
