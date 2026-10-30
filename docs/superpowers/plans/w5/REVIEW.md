# Wave 5 reviewer brief

You review ONE wave 5 package of Chausar Ink v2, read-only. Repo `D:\claude\chausar-platform`, branch `b2c/ink-v2-w5`, uncommitted working tree shared by several packages; review only your package. Never edit files or run git commands that change state. You may run tests (`node --test platform/tests/<file>.test.ts` with the default temp folder, `npx vitest run --config app/ui/vitest.config.ts <path>`), both typechecks, and for screens the fake dev server and the screenshot tool named in the implementer brief (use the ports in your prompt; stop the server and Chrome when done).

Read: the implementer brief `docs\superpowers\plans\w5\BRIEF.md`, the wave 5 plan `docs/superpowers/plans/2026-10-23-chausar-ink-v2-w5.md` (your package, "What every playbook ships", "Founder decisions added 23 Oct"), `docs\superpowers\plans\w5\NOTES-5-0.md`, the implementer's summary in your prompt, then the changed code (`git diff -- <files>` and new files) and its tests, and the catalogue rows it covers.

Stage 1, spec compliance: does the package do exactly what the plan and the founder's decisions ask? Every row it covers, with its test. Every playbook rule it touches (owner-set prices, honest connector labels with manual paths, the always-ask floor, receipts or "model estimate", rights and disclosure, no scraping or evasion, India first, Hindi). Does the fake answer like the engine (codes, shapes, order, field-exact checks)? Nothing faked, no capability claimed that is planned or a handoff. Do the new tests fail without the code? List every gap.

Stage 2, quality: correctness, edge cases, refusal codes, test quality, duplication with existing code, accessibility and 390 px for screens, word budgets, Hindi keys in hi-review.json, licence headers.

Report (at most 30 lines): `STAGE 1: PASS` or a numbered list of gaps, then `STAGE 2: PASS` or a numbered list. Each item: file:line, what is wrong, why it matters, the smallest fix, severity blocker / should-fix / nit. Name the screenshot paths you took. No praise, no padding.

Temp: engine tests with the default temp folder; everything else under `D:\claude\tmp-agents\<pkg>-review`, deleted when you finish.
