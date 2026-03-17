/* ─────────────────────────────────────────────
   QZone TypeScript Bridge – shared type definitions
   ───────────────────────────────────────────── */

/** 表情信息 */
export interface EmojiInfo {
  /** 表情代码 (如 e100) */
  code: string;
  /** 表情名称 (如 [微笑]) */
  name: string;
  /** 表情图片URL */
  url: string;
  /** 在文本中的位置 */
  index: number;
}

export interface QzoneConfig {
  cachePath: string;
  qrcodePath?: string;
  cookiePath?: string;
}

export interface ApiResponse {
  code?: number;
  message?: string;
  msg?: string;
  subcode?: number;
  http_status?: number;
  _empty?: boolean;
  raw?: string;
  [key: string]: unknown;
}

export interface QzoneEmotion {
  tid: string;
  uin: string;
  content: string;
  nickname?: string;
  name?: string;
  createTime?: { time: number } | number | string;
  created_time?: number;
  cmtnum?: number;
  likenum?: number;
  fwdnum?: number;
  pic?: Array<{ url?: string; url1?: string; url2?: string; url3?: string }>;
  _source?: string;
  /** 视频说说：feed_type='video'，并带 video_url / video_cover / video_width / video_height */
  feed_type?: string;
  video_url?: string;
  video_cover?: string;
  video_width?: number;
  video_height?: number;
  /** 视频详细元数据（从 h5-json 获取） */
  video?: Array<{
    video_id?: string;
    pic_url?: string;
    url1?: string;
    url3?: string;
    video_time?: string;
    cover_width?: number;
    cover_height?: number;
  }>;
  videototal?: number;
  /** 设备信息 */
  source_name?: string;
  source_url?: string;
  t1_termtype?: number;
  /** 评论列表（h5-json 中内嵌） */
  commentlist?: EnhancedComment[];
  /** 权限字段 */
  right?: number;
  ugc_right?: number;
  isEditable?: number;
  secret?: number;
  [key: string]: unknown;
}

export interface PostMeta {
  uin: string;
  appid: string;
  typeid: string;
  likeUnikey: string;
  likeCurkey: string;
  abstime: number;
}

/** 图片元数据结构 */
export interface PictureMeta {
  /** 图片 URL */
  url: string;
  /** 原始高清 URL（从 data-pickey 提取） */
  originalUrl?: string;
  /** 图片宽度 */
  width?: number;
  /** 图片高度 */
  height?: number;
}

/** 设备信息 */
export interface DeviceInfo {
  /** 设备名称（如 "Xiaomi 15 Pro"） */
  name: string;
  /** 设备链接 */
  url?: string;
  /** 终端类型（4=Android） */
  termtype?: number;
}

/** 视频元数据结构 */
export interface VideoMeta {
  /** 视频 ID */
  videoId: string;
  /** 封面图 URL */
  coverUrl: string;
  /** 缩略图 URL */
  thumbnailUrl?: string;
  /** 视频播放 URL (.mp4) */
  videoUrl?: string;
  /** 时长（毫秒） */
  duration: number;
  /** 视频宽度 */
  width: number;
  /** 视频高度 */
  height: number;
}

/** 艾特用户信息 */
export interface Mention {
  /** 被艾特用户 QQ */
  uin: string;
  /** 被艾特用户昵称 */
  nick: string;
  /** 1=好友 */
  who: number;
  /** 1=自动填充 */
  auto: number;
}

/** 二级回复（评论的回复） */
export interface ReplyComment {
  /** 回复评论 ID */
  commentId: string;
  /** 回复者 QQ */
  uin: string;
  /** 回复者昵称 */
  name: string;
  /** 回复内容 */
  content: string;
  /** 创建时间戳 */
  createdTime: number;
  /** 格式化时间 */
  createTime?: string;
  /** 详细时间 */
  createTime2?: string;
  /** 艾特的用户列表 */
  mentions?: Mention[];
  /** 回复给哪个艾特用户 */
  replyToMention?: Mention;
  /** 来源 */
  source?: string;
  /** 包含的表情列表 */
  emojis?: EmojiInfo[];
}

