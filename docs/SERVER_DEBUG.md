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
