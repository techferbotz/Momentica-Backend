/**
 * Minimal assertion harness for the `check:*` fixtures.
 * Deliberately not a test framework — these run under plain ts-node.
 */
let passed = 0;
const failures: string[] = [];

export function check(label: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
    })
    .catch((err: unknown) => {
      failures.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    });
}

export function expectEqual<T>(actual: T, expected: T, what = 'value'): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${what} — expected ${b}, got ${a}`);
}

export function expectTrue(condition: boolean, what: string): void {
  if (!condition) throw new Error(what);
}

export function expectThrows(fn: () => unknown, what: string): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error(`${what} — expected a throw, got none`);
}

export function report(suite: string): void {
  if (failures.length > 0) {
    console.error(`\n${suite}: ${failures.length} failed, ${passed} passed\n`);
    for (const failure of failures) console.error(`  x ${failure}`);
    process.exit(1);
  }
  console.log(`${suite}: ${passed} passed`);
}
