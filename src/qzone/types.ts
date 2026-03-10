/* ─────────────────────────────────────────────
   QZone TypeScript Bridge – shared type definitions
   ───────────────────────────────────────────── */

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
  videos?: string[];
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
}

export interface QzoneComment {
  commentId: string;
  uin: string;
  nickname: string;
  content: string;
  createdTime: number;
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
