# The SQL check on calculations, and the Python helper

Two helper processes stand behind the engine. One checks a calculation again in SQL before its receipt is kept (`platform/runtime/analytics.ts`, `analytics-worker.ts`). The other runs a small, fixed Python file, today to read text out of a PDF (`platform/runtime/helper.ts`, `platform/helpers/analytics.py`).

## The SQL check

`DatabaseCalculator.verify(receipt)` checks one calculation receipt against registered SQL. It takes the published operation, the definition kinds and signs, exact minor-unit amounts, event dates and the receipt's rows. It never takes SQL text from a caller. Choosing the rows and checking who may see them stays the engine's job; the SQL check is about arithmetic only.

Outside demo mode the engine gives the calculator this check, and a result the SQL disagrees with is refused (`SQL_RESULT_MISMATCH`). In demo mode the exact integer calculator works alone.

The check runs in a separate Node process, on a DuckDB `:memory:` database that is thrown away after each operation:

- definitions and rows go into fixed prepared statements as parameters;
- outside access, extension install and load, and temporary spill files are off;
- 128 MB of memory and one thread;
- the parent ends the worker when its time limit (15 seconds by default) or its output limit is passed.

Registered queries cover billed, received, earned, refunds, costs, purchases, revenue, net sales, contribution margin, receivable aging, revenue change and a price scenario. Amounts use `DECIMAL(38,0)` and sums come back as integer strings. Basis points and scenario amounts use `HUGEINT` integer division, which keeps the calculator's rounding toward zero. Margin, change and scenario limit the absolute total to `10^32` minor units, to keep room for the basis points. A zero denominator leaves the ratio out. Unsupported definitions, incomplete invoice links, bad dates, too many rows (50,000 by default) and any disagreement all fail closed.

The SQL binds measures to `amountMinor`. Aging needs distinct invoice, payment and refund definitions and invoice, customer and due-date links; two invoices sharing one link are refused.

```ts
const database = new DatabaseCalculator({ operationTimeoutMs: 15000, maxRows: 50000 });
const verification = await database.verify(receipt);
```

If the pinned DuckDB package is missing, the check answers `DUCKDB_UNAVAILABLE` and no number is released. A second form of the same queries runs on PostgreSQL (`platform/runtime/postgres-analytics.ts`); only the qualification script uses it ([database-differential.md](database-differential.md)).

## The Python helper

`AnalyticalHelper.run(operation, input)` runs the bundled `platform/helpers/analytics.py` with a Python the host names by absolute path (`EngineOptions.pythonExecutable`, from `CHAUSAR_PYTHON`). It never looks for Python on `PATH`. No request can name a program or a path.

- The helper gets bounded JSON on stdin (6 MiB at most) and answers at most 1 MiB. No user code, file path, shell command, key or database address goes in.
- Python runs with `-I -B`, in a fresh empty folder, with a tiny environment.
- The parent enforces a time limit (15 seconds by default).
- On Unix the helper also limits its own CPU time, memory and file writes. Windows has no such limits, and the helper's receipt says `resourceLimits: false` there.

This is a trusted helper process, not an operating system sandbox.

| Operation | Input | Result and limits |
|---|---|---|
| `pdf.extract` | `pdfBase64`, optional `maxPages` | Text from a PDF through `pdfplumber`: at most 4 MiB, 50 pages and 100,000 characters. The text is marked tainted and its numbers unverified. No OCR. |
| `forecast` | `currency`, consecutive `months: [{month, amountMinor}]` | An exact linear trend over 8 to 120 months. A forecast is returned only if it beats the last-month baseline on held-back months. |
| `allocation.optimize` | `currency`, `budgetMinor`, `items: [{id, costMinor, valueMinor, maxUnits?}]` | An exact bounded knapsack: at most 50 items, 200 units and 10,000 states. A larger problem is refused, never approximated. |

The engine calls only `pdf.extract` today: for a resume in About you, and for PDF files an owner adds to an order. `forecast` and `allocation.optimize` are in the helper and its tests, but no engine method reaches them.

The helper's receipt holds hashes of the input, the output and the helper file, the operation, the times, the Python version and whether resource limits were on. It holds no input text. A helper result is never a verified money figure.

No Python ships in this repository or in the beta build. Without one, a resume PDF is read by Chausar's own text reader (`venture/core/pdf-text.ts`), and reading a PDF added to an order says that it needs Python set up for Chausar.

## Tests

```sh
node --test platform/tests/analytics.test.ts platform/tests/helper.test.ts
```

The SQL cases use an injected executor with hand-worked answers, so they check the projection and the comparison, not DuckDB itself. The real Python cases run only when `CHAUSAR_PYTHON` names a Python for the test process.
