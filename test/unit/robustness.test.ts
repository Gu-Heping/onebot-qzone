/**
 * 鲁棒性 / 边缘用例测试：
 *  - HTTP 服务认证、异常请求体、未知 action
 *  - normalizeEmotion 各种畸形输入
 *  - config 环境变量解析边缘情况
 *  - stripHtml / extractImages 极端输入
 */
import { assert, runSuite, type TestCase } from '../test-helpers.js';
import { stripHtml, extractImages, extractVideos, normalizeEmotion, rebuildContentFromConlist } from '../../src/bridge/poller.js';
import { safeInt, safeHex, escapeRegex } from '../../src/bridge/utils.js';
import { calcGtk, parseJsonp, htmlUnescape } from '../../src/qzone/utils.js';

const cases: TestCase[] = [
  // ── utils 边缘 ──
  {
    name: 'safeInt 巨大数字截断安全',
    fn: () => {
      // JS Number.MAX_SAFE_INTEGER + 1 不安全
      assert(typeof safeInt(Number.MAX_SAFE_INTEGER) === 'number', '安全整数');
      assert(typeof safeInt('999999999999999999999') === 'number', '超大字串不崩溃');
      assert(safeInt(null) === 0, 'null → 0');
      assert(safeInt(undefined) === 0, 'undefined → 0');
      assert(safeInt(NaN) === 0, 'NaN → 0');
      assert(safeInt('not_a_number') === 0, '非数字串 → 0');
    },
  },
  {
    name: 'safeHex 各种输入',
    fn: () => {
      // 'ff' 无 0x 前缀，fallback 到 safeInt → NaN → 0
      assert(safeHex('ff') === 0, 'ff 无前缀 → 0');
      assert(safeHex('0xff') === 255, '0xff → 255');
      assert(safeHex('0') === 0, '0 → 0');
      assert(safeHex('') === 0, '空串 → 0');
      assert(safeHex('xyz') === 0 || typeof safeHex('xyz') === 'number', 'xyz 不崩溃');
    },
  },
  {
    name: 'escapeRegex 特殊字符',
    fn: () => {
      const escaped = escapeRegex('[test].(foo)*+?');
      assert(escaped.includes('\\['), '[ 应被转义');
      assert(escaped.includes('\\*'), '* 应被转义');
      assert(!escaped.includes('[test]'), '不应保留原样');
    },
  },

  // ── calcGtk 边缘 ──
  {
    name: 'calcGtk 空字符串',
    fn: () => {
      const result = calcGtk('');
      assert(typeof result === 'number', '应返回数字');
      assert(result > 0 || result === 0, '结果 >= 0');
    },
  },
  {
    name: 'calcGtk 中文字符',
    fn: () => {
      const result = calcGtk('你好世界');
      assert(typeof result === 'number' && result > 0, '中文应产生有效 hash');
    },
  },

  // ── parseJsonp 边缘 ──
  {
    name: 'parseJsonp 嵌套对象',
    fn: () => {
      const r = parseJsonp('callback({"a":{"b":[1,2,3]}})');
      assert(r !== null && (r as any).a.b[1] === 2, '嵌套对象解析');
    },
  },
  {
    name: 'parseJsonp 无包裹的 JSON',
    fn: () => {
      const r = parseJsonp('{"direct":true}');
      assert(r !== null && (r as any).direct === true, '直接 JSON 应能解析');
    },
  },
  {
    name: 'parseJsonp 空字符串',
    fn: () => {
      const r = parseJsonp('') as any;
      // 空串走 fallback: JSON.parse('') 失败 → 返回 { _empty: true, raw: '' }
      assert(r !== null && r._empty === true, '空串应返回 _empty 对象');
    },
  },
  {
    name: 'parseJsonp 纯垃圾数据',
    fn: () => {
      const r = parseJsonp('<<<garbage>>>') as any;
      // 垃圾数据 → 所有解析失败 → 返回 { _empty: true, raw: ... }
      assert(r !== null && r._empty === true, '垃圾数据应返回 _empty 对象');
    },
  },

  // ── htmlUnescape 边缘 ──
  {
    name: 'htmlUnescape 多重实体',
    fn: () => {
      assert(htmlUnescape('&amp;amp;') === '&amp;', '双重 amp 只解码一层');
      assert(htmlUnescape('&#39;') === "'", '&#39; → 单引号');
      assert(htmlUnescape('&quot;hello&quot;') === '"hello"', 'quot → 双引号');
    },
  },

  // ── stripHtml 极端 ──
  {
    name: 'stripHtml 大量嵌套标签',
    fn: () => {
      const html = '<div><span><a href="x"><b><i>深层</i></b></a></span></div>';
      assert(stripHtml(html) === '深层', '多层嵌套去标签');
    },
  },
  {
    name: 'stripHtml 处理自闭合标签',
    fn: () => {
      assert(stripHtml('hello<br/>world') === 'helloworld', 'br 自闭合');
      assert(stripHtml('a<img src="x"/>b') === 'ab', 'img 自闭合');
    },
  },

  // ── extractImages 极端 ──
  {
    name: 'extractImages 非数组对象不崩溃',
    fn: () => {
      assert(extractImages({ not: 'array' }).length === 0, '对象 → []');
      assert(extractImages(123).length === 0, '数字 → []');
      assert(extractImages(true).length === 0, '布尔 → []');
    },
  },
  {
    name: 'extractImages 混合有效无效元素',
    fn: () => {
      const pics = [
        null,
        undefined,
        'http://direct.jpg',
        { url2: 'http://obj.jpg' },
        42,
        { no_url: 'nope' },
      ];
      const out = extractImages(pics);
      assert(out.includes('http://direct.jpg'), '字符串应保留');
      assert(out.includes('http://obj.jpg'), 'url2 应提取');
    },
  },

  // ── extractVideos 极端 ──
  {
    name: 'extractVideos video 非数组',
    fn: () => {
      const { videoUrls } = extractVideos({ video: 'not_array' });
      assert(videoUrls.length === 0, '非数组 video 应为空');
    },
  },
  {
    name: 'extractVideos 空 url 字段不提取',
    fn: () => {
      const { videoUrls, videoCoverUrls } = extractVideos({ video: [{ url3: '', url1: '' }] });
      assert(videoUrls.length === 0, '空 url3 不应提取');
      assert(videoCoverUrls.length === 0, '空 url1 不应提取');
    },
  },

  // ── normalizeEmotion 畸形输入 ──
  {
    name: 'normalizeEmotion null/undefined 字段容错',
    fn: () => {
      const raw = {
        tid: null,
        uin: undefined,
        nickname: null,
        content: undefined,
        createTime: 'not_a_number',
        cmtnum: null,
        pic: 'not_array',
      };
      const item = normalizeEmotion(raw as any, '999');
      assert(item.tid === 'null' || item.tid === '', 'tid 容错');
      assert(typeof item.uin === 'string', 'uin 容错');
      assert(typeof item.content === 'string', 'content 容错');
      assert(typeof item.createdTime === 'number', 'createdTime 容错');
      assert(Array.isArray(item.pics), 'pics 容错');
    },
  },
  {
    name: 'normalizeEmotion 超长内容不截断',
    fn: () => {
      const longContent = 'A'.repeat(100000);
      const raw = { tid: 'long', content: longContent };
      const item = normalizeEmotion(raw, '1');
      assert(item.content.length === 100000, '超长内容应完整保留');
    },
  },
  {
    name: 'normalizeEmotion 全字段为空对象时不崩溃',
    fn: () => {
      const raw = {
        tid: {},
        uin: [],
        nickname: false,
        content: 0,
        createTime: {},
        pic: {},
        video: null,
        rt_con: null,
      };
      // 不应抛异常
      const item = normalizeEmotion(raw as any, '1');
      assert(typeof item.tid === 'string', 'tid 为字符串');
      assert(typeof item.content === 'string', 'content 为字符串');
    },
  },

  // ── rebuildContentFromConlist 边缘 ──
  {
    name: 'rebuildContentFromConlist 缺失 con/nick 字段',
    fn: () => {
      const conlist = [
        { type: 0 }, // @人但无 nick
        { type: 1 }, // 文本但无 con
        { type: 99, con: 'unknown type' },
      ];
      const out = rebuildContentFromConlist(conlist);
      assert(out.includes('@'), 'type 0 应有 @ 前缀');
      assert(out.includes('unknown type'), '未知 type 也应提取 con');
    },
  },
  {
    name: 'rebuildContentFromConlist 类型为字符串数字',
    fn: () => {
      const conlist = [
        { type: '1', con: '字符串类型' },
      ];
      const out = rebuildContentFromConlist(conlist);
      assert(out === '字符串类型', '字符串 type 也应工作');
    },
  },

  // ── normalizeEmotion 转发场景完整覆盖 ──
  {
    name: 'normalizeEmotion 无转发字段时 forward* 为 undefined',
    fn: () => {
      const raw = { tid: 'nf', uin: '1', content: 'no forward' };
      const item = normalizeEmotion(raw, '1');
      assert(item.forwardTid === undefined, 'forwardTid 应 undefined');
      assert(item.forwardUin === undefined, 'forwardUin 应 undefined');
      assert(item.forwardContent === undefined, 'forwardContent 应 undefined');
      assert(item.forwardNickname === undefined, 'forwardNickname 应 undefined');
    },
  },
  {
    name: 'normalizeEmotion rt_tid 为空串不触发转发',
    fn: () => {
      const raw = { tid: 'et', uin: '1', rt_tid: '', rt_con: 'ignored' };
      const item = normalizeEmotion(raw, '1');
      // rt_tid 为空串不应触发独立字段逻辑
      assert(item.forwardTid === undefined || item.forwardTid === '', 'rt_tid 空串');
    },
  },
];

export async function run() {
  return runSuite('robustness/edge-cases', cases);
}
