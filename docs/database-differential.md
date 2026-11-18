# The database differential check

`node scripts/verify-database-differential.mjs` is a hard check a person runs by hand. It compares hand-worked answers with three things: the JavaScript calculator, the DuckDB worker ([analytics.md](analytics.md)) and the PostgreSQL form of the same queries (`platform/runtime/postgres-analytics.ts`). It also runs `CalculatorService` with both SQL checks on an encrypted `Vault` kept in a real PostgreSQL database.

A missing package or a database that is not set up makes it exit with an error. It never turns that into a pass, a skip or an injected executor. It is not part of the test suite or CI.

An earlier full run on Windows, with PostgreSQL 18.6 and DuckDB 1.5.5, passed 110 checks. That record is kept in the private repository. The engine has changed a lot since, so treat the script as untried against today's code until someone runs it again.

## The answer key

The cases are in `platform/tests/database-fixtures.ts`. Expected figures are written as decimal integer strings. Neither the dictionary compiler nor either SQL form makes them. Each case checks the whole set of figures, so a ratio that should be absent must really be absent. Two engines agreeing with each other is not enough to pass.

| Trap | Hand-worked answer |
| --- | --- |
| Exact total beyond JavaScript safe integers | `900719925474099391 + 9 = 900719925474099400` minor units. |
| Full decimal precision | A sum of exactly `99999999999999999999999999999999999999` reaches the `DECIMAL(38,0)` maximum. |
| Large near-integer margin | Earned `10000000000000000000000000000000`, cost `1`: contribution `9999999999999999999999999999999`, and the ratio is cut to `9999` basis points, never rounded up to `10000`. |
| Negative contribution ratio | Earned `3`, costs `4`: contribution `-1`; `-10000/3` is cut toward zero to `-3333` basis points. |
| Zero margin denominator | Earned `3`, refunds `3`, costs `1`: contribution `-1`; no margin ratio. |
| Negative measured change | Current `2`, prior `3`: change `-1`, ratio `-3333` basis points. |
| Unknown comparison baseline | Current `2` against conflicting prior claims `3` and `4`: partial coverage, one conflict, no change ratio. |
| Overlapping comparison periods | August-only `3`, overlapping `2`, September-only `5`: current `7`, prior `5`, change `2`, ratio `4000` basis points; three distinct facts in the rows. |
| Negative scenario rounding | Baseline `-3`, price change `1000` basis points: `-3.3` is cut to `-3`; change `0`. |
| Large scenario rounding | `900719925474099391 * 1.1` is cut to `990791918021509330`; change `90071992547409939`. |
| Receipt fan-out | Invoice A `100000` less two payments `25000 + 30000` and refund `5000` gives `40000`, counting the invoice once. |
| Surplus and unmatched receipts | Invoice B `50000`, receipt `70000` gives `20000` surplus; unmatched credits `15000 + 3000 + 2000` add `20000`; total unallocated `40000`. |
| Missing linked invoice or customer | Invoice I/C `100` stays outstanding; I/OTHER receipt `25`, MISSING/C receipt `30` and unlinked `10` stay unallocated: `65`. |
| Inclusive aging boundaries | Seven invoices of `100` at ages `0,30,31,60,61,90,91` give buckets `100,100,200,200,100`, total `700`. |
| Ambiguous invoice identity | Two distinct invoice claims sharing one invoice and customer pair are refused before payments can fan out. |
| Missing, zero and empty states | A zero event counts; no event has empty coverage; an excluded unknown amount leaves partial coverage and a gap. |
| Independent source claims | Identical claims count once; conflicting amounts have no chosen winner and partial coverage. |
| Currency | An unconverted USD event under INR definitions is refused. USD `10.25` at the exact rate `83/1` becomes INR `85075` minor units, with its original currency and rate kept. |

## How to run it

Use Node 24.13.1 or newer. The JavaScript cases and the guard need nothing else:

```sh
node --test platform/tests/database-differential.test.ts
```

The hard check needs the installed `pg` and `@duckdb/node-api` packages (`npm ci`) and a disposable local PostgreSQL database that already exists. The script installs nothing, starts no database, creates no database and looks for no credentials.

```powershell
$env:CHAUSAR_TEST_DATABASE_DISPOSABLE = '1'
$env:CHAUSAR_TEST_DATABASE_URL = 'postgresql://<fixture-user>:<URL-encoded-fixture-password>@127.0.0.1:<explicit-port>/chausar_test'
node scripts/verify-database-differential.mjs
```

It accepts only:

- the host `127.0.0.1` or `::1`, written out;
- an explicit port from 1024 to 65535;
- the database name `chausar_test`;
- the acknowledgement `1`;
- an address with no `?` and no `#`.

Before it writes anything, it checks the server's own database name, a search path pinned to `public`, and that `public` holds no relation at all. Credentials never appear in its report.

The fixture pool limits a statement to 15 seconds, a lock wait to 5 seconds, an idle transaction to 15 seconds and a client query wait to 17 seconds. These are settings of the fixture connection only.

A run deletes only the rows it made. Its table stays, so the same database refuses a second run. Make a fresh database for each run.

## What a full run shows, and what it does not

When both engines run, the script checks that:

1. imported decimal amounts reconcile exactly, and a repeated batch adds no claims;
2. `CalculatorService` waits for both SQL checks before it keeps a receipt;
3. a currency conversion keeps its original currency and exact rate in the receipt;
4. a correction learned later changes the current answer while an earlier known-on view keeps the earlier answer;
5. PostgreSQL holds an encrypted envelope with no plain marker text in it;
6. two writers racing on one slot or one revision admit exactly one winner (`REVISION_CONFLICT` for the other);
7. reopening keeps facts, claims and history, and a backup restores into a fresh slot.

It does not show power-loss safety, crash recovery of the PostgreSQL server itself, or anything about a packaged app. The desktop app does not use PostgreSQL at all: it keeps each business in the file vault ([vault.md](vault.md)).
