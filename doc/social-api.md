# 社交互动接口

> **当前实现状态（2026-10）**：评论列表与点赞列表的**读取**只走 **feeds3 HTML 解析**（好友流 / 作者 `scope=1` 空间 / `feeds_html_act_all` 分页），PC `emotion_cgi_getcmtreply_v6`、`get_like_list`、mobile `get_comment_list` 均不再作为主路径。点赞、取消点赞、评论、删除评论、转发的**写接口**仍按本文的多级 fallback 执行。
>
> 实机探测（2026-03-22）：`mobile.qzone.qq.com` 的 `/like`、`/get_comment_list` 为 **HTTP 404**；PC `get_like_list` 为 **500 空体**；`emotion_cgi_getcmtreply_v6` 最小 GET 返回 **`code=-3`**。详见 [`api-probe-results.md`](api-probe-results.md)。

---

## 1. 点赞说说

**实现**：`client.likeEmotion(ouin, tid, abstime, appid, typeid, unikey?, curkey?)`

缺失的 `ouin/appid/typeid/abstime/unikey/curkey` 会先由 `getPostMeta(tid)` 从缓存补全；仍缺失时 `appid` 默认 `311`。

### 降级链

| 顺序 | 接口 | 方式 | 成功判断 |
|------|------|------|----------|
| 1 | `internal_dolike_app`（w.qzone.qq.com 代理） | POST form，`active=0` | `ret === 0` 或 `code === 0` |
| 2 | `like_cgi_likev6`（taotao 代理） | POST form，`_Callback` JSONP | `code === 0` 或 `ret === 0` |
| 3 | `mobile.qzone.qq.com/like` | POST form，`active=0` | 返回体 `code === 0`；实机 404，通常不可用 |

### internal_dolike_app 参数

**URL**: `https://user.qzone.qq.com/proxy/domain/w.qzone.qq.com/cgi-bin/likes/internal_dolike_app?g_tk={gtk}`

| 参数名 | 说明 |
|--------|------|
| `qzreferrer` | 来源页面 |
| `opuin` | 当前登录 QQ |
| `unikey` / `curkey` | `http://user.qzone.qq.com/{ouin}/mood/{tid}`（部分 appid 使用 `likeUnikey`） |
| `appid` / `typeid` | 说说应用/类型，一般 `311` / `0` |
| `fid` | 说说 ID（tid） |
| `from` | `1` |
| `active` | `0`（代码沿用的抓包值） |
| `fupdate` | `1` |
| `abstime` | 说说发布时间戳 |
| `format` | `json` |

### like_cgi_likev6 参数

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/like_cgi_likev6?g_tk={gtk}`

`opuin / ouin / fid / abstime / appid / typeid / key（空串）/ format=json / qzreferrer`，响应为 `_Callback(...)` JSONP。

### Playwright 点赞路径

`client.likeWithPlaywrightContext(item)`：在已登录的浏览器上下文中打开说说并**真实点击点赞按钮**；若页面状态未变化，再在页面内按上表 1→2→3 的顺序 fetch 兜底。`client.verifyLikeInPlaywrightContext(item)` 用于点击后复核。

---

## 2. 取消点赞

**实现**：`client.unlikeEmotion(...)`，参数补全逻辑同点赞。

| 顺序 | 接口 | 关键参数 |
|------|------|----------|
| 1 | `internal_dolike_app` | 同点赞表单 |
| 2 | `like_cgi_likev6` | 额外 `optype=1` |
| 3 | `mobile.qzone.qq.com/like` | `active=1`（实机 404） |

成功判断同点赞；`unlikeEmotion` 对前两级分别在 `ret === 0` / `code === 0` 时返回。

---

## 3. 评论说说

**实现**：`client.commentEmotion(ouin, tid, content, replyCommentId?, replyUin?, appid?, abstime?)`

- 内容先做表情转换：`[微笑]` → `[em]e100[/em]`。
- 回复评论时自动在正文前加 @ 提及：`@{uin:<replyUin>,nick:<昵称>,auto:1} `；昵称优先从 Cookie / 好友缓存取。
- 缺失 `ouin/appid/abstime` 时从 post meta 补全，`appid` 默认 `311`。

### ① PC user 代理（优先）

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_re_feeds?g_tk={gtk}`

**方法**: POST（form-urlencoded）

