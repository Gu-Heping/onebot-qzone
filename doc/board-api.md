# 留言板接口（待抓包补全）

> 个人档留言列表/发表/删除的域名与 CGI 需在浏览器中抓包后填入并实现。

## 抓包步骤

1. 登录 QQ 空间 Web 端，进入某人个人档（空间首页）。
2. 打开开发者工具 (F12) → Network，筛选 XHR/Fetch。
3. 操作：查看留言列表、发表留言、删除留言。
4. 记录：请求 URL、方法 (GET/POST)、参数、请求头（含 Referer/Origin）、响应 JSON 结构。

## 待确认接口（占位）

| 功能     | 推测域名/路径           | 状态   |
|----------|--------------------------|--------|
| 留言列表 | 待抓包（可能 g.qzone / r.qzone） | 待逆向 |
| 发表留言 | 待抓包                   | 待逆向 |
| 删除留言 | 待抓包                   | 待逆向 |

## 实现约定

- Client 方法：`getBoardMessageList(uin?)`、`sendBoardMessage(targetUin, content)`、`deleteBoardMessage(uin, msgId)`。
- 当前未抓包前返回：`{ code: -10004, message: '留言板接口待逆向，暂未实现', _empty: true }`。
- 抓包完成后在 `src/qzone/client.ts` 中实现真实请求，并在本表更新 URL 与备注。
