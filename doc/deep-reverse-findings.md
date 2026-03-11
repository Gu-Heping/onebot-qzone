# 深度逆向发现汇总

## 1. 说说数据结构增强

### 1.1 视频字段
```json
{
  "video": [{
    "cover_height": 720,
    "cover_width": 1280,
    "pic_url": "封面图URL",
    "url1": "缩略图URL",
    "url3": "视频播放URL (.mp4)",
    "video_id": "视频ID",
    "video_time": "时长(毫秒)"
  }],
  "videototal": 1
}
```

### 1.2 设备信息
```json
{
  "source_name": "Xiaomi 15 Pro",  // 设备名称
  "source_url": "",               // 设备链接
  "t1_termtype": 4                // 终端类型 (4=Android)
}
```

### 1.3 权限字段
```json
{
  "isEditable": 1,    // 是否可编辑
  "right": 1,         // 权限级别
  "ugc_right": 16,    // UGC权限
  "secret": 0         // 是否私密
}
```

## 2. 评论结构增强

### 2.1 二级回复（回复的评论）
```json
{
  "reply_num": 1,     // 回复数量
  "list_3": [{        // 二级回复列表（注意字段名是 list_3）
    "content": "@{uin:3916743130,nick:新星,who:1,auto:1}看到小公鸡了",
    "create_time": 1770380359,
    "name": "倍耐力全雨胎",
    "uin": 2464989387
  }]
}
```

### 2.2 艾特用户格式
```
@{uin:3916743130,nick:新星,who:1,auto:1}内容
```
解析方式：
- `uin`: 被艾特用户QQ
- `nick`: 被艾特用户昵称
- `who`: 1=好友
- `auto`: 1=自动填充

### 2.3 评论完整字段
```json
{
  "tid": 1,           // 评论序号（帖子内从1递增）
  "uin": 2464989387,  // 评论者QQ
  "name": "昵称",     // 评论者昵称（注意是name不是nickname）
  "content": "内容",
  "create_time": 1770367933,      // Unix时间戳
  "createTime": "2026年02月06日", // 格式化时间
  "createTime2": "2026-02-06 16:52:13", // 详细时间
  "reply_num": 0,     // 二级回复数
  "t2_source": 1,     // 来源
  "t2_subtype": 0,    // 子类型
  "t2_termtype": 2,   // 终端类型
  "abledel": 0,       // 是否可删除
  "private": 0        // 是否私密
}
```

## 3. feeds3 scope 差异

| 特性 | scope=0 (好友动态) | scope=1 (个人说说) |
|------|-------------------|-------------------|
| appid311 (说说) | ✓ 有 | ✗ 无 |
| appid202/2100 (音乐) | 可能有 | 无 |
| 转发检测 | 有 | 有 (11条) |
| 图片 | 有 (11个data-pickey) | 无 |
| 用途 | 获取好友动态 | 获取活动记录 |

**重要发现**：scope=1 不返回说说内容，而是返回活动记录（点赞、转发等行为）！

## 4. 好友列表获取

### 4.1 多页翻页策略成功
```
第1页: 5 friends
第2页: 22 friends (累计)
第3页: 25 friends (累计)
总计: 36 friends (已保存到缓存)
```

### 4.2 好友字段
```json
{
  "uin": "QQ号",
  "nickname": "昵称",
  "avatar": "头像URL"
}
```

## 5. 翻页参数

### 5.1 externparam 结构
```
basetime=1773162642
pagenum=3
dayvalue=0
getadvlast=1
hasgetadv=78493332514^0^1773197645
lastentertime=1773197505
LastAdvPos=1
UnReadCount=0
UnReadSum=-1
LastIsADV=1
UpdatedFollowUins=
UpdatedFollowCount=0
LastRecomBrandID=
TRKPreciList=
gdtadvcookie=eyJsYXN0X2Fkdl9wb3NpdGlvbiI6LTN9
```

## 6. 待探索接口

以下接口返回错误或需要进一步研究：

| 接口 | 状态 | 说明 |
|------|------|------|
| `/cgi_get_visitor_simple` | 待测试 | 访客列表 |
| `/cgi_get_vipinfo` | 待测试 | 黄钻信息 |
| `/cgi_userinfo_get_all` | 待测试 | 个人资料 |

## 7. 数据获取建议

### 7.1 优先级调整
1. **高**：支持视频解析（video 字段）
2. **高**：支持二级回复（list_3 字段）
3. **高**：支持艾特用户解析
4. **中**：优化 scope=0 使用（作为主要数据源）
5. **中**：支持设备信息展示

### 7.2 降级策略更新
- 自己说说：h5-json（含内嵌评论）> feeds3 scope=0
- 好友说说：feeds3 scope=0（好友动态流）
- 评论：优先使用 h5-json 内嵌评论，避免额外 API 调用
