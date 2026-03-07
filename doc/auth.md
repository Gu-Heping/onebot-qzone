# 认证机制

## Cookie 体系

QQ 空间的认证完全依赖 Cookie，核心字段如下：

| Cookie | 域 | 说明 |
|--------|-----|------|
| `uin` | `.qq.com` | 用户 QQ 号（带 `o` 前缀，如 `o123456789`） |
| `p_uin` | `.qq.com` | 同 uin |
| `skey` | `.qq.com` | 登录态密钥 |
| `p_skey` | `.qzone.qq.com` | QQ 空间专用密钥，**g_tk 的计算来源** |
| `pt4_token` | `.qq.com` | 登录 token |
| `pt_login_sig` | `ptlogin2.qq.com` | 登录签名（仅二维码登录时使用） |
| `ptdrvs` | `ptlogin2.qq.com` | 设备标识 |
| `qrsig` | `ptlogin2.qq.com` | 二维码签名（仅二维码登录时使用） |

### Cookie 有效期

- Cookie 默认有效期约 **14 天**（实测）
- 项目设置了 14 天自动清除策略：超过 14 天未使用的 Cookie 文件会被删除
- Cookie 持久化格式：

```json
{
  "last_used": 1709012345.678,
  "cookies": {
    "uin": "o123456789",
    "skey": "@abc123",
    "p_skey": "xyz789..."
  }
}
```

## g_tk 算法（hash33 / DJBX33A 变种）

g_tk 是 QQ 空间 API 的核心 CSRF 令牌，通过 `p_skey` cookie 计算得出：

```typescript
function calcGtk(val: string): number {
  let hsh = 5381;
  for (let i = 0; i < val.length; i++) {
    hsh += (hsh << 5) + val.charCodeAt(i);
  }
  return hsh & 0x7fffffff;
}

// 使用：
// const gtk = calcGtk(cookies['p_skey'] ?? cookies['skey'] ?? '');
```

**关键点**：

- 算法本质是 hash33（DJBX33A 变种）
- 初始值为 5381
- 结果取 `& 0x7FFFFFFF` 确保为正整数
- 优先使用 `p_skey`，其次 `skey`
- 两者都为空时 g_tk = 5381

## qzonetoken

qzonetoken 是服务器端生成的令牌，嵌入在 QQ 空间主页 HTML 中。

### 获取方式

从以下 URL 的 HTML 响应中正则提取：

1. `https://qzs.qzone.qq.com/qzone/v5/loginsucc.html?para=izone`
2. `https://qzs.qzone.qq.com/qzone/v5/loginsucc.html`
3. `https://user.qzone.qq.com/{qqNumber}`
4. `https://user.qzone.qq.com/{qqNumber}/main`

### 提取正则（按优先级排列）

```
/g_qzonetoken\s*=\s*\(function\(\)\{[\s\S]*?return\s*['"]([^'"]+)['"]/
/g_qzonetoken\s*=\s*['"]([^'"]+)['"]/
/"g_qzonetoken"\s*:\s*"([^"]+)"/
/qzonetoken"\s*:\s*"([^"]+)"/
/[?&]qzonetoken=([A-Za-z0-9]+)/
```

### iframe 备选提取

部分页面通过 iframe 加载 Feeds 内容，需额外请求：

```
/id="QM_Feeds_Iframe"[^>]*?src="([^"]+)"/i
```

提取 iframe src 后附加 `g_tk` 参数重新请求，在 iframe 页面中再次尝试上述正则。

### 特性

- 每次页面刷新可能变化
- **大多数 API 不需要 qzonetoken**，只需 `g_tk` 即可
- 部分 PC 端 GET 请求可能需要（如 `emotion_cgi_getdetailv6` 的某些变体）
- 获取失败后设置 10 分钟冻结期，避免频繁请求
- 成功获取后缓存 5 分钟

### Playwright 兜底

当常规方法无法获取 qzonetoken 时，可使用 Playwright 启动无头浏览器：

1. 注入 Cookie 到浏览器上下文
2. 导航至 QQ 空间主页
3. 通过 `page.evaluate()` 读取 `window.g_qzonetoken`

环境变量配置：

