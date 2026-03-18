# 服务器端问题排查（给维护服务器的 Cursor / 运维）

## 现象：好友动态里只有图片 URL、没有 base64

**结论（本地已验证）**：桥接逻辑正确。当请求带 `include_image_data: true` 时，会拉取白名单图片并写入 `msglist[].pic[].base64`，返回体里已包含 base64（日志见 `totalFetched`、`sampleBase64Len`）。

若服务器上仍出现「只有 URL 无 base64」，按下面步骤排查。

---

## 1. 确认桥接是否稳定运行

- 若进程反复重启，查看 **`$QZONE_CACHE_PATH/debug.log`** 中是否有 `main.ts:fatal` 条目。
- 若有，根据其中的 `error` / `stack` 修复（常见：Cookie 失效、端口占用、网络超时）。

## 2. 确认图片拉取是否在服务器上成功

- 触发一次「获取好友动态」（带 `include_image_data: true`）。
- 查看 **`$QZONE_CACHE_PATH/debug.log`**：
  - **H1**：是否进入 `action_get_friend_feeds`，`willEnrich: true`。
  - **H2**：`first item pic` 是否有 `whitelist: true`；若有 **H4**，说明 `fetchImageWithAuth` 在服务器上失败（网络/Referer/域名策略），需在服务器环境修网络或请求头。
  - **first fetch ok** / **enrich done**：若有 `totalFetched >= 1`、`sampleBase64Len > 0`，说明桥接已把 base64 写入返回的 msglist。

### 2.1 若 H4 显示 502 或 body 为空（CDN/环境问题）

**根因**：请求 `photo.store.qq.com`（及子域如 `photonjmaz.photo.store.qq.com`）时，CDN 返回 502 或空 body，属于**网络/环境或 CDN 策略**问题，而非桥接代码错误。

**真正值得先验证的是**：把腾讯图片域名设为 DIRECT 后，502 是否立刻消失；若消失，可判断为代理出口或转发层问题，而非 Cookie/Referer 或桥接业务代码问题。

桥接已对图片请求**剥离代理/转发类请求头**（如 X-Forwarded-*、Via、Connection 等），避免中间层误判；并对 **502 做带退避的重试**（失败时自动重试数次）。**不推荐**将 X-Forwarded-For 等头当作解决 502 的主要手段。

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
3. 在服务器上对**同一张图片 URL**（从 debug.log 的 H4 或 H2 里取）做两次测试：
   - 直连：`curl -I --http1.1 "https://<图片URL>"`
   - 经代理：`curl -I --http1.1 -x http://127.0.0.1:7890 "https://<图片URL>"`
4. 若**直连成功、代理失败** → 基本可判定为代理出口问题，无需再改 Axios 代码。
5. 若**直连也 502** → 再考虑 TLS/指纹（见下「不要先做的事」）。

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

可快速验证 DIRECT 是否可用、哪个节点对腾讯 CDN 更友好。

**不要先做的事**：一上来大改 TLS cipher；把问题归因到 Axios 重试或 headers；同时改多个变量。

**仅在「直连仍 502」时**做最小化 TLS 试验，顺序建议：(1) 桥接侧不设 `QZONE_IMAGE_PROXY`（`proxy: false`）再测；(2) 自定义 `httpsAgent` 的 `minVersion`（至少 TLSv1.2）、`servername`（按 URL host）、`keepAlive` 等，**不要先改 cipher list**；(3) 最后才在确有需要时做小范围 cipher 试探。Node 默认 TLS 套件已按安全实践选取，改 cipher 影响安全；若 CDN 按 IP/ASN/风控拦截，改 ciphers 往往无效，优先换出口或 DIRECT。

---

**建议排查**：

1. **同一台机用 curl 测 CDN 是否可达**（替换为实际 Cookie 与图片 URL）：
   ```bash
   curl -sI -b "uin=oXXXX; p_skey=xxx; skey=yyy" "http://photonjmaz.photo.store.qq.com/psc?/V114Dbch4DH9xX/..."
   ```
   若返回 502，说明该环境/出口 IP 访问 QZone 图片 CDN 异常（限流、策略或网络问题）。

2. **与浏览器请求头对齐**：用浏览器登录空间、打开带图动态，在开发者工具里看该图片请求的 **Referer、User-Agent** 等。桥接里 `fetchImageWithAuth` 已设置 `Referer: https://user.qzone.qq.com/`；若 CDN 还校验 User-Agent，可在 `client.ts` 的该请求中加上与浏览器一致的 User-Agent（或复用现有 `USER_AGENTS` 池）。