| 参数名 | 说明 |
|--------|------|
| `hostUin` | 说说作者 QQ |
| `topicId` | `{ouin}_{tid}` |
| `content` | 正文（含 @ 前缀） |
| `format` | `json` |
| `qzreferrer` | 来源页面 |
| `commentId` / `replyUin` / `commentUin` | 仅回复评论时携带 |

成功判断：`code === 0` 或 `ret === 0`。

### ② h5 代理（回退）

**URL**: `https://h5.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_re_feeds?g_tk={gtk}`

`topicId={ouin}_{tid}__1`、`format=fs`，并携带 `feedsType=100`、`plat=qzone`、`source=ic`、`platformid=50`、`uin`（当前登录）、`ref=feeds`、`paramstr`（回复为 `2`，否则 `1`）、`private=0` 等空间页参数；回复场景额外带 `t1_uin/t1_tid/t2_uin/t2_tid`。

> `emotion_cgi_addcomment_ugc` 已废弃（`-10004`），不要再使用。

---

## 4. 获取评论列表

**实现**：`client.getCommentsBestEffort(uin, tid, num = 20, pos = 0, options?)`

当前**只从 feeds3 取数**，不再调用 PC/mobile 评论接口。数据来源按以下顺序：

1. **feeds3 缓存**：`feeds3Comments` 中已有该 tid 且缓存年龄 ≤ `maxCacheAgeSec`（默认 90s）→ 直接切片返回，`_source = 'feeds3_cache'`。
2. **好友动态流**：`fetchFeeds3Html(当前登录号, false, 0, 50, ...)`，解析后按 tid 命中评论桶。
3. **作者空间**：`fetchFeeds3Html(uin, true, 1, 50)`（`scope=1`）。
4. **`feeds_html_act_all` 分页**：`getFeedsHtmlActAll(uin, { start, count: 20, scope: 0 })`，最多 25 页，直至命中评论桶或 `has_more=false`。
5. 全部未命中：返回 `code=-1`、`commentlist=[]`，并区分：
   - `post_counts_present_but_not_embedded`：计数显示有评论，但 HTML 未内嵌评论区；
   - `html_no_matching_comment_bucket`：HTML 结构变化 / tid 不一致。

### 分页与响应字段

对缓存到的完整评论列表按 `pos/num` 切片：

```json
{
  "code": 0,
  "commentlist": [ ... ],
  "_source": "feeds3",
  "_feeds3_total": 12,
  "has_more": true,
  "next_cursor": "20",
  "_page_info": { "count": 20, "source": "feeds3", "fast_mode": false }
}
```

- `_source`：`feeds3` / `feeds3_cache`
- `_feeds3_total`：该 tid 当前解析到的评论总数
- `has_more = pos + 当前页条数 < total`
- `fastMode` 仅影响日志频率，不改变取数路径

### SDK 包装

`getCommentsBestEffort({ uin, tid, num?, pos?, options? })`（对象重载）返回 `SdkResult`，附带：

- `identity`：标准化后的 `PostIdentity`
- `availability`：`available_full` / `available_partial` / `not_embedded`
- `warnings`、`diagnostic`（`parse_trace`）
- 认证失败 / 限流会返回 `sdkFailure`（`kind=auth|rate_limit|parse_miss`）

### 失败响应（Legacy）

```json
{
  "code": -1,
  "message": "comments_not_found_in_feeds3: 已尝试好友流、作者 feeds3(scope=1)、feeds_html_act_all 分页；仍无桶则帖无展开评论、tid 不一致或 HTML 结构变化",
  "commentlist": [],
  "has_more": false,
  "next_cursor": "",
  "_page_info": { "count": 0, "source": "feeds3", "fast_mode": false }
}
```

> 三天前或更早的帖子可能不在当前 feeds3 页面内：计数（`qz_opcnt2`）显示有评论，但 HTML 没有评论区 → `availability: not_embedded`。

---

## 5. 删除评论

**实现**：`client.deleteComment(uin, tid, commentId, commentUin?)`

### 路由覆盖

若 `routes['delete_comment'] === 'mobile'`，直接走：

`POST https://mobile.qzone.qq.com/del_comment?g_tk={gtk}`，body：`cellid`、`comment_id`、`format=json`。

### 默认顺序

