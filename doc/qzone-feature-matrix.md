# QQ 空间功能全景表

> 本表列出 QQ 空间 Web/移动端常见功能与当前 bridge 实现状态，用于「逆向直到实现所有功能」的路线图。  
> 实现流程见 [逆向与实现指南](reverse-engineering-guide.md)。

## 图例

| 状态 | 含义 |
|------|------|
| ✅ 已实现 | 有 client 方法 + bridge action，有测试/降级 |
| 🟡 部分 | 接口已实现但服务不可用（如 500）或仅部分场景可用 |
| ⏳ 待抓包 | 需在浏览器中抓包获得 URL/参数后再实现 |
| ❌ 未实现 | 未开工，或已知无开放接口 |

---

## 一、说说（动态）

| 功能 | 状态 | 接口/实现 | 备注 |
|------|------|-----------|------|
| 说说列表 | ✅ | emotion_cgi_msglist_v6 → feeds3 fallback | 限流时降级 feeds3 |
| 说说详情 | ✅ | getdetailv6 多变体 + mobile | winning variant 记忆 |
| 发布说说 | ✅ | emotion_cgi_publish_v6 | 支持图片 |
| 删除说说 | ✅ | emotion_cgi_delete_v6 | |
| 转发说说 | ✅ | emotion_cgi_forward_v6 → re_feeds(forward=1) | |
| 视频说说解析 | ✅ | feeds3 中 f-ct-video / 详情 | feed_type / video_url 等 |
| **发说说时 @ 人** | ✅ 已实现 | `con` 内嵌 `@{uin:QQ号,nick:昵称}`，publish 原样传递 | 见 emotion-api.md §3 |

## 二、评论

| 功能 | 状态 | 接口/实现 | 备注 |
|------|------|-----------|------|
| 获取评论列表 | ✅ | getcmtreply_v6 多变体 → mobile | |
| 发表评论 | ✅ | emotion_cgi_re_feeds | 含回复评论 commentId/replyUin |
| 删除评论 | ✅ | emotion_cgi_delcomment_ugc / mobile del_comment | |
| **评论点赞** | ❌ 未实现 | 网页端无入口，可能仅移动端支持；若需实现需在移动端抓包 | 见 social-api.md §6 |

## 三、点赞（说说）

| 功能 | 状态 | 接口/实现 | 备注 |
|------|------|-----------|------|
| 点赞说说 | ✅ | like_cgi_likev6 / internal_dolike_app | |
| 取消点赞 | ✅ | internal_dolike_app(active=0) 等 | |
| 点赞列表 | ✅ | like_cgi_getlikev2 等 | get_like_list |

## 四、社交与用户

| 功能 | 状态 | 接口/实现 | 备注 |
|------|------|-----------|------|
| 好友列表 | ✅ | cgi_get_friend_list + feeds3 提取 + 可选 Playwright | |
| 访客列表 | ✅ | cgi_right_get_visitor_more | |
| 个人资料/陌生人 | ✅ | cgi_personal_card | get_stranger_info |
| 好友说说流（游标分页） | ✅ | feeds3_html_more scope=0 | get_friend_feeds（cursor/next_cursor） |

## 五、相册与图片

| 功能 | 状态 | 接口/实现 | 备注 |
|------|------|-----------|------|
| 相册列表 | 🟡 | cgi_list_album | photo 域当前 500 |
| 照片列表 | 🟡 | cgi_list_photo / cgi_floatview_photo_list_v2 | 同上 |
| 创建/删除相册 | 🟡 | cgi_create_album / cgi_del_album | 同上 |
| 删除照片 | 🟡 | cgi_del_photo | 同上 |
| 图片上传 | ✅ | cgi_upload_image (up.qzone.qq.com) | |

## 六、留言板

| 功能 | 状态 | 接口/实现 | 备注 |
|------|------|-----------|------|
| 留言列表 | ⏳ 待抓包 | 待抓包 | board-api.md 占位 |
| 发表留言 | ⏳ 待抓包 | 待抓包 | |
| 删除留言 | ⏳ 待抓包 | 待抓包 | |

## 七、日志（博客）

| 功能 | 状态 | 接口/实现 | 备注 |
|------|------|-----------|------|
| 日志列表 | ❌ | 待抓包 | 若仍有开放接口 |
| 日志正文 | ❌ | 待抓包 | |
| 发表/删除日志 | ❌ | 待抓包 | |

## 八、其他

| 功能 | 状态 | 接口/实现 | 备注 |
|------|------|-----------|------|
| 签到 | ❌ | 待抓包 | 签到状态/执行签到 |
| 礼物/送礼 | ❌ | 待抓包 | 送礼、礼物墙 |
| 表情评论 / @ 人 | ❌ | 待抓包 | 增强互动，若有独立 cgi |
| 消息/私信 | ❌ | 待确认 | 空间消息中心是否开放 |
| 空间装扮 | ❌ | 通常不纳入 bridge | 可选 P3 |

---

## 执行顺序建议（按优先级）

1. **P1**：留言板（抓包 → 文档 → 实现）；**评论点赞**（抓包 → 文档 → 实现）。
2. **P2**：日志、签到、礼物、表情评论（逐项抓包后实现）。
3. **P3**：相册服务恢复后补全 500 相关；其他小众功能按需。

每完成一项：更新本表状态、[feature-backlog.md](feature-backlog.md)、[compatibility-matrix.md](compatibility-matrix.md)，并在 [reverse-engineering-guide.md](reverse-engineering-guide.md) 中补充本次抓包要点（可选）。
