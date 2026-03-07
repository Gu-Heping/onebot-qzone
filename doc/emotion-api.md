# 说说相关接口

## 1. 获取说说列表

### PC 端（主用）

**接口**: `emotion_cgi_msglist_v6`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_msglist_v6`

> ⚠️ 注意：说说列表的实际域名是 `taotao.qzone.qq.com`（不带 `qq` 前缀），与其他说说接口的 `taotao.qzone.qq.com` 不同。但 proxy 路径实测两者均可到达。

**方法**: GET

**参数**:

| 参数名 | 类型 | 必须 | 说明 | 示例值 |
|--------|------|------|------|--------|
| `uin` | string | 是 | 目标用户 QQ 号 | `123456789` |
| `ftype` | number | 否 | 获取类型 | `0`=全部, `1`=原创 |
| `sort` | number | 否 | 排序方式 | `0`=时间倒序 |
| `pos` | number | 否 | 起始位置 | `0` |
| `num` | number | 否 | 获取数量 | `20` |
| `replynum` | number | 否 | 附带评论数 | `10` |
| `g_tk` | number | 是 | 安全令牌 | 计算值 |
| `code_version` | number | 否 | 代码版本 | `1` |
| `format` | string | 否 | 响应格式 | `jsonp` |

**响应**（JSONP 包裹）:

```json
{
  "code": 0,
  "message": "succ",
  "msglist": [
    {
      "tid": "说说ID",
      "uin": 123456789,
      "content": "说说内容",
      "nickname": "昵称",
      "createTime": {"time": 1709012345},
      "created_time": 1709012345,
      "cmtnum": 5,
      "likenum": 10,
      "fwdnum": 2,
      "pic": [
        {"url": "...", "url1": "...", "url2": "...", "url3": "..."}
      ],
      "conlist": [...]
    }
  ]
}
```

**限流**: 返回 `code: -10000` 时表示被限流，应降级到 feeds3。

### 移动端（备选）

**URL**: `https://mobile.qzone.qq.com/get_mood_list`

**方法**: GET

**参数**:

| 参数名 | 说明 |
|--------|------|
| `g_tk` | 安全令牌 |
| `uin` | 目标 QQ 号 |
| `pos` | 起始位置 |
| `num` | 获取数量 |
| `format` | `json` |

**状态**: ❌ 实测返回 HTTP 404，当前不可用。

---

## 2. 获取说说详情

### PC 端（主用，多变体降级）

**接口**: `emotion_cgi_getdetailv6`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getdetailv6`

#### POST 方式（优先尝试）

**参数**（URL 编码 form body）:

| 参数名 | 说明 |
|--------|------|
| `uin` | 说说作者 QQ 号 |
| `tid` | 说说 ID |
| `format` | `json` |
| `hostuin` | 当前登录 QQ 号 |
| `qzreferrer` | 来源页面 |

#### GET 方式（5 种参数变体）

基础 URL: `...?g_tk={gtk}&uin={uin}&tid={tid}&format=json`

| 变体 | 附加参数 |
|------|---------|
| 0 | 无 |
| 1 | `qzonetoken={token}` |
| 2 | `qzonetoken={token}&qzreferrer={ref}` |
| 3 | `qzonetoken={token}&hostuin={uin}` |
| 4 | `qzonetoken={token}&hostuin={uin}&qzreferrer={ref}` |

系统会记忆上次成功的变体（winning variant），下次优先尝试。

**问题**: GET 请求可能返回 0 字节空响应（taotao proxy 层限制），5 分钟冷却期后才重试 PC 路径。

### 移动端（fallback）

**URL**: `https://mobile.qzone.qq.com/detail`

**参数**:

| 参数名 | 说明 |
|--------|------|
| `g_tk` | 安全令牌 |
| `uin` | 说说作者 QQ 号 |
| `cellid` | 说说 ID（注意字段名不同） |
| `format` | `json` |

### 列表 fallback

当以上全部失败时，从 `getEmotionList` 结果中按 tid 匹配查找。

---

## 3. 发布说说

**接口**: `emotion_cgi_publish_v6`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_publish_v6?g_tk={gtk}`

**方法**: POST

### 纯文本参数

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `con` | 说说内容 | `Hello World` |
| `syn_tweet_version` | 同步版本 | `1` |
| `paramstr` | 参数标识 | `1` |
| `feedversion` | feed 版本 | `1` |
| `ver` | 版本 | `1` |
| `ugc_right` | UGC 权限 | `1` |
| `to_sign` | 签名标识 | `0` |
| `hostuin` | 当前 QQ 号 | |
| `code_version` | 代码版本 | `1` |
| `format` | 响应格式 | `fs` |
| `qzreferrer` | 来源页面 | |

### 带图片参数

在纯文本参数基础上额外包含：

| 参数名 | 说明 |
|--------|------|
| `pic_template` | 图片模板，如 `tpl-3-1`（3 张图） |
| `richtype` | `1` |
| `richval` | 图片信息 tab 分隔字符串 |
| `subrichtype` | `1` |
| `pic_bo` | 图片 bo 参数 |

`richval` 格式（每张图一行，用 `\t` 分隔）：

```
,{albumid},{lloc},{sloc},{picType},{height},{width},,{height},{width}
```

### 可见范围

| `who_can_see` 值 | 含义 |
|-------------------|------|
| 无 / `0` | 所有人可见 |
| `1` | 仅好友可见 |
| `2` | 仅自己可见（同时设 `secret=1`） |

### 响应

```json
{
  "code": 0,
  "tid": "说说ID",
  "t1_tid": "说说ID",
  "data": { "tid": "..." }
}
```

---

## 4. 删除说说

**接口**: `emotion_cgi_delete_v6`

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_delete_v6?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 |
|--------|------|
| `hostuin` | 当前 QQ 号 |
| `tid` | 说说 ID |
| `topicId` | 话题 ID（可选） |
| `code_version` | `1` |
| `format` | `json` |
| `qzreferrer` | 来源页面 |

**响应**:

```json
{
  "code": 0,
  "message": "删除成功"
}
```

---

## 5. 转发说说

**接口**: `emotion_cgi_forward_v6`（主用）/ `emotion_cgi_re_feeds`（降级）

### 主用接口

**URL**: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_forward_v6?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 |
|--------|------|
| `tid` | 说说 ID |
| `ouin` | 原作者 QQ 号 |
| `opuin` | 操作者 QQ 号 |
| `hostUin` | 原作者 QQ 号 |
| `topicId` | `{ouin}_{tid}` |
| `con` | 转发评论内容 |
| `feedversion` | `1` |
| `ver` | `1` |
| `code_version` | `1` |
| `appid` | `311` |
| `format` | `json` |
| `qzreferrer` | 来源页面 |

**状态**: ⚠️ 可能返回 `-3000`，降级到 `re_feeds` 实现。

### 降级：通过评论接口转发

**URL**: `emotion_cgi_re_feeds?g_tk={gtk}`

**参数**:

| 参数名 | 说明 |
|--------|------|
| `hostUin` | 原作者 QQ 号 |
| `topicId` | `{ouin}_{tid}` |
| `content` | 转发评论内容 |
| `forward` | `1`（标记为转发） |
| `format` | `json` |
| `qzreferrer` | 来源页面 |
