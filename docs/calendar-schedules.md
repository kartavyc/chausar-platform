# Calendar schedules for durable mandates

This module evaluates schedules and prepares durable local admission. It installs no OS/cloud task and owns no timer or second worker coordinator. The existing job lease, budget, source checks, exact approval and owner acceptance remain authoritative. Providers expose read or action preparation; calendar catch-up grants no external send authority.

The host supplies `CalendarRules` and `CalendarBounds` to `JobService`. `IntlCalendarRules` requires an explicit installed zone list, qualified year range and cache capacity. Its revision binds Node's time-zone database and ICU versions. A changed rules revision fails qualification instead of silently changing a reviewed schedule. `timeZone` comes from the requested workspace/business schedule; machine location and the owner's personal zone are never used.

`CalendarDefinition` version 1 declares:

| Field | Required decision |
| --- | --- |
| `effectiveFrom`, `stop.until` | Absolute offset/Z instants; dispatch interval is start-inclusive, end-exclusive |
| `recurrence` | One-time civil minute, daily civil days, weekly weekdays/cycles, or monthly requested date |
| `dst` | Gap: skip/reject; fold: earlier/later/both/reject |
| Monthly `missingDate` | Skip unavailable date or use that month's last day |
| `excludedResolvedDates` | Explicit Gregorian dates, including an empty list |
| `holidays` | Include dates, or skip dates from a supplied versioned calendar with explicit coverage |
| `missed` | Skip beyond declared grace; coalesce into latest due slot; or bounded catch-up with retained/skipped overflow |
| `overlap` | Defer periods due while current work awaits completion/acceptance, or skip those periods |
| `identityBasis` | Local date, local date/time, or local month as the business period |
| `stop.maxNominalOccurrences` | Maximum requested nominal slots, including excluded, missing-date and DST-gap slots |
| `revisionPolicy` | Explicit `idle-only` policy |

No weekend, holiday roll, gap shift, monthly clamp or fold policy is inferred. Weekly cycles begin at `startDate` and span seven civil dates; weekdays use Sunday 0 through Saturday 6. Monthly stepping always uses the original month anchor: January 31, February 29/28, March 31 under last-day policy, with no drifting anchor. A fold with `both` yields two distinct occurrence identities while consuming one nominal slot. A single-run earlier/later fold policy shares one business identity, so a policy revision cannot resend the same period. Monthly identity is qualified only for monthly/one-time recurrence, avoiding implicit first-date-wins behavior. Holiday/exclusion checks use the resolved local date, including monthly last-day resolution. Holiday coverage must cover every applicable resolved slot in the effective qualified horizon.

```ts
const rules = new IntlCalendarRules({
  timeZones: ['America/New_York'],
  minYear: 2024, maxYear: 2030, maxCachedLocalTimes: 512,
});
const jobs = new JobService(store, {
  clock, calendarRules: rules,
  calendarBounds: { maxNominalSlots: 400, maxCalendarDays: 3000 },
});
```

These example technical bounds are host qualification settings, not product defaults. The caller must supply its own. Pure `evaluateCalendar` returns the full bounded occurrence preview, selected due slots, skipped/coalesced/deferred decisions, next evaluation instant, rule revision and complete coverage. Exceptional dates retain an audit checkpoint, including the first real instant after a nonexistent civil minute; this checkpoint never becomes a dispatch occurrence. It examines requested dates as well as emitted occurrences. Exceeding nominal-slot/calendar-day/rules-year bounds raises an error; a truncated result never claims to be the latest catch-up answer. Civil-minute resolution exhaustively roundtrips UTC minutes within ±26 hours and uses a caller-bounded cache. Supported rules years are 2000–2100, further restricted by host qualification. This is an explicit local adapter limit, not a change to product scope.

`DurableJobRunner.create` accepts `calendar` instead of elapsed `nextRunAt/intervalMs/catchup/graceMs` fields. Supplying both contracts is rejected. Legacy elapsed mandates retain their existing semantics. `calendarEvaluation(job)` is the service's pure evaluation helper; callers must first use the existing owner/source visibility boundary when exposing previews.

New calendar admission persists the business occurrence ID, schedule/objective revisions and budget reservation in one store transaction. No approval, autonomy or budget failure consumes a selected occurrence. The provider operation key binds the durable occurrence and step. A crash after admission and before execution initialization retains the admitted slot, even when grace has since passed. Unknown outcomes retain original keys and budget holds; readback can finish after schedule expiry. Expiry blocks new dispatch and new child contributions.

Only one occurrence is admitted by the existing serial worker. Catch-up `maxPerPass` bounds the pure planning selection; each next actual run still requires explicit owner acceptance/repeat of its predecessor. Retained overflow is eligible in later passes; skipped overflow and coalesced periods persist tombstones. Coalesced output lists represented occurrence IDs. Pending acceptance counts as active overlap. Skip-overlap windows begin at admission and end at acceptance; older backlog before admission remains eligible. Calendar stop is an absolute dispatch cutoff, even for historical catch-up.

`pauseCalendar` and `resumeCalendar` control future claims only. They preserve a running/admitted occurrence and any uncertain readback. The existing workflow `pause`, `cancel` and revocation separately fence current work. A paused calendar does not make a sleeping host execute. Host awake/window/background declarations continue to control `tick`.

`configureCalendar(context, id, definition, expectedScheduleRevision, expectedObjectiveRevision, 'replace-immediately')` requires the exact pinned owner inside the app, optimistic revision matches, an idle mandate and a prospective effective instant. The required sixth argument explicitly retires the old definition now: `effectiveFrom` starts new coverage and is not a delayed activation time. A future coverage start therefore creates an explicitly reviewed gap. Retired definitions and replacement/coverage times remain durable audit evidence. It invalidates exact approval and binds the new schedule to the current objective. Active, delivered or unresolved work must finish or be explicitly amended/reconciled first. Objective amendment preserves original unknown work, and its old calendar cannot dispatch the changed objective until the owner explicitly reconfigures it. Existing consumed business-period IDs remain tombstones across schedule/time/zone changes; schedule revision is provenance rather than a new dispatch identity. `identityBasis` and single-run versus both-fold multiplicity are immutable within a mandate to prevent revision from evading tombstones; changing either requires a separately reviewed mandate.

Parent integration still owns Engine/RPC, store/vault coordination, UI preview, host lifecycle and eventual enterprise coordinator selection. Material product choices remain: policy selection UI and per-goal business-period identity; qualified zone/year/horizon/cache settings; gap shifting or holiday rolling beyond these explicit bounded options; active prospective revisions beyond idle-only; and whether enterprise scheduling uses the existing platform-selected durable coordinator. This implementation chooses no customer workflow, transport or hosted provider.
