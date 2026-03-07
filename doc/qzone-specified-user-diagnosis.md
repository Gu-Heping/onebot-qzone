# QZone：指定用户说说 vs 好友动态 — 诊断与修复

## 现象

- **获取好友动态**（混合流）：正常，有数据。
- **获取指定用户的说说列表**（如 Peace 1179350197、孔子）：始终「暂无说说」。

## 根因对比

| 场景 | 请求方式 | 结果 |
|------|----------|------|
| 好友动态 | `feeds3`: **uin=当前登录号**、**scope=0**、**不传 uinlist** | 后端返回完整 HTML，解析出多条说说 ✅ |
| 指定用户 策略1 | `feeds3`: uin=**目标**、scope=**1**（个人说说） | 用 bot cookie 请求「别人个人页」，后端对非本人常返回空（113 字节）❌ |
| 指定用户 策略2 | `feeds3`: uin=**当前登录号**、scope=0、**uinlist=目标** | 后端可能不支持或该环境下返回空（113 字节）❌ |
| 指定用户 策略3 | `feeds3`: uin=**目标**、scope=0 | 相当于「看目标的好友动态」，cookie 是 bot，权限不足，返回空 ❌ |

结论：**唯一稳定有数据的是「当前登录号 + scope=0 + 无 uinlist」的好友动态流**。指定用户目前依赖的 scope=1 / scope=0+uinlist / scope=0+uin=目标 在 bot 身份下都拿不到数据。

## 修复思路

**指定用户（且非本人）时**：不再优先依赖 scope=1 或 uinlist，而是

1. **先拉「好友动态」**：与 getFriendFeeds 完全一致 — `fetchFeeds3Html(当前登录号, true, 0, 50)`，不传 uinlist。
2. **在内存中按 uin 过滤**：`parseFeeds3Items(text, targetUin, ...)` 只保留该好友的条目。
3. 若条数不足，用 **externparam 翻页**，每页同样 scope=0、无 uinlist，再过滤，直到凑够或无更多页。
4. 若这样仍 0 条（该好友近期无动态或不在最近 N 条内），再回退到原有策略 2/3 作为兜底。

这样「指定用户」= 从已经能成功获取的好友动态流里筛出该人，不依赖后端对 uinlist 或 scope=1（非本人）的支持。

## 代码改动要点

- 在 `getEmotionListViaFeeds3` 中，当 `!isOwn` 时：
  - **优先**：用 `fetchFeeds3Html(this.qqNumber!, false, 0, 50)`（与 getFriendFeeds 完全一致：**forceRefresh=false**，同一 cacheKey）拿到混合流，`parseFeeds3Items(..., targetUin, ...)` 过滤。
  - **交叉验证 / Bug 修复**：策略 0 必须与 getFriendFeeds 共用缓存（forceRefresh=false）。若用 true，会强制刷新并可能用空响应覆盖有效缓存，导致「获取动态有数据、指定用户无」或反过来污染缓存。
  - 若有结果则直接使用并标记来源（`scope=0+filter`）；若无结果再走策略 1/2/3。
