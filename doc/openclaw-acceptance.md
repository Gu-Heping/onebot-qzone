# OpenClaw 联调与验收说明（2026-03）

本文档总结 **onebot-qzone** 与 **openclaw-napcat-qq** 联调经验、常见误判与运维要点，供回归验收与 Cursor 排障使用。

## 架构关系

| 组件 | 路径/职责 |
|------|-----------|
| **桥接** | `POST /get_comment_list`、`/fetch_image`、`/get_msg`、`/get_feeds_html_act_all` 等 |
| **OpenClaw 插件** | `openclaw-napcat-qq`：`qzone_get_comments` 等工具内部调桥接 HTTP |

插件层**不得**把桥接 JSON 压成纯文本时丢掉 `commentListSource`、`pic`、`feeds3_comment_total`；当前实现已在文本首段输出 **「【评论接口元数据】」**、每条 ** `pic_len=`**，并支持 **`raw_json=true`**。

## 说说列表 vs 混合动态（Agent 路由）

| 用户意图（自然语言） | 插件工具（与桥接） | 说明 |
|---------------------|-------------------|------|
| 本人/他人 **纯说说时间线** | `qzone_get_posts` → `get_emotion_list` / feeds3 | 与 ic2 混合流 **不是同一数据源**；条数少于网页时，先确认是否**只拉了本工具**而未拉混合流。 |
| 本人空间 **混合动态**（说说+分享+音乐等） | `qzone_get_space_html_act_feed` / `qzone_get_user_act_feed` → `get_feeds_html_act_all` | 分页为 **start/count**，勿与 `qzone_get_posts` 的 offset/cursor 交叉续翻。 |
| **好友圈混排** | `qzone_get_friend_feeds` → `get_friend_feeds` | 分页为 **cursor**；**不能**用来枚举「我有哪些说说」。 |

模型侧路由与分页句已写入各工具 **description**（`openclaw-napcat-qq` `qzone.ts`）；本文档供人类验收与排障。

## 读路径验收要点

| 项 | 说明 |
|----|------|
| 评论来源 | `data.commentListSource` 或 `comment_data_source`；`feeds3` / `feeds3_cache` 均正常 |
| 评论总数提示 | `feeds3_comment_total` / `commentListTotal` |
| 评论图 | 每条 **`pic` 为数组**（无图为 `[]`）；含图时为 `qpic` / `photo.store` 完整 URL |
| 预览评论图 | **勿**在浏览器地址栏裸开 `qpic`（缺 Cookie/Referer、截断即失效）；用桥 **`fetch_image`** 或插件 **`qzone_fetch_image`**（`raw_json` 取完整 `pic[0]`） |
| 说说详情 | PC 详情失败时 **`message` 含 `success (from act_all list)`** 类兜底为预期行为之一 |
| 三种「评论数」 | 列表 **`cmtnum`**、`traffic.comment`、`get_comments` 展开条数 **不要求相等**，见 [`feeds3-parser.md`](feeds3-parser.md) |
| 点赞列表 vs 计数 | **`get_likes` 可能为空** 而 **`traffic.like > 0`**：点赞列表依赖 feeds3 解析范围，与官方计数不对齐，**非硬回归** |
| 转发与串帖 | **`rt_tid`** 指向被转原帖；转发附言出现在原帖评论区为 **QQ 空间产品行为**，不等于串帖 |

### R1（qzone_get_posts）补充

- 通过「≥1 条」仅说明接口可用；建议同时看 **`_page_info`**（如 `full_fetched_len`、`pages_fetched`、`next_page_uses_cursor`）。
- **续页抽检**：当 `has_more` 为真且 `_meta` 要求 **cursor** 续翻时，应用 **`cursor=上一段 next_cursor` 且 `offset=0`** 再调一次，确认非空或确认已到末页；勿只递增 **offset**（易在缓冲耗尽时出现「没有找到说说」）。
- 若 **混合流**（`qzone_get_space_html_act_feed` 等）条数明显多于 **说说列表**，多为 **工具选型** 差异，未必是解析回归。

## 写路径验收

- 自动化发评/点赞前应由用户明确授权（例如消息中含 **`【允许写验收】`**）。
- 测试评论建议带可识别前缀（如 **`【验收-可删】`**），验收后 **`qzone_delete_comment`** 清理。

## 运维：使改动生效

| 改动位置 | 操作 |
|----------|------|
| **onebot-qzone** | `npm run build`；`systemctl --user restart onebot-qzone`（若 stop 卡在 SIGTERM，对旧 `node dist/main.js` **`kill -KILL`** 后再 `start`） |
| **openclaw-napcat-qq** | 插件目录 `npm run build`；**`systemctl --user restart openclaw-gateway`**（仅重启桥不会加载新插件） |

## 防回归命令（桥接仓库）

```bash
npm run typecheck
npx tsx -e "import { run } from './test/unit/feeds3-comments.test.ts'; run().then(console.log)"
npm run verify:http    # 需桥已启动
```

## 相关文档

- [`feeds3-parser.md`](feeds3-parser.md)：评论数口径、`qpic`、联测建议表  
- [`api-probe-results.md`](api-probe-results.md)：PC/mobile 端点实机探测  
- [`fallback-strategy.md`](fallback-strategy.md)：降级链路与 feeds3 主路径说明  
