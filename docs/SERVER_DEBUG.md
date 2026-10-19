# 服务器端问题排查（给维护服务器的 Cursor / 运维）

> 2026-10 起，桥接**不再写 `debug.log`**。运行日志统一输出到 stdout/stderr（systemd 下由 journald 收集）；需要落盘时用本文的 `QZONE_DEBUG_DUMP` / `ONEBOT_EVENT_DEBUG`。

## 现象：好友动态里只有图片 URL、没有 base64

**结论（本地已验证）**：桥接逻辑正确。当请求带 `include_image_data: true` 时，会拉取白名单图片并写入 `msglist[].pic[].base64`，返回体里已包含 base64。

若服务器上仍出现「只有 URL 无 base64」，按下面步骤排查。

---

## 1. 确认桥接是否稳定运行

- systemd（user 单元）查看日志：
  ```bash
  journalctl --user -u onebot-qzone -f
  ```
- 前台运行时直接看终端输出；进程崩溃会打印 `[FATAL] <error>`。
- 常见原因：Cookie 失效、端口占用、网络超时、请求体超过上限（HTTP 413）。

## 2. 打开排查日志

| 变量 | 作用 | 输出位置 |
|------|------|----------|
| `ONEBOT_EVENT_DEBUG=1` | 事件去重/发布日志、轮询器调试日志 | stdout / journald |
| `QZONE_DEBUG_DUMP=1` | feeds3 HTML 与原始响应落盘 | `{QZONE_CACHE_PATH}/debug/` |
| `QZONE_IMAGE_DEBUG_TLS=1` | 图片 TLS 握手 trace | stderr / journald |
| `QZONE_DEBUG_DUMP` + SDK 失败 | 解析诊断（`parse_trace`） | `{QZONE_CACHE_PATH}/diagnostics/parse_trace/` |

`QZONE_DEBUG_DUMP=1` 会生成：

- `debug/feeds3_<uin>_<scope>.html`：最近一次 feeds3 解码后的 HTML（稳定文件名）
- `debug/feeds3_<uin>_<scope>_<timestamp>.html`：每次请求的快照
- `debug/<name>_<timestamp>.txt`：校验失败等场景转存的原始响应

排查完建议关闭，避免磁盘增长。

## 3. 确认图片拉取是否在服务器上成功

1. 触发一次「获取好友动态」（带 `include_image_data: true`）。
2. 观察日志中的图片拉取异常（`fetchImageWithAuth` 抛出的状态码/网络错误）与最终 `msglist` 中 `pic[].base64` 是否存在。
3. 若日志出现 502 / 空 body / TLS 断开，按 3.1 处理。

图片请求的固定行为（无需改代码）：

- `photo.store.qq.com` 的 `http://` URL 会强制升级为 HTTPS
- 带 `Referer: https://user.qzone.qq.com/`、**随机浏览器 UA / Accept-Language**、Cookie
- 剥离 `X-Forwarded-*`、`Via`、`Connection` 等代理/转发类请求头
- TLS：TLSv1.2–1.3、ALPN 仅 `http/1.1`、keep-alive
- 502 / 可重试网络错误自动退避重试 3 次（250 ms × 2^n + 随机 0–120 ms）

### 3.1 若出现 502 或 body 为空（CDN/环境问题）

**根因**：请求 `photo.store.qq.com`（及子域如 `photonjmaz.photo.store.qq.com`）时，CDN 返回 502 或空 body，属于**网络/环境或 CDN 策略**问题，而非桥接代码错误。

**真正值得先验证的是**：把腾讯图片域名设为 DIRECT 后，502 是否立刻消失；若消失，可判断为代理出口或转发层问题，而非 Cookie/Referer 或桥接业务代码问题。

---

**第一步：Mihomo DIRECT + 可选 DNS（建议最先执行）**

502 多为**代理出口 / CDN 兼容或风控**问题。优先做 Mihomo 对目标域名的 DIRECT 分流，用 curl 对比直连与经代理，再决定是否动代码或做 TLS 试验。

**可直接粘贴的 rules 片段**（放在通用 MATCH/GEOIP **之前**）：

