/**
 * Bridge 工具函数单元测试（safeInt, safeHex, escapeRegex）
 */
import { safeInt, safeHex, escapeRegex } from '../../src/bridge/utils.js';
import { assert, runSuite, type TestCase } from '../test-helpers.js';

const cases: TestCase[] = [
  {
    name: 'safeInt 正常数字',
    fn: () => {
      assert(safeInt(42) === 42, '42 -> 42');
      assert(safeInt('100') === 100, '"100" -> 100');
      assert(safeInt(3.9) === 3, '3.9 -> 3');
    },
  },
  {
    name: 'safeInt 空/无效',
    fn: () => {
      assert(safeInt(null) === 0, 'null -> 0');
      assert(safeInt(undefined) === 0, 'undefined -> 0');
      assert(safeInt('') === 0, '"" -> 0');
      assert(safeInt('x') === 0, '"x" -> 0');
      assert(safeInt(NaN) === 0, 'NaN -> 0');
    },
  },
  {
    name: 'safeInt 默认值',
    fn: () => {
      assert(safeInt(null, 99) === 99, 'null 默认 99');
    },
  },
  {
    name: 'safeHex',
    fn: () => {
      assert(safeHex('0x10') === 16, '0x10 -> 16');
      assert(safeHex(10) === 10, '10 -> 10');
      assert(safeHex('') === 0, '"" -> 0');
    },
  },
  {
    name: 'escapeRegex',
    fn: () => {
      const s = escapeRegex('a.b');
      assert(new RegExp(s).test('a.b'), '转义后应能匹配 a.b');
      assert(!new RegExp(s).test('axb'), '不应匹配 axb');
    },
  },
];

export async function run(): Promise<{ name: string; passed: number; failed: number; errors: Array<{ test: string; error: string }> }> {
  return runSuite('bridge/utils', cases);
}