3. **换环境**：在本机或能正常打开空间图片的机器/网络（或换出口 IP）上跑桥接，验证是否仅为当前环境不可达 CDN。

4. **走代理（推荐）**：若 H4 持续 502 且服务器有 HTTP 代理（如 Mihomo），可设置 **`QZONE_IMAGE_PROXY=http://127.0.0.1:7890`**，仅图片拉取经代理出口，其余 API 仍直连。重启桥接后再次触发「获取好友动态」，查看 debug.log 中 H4 是否消失、`enrich done` 中 `totalFetched`/`sampleBase64Len` 是否大于 0。

### 2.2 若经代理拉图仍出现 TLS/连接断开错误

**现象**：`debug.log` H4 报 `Client network socket disconnected before secure TLS connection was established` 或 `ECONNRESET`/`ETIMEDOUT`。

**桥接侧**：当前实现已固定以下 TLS 参数，无需另行调整：
- `ALPNProtocols: ['http/1.1']`（禁用 HTTP/2，降低握手复杂度）
- TLSv1.2–1.3，浏览器风格 cipher 列表
- 失败时自动退避重试 3 次（250 ms × 2^n + 随机 0–120 ms），**502 也会触发重试**

若 CDN 按 IP/ASN/风控拦截，改 ciphers 往往无效，优先换出口或按 2.1 做 DIRECT 分流。

**如需 TLS 握手 trace**：在 systemd service 的 `[Service]` 段加 `Environment=QZONE_IMAGE_DEBUG_TLS=1`，重启桥接，TLS 握手包 trace 会输出到 `stderr`（`journalctl --user -u onebot-qzone -f`），可判断卡在 ClientHello、证书交换还是代理 CONNECT 阶段。

**Mihomo 规则顺序建议**：规则**从上到下**匹配。将 QZone 图片 CDN 域名置于最前走 DIRECT，再接通用代理：

```yaml
rules:
  - DOMAIN-SUFFIX,qpic.cn,DIRECT
  - DOMAIN-SUFFIX,gtimg.cn,DIRECT
  - DOMAIN-SUFFIX,qzonestyle.gtimg.cn,DIRECT
  - MATCH,PROXY
```

**rule-providers（inline）+ RULE-SET + 可选兜底组**：便于直接粘贴，腾讯图片域名用规则集、其余流量可走可选代理组。若希望腾讯图片强制直连用 `RULE-SET,tencent_img,DIRECT`；若希望保留可切换兜底则用下面 `ImgFallback`（需将「你的主代理」「自动选择」等按实际名称替换）：

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

若上述域名改为 DIRECT 后 502 消失，可判断为**代理出口或转发层**问题，而非 Cookie/Referer 业务层问题；若仍 502，再查直连出口、MTU 或 Mihomo TUN/转发链路。

**可选：外部规则包（type: http）**：若希望可更新的外部规则集，可使用 `rule-providers` 的 `type: http`、`proxy: DIRECT`、`format: yaml`、`interval` 等（与下面 tencent_cdn 示例一致）：

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

## 3. 若桥接日志正常但客户端仍无 base64

- 核对客户端（如 NapCat/OpenClaw 插件）期望的字段：桥接返回的是 **`msglist[].pic[]`** 中每项带 **`url`、`base64`、`content_type`**。若客户端读的是其他字段（如顶层 `image_data`），需在客户端或桥接侧做字段映射。

## 4. 本地快速验证（不依赖服务器）

在项目根目录执行：

```bash
npx tsx test/debug-friend-feeds-local.ts
```

会直接调用 `action_get_friend_feeds(include_image_data: true)` 并写入 **`./test_cache/debug.log`**（或 `$QZONE_CACHE_PATH/debug.log`）。根据该文件中的 H1/H2/H3/H4、`first fetch ok`、`enrich done` 即可判断行为是否符合预期。

---

**日志路径**：始终为 **`$QZONE_CACHE_PATH/debug.log`**（未设置时默认 `./test_cache/debug.log`）。部署时保证该目录可写，排查时拉取此文件即可。

**小结**：H1/H2/H3 正常而 H4 报 502 → 桥接逻辑无误，问题在访问 QZone 图片 CDN 的环境（网络/出口/IP 或 CDN 策略）；按 2.1 的 curl、请求头、换环境逐步排查即可。
