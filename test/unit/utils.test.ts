/**
 * QZone 工具函数单元测试（calcGtk, parseJsonp, quotePlus, htmlUnescape 等）
 */
import { calcGtk, parseJsonp, quotePlus, unescapeXHex, htmlUnescape, safeDecodeJsonResponse } from '../../src/qzone/utils.js';
import { assert, runSuite, type TestCase } from '../test-helpers.js';

const cases: TestCase[] = [
  {
    name: 'calcGtk 已知值',
    fn: () => {
      const out = calcGtk('123456789');
      assert(typeof out === 'number', 'calcGtk 应返回数字');
      assert(out >= 0 && out <= 0x7fffffff, '应在 32 位有符号正数范围内');
      // 与 Python 一致：相同输入应得相同输出
      assert(calcGtk('') === 5381, '空串应为 5381');
    },
  },
  {
    name: 'parseJsonp 纯 JSON',
    fn: () => {
      const json = '{"code":0,"msg":"ok"}';
      const out = parseJsonp(json);
      assert(Boolean(out && typeof out === 'object' && (out as Record<string, unknown>).code === 0), '应解析出 code=0');
    },
  },
  {
    name: 'parseJsonp 带 callback',
    fn: () => {
      const text = '_Callback({"code":0,"data":1});';
      const out = parseJsonp(text);
      const o = out as Record<string, unknown>;
      assert(Boolean(out && typeof out === 'object' && o.code === 0 && o.data === 1), '应解析出 code=0, data=1');
    },
  },
  {
    name: 'parseJsonp 空/无效',
    fn: () => {
      const out = parseJsonp('');
      assert(Boolean(out && typeof out === 'object' && (out as Record<string, unknown>)._empty === true), '空串应返回 _empty');
    },
  },
  {
    name: 'parseJsonp frameElement.callback (publish_v6 格式)',
    fn: () => {
      const html = '<html><head></head><body><script type="text/javascript"> var cb;try{document.domain="user.qzone.qq.com";cb=frameElement.callback;}catch(e){} frameElement.callback({"code":0,"tid":"abc123","t1_tid":"t_abc"})</script></body></html>';
      const out = parseJsonp(html) as any;
      assert(out && out.code === 0, 'code 应为 0');
      assert(out.tid === 'abc123', 'tid 应为 abc123');
      assert(out.t1_tid === 't_abc', 't1_tid 应为 t_abc');
    },
  },
  {
    name: 'quotePlus',
    fn: () => {
      assert(quotePlus('a b') === 'a+b', '空格应为 +');
      assert(quotePlus('中') !== '中', '非 ASCII 应被编码');
    },
  },
  {
    name: 'unescapeXHex',
    fn: () => {
      assert(unescapeXHex('\\x26') === '&', '\\x26 -> &');
      assert(unescapeXHex('a\\x3Cb') === 'a<b', '\\x3C -> <');
    },
  },
  {
    name: 'htmlUnescape',
    fn: () => {
      assert(htmlUnescape('&amp;') === '&', '&amp; -> &');
      assert(htmlUnescape('&lt;div&gt;') === '<div>', '&lt;&gt;');
      assert(htmlUnescape('&#39;') === "'", '&#39; -> single quote');
    },
  },
  {
    name: 'safeDecodeJsonResponse 空',
    fn: () => {
      const out = safeDecodeJsonResponse('');
      assert(out._empty === true, '空 body 应 _empty');
    },
  },
  {
    name: 'safeDecodeJsonResponse JSON 字符串',
    fn: () => {
      const out = safeDecodeJsonResponse('{"code":0}');
      assert(!out._empty && (out as any).code === 0, '应解析 JSON');
    },
  },
];

export async function run(): Promise<{ name: string; passed: number; failed: number; errors: Array<{ test: string; error: string }> }> {
  return runSuite('qzone/utils', cases);
}
