// D2: a node:test reporter that adds up the time of each file's top-level tests. bench.mjs runs it beside the TAP
// reporter (--test-reporter=./scripts/test-timing-reporter.mjs --test-reporter-destination=<file>) and folds the
// lines into its receipt as fileTimings, which `bench.mjs --write-weights` turns into platform/tests/test-weights.json.
// D11: each line also counts the file's top-level tests (skip holds skipped and todo tests), for the common receipt
// format in scripts/receipt.mjs.
// One JSON line per file: {"file":"<absolute path>","ms":<sum of top-level test durations>,"tests","pass","fail","skip"}.
export default async function* timings(source) {
  const perFile = new Map();
  for await (const event of source) {
    if (event.type !== 'test:pass' && event.type !== 'test:fail') continue;
    const { file, nesting, details, skip, todo } = event.data;
    if (!file || nesting !== 0 || typeof details?.duration_ms !== 'number') continue;
    const entry = perFile.get(file) ?? { ms: 0, tests: 0, pass: 0, fail: 0, skip: 0 };
    entry.ms += details.duration_ms; entry.tests += 1;
    if (skip !== undefined || todo !== undefined) entry.skip += 1;
    else if (event.type === 'test:pass') entry.pass += 1;
    else entry.fail += 1;
    perFile.set(file, entry);
  }
  for (const [file, entry] of [...perFile].sort((left, right) => (left[0] < right[0] ? -1 : 1))) yield `${JSON.stringify({ file, ...entry })}\n`;
}