```yaml
rules:
  # Tencent image CDN: force direct
  - DOMAIN-SUFFIX,qpic.cn,DIRECT
  - DOMAIN-SUFFIX,gtimg.cn,DIRECT
  - DOMAIN,qzonestyle.gtimg.cn,DIRECT
  # 可选：若日志中常见这些域名也可加
  # - DOMAIN-SUFFIX,qq.com,DIRECT
  # - DOMAIN-SUFFIX,weixin.qq.com,DIRECT
  # 下方保留原有 GEOIP / MATCH 等规则
  # - GEOIP,CN,DIRECT
  # - MATCH,YourProxyOrPolicy
```

**可选：直连 DNS**。规则走 DIRECT 时，避免解析仍走代理侧 DNS 导致不一致。可参考（按 [Mihomo DNS 文档](https://wiki.metacubex.one/en/config/dns/) 调整）：

```yaml
dns:
  enable: true
  respect-rules: true
  nameserver:
    - https://1.1.1.1/dns-query
    - https://8.8.8.8/dns-query
  direct-nameserver:
    - system
    - 223.5.5.5
    - 119.29.29.29
```

**排查顺序与 curl 对比**：

1. 在 Mihomo `config.yaml` 加上上述 DIRECT 规则（及可选 direct-nameserver）。
2. 重启 Mihomo。
3. 在服务器上对**同一张图片 URL**（从 `QZONE_DEBUG_DUMP` 转存或 action 返回中取）做两次测试：
   - 直连：`curl -I --http1.1 "https://<图片URL>"`
   - 经代理：`curl -I --http1.1 -x http://127.0.0.1:7890 "https://<图片URL>"`
4. 若**直连成功、代理失败** → 基本可判定为代理出口问题，无需再改代码。
5. 若**直连也 502** → 再考虑出口/IP、MTU 或 TLS 因素。

**可选策略组 TENCENT_IMG**：为腾讯图片 CDN 单独建 `select` 组，便于快速切换 DIRECT / 不同节点验证出口：

```yaml
proxy-groups:
  - name: TENCENT_IMG
    type: select
    proxies:
      - DIRECT
      - YourRelayNode
      - YourHKNode
      - YourSGNode

rules:
  - DOMAIN-SUFFIX,qpic.cn,TENCENT_IMG
  - DOMAIN-SUFFIX,gtimg.cn,TENCENT_IMG
  - DOMAIN,qzonestyle.gtimg.cn,TENCENT_IMG
  - MATCH,YourDefaultPolicy
```

**不要先做的事**：一上来大改 TLS cipher；把问题归因到重试或 headers；同时改多个变量。

**仅在「直连仍 502」时**做最小化 TLS 试验，顺序建议：(1) 不设 `QZONE_IMAGE_PROXY`（直连）再测；(2) 用 `QZONE_IMAGE_DEBUG_TLS=1` 看握手卡在哪一步；(3) 最后才考虑自定义 cipher。若 CDN 按 IP/ASN/风控拦截，改 ciphers 往往无效，优先换出口或 DIRECT。

---

**建议排查**：

1. **同一台机用 curl 测 CDN 是否可达**（替换为实际 Cookie 与图片 URL，统一用 HTTPS）：
   ```bash
   curl -sI -b "uin=oXXXX; p_skey=xxx; skey=yyy" "https://photonjmaz.photo.store.qq.com/psc?/V114Dbch4DH9xX/..."
   ```
   若返回 502，说明该环境/出口 IP 访问 QZone 图片 CDN 异常（限流、策略或网络问题）。

2. **换环境**：在本机或能正常打开空间图片的机器/网络（或换出口 IP）上跑桥接，验证是否仅为当前环境不可达 CDN。

3. **走代理（可选）**：若持续 502 且服务器有 HTTP 代理（如 Mihomo），可设置 **`QZONE_IMAGE_PROXY=http://127.0.0.1:7890`**，仅图片拉取经代理出口，其余 API 仍直连。

### 3.2 若经代理拉图仍出现 TLS/连接断开错误

**现象**：`Client network socket disconnected before secure TLS connection was established` 或 `ECONNRESET` / `ETIMEDOUT`。

**桥接侧**已固定：`ALPNProtocols: ['http/1.1']`、TLSv1.2–1.3、浏览器风格 cipher、失败退避重试 3 次（502 也会重试）。

若 CDN 按 IP/ASN/风控拦截，改 ciphers 往往无效，优先换出口或按 3.1 做 DIRECT 分流。

**如需 TLS 握手 trace**：在 systemd user 单元 `[Service]` 段加 `Environment=QZONE_IMAGE_DEBUG_TLS=1`，重启后：

```bash
journalctl --user -u onebot-qzone -f
```

可判断卡在 ClientHello、证书交换还是代理 CONNECT 阶段。

**Mihomo 规则顺序建议**：规则**从上到下**匹配。将 QZone 图片 CDN 域名置于最前走 DIRECT，再接通用代理：

```yaml
rules:
  - DOMAIN-SUFFIX,qpic.cn,DIRECT
  - DOMAIN-SUFFIX,gtimg.cn,DIRECT
  - DOMAIN-SUFFIX,qzonestyle.gtimg.cn,DIRECT
  - MATCH,PROXY
```

**rule-providers（inline）+ RULE-SET + 可选兜底组**：

```yaml
rule-providers:
  tencent_img:
    type: inline
    behavior: classical
    format: text
    payload:
      - DOMAIN-SUFFIX,qpic.cn
      - DOMAIN-SUFFIX,gtimg.cn
      - DOMAIN-SUFFIX,qzonestyle.gtimg.cn

proxy-groups:
  - name: ImgFallback
    type: select
    proxies:
      - DIRECT
      - 你的主代理
      - 自动选择

rules:
  - RULE-SET,tencent_img,DIRECT
  - MATCH,ImgFallback
```

若上述域名改为 DIRECT 后 502 消失，可判断为**代理出口或转发层**问题；若仍 502，再查直连出口、MTU 或 Mihomo TUN/转发链路。

**可选：外部规则包（type: http）**：

```yaml
rule-providers:
  tencent_cdn:
    type: http
    behavior: classical
    format: yaml
    path: ./rules/tencent_cdn.yaml
    url: https://example.com/tencent_cdn.yaml
    interval: 86400
    proxy: DIRECT
```

```yaml
# ./rules/tencent_cdn.yaml
payload:
  - DOMAIN-SUFFIX,qpic.cn
  - DOMAIN-SUFFIX,gtimg.cn
  - DOMAIN-SUFFIX,qzonestyle.gtimg.cn
```

## 4. 若桥接日志正常但客户端仍无 base64

- 核对客户端（如 NapCat/OpenClaw 插件）期望的字段：桥接返回的是 **`msglist[].pic[]`** 中每项带 **`url`、`base64`、`content_type`**。若客户端读的是其他字段（如顶层 `image_data`），需在客户端或桥接侧做字段映射。

## 5. 本地快速验证（不依赖服务器）

在项目根目录执行：

```bash
npx tsx test/debug-friend-feeds-local.ts
```

会直接调用 `action_get_friend_feeds(include_image_data: true)`，并打印：

```
msglist: N 条，含图: X 条，图带 base64: Y 条
```

若 `含图 > 0` 且 `图带 base64 = 0`，说明本机网络/出口访问图片 CDN 异常，按第 3 节排查。

---

**日志位置小结**：

| 内容 | 位置 |
|------|------|
| 运行/轮询/事件日志 | stdout；systemd 下 `journalctl --user -u onebot-qzone` |
| feeds3 HTML / 原始响应 | `{QZONE_CACHE_PATH}/debug/`（需 `QZONE_DEBUG_DUMP=1`） |
| 解析诊断 | `{QZONE_CACHE_PATH}/diagnostics/parse_trace/` |
| TLS trace | stderr（需 `QZONE_IMAGE_DEBUG_TLS=1`） |

**结论**：图片拉取返回 502/空体 → 桥接逻辑无误，问题在访问 QZone 图片 CDN 的环境（网络/出口/IP 或 CDN 策略）；按第 3 节的 curl、换环境、DIRECT 分流逐步排查即可。
