# QZone：指定用户说说 vs 好友动态 — 诊断与修复

## 为什么什么都获取不到？

**根因**：当前 Cookie **无效**（尤其是 `p_skey` 缺失或过期），QZone 服务端认为未登录。

- **表现**：`/status` 里 `cookie.valid === false`、`p_skey === false`；接口返回 `code: -3000, message: "请先登录空间"`；feeds3 返回约 113 字节空壳，解析 0 条。
- **处理**：
  1. 打开 `http://<bridge>:5700/status` 看 `cookie.valid`、`p_skey`。若为 false，需要重新登录。
  2. **更新 Cookie**：在浏览器登录 QQ 空间，用插件或控制台取出 Cookie 字符串（需包含 `p_skey`、`skey`、`p_uin`、`uin`），写入 `.env` 的 `QZONE_COOKIE_STRING`，重启 bridge。
  3. **或扫码登录**：设置 `QZONE_ENABLE_QR=1`，重启后用 Playwright 扫码，成功后 Cookie 会写回 `.env`。
  4. 若已配置 Cookie 仍 invalid：尝试删除本地 Cookie 缓存（如 `cookies.json`），仅保留环境变量 Cookie 后重启，让 bridge 用环境变量重新加载并做校验。

只有 Cookie 有效后，「获取好友动态」和「指定用户说说」才会有数据。

---

## 现象（Cookie 有效时的差异）

- **获取好友动态**（混合流）：正常，有数据。
- **获取指定用户的说说列表**（如 Peace 1179350197、孔子）：始终「暂无说说」。

## 根因对比

| 场景 | 请求方式 | 结果 |
|------|----------|------|
| 好友动态 | `feeds3`: **uin=当前登录号**、**scope=0**、**不传 uinlist**，请求带 `outputhtmlfeed=1`、`pagenum`、`begintime`（从 externparam 解析）实现翻页 | 后端返回完整 HTML，解析出多条说说 ✅ |
| 指定用户 策略1 | `feeds3`: uin=**目标**、scope=**1**（个人说说） | 用 bot cookie 请求「别人个人页」，后端对非本人常返回空（113 字节）❌ |
| 指定用户 策略2 | `feeds3`: uin=**当前登录号**、scope=0、**uinlist=目标** | 后端可能不支持或该环境下返回空（113 字节）❌ |
| 指定用户 策略3 | `feeds3`: uin=**目标**、scope=0 | 相当于「看目标的好友动态」，cookie 是 bot，权限不足，返回空 ❌ |

结论：**唯一稳定有数据的是「当前登录号 + scope=0 + 无 uinlist」的好友动态流**。指定用户目前依赖的 scope=1 / scope=0+uinlist / scope=0+uin=目标 在 bot 身份下都拿不到数据。

## 修复思路

**指定用户（且非本人）时**：不再优先依赖 scope=1 或 uinlist，而是

1. **先拉「好友动态」**：与 getFriendFeeds 一致 — scope=0、游标翻页（cursor/next_cursor），不传 uinlist；请求带完整浏览器参数（pagenum、begintime 等）使翻页生效。
2. **在内存中按 uin 过滤**：`parseFeeds3Items(..., filterUin)` 只保留该好友的条目（opuin 校验）。
3. 若条数不足，用返回的 **next_cursor** 继续请求下一页，每页同样 scope=0、无 uinlist，再过滤，直到凑够或无更多页。
4. 若这样仍 0 条（该好友近期无动态或不在最近 N 条内），再回退到原有策略 2/3 作为兜底。

这样「指定用户」= 从已经能成功获取的好友动态流里筛出该人，不依赖后端对 uinlist 或 scope=1（非本人）的支持。

## 代码改动要点

- 在 `getEmotionListViaFeeds3` 中，当 `!isOwn` 时：
  - **优先**：用 `fetchFeeds3Html(this.qqNumber!, false, 0, 50)`（与 getFriendFeeds 完全一致：**forceRefresh=false**，同一 cacheKey）拿到混合流，`parseFeeds3Items(..., targetUin, ...)` 过滤。
  - **交叉验证 / Bug 修复**：策略 0 必须与 getFriendFeeds 共用缓存（forceRefresh=false）。若用 true，会强制刷新并可能用空响应覆盖有效缓存，导致「获取动态有数据、指定用户无」或反过来污染缓存。
  - 若有结果则直接使用并标记来源（`scope=0+filter`）；若无结果再走策略 1/2/3。
- **opuin 校验**：指定用户过滤时 `parseFeeds3Items(..., filterUin)` 只保留 `id="feed_{opuin}_..."` 中 opuin = 目标用户的块，避免错位混入他人内容。

## 说说列表里显示 uin（排查混数据）

- Napcat 工具 `qzone_get_posts` 的返回中**每条都会带 `uin=xxx`**（无则显示 `uin=?`），便于确认是否混入他人数据。
- **若 bot 仍说「没有 uin」**：多半是 openclaw-gateway 未加载最新插件。请**重启 openclaw-gateway** 后再拉一次。
- 拉 2377479025 时若某条内容像别人（如「雨燕 南青乐队」）：
  - 看该条 **uin**：若 `uin=2377479025` 可能是对方转发；若 `uin=1179350197` 说明混入了你的数据，需继续查 bridge 的 opuin 过滤或 feeds3 解析。
