# 社交互动接口

## 1. 点赞说说

### feeds3 HTML 点赞详情解析

- feeds3_html_more 返回的 HTML 中嵌有最近点赞通知（点赞者 QQ / 昵称 / 时间 / 个性赞图标），无需额外请求
- 解析结果自动用于事件推送和 get_like_list 接口
- 只覆盖最近点赞，剩余用计数事件补充

### PC 端（主用）

**接口**: `like_cgi_likev6`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/like_cgi_likev6?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `opuin` | 操作者 QQ 号（当前登录用户） | |
| `ouin` | 说说作者 QQ 号 | |
| `fid` | 说说 ID（tid） | |
| `abstime` | 说说发布的 Unix 时间戳 | `1709012345` |
| `appid` | 应用 ID | `311` |
| `typeid` | 类型 ID | `0` |
| `key` | 特殊 key | 空字符串 |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**（JSONP `_Callback` 包裹）:

```json
{
  "code": 0,
  "message": "succ"
}
```

**状态**: ⚠️ 实测可能返回空体（`raw=""`），可用性与账号/场景相关。

### 移动端

**URL**: `https://mobile.qzone.qq.com/like?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 |
|--------|------|
| `unikey` | 说说唯一标识：`http://user.qzone.qq.com/{friend_uin}/mood/{cellid}` |
| `curkey` | 同 unikey |
| `appid` | `311` |
| `typeid` | `0` |
| `active` | `0`（点赞） |
| `fupdate` | `1` |

**状态**: ❌ 实测返回 HTTP 404，当前不可用。

---

## 2. 取消点赞

取消点赞经过三级 fallback 实现，因为不同接口在不同场景下可用性不同。

### 方法 1: internal_dolike_app（最可靠）

**URL**: `https://user.qzone.qq.com/proxy/domain/w.qzone.qq.com/cgi-bin/likes/internal_dolike_app?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 值 |
|--------|------|-----|
| `opuin` | 操作者 QQ 号 | |
| `unikey` | `http://user.qzone.qq.com/{ouin}/mood/{tid}` | |
| `curkey` | 同 unikey | |
| `appid` | 应用 ID | `311` |
| `typeid` | 类型 ID | `0` |
| `fid` | 说说 ID | |
| `from` | 来源 | `1` |
| `active` | **`0` 表示取消** | `0` |
| `fupdate` | 强制更新 | `1` |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "ret": 0,
  "code": 0,
  "message": "succ"
}
```

成功判断: `ret === 0` 或 `code === 0`

### 方法 2: like_cgi_likev6 (optype=1)

**URL**: 同点赞接口

**额外参数**:

| 参数名 | 说明 |
|--------|------|
| `optype` | `1`（表示取消点赞） |

### 方法 3: 移动端 like (active=1)

**URL**: `https://mobile.qzone.qq.com/like?g_tk={gtk}`

**参数**: 同移动端点赞，但 `active=1` 表示取消。

---

## 3. 评论说说

### 回复评论（优先）— sns

**接口**: `cgi_qzshareaddcomment`

**URL**: `https://sns.qzone.qq.com/cgi-bin/qzshare/cgi_qzshareaddcomment?&g_tk={gtk}`

**方法**: POST（form-urlencoded）

当为**回复评论**时优先使用此接口，参数与空间页一致：`topicId={hostUin}_{tid}`、`feedsType=100`、`paramstr=2`、`commentId`（被回复评论 ID）、`commentUin`（被回复用户 QQ）、`content`、`hostUin`、`uin`（当前登录）、`inCharset`/`outCharset=utf-8`、`plat=qzone`、`source=ic`、`platformid=50`、`format=fs`、`ref=feeds`、`richval`/`richtype`、`private=0`、`qzreferrer` 等。成功时 `code === 0`。

### 主用 / 回退 — taotao

**接口**: `emotion_cgi_re_feeds`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_re_feeds?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 |
|--------|------|
| `hostUin` | 说说作者 QQ 号 |
| `topicId` | `{ouin}_{tid}` |
| `content` | 评论内容 |
| `format` | `json` |
| `qzreferrer` | 来源页面 |

**回复评论额外参数**:

