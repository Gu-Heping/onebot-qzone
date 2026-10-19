# Instant Like（秒赞）流水线

`scripts/instant-like.ts` 是一个**独立的点赞循环**：拉取好友动态 → 过滤/打分 → 按策略点赞 → 在浏览器里复核结果。它不依赖 HTTP 服务的轮询器，通常配合主 bridge 一起常驻。

> ⚠️ **会真实点赞**。首次运行请先用 `--dry-run` 看候选与策略，再小批量（如 `--once --max-likes-per-round=1`）试跑。点赞是外部可见操作，无法批量撤回。

---

## 1. 运行

```bash
# 单轮：拉一次动态、最多点 maxLikesPerRound 个，然后退出
npm run like:instant -- --once

# 只看候选与首选策略，不发起点赞请求
npm run like:instant -- --dry-run --once

# 连续循环（默认间隔 5000 ms）
npm run like:instant
```

前置条件：

- `.env` 或环境变量中有有效 Cookie（`QZONE_COOKIE_STRING` / `QZONE_COOKIE`）。
- 需要 Playwright 时，本机可启动 Chrome（`QZONE_PLAYWRIGHT_CHANNEL` 默认 `chrome`；无显示环境会退回 headless）。设置 `QZONE_INSTANT_LIKE_PLAYWRIGHT=0` 可完全禁用浏览器抓取与页面内点赞，仅走 feeds3 与 HTTP 点赞。
- 首次使用建议 `npm run login:qr` 刷新 Cookie。

退出时会调用 `client.closeTransientSessions()` 关闭浏览器/连接。`Ctrl+C` 可中断；状态在每次成功点赞后已落盘。

---

## 2. 参数

CLI 同时支持 `--kebab-case` 与 `--camelCase` 两种写法；布尔开关支持 `--xxx` / `--no-xxx`。

| 参数 | 环境变量 | 默认值 | 说明 |
|------|----------|--------|------|
| `--once` | — | 关 | 只跑一轮 |
| `--dry-run` / `--no-dry-run` | `QZONE_INSTANT_LIKE_DRY_RUN` | 关 | 只打印候选，不点赞 |
| `--fast` / `--no-fast` | `QZONE_INSTANT_LIKE_FAST` | 开 | feeds3 快速模式（少翻页/少请求） |
| `--include-self` | `QZONE_INSTANT_LIKE_INCLUDE_SELF` | 关 | 允许给自己的说说点赞 |
| `--max-posts` | `QZONE_INSTANT_LIKE_MAX_POSTS` | `20` | 动态池目标规模（同时影响拉取页大小） |
| `--max-likes-per-round` | `QZONE_INSTANT_LIKE_MAX_LIKES_PER_ROUND` | `3` | 每轮最多成功点赞数 |
| `--interval-ms` | `QZONE_INSTANT_LIKE_INTERVAL_MS` | `5000` | 循环间隔（毫秒） |
| `--max-age-sec` | `QZONE_INSTANT_LIKE_MAX_AGE_SEC` | `300` | 只处理该时长内的新帖；`0`=不限 |
| `--like-delay-ms` | `QZONE_INSTANT_LIKE_DELAY_MS` | `600` | 两次点赞之间的间隔 |
| `--verify-attempts` | `QZONE_INSTANT_LIKE_VERIFY_ATTEMPTS` | `2` | 每次点赞后的复核轮数 |
| `--refetch-rounds` | `QZONE_INSTANT_LIKE_REFETCH_ROUNDS` | `2` | 非 311 分享帖点赞前重新拉取匹配帖的轮数 |
| `--feed-fetch-passes` | `QZONE_INSTANT_LIKE_FEED_FETCH_PASSES` | `2` | 动态池抓取轮数（快/慢模式交替） |
| `--feed-fetch-pages` | `QZONE_INSTANT_LIKE_FEED_FETCH_PAGES` | `2` | feeds3 每轮翻页数 |
| `--feed-cache-max-age-sec` | `QZONE_INSTANT_LIKE_FEED_CACHE_MAX_AGE_SEC` | `300` | 实时抓取为空时允许使用的缓存时长；`0`=禁用缓存回退 |
| `--failure-cooldown-sec` | `QZONE_INSTANT_LIKE_FAILURE_COOLDOWN_SEC` | `900` | 失败候选冷却时长 |
| `--failure-threshold` | `QZONE_INSTANT_LIKE_FAILURE_THRESHOLD` | `2` | 连续失败多少次进入冷却 |
| `--preview-count` | `QZONE_INSTANT_LIKE_PREVIEW_COUNT` | `5` | 每轮日志展示的候选数 |
| `--feed-source` | `QZONE_INSTANT_LIKE_SOURCE` | `playwright_first` | 动态来源策略，见下 |
| `--state-path` | `QZONE_INSTANT_LIKE_STATE_PATH` | `{cachePath}/instant-like-state.json` | 已处理/已点赞/策略历史 |
| `--failure-dump-path` | `QZONE_INSTANT_LIKE_FAILURE_DUMP_PATH` | `{cachePath}/instant-like-failures.jsonl` | 失败明细（含每次尝试与响应） |
| `--feed-cache-path` | `QZONE_INSTANT_LIKE_FEED_CACHE_PATH` | `{cachePath}/instant-like-feed-cache.json` | 动态池缓存 |

