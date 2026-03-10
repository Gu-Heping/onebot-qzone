# feeds3_html_more 接口及 HTML 解析

## 概述

`feeds3_html_more` 是 QQ 空间中**最可靠的数据源**：只需 Cookie + g_tk 即可正常返回，不受 taotao proxy 层的 GET 限制。

当主接口 `emotion_cgi_msglist_v6` 被限流（`-10000`）或其他 PC 端 GET 接口返回空响应时，feeds3 是核心降级方案。

## 接口信息

**URL**: `https://user.qzone.qq.com/proxy/domain/ic2.qzone.qq.com/cgi-bin/feeds/feeds3_html_more`

**方法**: GET

**参数**:

| 参数名 | 值 | 说明 |
|--------|-----|------|
| `uin` | QQ 号 | 目标用户 |
| `scope` | `0` | 作用域 |
| `view` | `1` | 视图类型 |
| `daylist` | 空 | 日期列表 |
| `uinlist` | 空或单 UIN | UIN 列表；传单好友 QQ 时表示「好友动态流中只取该用户的动态」（用于尝试获取指定好友说说，后端是否支持视实现而定） |
| `gid` | 空 | 分组 ID |
| `flag` | `1` | 标识 |
| `filter` | `all` | 过滤器 |
| `applist` | `all` | 应用列表 |
| `refresh` | 首页 `1`，续页 `0` | 是否刷新 |
| `pagenum` | 从 externparam 解析 | 页码（与 main.externparam 内一致） |
| `begintime` | 从 externparam 的 basetime 解析 | 起始时间戳 |
| `dayspac` | `5` | 往回查天数 |
| `sidomain` | `qzonestyle.gtimg.cn` | 静态资源域 |
| `useutf8` | `1` | UTF-8 |
| `outputhtmlfeed` | `1` | 强制返回 HTML feed |
| `rd` / `usertime` / `windowId` | 随机/时间戳 | 与浏览器抓包一致 |
| `aisortEndTime` 等 | `0` | AI 排序相关 |
| `g_tk` | 计算值 | 安全令牌 |
| `format` | `json` | 响应格式 |

## 响应格式

接口返回 **JSONP**：`_Callback({ "code": 0, "data": { "main": { ... }, "data": [ ... ] } });`

- **data.main**：分页与游标信息，含 `hasMoreFeeds`、`pagenum`、**externparam**（翻页时下一页的 cursor）、`begintime`、`dayspac` 等。
- **data.data**：当前页 feed 数组，每项含 `key`、`html`（转义后的 HTML 片段）、`abstime`、`opuin`、`nickname` 等。

翻页时从 **data.main.externparam** 解析 `basetime`、`pagenum` 作为下页的 `begintime` 与顶层 `pagenum`。

HTML 片段中的特殊字符经过以下转义：

| 转义序列 | 实际字符 |
|---------|---------|
| `\x22` | `"` |
| `\x3C` | `<` |
| `\/` | `/` |

需要先进行解转义才能解析 HTML。

## HTML 结构

每条说说/动态是一个 feed 块：

```html
<div id="feed_{uin}_{appid}_0_{timestamp}_0_1" data-key="{tid}" ...>
  <a class="f-name ...">{昵称}</a>
  <div class="f-info">{说说内容}</div>
  <img src="https://...qpic.cn/...">
  <span class="f-ct ...">5</span>  <!-- 评论数 -->
  <span class="f-like ...">10</span> <!-- 点赞/转发数 -->
</div>
```

### ID 格式解析

```
feed_{uin}_{appid}_0_{timestamp}_0_1
```

- `uin`: 发布者 QQ 号
- `appid`: 应用 ID（说说为 `311`）
- `timestamp`: 发布时间戳

### data-key

`data-key` 属性值即为说说的 `tid`。

## HTML 解析算法

### 正则表达式

```typescript
// Feed 块提取
const feedBlockPat = /id="feed_(\d+)_(\d+)_\d+_(\d+)_\d+_\d+"[^>]*?data-key="([^"]+)"[^>]*?>([\s\S]*?)(?=id="feed_\d+_|$)/g;

// 字段提取
const contentPat = /class="f-info">([\s\S]*?)<\/div>/;
const nicknamePat = /class="f-name[^"]*"[^>]*>([\s\S]*?)<\/a>/;
const cmtnumPat = /class="f-ct[^"]*"[^>]*>(\d+)/;
```

