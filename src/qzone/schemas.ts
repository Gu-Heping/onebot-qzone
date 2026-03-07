/* ─────────────────────────────────────────────
   QZone 业务数据 Zod Schema — 运行时校验
   ───────────────────────────────────────────── */

import { z } from 'zod';

// ── 基础外壳 ──

/** 所有 QZone API 响应的通用外壳 */
export const QzoneResponseEnvelope = z.object({
  code: z.number().optional(),
  message: z.string().optional(),
  msg: z.string().optional(),
}).passthrough();

/** code === 0 的成功状态断言 */
export const QzoneSuccessEnvelope = QzoneResponseEnvelope.refine(
  (d) => d.code === 0 || d.code === undefined,
  { message: '业务码非 0，接口可能被限流或鉴权失败' },
);

// ── 说说列表 ──

export const EmotionPicSchema = z.object({
  url1: z.string().optional(),
  url2: z.string().optional(),
  url3: z.string().optional(),
  url: z.string().optional(),
  smallurl: z.string().optional(),
}).passthrough();

export const EmotionItemSchema = z.object({
  tid: z.coerce.string().min(1, '说说 tid 不能为空'),
  uin: z.coerce.string(),
  content: z.string().default(''),
  nickname: z.string().default(''),
  created_time: z.coerce.number().default(0),
  cmtnum: z.coerce.number().default(0),
  fwdnum: z.coerce.number().default(0),
  pic: z.array(EmotionPicSchema).optional().default([]),
}).passthrough();

export const EmotionListResponseSchema = z.object({
  code: z.number(),
  msglist: z.array(EmotionItemSchema).nullable().optional(),
}).passthrough();

// ── 评论 ──

export const CommentItemSchema = z.object({
  content: z.string().default(''),
  create_time: z.coerce.number().default(0),
}).passthrough();

export const CommentListResponseSchema = z.object({
  code: z.number(),
  commentlist: z.array(CommentItemSchema).nullable().optional(),
}).passthrough();

// ── 用户信息 ──

export const UserInfoResponseSchema = z.object({
  code: z.number().optional(),
}).passthrough();

// ── 好友列表 ──

export const FriendItemSchema = z.object({
  uin: z.coerce.string().min(1),
  nickname: z.string().default(''),
}).passthrough();

export const FriendListResponseSchema = z.object({
  code: z.number(),
  data: z.object({
    items: z.array(FriendItemSchema).optional(),
    total: z.coerce.number().optional(),
  }).passthrough().optional(),
}).passthrough();

// ── 相册列表 ──

export const AlbumListResponseSchema = z.object({
  code: z.number().optional(),
}).passthrough();

// ── 访客列表 ──

export const VisitorResponseSchema = z.object({
  code: z.number().optional(),
}).passthrough();

// ── 发布说说/社交操作 ──

export const PublishResponseSchema = z.object({
  code: z.number().optional(),
}).passthrough();

export const SocialActionResponseSchema = z.object({
  code: z.number().optional(),
  ret: z.number().optional(),
}).passthrough();

// ── 详情页 ──

export const ShuoshuoDetailResponseSchema = z.object({
  code: z.number().optional(),
}).passthrough();

// ── 流量数据 ──

export const TrafficDataResponseSchema = z.object({
  code: z.number().optional(),
  data: z.array(z.object({
    current: z.object({
      newdata: z.record(z.string(), z.unknown()).optional(),
    }).passthrough().optional(),
  }).passthrough()).optional(),
}).passthrough();

// ── Schema 注册表 ──

export const SCHEMA_REGISTRY = {
  emotion_list: EmotionListResponseSchema,
  comment_list: CommentListResponseSchema,
  user_info: UserInfoResponseSchema,
  friend_list: FriendListResponseSchema,
  album_list: AlbumListResponseSchema,
  visitor: VisitorResponseSchema,
  publish: PublishResponseSchema,
  social_action: SocialActionResponseSchema,
  shuoshuo_detail: ShuoshuoDetailResponseSchema,
  traffic_data: TrafficDataResponseSchema,
} as const;

export type SchemaName = keyof typeof SCHEMA_REGISTRY;