`{cachePath}` 即 `QZONE_CACHE_PATH`（默认 `./test_cache`）。

---

## 3. 动态来源（feed source）

`collectFeedPool`（`src/bridge/instant-like-feed-sources.ts`）支持四种策略：

| 策略 | 行为 |
|------|------|
| `playwright_first`（默认） | 先开浏览器抓好友动态（拦截 feeds3 网络响应，失败时用 DOM 解析兜底）；无结果再走 feeds3 API |
| `feeds3_first` | 先走 feeds3 API；结果不足再开浏览器 |
| `playwright_only` | 只用浏览器抓取 |
| `feeds3_only` | 只用 feeds3 API |

feeds3 抓取会按 `feed-fetch-passes` 做快/慢模式交替，并按 `feed-fetch-pages` 翻页；结果按 `uin:tid` 与别名键去重合并，保留字段更丰富的候选。实时池为空且缓存未过期时，使用动态池缓存。

---

## 4. 候选过滤与打分

过滤顺序（日志会输出各项计数）：

1. 缺少 `uin` / `tid`
2. 自己的说说（`--include-self` 可放开）
3. 已点赞（`isLiked`）
4. 已在状态文件中处理过（主键或别名）
5. 处于失败冷却期
6. 超过 `max-age-sec`

打分（0–100+，日志里的 `confidence`：≥90 high，≥60 medium，其余 low）：

- `appid=311` 普通说说 +35
- 有合法 `likeUnikey/likeCurkey` +30
- 音乐分享 `appid=202` 且有 `musicShare.playUrl` +35；其他分享有 playUrl +20
- `sourceFkey === tid` / 有 `topicId` / `typeid ∈ {0,2}` 各 +5
- 非 311 且既无 override 又无 playUrl −25
- 叠加历史成功率/失败率修正（`strategyHistory`）

非 311 的分享帖在点赞前会重新拉取匹配帖（最多 `refetch-rounds` 轮），选择字段更完整的版本。

---

## 5. 点赞策略与复核

按候选类型生成尝试序列，并用历史成功率排序（成功的策略优先）：

- `playwrightContext`：动态来自浏览器时，先在页面内真实点击
- `likeEmotion(overrides)`：HTML 提供了合法的 `likeUnikey/likeCurkey`
- `likeEmotion(musicShare.playUrl+numericCurkey)` / `+selfCurkey`
- `likeEmotion(share.playUrl+numericCurkey)`
- `likeEmotion(appFallback)`：`http://user.qzone.qq.com/{uin}/app/{tid}`
- `likeEmotion(default)`：普通 `mood/{tid}` unikey
- `likeMobileFeed`：最后兜底

每个策略返回成功后**仍需复核**（`verifyLikeApplied`，最多 `verify-attempts` 轮，每轮间隔 700 ms）：

1. Playwright 页面内确认 `isLiked`
2. 浏览器动态快照中确认
3. feeds3 好友动态中确认
4. `getLikeListBestEffort` 中出现自己的 uin

复核失败视为该策略失败，继续下一个策略；全部失败则写入失败记录并进入冷却（连续达到 `failure-threshold` 次后冷却 `failure-cooldown-sec`）。

成功后会：

- 记录 `liked[uin:tid]` 与别名
- 记录策略成败历史（供下一轮排序）
- 立即保存状态文件
- 打印 `liked ... via=<strategy>`

---

## 6. 状态与日志

每轮日志示例：

```
[instant-like] login ok qq=... fast=true once=true dryRun=false
[instant-like] feed traces playwright_feed:playwright:p1:20 ...
[instant-like] top candidates:
  - 昵称 tid=... appid=311 score=95 confidence=high source=mood-default first=likeEmotion(default)
[instant-like] candidate ... 
[instant-like] liked ... via=playwrightContext
[instant-like] filtered missingIdentity=0 self=1 alreadyLiked=2 alreadySeen=5 cooldown=0 tooOld=3 eligible=4
[instant-like] scanned=1 eligible=1
[instant-like] round done liked=1
```

- 状态文件：`instant-like-state.json`，包含 `liked`、`likedAliases`、`seen`、`strategyHistory`、失败计数；旧的过期条目会在每轮 `compactInstantLikeState` 中清理。
- 失败文件：`instant-like-failures.jsonl`，每行一个候选，含每次策略尝试的响应/异常，便于定位 appid/typeid 兼容问题。
- 动态缓存：`instant-like-feed-cache.json`，实时抓取失败时按 TTL 回退。

---

## 7. 相关测试

单测（`npm test` 自动发现）：

- `test/unit/instant-like-state.test.ts`：策略排序、冷却、状态归一化/压缩
- `test/unit/instant-like-feed-sources.test.ts`：四种来源策略、快/慢模式、去重合并
- `test/unit/instant-like-candidates.test.ts`：候选合并与择优
- `test/unit/instant-like-feed-cache.test.ts`：缓存回退与 TTL

---

## 8. 实验脚本：`scripts/like-browser.ts`

`npm run like:browser` 是**人工实验脚本**：用 Playwright 打开指定说说页面并点击点赞，用于验证浏览器侧行为。Cookie 优先级为显式参数 → `QZONE_COOKIE_STRING` / `QZONE_COOKIE` → 缓存 Cookie；**同样会真实点赞**。它不参与轮询器或 instant-like 主流程，不建议常驻。