### 解析流程

1. 解转义：`\x22` → `"`, `\x3C` → `<`, `\/` → `/`
2. 用 `feedBlockPat` 迭代匹配所有 feed 块
3. 按 `appid` 过滤（说说为 `311`）
4. 按 `uin` 过滤（可选，用于获取特定用户的说说）
5. 去重（按 tid）
6. 从每个块中提取：内容、昵称、评论数
7. 提取图片：匹配 `<img>` 标签中包含 `qpic.cn` 或常见图片扩展名的 URL

### 图片提取（增强版）

从 `data-pickey` 属性提取原始高清图片 URL 和尺寸元数据：

```html
<a class="img-item" data-pickey="{tid},{originalUrl}" data-width="1080" data-height="1920">
  <img src="https://a1.qpic.cn/psc?..."><!-- 缩略图 -->
</a>
```

```typescript
// 优先从 data-pickey 提取原始 URL
const picKeyPat = /<a[^>]+class="img-item[^"]*"[^>]*data-pickey="([^,]+),([^"]+)"[^>]*>/gi;
const picsMeta: Array<{ url: string; originalUrl?: string; width?: number; height?: number }> = [];

while ((picKeyMatch = picKeyPat.exec(regionDecoded)) !== null) {
  const originalUrl = picKeyMatch[2]; // photo.store.qq.com 原始高清 URL
  const imgItemTag = picKeyMatch[0];
  const width = imgItemTag.match(/data-width="(\d+)"/)?.[1];
  const height = imgItemTag.match(/data-height="(\d+)"/)?.[1];
  picsMeta.push({ url: originalUrl, originalUrl, width, height });
}

// Fallback：从 <img src> 提取缩略图
for (const im of regionDecoded.matchAll(/<img[^>]+src="([^"]+)"/gi)) {
  const src = im[1];
  if ((src.includes('qpic.cn') || src.includes('photo.store.qq.com')) && !src.includes('qlogo')) {
    if (!picsMeta.find(p => p.url === src)) {
      picsMeta.push({ url: src });
    }
  }
}
```

**返回结构**：
```typescript
interface PictureMeta {
  url: string;           // 图片 URL
  originalUrl?: string;  // 原始高清 URL（从 data-pickey 提取）
  width?: number;        // 图片宽度
  height?: number;       // 图片高度
}
```

### 特定说说的图片提取

通过 `data-key="{tid}"` 定位到特定说说块后进行图片提取：

```typescript
const pattern = new RegExp(
  `data-key="${tidEscaped}"([\\s\\S]*?)(?=data-key="|$)`
);
```

## 解析结果格式

```typescript
{
  tid: string,          // 说说 ID
  uin: string,          // 发布者 QQ 号
  nickname: string,     // 昵称
  content: string,      // 说说文本内容（HTML 标签已剥离）
  created_time: number, // Unix 时间戳
  createTime: string,   // 时间戳字符串
  cmtnum: number,       // 评论数
  fwdnum: 0,            // 转发数（feeds3 不提供，固定为 0）
  pic: Array<{url: string}>,  // 图片列表
  picsMeta: Array<{     // 图片元数据（可选，含原始 URL 和尺寸）
    url: string,
    originalUrl?: string,
    width?: number,
    height?: number
  }>,
  appid: string,        // 应用 ID（311=说说，202=网易云音乐）
  typeid: string,       // 类型 ID（0=原创，2=分享，5=转发）
  appName: string,      // 第三方应用名称（如「网易云音乐」）
  appShareTitle: string, // 分享标题
  likeUnikey: string,   // 点赞 API unikey
  likeCurkey: string,   // 点赞 API curkey
  musicShare: {         // 音乐分享元数据（仅 appid=202/2100）
    songName: string,   // 歌曲名
    artistName?: string, // 歌手名
    coverUrl?: string,  // 封面图 URL
    playUrl?: string    // 播放链接
  },
  _source: 'feeds3'     // 数据来源标记
}
```

## 特殊类型说说解析

### 音乐分享（appid=202/2100）

网易云音乐分享结构：

```html
<div class="fui-left-right f-ct-txtimg">
  <div class="img-box">
    <a href="https://y.music.163.com/...">
      <img trueSrc="https://...cover.jpg"><!-- 封面图 -->
    </a>
  </div>
  <div class="txt-box">
    <h4 class="txt-box-title"><a>歌曲名</a></h4>
    <a class="f-name info state ellipsis-two">歌手名</a>
  </div>
