# qzone-bridge

QQ空间 → OneBot v11 协议桥接服务（TypeScript 原生实现）。

通过逆向 QZone Web API，将 QQ 空间的说说、评论、点赞等功能暴露为标准 [OneBot v11](https://github.com/botuniverse/onebot-11) 接口，并提供 **NapCat 原生插件** 以零配置接入 NapCat 生态。

**相关项目**：[OpenClaw](https://github.com/openclaw/openclaw) 用户可搭配 [openclaw-napcat-qq](https://github.com/Gu-Heping/openclaw-napcat-qq) 插件，通过 Agent 工具（如 `qzone_get_friend_feeds`、`qzone_get_posts`）调用本桥接。联调与验收清单见 **[`doc/openclaw-acceptance.md`](doc/openclaw-acceptance.md)**。

> 本项目仅供学习交流，请勿用于非法用途。

---

## 功能特性

| 类别 | 内容 |
|------|------|
| **说说** | 发布/删除/查看，支持图片上传（含相册）、视频提取（MP4/封面/时长） |
| **互动** | 评论（含二级回复/艾特解析/表情转换）、点赞/取消点赞（feeds3 HTML 点赞详情 + `qz_opcnt2` 计数兜底）、转发 |
| **信息查询** | 访客列表（含来源映射）、好友列表、用户信息、头像/昵称、相册/照片管理、设备信息（手机型号） |
| **流量统计** | 说说的点赞/浏览/评论/转发 计数（`qz_opcnt2`） |
| **隐私管理** | 设置说说公开/私密权限（`ugc_right`） |
| **事件推送** | 新说说、新评论（含详情）、新点赞实时上报（独立定时器，bestEffort 降级）、好友说说订阅 |
| **Cookie 保活** | 每 10 分钟自动探活，失效及时告警 |
| **OneBot v11** | HTTP API / WebSocket / 反向 WebSocket / HTTP POST |
| **NapCat 原生** | `napcat-plugin/` 提供无侵入代理插件 |

### 反限流 & 智能路由

- 说说列表只走 `feeds3_html_more`（PC `emotion_cgi_msglist_v6` 在实测中稳定返回 `-10000`）
- **评论列表**：`getCommentsBestEffort` 以 **feeds3 HTML**（好友流、作者 `scope=1`、未命中则 **`feeds_html_act_all` 分页**）解析为主；PC/mobile 评论接口在多数环境下不可用，见 [`doc/api-probe-results.md`](doc/api-probe-results.md)
- 说说详情：PC `getdetailv6` 多路失败后可用 **列表 / `act_all` 兜底**（返回中常见 `success (from act_all list)` 类 `message`）
- **点赞列表/监听**：`getLikeListBestEffort` **feeds3-only**，从 feeds3 HTML 解析点赞者（QQ / 昵称 / 时间 / 个性赞图标）；feeds3 只覆盖最近点赞，剩余用 **`qz_opcnt2` 计数兜底**，结合缓存用户信息尽可能填充事件详情
- **是否已点赞**：feeds3 说说列表常带 **`isLiked`**；**`get_like_list` 解析结果可能与 `traffic.like` 不一致**（列表仅覆盖当前 HTML 能展开到的点赞人，非全量）
- 点赞使用 `internal_dolike_app` → `like_cgi_likev6` → Mobile 三级 fallback
- 图片 URL 提取优先级：`url2` → `url3` → `url1` → `smallurl`（高清优先）
- feeds3 LRU 缓存采用 O(1) Map 插入序逐出
- feeds3 深度解析：视频元数据（MP4/封面/时长/尺寸）、二级回复、艾特用户、设备信息、表情转换
- **请求指纹随机化**：User-Agent/Accept-Language 随机化 + 轮询间隔抖动（±20%），降低风控识别风险
- 可选 Playwright 提取 `qzonetoken`
- 服务器环境自动 headless 检测（`$DISPLAY`），系统 Chrome 自动发现

### 运行时校验 & 防御层

- **Zod Schema 校验**：10 套响应 Schema，对关键接口返回值做运行时类型校验，解析异常自动转存原始响应
- **统一请求层**：JSONP 自动拆包、反爬检测（9 种模式）、auth 失败码集合 `{-3, -100, -3000, -10001, -10006}`、限流码集合 `{-10000, -2}`
- **原始响应日志**：校验失败或反爬触发时自动写入 `logs/raw_responses/`，单文件上限 5 MB，目录自动裁剪至 500 文件
- **端点健康检查**：`npm run verify:readonly` 一键验证 9 个读接口可用性；不加 `--skip-write` 时另含 2 组写接口抽检
- **HTTP 桥接抽检**：`npm run verify:http`（需 bridge 已启动）校验 `get_login_info` / `check_cookie` / `get_stranger_info` 等与昵称一致性
- **全量工具对齐**：`npm run verify:tools` 按 OpenClaw `qzone_*` 对应 action 逐项请求；`--write` 会发临时说说并删除、对样本 tid 点赞再取消

### 好友列表与 `friends.json`

好友列表优先走官方接口 `cgi_get_friend_list`；若失败或为空，则从**好友动态（feeds3）**里"谁发过言"推断并写入 `test_cache/friends.json`。因此**缓存里的人数 = 最近拉取到的动态里出现过的不同人数**，不一定等于你的全部好友。

- 要**全量好友**：设置 `QZONE_FRIEND_PLAYWRIGHT=1`，用浏览器打开好友管理页抓取并写入缓存（需本机有 Chrome/Edge）。

### OpenClaw 工作区约定（feeds / posts 分工）

与 [OpenClaw](https://github.com/openclaw/openclaw) 配合时，工作区 `memory/qzone/` 建议采用以下约定，避免工具混用与内容冲突：

| 用途 | 路径/接口 | 约定 |
|------|-----------|------|
| **今日是否已发说说** | `memory/qzone/feeds/{今日日期}.md` | 仅用于判断（看 `[发布]` 或 `[状态]`）；**不**存今日动态流水，**不**作检索内容源。 |
| **说说存档与灵感** | `memory/qzone/posts/self/`、`posts/friends/{uin}/` | 仅同步脚本写入；Agent 用 `memory_search` 或按路径读。**不**用于判断今日是否已发。 |
| **当次好友动态** | 接口 `get_emotion_list` / `get_friend_feeds` | Agent 当次调用结果**仅当次使用**，**不写回** feeds。 |

同步脚本（如 OpenClaw 侧的 `qzone-sync-posts.js`）可调用本桥接的 `get_emotion_list` 写入 `posts/self/`，再根据是否有今日帖子写 `feeds/{今日}.md` 的 `[状态]`；若 feeds 文件已含 `[发布]` 则保留不覆盖。详见 OpenClaw 工作区内的 `QZONE.md`、`memory/qzone/README.md`。

---

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env` 并按需修改：

```bash
cp .env.example .env
```

关键配置项：

```env
# 服务监听
ONEBOT_HOST=0.0.0.0
ONEBOT_PORT=5700
ONEBOT_ACCESS_TOKEN=your_token_here

# 登录（必选其一）：Cookie 或 二维码
QZONE_COOKIE_STRING=uin=o你的QQ; p_uin=o你的QQ; skey=xxx; p_skey=yyy
# QZONE_ENABLE_QR=1   # 不填 Cookie 时可设为 1，启动后扫 test_cache/qrcode.png

QZONE_CACHE_PATH=./test_cache

# 首次启动（无基线状态文件时）静默记录已有说说/评论/点赞，见下方「首次启动基线」
# ONEBOT_BASELINE_ON_FIRST_RUN=1

# 轮询间隔（秒）默认值：说说 60 / 评论 120 / 点赞 180 / 好友动态 120
# ONEBOT_POLL_INTERVAL=60
# ONEBOT_COMMENT_POLL_INTERVAL=120
# ONEBOT_LIKE_POLL_INTERVAL=180
# ONEBOT_FRIEND_FEED_POLL_INTERVAL=120

# Playwright 配置（可选）
# QZONE_PLAYWRIGHT_HEADLESS=    # 空=自动检测, 1=强制headless, 0=强制headed
# QZONE_PLAYWRIGHT_EXECUTABLE=  # 自定义 Chrome 路径
# QZONE_PLAYWRIGHT_CHANNEL=chrome
```

> **端口注意**：示例统一使用 `5700`；若未设置 `ONEBOT_PORT`，代码内置默认端口为 **8080**（README 旧示例、部分脚本因此仍以 8080 为兜底）。

详细登录步骤见下方 [如何登录](#如何登录)。

### 3. 启动服务

```bash
# 开发模式（ts 直接运行）
npm run dev

# 生产模式（先编译后运行）
npm run build
node dist/main.js
```

### 通过日志查看事件监听状态

启动后日志会打印一行 **事件监听** 配置，例如：

```
[INFO] 事件监听: 说说=true 评论=true 点赞=true 好友动态=false 心跳=true | 轮询源=auto 间隔=60s
```

- **说说/评论/点赞/好友动态/心跳**：对应 `ONEBOT_EMIT_MESSAGE_EVENTS`、`ONEBOT_EMIT_COMMENT_EVENTS`、`ONEBOT_EMIT_LIKE_EVENTS`、`ONEBOT_EMIT_FRIEND_FEED_EVENTS`、`ONEBOT_EMIT_HEARTBEAT_EVENTS`（未设时默认：前三项与心跳 true，好友动态 false）。
- **推送事件中附带图片 base64**：`ONEBOT_ATTACH_IMAGE_DATA`（默认 1；设为 0 关闭）。
- **轮询源**：`ONEBOT_EVENT_POLL_SOURCE`（`pc` / `mobile` / `auto`）。
- **间隔**：`ONEBOT_POLL_INTERVAL`（秒，默认 60）。

若设置 `ONEBOT_EVENT_DEBUG=1`，可通过以下关键字在日志中确认事件是否在推送：

| 关键字 | 含义 |
|--------|------|
| `[Poller:DEBUG] pollMyPosts got N items` | 主轮询拉到的说说条数 |
| `[Poller:DEBUG] publishing event type=` | 正在向 hub 推送事件 |
| `[Poller:DEBUG] publish done, subscribers=N` | 推送完成，当前订阅数（WS/HTTP 连接数） |
| `[Poller:DEBUG] pollComments` / `publishing comment event` | 评论轮询与评论事件推送 |
| `HTTP/WS 服务器启动: http://...` | 服务已监听，可接收 WS 连接 |

- **systemd（user 单元）**：`journalctl --user -u onebot-qzone -f` 实时看日志；若服务将 stdout 重定向到文件，则直接 `grep 事件监听` 或 `grep Poller` 该文件。

### 首次启动基线（避免历史事件轰炸）

首次启动（缓存目录中还没有 `baseline_state.json`）时，桥接会先**静默建立基线**：把当前拉到的说说、这些说说的历史评论/点赞、好友动态首页全部标记为“已见”，**不推送**任何历史事件；只有基线完成后新增的互动才会照常推送。

- 基线状态持久化在 `{QZONE_CACHE_PATH}/baseline_state.json`，中途崩溃后重启会继续未完成的评论/点赞基线。
- 基线期间评论/点赞计数会用当前列表长度与 `qz_opcnt2` 播种，避免随后误报“计数增加”合成事件。
- 需要**回放历史事件**时：设置 `ONEBOT_BASELINE_ON_FIRST_RUN=0`，并使用干净的缓存目录（或删除 `baseline_state.json` 与 seen 状态）后启动。
- 只想**抑制历史事件**、不想走基线流程时：先停 bridge，运行 `npm run catch-up-seen` 显式回填 seen 状态。
- 升级旧缓存（已存在 `seen_post_tids.json` / `seen_interactive_state.json`）时，基线会自动视为已完成，不会重复吸收。

---

## 如何登录

登录优先级：**已保存的 Cookie 文件** → **环境变量 Cookie** → **二维码扫码**。  
若缓存的 `cookies.json` 失效，会自动清除并尝试环境变量或扫码。

---

### 方法一：Cookie 字符串（推荐，免扫码）

1. 浏览器打开 [QQ 空间](https://user.qzone.qq.com)，用 QQ 号登录。
2. 按 F12 → **Application**（应用）→ 左侧 **Storage** → **Cookies** → 选 `https://user.qzone.qq.com`。
3. 在列表里找到并复制以下字段，拼成一行（用分号分隔）：
   - **uin**（或 p_uin）
   - **skey**
   - **p_skey**
4. 写入 `.env`：

```env
QZONE_COOKIE_STRING=uin=o你的QQ号; p_uin=o你的QQ号; skey=xxx; p_skey=yyy
```

也可用 `QZONE_COOKIE`，效果相同。  
Cookie 过期后接口会返回 1401，需重新从浏览器复制并更新 `.env` 或调用下方 API 更新。

**运行时通过 API 提交 Cookie（无需重启）：**

```http
POST /login_cookie
Content-Type: application/json

{"cookie": "uin=o123456789; p_uin=o123456789; skey=xxx; p_skey=yyy"}
```

成功后会写入 `QZONE_CACHE_PATH/cookies.json`，下次启动自动使用。

---

### 方法二：二维码扫码（Playwright 浏览器）

未配置 Cookie 或 Cookie 失效时，若开启二维码登录，会通过 Playwright 启动真实浏览器生成二维码。

> **前置要求**：本机需安装 Chrome 或 Edge 浏览器。程序会按以下顺序查找：
> 1. `QZONE_PLAYWRIGHT_EXECUTABLE` 环境变量指定的路径
> 2. `QZONE_PLAYWRIGHT_CHANNEL`（默认 `chrome`）
> 3. 系统 Chrome（自动检测 `/usr/bin/google-chrome-stable` 等常见路径）
> 4. Playwright 内置 Chromium（需 `npx playwright install chromium`）

1. 在 `.env` 中设置：

```env
QZONE_ENABLE_QR=1
```

2. 启动服务：`npm run dev`
3. 打开 **缓存目录下的二维码图片**（默认 `test_cache/qrcode.png`），用手机 QQ 扫一扫。
   - 日志中会打印二维码文件的**绝对路径**，方便在服务器上定位。
   - 图片每 10 秒自动刷新，5 分钟内有效。
4. 扫码成功后 Cookie 会写入 `test_cache/cookies.json`，下次启动自动复用。

#### 服务器/无头环境

在没有图形桌面的服务器上，程序会自动检测 `$DISPLAY` 环境变量：

- **无 `$DISPLAY`**：自动切换为 headless 模式，二维码保存到文件，通过 `scp`/SFTP 等方式下载扫描。
- **有 Xvfb**：设置 `DISPLAY=:99 npm run dev` 即可在虚拟显示器中运行有头浏览器。
- **强制控制**：设置 `QZONE_PLAYWRIGHT_HEADLESS=1` 强制 headless，或 `=0` 强制 headed。

```bash
# 服务器典型用法（自动 headless）
npm run dev

# 使用 Xvfb 虚拟显示器
DISPLAY=:99 npm run dev

# 强制 headless
QZONE_PLAYWRIGHT_HEADLESS=1 npm run dev
```

---

### 登录状态说明

| 现象 | 说明 |
|------|------|
| 启动提示「已登录（缓存有效）」 | 上次的 Cookie 仍有效，无需操作 |
| 启动提示「已缓存 Cookie 已失效」 | 缓存被清除，将用环境变量或二维码重新登录 |
| 接口返回 1401 / 登录无效 | Cookie 过期或未登录，请重新复制 Cookie 或扫码 |

---

## API 参考

所有接口与 OneBot v11 标准兼容，以下为 QZone 扩展接口：

共 **40 个** `action_*` 接口：

**登录 / 状态**

| Action | 说明 | 主要参数 |
|--------|------|----------|
| `get_login_info` | 当前登录 QQ 与昵称 | — |
| `get_status` | 在线状态、轮询器状态 | — |
| `check_cookie` | 校验 Cookie 是否有效（默认发起网络探针） | `probe`（默认 true；false 仅检查 `p_skey`/`skey` 是否存在） |
| `get_version_info` | 桥接版本信息 | — |
| `login_cookie` | Cookie 登录并写入 `cookies.json` | `cookie` / `cookie_string` |
| `update_cookie` | 更新 Cookie，覆盖会话并同步写回缓存与 `.env` | `cookie` / `cookie_string` |
| `login_qr` | 触发二维码重新登录（先登出） | — |
| `logout` | 退出登录 | — |

**说说**

| Action | 说明 | 主要参数 |
|--------|------|----------|
| `send_msg` / `send_private_msg` | 发布说说 | `message`（支持 CQ 码图片）；@ 人用 `@{uin:QQ号,nick:昵称}` |
| `send_group_msg` | QZone 无群聊概念，等价于 `send_private_msg` | 同上 |
| `delete_msg` | 删除说说 | `message_id` / `tid` |
| `get_msg` | 获取说说详情（best-effort） | `user_id`, `message_id` / `tid` |
| `get_emotion_list` | 获取说说列表（feeds3） | `user_id`, `pos`, `num`, `max_pages`；可选 `cursor` / `next_cursor`；默认附带图片 base64（`include_image_data=false` 可关闭）。返回含 `has_more`、`next_pos`、`next_cursor`、`_page_info` |
| `get_friend_feeds` | 获取好友动态流（feeds3，游标分页） | `cursor` / `num` / `count`；`fast_mode` 默认 `1`；`include_image_data`；含好友与 HTML 中出现的本人动态（排除 appid=217 等噪音） |
| `get_feeds_html_act_all` | 直接解析 `feeds_html_act_all` 分页 HTML | `feed_owner` / `owner_qq`（封装为某 QQ 空间页）, `start`, `count`, `scope`, `all_pages`, `max_rounds`, `include_image_data`, `include_raw_snippet` |
| `get_feed_images` | 获取指定说说的图片 URL 列表 | `user_id`, `tid` / `message_id` |
| `forward_msg` | 转发说说 | `user_id`, `tid`, `content` |
| `set_emotion_privacy` | 设置说说隐私 | `tid`, `privacy`（`private`/`public`） |

**互动**

| Action | 说明 | 主要参数 |
|--------|------|----------|
| `send_comment` | 发送评论 / 二级回复 | `target_uin`, `target_tid` / `tid`, `content`, `reply_comment_id`, `reply_uin` |
| `delete_comment` | 删除评论 | `uin` / `user_id`, `tid`, `comment_id`, `comment_uin` |
| `get_comment_list` | 获取评论列表（feeds3 best-effort） | `user_id`（说说作者）, `tid`, `num`, `pos` |
| `send_like` | 点赞说说 | `tid`, `user_id`（可选）, `abstime`, `appid`, `typeid`, `unikey`, `curkey` |
| `unlike` | 取消点赞 | 同上 |
| `get_like_list` | 获取点赞列表（feeds3 best-effort，非全量） | `user_id`, `tid` |
| `get_traffic_data` | 获取说说流量统计（点赞/浏览/评论/转发） | `user_id`, `tid` |

**用户 / 好友**

| Action | 说明 | 主要参数 |
|--------|------|----------|
| `get_friend_list` | 获取好友列表 | — |
| `get_stranger_info` | 获取用户信息 | `user_id` |
| `get_portrait` | 获取头像和昵称 | `user_id` |
| `get_visitor_list` | 获取访客列表（含来源映射） | `user_id`（可选） |

**相册 / 图片**

| Action | 说明 | 主要参数 |
|--------|------|----------|
| `get_album_list` | 获取相册列表 | `user_id`（可选） |
| `get_photo_list` | 获取照片列表 | `album_id`, `user_id`（可选）, `num` |
| `create_album` | 创建相册 | `name`, `desc`, `priv` |
| `delete_album` | 删除相册 | `album_id` |
| `delete_photo` | 删除照片 | `album_id`, `photo_id` / `lloc`, `user_id`（可选） |
| `upload_image` | 上传图片到相册 | `base64` / `file` 或 `url`，`album_id`（可选） |
| `fetch_image` | 使用桥接 Cookie 拉取 QZone 图片（返回 base64）<br>仅接受白名单域名（qpic.cn、photo.store.qq.com、qlogo*.store.qq.com、qzonestyle.gtimg.cn） | `url` 或 `urls` |

**调试 / 维护**

| Action | 说明 | 主要参数 |
|--------|------|----------|
| `probe_api_routes` | 探测可用接口路由 | `uin`, `tid` |
| `probe_capabilities` | 探测当前账号可用的能力（需登录） | — |
| `reset_api_caches` | 清除接口缓存 | — |

> 视频元数据、艾特解析、表情转换、设备信息等是 feeds3 解析链路的内置能力（随说说字段返回），**没有**独立 action。

**说说图片与 base64**：默认情况下，`get_emotion_list` / `get_friend_feeds` 会在每条说说的 `pic` 项中附带 `base64`（桥接用 Cookie+Referer 向 QZone CDN 拉取），单条最多 5 张、单次响应最多 20 张；传 `include_image_data=false` 可关闭以省流量。推送的新说说事件中也会默认附带图片 base64（`message` 中 image 段带 `file: 'base64://...'`），可通过环境变量 `ONEBOT_ATTACH_IMAGE_DATA=0` 关闭。单独拉取某张图时可用 `fetch_image`（参数 `url` 或 `urls`），仅接受白名单域名（`qpic.cn`、`photo.store.qq.com`、`qlogo1/2.store.qq.com`、`qzonestyle.gtimg.cn`）。

**与 openclaw-napcat-qq 配合**：搭配 [openclaw-napcat-qq](https://github.com/Gu-Heping/openclaw-napcat-qq) 时，插件会将上述 base64 写入临时文件并在 `qzone_get_friend_feeds` / `qzone_get_posts` 结果中返回**本地路径**，Agent 用 **image** 工具传入该路径即可识图。插件 **`qzone_get_posts`** 的 **`cursor`** 参数与桥接 **`get_emotion_list`** 的 **`cursor`/`next_cursor`** 对齐，翻页以工具结果 `_meta.next_call` 为准。若图片拉取出现 502，请将腾讯 CDN 域名（如 `photo.store.qq.com`、`qpic.cn`、`qzonestyle.gtimg.cn`）设为代理 **DIRECT**，详见 [docs/SERVER_DEBUG.md](docs/SERVER_DEBUG.md)。

---

## NapCat 原生插件

`napcat-plugin/` 是一个 NapCat 原生插件，将本桥接服务的 REST API 和事件流直接代理给 NapCat 下游客户端，支持断线自动重连。

### 构建插件

```bash
npm run build:plugin
# 输出到 napcat-plugin/dist/index.mjs
```

### 插件配置项

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `bridgeRest` | 桥接服务 REST 地址 | `http://127.0.0.1:5700` |
| `bridgeWsEvent` | 桥接服务事件 WS | `ws://127.0.0.1:5700/event` |
| `listenHost` | 插件监听 Host | `0.0.0.0` |
| `listenPort` | 插件监听端口 | `5800` |
| `accessToken` | 鉴权 Token | `` |
| `reconnectDelay` | 断线重连间隔（秒） | `5` |

---

## 开发与测试

### npm 脚本一览

```bash
npm run dev              # 开发模式运行
npm run build            # 编译主项目
npm run build:plugin     # 编译 NapCat 插件
npm run test             # 运行全部单元测试（自动发现 test/unit/*.test.ts）
npm run test:unit        # 同上
npm run test:api         # 单元 + API 集成测试
npm run test:api:readonly # 单元 + 只读 API 测试
npm run test:all         # 全量测试
npm run typecheck        # TypeScript 类型检查
npm run typecheck:plugin # NapCat 插件类型检查
npm run verify           # 端点健康检查（读 + 写）
npm run verify:readonly  # 端点健康检查（仅读接口，9 项读）
npm run verify:http      # 对已启动 bridge 做 HTTP 登录/昵称抽检
npm run verify:tools     # HTTP 对齐全部 qzone 工具对应 action（可加 --write / --strict）
npm run like:instant     # 即时点赞流水线（默认真实点赞，先 --dry-run 验证；见 docs/INSTANT_LIKE.md）
npm run like:browser     # 实验性 Playwright 点赞脚本（会真实点赞）
npm run login:qr         # 二维码重新登录（默认已登录则直接提示；--force 强制重登）
npm run probe:doc        # 探测接口可用性并打印结果（不写文档）
npm run catch-up-seen    # 真实接口回填 seen_post + seen_interactive_state（建议停 bridge 后跑）
```

### 测试说明

- **单元测试**：runner 自动发现 `test/unit/*.test.ts`，无需手写清单；当前为 **25 个套件 / 193 个用例**（以运行输出为准），纯本地运行不需要登录。
  - 只跑匹配的套件：`npm test -- --suite feeds3`（按文件名子串过滤，无匹配时报错退出）。
- **API 测试**：需先启动 bridge 并登录，`--readonly` 模式仅验证读接口；默认端口读取 `ONEBOT_PORT`，否则 8080；设置 `ONEBOT_ACCESS_TOKEN` 时会自动带 Bearer 鉴权。bridge 不可达时 runner 以退出码 1 失败。
- **端点健康检查**：`scripts/verify-endpoints.ts`，默认检验 9 个读 + 2 组写操作，输出彩色 PASS/FAIL/SKIP 报告。
- **真实数据导出（人工核对）**：`scripts/dump-friend-feeds-once.ts` → `feeds_manual_dump.json`；`scripts/dump-comments-for-feeds-once.ts` → `comments_manual_dump.json`（按动态 `tid`/`uin` 调 `getCommentsBestEffort`，feeds3 评论；仅当该帖在拉取到的好友流 HTML 里**嵌了评论区**时才有条目）。
- **HTTP 全量工具**：`scripts/verify-all-qzone-tools-http.ts`（`verify:tools`），对 `127.0.0.1:ONEBOT_PORT` 真实 POST；加 **`--strict`** 时除「有返回」外还要求首条说说/详情等结构完整；`fetch_image` 白名单含 `qlogo*.store.qq.com` 等与头像 URL 一致。
- **真实数据回归**：`npx tsx test/verify-real-feeds.ts`（需配置 Cookie）会校验 getEmotionList/getFriendFeeds、归一化结果，并输出含图说说数、多级评论（一级/二级/有回复的帖子数）、含图评论数。

### Bot 重复回复评论 / 验收脚本副作用

- **根因（桥接）**：轮询发现「新评论」会上报 EventHub。若 **评论者就是当前登录号**（Bot 在自己空间下自评），旧逻辑仍会推送，上游再自动回复 → **死循环**。已在 `poller` 中 **跳过推送本人评论与本人点赞**（仍会记入 `seen*`，避免反复当「新」）。
- **他人评论也重复推送**：`trackTids` 超过上限会 **裁剪**旧 tid；此前实现会同时 **删掉** `seenCommentIds` / `seenLikeUins`。该帖再次进入「最近说说」后，所有旧评论会被当成全新 → **同一评论多次上报**。现已 **保留**已见评论/点赞集合，仅删 `commentWarmTids` / `knownCounts` 等与「是否见过」无关的缓存。
- **重启后又把旧评论当新的**：`seenCommentIds` / `seenLikeUins` / `knownCounts` 会持久化到 `{QZONE_CACHE_PATH}/seen_interactive_state.json`，与 `seen_post_tids.json` 一样随轮询定期落盘。评论在 **仅 feeds3 HTML 可用** 时，`data-tid` 常为短楼层号，去重键由 `src/bridge/commentDedup.ts` 生成：**短纯数字**走内容指纹 `h:tid:…`，**长数字或含 `_r_` 的合成 id** 走 `id:tid:…`；事件里的 `comment_id` 仍为原始值。若需**立刻**回填，先停 bridge 再 `npm run catch-up-seen` 后重启。若某帖仍拉不到评论列表，计数会尽量用 `qz_opcnt2` 对齐。
- **验收脚本**：`verify:tools --write` 会真实发说说、点赞，**会触发 WS 事件**；读请求也会更新评论缓存。生产验收可临时关 `ONEBOT_EMIT_COMMENT_EVENTS` 等，详见脚本文件头说明。

### 调试获取评论

获取评论走 `getCommentsBestEffort`，**feeds3-only**：优先命中内存中的 feeds3 评论桶；未命中时依次拉取

1. 好友动态流 `feeds3_html_more`（最近帖大多在这里）
2. 作者空间 `scope=1`
3. `feeds_html_act_all` 分页直到命中或翻完

调试时可：

1. **看日志**：`feeds3Comments 缓存未命中，拉取 HTML 解析`、`好友流解析后 tid=… 条数=N`、`作者空间解析后 …`、`feeds_html_act_all 第 N 页命中 …`。可用 `ONEBOT_EVENT_DEBUG=1` 获取更多轮询侧日志。
2. **dump 原始 HTML**：设置 `QZONE_DEBUG_DUMP=1`，每次 feeds3 请求会把 HTML 写入 `{QZONE_CACHE_PATH}/debug/`，文件名如 `feeds3_<uin>_<scope>.html`，便于对照解析结果。
3. **直接调接口**：先启动 bridge，再 `POST http://127.0.0.1:${ONEBOT_PORT}/get_comment_list`，body `{"tid":"你的说说tid","user_id":"说说的作者QQ","num":20,"pos":0}`，查看返回的 `data` 及日志中的评论数。

**获取评论返回空 /「暂无评论」— 可能原因（先定位再修）**

1. **user_id 传错**  
   `user_id` 必须是**该条说说的作者**（发动态的人），不是当前登录的 bot。feeds3 的作者空间兜底会用这个号（`scope=1`）拉取；传错容易返回空。

2. **tid 格式不一致**  
   - feeds3 HTML 里的说说 key 通常是一串 hex（如 `3ea22c2e8e25ac69aa7f0500`），部分来源会给 **abstime**（十进制时间戳，如 `1772905792`）。  
   - 桥接内部会做 tid 别名归一（`resolveTidForComments`），但前提是缓存里已有该帖的映射。  
   **建议**：从 `get_emotion_list` 或推送事件里取**同一条说说**的 `tid` 和作者 `uin`，用这一对去调 `get_comment_list`。

3. **该帖不在当前 feeds3 页面**  
   feeds3 HTML 只内嵌「最近拉取到的那批说说」的评论区；三天前或更早的帖子即使计数显示有评论，也可能拉不到详情（`availability: not_embedded`），此时只能依赖 `qz_opcnt2` 计数。

---

## 项目结构

```
src/
├── main.ts                # 入口
├── qzone/
│   ├── types.ts           # 共享类型定义
│   ├── utils.ts           # 工具函数（calcGtk、parseJsonp 等）
│   ├── cookieStore.ts     # Cookie 持久化
│   ├── client.ts          # QzoneClient 主类（登录 + 全部 API）
│   ├── emoji.ts           # 表情名映射
│   ├── playwrightHelper.ts # Playwright 浏览器/二维码辅助
│   ├── feeds3Parser.ts    # Barrel：feeds3 解析聚合导出
│   ├── feeds3/            # feeds3 子模块
│   │   ├── preprocess.ts / content.ts
│   │   ├── items.ts / comments.ts / likes.ts / meta.ts
│   │   ├── feedDataCanonical.ts / tidParams.ts
│   │   └── helpers.ts
│   ├── config/            # env.ts（QZONE_* 统一入口）、constants.ts
│   ├── infra/             # errors.ts、retry.ts
│   ├── schemas.ts         # Zod 运行时校验 Schema（10 套）
│   ├── validate.ts        # 校验入口（validateApiResponse / validateOrThrow）
│   ├── requestLayer.ts    # 统一请求层（JSONP 拆包 / 反爬检测 / 业务码提取）
│   └── rawLogger.ts       # 原始响应日志（校验失败时自动转存）
├── bridge/
│   ├── config.ts          # 配置（fromEnv）
│   ├── hub.ts             # EventHub 发布订阅
│   ├── poller.ts          # 轮询器（说说/评论/点赞/好友动态）
│   ├── firstRunBaseline.ts # 首次启动静默基线状态
│   ├── commentDedup.ts    # 评论去重键
│   ├── stablePostKey.ts   # 说说稳定键
│   ├── instant-like-*.ts  # 即时点赞流水线（候选/状态/feed源/缓存）
│   ├── actions.ts         # OneBot action 处理器
│   ├── server.ts          # HTTP + WS 服务器
│   ├── network.ts         # HTTP POST 推送 + 反向 WS
│   └── utils.ts           # 工具（safeInt、SSRF 拦截）

napcat-plugin/
└── src/index.ts           # NapCat 原生插件

scripts/
├── verify-endpoints.ts          # 端点健康检查脚本
├── verify-bridge-http.ts        # HTTP 登录/昵称抽检
├── verify-all-qzone-tools-http.ts # OpenClaw 工具全量 HTTP 对齐
├── probe-doc-endpoints.ts       # 探测接口可用性（只打印，不写文档）
├── catch-up-seen-state.ts       # 回填 seen 状态缓存
├── instant-like.ts              # 即时点赞流水线入口
├── like-browser.ts              # 实验性 Playwright 点赞脚本
├── qr-login.ts                  # 二维码重新登录
├── dump-friend-feeds-once.ts    # 真实数据导出（好友动态）
├── dump-comments-for-feeds-once.ts # 真实数据导出（评论）
├── dump-html-vs-parse-audit.ts  # HTML vs 解析结果对比审计
├── inspect-feed-html-slice.ts   # 单条 HTML 片段调试
└── verify-feeds3-comments-alignment.ts # feeds3 评论对齐验证

test/
├── run-all.ts             # 测试运行器（自动发现 unit/）
├── test-helpers.ts        # 测试工具函数
├── api-interfaces.ts      # API 集成测试
├── debug-friend-feeds-local.ts # 本地好友动态/图片拉取调试
└── unit/                  # 单元测试（25 套件 / 193 用例，以运行输出为准）

doc/                       # QZone 逆向分析文档
├── README.md              # 文档索引
├── api-overview.md        # API 总览
├── api-probe-results.md   # 接口探测结果（-10000/500/404 等）
├── auth.md                # 认证机制
├── board-api.md           # 留言板接口
├── compatibility-matrix.md # 接口可用性矩阵
├── deep-reverse-findings.md # 深度逆向发现汇总
├── emotion-api.md         # 说说接口
├── social-api.md          # 社交互动接口（评论/点赞/转发）
├── feeds3-parser.md       # feeds3 HTML 解析（含视频/二级回复/艾特）
├── photo-api.md           # 相册/照片接口
├── user-api.md            # 用户信息接口
├── fallback-strategy.md   # 降级策略
├── qzone-feature-matrix.md # 功能矩阵
├── qzone-specified-user-diagnosis.md # 指定用户诊断
├── reverse-engineering-guide.md # 逆向工程指南
├── openclaw-acceptance.md # OpenClaw 验收清单
├── feature-backlog.md     # 功能待办
└── 获取说说流程说明.md    # 中文流程说明

docs/
├── SERVER_DEBUG.md        # 服务器图片 CDN / base64 排查
└── INSTANT_LIKE.md        # 即时点赞流水线说明

deploy/
└── onebot-qzone.user.service.example # systemd user 单元示例
```

---

## 技术栈

- **运行时**：Node.js ≥ 18，ESM
- **语言**：TypeScript 5.7
- **HTTP 客户端**：axios + axios-cookiejar-support + tough-cookie
- **WebSocket**：ws
- **运行时校验**：zod v4
- **并发控制**：p-limit（最大 10 并发）
- **构建工具**：tsup

---

## 致谢

本项目在开发过程中参考了以下优秀的开源项目，在此表示感谢：

- **[astrbot_plugin_qzone](https://github.com/Zhalslar/astrbot_plugin_qzone)** — AstrBot 框架的 QQ 空间插件。本项目参考了其 `internal_dolike_app` 点赞接口实现、图片 URL 优先级策略、feeds3 HTML 解析模式以及视频提取逻辑。
- **[OpenCamwall](https://github.com/Cles4Zhalslar/OpenCamwall)** — 开源校园表白墙系统。本项目参考了其 `qz_opcnt2` 流量统计接口、`emotion_cgi_update` 说说隐私设置、`cgi_get_portrait.fcg` 头像/昵称获取（GBK 解码）以及 Cookie 保活心跳机制。
- **[nonebot-adapter-qzone](https://github.com/qzqzcsclub/nonebot-adapter-qzone)** — NoneBot2 的 QQ 空间适配器。本项目参考了其 ptlogin2 QR 扫码登录流程、Cookie 定时维护机制、`emotion_cgi_publish_v6` 图片发布参数组装以及 Session 架构设计。

---

## License

[MIT](LICENSE)
