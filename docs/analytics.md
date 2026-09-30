# Database calculations and analytical helpers

## Arithmetic contract

`DatabaseCalculator.verify(receipt)` checks a selected, authorized calculation receipt against registered SQL. It accepts the published operation, definition kinds and signs, exact minor-unit amounts, event dates and receipt lineage. It receives no SQL text from the caller. Source selection and current permissions remain the engine's responsibility; SQL arithmetic verification is not a second source of authorization.

Production uses an ephemeral DuckDB `:memory:` projection in a separate Node process. Definitions and rows enter fixed prepared statements as parameters. The database has external access, automatic extension installation/loading, persistent secrets, query logging and temporary spill files disabled. Its memory budget is 128 MB, with one execution thread. The parent kills the worker when its deadline or output budget is exceeded. The projection is discarded after every operation; PostgreSQL remains the durable encrypted authority store.

Registered queries cover billed, received, earned, refunds, costs, purchases, revenue, net sales, contribution margin, receivable aging, revenue change and a price scenario. Amounts use `DECIMAL(38,0)` and sums are returned as integer strings. Basis points and scenario amounts use `HUGEINT` integer division, preserving the calculator's declared truncation toward zero. Ratios/scenarios reserve precision by limiting the projected absolute total to `10^32` minor units. Other sums have the `DECIMAL(38,0)` bound. Unsupported definitions, incomplete invoice links, cancelled events, invalid dates, excessive rows and arithmetic disagreement fail closed.

The current SQL profile binds measures to `amountMinor`. Additional money fields require a separately extended typed projection. Aging requires distinct positive invoice/payment/refund definitions and invoice/customer/due-date links; ambiguous duplicate invoice links are refused. A zero denominator omits the ratio instead of manufacturing a percentage.

```ts
const database = new DatabaseCalculator({ operationTimeoutMs: 15000, maxRows: 50000 });
const verification = await database.verify(receipt);
```

The production calculator verifies before persisting or exposing its receipt. The explicitly experimental demo can use the independently tested integer calculator. Installing PostgreSQL does not silently disable the mandatory DuckDB verification.

## Python process contract

`AnalyticalHelper.run(operation, input)` executes the bundled, trusted `platform/helpers/analytics.py` using an explicitly configured absolute Python executable. It does not discover credentials or launch an executable from `PATH`. The helper receives bounded JSON on stdin, with no user code, paths, shell commands, model keys or database credentials. It runs with Python isolation flags, bytecode writing disabled, a fresh empty working directory and a small environment allowlist. The parent enforces a deadline and output cap. Unix resource limits additionally cap CPU, address space and file growth; Windows does not provide those Unix limits, so its process receipt records `resourceLimits: false`.

This is a trusted subprocess boundary, not certification of an operating-system sandbox against arbitrary native code. A packaged deployment must qualify its Python and PDF dependencies. The request API never accepts a helper executable or user program from the renderer.

| Operation | Input | Result and limits |
|---|---|---|
| `pdf.extract` | `pdfBase64`, optional `maxPages` | PDF text through optional pdfplumber; at most 4 MiB, 50 pages and 100,000 characters. Extracted text is explicitly tainted and numerically unverified. No OCR claim. |
| `forecast` | `currency`, consecutive `months: [{month, amountMinor}]` | Exact rational linear trend with the final three months withheld from their corresponding training folds. A forecast is returned only if summed absolute error beats the last-month baseline; ties are refused. Requires 8–120 months. |
| `allocation.optimize` | `currency`, `budgetMinor`, `items: [{id, costMinor, valueMinor, maxUnits?}]` | Exact bounded integer knapsack with dominance pruning; at most 50 items, 200 expanded units and 10,000 frontier states. Excessive problems are refused instead of silently approximated. |

```ts
const helper = new AnalyticalHelper({ executable: configuredTrustedPython });
const { result, receipt } = await helper.run('forecast', { currency: 'INR', months });
```

The process receipt includes input/output and implementation hashes, operation, timestamps, Python version and enforced-resource-limit status. It excludes raw input and credentials. `helpers.run` is an admin-only engine operation configured through `EngineOptions.pythonExecutable`; its result is an analytical artifact, not a verified financial receipt. Forecast and allocation results remain experimental. Optimization consumes supplied assumptions and neither spends money nor grants an action approval. Extracted PDF text must pass the normal reviewed mapping and reconciliation path before it can support verified amounts.

## Verification record

The analytical/helper suite executed **16 tests: 16 passed, 0 failed, 0 skipped** with an explicitly configured Python executable. Actual Python 3.12.14 and installed pdfplumber ran trend/baseline tests, an exact knapsack counterexample, bounded-unit/free-item allocation and PDF extraction with hostile instruction text. The Python source compiled successfully. Normal test execution includes transport/refusal tests; the five actual Python cases are registered when `CHAUSAR_PYTHON` is explicitly set for the test process.

Seven SQL conformance tests use an injected executor with independently hand-worked results. They establish parameter boundaries, projection validation and result comparison, **not execution of DuckDB SQL**. The production worker's dependency check executed and returned `DUCKDB_UNAVAILABLE` in this environment. No native DuckDB arithmetic run or PostgreSQL/DuckDB composition is claimed. Once the pinned DuckDB package is installed, the same default-worker test executes the real native calculation and must pass before qualifying deployment.

```powershell
$env:CHAUSAR_PYTHON = '<absolute trusted Python executable>'
node --test platform/tests/analytics.test.ts platform/tests/helper.test.ts
```

The API was checked against primary references: [DuckDB Node Neo client](https://duckdb.org/docs/current/clients/node_neo/overview), [DuckDB configuration](https://duckdb.org/docs/current/configuration/overview), [numeric operators](https://duckdb.org/docs/current/sql/functions/numeric), [numeric types](https://duckdb.org/docs/current/sql/data_types/numeric), and the [pdfplumber project](https://github.com/jsvine/pdfplumber).
