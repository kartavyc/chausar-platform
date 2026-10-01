# Bounded open-test CI sharding

The Windows run for commit `706a489527fdf207946458295ff151d2415e0b34`
reached the benchmark's ten-minute deadline. Its receipt reports `SIGTERM`,
`timeout: true`, no terminal test summary, and no truncated output. The captured
TAP contains 2,017 observed `ok` lines and zero observed `not ok` lines. This is an
incomplete run, not a passing Windows qualification. Ubuntu completed 2,091 open
tests successfully in the same workflow run (`36924503216`).

The open-verification workflow now runs two Node test-file shards on each OS:

```text
node scripts/bench.mjs --shard=1/2 --output results/factory-bench.json
node scripts/bench.mjs --shard=2/2 --output results/factory-bench.json
```

Node `24.13.1` receives `--test-shard=1/2` or `--test-shard=2/2`, the same complete
`platform/tests/*.test.ts` discovery pattern and `--test-concurrency=1`. No test
name filter, skip rule, or reduced test body is introduced. Each runner retains
the ten-minute benchmark deadline and the existing 16 MiB output capture bound.
The workflow still refuses to ignore test failures and disables matrix fail-fast
so all four OS/shard jobs can report their results. Every job has a unique report
artifact name. Both shards must complete and pass on each OS before that OS has
a complete open-suite result.

The CLI accepts the separated and equals forms of `--output` and `--shard` in
either order. Only shards `1/2` and `2/2` are accepted. Missing values, duplicate
options, malformed indices, unsupported totals and unknown options refuse before
starting the test process. Output remains restricted to a JSON path inside the
repository.

Each shard receipt includes its `{ index, total }` and `fullSuite: false`.
`testFiles` records the discovery pattern, complete sorted `discovered` path
inventory and `inventorySha256` over its JSON encoding. Shards must report the
same inventory and hash. `selection: 'node-test-shard'` delegates file assignment
to Node; the inventory does not claim to list each shard's selected files. The
unsharded default command, default output and `chausar.factory-bench.v1` schema
remain supported; its receipt explicitly records `shard: null, fullSuite: true`.
These fields describe scope. A failed or incomplete unsharded run is still a
failure, and a passing shard does not certify the whole suite. Production,
connector, hidden/sealed acceptance and release-signing qualification remain
uncertified.

A receipt passes only with a terminal nonempty test summary, zero failures,
cancellations, skipped tests and todo tests, a zero runner exit status and neither
timeout nor truncated output. Node can return zero for a skipped or todo test;
the benchmark deliberately refuses to certify that incomplete shard.

`platform/tests/benchmark-sharding.test.ts` executes the actual CLI in tiny
synthetic repositories. It verifies unsharded compatibility, deterministic and
disjoint shard assignment with complete file coverage, option refusals before
spawn, output containment, failed-shard exit behavior and the four-job workflow
contract. These focused checks do not establish that either real repository
shard fits its deadline. The integration coordinator must run both real shards
and record their terminal receipts, followed by all four actual CI jobs.
