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

export interface NormalizedItem {
  tid: string | null;
  uin: string | null;
  content: string;
  nickname: string;
  createdTime: number;
  cmtnum: number;
  fwdnum: number;
  pics: string[];
  videos?: string[];
  forwardContent?: string;
  forwardUin?: string;
  forwardTid?: string;
  forwardNickname?: string;
}

export interface QzoneComment {
  commentId: string;
  uin: string;
  nickname: string;
  content: string;
  createdTime: number;
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
