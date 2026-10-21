# Onboarding recordings

Hand-written answers for the onboarding v2 tests: connect an AI first, one open box, then a plan the AI builds from Chausar's checked blocks. Each JSON file is a synthetic recording (`"label": "synthetic recording"`). None was captured from a live account, and no paid call was made. Each file also names the sentence it answers (`text`) and the country (`countryCode`), so a test types exactly that.

`venture-onboarding-e2e.test.ts` loads them through `createReplayTransport`. A recording matches a request by purpose, route kind and model, and only when every `mustInclude` string is in the request. Every decide and compose entry names its marker (`chausar-decide-v1`, `chausar-redecide-v1`, `chausar-compose-v1` or `chausar-recompose-v1`) and a phrase from the owner's sentence. A repair answer names the repair marker, so it can only answer the repair call.

| File | What it holds |
|---|---|
| `dog-walking-gb.json` | An idea in the United Kingdom: decide on Claude Haiku 5.5 (views `offers-first`, `pages`, `notes`), compose on Claude Sonnet 5.5 (two offers, four steps with one `draft-reply`, four pages without a client area, Cal.com and WhatsApp, insurance and safety notes), and the build brief words for the kept plan. |
| `dog-walking-claude-cli.json` | The same decide and compose answers on the Claude Code route (`claude -p` JSON output), Sonnet 5.5 for both tiers. |
| `excel-skill-in.json` | A skill in India: views `steps-first`, `questions`, `tools`, with two questions. |
| `cafe-bills-problem-in.json` | A problem other people have, in India: views `audience-first`, `tools`, `pages`. |
| `landlord-not-a-service.json` | A personal problem with nothing to sell: decide only, no views. |
| `digit-then-repair.json` | A compose answer naming an offer "Walks for 2 dogs", then a valid repair answer. Since 21 October the first answer is kept as a model estimate and the repair answer goes unused. |
| `spelled-price-then-repair.json` | A compose answer describing an offer as "Twenty pounds a walk", then a valid repair answer. |
| `markup-in-words.json` | A compose answer with `<b>` in an offer description, then a valid repair answer. |
| `unknown-block-twice.json` | Two compose answers with an offer block Chausar does not have, so the plan is refused. |
| `decide-repair.json` | A decide answer with two lead views, then a valid repair answer, then a valid compose answer. |

Every model string in a valid answer keeps within its word cap and holds no number, in digits or in words. The tests check that through the engine itself, not by trusting this file.

`kind-rules.ts` is the test-only open-box classifier, owned by the engine package. The recordings test checks that each sentence's recorded kind matches it. The product never classifies by keywords.

The offline demo has its own copy of the composer answers (the demo idea, the three open-box examples, the landlord sentence, and one sentence, "Bike repairs at home for families in Bristol.", whose two plan answers both use a block Chausar does not have, so the refused screen can be seen) in `../demo/model-replay.json`. The end-to-end test also walks that demo replay's composed bookkeeping plan through a judged rehearsal, and follows GitHub from the existing recording in `../e2e/github-sync.json`.
