# QQ 空间逆向与实现指南

> 本文档说明如何「不断逆向直到实现」新功能：从浏览器抓包到 client/action/测试/文档的完整流程。  
> 功能全景与优先级见 [qzone-feature-matrix.md](qzone-feature-matrix.md)。

## 一、抓包

1. **环境**：Chrome/Edge，登录 [QQ 空间](https://user.qzone.qq.com)。
2. **F12** → **Network**，勾选 **Preserve log**，筛选 **XHR** 或 **Fetch**。
3. **操作**：在页面上执行目标功能（例如：给一条评论点赞、打开留言板、发表留言）。
4. **记录**（每个请求）：
   - 请求 **URL**（完整，含 query 或只看 path + 域名）
   - **Method**：GET / POST
   - **Request Headers**：`Cookie`、`Referer`、`Origin`、`Content-Type`
   - **Request Payload**：若为 POST，表单或 JSON 的键值
   - **Response**：JSON/JSONP 片段（前几百字即可），以及 `code`/`ret`/`message` 等业务字段

若同一功能有多个请求（如先拉列表再提交），按顺序记录并注明「列表」/「提交」等。

---

## 移动端抓包（评论点赞等仅手机端有的功能）

思路：**手机和电脑连同一 WiFi，手机把 HTTP(S) 流量经电脑上的代理软件转发，由电脑解密并记录**。

### 1. 选一台电脑 + 代理工具

- **Windows / macOS**：用 [Charles](https://www.charlesproxy.com/)、[Fiddler](https://www.telerik.com/fiddler) 或 [mitmproxy](https://mitmproxy.org/) 任选其一。
- **mitmproxy**（命令行）：`pip install mitmproxy` 或 `brew install mitmproxy`，运行 `mitmproxy` 或 `mitmweb`（后者有网页界面），默认监听 8080。

### 2. 手机和电脑同一网络

- 手机连与电脑**相同的 WiFi**（或电脑开热点给手机连）。
- 记下电脑在局域网里的 **IP**（如 `192.168.1.100`）：  
  Windows：`ipconfig`；macOS/Linux：`ifconfig` 或 `ip addr`。

**校园网 / 抓包失败时**：很多校园网做了**客户端隔离**（同一 WiFi 下设备不能互访），手机设成「代理=电脑 IP」后连不上电脑，表现为代理保存后手机无法上网或一直转圈。

- **解决办法**：不用校园 WiFi，改用**电脑开热点**。电脑用有线或手机热点先上网，再在电脑上开「移动热点」或「共享网络」，让**手机连电脑开出的这个 WiFi**。这样手机和电脑在同一个由电脑建的小局域网里，没有隔离，代理才能通。
- Windows：设置 → 网络和 Internet → 移动热点，开启并设名称和密码；macOS：系统设置 → 共享 → 互联网共享，选「通过以太网/USB 共享给 Wi-Fi」。

### 3. 手机设置 HTTP 代理

- **Android**：设置 → WLAN → 长按当前 WiFi → 修改网络 / 高级 → 代理选手动，主机填电脑 IP，端口填代理端口（Charles/Fiddler 常用 8888，mitmproxy 默认 8080）。
- **iOS**：设置 → 无线局域网 → 当前网络右侧 ⓘ → 配置代理 → 手动，服务器=电脑 IP，端口=代理端口。

保存后，手机的上网流量会先经过电脑上的代理。

### 4. 安装代理的 CA 证书（才能解 HTTPS）

**先**在手机里设好代理（§3），**再**用手机浏览器打开下面任一地址下载并安装证书（端口按你实际用的来，如电脑开热点后 IP 多为 `192.168.137.1`）：

- **Fiddler**：电脑上 Fiddler → Tools → Options → HTTPS → 勾选 Decrypt HTTPS traffic；手机浏览器访问 **`http://192.168.137.1:8888`**（或你的电脑 IP:8888），在页面里点 Fiddler 根证书并安装（Android 需在「安全」里选「从存储设备安装」）。
- **mitmproxy**：手机浏览器访问 **`http://mitm.it`**（请求会经代理，mitmproxy 会返回证书页），选对应系统下载并安装；iOS 还需在「设置 → 通用 → 关于本机 → 证书信任设置」里**信任**该证书。
- **Charles**：手机浏览器打开 **`chls.pro/ssl`**，按提示安装描述文件；iOS 同样要到「证书信任设置」里信任该证书。

**无法访问 电脑IP:端口 时**（手机浏览器打不开、超时）：

1. **确认手机连的是电脑热点**：WiFi 名称要是你电脑开的热点名，不是校园网；热点开启后手机再连一次。
2. **确认电脑在热点网段的 IP**：电脑上 `ipconfig`（Windows）或 `ifconfig`（macOS），看「移动热点」或「本地连接*」对应适配器的 IPv4，不一定是 `192.168.137.1`，可能是 `192.168.173.1` 等，用实际显示的 IP 替换。
3. **Fiddler 允许远程连接**：Fiddler → **Tools → Options → Connections**，勾选 **Allow remote computers to connect**，端口 8888，确定后重启 Fiddler。
4. **防火墙放行**：Windows 若弹出「允许 Fiddler 访问网络」选允许；若没弹过，可到 设置 → 防火墙 → 高级设置 → 入站规则 → 新建规则 → 端口 → TCP 8888（或你用的端口）→ 允许连接。
5. **先不设代理试一次**：手机**先取消**代理（代理选「无」），浏览器访问 `http://电脑IP:8888`。若仍无法访问，多半是 2/3/4；若取消代理能打开，说明是代理设成 8888 后浏览器把“访问 8888”的请求也发了代理导致死循环，可改用 Fiddler 的 **Fiddler Classic 证书页**：电脑上 Fiddler 菜单 **Help → Fiddler Orchestrator / 或 Export 证书到桌面**，把证书文件通过数据线或微信发到手机再安装。

### 5. 抓包

1. 电脑上打开代理软件并开始录制（Charles/Fiddler 默认就在录；mitmproxy 终端里会实时刷请求）。
2. 手机打开 **QQ 或 QQ 空间 App**，执行目标操作（例如点进一条说说 → 给某条评论点赞）。
3. 在电脑上筛选/搜索与空间相关的域名（如 `qzone.qq.com`、`mobile.qzone.qq.com`），找到对应请求，记下 **URL、Method、Request Headers、Request Body、Response**。

**证书装好了但 Fiddler 里没有任何请求**：

- **先确认代理是否生效**：用手机**浏览器**随便打开一个 HTTPS 网站（如 https://www.baidu.com ）。看 Fiddler 里是否出现对应请求。若**有**，说明代理和证书对浏览器有效，问题在 App。
- **若浏览器有请求、QQ/空间 App 没有**：常见两种原因：  
  **(1) 很多 Android 机子上，WiFi 里设的「代理」只对浏览器生效，其它 App 不走系统代理**，所以 Fiddler 看不到 QQ 的请求。可试：用手机浏览器打开 **QQ 空间网页版**（如 https://h5.qzone.qq.com 或电脑版空间页），在网页里做「评论、点赞」等操作，看 Fiddler 能否抓到；或改用 **HttpCanary**（Android）等「全局」抓包（VPN 式，所有 App 流量都经它）。  
  **(2) QQ/空间 App 做了证书固定**，发现系统里装了抓包证书就自己断连或不走代理，Fiddler 里可能完全看不到，或只看到 CONNECT 后失败。这种情况只能依赖网页端抓包或移动端用 root/HttpCanary 等绕过。
- **若连浏览器访问 HTTPS 在 Fiddler 里也没有**：检查手机 WiFi 里代理是否仍为「手动」且 IP、端口正确；Fiddler 里去掉任何 Host 过滤，看是否能看到新会话。
- **点赞/评论点赞后 Fiddler 里没有新请求**：多半是 **(1) 该 App 的这部分请求不走系统代理**（Android 上常见），或 **(2) 证书固定导致 App 不把敏感请求发到代理**。可试：**去掉 Fiddler 的 Host 过滤**，再点一次赞，看是否有**任意**新会话（哪怕域名不是 qzone）；若仍没有，说明点赞请求根本没经 Fiddler。此时可试 **HttpCanary**（Android，VPN 式全局抓包，部分场景下能抓到）；或改用**手机浏览器打开 QQ 空间 H5**，在网页里做评论/点赞，看 H5 是否走代理、能否抓到。

---

### 使用 HttpCanary 或 Reqable（Android 抓包）

**HttpCanary**（黄鸟）：在手机本机建「虚拟 VPN」，**所有 App 的流量都会经过它**，不依赖电脑代理，适合抓 QQ/空间等不走系统代理的请求。应用商店搜「HttpCanary」或「黄鸟抓包」。仅 **Android**。

**Reqable**：跨平台调试工具，有桌面端（代理）和移动端。用 Reqable 抓手机流量时，一般为手机设代理指向电脑上的 Reqable，或使用其移动端提供的抓包方式；思路同样是装证书、开抓包、在空间里操作、筛选 qzone 相关请求。

**使用 Reqable 抓包（你已安装时）**：  
- **电脑 + 手机代理**：电脑打开 Reqable，开启「代理」/「Proxy」，记下监听端口（如 9000）。手机与电脑同一 WiFi（或电脑开热点），手机 WiFi 里设代理为「手动」、主机=电脑 IP、端口=Reqable 端口。手机浏览器访问 `http://电脑IP:端口` 或 Reqable 提示的地址，下载并安装根证书；Android 需到 设置 → 安全 → 从存储设备安装 该证书。然后开抓包，在手机 QQ/空间里操作，在 Reqable 里筛选 qzone。  
- **仅手机端 Reqable App**：打开 Reqable 移动版 → 按应用内提示安装根证书（若有「导出」先导出再在系统设置里安装）→ 启动抓包（可能需建 VPN）→ 切到 QQ/空间操作 → 回到 Reqable 停止并筛选 qzone。

**使用 Android Studio 的 Network Profiler**：  
- 手机用 **USB 连接电脑**，开启 **USB 调试**（设置 → 开发者选项 → USB 调试）。  
- 打开 **Android Studio** → 菜单 **View → Tool Windows → App Inspection**（或 **Profiler**）；若用旧版，**View → Tool Windows → Profiler**，再选 **Network**。  
- 在设备/进程列表里选你的**手机**，进程选 **QQ** 或 **QQ 空间**（如 `com.tencent.mobileqq`、`com.qzone`）。  
- 点击 **Record** 开始录制，在手机上做「评论点赞」等操作，再停止录制，在时间线上点选请求查看 URL、Headers、Body。  
- **说明**：无需在手机里设代理或装抓包证书；HTTPS 请求体若应用未配合可能仍为加密。适合已有 Android Studio 环境、想快速看请求域名和路径时使用。  
- **用模拟器时**：可直接在 **Android Studio 模拟器**里安装 QQ/QQ 空间（若模拟器内 Play 商店没有，可从官网或应用宝下载 APK，用 `adb install 包名.apk` 或把 APK 拖进模拟器窗口安装）。登录后在模拟器里操作「评论点赞」，在 Profiler 里选**模拟器设备**和 QQ/空间进程即可抓包，无需真机与代理。

1. **安装**  
   - 应用商店搜 **HttpCanary** 或 **黄鸟抓包**，或从 [httpcanary.com](https://httpcanary.com/) 下载安装。

2. **获取并安装根证书（解 HTTPS）**  
   - 打开 HttpCanary → **设置**（或 侧栏/更多）→ 找到 **CA 证书** / **根证书** / **证书管理**。  
   - **先导出证书文件**：若有「**导出**」「**保存到存储**」「**分享证书**」等，点选后把证书存到**下载目录**或**内部存储**（记下路径，如 `Download/HttpCanary.cer` 或 `HttpCanary/cacert.cer`）。若无导出项，可试「**安装根证书**」里是否有「安装到用户存储」或「复制到剪贴板」，部分版本会同时把文件存到 `Android/data/com.guoshi.httpcanary/files/` 或应用专属目录，用「文件」App 去该目录找 `.cer`/`.crt` 文件。  
   - **再在系统里安装**：  
     - 打开手机 **设置** → **安全**（或 更多安全设置）→ **加密与凭据**（或 凭据存储）→ **安装证书** / **从存储设备安装** / **CA 证书**。  
     - 选「**CA 证书**」（若问「用于 VPN 和应用」还是「仅用于 WLAN」，可先试前者）。  
     - 从**下载**或**内部存储**里选中刚才导出的 `.cer` 文件，按提示命名（如 HttpCanary）并确认。  
   - **若 App 内只有「安装到系统」且提示要 root**：说明你的黄鸟版本没有提供「用户证书」或「导出」；可到应用商店更新到最新版再看是否有「导出证书」或「用户证书」选项，或换用 **Reqable** / **Fiddler + 电脑代理** 方式抓包（证书从电脑导出再发到手机安装）。

3. **选目标应用（可选，减少噪音）**  
   - 在 HttpCanary 里设置 **目标应用** 只勾选 **QQ** 或 **QQ 空间**，这样只抓该 App 的流量；不设则抓全部。

4. **开始抓包**  
   - 点击 **右下角飞机/开始** 按钮，同意建立 VPN。  
   - 此时手机状态栏会出现「钥匙」或 VPN 图标，表示抓包已开启。

5. **操作并筛选**  
   - 切到 **QQ 或 QQ 空间**，执行目标操作（例如点进一条说说 → 给某条**评论**点赞）。  
   - 回到 HttpCanary，点击 **停止** 或 **暂停**。  
   - 在记录列表里用 **搜索/筛选**，输入 **qzone**、**taotao** 或 **like**、**comment**，找与点赞相关的请求（优先看 **POST**、Host 含 qzone 的）。

6. **查看并记录**  
   - 点进某条会话，查看 **URL、Method、Request Headers、Request Body、Response**。  
   - 可长按导出或复制，按「§一」的格式记下，再按 §二～§七 文档化并实现。

7. **注意**  
   - 若 QQ/空间仍出现「网络错误」或打不开，可能是**证书固定**，HttpCanary 高级版或「禁用 SSL 校验」等选项可尝试；部分 App 无法绕过则只能放弃该接口抓包。  
   - 抓完后记得在 HttpCanary 里**停止抓包**（断开 VPN），否则可能影响其它应用上网。

---

### 6. 若 App 报错或无法联网

部分 App 会做 **证书固定（Certificate Pinning）**，检测到系统里装了抓包证书就拒绝访问。表现：装好证书后，QQ/空间 App 打不开或一直加载。

- **Android**：可尝试用 [HttpCanary](https://httpcanary.com/)（自带处理部分 pinning）、或配合 Magisk + 模块（如 JustTrustMe）绕过；需 root，有风险。
- **iOS**：较难绕过，可尝试用越狱设备 + 插件，或看是否能用**微信/QQ 内置浏览器**打开空间 H5 页面再抓（若空间有 H5 版评论点赞）。

若无法绕过，则只能依赖**网页端**已抓到的接口，或等官方提供开放 API。

### 7. 记录格式（与 §一 一致）

把抓到的请求按「§一」里的要点记下来：URL、Method、Headers（Cookie、Referer 等）、Payload、Response 片段，然后按 **§二～§七** 文档化并实现。

---

## 二、文档化

在 `doc/` 下新建或扩展现有 API 文档（如 `social-api.md`、`board-api.md`），写入：

- **接口名称**、**用途**
- **URL**、**Method**
- **参数表**（名、说明、示例值）
- **响应示例**（成功 / 失败各一）
- **注意**：是否 JSONP、编码 GBK/UTF-8、限流码等

若为占位（尚未抓包），在 [qzone-feature-matrix.md](qzone-feature-matrix.md) 和 [feature-backlog.md](feature-backlog.md) 中标记为「待抓包」。

## 三、Client 实现

在 `src/qzone/client.ts` 中：

1. **新方法**：如 `likeComment(uin, tid, commentId)`，内部用 `this.getGtk()`、`this.post()`/`this.get()`，URL 与参数按抓包结果填写。
2. **响应解析**：优先 `safeDecodeJsonResponse(resp.data)` 或 `parseJsonp(resp.text)`；若返回 HTML 内嵌 JSON，可加与评论/转发类似的 `/"code"\s*:\s*0\b/` 兜底。
3. **失败**：返回 `{ code, message, _empty?, raw? }`，便于 bridge 统一处理。
4. **路由**：若存在 PC/mobile 双端，在 `this.routes` 中增加对应 key（可选）。

参考现有：`commentEmotion`、`forwardEmotion`、`likeEmotion`。

## 四、Bridge Action

在 `src/bridge/actions.ts` 中：

1. **新 action**：如 `action_like_comment`，解析参数（`target_uin`、`target_tid`、`comment_id` 等），调用 `this.client.likeComment(...)`。
2. **成功**：`return ok(null, echo)`。
3. **失败**：`return fail(1500, msg, echo)`，`msg` 可含 `code`/`ret`/`raw` 摘要。
4. **路由注册**：若使用统一 `action_${action}` 映射，只需保证 OneBot 侧 action 名与 `action_` 后缀一致（如 `like_comment` → `action_like_comment`）。

在 `src/main.ts` 或路由表中确认新 action 已被暴露为 HTTP/WS 接口（若项目是集中注册则可能无需改）。

## 五、降级与兼容

- 若接口有多个变体（如 PC + mobile），在 client 内先试主用，失败再试备用，并记录「当前可用」变体。
- 在 [fallback-strategy.md](fallback-strategy.md) 中补充该接口的降级顺序与触发条件（可选）。
- 在 [compatibility-matrix.md](compatibility-matrix.md) 中增加一行：接口名、方法、域名、可靠性、备注。

## 六、测试

- **单元**：若有纯逻辑（如解析），在 `test/unit/` 加用例。
- **接口**：在 `test/api-interfaces.ts` 的只读/写操作块中增加对新 action 的调用与断言；若为写操作且可能失败，可标为可选（不阻塞全量通过）。
- 运行：`npx tsx test/run-all.ts --api --interfaces [--write]`。

## 七、更新清单

- [qzone-feature-matrix.md](qzone-feature-matrix.md)：将该功能状态改为「✅ 已实现」并填接口/实现列。
- [feature-backlog.md](feature-backlog.md)：将对应行改为已实现，并更新执行顺序建议。
- [README.md](../README.md)：在功能列表或 API 表中加入新接口与参数（若有对外文档）。

---

## 循环：下一项

从 [qzone-feature-matrix.md](qzone-feature-matrix.md) 中选下一个「⏳ 待抓包」或「❌ 未实现」项，重复 **§1 抓包 → §2 文档 → §3 Client → §4 Action → §5 降级 → §6 测试 → §7 更新清单**，即可持续逼近「QQ 空间所有功能」的实现。
