# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

QZone Bridge is a QQ Zone (QZone) to OneBot v11 protocol bridge service. It reverse-engineers QZone Web APIs to expose QZone functionality (posts, comments, likes) as standard OneBot v11 interfaces, with a NapCat native plugin for zero-config integration.

## Common Commands

### Development
```bash
npm run dev              # Run in development mode (tsx src/main.ts)
npm run build            # Build main project to dist/
npm run build:plugin     # Build NapCat plugin to napcat-plugin/dist/
npm run typecheck        # TypeScript type check only (tsc --noEmit)
npm run typecheck:plugin # NapCat plugin type check
```

### Instant Like / WIP Scripts
```bash
npm run like:instant -- --dry-run --once  # Preview candidates only (recommended first)
npm run like:instant                      # Continuous loop; performs real likes
npm run like:browser                      # Experimental manual Playwright like script
npm run login:qr                          # QR re-login (no-op if already logged in)
```

### Testing
```bash
npm test                 # Run all unit tests (auto-discovers test/unit/*.test.ts)
npm run test:api         # Unit tests + API integration tests (requires running bridge)
npm run test:api:readonly # Unit + read-only API tests (safer, no data creation)
npm run verify           # Endpoint health check (9 reads + 2 write probes)
npm run verify:readonly  # Endpoint health check (read-only)
```

### Running a Subset of Tests
Tests use a custom runner (`test/run-all.ts`) that auto-discovers `test/unit/*.test.ts`.
Run suites whose filename contains a substring:
```bash
npm test -- --suite feeds3
```
The runner prints actual suite/case counts; use that output as the source of truth.

## Architecture

### Core Layer (`src/qzone/`)
The QZone API client with multi-level fallback strategies for reliability:

- **`client.ts`** - `QzoneClient` class containing all QZone API methods. Key features:
  - **`getEmotionList` uses only `feeds3_html_more` + HTML parse** (PC `emotion_cgi_msglist_v6` is still rate-limited in the wild, e.g. `code=-10000`; see `doc/api-probe-results.md`).
  - **Comments**: `getCommentsBestEffort` serves from **feeds3-parsed comment buckets** (not mobile/PC comment JSON APIs in normal flow).
  - **Likes list**: `getLikeListBestEffort` is **feeds3-only** (PC `get_like_list` often empty/500 in probes).
  - **Detail**: `getShuoshuoDetail` tries PC taotao POST/GET (often 500/empty), mobile detail (often 404), then **match from emotion list** (feeds3-sourced).
  - LRU caching for feeds3 data and post metadata
  - Circuit breaker protection (2 failures → 30min cooldown)

- **`requestLayer.ts`** - Unified HTTP request layer handling:
  - JSONP automatic unpacking
  - Anti-crawling detection (9 patterns)
  - Auth failure codes: `{-3, -100, -3000, -10001, -10006}`
  - Rate limit codes: `{-10000, -2}`

- **feeds3 解析** - 实现位于 `src/qzone/feeds3/`，由 barrel 文件 `feeds3Parser.ts` 统一导出。子模块：`preprocess.ts`、`content.ts`、`feedDataCanonical.ts`（tid 归一）、`items.ts`（parseFeeds3Items）、`comments.ts`（parseFeeds3Comments / Scoped）、`likes.ts`、`meta.ts`（parseFeeds3PostMeta / Scoped）、`helpers.ts`。对外仍从 `feeds3Parser.js` 引用。

- **`schemas.ts`** + **`validate.ts`** - Zod runtime validation with 10 schema sets
- **`rawLogger.ts`** - Automatic raw response logging on validation failures

### Bridge Layer (`src/bridge/`)
OneBot v11 protocol implementation:

- **`server.ts`** - HTTP API + WebSocket server (Express-like); POST bodies capped by `ONEBOT_MAX_REQUEST_BODY_BYTES` (default 64 MiB)
- **`actions.ts`** - OneBot action handlers mapping to QZone client methods
- **`poller.ts`** - Event polling with independent timers for posts/comments/likes/friend feeds
- **`firstRunBaseline.ts`** - First-run silent baseline state (`baseline_state.json`): records existing posts/comments/likes without emitting history events
- **`hub.ts`** - EventHub for pub/sub event distribution
- **`network.ts`** - HTTP POST event pushing + reverse WebSocket connections (stop-aware reconnect loops)
- **`config.ts`** - Environment-based configuration with numeric fallback validation
- **`instant-like-*.ts`** - Instant-like pipeline (candidates, state, feed sources, feed cache)

