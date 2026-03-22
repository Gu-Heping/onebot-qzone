# qzone-bridge

QQ空间 → OneBot v11 协议桥接服务（TypeScript 原生实现）。

通过逆向 QZone Web API，将 QQ 空间的说说、评论、点赞等功能暴露为标准 [OneBot v11](https://github.com/botuniverse/onebot-11) 接口，并提供 **NapCat 原生插件** 以零配置接入 NapCat 生态。

**相关项目**：[OpenClaw](https://github.com/openclaw/openclaw) 用户可搭配 [openclaw-napcat-qq](https://github.com/Gu-Heping/openclaw-napcat-qq) 插件，通过 Agent 工具（如 `qzone_get_friend_feeds`、`qzone_get_posts`）调用本桥接。

> 本项目仅供学习交流，请勿用于非法用途。

---

## 功能特性

| 类别 | 内容 |
|------|------|
| **说说** | 发布/删除/查看，支持图片上传（含相册）、视频提取（MP4/封面/时长） |
| **互动** | 评论（含二级回复/艾特解析/表情转换）、点赞/取消点赞（feeds3 HTML 点赞详情 + 三级 fallback）、转发 |
| **信息查询** | 访客列表（含来源映射）、好友列表、用户信息、头像/昵称、相册/照片管理、设备信息（手机型号） |
| **流量统计** | 说说的点赞/浏览/评论/转发 计数（`qz_opcnt2`） |
| **隐私管理** | 设置说说公开/私密权限（`ugc_right`） |
| **事件推送** | 新说说、新评论（含详情）、新点赞实时上报（独立定时器，bestEffort 降级）、好友说说订阅 |
| **Cookie 保活** | 每 10 分钟自动探活，失效及时告警 |
| **OneBot v11** | HTTP API / WebSocket / 反向 WebSocket / HTTP POST |
| **NapCat 原生** | `napcat-plugin/` 提供无侵入代理插件 |

### 反限流 & 智能路由

- `emotion_cgi_msglist_v6` 被限流（-10000）时自动降级到 `feeds3_html_more`
- 评论详情获取三级策略：
  1. **feeds3 内嵌评论**：`feeds3_html_more` 返回的 HTML 中嵌有最近评论（评论者 QQ / 昵称 / 内容 / 时间），零额外请求
  2. **emotionList 内嵌评论**：`emotion_cgi_msglist_v6` 返回说说时已携带 `commentlist`（API 限流降级到 feeds3 时不可用）
  3. **getCommentsLite 单次 POST**：仅发一个 `emotion_cgi_getcmtreply_v6` POST，circuit breaker 保护（2 次失败后 30 分钟冷却）
  4. **纯计数事件**：前三级不可用时，发射仅含 +N 计数的事件
- 评论/详情接口 `getCommentsBestEffort` 保留多变体轮询，记住命中变体下次优先使用（供 API 调用，非轮询器）
- **点赞监听 bestEffort 降级**（新增）：
  1. **PC detail**：`emotion_cgi_getdetailv6` 获取点赞列表
  2. **Mobile detail**：mobile 端详情接口降级
  3. **feeds3 兜底**：主动拉取 feeds3 HTML 解析点赞通知（含 QQ / 昵称 / 时间 / 个性赞图标）
  4. **计数兜底**：`qz_opcnt2` 获取点赞数，结合缓存用户信息尽可能填充事件详情
- 点赞检测双重策略：feeds3 HTML 内嵌点赞者详情 + `qz_opcnt2` 计数兜底
  - feeds3 HTML 解析出点赞者 QQ、昵称、时间、图标，事件推送可带详情
  - feeds3 只覆盖最近点赞，剩余用计数事件补充（优先匹配缓存用户信息）
- **是否已点赞**：通过 feeds3 获取的说说列表里，每条带 **`isLiked`**（boolean），表示当前登录用户是否已点过赞；也可调用 `get_like_list` 拿到点赞者列表，判断当前用户是否在列表中
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
- **端点健康检查**：`npm run verify:readonly` 一键验证 8 个读接口可用性
- **HTTP 桥接抽检**：`npm run verify:http`（需 bridge 已启动）校验 `get_login_info` / `check_cookie` / `get_stranger_info` 等与昵称一致性
- **全量工具对齐**：`npm run verify:tools` 按 OpenClaw `qzone_*` 对应 action 逐项请求；`--write` 会发临时说说并删除、对样本 tid 点赞再取消

### 好友列表与 `friends.json`

好友列表优先走官方接口 `cgi_get_friend_list`；若失败或为空，则从**好友动态（feeds3）**里"谁发过言"推断并写入 `test_cache/friends.json`。因此**缓存里的人数 = 最近 N 页动态里出现过的不同人数**，不一定等于你的全部好友。

- 想让缓存里人多一点：设置 `QZONE_FRIEND_FEEDS3_PAGES=10`（默认 8，最多 20），会多翻几页动态再抽人。
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

# Playwright 配置（可选）
# QZONE_PLAYWRIGHT_HEADLESS=    # 空=自动检测, 1=强制headless, 0=强制headed
# QZONE_PLAYWRIGHT_EXECUTABLE=  # 自定义 Chrome 路径
# QZONE_PLAYWRIGHT_CHANNEL=chrome
```

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
[INFO] 事件监听: 说说=true 评论=true 点赞=true 好友动态=false | 轮询源=auto 间隔=60s
```

- **说说/评论/点赞/好友动态**：对应 `ONEBOT_EMIT_MESSAGE_EVENTS`、`ONEBOT_EMIT_COMMENT_EVENTS`、`ONEBOT_EMIT_LIKE_EVENTS`、`ONEBOT_EMIT_FRIEND_FEED_EVENTS`（未设时默认：前三项 true，好友动态 false）。
- **推送事件中附带图片 base64**：`ONEBOT_ATTACH_IMAGE_DATA`（默认 1；设为 0 关闭）。
- **轮询源**：`ONEBOT_EVENT_POLL_SOURCE`（`pc` / `mobile` / `auto`）。
- **间隔**：`ONEBOT_POLL_INTERVAL`（秒）。

若开启了 debug（如提交中的 `[Poller:DEBUG]`），还可通过以下关键字在日志中确认事件是否在推送：

| 关键字 | 含义 |
|--------|------|
| `[Poller:DEBUG] pollMyPosts got N items` | 主轮询拉到的说说条数 |
| `[Poller:DEBUG] publishing event type=` | 正在向 hub 推送事件 |
| `[Poller:DEBUG] publish done, subscribers=N` | 推送完成，当前订阅数（WS/HTTP 连接数） |
| `[Poller:DEBUG] pollComments` / `publishing comment event` | 评论轮询与评论事件推送 |
| `HTTP/WS 服务器启动: http://...` | 服务已监听，可接收 WS 连接 |

- **systemd**：`journalctl -u onebot-qzone -f` 实时看日志；若服务将 stdout 重定向到文件，则直接 `grep 事件监听` 或 `grep Poller` 该文件。

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

| Action | 说明 | 主要参数 |
|--------|------|----------|
| `send_msg` / `send_private_msg` | 发布说说 | `message`（支持 CQ 码图片）；@ 人用 `@{uin:QQ号,nick:昵称}` |
| `delete_msg` | 删除说说 | `message_id` |
| `get_msg` | 获取说说详情 | `user_id`, `message_id` |
| `get_emotion_list` | 获取说说列表 | `user_id`, `pos`, `num`；默认附带图片 base64（`include_image_data=false` 可关闭） |
| `send_comment` | 发送评论 | `target_uin`, `target_tid`, `content` |
| `delete_comment` | 删除评论 | `uin`, `tid`, `comment_id` |
| `get_comment_list` | 获取评论列表 | `user_id`, `tid` |
| `send_like` | 点赞说说 | `user_id`, `tid`, `abstime` |
| `unlike` | 取消点赞 | `user_id`, `tid`, `abstime` |
| `get_like_list` | 获取点赞列表（基础版） | `user_id`, `tid` |
  - 依赖说说详情接口，简单直接但可能被限流
| `get_like_list_best_effort` | 获取点赞列表（推荐） | `user_id`, `tid` |
  - **多级降级**：PC detail → Mobile detail → feeds3 HTML → 空数组
  - 带缓存机制，自动跨 scope 拉取，可靠性更高
  - 事件推送可带完整点赞者详情（QQ、昵称、时间、个性赞图标）
| `get_video_info` | 获取视频元数据 | `tid`（从 h5-json 解析 video 字段：MP4/封面/时长/尺寸） |
| `parse_mentions` | 解析艾特用户 | 支持 `@{uin:QQ,nick:昵称,who:1,auto:1}` 格式，自动提取并转换表情 |
| `parse_emojis` | 解析表情 | 将 `[em]e100[/em]` 转换为 `[微笑]` 等可读名称，支持 150+ 常用表情 |
| `get_device_info` | 获取设备信息 | `tid`（如 "Xiaomi 15 Pro"、终端类型） |
| `forward_msg` | 转发说说 | `user_id`, `tid`, `content` |
| `get_friend_list` | 获取好友列表 | — |
| `get_stranger_info` | 获取用户信息 | `user_id` |
| `get_visitor_list` | 获取访客列表（含来源映射） | `user_id`（可选） |
| `get_traffic_data` | 获取说说流量统计 | `user_id`, `tid` |
| `set_emotion_privacy` | 设置说说隐私 | `tid`, `privacy`（`private`/`public`） |
| `get_portrait` | 获取头像和昵称 | `user_id` |
| `get_friend_feeds` | 获取好友最近说说（游标分页） | `cursor`、`num`/`count`；默认附带图片 base64（`include_image_data=false` 可关闭）；仅返回 appid=311 说说 |
| `get_album_list` | 获取相册列表 | `user_id`（可选） |
| `get_photo_list` | 获取照片列表 | `album_id` |
| `upload_image` | 上传图片 | `base64` 或 `url` |
| `fetch_image` | 使用桥接 Cookie 拉取 QZone 图片（返回 base64） | `url` 或 `urls`；仅接受白名单域名（qpic.cn、photo.store.qq.com、qzonestyle.gtimg.cn），边缘场景用 |
| `probe_api_routes` | 探测可用接口路由 | `uin`, `tid` |
| `reset_api_caches` | 清除接口缓存 | — |
| `login_cookie` | Cookie 登录 | `cookie` |
| `logout` | 退出登录 | — |

**说说图片与 base64**：默认情况下，`get_emotion_list` / `get_friend_feeds` 会在每条说说的 `pic` 项中附带 `base64`（桥接用 Cookie+Referer 向 QZone CDN 拉取），单条最多 5 张、单次响应最多 20 张；传 `include_image_data=false` 可关闭以省流量。推送的新说说事件中也会默认附带图片 base64（`message` 中 image 段带 `file: 'base64://...'`），可通过环境变量 `ONEBOT_ATTACH_IMAGE_DATA=0` 关闭。单独拉取某张图时可用 `fetch_image`（参数 `url` 或 `urls`），仅接受白名单域名。

**与 openclaw-napcat-qq 配合**：搭配 [openclaw-napcat-qq](https://github.com/Gu-Heping/openclaw-napcat-qq) 时，插件会将上述 base64 写入临时文件并在 `qzone_get_friend_feeds` / `qzone_get_posts` 结果中返回**本地路径**，Agent 用 **image** 工具传入该路径即可识图。若图片拉取出现 502，请将腾讯 CDN 域名（如 `photo.store.qq.com`、`qpic.cn`、`qzonestyle.gtimg.cn`）设为代理 **DIRECT**，详见 [docs/SERVER_DEBUG.md](docs/SERVER_DEBUG.md)。

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
npm run test             # 运行单元测试（127 项）
npm run test:unit        # 同上
npm run test:api         # 单元 + API 集成测试
npm run test:api:readonly # 单元 + 只读 API 测试
npm run test:all         # 全量测试
npm run typecheck        # TypeScript 类型检查
npm run verify           # 端点健康检查（读 + 写）
npm run verify:readonly  # 端点健康检查（仅读接口）
npm run verify:http      # 对已启动 bridge 做 HTTP 登录/昵称抽检
npm run verify:tools     # HTTP 对齐全部 qzone 工具对应 action（可加 --write / --strict）
```

### 测试说明

- **单元测试**：`test/unit/` 下 10 个测试套件，共 127 项，纯本地运行不需要登录。
- **API 测试**：需先启动 bridge 并登录，`--readonly` 模式仅验证读接口。
- **端点健康检查**：`scripts/verify-endpoints.ts`，启动即检验 8 个读 + 2 个写端点，输出彩色 PASS/FAIL/SKIP 报告。
- **HTTP 全量工具**：`scripts/verify-all-qzone-tools-http.ts`（`verify:tools`），对 `127.0.0.1:ONEBOT_PORT` 真实 POST；加 **`--strict`** 时除「有返回」外还要求首条说说/详情等结构完整；`fetch_image` 白名单含 `qlogo*.store.qq.com` 等与头像 URL 一致。
- **真实数据回归**：`npx tsx test/verify-real-feeds.ts`（需配置 Cookie）会校验 getEmotionList/getFriendFeeds、归一化结果，并输出含图说说数、多级评论（一级/二级/有回复的帖子数）、含图评论数。

### Bot 重复回复评论 / 验收脚本副作用

- **根因（桥接）**：轮询发现「新评论」会上报 EventHub。若 **评论者就是当前登录号**（Bot 在自己空间下自评），旧逻辑仍会推送，上游再自动回复 → **死循环**。已在 `poller` 中 **跳过推送本人评论与本人点赞**（仍会记入 `seen*`，避免反复当「新」）。
- **他人评论也重复推送**：`trackTids` 超过上限会 **裁剪**旧 tid；此前实现会同时 **删掉** `seenCommentIds` / `seenLikeUins`。该帖再次进入「最近说说」后，所有旧评论会被当成全新 → **同一评论多次上报**。现已 **保留**已见评论/点赞集合，仅删 `commentWarmTids` / `knownCounts` 等与「是否见过」无关的缓存。
- **验收脚本**：`verify:tools --write` 会真实发说说、点赞，**会触发 WS 事件**；读请求也会更新评论缓存。生产验收可临时关 `ONEBOT_EMIT_COMMENT_EVENTS` 等，详见脚本文件头说明。

### 调试获取评论

获取评论走 `getCommentsBestEffort`：先 PC POST（t1_source=1）→ PC GET 多变体 → 失败后 mobile。调试时可：

1. **看日志**：控制台会打 `getCommentsBestEffort: 成功 (t1_source=1) 评论数≈N` 或 `使用 mobile 评论数≈N`；若 PC 全部失败会打 `getComments: PC 全部失败，回退 mobile`。PC 与 mobile 都失败时，若有 feeds3 兜底会打 `getCommentsBestEffort: 使用 feeds3 兜底 评论数=M/T`。
2. ** dump 原始响应**：设置 `QZONE_DEBUG_DUMP=1`，每次评论请求会把响应写入 `{QZONE_CACHE_PATH}/debug/`，文件名如 `comments_pc_post_*.txt`、`comments_pc_0_*.txt`、`comments_mobile_*.txt`，便于对比接口返回的 code/commentlist。
3. **直接调接口**：先启动 bridge，再 `POST http://127.0.0.1:8080/get_comment_list`，body `{"tid":"你的说说tid","user_id":"可选，默认当前登录","num":20,"pos":0}`，查看返回的 `data` 及日志中的 code/评论数。

**获取评论返回空 /「暂无评论」— 可能原因（先定位再修）**

1. **user_id 传错**  
   `user_id` 必须是**该条说说的作者**（发动态的人），不是当前登录的 bot。例如 A 发的动态，拉评论时必须传 A 的 QQ 号；若默认成 bot 的 QQ，PC/mobile 都会查错人，容易返回空或错误。

2. **tid 格式不一致**  
   - 评论接口里：PC `emotion_cgi_getcmtreply_v6` 的 `tid`、mobile `get_comment_list` 的 `cellid`，在空间页/feeds3 里通常对应说说的 **key**（一串 hex，如 `3ea22c2e8e25ac69aa7f0500`）。  
   - 有的来源（如部分推送、计数接口）会给出 **abstime**（十进制时间戳，如 `1772905792`）。  
   - 若用 abstime 当 tid 去拉评论，而接口期望 key，可能返回空或 code=-3。  
   **建议**：从 `get_emotion_list` 或推送事件里取**同一条说说**的 `tid`（即 key）和作者 `uin`，用这一对去调 `get_comment_list`；若当前只有 abstime，需先确认该说说在列表/详情里的 key 再试。

3. **PC/mobile 接口本身不可用**  
   若你环境里 PC 评论接口一直 -3、mobile 404，会走 feeds3 兜底；但只有「最近通过 feeds3 拉过的那批说说」才有缓存评论，其它会说仍会显示暂无评论。

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
│   ├── feeds3Parser.ts    # Barrel：feeds3 解析聚合导出
│   ├── feeds3/            # feeds3 子模块（预处理/正文/说说/评论/点赞/元数据/辅助）
│   ├── schemas.ts         # Zod 运行时校验 Schema（10 套）
│   ├── validate.ts        # 校验入口（validateApiResponse / validateOrThrow）
│   ├── requestLayer.ts    # 统一请求层（JSONP 拆包 / 反爬检测 / 业务码提取）
│   └── rawLogger.ts       # 原始响应日志（校验失败时自动转存）
├── bridge/
│   ├── config.ts          # 配置（fromEnv）
│   ├── hub.ts             # EventHub 发布订阅
│   ├── poller.ts          # 轮询器（说说/评论/点赞/好友动态）
│   ├── actions.ts         # OneBot action 处理器
│   ├── server.ts          # HTTP + WS 服务器
│   ├── network.ts         # HTTP POST 推送 + 反向 WS
│   └── utils.ts           # 工具（safeInt、SSRF 拦截）

napcat-plugin/
└── src/index.ts           # NapCat 原生插件

scripts/
└── verify-endpoints.ts    # 端点健康检查脚本

test/
├── run-all.ts             # 测试运行器
├── test-helpers.ts        # 测试工具函数
├── api-interfaces.ts      # API 集成测试
└── unit/                  # 单元测试（10 套件，127 项）

doc/                       # QZone 逆向分析文档
├── api-overview.md        # API 总览
├── auth.md                # 认证机制
├── emotion-api.md         # 说说接口
├── social-api.md          # 社交互动接口
├── feeds3-parser.md       # feeds3 HTML 解析（含视频/二级回复/艾特）
├── deep-reverse-findings.md # 深度逆向发现汇总
├── photo-api.md           # 相册/照片接口
├── user-api.md            # 用户信息接口
├── fallback-strategy.md   # 降级策略
└── compatibility-matrix.md # 接口可用性矩阵
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
