# Joined calendar and phone source checkpoint

Checked implementation: `68590c8f6c33cf673cb6cf76c87f055e4de54df4`, tree `d046d42b1a3e53d5ece13f4f9c0aebfc77efd536`.

The joined local run passed 805 tests with zero failures or skips,
strict application/semantic TypeScript, strict portable companion TypeScript,
syntax/JSON checks for 160 source files and the Windows headless worker.
See [complete test output](verification/calendar-phone-tests.tap) and
[check receipt](verification/calendar-phone.json). Documentation/evidence is added
after these checks; the coordinator must verify source equivalence before publication.

Calendar ports and preview/configure/pause/resume are wired through actual Engine
RPC. Five loopback HTTP regressions include a synthetic import, exact 12345 INR
minor-unit receipt, occurrence provenance, owner acceptance, renewed approval,
future pause/resume and a distinct second occurrence. The 66 calendar regressions
cover independent civil-time, admission, expiry, coalescing, crash/readback and
permitted large-journal behavior. No host/business policy defaults or OS/cloud
scheduler are selected. Legacy briefs reject calendar schedules.

The phone join supplies actual iOS/Android React Native launcher source, shared
portable screens/controller and a synthetic responsive web preview. Its 127
portable tests and strict TypeScript checks passed. Native dependencies, Metro,
Android/iOS builds, visual/device acceptance, protected native adapters, live
pairing and the shared phone action-policy join remain unqualified. See
[phone handoff](phone-apps-handoff.md). Run `npm run phone:preview` only for the
explicit synthetic loopback preview; this does not start a live companion service.

The existing official laptop Codex CLI 0.154.0 advertises the required interface
and reports ChatGPT sign-in. The one approved gpt-6-luna access probe failed HTTP400
with no completed turn or usage. This is evidence about that specific standard
laptop route; the user's unknown Hermes workaround was not inspected. No further
inference, alternate model or paid fallback was used by this coordinator. The
parent separately approved one newer installed 0.159.2 CLI attempt in the diagnosis
lane; its result is not covered by this historical receipt. See
[sanitized access evidence](verification/local-cli-access-attempt.json).

The prior published 3f93ac8 checkpoint passed both Windows and Ubuntu push CI.
That does not certify this later source tree; its CI is checked after publication.
Actual native database producer evidence remains separately scoped. Enterprise
still has 22 diagnostics pending genuine dependencies. Installer/GUI, native
phone, live vendors, hosted acceptance and overall release are unverified;
the dedicated security review remains blocked and was not retried.