### NapCat Plugin (`napcat-plugin/`)
Native NapCat plugin proxying the bridge's REST API and event stream. Built separately with its own tsconfig extending the root.

## Key Design Patterns

### Fallback Strategy
Feeds and social data are biased toward **`feeds3_html_more`** because many documented PC/mobile JSON endpoints return **`-10000`, HTTP 500 empty body, or 404** in practice (see `doc/api-probe-results.md`, `npm run probe:doc`). Detail APIs are attempted but often fail; list-based and count-only paths remain as safety nets.

### Request Fingerprint Randomization
- User-Agent rotation from `USER_AGENTS` pool
- Accept-Language randomization
- Jitter on poll intervals (±20%)

### Cookie Management
Priority: cached `cookies.json` → env `QZONE_COOKIE_STRING` → QR code login
- Cookies saved to `QZONE_CACHE_PATH/cookies.json`
- Silent refresh every 4 hours via Playwright (headless)
- Automatic `.env` sync after cookie refresh

## Environment Configuration

Key variables (see `.env.example` for all):
```bash
# Login (one of)
QZONE_COOKIE_STRING=uin=o123456; p_uin=o123456; skey=xxx; p_skey=yyy
QZONE_ENABLE_QR=1                    # Fallback to QR code login

# Server
ONEBOT_HOST=0.0.0.0
ONEBOT_PORT=5700                     # Built-in default is 8080 when unset

# Polling intervals (seconds; code defaults shown)
ONEBOT_POLL_INTERVAL=60              # Post polling
ONEBOT_COMMENT_POLL_INTERVAL=120     # Comment polling
ONEBOT_LIKE_POLL_INTERVAL=180        # Like polling

# First-run baseline (default 1: silently record existing events; 0 = replay)
ONEBOT_BASELINE_ON_FIRST_RUN=1

# Playwright (for QR login)
QZONE_PLAYWRIGHT_HEADLESS=           # auto-detect from $DISPLAY
QZONE_PLAYWRIGHT_EXECUTABLE=         # custom Chrome path
```

## Debugging

### Raw Response Logging
Set `QZONE_DEBUG_DUMP=1` to write raw API responses to `QZONE_CACHE_PATH/debug/` for analysis.

### Test Endpoints
The bridge provides a status endpoint when running:
```bash
curl http://127.0.0.1:5700/status
```

### Common Issues
- **1401 errors**: Cookie expired, re-login required
- **-10000 errors**: Rate limited, fallback APIs will be used automatically
- **Empty comments**: Ensure `user_id` is the post author, not the bot

## File Organization

```
src/
├── main.ts                    # Entry point: login flow, component wiring
├── qzone/
│   ├── client.ts              # QzoneClient (all API methods)
│   ├── requestLayer.ts        # Unified request handling
│   ├── feeds3Parser.ts        # Barrel: feeds3 解析聚合导出
│   ├── feeds3/                # feeds3 子模块
│   │   ├── preprocess.ts      # HTML 预处理
│   │   ├── content.ts        # 正文/表情/标签清理
│   │   ├── items.ts          # 说说列表 parseFeeds3Items
│   │   ├── comments.ts       # 评论 parseFeeds3Comments
│   │   ├── likes.ts          # 点赞 parseFeeds3Likes
│   │   ├── meta.ts           # 说说元数据 parseFeeds3PostMeta
│   │   ├── feedDataCanonical.ts # tid 归一
│   │   ├── tidParams.ts      # 点赞/评论参数推导
│   │   └── helpers.ts        # Mention/Video/Reply/Device/好友/翻页
│   ├── config/                # env.ts (QZONE_*), constants.ts
│   ├── infra/                 # errors.ts, retry.ts
│   ├── schemas.ts             # Zod validation schemas
│   ├── validate.ts            # Validation entry points
│   └── ...
└── bridge/
    ├── server.ts              # HTTP/WS server
    ├── actions.ts             # OneBot actions
    ├── poller.ts              # Event polling
    ├── firstRunBaseline.ts    # Silent first-run baseline
    ├── commentDedup.ts        # Comment dedup keys
    ├── stablePostKey.ts       # Stable post keys
    ├── instant-like-*.ts      # Instant-like pipeline
    └── ...

test/
├── run-all.ts                 # Test runner (auto-discovers test/unit/*.test.ts)
├── unit/                      # Unit suites; counts printed by runner
└── api-interfaces.ts          # API integration tests

napcat-plugin/
├── src/index.ts               # NapCat plugin entry
└── package.json               # Separate build config
```
