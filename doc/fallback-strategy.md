# 多级降级策略与容错机制

> **当前实现状态（2026-10）**：路径已收敛为 **feeds3-first**（评论/点赞为 feeds3-only）。下文 PC/mobile 链路仅作历史参考与写操作说明。

## 降级链路总览（当前代码）

```
说说列表:  feeds3_html_more (HTML 解析，唯一主链路)
说说详情:  getdetailv6 多变体 → feeds3 列表匹配 → feeds_html_act_all 兜底
评论获取:  feeds3 缓存 → 好友动态 HTML → 作者空间 scope=1 → feeds_html_act_all 分页
评论回复:  emotion_cgi_re_feeds（user 代理 → h5 代理），回复时同时传 commentId/commentUin + t1_*/t2_*
点赞列表:  feeds3 HTML 点赞详情；缺失部分用 qz_opcnt2 计数补充
图片提取:  feeds3 HTML <img> 标签提取（详情 API 仅兜底）
取消点赞:  internal_dolike_app → like_cgi_likev6 (optype=1) → mobile like (active=1)
转发说说:  emotion_cgi_forward_v6 → emotion_cgi_re_feeds (forward=1)
相册列表:  cgi_list_album → cgi_list_photo
```

feeds3 解析逻辑位于 `src/qzone/feeds3/`。历史探测结论见 [`api-probe-results.md`](api-probe-results.md) 与 [`compatibility-matrix.md`](compatibility-matrix.md)。

## 评论回复的特殊说明

评论回复使用 `emotion_cgi_re_feeds` 接口（h5.qzone.qq.com 域），需要特别注意：

### 参数传递

回复评论时，桥接同时传递两组参数：

| 参数组 | 参数名 | 说明 |
|--------|--------|------|
| h5 抓包参数 | `commentId`, `commentUin` | 来自浏览器开发者工具抓包 |
| feeds3 文档参数 | `t1_uin`, `t1_tid`, `t2_uin`, `t2_tid` | 来自 feeds3 HTML 的 data-param；`t1_tid` 可为 16+ 位 hex，或 `d{uin}_{时间戳}_…` 等**含下划线的复合串**（解析时需整段保留，不可在首段下划线处截断） |

### 评论 ID 来源问题

feeds3 HTML 解析出的 `commentid` 是 `data-tid` 属性值，即**帖子内的评论序号**（从 1 递增），而非后端数据库的真实评论 ID。

| 评论来源 | commentid 含义 | 当前状态 |
|----------|---------------|----------|
| PC API (`getcmtreply_v6`) | 真实评论 ID | 实机多为 `-3`/空体，**不再调用** |
| Mobile API (`get_comment_list`) | 真实评论 ID | 404/不稳定，**不再调用** |
| feeds3 HTML 解析 | 帖子内序号 | 当前唯一来源；回复时可能失败 |

### 推荐策略

1. **许多环境下 PC/mobile 评论接口不可用**（空包、风控、参数不匹配），`getCommentsBestEffort` 实际以 **feeds3 HTML 解析**为主路径。
2. **去重**：feeds3 的 `data-tid` 常为帖内短序号（1、2、3），不能当全局稳定键；bridge 在 poller 内对短数字用 **内容指纹**（`commentDedup.ts`），对长数字 / 含 `_r_` 的合成 id 仍用 `id:tid:…`。解析会为每条评论写入 `_feeds3_seq` → 归一化字段 `feeds3ParseSeq`；当 `createtime` 无法从 HTML 得到（为 0）时，指纹哈希会并入该序号，避免同帖同文同 uin 的多条评论撞键。
3. **回复失败时**：若回复接口要求「真实评论 ID」而当前仅有 feeds3 序号，需抓包或换可用数据源后再试。

## 各接口的降级细节

### 说说列表

**当前实现**：只走 `feeds3_html_more` (GET, HTML 解析)，`emotion_cgi_msglist_v6` 已不再作为主链路。

- 通过 `parseFeeds3Items` 解析 HTML 片段
- 支持 `pos` 参数模拟分页（取前 `pos + num` 条后切片）
- **指定用户（好友）说说**：feeds3 依次尝试：
  1. `scope=1`、`uin=目标`（个人说说模式，bot 账号下对好友常返回空）
  2. `scope=0`、`uin=当前登录号`、`uinlist=目标`（好友动态流限定为该好友，若后端支持 uinlist 过滤则可能拿到数据）
  3. `scope=0`、`uin=目标`（再按 uin 过滤，bot 下 scope=0 也常为空）

