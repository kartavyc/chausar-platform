# 5C1: CA citations, offers, questions and stored sign-off
- Seven new regulated offers are executable through live delivery, CA sign-off and Accept; existing salaried full help remains.
- New CA modules: citations, itr-forms, advance-tax, question-desk, stored-signoff, practice, intake-fields and draft-references.
- Shared hooks: CA tool adapters, final draft gates, receipt re-derivation, plan/intake, practice routing and writer named references.
- UI: YourCa/CaRules, dated-rule confirmation, stored signature recheck, multi-select intake and second-round questions; fake paths mirror engine refusals.
- Exact citation table version/hash confirmation is app-only and requires the CA of record; rehearsal may use unconfirmed rules.
- Current official AY 2026-27 ITR guidance permits two house properties. AY 2027-28 eligibility is visibly unverified and CA-held.
- Section references include plural lists and unknown numbers; unresolved ranges fail closed. Post-April-2026 old sections require a dated mapping note.
- Question claims accept uploaded law source IDs or passed citation-table source IDs; no general numeric-writing exemption was added.
- External-return comparison uses fresh income receipts, includes both receipted sides and each differing line's rule, and refuses subset filtering.
- Advance-tax arithmetic is BigInt, with dated existing rate-table confirmation and the client's estimate explicitly labelled as an assumption.
- Stored signatures bind receipt IDs/digests and playbook hash; reads re-derive receipts and report the first change.
- Live missing-facts tools end their turn with questions in the client's language. Pushy practice refuses filing while offering in-scope preparation.
- Last engine command: node --test platform/tests/venture-ca-*.test.ts platform/tests/venture-playbook-ca-*.test.ts
- Result: tests 135, pass 135, fail 0; log results/w5c1/all-ca-final.txt.
- New focused files cover citations (5), ITR forms (6), advance tax (2), questions (1), practice (2), stored sign-off (1), tools (1), checks (5), return comparison (1) and plan parity (1).
- Existing CA tools tests additionally execute all seven offers, typed external-return differences, and Hindi missing-fact handoff.
- Last UI command: node node_modules/vitest/vitest.mjs run --config app/ui/vitest.config.ts app/ui/tests/places/business-ca.test.tsx --maxWorkers=1 --pool=vmThreads
- Result: Test Files 1 passed, Tests 5 passed. UI-only TEMP/TMP was results/w5c1/ui-temp; engine temp remained default C:.
- Independent review: bookkeeping_finish Stage 1 PASS / Stage 2 code-quality PASS; independently 85 CA tests and YourCa 5 tests.
- Root owns shared typechecks, complete UI checks and engine shards; no global gate claim here. Root centrally updated Hindi copy.
- Visual attempt on Vite 5187 / CDP 9497 failed: Chrome did not start its debugging port. No PNGs; log results/w5c1/browser-walk.log.
- Government portals remain human handoffs. C2 data readers, filing, what-if and health-check work are outside this package.

## Isolated commit integration check

- A fresh regression found that the CA tool ceiling omitted its three C1 tools. `venture-ca-tool-ceiling.test.ts` failed on `tax.citations` before the narrow ceiling correction, then passed. Logs: `results/w5-c1-tool-ceiling-red.log` and `results/w5-c1-tool-ceiling-green.log`. The test checks every active CA step tool and keeps tax tools out of ordinary bookkeeping. The primary CA ceiling also retains the implemented C2 tools; the C1-only candidate grants only its own three additions.
- The isolated candidate excludes C2 health, what-if, entry and data-pack behavior. Its shared hooks include the question desk headings in the actual draft schema, exact fake plan fixture, stored sign-off shapes and dated citation checks.

### Actual plan intake projection correction

The isolated candidate omitted the shared builder fields that retain offer intake, even though its CA source map supplied them. A strengthened oracle now asserts every actual plan offer intake equals caIntakeFields, rather than checking only the fixture derived from that helper. It failed on the C1 snapshot with undefined intake (`results/5c1-staging/c1-intake-builder-red.txt`). The two builder hunks restore the intended owner form; the corrected snapshot is checked in `results/5c1-followup/green.txt`. This correction belongs to C1 and is included before social isolation.