</div>
<a class="qz_like_btn_v3" data-unikey="{play_url}" data-curkey="00{ouin}00{abstime}">
```

解析逻辑：
- **歌曲名**：`<h4 class="txt-box-title"><a>{歌曲名}</a></h4>`
- **歌手名**：`<a class="f-name info state ellipsis-two">{歌手名}</a>`
- **封面图**：`<img trueSrc="{封面URL}">`（注意是 `trueSrc` 而非 `src`，用于 JS 延迟加载）
- **播放链接**：`<div class="img-box">` 内的 `<a href="{播放链接}">`
- **curkey**：优先从 `data-curkey` 属性提取，无法获取时才按公式 `00{ouin}00{abstime}` 推算

### 转发说说（typeid=5）

转发检测逻辑：

```typescript
// 优先检查 typeid=5，同时检查 origTid 差异
const isForward = typeid === '5' ||
  !!(origTid && origTid !== tid && origUin && origUin !== dataUin);
```

转发说说结构：

```html
<i name="feed_data" data-tid="{tid}" data-uin="{uin}"
   data-origtid="{orig_tid}" data-origuin="{orig_uin}">
<div class="txt-box">
  <a class="nickname">{转发者昵称}</a>：{转发评论}
  <a class="nickname">{原作者昵称}</a>：{原说说内容}
</div>
```

解析结果：
- `content`：转发者的评论内容
- `rt_tid`：原说说 TID
- `rt_uin`：原作者 UIN
- `rt_uinname`：原作者昵称
- `rt_con`：原说说内容

### curkey 提取优先级

1. **优先从 HTML 提取**：`data-curkey` 属性（点赞按钮上）
2. **JS 数据字段**：`curkey:'...'` 或 `curkey: "..."`
3. **公式推算**（仅在前两者都失败时）：`00{ouin.padStart(10,'0')}00{abstime.padStart(10,'0')}`

## 缓存策略

- **缓存 TTL**: 30 秒
- **缓存上限**: 50 条目（按 uin 缓存，超出时淘汰最旧条目）
- **强制刷新**: 支持 `forceRefresh` 参数跳过缓存

## 与主接口的对比

| 特性 | emotion_cgi_msglist_v6 | feeds3_html_more |
|------|----------------------|-----------------|
| 返回格式 | JSON/JSONP | HTML 片段 |
| 稳定性 | 可能被限流 | ✅ 高度可靠 |
| 数据丰富度 | 完整字段 | 基础字段 |
| 转发数 | ✅ 提供 | ❌ 不提供 |
| 点赞数 | ✅ 提供 | ❌ 不直接提供 |
| 好友动态 | 仅自己的说说 | ✅ 可获取好友动态 |
| 解析复杂度 | 低（JSON） | 高（HTML 正则） |

## 翻页（scope=0 好友说说流）

好友说说接口 `getFriendFeeds(cursor?, num?)` 使用 **scope=0** + `filter=all` 请求 `feeds3_html_more`，翻页依赖以下机制：

- **首页**：不传 cursor；请求需带浏览器侧参数：`outputhtmlfeed=1`、顶层 `pagenum`、`begintime`、`dayspac=5` 等，否则后端可能只返回一页或空。
- **续页**：从上一页响应的 `main.externparam` 中解析 `basetime`、`pagenum`，作为本页的 `begintime` 与顶层 `pagenum` 传入；即 cursor 实为「上页的 externparam」。
- **过滤**：解析后仅保留 **appid=311** 的条目（说说），其它应用类型不返回。
- **是否有下一页**：根据响应中 `hasMoreFeeds` 及 cursor 是否推进判断。

## 指定用户（好友）说说的尝试

在 PC 端 `emotion_cgi_msglist_v6` 被限流（如 -10000）时，获取**好友**的说说只能依赖 feeds3。feeds3 行为：

- **scope=1**：个人说说；仅当 `uin` 为当前登录用户时后端通常有数据，对「好友 uin」常返回空（尤其 bot 账号）。
- **scope=0**：好友动态流；以当前登录号请求时，需带完整翻页参数（见上节）才能稳定拿到多页；翻页需从响应 `main.externparam` 解析 `basetime`/`pagenum` 供下页请求使用。

为尽量支持「指定好友说说」，fallback 时会额外尝试 **scope=0 + uinlist=目标好友**：以当前登录号拉取好友动态并传 `uinlist` 限定只含该好友。若 QQ 空间后端支持该参数过滤，则有机会在限流情况下仍拿到该好友的说说；若不支持，行为与未传 uinlist 一致。**推荐做法**：先拉 scope=0 好友说说流（与 getFriendFeeds 同源、游标翻页），再在内存中按 uin 过滤。

## 评论解析

feeds3 HTML 中的评论嵌在 `<li class="comments-item">` 内，支持多级嵌套结构。

### HTML 结构

#### 一级评论（commentroot）

```html
<li class="comments-item bor3" data-type="commentroot" data-tid="1" data-uin="2849419010" data-nick="go on." data-who="1">
  <div class="comments-item-bd">
    <div class="comments-content">
      <a class="nickname c_tx q_namecard" link="nameCard_2849419010">go on.</a>&nbsp;:&nbsp;评论内容
    </div>
    <div class="comments-op">
      <span class="state c_tx3">14:20</span>
      <a class="reply" data-param="t1_source=1&t1_tid=xxx&t1_uin=xxx&sceneid=xxx">回复</a>
    </div>
  </div>
  <!-- 子评论区域 -->
  <div class="comments-list mod-comments-sub">
    <ul>
      <!-- 二级回复 -->
    </ul>
  </div>
