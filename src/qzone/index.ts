/* ─────────────────────────────────────────────
   qzone 模块 barrel re-export
   ───────────────────────────────────────────── */

// Core client
export { QzoneClient } from './client.js';

// Types
export type { ApiResponse, NormalizedItem, UploadImageResult, Routes } from './types.js';

// Infra
export { QzoneError, NetworkError, AuthError, SessionExpiredError, RateLimitError, AntiCrawlError, ApiBusinessError, ParseError, isQzoneError, isRetryable } from './infra/errors.js';
export { withRetry } from './infra/retry.js';

// Config
export { CACHE_TTL, HTTP_DEFAULTS, ANTI_CRAWL_PATTERNS, AUTH_FAILURE_CODES, RATE_LIMIT_CODES, USER_AGENTS, QZONE_DOMAINS, API_PATHS, LIMITS } from './config/constants.js';
export { env } from './config/env.js';

// Parsing / Helpers
export { parseFeeds3Items, extractFriendsFromFeeds3FromText, extractExternparam } from './feeds3Parser.js';
export { launchPlaywright } from './playwrightHelper.js';
export type { PlaywrightHandle } from './playwrightHelper.js';

// Utilities
export { calcGtk, parseJsonp, safeDecodeJsonResponse, log, htmlUnescape } from './utils.js';
