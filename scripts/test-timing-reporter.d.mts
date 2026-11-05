// Types for scripts/test-timing-reporter.mjs (D2, D11): a node:test reporter, one JSON line per test file.
export default function timings(source: AsyncIterable<{ type: string; data?: any }>): AsyncGenerator<string, void, unknown>;