1. **SNS 删除（优先）**  
   `POST https://sns.qzone.qq.com/cgi-bin/qzshare/cgi_qzsharedeletecomment?&g_tk={gtk}`  
   参数：`inCharset/outCharset=utf-8`、`plat=qzone`、`source=ic`、`hostUin`、`uin`、`topicId={uin}_{tid}`、`feedsType=100`、`commentId`、`commentUin`（默认同 `uin`）、`format=fs`、`ref=feeds`、`paramstr=2`、`qzreferrer`。  
   响应为 HTML 内嵌 `frameElement.callback({ ret, code, msg })`；`ret === 0` 视为成功。
2. **taotao 回退**  
   `POST https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_delcomment_ugc?g_tk={gtk}`  
   参数：`hostuin`（当前登录）、`uin`（说说作者）、`tid`、`comment_id`、`format=json`、`qzreferrer`。

---

## 6. 获取点赞列表

**实现**：`client.getLikeList(uin, tid)` → `getLikeListBestEffort(uin, tid)`；SDK 包装为 `getLikesBestEffort(uin, tid)`。

**只从 feeds3 HTML 取数**（PC `get_like_list` / mobile detail 已移除）：

1. 命中 `feeds3LikesCache` → 直接返回。
2. 作者空间 `scope=1`：`fetchFeeds3Html(uin, true, 1, 50)`，合并点赞桶。
3. 若未命中且目标不是自己：好友动态流 `fetchFeeds3Html(当前登录号, false, 0, 50, ...)`。
4. 仍未命中 → 返回 `[]`；若 feeds3 本身有业务失败，SDK 包装会返回 `sdkFailure`。

SDK 包装同样提供 `availability`：HTML 无点赞明细但计数 > 0 时为 `not_embedded`，明细少于计数时为 `available_partial`；来源标记 `feeds3_html`。

> 点赞列表只反映当前 HTML 能展开到的点赞人；与 `qz_opcnt2` 的 `traffic.like` 计数可能不一致。计数兜底见下一节。

---

## 7. 流量计数（点赞兜底）

**实现**：`client.getTrafficData(uin, tid)`

**接口**: `r.qzone.qq.com/cgi-bin/user/qz_opcnt2`（经 user 代理，JSONP `_Callback`）

```
https://user.qzone.qq.com/proxy/domain/r.qzone.qq.com/cgi-bin/user/qz_opcnt2
  ?_stp={ms}&unikey=http%3A%2F%2Fuser.qzone.qq.com%2F{uin}%2Fmood%2F{tid}
  &face=0&fupdate=1&g_tk={gtk}
```

返回 `{ like, read, comment, forward }`；字段缺失或空列表时各项为 `-1`。轮询器在 feeds3 无法给出点赞明细时用它做**计数变化**兜底。

---

## 8. 转发说说

**实现**：`client.forwardEmotion(ouin, tid, content = '')`

1. `POST https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_forward_v6?g_tk={gtk}`  
   `tid / ouin / opuin / hostUin / topicId={ouin}_{tid} / con / feedversion=1 / ver=1 / code_version=1 / appid=311 / format=json / qzreferrer`。
2. `code !== 0` 时回退 `emotion_cgi_re_feeds`：`hostUin / topicId / content / forward=1 / format=json / qzreferrer`。

---

## 9. 历史接口（2026-03 探测，保留备查）

| 接口 | 用途 | 当时结果 | 现状 |
|------|------|----------|------|
| `emotion_cgi_getcmtreply_v6` | PC 评论列表 | 最小 GET `code=-3`；多变体（`qzonetoken`/`hostuin`/`qzreferrer`）记忆成功变体 | 已移出主路径 |
| `mobile.qzone.qq.com/get_comment_list` | 移动端评论列表 | 不稳定 / 404 | 不再调用 |
| `get_like_list` | PC 点赞列表 | 500 空体 | 已移除 |
| `mobile.qzone.qq.com/like` | 移动端点赞 | HTTP 404 | 仅作最后兜底 |
| `mobile.qzone.qq.com/del_comment` | 移动端删评论 | 不稳定 | 仅 `routes` 显式覆盖时使用 |
| `cgi_qzsharedeletecomment` | SNS 删评论 | 可用 | 仍为主路径 |
| `cgi_qzshareaddcomment` | SNS 回复评论 | 可用 | 已被 `emotion_cgi_re_feeds` 两段式替代（代码未再调用） |
