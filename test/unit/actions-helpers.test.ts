/**
 * Actions 辅助函数单元测试（isSafeUrl, parseMessageSegments）
 */
import { isSafeUrl, parseMessageSegments } from '../../src/bridge/actions.js';
import { assert, runSuite, type TestCase } from '../test-helpers.js';

const cases: TestCase[] = [
  // ── isSafeUrl ──
  {
    name: 'isSafeUrl 公网 HTTPS',
    fn: () => {
      assert(isSafeUrl('https://example.com/img.png') === true, '正常 HTTPS 应通过');
    },
  },
  {
    name: 'isSafeUrl 公网 HTTP',
    fn: () => {
      assert(isSafeUrl('http://cdn.example.com/file') === true, '正常 HTTP 应通过');
    },
  },
  {
    name: 'isSafeUrl 拒绝 FTP 协议',
    fn: () => {
      assert(isSafeUrl('ftp://example.com/file') === false, 'FTP 应拒绝');
    },
  },
  {
    name: 'isSafeUrl 拒绝 file 协议',
    fn: () => {
      assert(isSafeUrl('file:///etc/passwd') === false, 'file: 应拒绝');
    },
  },
  {
    name: 'isSafeUrl 拒绝 127.0.0.1 (loopback)',
    fn: () => {
      assert(isSafeUrl('http://127.0.0.1:8080/') === false, '127.x 应拒绝');
    },
  },
  {
    name: 'isSafeUrl 拒绝 10.x (A 类内网)',
    fn: () => {
      assert(isSafeUrl('http://10.0.0.1/api') === false, '10.x 应拒绝');
    },
  },
  {
    name: 'isSafeUrl 拒绝 192.168.x (C 类内网)',
    fn: () => {
      assert(isSafeUrl('http://192.168.1.1/') === false, '192.168.x 应拒绝');
    },
  },
  {
    name: 'isSafeUrl 拒绝 172.16-31.x (B 类内网)',
    fn: () => {
      assert(isSafeUrl('http://172.16.0.1/') === false, '172.16.x 应拒绝');
      assert(isSafeUrl('http://172.31.255.255/') === false, '172.31.x 应拒绝');
    },
  },
  {
    name: 'isSafeUrl 拒绝 localhost',
    fn: () => {
      assert(isSafeUrl('http://localhost:3000/') === false, 'localhost 应拒绝');
    },
  },
  {
    name: 'isSafeUrl 拒绝 0.0.0.0',
    fn: () => {
      assert(isSafeUrl('http://0.0.0.0/') === false, '0.0.0.0 应拒绝');
    },
  },
  {
    name: 'isSafeUrl 非法 URL',
    fn: () => {
      assert(isSafeUrl('not a url') === false, '非法字符串应拒绝');
      assert(isSafeUrl('') === false, '空串应拒绝');
    },
  },

  // ── parseMessageSegments ──
  {
    name: 'parseMessageSegments 纯文本 CQ 码',
    fn: () => {
      const segs = parseMessageSegments('Hello World');
      assert(segs.length === 1, '应有 1 个段');
      assert(segs[0].type === 'text', '类型应为 text');
      assert(segs[0].data.text === 'Hello World', '内容应匹配');
    },
  },
  {
    name: 'parseMessageSegments 图片 CQ 码',
    fn: () => {
      const segs = parseMessageSegments('[CQ:image,file=http://a.jpg]');
      assert(segs.length === 1, '应有 1 个段');
      assert(segs[0].type === 'image', '类型应为 image');
      assert(segs[0].data.file === 'http://a.jpg', 'file 参数应匹配');
    },
  },
  {
    name: 'parseMessageSegments 混合文本+CQ 码',
    fn: () => {
      const segs = parseMessageSegments('前缀[CQ:at,qq=123]后缀');
      assert(segs.length === 3, '应有 3 个段');
      assert(segs[0].type === 'text' && segs[0].data.text === '前缀', '前缀文本');
      assert(segs[1].type === 'at' && segs[1].data.qq === '123', 'at 段');
      assert(segs[2].type === 'text' && segs[2].data.text === '后缀', '后缀文本');
    },
  },
  {
    name: 'parseMessageSegments 数组形式（对象段）',
    fn: () => {
      const msg = [
        { type: 'text', data: { text: 'hello' } },
        { type: 'image', data: { file: 'http://b.jpg' } },
      ];
      const segs = parseMessageSegments(msg);
      assert(segs.length === 2, '应有 2 个段');
      assert(segs[0].type === 'text' && segs[0].data.text === 'hello', '文本段');
      assert(segs[1].type === 'image' && segs[1].data.file === 'http://b.jpg', '图片段');
    },
  },
  {
    name: 'parseMessageSegments 数组形式（字符串元素）',
    fn: () => {
      const segs = parseMessageSegments(['just text']);
      assert(segs.length === 1, '应有 1 个段');
      assert(segs[0].type === 'text' && segs[0].data.text === 'just text', '字符串段变 text');
    },
  },
  {
    name: 'parseMessageSegments 空输入',
    fn: () => {
      assert(parseMessageSegments(null).length === 0, 'null → []');
      assert(parseMessageSegments(undefined).length === 0, 'undefined → []');
      assert(parseMessageSegments(42).length === 0, 'number → []');
      assert(parseMessageSegments({}).length === 0, 'object → []');
    },
  },
  {
    name: 'parseMessageSegments 多参数 CQ 码',
    fn: () => {
      const segs = parseMessageSegments('[CQ:record,file=http://v.mp3,magic=true]');
      assert(segs.length === 1, '应有 1 个段');
      assert(segs[0].type === 'record', '类型应为 record');
      assert(segs[0].data.file === 'http://v.mp3', 'file 参数');
      assert(segs[0].data.magic === 'true', 'magic 参数');
    },
  },
  {
    name: 'parseMessageSegments 连续 CQ 码',
    fn: () => {
      const segs = parseMessageSegments('[CQ:face,id=1][CQ:face,id=2]');
      assert(segs.length === 2, '应有 2 个段');
      assert(segs[0].data.id === '1', '第 1 个 face');
      assert(segs[1].data.id === '2', '第 2 个 face');
    },
  },
];

export async function run(): Promise<{ name: string; passed: number; failed: number; errors: Array<{ test: string; error: string }> }> {
  return runSuite('actions/helpers', cases);
}
