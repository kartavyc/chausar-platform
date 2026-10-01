# Calendar schedules through the Engine

The trusted host installs `EngineOptions.jobCalendar = { rules, bounds }` and may
provide `durableJobs.clock`. No business zone, civil-year range, cache capacity,
evaluation limit, DST policy or missed-run policy is selected by the Engine.
An RPC payload cannot install host ports. `jobs.types.calendar` reports whether
ports are configured and their declared revision, year range and bounds.

Use a supported typed goal with the complete `calendar` definition rather than
elapsed interval fields. The current legacy `owner-brief` runner refuses calendar
creation and calendar configuration because it does not carry typed occurrence
provenance or enforce the typed dispatch cutoff. Its elapsed scheduling and the
typed runner use the same installed host clock.

The existing authenticated `/api/rpc` boundary exposes:

- `jobs.calendar.preview`: `{ id }`, a bounded evaluation of the saved schedule
  under the current host clock and owner/source access.
- `jobs.calendar.configure`: `{ id, definition, expectedScheduleRevision,
  expectedObjectiveRevision, replacement: 'replace-immediately' }`. Both current
  revisions and the explicit replacement policy are required. The service checks
  idle state, prospective coverage and pinned owner authority in its transaction,
  and invalidates the previous mandate approval.
- `jobs.calendar.pause` and `jobs.calendar.resume`: `{ id }`, pinned in-app owner
  controls over future claims. Already admitted work and unknown readback retain
  the existing runner lifecycle and reservations.

Owner acceptance and renewed approval remain required where the mandate requests
them. Execution and deliverable retain occurrence and schedule provenance. The
normal source/receipt release checks still apply before an artifact is released.
This installs no Windows service, timer task, cloud scheduler or second worker.
Existing trusted awake/window/background lifecycle controls still govern ticks.

`platform/tests/calendar-engine.test.ts` exercises actual paired loopback HTTP:
synthetic CSV import, explicit calendar creation and preview, approval, exact
`12345` INR minor-unit receipt, occurrence provenance, acceptance, future pause,
renewed approval and a distinct second occurrence. Other regressions cover both
revision checks, explicit replacement, stale approval, refused RPC port injection,
legacy calendar rejection, phone/tainted mutation refusal, expiry and common-clock
legacy tick behavior. Fixtures label their clock, zone, bounds and dataset as
synthetic. They do not qualify a live vendor adapter or production scheduler.
