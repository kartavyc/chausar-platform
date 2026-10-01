# Grounded conversation planner

An explicitly selected model route now receives the original reviewed natural request before any local phrase classifier chooses the capability. The model returns a typed plan for registered read-only capabilities. The Engine validates that plan and runs the existing deterministic services; it does not accept model-written financial values or execute provider tools.

The `conversation` mode uses the existing model route interface, including the pinned official Codex CLI when configured by the host. The requested model identifier is passed through that interface. Interface evidence does not establish account access, actual served model identity, subscription eligibility for hosted/commercial services, or inference quality. Synthetic provider responses used in tests are clearly labelled fixtures.

## Disclosure and approval

`models.preview` and `conversation.ask` use `purpose: "conversation"`, an exact `routeId`, and `questionDisclosure: "verbatim"`. Nothing still prevents a preview or dispatch. Choosing a route does not enable disclosure or change a workspace policy.

The original question is a separate, explicit disclosure from evidence Shape. It can contain names, dates or amounts typed by the user; the exact preview shows that full question and warns the user to review it. Shape continues to exclude business claim text, raw rows, business identities, source locators and financial values derived from the workspace. The planner receives only generic claim aliases/categories/origins, documented unknown categories, the registered tool catalogue and permitted evidence structure. Selecting Samples can additionally disclose the reviewed selector list, but this planner does not automatically send sample rows or profile text.

Every conversation-plan dispatch requires an owner-approved, single-use payload digest, including zero-fact workspaces and local Ollama. Preview and dispatch bind the question, output schema, route revision, exact endpoint, source evidence and current privacy fingerprint. A changed question or scope needs a fresh preview and approval. The old analytical/context APIs retain their existing contracts; the model route in the conversation renderer uses the unified planner.

## Registered capabilities and results

The plan selects up to four distinct calls:

- `business.describe`: selects existing claim aliases and preserves every documented unknown. Local rendering supplies cited current statements and their provenance.
- `calculator.calculate`: selects a currently published calculation, optional calendar period and permitted branch/customer selectors. The Engine executes exact arithmetic, retains the receipt and checks that its counted evidence stays within the reviewed source scope.

A plan can mix a description and calculations. Unsupported intent returns a bounded plain clarification without executable calls. Unknown tools, extra arguments, invented amounts, SQL, invalid dates and duplicate calls fail validation. A valid tool that cannot calculate returns a typed tool error; it does not invent a result or trigger an inference retry. For example, `change` without both comparison periods returns `COMPARISON_REQUIRED`.

The current wire contract intentionally exposes the existing analysis planner's period/branch/customer arguments. Other Calculator arguments, such as explicit comparison periods and scenario assumptions, remain unavailable through this planner until their reviewed typed contract is added. Their underlying deterministic services remain in scope; no broader operation or product completion is claimed.

Authority, readiness and disclosure are rechecked before each capability, after each result and before returning the retained combined answer. A revoked source, changed policy or changed route withholds the combined response. Successful child answers retain their existing calculation/business receipts. The combined history record binds the exact ordered results and current child references; readback validates retained evidence and does not recalculate or invoke a provider.

## Live test boundary

No live inference is needed for source/fixture acceptance. A native provider test needs separate user approval, the actual installed source provenance and exact in-app preview. One app invocation has the existing 120-second timeout and no app retry or provider fallback. CLI-managed authentication stays with the official CLI; Chausar does not read or copy login tokens.

The configured INR ledger reservation and output-token setting are application controls, not verified provider charge or token caps. Restoring Nothing invalidates Shape-bound context/composite readback; the disclosure receipt remains recorded subject to current access and retention. Cleanup is manual, and restoring Nothing is the first recovery step after an interrupted test.

Headless renderer/preload/production-worker tests use an injected synthetic provider inside a fresh encrypted temporary vault. They exercise the real application path without launching Electron, reading a user vault or calling a model. Passing fixtures does not qualify Luna, a connector, a database runtime or the full native product.
