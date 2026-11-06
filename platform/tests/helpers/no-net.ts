// Fix round 1 (review MEDIUM-2): for one test, any real fetch throws NETWORK_NOT_ALLOWED instead of leaving this
// computer. Call it as test.beforeEach(t => noNet(t)) in a file whose code under test has a real network default; the
// mock is undone when each test ends, so nothing leaks into other files run in the same process.
import type { SuiteContext, TestContext } from 'node:test';

export const NETWORK_NOT_ALLOWED = 'NETWORK_NOT_ALLOWED';

export function noNet(t: TestContext | SuiteContext): void {
  if (!('mock' in t)) throw new Error('noNet is for a test, not a suite.');
  t.mock.method(globalThis, 'fetch', async () => {
    throw Object.assign(new Error('A test asked the real network. Pass a stand-in (download, http or net) instead.'), { code: NETWORK_NOT_ALLOWED });
  });
}
