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
```

### Testing
```bash
npm test                 # Run unit tests only (127 tests across 11 suites)
npm run test:api         # Unit tests + API integration tests (requires running bridge)
npm run test:api:readonly # Unit + read-only API tests (safer, no data creation)
npm run verify           # Endpoint health check (read + write probes)
npm run verify:readonly  # Endpoint health check (read-only)
```

### Running a Single Test File
Tests use a custom runner (`test/run-all.ts`). To run a single test suite:
```bash
npx tsx test/unit/utils.test.ts
```

## Architecture

### Core Layer (`src/qzone/`)
The QZone API client with multi-level fallback strategies for reliability:

- **`client.ts`** - `QzoneClient` class containing all QZone API methods. Key features:
  - Multi-level fallback for rate-limited APIs (e.g., `getEmotionList` falls back from `emotion_cgi_msglist_v6` to `feeds3_html_more`)
  - Three-tier comment fetching: feeds3 inline → emotionList inline → `getCommentsLite` POST
  - Four-tier like fetching: PC detail → Mobile detail → feeds3 HTML → count-only
  - LRU caching for feeds3 data and post metadata
  - Circuit breaker protection (2 failures → 30min cooldown)

- **`requestLayer.ts`** - Unified HTTP request layer handling:
  - JSONP automatic unpacking
  - Anti-crawling detection (9 patterns)
  - Auth failure codes: `{-3, -100, -3000, -10001, -10006}`
  - Rate limit codes: `{-10000, -2}`

- **`feeds3Parser.ts`** - HTML parser for feeds3 responses extracting:
  - Post content, images, videos (MP4/cover/duration)
  - Comments (with nested replies)
  - Likes (with user details, timestamps, custom icons)
  - Device info, @mentions

- **`schemas.ts`** + **`validate.ts`** - Zod runtime validation with 10 schema sets
- **`rawLogger.ts`** - Automatic raw response logging on validation failures

### Bridge Layer (`src/bridge/`)
OneBot v11 protocol implementation:

- **`server.ts`** - HTTP API + WebSocket server (Express-like)
- **`actions.ts`** - OneBot action handlers mapping to QZone client methods
- **`poller.ts`** - Event polling with independent timers for posts/comments/likes
- **`hub.ts`** - EventHub for pub/sub event distribution
- **`network.ts`** - HTTP POST event pushing + reverse WebSocket connections
- **`config.ts`** - Environment-based configuration

### NapCat Plugin (`napcat-plugin/`)
Native NapCat plugin proxying the bridge's REST API and event stream. Built separately with its own tsconfig extending the root.

## Key Design Patterns

### Fallback Strategy
When APIs fail or are rate-limited, the client cascades through alternatives:
1. Primary API (e.g., `emotion_cgi_msglist_v6`)
2. Secondary API (e.g., `feeds3_html_more`)
3. Mobile endpoints
4. Count-only events (when details unavailable)

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
ONEBOT_PORT=5700

# Polling intervals (seconds)
ONEBOT_POLL_INTERVAL=30              # Post polling
ONEBOT_COMMENT_POLL_INTERVAL=30      # Comment polling
ONEBOT_LIKE_POLL_INTERVAL=60         # Like polling

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
│   ├── feeds3Parser.ts        # HTML parsing for feeds3
│   ├── schemas.ts             # Zod validation schemas
│   ├── validate.ts            # Validation entry points
│   └── ...
└── bridge/
    ├── server.ts              # HTTP/WS server
    ├── actions.ts             # OneBot actions
    ├── poller.ts              # Event polling
    └── ...

test/
├── run-all.ts                 # Test runner
├── unit/                      # 11 test suites (127 tests)
└── api-interfaces.ts          # API integration tests

napcat-plugin/
├── src/index.ts               # NapCat plugin entry
└── package.json               # Separate build config
```
