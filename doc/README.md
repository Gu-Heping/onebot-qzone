# QQ空间接口分析文档

本目录收录了 qzone-bridge 项目在逆向分析 QQ 空间 Web API 过程中积累的技术文档。

> **当前实现状态（2026-10）**：说说列表、评论、点赞均以 **feeds3 HTML** 为主链路；PC/mobile 的评论与详情接口在实测中大多不可用。带「历史探测」性质的文档仍保留原始结论，但降级顺序请以 [`fallback-strategy.md`](fallback-strategy.md) 与代码为准。

## 文档索引

### 接口文档

| 文档 | 内容 |
|------|------|
| [api-overview.md](api-overview.md) | API 总览：基础 URL、通用参数、域名体系、请求模式 |
| [api-probe-results.md](api-probe-results.md) | 接口探测结果（-10000 / 500 / 404 等实测记录） |
| [auth.md](auth.md) | 认证机制：Cookie 登录、二维码登录、g_tk / qzonetoken 算法 |
| [emotion-api.md](emotion-api.md) | 说说相关接口：列表、详情、发布、删除、转发 |
| [social-api.md](social-api.md) | 社交互动接口：点赞、取消点赞、评论、删除评论 |
| [feeds3-parser.md](feeds3-parser.md) | feeds3_html_more 接口及 HTML 解析方案 |
| [photo-api.md](photo-api.md) | 相册/照片接口：列表、上传、创建、删除 |
| [user-api.md](user-api.md) | 用户信息接口：好友列表、访客列表、个人资料 |
| [board-api.md](board-api.md) | 留言板接口：列表、发表、删除 |

### 策略与矩阵

| 文档 | 内容 |
|------|------|
| [fallback-strategy.md](fallback-strategy.md) | 多级降级策略与容错机制 |
| [compatibility-matrix.md](compatibility-matrix.md) | 接口可用性矩阵与常见业务码 |
| [qzone-feature-matrix.md](qzone-feature-matrix.md) | QZone 功能支持矩阵 |
| [deep-reverse-findings.md](deep-reverse-findings.md) | 深度逆向发现汇总（含历史结论） |
| [qzone-specified-user-diagnosis.md](qzone-specified-user-diagnosis.md) | 指定用户（好友空间）诊断记录 |
| [openclaw-acceptance.md](openclaw-acceptance.md) | OpenClaw 联调与验收清单 |

### 工程参考

| 文档 | 内容 |
|------|------|
| [reverse-engineering-guide.md](reverse-engineering-guide.md) | 逆向工程方法论与工具链 |
| [feature-backlog.md](feature-backlog.md) | 功能待办与规划 |
| [获取说说流程说明.md](获取说说流程说明.md) | 中文版说说获取流程说明（含历史链路） |

### 运维文档（docs/）

| 文档 | 内容 |
|------|------|
| [../docs/SERVER_DEBUG.md](../docs/SERVER_DEBUG.md) | 服务器图片 CDN / base64 拉取排查 |
| [../docs/INSTANT_LIKE.md](../docs/INSTANT_LIKE.md) | 即时点赞流水线（`npm run like:instant`） |

## 约定

- 接口分析起始于 2026-02，**最近更新 2026-10**；历史探测文档中的旧结论会标注状态提示
- PC 端指 `user.qzone.qq.com/proxy/domain/` 系列端点
- Mobile 端指 `mobile.qzone.qq.com` 系列端点
- 业务码含义与账号状态、风控策略相关，需结合具体场景判断