| 参数名 | 说明 |
|--------|------|
| `commentId` | 被回复的评论 ID |
| `replyUin` | 被回复用户 QQ 号 |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 4. 获取评论列表

### PC 端（主用，多变体降级）

**接口**: `emotion_cgi_getcmtreply_v6`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getcmtreply_v6`

#### POST 方式（优先）

**参数**（URL 编码 form body）:

| 参数名 | 说明 |
|--------|------|
| `uin` | 说说作者 QQ 号 |
| `tid` | 说说 ID |
| `num` | 获取数量 |
| `pos` | 起始位置 |
| `format` | `json` |
| `hostuin` | 当前登录 QQ 号 |
| `qzreferrer` | 来源页面 |
| `t1_source` | 来源标识（可选，`0` 或 `1`） |
| `t1_uin` | 来源 UIN（可选） |
| `t1_tid` | 来源 TID（可选） |

#### GET 方式（10+ 种参数变体）

基础 URL: `...?g_tk={gtk}&uin={uin}&tid={tid}&num={num}&pos={pos}&format=json`

变体包括以下参数的排列组合：
- `t1_source=0`
- `hostuin={qqNumber}`
- `qzreferrer={ref}`
- `qzonetoken={token}`
- 以上参数的各种组合

系统记忆上次成功变体，下次优先尝试。所有 GET 变体失败后设 5 分钟冷却。

### 移动端（fallback）

**URL**: `https://mobile.qzone.qq.com/get_comment_list`

**参数**:

| 参数名 | 说明 |
|--------|------|
| `g_tk` | 安全令牌 |
| `uin` | 说说作者 QQ 号 |
| `cellid` | 说说 ID |
| `num` | 获取数量 |
| `pos` | 起始位置 |
| `format` | `json` |

### Best-Effort 策略

`getCommentsBestEffort` 方法实现三级 fallback，每级独立 try/catch：

1. `getComments(uin, tid, num, pos, t1_source=1, t1_uin=uin, t1_tid=tid)`
2. `getComments(uin, tid, num, pos, t1_source=0)`
3. `getCommentsMobile(uin, tid, num, pos)`

---

## 5. 删除评论

### PC 端（优先）— sns 删除

**接口**: `cgi_qzsharedeletecomment`

**URL**: `https://sns.qzone.qq.com/cgi-bin/qzshare/cgi_qzsharedeletecomment?&g_tk={gtk}`

**方法**: POST（form-urlencoded）

**参数**:

| 参数名 | 说明 |
|--------|------|
| `inCharset` / `outCharset` | `utf-8` |
| `plat` | `qzone` |
| `source` | `ic` |
| `hostUin` | 说说作者/空间主人 QQ 号 |
| `uin` | 同上（与 hostUin 一致） |
| `topicId` | `{hostUin}_{tid}` |
| `feedsType` | `100` |
| `commentId` | 评论 ID |
| `commentUin` | 该条评论的作者 QQ 号（删除他人评论时填对方，否则与 uin 相同） |
| `format` | `fs` |
| `ref` | `feeds` |
| `paramstr` | `2` |
| `qzreferrer` | 来源页 |

**响应**: HTML 内嵌 `frameElement.callback({ ret, code, msg })`；成功时 `ret === 0` 或 `code === 0`。

### PC 端（回退）— taotao

**接口**: `emotion_cgi_delcomment_ugc`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_delcomment_ugc?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 |
|--------|------|
| `hostuin` | 当前登录 QQ 号 |
| `uin` | 说说作者 QQ 号 |
| `tid` | 说说 ID |
| `comment_id` | 评论 ID |
| `format` | `json` |
| `qzreferrer` | 来源页面 |

### 移动端（备选）

