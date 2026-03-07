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
| `uinlist` | 空 | UIN 列表 |
| `gid` | 空 | 分组 ID |
| `flag` | `1` | 标识 |
| `filter` | `all` | 过滤器 |
| `applist` | `all` | 应用列表 |
| `refresh` | `1` | 强制刷新 |
| `aisession` | 空 | AI 会话 |
| `icServerTime` | `0` | 服务器时间 |
| `alive498` | `0` | 存活标识 |
| `sorttype` | `0` | 排序类型 |
| `g_tk` | 计算值 | 安全令牌 |
| `format` | `json` | 响应格式 |

## 响应格式

返回 JSON，其中包含 HTML 片段字段，HTML 中的特殊字符经过以下转义：

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

### 图片提取

```typescript
const blockDecoded = htmlUnescape(block);
const images: string[] = [];
for (const im of blockDecoded.matchAll(/<img[^>]+src="([^"]+)"/gi)) {
  const src = im[1];
  if (src.includes('qpic.cn') || /\.(jpg|jpeg|png|gif|webp)$/.test(src)) {
    images.push(src);
  }
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
  _source: 'feeds3'     // 数据来源标记
}
```

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
