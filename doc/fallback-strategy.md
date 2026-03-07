# 多级降级策略与容错机制

## 降级链路总览

```
说说列表:  emotion_cgi_msglist_v6 → feeds3_html_more (HTML 解析)
说说详情:  POST getdetailv6 → GET getdetailv6 (5变体) → mobile detail → emotion_list (feeds3)
评论获取:  POST getcmtreply_v6 → GET getcmtreply_v6 (10+变体) → mobile get_comment_list
图片提取:  detail API → feeds3 HTML <img> 标签提取
取消点赞:  internal_dolike_app → like_cgi_likev6 (optype=1) → mobile like (active=1)
转发说说:  emotion_cgi_forward_v6 → emotion_cgi_re_feeds (forward=1)
相册列表:  cgi_list_album → cgi_list_photo
```

## 各接口的降级细节

### 说说列表

1. **主用**: `emotion_cgi_msglist_v6` (GET, JSONP)
2. **降级触发**: `code: -10000`（限流）或请求异常
3. **降级**: `feeds3_html_more` (GET, HTML 解析)
   - 通过 `parseFeeds3Items` 解析 HTML 片段
   - 支持 `pos` 参数模拟分页（取前 `pos + num` 条后切片）

### 说说详情

共 4 级降级：

1. **POST getdetailv6**: 最优先，POST 请求成功率最高
2. **GET getdetailv6 (5 个参数变体)**: 遍历不同 qzonetoken/hostuin/qzreferrer 组合
   - 记忆上次成功变体（winning variant），下次优先尝试
   - 全部失败后设 5 分钟冷却期
3. **mobile detail**: 移动端 API fallback
4. **emotion_list**: 从说说列表中按 tid 匹配查找

### 评论获取

共 3 级降级：

1. **POST getcmtreply_v6**: POST 优先
2. **GET getcmtreply_v6 (10+ 个参数变体)**: 排列组合 t1_source, hostuin, qzreferrer, qzonetoken
   - 同样有 winning variant 记忆机制
   - 全部失败后 5 分钟冷却
3. **mobile get_comment_list**: 移动端 fallback

`getCommentsBestEffort` 还在此基础上增加了 `t1_source` 参数变化的额外层次。

### 取消点赞

共 3 级降级：

1. **internal_dolike_app** (w.qzone.qq.com): `active=0` 取消，最可靠
2. **like_cgi_likev6** (taotao.qzone.qq.com): `optype=1` 取消
3. **mobile like**: `active=1` 取消（通常不可用）

## Winning Variant 机制

为了避免每次调用都遍历所有参数变体，系统会记忆上次成功的变体索引：

```typescript
// 记忆
if (isValidApiResponse(payload)) {
  this.detailWinningVariant = index;
  return payload;
}

// 下次调用时优先尝试
const order = [...Array(variants.length).keys()];
if (this.detailWinningVariant !== null) {
  const idx = order.indexOf(this.detailWinningVariant);
  if (idx !== -1) {
    order.splice(idx, 1);
    order.unshift(this.detailWinningVariant);
  }
}
```

- `detailWinningVariant`: 说说详情的成功变体索引
- `commentsWinningVariant`: 评论获取的成功变体索引
- POST 成功时设为 `-1`（表示 POST 路径成功）
- 缓存重置时清零

## 冷却/退避机制

| 缓存项 | 冷却时长 | 说明 |
|--------|---------|------|
| `commentsAllFailTime` | 5 分钟 | PC 评论 API 全部失败后跳过 PC 直接走 mobile |
| `detailAllFailTime` | 5 分钟 | PC 详情 API 全部失败后跳过 PC 直接走 mobile |
| `qzonetokenFailTime` | 10 分钟 | qzonetoken 获取失败后不再重试 |
| `playwrightFailTime` | 30 分钟 | Playwright 提取失败后的冷却 |

## feeds3 缓存

| 属性 | 值 | 说明 |
|------|-----|------|
| TTL | 30 秒 | 每个 uin 的缓存过期时间 |
| 上限 | 50 条目 | 超出后淘汰最旧的 uin 缓存 |
| Key | uin | 按用户 QQ 号缓存 |

## 容错原则

1. **每个降级级别独立 try/catch**: 单个变体/接口失败不中断整个链路
2. **POST 优先于 GET**: taotao proxy 下 POST 成功率显著高于 GET
3. **PC 优先于 Mobile**: PC 端功能更完整，Mobile 仅作兜底
4. **计数保护**: feeds3 缓存、跟踪字典、seen 集合等都有上限控制
5. **认证失败检测**: 业务码 -3, -100, -3000, -10001, -10006 统一检测并触发退避

## API 有效性判断

```typescript
private isValidApiResponse(payload: ApiResponse): boolean {
  if (payload['_empty']) return false;                     // 空响应
  if (payload['http_status'] >= 400) return false;        // HTTP 错误
  if (payload['code'] !== undefined && payload['code'] !== 0) return false;  // 业务错误
  return true;
}
```

## 缓存重置

`resetApiCaches()` 方法一次清除所有运行时缓存：

- qzonetoken 缓存及时间戳
- Playwright 冷却时间
- Winning variant 记忆
- 全失败冷却时间
- feeds3 HTML 缓存