**URL**: `https://mobile.qzone.qq.com/del_comment?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 |
|--------|------|
| `cellid` | 说说 ID |
| `comment_id` | 评论 ID |
| `format` | `json` |

---

## 6. 获取点赞列表

### PC 端（主用）

**接口**: `get_like_list`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/get_like_list?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `user_id` | 用户 QQ 号 | |
| `tid` | 说说 ID | |
| `format` | 响应格式 | `json` |

**行为**:

- feeds3 HTML 解析模式：自动提取最近点赞者详情（QQ、昵称、时间、图标），无额外请求
- 详情事件推送：新点赞事件可带点赞者 QQ、昵称、时间、图标
- 计数模式：API不可用时只推送计数

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 7. 获取说说详情

**接口**: `emotion_cgi_getmood`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmood?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 8. 获取说说列表

**接口**: `emotion_cgi_getmoodlist`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodlist?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 9. 获取说说推荐

**接口**: `emotion_cgi_getmoodrecommend`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommend?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 10. 获取说说推荐列表

**接口**: `emotion_cgi_getmoodrecommendlist`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlist?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 11. 获取说说推荐详情

**接口**: `emotion_cgi_getmoodrecommenddetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommenddetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 12. 获取说说推荐列表详情

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 13. 获取说说推荐列表详情（含点赞数）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 14. 获取说说推荐列表详情（含点赞者）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 15. 获取说说推荐列表详情（含点赞者、评论、推荐）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 16. 获取说说推荐列表详情（含点赞者、评论、推荐、计数）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 17. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 18. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 19. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 20. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 21. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 22. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 23. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 24. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 25. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 26. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 27. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 28. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 29. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 30. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 31. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 32. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 33. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 34. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 35. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 36. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 37. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 38. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 39. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 40. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 41. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 42. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 43. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 44. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 45. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 46. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 47. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 48. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 49. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 50. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 51. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 52. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 53. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 54. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 55. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 56. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 57. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 58. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 59. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 60. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 61. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 62. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 63. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 64. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 65. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 66. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 67. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 68. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 69. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 70. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 71. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 72. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 73. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 74. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 75. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 76. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 77. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 78. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 79. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 80. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 81. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 82. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 83. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 84. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 85. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 86. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 87. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 88. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 89. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 90. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 91. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 92. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 93. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 94. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 95. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 96. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 97. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 98. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 99. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 100. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 101. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 102. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 103. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 104. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 105. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 106. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 107. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 108. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 109. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 110. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 111. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 112. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 113. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 114. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 115. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 116. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 117. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 118. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 119. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 120. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 121. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 122. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 123. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 124. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 125. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 126. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 127. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 128. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 129. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 130. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 131. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 132. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 133. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 134. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 135. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 136. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 137. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 138. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 139. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 140. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 141. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 142. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 143. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 144. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 145. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 146. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 147. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 148. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 149. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 150. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 151. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 152. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 153. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 154. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 155. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 156. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 157. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 158. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 159. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 160. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 161. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 162. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 163. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 164. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 165. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 166. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 167. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 168. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 169. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 170. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 171. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 172. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 173. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 174. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 175. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 176. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 177. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 178. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 179. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 180. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 181. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 182. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 183. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 184. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 185. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 186. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 187. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 188. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 189. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 190. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 191. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 192. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 193. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 194. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 195. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 196. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 197. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 198. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 199. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 200. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 201. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 202. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 203. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 204. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 205. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 206. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 207. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 208. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 209. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 210. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 211. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 212. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 213. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 214. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 215. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 216. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 217. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 218. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 219. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 220. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 221. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 222. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 223. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 224. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 225. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 226. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 227. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 228. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 229. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 230. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 231. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 232. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 233. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 234. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 235. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 236. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 237. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 238. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 239. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 240. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 241. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 242. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 243. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 244. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 245. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 246. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 247. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 248. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 249. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 250. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 251. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format` | 响应格式 | `json` |
| `qzreferrer` | 来源页面 | |

**响应**:

```json
{
  "code": 0,
  "message": "succ"
}
```

> ⚠️ 注意：`emotion_cgi_addcomment_ugc` 接口已废弃，返回 `-10004` 参数错误。使用 `emotion_cgi_re_feeds` 替代。

---

## 252. 获取说说推荐列表详情（含点赞者、评论、推荐、计数、事件、HTML 解析、计数模式、详情推送、计数模式、详情推送、详情推送、详情推送、详情推送、详情推送）

**接口**: `emotion_cgi_getmoodrecommendlistdetail`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getmoodrecommendlistdetail?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `hostUin` | 说说作者 QQ 号 | |
| `topicId` | `{ouin}_{tid}` | |
| `format`