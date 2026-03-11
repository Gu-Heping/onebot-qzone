/**
 * feeds3 增强解析单元测试
 * 验证视频、艾特、设备信息、二级回复等新功能
 */

import {
  parseMentions,
  extractVideos,
  parseReplyComments,
  parseEnhancedComment,
  extractDeviceInfo,
} from '../../src/qzone/feeds3Parser.js';
import { assert, runSuite, type TestCase } from '../test-helpers.js';

const cases: TestCase[] = [
  // ========== parseMentions 测试 ==========
  {
    name: 'parseMentions: 应正确解析单个艾特',
    fn: () => {
      const content = '@{uin:3916743130,nick:新星,who:1,auto:1}看到小公鸡了';
      const result = parseMentions(content);

      assert(result.mentions.length === 1, `应有 1 个艾特，实际: ${result.mentions.length}`);
      assert(result.mentions[0]!.uin === '3916743130', `uin 应为 3916743130`);
      assert(result.mentions[0]!.nick === '新星', `nick 应为 "新星"`);
      assert(result.mentions[0]!.who === 1, `who 应为 1`);
      assert(result.mentions[0]!.auto === 1, `auto 应为 1`);
      assert(result.text === '看到小公鸡了', `text 应为 "看到小公鸡了"，实际: "${result.text}"`);
    },
  },
  {
    name: 'parseMentions: 应正确解析多个艾特',
    fn: () => {
      const content = '@{uin:111,nick:用户A,who:1,auto:1} @{uin:222,nick:用户B,who:1,auto:1} 你们好';
      const result = parseMentions(content);

      assert(result.mentions.length === 2, `应有 2 个艾特`);
      assert(result.mentions[0]!.uin === '111', `第一个 uin 应为 111`);
      assert(result.mentions[1]!.uin === '222', `第二个 uin 应为 222`);
      assert(result.text === '你们好', `text 应为 "你们好"（自动 trim）`);
    },
  },
  {
    name: 'parseMentions: 应正确处理无艾特的普通内容',
    fn: () => {
      const content = '这是一段普通文字';
      const result = parseMentions(content);

      assert(result.mentions.length === 0, `应无艾特`);
      assert(result.text === '这是一段普通文字', `text 应保持原样`);
    },
  },
  {
    name: 'parseMentions: 应正确处理空字符串',
    fn: () => {
      const result = parseMentions('');
      assert(result.mentions.length === 0, `应无艾特`);
      assert(result.text === '', `text 应为空`);
    },
  },

  // ========== extractVideos 测试 ==========
  {
    name: 'extractVideos: 应正确解析视频数组',
    fn: () => {
      const raw = {
        video: [
          {
            video_id: '1074_0b53qffumrqa5uao3rmf4vutfaieiy2aamsa',
            pic_url: 'http://photogzmaz.photo.store.qq.com/cover.jpg',
            url1: 'https://photogzmaz.photo.store.qq.com/thumb.jpg',
            url3: 'https://photovideo.photo.qq.com/video.mp4',
            video_time: '76000',
            cover_width: 1280,
            cover_height: 720,
          },
        ],
        videototal: 1,
      };

      const videos = extractVideos(raw);

      assert(videos.length === 1, `应有 1 个视频`);
      assert(videos[0]!.videoId === '1074_0b53qffumrqa5uao3rmf4vutfaieiy2aamsa', `videoId 不正确`);
      assert(videos[0]!.coverUrl === 'http://photogzmaz.photo.store.qq.com/cover.jpg', `coverUrl 不正确`);
      assert(videos[0]!.thumbnailUrl === 'https://photogzmaz.photo.store.qq.com/thumb.jpg', `thumbnailUrl 不正确`);
      assert(videos[0]!.videoUrl === 'https://photovideo.photo.qq.com/video.mp4', `videoUrl 不正确`);
      assert(videos[0]!.duration === 76000, `duration 应为 76000`);
      assert(videos[0]!.width === 1280, `width 应为 1280`);
      assert(videos[0]!.height === 720, `height 应为 720`);
    },
  },
  {
    name: 'extractVideos: 应正确处理无视频数据',
    fn: () => {
      const videos = extractVideos({});
      assert(videos.length === 0, `应无视频`);
    },
  },
  {
    name: 'extractVideos: 应正确处理空视频数组',
    fn: () => {
      const videos = extractVideos({ video: [], videototal: 0 });
      assert(videos.length === 0, `应无视频`);
    },
  },
  {
    name: 'extractVideos: 应正确处理缺少可选字段的视频',
    fn: () => {
      const raw = {
        video: [
          {
            video_id: 'abc123',
            pic_url: 'http://example.com/cover.jpg',
            video_time: '60000',
          },
        ],
      };

      const videos = extractVideos(raw);

      assert(videos.length === 1, `应有 1 个视频`);
      assert(videos[0]!.videoId === 'abc123', `videoId 不正确`);
      assert(videos[0]!.thumbnailUrl === undefined, `thumbnailUrl 应为 undefined`);
      assert(videos[0]!.videoUrl === undefined, `videoUrl 应为 undefined`);
    },
  },

  // ========== parseReplyComments 测试 ==========
  {
    name: 'parseReplyComments: 应正确解析二级回复列表',
    fn: () => {
      const list3 = [
        {
          uin: 2464989387,
          name: '倍耐力全雨胎',
          content: '@{uin:3916743130,nick:新星,who:1,auto:1}看到小公鸡了',
          create_time: 1770380359,
          tid: 1,
        },
      ];

      const replies = parseReplyComments(list3, 'parent_123');

      assert(replies.length === 1, `应有 1 条回复`);
      assert(replies[0]!.uin === '2464989387', `uin 不正确`);
      assert(replies[0]!.name === '倍耐力全雨胎', `name 不正确`);
      assert(replies[0]!.content === '看到小公鸡了', `content 应为解析艾特后的纯文本`);
      assert(replies[0]!.createtime === 1770380359, `createtime 不正确`);
      assert(replies[0]!.reply_to_mention!.uin === '3916743130', `reply_to_mention.uin 不正确`);
      assert(replies[0]!.reply_to_mention!.nick === '新星', `reply_to_mention.nick 不正确`);
    },
  },
  {
    name: 'parseReplyComments: 应正确处理多条回复',
    fn: () => {
      const list3 = [
        { uin: 111, name: '用户A', content: '回复1', create_time: 1000, tid: 1 },
        { uin: 222, name: '用户B', content: '回复2', create_time: 2000, tid: 2 },
      ];

      const replies = parseReplyComments(list3, 'parent_456');

      assert(replies.length === 2, `应有 2 条回复`);
      assert(replies[0]!.commentid === 'parent_456_r_1', `第一条 commentid 不正确`);
      assert(replies[1]!.commentid === 'parent_456_r_2', `第二条 commentid 不正确`);
    },
  },
  {
    name: 'parseReplyComments: 应正确处理无艾特的回复',
    fn: () => {
      const list3 = [
        { uin: 111, name: '用户A', content: '普通回复内容', create_time: 1000, tid: 1 },
      ];

      const replies = parseReplyComments(list3, 'parent_789');

      assert(replies.length === 1, `应有 1 条回复`);
      assert(replies[0]!.content === '普通回复内容', `content 不正确`);
      assert(replies[0]!.reply_to_mention === undefined, `无艾特时 reply_to_mention 应为 undefined`);
    },
  },

  // ========== parseEnhancedComment 测试 ==========
  {
    name: 'parseEnhancedComment: 应正确解析完整评论',
    fn: () => {
      const raw = {
        tid: 4,
        uin: 3916743130,
        name: '新星',
        content: '看到小母鸡了',
        create_time: 1770378235,
        createTime: '2026年02月06日',
        createTime2: '2026-02-06 19:43:55',
        reply_num: 1,
        source_name: 'iPhone 15',
        source_url: '',
        t2_termtype: 2,
        abledel: 0,
        private: 0,
        list_3: [
          {
            uin: 2464989387,
            name: '倍耐力全雨胎',
            content: '@{uin:3916743130,nick:新星,who:1,auto:1}看到小公鸡了',
            create_time: 1770380359,
            createTime: '2026年02月06日',
            createTime2: '2026-02-06 20:19:19',
            tid: 1,
          },
        ],
      };

      const comment = parseEnhancedComment(raw);

      assert(comment.commentid === '4', `commentid 应为 "4"`);
      assert(comment.uin === '3916743130', `uin 不正确`);
      assert(comment.name === '新星', `name 不正确`);
      assert(comment.content === '看到小母鸡了', `content 不正确`);
      assert(comment.createtime === 1770378235, `createtime 不正确`);
      assert(comment.createTime === '2026年02月06日', `createTime 不正确`);
      assert(comment.createTime2 === '2026-02-06 19:43:55', `createTime2 不正确`);
      assert(comment.reply_num === 1, `reply_num 应为 1`);
      assert(comment.source_name === 'iPhone 15', `source_name 不正确`);
      assert(comment.replies !== undefined, `应有 replies`);
      assert(comment.replies!.length === 1, `应有 1 条二级回复`);
      assert(comment._source === 'h5_json', `_source 应为 h5_json`);
    },
  },
  {
    name: 'parseEnhancedComment: 应正确处理无二级回复的评论',
    fn: () => {
      const raw = {
        tid: 1,
        uin: 123,
        name: '测试用户',
        content: '无回复的评论',
        create_time: 1000,
        createTime: '2026年01月01日',
        createTime2: '2026-01-01 00:00:00',
        reply_num: 0,
      };

      const comment = parseEnhancedComment(raw);

      assert(comment.reply_num === 0, `reply_num 应为 0`);
      assert(comment.replies === undefined, `无回复时 replies 应为 undefined`);
      assert(comment.mentions === undefined, `无艾特时 mentions 应为 undefined`);
    },
  },
  {
    name: 'parseEnhancedComment: 应正确解析带艾特的评论',
    fn: () => {
      const raw = {
        tid: 1,
        uin: 123,
        name: '测试用户',
        content: '@{uin:456,nick:好友,who:1,auto:1}你好',
        create_time: 1000,
        createTime: '2026年01月01日',
        createTime2: '2026-01-01 00:00:00',
        reply_num: 0,
      };

      const comment = parseEnhancedComment(raw);

      assert(comment.content === '你好', `content 应为解析后的 "你好"`);
      assert(comment.mentions !== undefined, `应有 mentions`);
      assert(comment.mentions!.length === 1, `应有 1 个艾特`);
      assert(comment.mentions![0]!.uin === '456', `mentions[0].uin 应为 456`);
    },
  },

  // ========== extractDeviceInfo 测试 ==========
  {
    name: 'extractDeviceInfo: 应正确解析设备信息',
    fn: () => {
      const raw = {
        source_name: 'Xiaomi 15 Pro',
        source_url: '',
        t1_termtype: 4,
      };

      const device = extractDeviceInfo(raw);

      assert(device !== undefined, `应返回 device`);
      assert(device!.name === 'Xiaomi 15 Pro', `name 不正确`);
      assert(device!.url === '', `url 应为空字符串`);
      assert(device!.termtype === 4, `termtype 应为 4`);
    },
  },
  {
    name: 'extractDeviceInfo: 应正确处理无设备信息',
    fn: () => {
      const device = extractDeviceInfo({});
      assert(device === undefined, `无 source_name 时应返回 undefined`);
    },
  },
  {
    name: 'extractDeviceInfo: 应正确处理部分设备信息',
    fn: () => {
      const raw = {
        source_name: 'iPhone',
        // source_url 和 t1_termtype 缺失
      };

      const device = extractDeviceInfo(raw);

      assert(device !== undefined, `应返回 device`);
      assert(device!.name === 'iPhone', `name 不正确`);
      assert(device!.url === undefined, `url 应为 undefined`);
      assert(device!.termtype === undefined, `termtype 应为 undefined`);
    },
  },
];

export async function run(): Promise<{ name: string; passed: number; failed: number; errors: Array<{ test: string; error: string }> }> {
  return runSuite('feeds3-enhanced', cases);
}
