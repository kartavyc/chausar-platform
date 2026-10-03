# Foundation evidence, 1 October 2026

Validation in the isolated `task-18` directory used Node **24.13.1** native TypeScript stripping and the existing read-only TypeScript **5.9.3** compiler. No package installation, registry change, GUI launch or shared-renderer edit was performed.

```powershell
node --test .\app\ui\tests\contracts.test.ts .\app\ui\tests\format.test.ts .\app\ui\tests\projections.test.ts .\app\ui\tests\client.test.ts .\app\ui\tests\project-ui.test.ts .\app\ui\tests\today-host.test.ts
& 'C:\Users\karta\Documents\Codex\2026-10-01\task\integration\node_modules\.bin\tsc.cmd' --project .\app\ui\tests\tsconfig.foundation.json
```

Result: **72 tests passed, 0 failed; strict TypeScript passed.** ExactOptionalPropertyTypes, NoUncheckedIndexedAccess and ErasableSyntaxOnly are enabled as well as strict mode. Compile-time negative cases cover floating money, wrong units, unreceipted figures, measured values on guesses, phone/CA leakage, arbitrary mutation methods, unsupported dashboard filters and enterprise receipt aliasing. Structural assignments to the actual component figure/count/row/chart/chart-state/stat/day/state DTOs and `TodayData`, including the host-specific unknown activity field, also pass, without casts or React type stubs.

An additional read-only proof ran the existing engine's `database-fixtures.ts` source through its actual calculator and this checked JSON projection:

```powershell
node .\app\ui\tests\verify-current-engine.ts 'C:\Users\karta\Documents\Codex\2026-10-01\task\integration'
```

Result: **30 existing synthetic engine receipts, 89 exact figures, 3 empty/all-unknown figures correctly projected unknown; passed.** This executes the fixture memory store, not native database/services or real business data, and does not establish database/live-connector qualification.

The same source-fixture proof also passes against the corrected frozen backend `ce5dc4f6c432ce637b23cbd26f159346acdcd68e` at `task/luna-synthesis-engine`. A separate Today proof ran its actual calculator and `ReportService` through injected desktop/browser ports:

```powershell
node .\app\ui\tests\verify-today-engine.ts 'C:\Users\karta\Documents\Codex\2026-10-01\task\luna-synthesis-engine'
```

Result: **4 dashboard receipt rereads, 5 brief receipt rereads and 6 selected exact figures; passed.** Literal independent answer keys earned `250000`, contribution `130000`, margin `5416` basis points and net sales `240000` were retained. The brief preserved explicit reviewed `answer-key` scope and draft Friday delivery. The dashboard envelope constructor mirrors the frozen source using the actual calculator; `Engine.request` itself was **not** executed. This is an in-memory synthetic DTO/adapter proof, not native database or live-runtime qualification.

The money test exercises **70 positive/negative Indian grouping cases**, including exact reverse cases from the existing engine's currency/business-engine tests and values above JavaScript's safe integer limit. A named shared sixty-case India display fixture was not found in the mapped engine tests; the full requested engine-owned set still needs its owners to supply it. The explicit cases here are not claimed to be that unavailable fixture.

Other checks cover all missing states in both languages; corrupt, prototype/accessor and cyclic replies; metadata count null versus zero; Today bounds and duplicate rows; local known-place routes with opaque underscore sheet IDs and rejection of foreign/extra context; guess rows refusing known business figures including zero; chart missing gaps and mixed units; exact current receipt fields without business sums; loaded zero versus empty/all-unknown results; unit-aware percent projection; read-only/prepare-only/money/unknown approval guards; phone expiry and leakage; CA status leakage; distinct desktop/browser/enterprise ports; fresh evidence rereads, wrong receipt IDs, sanitized failures, authority denial without accessor execution and invalidation of late/concurrent completions.

The component-projection suite additionally checks exact preformatted values and all labels, nullable metadata counts, unchanged source text and action offers, opaque row/day intents, explicit unavailable chart states per tile, preserved chart gaps/endpoints, neutral state/date projection, locked payloads refusing retained evidence/action context, no fabricated scope/queue/cash/day evidence, receipted changes and refused layout overflow. The strict structural check confirms compatibility with the corrected actual component DTOs; these checks do not claim that the React frontend compiles or its host is wired.

The **20 Today host tests** check actual dashboard/brief envelope shapes; huge exact money and dimensionless ratios; omitted ratios and foreign-currency unavailability; true zero versus empty/unknown; absence versus explicit empty requested-source selection; backend source IDs/branch labels without route-slug coercion; immutable snapshot/summary and current-authority receipt bindings; sanitized report gaps without HTML/error leakage; detached caller input; distinct ports and every successful receipt reread; late unselected receipt denial, lock/context/authority invalidation; unknown activity instead of false zero events; and rechecked host-to-component evidence bindings.

This is headless contract/format verification. It does not establish React compilation, pixel fidelity, keyboard/browser accessibility, live enterprise/CA/phone services, local fonts, or successful integration of the new frontend. Those checks belong to the corresponding implementation and host lanes.
