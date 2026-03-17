/**
 * Poller 辅助函数单元测试（extractImages, extractVideos, stripHtml, normalizeEmotion）
 */
import { extractImages, extractVideos, stripHtml, normalizeEmotion, rebuildContentFromConlist } from '../../src/bridge/poller.js';
import { assert, runSuite, type TestCase } from '../test-helpers.js';

const cases: TestCase[] = [
  // ── stripHtml ──
  {
    name: 'stripHtml 去除标签',
    fn: () => {
      assert(stripHtml('<b>hello</b>') === 'hello', '应去除 <b>');
      assert(stripHtml('<div class="x">text</div>') === 'text', '应去除 <div>');
      assert(stripHtml('plain text') === 'plain text', '纯文本不变');
    },
  },
  {
    name: 'stripHtml 解码 HTML 实体',
    fn: () => {
      assert(stripHtml('a &amp; b') === 'a & b', '&amp; → &');
      assert(stripHtml('&lt;div&gt;') === '<div>', '&lt;&gt; → <>');
    },
  },

  // ── extractImages ──
  {
    name: 'extractImages 空输入',
    fn: () => {
      assert(extractImages(null).length === 0, 'null → []');
      assert(extractImages(undefined).length === 0, 'undefined → []');
      assert(extractImages('string').length === 0, 'string → []');
      assert(extractImages([]).length === 0, '[] → []');
    },
  },
  {
    name: 'extractImages 优先级 url2 > url3 > url1',
    fn: () => {
      const pics = [
        { url1: 'http://a.jpg', url2: 'http://b.jpg', url3: 'http://c.jpg' },
      ];
      const out = extractImages(pics);
      assert(out.length === 1, '应返回 1 个');
      assert(out[0] === 'http://b.jpg', '应选 url2');
    },
  },
  {
    name: 'extractImages url2 缺失时 fallback url3',
    fn: () => {
      const pics = [{ url1: 'http://a.jpg', url3: 'http://c.jpg' }];
      const out = extractImages(pics);
      assert(out[0] === 'http://c.jpg', '应选 url3');
    },
  },
  {
    name: 'extractImages 纯字符串数组',
    fn: () => {
      const out = extractImages(['http://x.jpg', 'http://y.jpg']);
      assert(out.length === 2, '应返回 2 个');
      assert(out[0] === 'http://x.jpg', '第 1 个');
      assert(out[1] === 'http://y.jpg', '第 2 个');
    },
  },
  {
    name: 'extractImages 对象无已知 key 时 fallback http',
    fn: () => {
      const pics = [{ custom_url: 'http://fallback.jpg' }];
      const out = extractImages(pics);
      assert(out.length === 1 && out[0] === 'http://fallback.jpg', '应 fallback');
    },
  },
  {
    name: 'extractImages smallurl 优先于 url',
    fn: () => {
      const pics = [{ smallurl: 'http://small.jpg', url: 'http://raw.jpg' }];
      const out = extractImages(pics);
      assert(out[0] === 'http://small.jpg', '应选 smallurl');
    },
  },

  // ── extractVideos ──
  {
    name: 'extractVideos 空输入',
    fn: () => {
      const { videoUrls, videoCoverUrls } = extractVideos({});
      assert(videoUrls.length === 0, '无 video 时空');
      assert(videoCoverUrls.length === 0, '无 cover 时空');
    },
  },
  {
    name: 'extractVideos 正常提取',
    fn: () => {
      const raw = {
        video: [
          { url3: 'http://play.mp4', url1: 'http://cover.jpg' },
          { video_url: 'http://play2.mp4', pic_url: 'http://cover2.jpg' },
        ],
      };
      const { videoUrls, videoCoverUrls } = extractVideos(raw);
      assert(videoUrls.length === 2, '应有 2 个视频');
      assert(videoUrls[0] === 'http://play.mp4', '第1个视频 url3');
      assert(videoUrls[1] === 'http://play2.mp4', '第2个视频 video_url');
      assert(videoCoverUrls[0] === 'http://cover.jpg', '第1个封面 url1');
      assert(videoCoverUrls[1] === 'http://cover2.jpg', '第2个封面 pic_url');
    },
  },
  {
    name: 'extractVideos url3 优先于 video_url',
    fn: () => {
      const raw = { video: [{ url3: 'http://hd.mp4', video_url: 'http://sd.mp4', url: 'http://raw.mp4' }] };
      const { videoUrls } = extractVideos(raw);
      assert(videoUrls[0] === 'http://hd.mp4', '应选 url3');
    },
  },

  // ── normalizeEmotion ──
  {
    name: 'normalizeEmotion 基本字段',
    fn: () => {
      const raw = {
        tid: 'abc123',
        uin: '12345',
        nickname: '<b>Test</b>',
        content: 'Hello &amp; World',
        createTime: 1700000000,
        cmtnum: 3,
        fwdnum: 1,
        pic: [{ url2: 'http://pic.jpg' }],
      };
      const item = normalizeEmotion(raw, '99999');
      assert(item.tid === 'abc123', 'tid');
      assert(item.uin === '12345', 'uin');
      assert(item.nickname === 'Test', 'nickname 应去 HTML');
      assert(item.content === 'Hello & World', 'content 应解码');
      assert(item.createdTime === 1700000000, 'createdTime');
      assert(item.cmtnum === 3, 'cmtnum');
      assert(item.fwdnum === 1, 'fwdnum');
      assert(item.pics.length === 1 && item.pics[0] === 'http://pic.jpg', 'pics');
    },
  },
  {
    name: 'normalizeEmotion 视频提取',
    fn: () => {
      const raw = {
        tid: 'v1',
        uin: '1',
        content: 'vid',
        video: [{ url3: 'http://video.mp4', url1: 'http://cover.jpg' }],
      };
      const item = normalizeEmotion(raw, '99');
      assert(item.videos != null && item.videos.length === 1, '应有 1 个视频');
      assert(item.videos![0] === 'http://video.mp4', '视频 URL');
      // 封面应加入 pics
      assert(item.pics.includes('http://cover.jpg'), '封面应在 pics 中');
    },
  },
  {
    name: 'normalizeEmotion 转发信息',
    fn: () => {
      const raw = {
        tid: 'f1',
        uin: '1',
        content: 'forwarded',
        rt_con: { content: 'original <b>post</b>', uin: '222', tid: 'orig_tid' },
      };
      const item = normalizeEmotion(raw, '99');
      assert(item.forwardContent === 'original post', 'forwardContent 应去 HTML');
      assert(item.forwardUin === '222', 'forwardUin');
      assert(item.forwardTid === 'orig_tid', 'forwardTid');
    },
  },
  {
    name: 'normalizeEmotion 缺省字段',
    fn: () => {
      const raw = {};
      const item = normalizeEmotion(raw, '99');
      assert(item.tid === '', 'tid 应为空串');
      assert(item.uin === '99', 'uin 应 fallback 到 selfUin');
      assert(item.content === '', 'content 应为空串');
      assert(item.createdTime === 0, 'createdTime 应为 0');
      assert(item.pics.length === 0, 'pics 应为空');
    },
  },

  // ── rebuildContentFromConlist ──
  {
    name: 'rebuildContentFromConlist 空数组',
    fn: () => {
      assert(rebuildContentFromConlist([]) === '', '空数组应返回空串');
    },
  },
  {
    name: 'rebuildContentFromConlist type 0 (@人)',
    fn: () => {
      const conlist = [{ type: 0, nick: 'Alice' }];
      const out = rebuildContentFromConlist(conlist);
      assert(out === '@Alice', '应返回 @Alice');
    },
  },
  {
    name: 'rebuildContentFromConlist type 1 纯文本',
    fn: () => {
      const conlist = [{ type: 1, con: '今天天气真好' }];
      const out = rebuildContentFromConlist(conlist);
      assert(out === '今天天气真好', '应返回纯文本');
    },
  },
  {
    name: 'rebuildContentFromConlist type 2 表情文本',
    fn: () => {
      const conlist = [{ type: 2, con: '[em]e10271[/em]' }];
      const out = rebuildContentFromConlist(conlist);
      assert(out === '[吃瓜]', 'type 2 应转为表情名');
    },
  },
  {
    name: 'rebuildContentFromConlist 混合类型',
    fn: () => {
      const conlist = [
        { type: 0, nick: 'Bob' },
        { type: 1, con: ' 你好呀 ' },
        { type: 2, con: '[em]e100[/em]' },
      ];
      const out = rebuildContentFromConlist(conlist);
      assert(out === '@Bob 你好呀 [微笑]', '混合应正确拼接（表情转名）');
    },
  },
  {
    name: 'rebuildContentFromConlist HTML 标签被清理',
    fn: () => {
      const conlist = [{ type: 1, con: '<b>加粗</b>' }];
      const out = rebuildContentFromConlist(conlist);
      assert(out === '加粗', 'HTML 应被去除');
    },
  },

  // ── normalizeEmotion 增强：conlist fallback ──
  {
    name: 'normalizeEmotion content 为空时 fallback conlist',
    fn: () => {
      const raw = {
        tid: 'cl1',
        uin: '100',
        content: '',
        conlist: [{ type: 1, con: '来自 conlist 的内容' }],
      };
      const item = normalizeEmotion(raw, '99');
      assert(item.content === '来自 conlist 的内容', 'content 应从 conlist 重建');
    },
  },

  // ── normalizeEmotion 增强：独立顶层 rt_* 字段 ──
  {
    name: 'normalizeEmotion 顶层 rt_* 独立字段（字符串形式）',
    fn: () => {
      const raw = {
        tid: 'fwd1',
        uin: '1',
        content: '我转发了',
        rt_tid: 'orig_tid_123',
        rt_uin: '555',
        rt_uinname: '原作者',
        rt_con: '原始内容 <b>bold</b>',
      };
      const item = normalizeEmotion(raw, '99');
      assert(item.forwardTid === 'orig_tid_123', 'forwardTid 应匹配');
      assert(item.forwardUin === '555', 'forwardUin 应匹配');
      assert(item.forwardNickname === '原作者', 'forwardNickname 应匹配');
      assert(item.forwardContent === '原始内容 bold', 'forwardContent 应去 HTML');
    },
  },
  {
    name: 'normalizeEmotion 顶层 rt_tid + 嵌套 rt_con 对象',
    fn: () => {
      const raw = {
        tid: 'fwd2',
        uin: '1',
        content: '转发',
        rt_tid: 'ot2',
        rt_uin: '666',
        rt_con: { content: '嵌套内容' },
      };
      const item = normalizeEmotion(raw, '99');
      assert(item.forwardTid === 'ot2', 'forwardTid');
      assert(item.forwardContent === '嵌套内容', 'forwardContent 从嵌套对象提取');
    },
  },
  {
    name: 'normalizeEmotion forwardNickname',
    fn: () => {
      const raw = {
        tid: 'fn1',
        uin: '1',
        content: 'test',
        rt_tid: 'x',
        rt_uinname: '测试昵称',
        rt_con: '内容',
      };
      const item = normalizeEmotion(raw, '99');
      assert(item.forwardNickname === '测试昵称', 'forwardNickname 应存在');
    },
  },
];

export async function run(): Promise<{ name: string; passed: number; failed: number; errors: Array<{ test: string; error: string }> }> {
  return runSuite('poller/helpers', cases);
}
