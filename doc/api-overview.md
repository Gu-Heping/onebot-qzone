# QQ空间 API 总览

## 域名体系

QQ 空间 Web API 主要通过 Nginx 反向代理（proxy 域名）进行访问，部分接口也可通过移动端域名直连。

### PC 端 proxy 域名

| 代理路径前缀 | 实际后端域名 | 用途 |
|-------------|-------------|------|
| `user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/` | taotao.qzone.qq.com | 说说相关（发布/删除/评论/点赞/详情） |
| `user.qzone.qq.com/proxy/domain/taotao.qq.com/` | taotao.qq.com | 说说列表（注意与上面域名不同！） |
| `user.qzone.qq.com/proxy/domain/ic2.qzone.qq.com/` | ic2.qzone.qq.com | feeds3 好友动态 HTML 流（`feeds3_html_more`）与「全部动态」HTML 流（`feeds_html_act_all`，`start`/`count` 分页） |
| `user.qzone.qq.com/proxy/domain/photo.qzone.qq.com/` | photo.qzone.qq.com | 相册/照片操作 |
| `user.qzone.qq.com/proxy/domain/r.qzone.qq.com/` | r.qzone.qq.com | 好友列表、用户信息 |
| `user.qzone.qq.com/proxy/domain/g.qzone.qq.com/` | g.qzone.qq.com | 访客列表 |
| `user.qzone.qq.com/proxy/domain/w.qzone.qq.com/` | w.qzone.qq.com | 通用点赞（internal_dolike_app） |

### 移动端直连域名

| 域名 | 用途 | 稳定性 |
|------|------|--------|
| `mobile.qzone.qq.com` | 文档中的 mood/detail/comment/like 等路径 | ❌ **实机 2026-03-22**：多条常用路径 **HTTP 404**，`/list` 为 **403**（见 [`api-probe-results.md`](api-probe-results.md)） |
| `h5.qzone.qq.com` | H5 proxy（如 `emotion_cgi_re_feeds`） | ⚠️ 路由可达但无参 GET 多为业务错误码（如 `1034`） |

### 其他域名

| 域名 | 用途 |
|------|------|
| `up.qzone.qq.com` | 图片上传 |
| `ssl.ptlogin2.qq.com` | 二维码登录 |
| `xui.ptlogin2.qq.com` | 登录页预热 |

## 通用参数

几乎所有 QQ 空间 API 都需要以下参数：

| 参数 | 说明 | 来源 |
|------|------|------|
| `g_tk` | CSRF 安全令牌 | 由 `p_skey` cookie 经 hash33 算法计算 |
| `format` | 响应格式 | `json` / `jsonp` / `fs` / `purejson` |
| `qzreferrer` | 来源页面 | `https://user.qzone.qq.com/{qq_number}` |
| `hostuin` | 当前登录用户 QQ 号 | 从 cookie `uin` 字段获取 |

## 响应格式

### JSONP 格式

PC 端大多数接口返回 JSONP 格式：

```
_Callback({"code": 0, "message": "succ", ...})
```

需要用括号匹配法提取内部 JSON：

```typescript
function parseJsonp(text: string): unknown {
  const open = text.indexOf('(');
  if (open !== -1) {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')') {
        depth--;
        if (depth === 0) return JSON.parse(text.slice(open + 1, i));
      }
    }
  }
  return JSON.parse(text);
}
```

### 纯 JSON 格式

移动端接口和部分 POST 接口返回纯 JSON，但可能存在编码问题（GBK/UTF-8 混合）。

### HTML 片段格式

`feeds3_html_more` 返回包含转义字符的 HTML 片段（`\x22` → `"`, `\x3C` → `<`），需解转义后用正则提取数据。

## POST vs GET 行为差异

这是 QQ 空间 proxy 层的一个重要特性：

- **POST 请求成功率极高**：`emotion_cgi_re_feeds`、`emotion_cgi_delete_v6`、`like_cgi_likev6` 等全部正常
- **GET 请求到 `taotao.qzone.qq.com` proxy 可能返回 0 字节空响应**：`emotion_cgi_getdetailv6`、`emotion_cgi_getcmtreply_v6`
- **GET 请求到 `ic2.qzone.qq.com` proxy 正常**：`feeds3_html_more`、`feeds_html_act_all`（桥接 action `get_feeds_html_act_all`，OpenClaw 工具 `qzone_get_space_html_act_feed`）

**feeds_html_act_all 语义与实测评测（仅供参考）**

- **返回内容**：与浏览器抓包一致，**说说流归属请求里的 `hostuin`**（桥接可传 `host_uin`；省略时默认当前登录号）。在 Cookie 权限允许时，**`hostuin` 可为他人的 QQ**，此时返回 **该 hostuin 的动态**；URL 里的 **`uin` 多为页面/语境**（与 `hostuin` 可不同）。
- 与 `feeds3_html_more` / `get_emotion_list` **不是**同一分页：`start>0` 与 `pos>0` 的**顺序与集合可对不上**，不可交叉续翻。
- 单次请求往往比多策略 `get_emotion_list` **更快**（单次 ic2 GET vs 多轮 fallback）。
- 要拉**任意 QQ 主页本人说说**，应使用 `get_emotion_list`（OpenClaw：`qzone_get_posts`）。

**推论**：taotao proxy 的 GET 端点可能需要完整浏览器会话状态（qzonetoken + 服务端 session），纯 Cookie 不足。

## User-Agent 策略

### PC 端

```
Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36
```

### 移动端

```
Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/95.0.4638.74 Mobile Safari/537.36
```

## Origin 头自动注入规则

POST 请求需要根据目标域名自动填充 `Origin` 头：

| 目标 URL 包含 | Origin 值 |
|--------------|-----------|
| `user.qzone.qq.com` / `taotao.qzone.qq.com` | `https://user.qzone.qq.com` |
| `up.qzone.qq.com` | `https://up.qzone.qq.com` |
| `mobile.qzone.qq.com` / `h5.qzone.qq.com` | `https://mobile.qzone.qq.com` |
| 其他 | `https://qzs.qzone.qq.com` |
