/* ─────────────────────────────────────────────
   feeds3 HTML 解析器 (Feeds3 Parser)
   Barrel：从 feeds3/* 子模块聚合导出
   ───────────────────────────────────────────── */

export { parseFeeds3Items } from './feeds3/items.js';
export { parseFeeds3Comments, parseFeeds3CommentsScoped } from './feeds3/comments.js';
export type { Feeds3Comment } from './feeds3/comments.js';
export { parseFeeds3PostMeta, parseFeeds3PostMetaScoped } from './feeds3/meta.js';
export type { PostMeta } from './feeds3/meta.js';
export { parseFeeds3Likes } from './feeds3/likes.js';
export type { Feeds3Like } from './feeds3/likes.js';
export {
  parseMentions,
  extractVideos,
  parseReplyComments,
  parseEnhancedComment,
  extractDeviceInfo,
  extractFriendsFromFeeds3FromText,
  extractExternparam,
} from './feeds3/helpers.js';
export type { Mention, VideoInfo, ReplyComment, EnhancedComment, DeviceInfo } from './feeds3/helpers.js';
