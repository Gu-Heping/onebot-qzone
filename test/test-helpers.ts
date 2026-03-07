/**
 * 轻量断言与测试收集，不依赖 jest/vitest。
 * 用法：assert(condition, 'message'); 失败则抛错，由 run-all 捕获。
 */
export function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export type TestCase = {
  name: string;
  fn: () => void | Promise<void>;
};

export type SuiteResult = {
  name: string;
  passed: number;
  failed: number;
  errors: Array<{ test: string; error: string }>;
};

export async function runSuite(suiteName: string, cases: TestCase[]): Promise<SuiteResult> {
  const result: SuiteResult = { name: suiteName, passed: 0, failed: 0, errors: [] };
  for (const t of cases) {
    try {
      await t.fn();
      result.passed++;
    } catch (e: unknown) {
      result.failed++;
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push({ test: t.name, error: msg });
    }
  }
  return result;
}