### 说说详情

**当前实现**：先尝试详情 API，失败后从 feeds3 列表匹配，再未命中则走 `feeds_html_act_all`。

1. **POST/GET getdetailv6**（多变体 + winning variant；实测多已失败）
2. **feeds3 列表匹配**：按 tid 从已拉取列表/缓存中查找
3. **`feeds_html_act_all` 兜底**：返回中常见 `success (from act_all list)` 类 `message`
4. **mobile detail**：历史路径，通常 404，仅作最后兜底

### 评论获取

**当前实现（与实机一致）**：**`getCommentsBestEffort`** 仅从 **feeds3** 侧取数——拉取 **`feeds3_html_more`**（好友流 / 作者 `scope=1`）解析评论桶；未命中时 **`feeds_html_act_all` 分页**直至命中或无可翻。结果带 **`_source`：`feeds3` / `feeds3_cache`**，并在 HTTP 层镜像 **`commentListSource`、`feeds3_comment_total`** 等字段。

历史上曾规划的 **POST/GET `getcmtreply_v6`、mobile `get_comment_list`** 在探针账号上多为空体/404/参数错误，**不作为主路径**；若日后腾讯恢复可用，可再接回多变体轮询（参见下文 Winning Variant 与冷却表）。

**点赞列表 `get_like_list`**：同样以 **feeds3 解析**为主，**可能与 `qz_opcnt2` 的 `traffic.like` 不一致**（列表只反映当前 HTML 能展开到的点赞人）。

### 取消点赞

共 3 级降级：

1. **internal_dolike_app** (w.qzone.qq.com): 表单沿用 `active=0`，成功判断 `ret/code === 0`
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
- POST 成功时设为 `-1`（表示 POST 路径成功）
- 缓存重置时清零

## 冷却/退避机制

| 缓存项 | 冷却时长 | 说明 |
|--------|---------|------|
| `detailAllFailTime` | 5 分钟 | PC 详情 API 全部失败后跳过 PC 直接走 feeds3/列表 |
| `qzonetokenFailTime` | 10 分钟 | qzonetoken 获取失败后不再重试 |
| `playwrightFailTime` | 30 分钟 | Playwright 提取失败后的冷却 |

## feeds3 缓存

| 属性 | 值 | 说明 |
|------|-----|------|
| TTL | 30 秒 | 每个 uin 的缓存过期时间 |
| 上限 | 50 条目 | 超出后淘汰最旧的 uin 缓存 |
| Key | 请求参数组合 | 按 uin/scope/count/externparam 等参数缓存 |

## 容错原则

1. **每个降级级别独立 try/catch**: 单个变体/接口失败不中断整个链路
2. **POST 优先于 GET**: taotao proxy 下 POST 成功率显著高于 GET
3. **feeds3 优先**: 列表/评论/点赞以 feeds3 HTML 为主；PC 用于写操作与详情，Mobile 仅作兜底
4. **计数保护**: feeds3 缓存、跟踪字典、seen 集合等都有上限控制
5. **认证失败检测**: 业务码 -3, -100, -3000, -10001, -10006 统一检测并触发退避
6. **请求指纹随机化**: User-Agent、Accept-Language 随机化，轮询间隔添加 ±20% jitter

## 请求指纹随机化（风控对抗）

为防止被识别为机器人/爬虫，系统实现了多层请求指纹随机化：

### User-Agent 随机化

从 8 个常见浏览器 UA 中随机选择：
- Chrome Windows (4 个版本)
- Chrome macOS (2 个版本)
- Edge Windows (2 个版本)

### Accept-Language 随机化

从 5 种中文语言偏好中随机选择：
- `zh-CN,zh;q=0.9,en;q=0.8`
- `zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7`
- `zh-CN,zh-TW;q=0.9,zh;q=0.8,en;q=0.7`
- `zh;q=0.9,en;q=0.8`
- `en-US,en;q=0.9,zh-CN;q=0.8`

### 轮询间隔抖动 (Jitter)

所有轮询定时器添加 ±20% 随机抖动：
- 主轮询：`interval * (0.8 ~ 1.2)`
- 评论轮询：`interval * (0.8 ~ 1.2)`
- 点赞轮询：`interval * (0.8 ~ 1.2)`
- 好友动态轮询：`interval * (0.8 ~ 1.2)`

**效果**：避免固定时间间隔的请求模式，更接近真人浏览行为的不规律性。

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