</li>
```

#### 二级回复（replyroot）

二级回复嵌套在一级评论的 `mod-comments-sub` 容器中：

```html
<li class="comments-item bor3" data-type="replyroot" data-tid="1" data-uin="48166892" data-nick="像风一样的速度" data-who="1">
  <div class="comments-content">
    <a class="nickname c_tx q_namecard" link="nameCard_48166892">像风一样的速度</a>
    &nbsp;回复&nbsp;
    <a class="nickname c_tx q_namecard" link="nameCard_2849419010">go on.</a>
    &nbsp;:&nbsp;回复内容
  </div>
  <div class="comments-op">
    <span class="state c_tx3">昨天 15:30</span>
    <a class="reply" data-param="t1_source=1&t1_tid=xxx&t1_uin=xxx&t2_uin=2849419010&t2_tid=1&sceneid=xxx">回复</a>
  </div>
</li>
```

### 属性说明

| 属性 | 说明 |
|------|------|
| `data-type` | `commentroot`=一级评论，`replyroot`=二级回复 |
| `data-tid` | 评论序号（在该帖子内从 1 递增） |
| `data-uin` | 评论者 QQ 号 |
| `data-nick` | 评论者昵称 |

### data-param 参数

回复按钮的 `data-param` 包含评论/回复所需的 API 参数：

| 参数 | 说明 |
|------|------|
| `t1_source` | 来源标识 |
| `t1_tid` | 帖子 TID |
| `t1_uin` | 帖子主人 QQ |
| `t2_uin` | 被回复者 QQ（二级评论） |
| `t2_tid` | 被回复评论的序号（二级评论） |
| `sceneid` | 场景 ID |

### 解析逻辑

```typescript
// 1. 匹配一级评论（data-type="commentroot"）
const rootCommentPat = /<li\s+class="comments-item[^"]*"[^>]*data-type="commentroot"[^>]*>/gi;

// 2. 提取一级评论属性
const rootTid = openTag.match(/data-tid="([^"]*)"/)?.[1];
const rootUin = openTag.match(/data-uin="([^"]*)"/)?.[1];
const rootNick = openTag.match(/data-nick="([^"]*)"/)?.[1];

// 3. 解析嵌套的二级回复（在 mod-comments-sub 容器内）
const subCommentsPat = /<div[^>]*class="[^"]*mod-comments-sub[^"]*"[^>]*>[\s\S]*?<ul>([\s\S]*?)<\/ul>/gi;
const replyPat = /<li\s+class="comments-item[^"]*"[^>]*data-type="replyroot"[^>]*>/gi;

