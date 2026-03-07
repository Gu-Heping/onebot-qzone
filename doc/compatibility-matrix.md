# 接口可用性矩阵与常见业务码

> 基于 2026-02 实测结论，可用性与账号状态、网络环境、风控策略相关。

## 接口可用性矩阵

### 核心数据接口

| 端点/功能 | 方法 | 域名 | 状态 | 备注 |
|-----------|------|------|------|------|
| `feeds3_html_more` | GET | ic2.qzone.qq.com | ✅ 可靠 | 主要数据源，HTML 解析 |
| `emotion_cgi_msglist_v6` | GET | taotao.qzone.qq.com | ⚠️ 可能限流 | `-10000` 时降级 feeds3 |
| `emotion_cgi_getdetailv6` | POST | taotao.qzone.qq.com | ⚠️ GET空/POST可用 | POST 优先策略 |
| `emotion_cgi_getcmtreply_v6` | POST/GET | taotao.qzone.qq.com | ⚠️ GET空/POST可用 | POST 优先策略 |

### 写操作接口

| 端点/功能 | 方法 | 域名 | 状态 | 备注 |
|-----------|------|------|------|------|
| `emotion_cgi_publish_v6` | POST | taotao.qzone.qq.com | ✅ 可靠 | 发布说说 |
| `emotion_cgi_delete_v6` | POST | taotao.qzone.qq.com | ✅ 可靠 | 删除说说 |
| `emotion_cgi_re_feeds` | POST | taotao.qzone.qq.com | ✅ 可靠 | 评论/转发说说 |
| `like_cgi_likev6` | POST | taotao.qzone.qq.com | ✅ 可靠 | 点赞 |
| `internal_dolike_app` | POST | w.qzone.qq.com | ✅ 可靠 | 取消点赞 |
| `emotion_cgi_forward_v6` | POST | taotao.qzone.qq.com | ⚠️ -3000 | 转发可能失败 |
| `cgi_upload_image` | POST | up.qzone.qq.com | ✅ 可靠 | 图片上传 |

### 用户/社交信息接口

| 端点/功能 | 方法 | 域名 | 状态 | 备注 |
|-----------|------|------|------|------|
| `cgi_get_friend_list` | GET | r.qzone.qq.com | ✅ 可用 | 好友列表 |
| `cgi_right_get_visitor_more` | GET | g.qzone.qq.com | ✅ 可用 | 访客列表 |
| `cgi_personal_card` | GET | r.qzone.qq.com | ✅ 可用 | 用户资料 |

### 相册/照片接口

| 端点/功能 | 方法 | 域名 | 状态 | 备注 |
|-----------|------|------|------|------|
| `cgi_list_album` | GET | photo.qzone.qq.com | ❌ 500 | 服务端完全不可用 |
| `cgi_list_photo` | GET | photo.qzone.qq.com | ❌ 500 | 服务端完全不可用 |
| `cgi_floatview_photo_list_v2` | GET | photo.qzone.qq.com | ❌ 500 | 服务端完全不可用 |
| `cgi_create_album` | POST | photo.qzone.qq.com | ❌ 500 | 服务端完全不可用 |
| `cgi_del_album` | POST | photo.qzone.qq.com | ❌ 500 | 服务端完全不可用 |
| `cgi_del_photo` | POST | photo.qzone.qq.com | ❌ 500 | 服务端完全不可用 |

### 移动端接口

| 端点/功能 | 方法 | 域名 | 状态 | 备注 |
|-----------|------|------|------|------|
| `mobile.qzone.qq.com/detail` | GET | 直连 | ❌ 0字节 | 不可用 |
| `mobile.qzone.qq.com/like` | POST | 直连 | ❌ 404 | 不可用 |
| `mobile.qzone.qq.com/list` | GET | 直连 | ⚠️ -4003 | 业务受限 |
| `mobile.qzone.qq.com/get_mood_list` | GET | 直连 | ❌ 404 | 不可用 |
| `mobile.qzone.qq.com/get_comment_list` | GET | 直连 | ⚠️ 不稳定 | 备选 |
| `mobile.qzone.qq.com/del_comment` | POST | 直连 | ⚠️ 不稳定 | 备选 |

### 登录接口

| 端点/功能 | 方法 | 域名 | 状态 | 备注 |
|-----------|------|------|------|------|
| `ptqrshow`（二维码图片） | GET | ssl.ptlogin2.qq.com | ✅ 可用 | |
| `ptqrlogin`（扫码轮询） | GET | ssl.ptlogin2.qq.com | ⚠️ 可能 403 | IP/设备风控 |
| Cookie 字符串登录 | - | - | ✅ 最可靠 | 推荐方式 |

---

## 常见业务码

### 通用业务码

| 业务码 | 含义 | 处理方式 |
|--------|------|---------|
| `0` | 成功 | - |
| `-3` | 认证失败/权限不足 | 检查 Cookie 有效性 |
| `-100` | 认证失败 | 检查 Cookie 有效性 |
| `-3000` | 认证失败/接口限制 | 检查 Cookie 有效性 |
| `-10000` | 限流 | 降级到 feeds3 |
| `-10001` | 认证失败 | 检查 Cookie 有效性 |
| `-10004` | 参数错误/接口已废弃 | 使用替代接口 |
| `-10006` | 认证失败 | 检查 Cookie 有效性 |
| `-4003` | 移动端业务受限 | 改用 PC 端接口 |

### 认证失败码集合

以下业务码统一视为 Cookie 过期/无效：

```typescript
const AUTH_FAIL_CODES = new Set([-3, -100, -3000, -10001, -10006]);
```

检测到认证失败后：
- 输出警告日志
- 事件轮询器进入 120 秒退避
- 建议用户重新登录

### HTTP 状态码

| HTTP 码 | 含义 | 场景 |
|---------|------|------|
| 200 | 成功 | 正常响应（但 body 可能为空！） |
| 403 | 被拒绝 | ptqrlogin 风控拦截 |
| 404 | 不存在 | 移动端接口不可用 |
| 500 | 服务器错误 | photo.qzone.qq.com 全系列 |

> ⚠️ **特别注意**: HTTP 200 + 空 body 是常见的失败模式，不能仅靠 HTTP 状态码判断成功。

---

## PC 端 vs 移动端对比

| 特性 | PC 端 API | 移动端 API |
|------|-----------|-----------|
| 基础 URL | `user.qzone.qq.com/proxy/...` | `mobile.qzone.qq.com` |
| 需要 qzonetoken | 部分 GET 接口需要 | 否 |
| 响应格式 | JSONP（需解析） | JSON |
| POST 成功率 | ✅ 高 | ❌ 低 |
| GET 成功率 | ⚠️ 不稳定 | ❌ 低 |
| 功能完整性 | 完整 | 基础 |
| 推荐策略 | 主用 | 仅作 fallback |

详情/评论/删评这 3 类接口在当前实现中默认走 PC 端 proxy 路由，移动端路由作为探测备选。路由可通过 `probeApiRoutes()` 自动探测。

---

## 已废弃/不可用接口

| 接口 | 替代方案 |
|------|---------|
| `emotion_cgi_getlist_v6` | 使用 `emotion_cgi_msglist_v6` |
| `emotion_cgi_addcomment_ugc` | 使用 `emotion_cgi_re_feeds` |
| `fcg_list_album` | 使用 `cgi_list_album`（虽然也返回 500） |
