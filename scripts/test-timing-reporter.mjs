// D2: a node:test reporter that adds up the time of each file's top-level tests. bench.mjs runs it beside the TAP
// reporter (--test-reporter=./scripts/test-timing-reporter.mjs --test-reporter-destination=<file>) and folds the
// lines into its receipt as fileTimings, which `bench.mjs --write-weights` turns into platform/tests/test-weights.json.
// One JSON line per file: {"file":"<absolute path>","ms":<sum of top-level test durations>}.
export default async function* timings(source) {
  const perFile = new Map();
  for await (const event of source) {
    if (event.type !== 'test:pass' && event.type !== 'test:fail') continue;
    const { file, nesting, details } = event.data;
    if (!file || nesting !== 0 || typeof details?.duration_ms !== 'number') continue;
    perFile.set(file, (perFile.get(file) ?? 0) + details.duration_ms);
  }
  for (const [file, ms] of [...perFile].sort((left, right) => (left[0] < right[0] ? -1 : 1))) yield `${JSON.stringify({ file, ms })}\n`;
}
