# 相册/照片接口

> ⚠️ **重要**: 截至 2026-02 实测，`photo.qzone.qq.com` 的大部分端点返回 **HTTP 500**，属于 QQ 空间服务端限制。已尝试 7+ 种变体（含 H5 proxy、直连域名），全部失败。以下文档保留接口定义供参考。

## 1. 获取相册列表

### 主用接口

**接口**: `cgi_list_album`

**URL**: `https://user.qzone.qq.com/proxy/domain/photo.qzone.qq.com/cgi-bin/cgi_list_album`

**方法**: GET

**参数**:

| 参数名 | 说明 | 值 |
|--------|------|-----|
| `g_tk` | 安全令牌 | 计算值 |
| `uin` | 目标用户 QQ 号 | |
| `hostUin` | 同 uin | |
| `inCharset` | 输入编码 | `utf-8` |
| `outCharset` | 输出编码 | `utf-8` |
| `format` | 响应格式 | `json` |

**响应**（JSONP `_Callback` 包裹）。返回空或 HTTP 500 时降级到 `cgi_list_photo`。

### 降级接口

**接口**: `cgi_list_photo`

**URL**: `https://user.qzone.qq.com/proxy/domain/photo.qzone.qq.com/cgi-bin/cgi_list_photo`

**参数**: 同上

---

## 2. 获取照片列表

**接口**: `cgi_floatview_photo_list_v2`

**URL**: `https://user.qzone.qq.com/proxy/domain/photo.qzone.qq.com/cgi-bin/cgi_floatview_photo_list_v2`

**方法**: GET

**参数**:

| 参数名 | 说明 | 值 |
|--------|------|-----|
| `g_tk` | 安全令牌 | |
| `uin` | 目标用户 QQ 号 | |
| `topicId` | 相册 ID | |
| `picKey` | 图片 key | 空 |
| `fupdate` | 强制更新 | `1` |
| `num` | 获取数量 | `30` |
| `pageStart` | 页起始 | `0` |
| `inCharset` | 输入编码 | `utf-8` |
| `outCharset` | 输出编码 | `utf-8` |
| `format` | 响应格式 | `json` |

---

## 3. 创建相册

**接口**: `cgi_create_album`

**URL**: `https://user.qzone.qq.com/proxy/domain/photo.qzone.qq.com/cgi-bin/cgi_create_album?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 |
|--------|------|
| `hostUin` | 当前登录 QQ 号 |
| `albumname` | 相册名称 |
| `albumdesc` | 相册描述 |
| `priv` | 权限（`1`=所有人可见） |
| `format` | `json` |
| `qzreferrer` | 来源页面 |

---

## 4. 删除相册

**接口**: `cgi_del_album`

**URL**: `https://user.qzone.qq.com/proxy/domain/photo.qzone.qq.com/cgi-bin/cgi_del_album?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 |
|--------|------|
| `hostUin` | 当前登录 QQ 号 |
| `topicId` | 相册 ID |
| `format` | `json` |
| `qzreferrer` | 来源页面 |

---

## 5. 删除照片

**接口**: `cgi_del_photo`

**URL**: `https://user.qzone.qq.com/proxy/domain/photo.qzone.qq.com/cgi-bin/cgi_del_photo?g_tk={gtk}`

**方法**: POST

**参数**:

| 参数名 | 说明 |
|--------|------|
| `hostUin` | 目标用户 QQ 号 |
| `topicId` | 相册 ID |
| `lloc` | 照片 ID |
| `format` | `json` |
| `qzreferrer` | 来源页面 |

---

## 6. 上传图片

**接口**: `cgi_upload_image`

**URL**: `https://up.qzone.qq.com/cgi-bin/upload/cgi_upload_image?g_tk={gtk}`

**方法**: POST（`application/x-www-form-urlencoded`）

**参数**:

| 参数名 | 说明 | 值 |
|--------|------|-----|
| `uin` | 当前 QQ 号 | |
| `p_uin` | 同 uin | |
| `skey` | Cookie skey | |
| `p_skey` | Cookie p_skey | |
| `zzpaneluin` | 同 uin | |
| `filename` | 固定 | `filename` |
| `uploadtype` | 上传类型 | `1` |
| `albumtype` | 相册类型 | `0`（指定相册）/ `7`（说说附件） |
| `exttype` | 扩展类型 | `0` |
| `refer` | 来源 | `album` / `shuoshuo` |
| `output_type` | 输出类型 | `jsonhtml` |
| `charset` | 编码 | `utf-8` |
| `output_charset` | 输出编码 | `utf-8` |
| `upload_hd` | 高清上传 | `1` |
| `hd_width` | 高清宽度 | `2048` |
| `hd_height` | 高清高度 | `10000` |
| `hd_quality` | 高清质量 | `96` |
| `base64` | Base64 模式 | `1` |
| `picfile` | 图片 Base64 数据 | |
| `albumid` | 目标相册 ID | （指定相册时提供） |
| `jsonhtml_callback` | JSONP 回调名 | `callback` |
| `backUrls` | 备份上传地址 | `http://upbak.photo.qzone.qq.com/cgi-bin/upload/cgi_upload_image` |
| `url` | 上传地址 | 同请求 URL |
| `qzreferrer` | 来源页面 | |

### 响应解析

上传接口的响应较为特殊，需要多种方式尝试解析：

1. **JSONP 解析**: 尝试用 `parseJsonp` 提取 `data` 字段
2. **正则提取**: 匹配 `{"albumid"...}` 的扁平 JSON
3. **字符串切片**: 提取 `"data"` 和 `"ret"` 之间的内容

### 返回字段

```typescript
interface UploadImageResult {
  albumid?: string;  // 相册 ID
  lloc?: string;     // 照片 ID（大图）
  sloc?: string;     // 照片 ID（小图）
  type?: string;     // 图片类型
  height?: number;   // 高度
  width?: number;    // 宽度
  pre?: string;      // 预览 URL（含 bo 参数）
}
```

### bo 参数提取

从 `pre` 字段的 URL 中提取 `bo` 参数，用于发布说说时的 `pic_bo` 字段：

```typescript
const preUrl = ret.pre ?? '';
const boIdx = preUrl.indexOf('bo=');
if (boIdx !== -1) {
  const boStart = boIdx + 3;
  const boEnd = preUrl.indexOf('&', boStart);
  const bo = boEnd !== -1 ? preUrl.slice(boStart, boEnd) : preUrl.slice(boStart);
}
```

> ⚠️ 注意: 必须截取到下一个 `&` 边界，否则 `pic_bo` 会携带多余查询参数。