// 4. 提取回复目标昵称
// 模式：<a class="nickname">评论者</a>&nbsp;回复&nbsp;<a class="nickname">目标昵称</a>
const replyToNickname = body.match(
  /<a[^>]*class="[^"]*nickname[^"]*"[^>]*>[^<]*<\/a>(?:&nbsp;|\s)+回复(?:&nbsp;|\s)+<a[^>]*class="[^"]*nickname[^"]*"[^>]*>([^<]+)<\/a>/i
)?.[1];
```

### 返回结构

```typescript
interface Feeds3Comment {
  commentid: string;          // 评论 ID
  uin: string;                // 评论者 QQ
  name: string;               // 评论者昵称
  content: string;            // 评论内容
  createtime: number;         // Unix 时间戳
  is_reply?: boolean;         // 是否为二级评论
  reply_to_uin?: string;      // 回复目标用户 QQ（二级评论）
  reply_to_nickname?: string; // 回复目标用户昵称（二级评论）
  reply_to_comment_id?: string; // 回复目标评论 ID（二级评论）
  parent_comment_id?: string; // 父评论 ID（二级评论所属的一级评论）
  _source: 'feeds3_html';
}
```

### 时间解析

支持多种时间格式：

| 格式 | 示例 | 解析方式 |
|------|------|----------|
| HH:mm | `14:20` | 当天时间 |
| 昨天 HH:mm | `昨天 15:30` | 昨天 |
| 前天 HH:mm | `前天 10:00` | 前天 |
| MM-DD | `03-10` | 今年该日期 |
| MM月DD日 | `3月10日` | 今年该日期 |
| YYYY-MM-DD | `2024-03-10` | 具体日期 |

### 评论回复 API

发布评论/回复使用 `emotion_cgi_re_feeds` 接口：

**URL**: `https://h5.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_re_feeds`

**参数**：

| 参数 | 说明 |
|------|------|
| `topicId` | 格式为 `{ouin}_{tid}__1` |
| `hostUin` | 帖子主人 QQ |
| `uin` | 当前登录用户 QQ |
| `content` | 评论内容 |
| `paramstr` | `1`=一级评论，`2`=回复评论 |
| `commentId` | 被回复评论 ID（h5 抓包参数） |
| `commentUin` | 被回复者 QQ（h5 抓包参数） |
| `t1_uin` | 帖子主人 QQ（feeds3 参数） |
| `t1_tid` | 帖子 TID（feeds3 参数） |
| `t2_uin` | 被回复者 QQ（回复评论时） |
| `t2_tid` | 被回复评论序号（回复评论时） |
| `g_tk` | 安全令牌 |

**重要说明**：

feeds3 解析出的 `commentid` 来自 HTML 的 `data-tid` 属性，是**帖子内的评论序号**（从 1 递增），而非后端数据库的真实评论 ID。

回复评论时，桥接会同时传递：
1. `commentId` / `commentUin`（h5 抓包参数）
2. `t1_uin` / `t1_tid` / `t2_uin` / `t2_tid`（feeds3 文档参数）

服务端可能根据 `t2_tid`（序号）匹配评论，也可能需要真实的后端评论 ID。如果回复失败（如「评论已被删除」），可能是因为：

1. 评论确实已被删除
2. API 需要真实评论 ID 而非序号（此时需通过 PC/mobile 评论 API 获取带真实 ID 的评论列表）

**示例**：

```typescript
// 回复一级评论
const params = {
  topicId: `${postOwnerUin}_${postTid}__1`,
  hostUin: postOwnerUin,
  uin: myUin,
  content: replyContent,
  paramstr: '2',
  commentId: commentTid,        // feeds3 的 data-tid（序号）
  commentUin: commentAuthorUin,
  t1_uin: postOwnerUin,
  t1_tid: postTid,
  t2_uin: commentAuthorUin,     // 被回复者
  t2_tid: commentTid,           // 被回复评论序号
  g_tk: gTk
};

// 发布一级评论
const rootParams = {
  topicId: `${postOwnerUin}_${postTid}__1`,
  hostUin: postOwnerUin,
  uin: myUin,
  content: commentContent,
  paramstr: '1',
  g_tk: gTk
};
```

### 评论回复的限制与兜底策略

当评论来源于 feeds3 HTML 解析时，`commentid` 为帖子内序号，回复可能失败。桥接的兜底策略：

1. **优先使用 PC/mobile 评论 API**：`getCommentsBestEffort` 会先尝试 PC 和 mobile 的评论接口，这些接口返回的 `commentid` 是真实 ID。
2. **feeds3 兜底**：当 PC/mobile 都失败时，才使用 feeds3 解析的评论。
3. **回复失败处理**：如果 feeds3 评论回复失败，建议：
   - 在 QQ 空间网页端手动确认评论是否存在
   - 尝试通过 `getCommentsBestEffort` 重新获取评论列表（可能获得真实 ID）