/** 增强评论结构（含二级回复） */
export interface EnhancedComment {
  /** 评论 ID */
  commentId: string;
  /** 评论者 QQ */
  uin: string;
  /** 评论者昵称 */
  name: string;
  /** 评论内容 */
  content: string;
  /** 创建时间戳 */
  createdTime: number;
  /** 格式化时间 */
  createTime: string;
  /** 详细时间 */
  createTime2: string;
  /** 二级回复数 */
  replyNum: number;
  /** 二级回复列表 */
  replies?: ReplyComment[];
  /** 艾特的用户列表 */
  mentions?: Mention[];
  /** 评论来源设备 */
  sourceName?: string;
  /** 评论来源 URL */
  sourceUrl?: string;
  /** 终端类型 */
  termtype?: number;
  /** 是否可删除 */
  canDelete?: number;
  /** 是否私密 */
  isPrivate?: number;
  /** 包含的表情列表 */
  emojis?: EmojiInfo[];
}

/** 音乐分享元数据 */
export interface MusicShareMeta {
  /** 歌曲名 */
  songName: string;
  /** 歌手名 */
  artistName?: string;
  /** 封面图 URL */
  coverUrl?: string;
  /** 播放链接 */
  playUrl?: string;
}

export interface NormalizedItem {
  tid: string | null;
  uin: string | null;
  content: string;
  nickname: string;
  createdTime: number;
  cmtnum: number;
  fwdnum: number;
  pics: string[];
  /** 图片详细元数据（含原始 URL、尺寸） */
  picsMeta?: PictureMeta[];
  /** 视频 URL 列表（简化版） */
  videos?: string[];
  /** 视频详细元数据（从 video 字段提取） */
  videosMeta?: VideoMeta[];
  /** 设备信息（如 "Xiaomi 15 Pro"） */
  device?: DeviceInfo;
  forwardContent?: string;
  forwardUin?: string;
  forwardTid?: string;
  forwardNickname?: string;
  /** feeds3 appid：311=说说，2=相册，202=网易云，217=点赞记录（活动流，通常过滤）等 */
  appid?: string;
  /** feeds3 typeid：311→0，网易云202→2 等 */
  typeid?: string;
  /** 第三方应用名称（从 feeds3 HTML 提取，如「网易云音乐」） */
  appName?: string;
  /** 第三方应用分享的内容标题（如歌曲名/视频标题等） */
  appShareTitle?: string;
  /** 点赞 API unikey（app 分享为实际分享链接，如网易云歌曲 URL） */
  likeUnikey?: string;
  /** 点赞 API curkey（`00{ouin}00{abstime}` 格式） */
  likeCurkey?: string;
  /** 音乐分享元数据（appid=202/2100 时填充） */
  musicShare?: MusicShareMeta;
  /** 权限字段 */
  right?: number;
  /** UGC 权限 */
  ugcRight?: number;
  /** 是否可编辑 */
  isEditable?: boolean;
  /** 是否私密 */
  isSecret?: boolean;
}

export interface QzoneComment {
  commentId: string;
  uin: string;
  nickname: string;
  name?: string;
  content: string;
  /** 评论中的图片 URL 列表（feeds3 解析） */
  pic?: string[];
  createdTime: number;
  /** 格式化时间 */
  createTime?: string;
  /** 详细时间 */
  createTime2?: string;
  /** 二级回复数 */
  replyNum?: number;
  /** 二级回复列表 */
  replies?: ReplyComment[];
  /** 艾特的用户列表 */
  mentions?: Mention[];
  /** 回复目标用户 QQ 号（二级评论） */
  replyToUin?: string;
  /** 回复目标用户昵称（二级评论） */
  replyToNickname?: string;
  /** 回复目标评论 ID（二级评论） */
  replyToCommentId?: string;
  /** 父评论 ID（二级评论所属的一级评论） */
  parentCommentId?: string;
  /** 是否为二级评论（回复） */
  isReply?: boolean;
  /** 评论来源设备 */
  sourceName?: string;
  /** 是否可删除 */
  canDelete?: number;
  /** 是否私密 */
  isPrivate?: number;
  /** 评论序号（帖子内从1递增） */
  tid?: number;
  /** 包含的表情列表 */
  emojis?: EmojiInfo[];
}

export interface QzoneLike {
  uin: string;
  nickname: string;
  createdTime: number;
}

export interface UploadImageResult {
  albumid?: string;
  lloc?: string;
  sloc?: string;
  type?: string | number;
  height?: number;
  width?: number;
  pre?: string;
  [key: string]: unknown;
}

export interface Routes {
  comments: string;
  detail: string;
  delete_comment: string;
  unlike: string;
  [key: string]: string;
}

// OneBot v11 event shapes
export type OneBotEvent = Record<string, unknown>;

export interface OneBotResponse {
  status: 'ok' | 'failed';
  retcode: number;
  data: unknown;
  echo?: unknown;
  message?: string;
}