| 变量 | 默认值 | 说明 |
|------|--------|------|

| `QZONE_PLAYWRIGHT_TIMEOUT_MS` | `15000` | 页面加载超时 |
| `QZONE_PLAYWRIGHT_CHANNEL` | `chrome` | 浏览器通道 |
| `QZONE_PLAYWRIGHT_EXECUTABLE` | 空 | 自定义浏览器路径 |

## ptqrtoken 算法（已废弃）

> 以下内容仅作为协议参考。项目已移除 ptlogin2 协议登录路径，统一使用 Playwright 浏览器扫码。

用于二维码登录状态检查，算法与 g_tk 完全相同：

```typescript
const ptqrtoken = calcGtk(cookies['qrsig']);
```

## 二维码登录流程（ptlogin2 协议，已废弃）

> 以下内容仅作为逆向工程参考。实际使用中 ptlogin2 协议常被服务器 403 拦截，项目已统一采用 Playwright 真实浏览器扫码。

### 1. 预热登录上下文

```
GET https://xui.ptlogin2.qq.com/cgi-bin/xlogin?appid=549000912&daid=5&style=40&target=self
    &s_url=https%3A%2F%2Fqzs.qzone.qq.com%2Fqzone%2Fv5%2Floginsucc.html%3Fpara%3Dizone
```

获取 `pt_login_sig` 和 `ptdrvs` cookie。

### 2. 获取二维码图片

```
GET https://ssl.ptlogin2.qq.com/ptqrshow?appid=549000912&e=2&l=M&s=3&d=72&v=4
    &t=0.405252856480647&daid=5&pt_3rd_aid=0
    &u1=https%3A%2F%2Fqzs.qzone.qq.com%2Fqzone%2Fv5%2Floginsucc.html%3Fpara%3Dizone
```

响应为 PNG 图片二进制数据，保存后由用户手机 QQ 扫码。同时获取 `qrsig` cookie。

### 3. 轮询扫码状态

```
GET https://ssl.ptlogin2.qq.com/ptqrlogin?ptqrtoken={ptqrtoken}
    &u1=https%3A%2F%2Fqzs.qzone.qq.com%2Fqzone%2Fv5%2Floginsucc.html%3Fpara%3Dizone
    &ptredirect=0&h=1&t=1&g=1&from_ui=1&ptlang=2052
    &action=0-0-{timestamp}
    &js_ver=23083115&js_type=1&login_sig={loginSig}
    &pt_uistyle=40&aid=549000912&daid=5&has_onekey=1
    &o1vId=17651ac69455d734d04e49acc7987a50&pt_js_version=v1.47.0
```

响应格式为 `ptuiCB` 函数调用：

```javascript
ptuiCB('状态码', '0', '跳转URL', '0', '提示文本', '昵称');
```

| 状态码 | 含义 |
|--------|------|
| `66` | 等待扫码 |
| `67` | 已扫码，等待手机确认 |
| `65` | 二维码已过期 |
| `0` | 登录成功 |

### 4. 换取登录态

登录成功后，解析返回的跳转 URL（需 `\x26` 等转义处理），依次请求：

1. 跳转 URL → 设置登录 Cookie
2. `https://user.qzone.qq.com/` → 补全 QQ 空间 Cookie

### 注意事项（历史参考）

- `ptqrlogin` 很容易被 403 拦截（IP/设备风控），这是废弃此路径的主要原因
- 建议使用 Playwright 浏览器扫码或 Cookie 字符串登录

## Cookie 字符串登录

直接注入 Cookie 字符串绕过扫码流程：

```typescript
await client.loginWithCookieString('uin=o123456789; skey=@abc; p_skey=xyz...');
```

要求至少包含 `uin`、`p_skey`、`skey`、`p_uin` 之一。登录后会请求 QQ 空间首页验证 Cookie 有效性。

## 认证失败检测

以下业务码表示 Cookie 过期或无效：

| 业务码 | 含义 |
|--------|------|
| `-3` | 认证失败 |
| `-100` | 认证失败 |
| `-3000` | 认证失败 |
| `-10001` | 认证失败 |
| `-10006` | 认证失败 |
