# 用户信息接口

## 1. 获取用户个人资料

**接口**: `cgi_personal_card`

**URL**: `https://user.qzone.qq.com/proxy/domain/r.qzone.qq.com/cgi-bin/user/cgi_personal_card`

**方法**: GET

**参数**:

| 参数名 | 说明 |
|--------|------|
| `uin` | 目标用户 QQ 号 |
| `g_tk` | 安全令牌 |

**响应**（JSONP `_Callback` 包裹）:

返回用户昵称、性别等基本信息。

---

## 2. 获取好友列表

**接口**: `cgi_get_friend_list`

**URL**: `https://user.qzone.qq.com/proxy/domain/r.qzone.qq.com/cgi-bin/qzone/cgi_get_friend_list`

**方法**: GET

**参数**:

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `g_tk` | 安全令牌 | |
| `uin` | 当前 QQ 号 | |
| `start` | 起始位置 | `0` |
| `num` | 获取数量 | `50` |
| `format` | 响应格式 | `json` |

**响应**（JSONP `_Callback` 包裹）。

**状态**: ✅ 可用。

---

## 3. 获取访客列表

**接口**: `cgi_right_get_visitor_more`

**URL**: `https://user.qzone.qq.com/proxy/domain/g.qzone.qq.com/cgi-bin/cgi_right_get_visitor_more`

**方法**: GET

**参数**:

| 参数名 | 说明 | 值 |
|--------|------|-----|
| `g_tk` | 安全令牌 | |
| `uin` | 目标用户 QQ 号 | |
| `mask` | 数据掩码 | `7` |
| `format` | 响应格式 | `json` |

**响应**（JSONP `_Callback` 包裹）。

**状态**: ✅ 可用。

---

## 4. 获取好友动态（查询陌生人信息）

**接口**: `fcg_query_stranger_info`

**URL**: `https://user.qzone.qq.com/proxy/domain/r.qzone.qq.com/cgi-bin/qzone/fcg_query_stranger_info`

**方法**: GET

**参数**:

| 参数名 | 说明 |
|--------|------|
| `uin` | 目标用户 QQ 号 |
| `g_tk` | 安全令牌 |

---

## 5. 获取好友动态 feed

好友动态的获取不通过专门的「好友动态」接口，而是通过 `feeds3_html_more` 实现：

```typescript
// 不传 filterUin 参数即可获取好友动态（包含所有好友的说说）
const text = await fetchFeeds3Html(myQQNumber);
const feeds = parseFeeds3Items(text, undefined, '311', 20);
```

详见 [feeds3-parser.md](feeds3-parser.md)。

### 移动端好友动态（已知不稳定）

**URL**: `https://mobile.qzone.qq.com/list`

**参数**:

| 参数名 | 说明 | 值 |
|--------|------|-----|
| `g_tk` | 安全令牌 | |
| `res_type` | 资源类型 | `2` |
| `format` | 响应格式 | `json` |
| `pos` | 起始位置 | `0` |
| `num` | 获取数量 | `20` |

**状态**: ⚠️ 实测返回 `code: -4003`（业务受限），不可靠。

---

## 6. 获取点赞列表

通过说说详情接口获取点赞用户列表：

```typescript
async getLikeList(uin: string, tid: string): Promise<Record<string, unknown>[]> {
  const detail = await getShuoshuoDetail(uin, tid);
  // 尝试以下字段名
  for (const key of ['like', 'likes', 'likeList', 'likelist']) {
    if (Array.isArray(detail[key])) return detail[key];
  }
  // 也检查 detail.data 下的字段
  const dataObj = detail['data'];
  for (const key of ['like', 'likes', 'likeList', 'likelist']) {
    if (Array.isArray(dataObj?.[key])) return dataObj[key];
  }
  return [];
}
```

> 点赞用户列表依赖说说详情接口，而详情接口本身可能不稳定（参见 [emotion-api.md](emotion-api.md)），因此点赞列表的获取也不完全可靠。
