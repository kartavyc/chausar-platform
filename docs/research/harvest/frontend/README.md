# Frontend research for the rework, 21 October 2026

Input for redesigning Chausar's frontend. Not a decision. Detail files:

- [chausar-current.md](chausar-current.md): what exists today and what a rework must keep
- [workspaces.md](workspaces.md): Cloudflare OS, qm, OpenMuse, Nautilo, Odysseus
- [approvals-ops.md](approvals-ops.md): opendesk, trycompai/crm, helix-foundry, omnigent, llm-space
- [creator-marketing.md](creator-marketing.md): BridgeClip, CogSend, Open Edit, YouTube Pro, Diffusion Studio, Postmill

## Where Chausar stands

Vanilla JS with no build step: `launch.js` (3,792 lines) and `app.js` (1,318), one stylesheet carrying three visual systems and 232 hex colours. The engine wiring is honest; the decoration overclaims (mock website in onboarding, unverified slogans). The 1 October spec never reached main, but an unmerged React rewrite of it sits on the `claude/lane-*` branches (`app/ui`, 695 files) and is worth mining.

Must keep: preload API and IPC allowlist (~330 methods), `/api/rpc` pairing, the venture, onboarding and custody contracts, and the tested rules (receipts on every figure, accept by digest, honest labels, no money arithmetic in the UI, motion once at 400 ms or less, word budgets).

## Best reference per job

| Job | Best reference | Licence |
|---|---|---|
| Overall look and tone | Cloudflare OS: neutral surfaces, accent for intent only, hairlines not boxes, follows the OS theme | Apache |
| Design rules written down | BridgeClip DESIGN.md: "only failure earns a hue", "say what happened", "nothing loops to decorate" | MIT |
| Approval mechanics | opendesk: propose only, token never reaches the model, decide once, consequence stated, undo by default | Apache |
| Review queue | Cloudflare OS Activity: rows oldest first, text-only Approve and Deny, "Nothing to review" | Apache |
| Inline suggestion | trycompai/crm: one muted row where the value will land, a reason, two actions; dotted underline shows provenance | MIT |
| Stale approval | helix-foundry: approve a digest; if it changed, say so in one sentence | Apache |
| One approval, many places | omnigent: same component inline, in an inbox, on a notification page; resolved card shrinks to a receipt line | Apache |
| Last look before sending | OpenMuse "One last look": exact payload, Edit reopens the draft | MIT |
| Finished agent work | qm: run folds to "Worked for 23s", steps named by purpose, timer pauses while waiting on you | MIT |
| Long jobs | BridgeClip: active above previous, per-stage progress, "indeterminate" when unmeasured, real failure text, Run again | MIT |
| Status wording | CogSend: one plain sentence per state, failures rewritten as instructions | MIT |
| Money before spend | Open Edit: quote binds draft, figure and payer for one hour | Apache |
| Evidence labels | YouTube Pro: observed, inferred, needs your data (as words, not colour blocks) | Apache |

## A first shape for the new frontend

- **Today is the approval queue.** Rows oldest first. Each card: what, why, old value struck through in grey, new value in ink, money only as a receipt reference, two actions. Decided cards shrink to one receipt line.
- **Agents never look stuck.** Work continues against simulated results while it waits; the timer pauses on approval.
- **Each delivery step carries its own gate** (auto or hold) beside it, per playbook.
- **Jobs** use the BridgeClip layout and CogSend wording.
- **Theme follows the computer**, set before first paint. Accent marks state only.

## Shared faults to avoid

A personality for the AI (mascots, violet tints, "Noodling..."); four-way allow buttons on every approval; dense multi-panel shells; dark by default; giant single files.
