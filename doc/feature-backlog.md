# 功能缺口与路线图

> QQ 空间 Web 端主要功能与当前实现的对应关系，以及待逆向并实现的优先级列表。  
> **功能全景**见 [qzone-feature-matrix.md](qzone-feature-matrix.md)；**逆向与实现步骤**见 [reverse-engineering-guide.md](reverse-engineering-guide.md)。

## 功能清单与状态

| 功能 | 当前状态 | 依赖接口 / 实现方式 | 优先级 | 备注 |
|------|----------|---------------------|--------|------|
| 说说列表 | 已实现 | emotion_cgi_msglist_v6 → feeds3_html_more | - | 限流时降级 feeds3 |
| 说说详情 | 已实现 | POST/GET getdetailv6 → mobile → emotion_list | - | 多变体 + winning variant |
| 说说发布/删除 | 已实现 | emotion_cgi_publish_v6 / emotion_cgi_delete_v6 | - | |
| 评论获取 | 已实现 | POST/GET getcmtreply_v6 → mobile | - | |
| 评论发表/删除 | 已实现 | emotion_cgi_re_feeds / emotion_cgi_delcomment_ugc 等 | - | |
| **评论点赞** | 未实现 | 网页端无此入口，可能仅移动端有；若实现需移动端抓包 | P2 | client/action 已预留 like_comment |
| 点赞/取消点赞（说说） | 已实现 | like_cgi_likev6、internal_dolike_app → like optype=1 → mobile | - | |
| 转发说说 | 已实现 | emotion_cgi_forward_v6 → emotion_cgi_re_feeds(forward=1) | - | 可能 -3000 |
| 好友列表 | 已实现 | cgi_get_friend_list → feeds3 提取 → 可选 Playwright | - | |
| 访客列表 | 已实现 | cgi_right_get_visitor_more | - | 无额外降级 |
| 个人资料/陌生人 | 已实现 | cgi_personal_card | - | |
| 好友动态流 | 已实现 | feeds3_html_more | - | |
| 相册列表/照片列表 | 部分 | cgi_list_album → cgi_list_photo / cgi_floatview_photo_list_v2 | - | photo.qzone.qq.com 当前 **HTTP 500**，接口已实现、服务端不可用 |
| 相册创建/删除/删照片 | 部分 | cgi_create_album / cgi_del_album / cgi_del_photo | - | 同上，500 时明确返回失败 |
| 图片上传 | 已实现 | cgi_upload_image (up.qzone.qq.com) | - | |
| 登录/登出/缓存重置 | 已实现 | Cookie 登录、reset_api_caches | - | |
| 路由探测 | 已实现 | probe_api_routes | - | |
| **视频说说** | 已实现 | 在 feeds3 解析 f-ct-video/f-video-wrap，提取 video_url、video_cover、尺寸 | - | get_emotion_list 的 msglist 中带 feed_type/video_* 字段；详情沿用 API 返回 |
| **留言板** | 部分 | 待抓包：个人档留言列表/发表/删除（域名与 cgi） | **P1** | client/action 已预留，见 doc/board-api.md；抓包后补全实现 |
| **日志（博客）** | 未实现 | 待抓包：日志列表/正文/发表/删除（若仍有开放接口） | P2 | |
| **签到** | 未实现 | 待抓包：签到状态/执行签到（若有开放接口） | P2 | |
| **礼物** | 未实现 | 待抓包：送礼/礼物墙（若有开放接口） | P2 | |
| **增强互动** | 未实现 | 表情评论、@ 人等；若仅前端展示可暂不实现 | P2 | 若有独立接口则列入 |

## 优先级说明

- **P0**：与现有说说/评论/点赞强相关的稳定性（Phase 1 已完成）+ 视频说说解析（在现有 feeds3/详情中解析即可）。
- **P1**：留言板（抓包后即可按 [reverse-engineering-guide.md](reverse-engineering-guide.md) 实现）。
- **P2**：评论点赞（网页端无入口，可能仅移动端支持，需移动端抓包）。
- **P2**：日志、签到、礼物、增强互动（按产品使用频率与接口可用性再细排）。

## 执行顺序建议

1. **P0**：视频说说解析（Phase 3 首项，已完成）。
2. **P1**：留言板（抓包 → 文档 → client + action + 降级 + 测试 + 更新 [qzone-feature-matrix.md](qzone-feature-matrix.md) 与本表）。
3. **P2**：评论点赞（若移动端有入口，在移动端抓包后实现）；日志、签到、礼物、增强互动；按 [qzone-feature-matrix.md](qzone-feature-matrix.md) 逐项逆向、实现、降级、测试、更新文档。

每完成一项，在 [qzone-feature-matrix.md](qzone-feature-matrix.md) 与本表中将状态更新为「已实现」，并更新 [compatibility-matrix.md](compatibility-matrix.md)、[fallback-strategy.md](fallback-strategy.md) 与 README。
