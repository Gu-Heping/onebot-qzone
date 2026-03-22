# 文档列出的接口 — 实机探测结果

以下结果来自 **`npm run probe:doc`**（`scripts/probe-doc-endpoints.ts`），在 **2026-03-22** 使用仓库内有效 Cookie 对 **单账号** 探测。腾讯侧策略随时可能变，结论仅作「当前环境快照」。

## 探测输出（原始摘要）

| HTTP | 体长 | 接口（文档名） | 摘要 |
|------|------|----------------|------|
| 200 | ~605 | `emotion_cgi_msglist_v6` GET | JSONP，`code=-10000`，文案「使用人数过多，请稍后再试」 |
| 404 | 0 | `mobile.qzone.qq.com/get_mood_list` | 空体 |
| 200 | ~78k | `feeds3_html_more` GET（精简参数） | 大块 HTML/内嵌数据（非单一 `code` JSON） |
| 500 | 0 | `emotion_cgi_getdetailv6` POST | 空体 |
| 500 | 0 | `emotion_cgi_getdetailv6` GET（基础 query） | 空体 |
| 404 | 0 | `mobile.qzone.qq.com/detail` | 空体 |
| 200 | ~108 | `emotion_cgi_getcmtreply_v6` GET（最小 query） | `code=-3` 参数错误 |
| 404 | 0 | `mobile.qzone.qq.com/get_comment_list` | 空体 |
| 500 | 0 | `get_like_list` GET | 空体 |
| 404 | 0 | `mobile.qzone.qq.com/like` POST（空体探活） | 空体 |
| 200 | ~745 | `h5.qzone.qq.com/.../emotion_cgi_re_feeds` GET（无业务参数） | `code=1034` 非法请求（路由可达） |
| 200 | ~324 | `cgi_personal_card` GET | 小体积 JSON/JSONP（与 `verify:readonly` 中 user_info 通过一致） |
| 403 | 0 | `mobile.qzone.qq.com/list` | 空体 |

## 与当前客户端实现的对照

| 能力 | 文档常见说法 | 实机 + 代码现状 |
|------|----------------|-----------------|
| 说说列表 | PC `msglist_v6` 为主，限流时 feeds3 | **客户端已只走 `feeds3_html_more` 解析**；本次 `msglist_v6` 虽 200 但业务 `-10000`，与「限流」描述一致。 |
| 说说详情 | PC 多变体 + mobile detail | **PC POST/GET 500 空体；mobile 404**；`getShuoshuoDetail` 依赖列表匹配等兜底（见 `client.ts`）。 |
| 评论列表 | PC `getcmtreply_v6` + mobile | **最小 GET 为 -3；mobile 404**；`getCommentsBestEffort` **仅 feeds3 HTML**，不依赖上述 HTTP JSON。 |
| 点赞列表 | `get_like_list` 等 | **本次 GET 500 空体**；`getLikeListBestEffort` **仅 feeds3**。 |
| 移动端 mood / like / comment | 部分文档标为备选 | **本次均为 404 或 403（list）**，不宜再标为可靠 fallback。 |

## 如何复现

```bash
export QZONE_COOKIE='...'   # 或使用项目根目录 .env
npm run probe:doc
```

（脚本会先 `getEmotionList` 取一条 `tid`，再探测依赖 tid 的 URL。）
