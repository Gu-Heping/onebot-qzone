# 社交互动接口

## 1. 点赞说说

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

### PC 端（主用）

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
