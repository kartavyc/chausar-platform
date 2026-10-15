# core-sync-jobs (round 4)

Branch `claude/lane-core-sync-jobs`. This lane owns `sync.ts`, `auth.ts`, `jobs.ts`, `worker.ts` and the engine event
bus. Its RPC methods live in `platform/runtime/modules/lane-core-sync-jobs.ts`; its code in
`platform/runtime/core-sync-jobs/`.

## 1. Machines and the pen (TR-07, SH-03, FR-14) — experimental

**What it is.** One computer at a time may change a synced workspace: the one that holds the pen. The others read.
The machines and the pen are recorded inside the workspace itself (this lane's module namespace), so every encrypted
snapshot carries them. Each machine has an Ed25519 key made on that computer and kept outside every workspace in
`<app data>/.chausar-device/` (the private key file is readable by this user only). The pen record is signed: the
first pen and a take-over by the new holder, a hand-over by the computer that gave the pen away.

**How it is enforced.** The installed app passes the Engine its device key and a *pen writer admission*
(`PenWriterAdmission`, `core-sync-jobs/pen.ts`) through `worker.ts` (`desktopSyncOptions`). The admission lets a
write through only when the open workspace names this computer as the pen holder and the pen's sequence is not older
than the highest this computer has seen (`pen-floor.json`): an older backup in which this computer still held the
pen stays read only (`SYNC_PEN_STALE_COPY`). On every other computer every write refuses `SYNC_READ_ONLY_DEVICE`.
Only this lane's own sync steps (sending and reading the encrypted copy, taking the pen) may record sync bookkeeping
on a read-only computer. The 120-second reviewed writer grants (`sync.writer.review`) are replaced by the pen on an
enrolled computer and refuse `SYNC_PEN_MANAGED`. A computer that is not enrolled gets no sync options at all and
behaves exactly as before. Sync stays off until the owner turns it on, and demo launches never sync.

**The shared folder.** The owner picks a folder (`sync.setup`). It holds `store/`, the existing encrypted one-writer
snapshot store (`FileSyncTransport`, signed snapshots only), and `devices/`, a small mailbox for joining
(`requests/`, `accepted/`, `refused/`) and each computer's last read (`seen/`). The mailbox never holds workspace
data. Google Drive can be chosen instead: hosted-link attaches its Drive transport (`hosted.drive.connect`); joining
then refuses `DEVICE_JOIN_NEEDS_FOLDER`.

**How a person uses it.**
1. On the first computer: Trust › Machines › Set up sync, pick the folder (`sync.setup { transport: 'folder', folder }`),
   restart Chausar when asked (`restartRequired`), then turn sync on (`sync.setup { on: true }`).
2. On a new computer, before any workspace is open: Join (`devices.join { step: 'request', folder }`) shows a six-digit
   code. On the first computer the same code shows (`seats.inviteVerify {}`); the person compares and presses Approve
   (`seats.inviteVerify { requestId, code, approve: true }`). That computer adds the machine, sends an encrypted
   copy and signs an acceptance. The new computer picks it up (`devices.join { step: 'finish' }`), the person restores it
   with the workspace passphrase (`workspace.restore { backupFile, passphrase, folder }`) and restarts. Requests expire
   after 15 minutes and are used once; Refuse is `approve: false`.
3. Hand over the pen (`devices.handOver { toDeviceId, confirm: true }`): this computer becomes read only at once and
   sends the copy that carries the hand-over. If sending fails (`published: false`), `{ retry: true }` sends it again.
4. On the computer that receives the pen, or any reader: Read the folder (`devices.read { passphrase }`) stages the
   newest copy in a new folder; the person switches to it (lock, then open that folder).
5. The pen holder sends its changes (`devices.send { confirm: true }`). Right after another computer sent, the
   one-minute publication lease refuses `SYNC_LEASE_WAIT`.
6. Remove a machine (`devices.remove`): it can never hold the pen again; what it copied stays on it, and its key does
   not change (`keyChanged: false`, `keyChange: 'VAULT_REKEY_NOT_BUILT'`).
7. Take the pen when its holder cannot be reached (`devices.takePen`), experimental: late changes from the old holder
   are not merged; the person settles them by hand (`lateChanges: 'settle-by-hand'`).

A reader trusts machines that joined after its copy was taken through the acceptances in the folder, each signed by
an approver it already knows.

**Tests:** `platform/tests/core-sync-jobs-devices.test.ts` (two and three engines sharing a synthetic local folder).

## 2. Live refresh (SH-01, TD-01, TD-03, TD-04, WK-01, WK-04, WK-07, BK-01) — supported

- **Engine event bus** (`core-sync-jobs/event-bus.ts`): bumps a sequence number whenever the open workspace or its
  revision changes (checked after every request and every scheduler tick, from `Vault.readIdentity()`).
- **Desktop push:** `worker.ts` sends `{ kind: 'engine-event', seq }` (at most one per 250 ms) → `engine-harness.cjs`
  emits `'engine-event'` → `main.cjs` forwards it on `EVENT_CHANNEL = 'chausar:engine-event'` → `preload.cjs`
  exposes `window.chausar.onEngineEvent(callback)`, delivering only `{ seq }`. No data crosses: the renderer then asks.
- **`events.subscribe`** (immediate reply, no waiting inside the engine): typed events after a cursor, filtered by kind,
  visible to the caller by the same rule as Activity (it reuses frame-today's `auditEvents`).
- **Places:** `PlaceRenderProps.subscribe?(kinds, onEvent) → unsubscribe` (additive, `places/types.ts`). The host makes
  one `createLiveEvents` (`places/live-events.ts`) per controller: it wakes on the desktop push, or polls every 5 s while
  the page is visible where there is no push (browser, loopback server), and stops quietly where the method is not built.
  Each event reaches a subscriber once; a screen should coalesce its own re-reads.

**Tests:** `platform/tests/core-sync-jobs-events.test.ts` (including a real forked worker over the harness) and
`app/ui/tests/core-sync-jobs-live-events.test.ts`.

## 3. Core jobs (WK-08, WK-09, WK-11, WK-16) — supported

- **Durations:** a `delivered` ledger entry carries `durationMs` (since that run's admission); every `step-verified`
  entry carries `stepId`, `durationMs` and, for an action preview, `actionId`.
- **Actions named per job:** `JobConfig.actions` (connector.operation, at most 50); a plan job defaults to its
  `allowedActions`. Part of the job's digest only when present, so stored jobs keep their digests.
- **Review date:** `JobConfig.reviewOn` (YYYY-MM-DD) and `jobs.review.set`; not authority, not in the digest.
- **Steps for a person:** a plan step with `provider: 'person'` and `input { what, memberId?, who? }` is never
  dispatched. The job waits (`runner-blocked`, ledger reason `PERSON_STEP_WAITING`) until the job's pinned owner calls
  `jobs.personStep.done`; then the step settles at no cost and the job resumes. The wait does not count against the
  plan's wall-time ceiling.
- **Child results:** `jobs.childResults` — each child task done, missing or waiting for a person, with released results;
  `open` stays true while any child result is missing.
- **Meters:** `jobs.meters` — clock time (sum of delivered durations) and effect exposure (prepared or approved actions
  the job names), each null when not counted.
- **Month-end in the installed app (WK-11):** `worker.ts` passes typed-job options (`desktopJobOptions`: the env policy,
  else a local default) and calendar rules (Asia/Kolkata, UTC and four more zones, 2024–2040), so
  `approvals.proposeJob` month-end no longer refuses `CALENDAR_SCHEDULE_UNAVAILABLE`.

**Tests:** `platform/tests/core-sync-jobs-jobs.test.ts`.

## 4. Audit events (TD-04) — supported

`lesson.decided` (`lessonId`, `outcome`), `vault.backup.done`, `release.update.checked` (`status`),
`workspace.locked`, `workspace.unlocked`, each with `memberId`. An open or a lock must not publish a revision of its
own (retained pins survive a read-only lock and reopen), so these records wait in memory and join the next ordinary
write to the same workspace, in that write's own revision. Writes of `workspace.*`, `scenarios.*`, `sync.*`,
`devices.*` and `seats.inviteVerify` requests, which pin the exact state they commit, never carry them. So "backup
done" and "update checked" appear after the next change, and records not yet written are lost if the app quits.
Machine events are also recorded: `device.enrolled`, `device.joined`, `device.pen.handed-over`, `device.pen.taken`,
`device.removed`; job events `job.person-step-done`, `job.person-step-waiting`, `job.review-date-set`.

**Tests:** `platform/tests/core-sync-jobs-audit.test.ts`.

## 5. Round 4 contracts

All replies are validated JSON; refusals are typed codes (listed on the lane's preload line).

| Method | Permission | Request | Reply |
|---|---|---|---|
| `events.subscribe` | read | `{ kinds?: Kind[]; after?: string }` | `{ cursor: string; events: { id; at; type; kinds: Kind[] }[]; more: boolean }` — without `after`: head cursor, no events. `Kind = 'activity'\|'approvals'\|'actions'\|'jobs'\|'sources'\|'books'\|'answers'\|'trust'\|'devices'\|'workspace'\|'lessons'` |
| `devices.list` | read | `{}` | `{ thisDevice: { id; name; enrolled } \| null; configured: boolean; syncOn: boolean; transport: { kind: 'folder'; access: 'read-write-this-folder' } \| { kind: 'drive'; access: 'drive.file'; oldCopies: 'drive-keeps-30-days-or-100-versions' } \| null; readOnly: boolean; pen: PenView; devices: { id; name; thisComputer; holdsPen; state: 'active'\|'removed'; enrolledAt; removedAt; lastReadAt; fingerprint; memberId? }[]; keyChangeOnRemove: 'not-built'; experimental: true }` |
| `devices.pen` | read | `{}` | `PenView & { configured: boolean; readOnly: boolean }`; `PenView = { holder: { id; name } \| null; thisComputerHolds: boolean; seq: number; since: string \| null; kind: 'first'\|'hand-over'\|'take-over'\|null; handOver: { to: string; published: boolean } \| null }` |
| `sync.setup` | admin, owner/cofounder, desktop | `{ transport: 'folder'; folder: absolute path; deviceName? }` \| `{ transport: 'drive'; deviceName? }` \| `{ on: boolean }` | the `devices.list` reply, plus `restartRequired: boolean` for the first two forms |
| `devices.handOver` | admin, desktop | `{ toDeviceId; confirm: true }` \| `{ retry: true }` | `PenView & { configured; readOnly; published: boolean; revision?: number; errorCode?: string }` |
| `devices.takePen` (experimental) | admin, desktop | `{ confirm: true }` | `PenView & { configured; readOnly; experimental: true; lateChanges: 'settle-by-hand' }` |
| `devices.remove` | admin, desktop | `{ deviceId; confirm: true }` | `{ removed: true; deviceId; keyChanged: false; keyChange: 'VAULT_REKEY_NOT_BUILT'; copiesStay: true }` |
| `devices.send` | admin, desktop, pen holder | `{ confirm: true }` | `{ sent: true; revision: number }` |
| `devices.read` | admin, desktop | `{ passphrase }` | `{ upToDate: true; revision }` \| `{ upToDate: false; folder; revision; switch: 'lock-then-open-folder' }` |
| `devices.join` | admin; preVault (desktop only) | `{ step: 'request'; folder; deviceName? }` \| `{ step: 'finish' }` \| `{ step: 'cancel' }` | `{ state: 'waiting'; requestId; code: six digits; expiresAt }` \| `{ state: 'ready'; backupFile; revision; next: 'restore-then-restart' }` \| `{ state: 'refused' \| 'expired' \| 'cancelled' }` |
| `seats.inviteVerify` | admin, desktop | `{}` \| `{ requestId; code; approve: true }` \| `{ requestId; approve: false }` | `{ requests: { requestId; name; code; expiresAt; fingerprint }[] }` \| `{ approved: true; requestId; deviceId; revision }` \| `{ refused: true; requestId }` |
| `jobs.review.set` | approve | `{ id; reviewOn: 'YYYY-MM-DD' \| null }` | the job view (`reviewOn` set or removed) |
| `jobs.personStep.done` | approve, pinned owner | `{ id; stepId }` | the job view |
| `jobs.childResults` | read, pinned owner | `{ id }` | `{ jobId; objectiveRevision; open: boolean; children: { id; goal; state: 'done'\|'missing'\|'waiting-for-person'; missingStepIds: string[]; results: { stepId; informationClass; evidenceIds; value }[] }[] }` |
| `jobs.meters` | read, pinned owner | `{ id }` | `{ jobId; clockMs: number \| null; exposureMinor: string \| null; actions: string[]; reviewOn: string \| null }` |

Also: `PlaceRenderProps.subscribe?: (kinds: readonly LiveEventKind[], onEvent: (event: LiveEvent) => void) => () => void`
and `window.chausar.onEngineEvent(callback: ({ seq }) => void) => () => void`.

Job record additions read by work-books: `job.actions`, `job.reviewOn`, ledger `durationMs` / `stepId` / `actionId`,
ledger `{ event: 'person-step-done', stepId, by, revision }`, ledger `{ event: 'blocked', reason: 'PERSON_STEP_WAITING', stepId }`.

## 6. Core edits

- `platform/runtime/engine.ts`: two imports and one fenced block (`readonly events`, request audits); `request()` runs
  `handleRequest` inside the audit wrapper and observes the bus in `finally`, as does `tick()`. Needed for the event bus
  and the five audits (item 1, 4).
- `platform/runtime/worker.ts` (owned): device sync options, job options and calendar rules, the engine-event push.
- `platform/runtime/jobs.ts` (owned): durations, actions, review date, person-step done, meters.
- `platform/runtime/job-runner.ts`: person steps (never dispatched; no provider may be named `person`), wait excluded
  from wall time, `childResults`, ledger fields, `job.actions` kept on amend. Needed for items WK-08 and WK-16.
- `platform/runtime/job-protocol.ts`: `GoalExecution.personWaitMs?`, person-step input validation in `validatePlan`.
- `app/desktop/engine-harness.cjs`, `ipc-contract.cjs` (+ `.d.cts`), `main.cjs`, `preload.cjs`: the engine-event
  channel and `onEngineEvent`; `preload.cjs` also the lane's refusal line (synced into `app/ui/src/bridge/client.ts`).
- `app/ui/src/places/types.ts`: optional `subscribe` prop. `app/ui/src/host/bootstrap.tsx`: one live-events instance per
  controller, passed as `subscribe`. `app/ui/src/bridge/fake.ts`: `events.subscribe` answers empty.
- Tests of other lanes, adjusted additively: `demo-provider-isolation.test.ts` and `demo-data-isolation.test.ts` (VM
  globals for the new worker/engine imports), `frame-today-shell-preload.test.ts` (the new preload key).

## 7. Still missing

- **Needs the founder:** a second real computer (Windows or macOS), a network or cloud folder, and the home box machine
  (TR-07, free or paid is open). Joining through Google Drive refuses `DEVICE_JOIN_NEEDS_FOLDER`.
- **Removing a machine does not change the key:** the vault has no re-key method (core-gateway-auth owns `vault.ts`).
- **The signing key** is a 0600 file; it moves into core-gateway-auth's OS-keychain secret store when that exists.
- **A read-only computer refuses every change**, including saving an answer; "prepare goes to the pen holder as a
  request" is not built. Its scheduler's job runs refuse at their first write.
- **Take-over** does not merge the old holder's late changes; a later send from the old holder fails its head check.
- **Switching** to a copy read with `devices.read` is lock-then-open of a new folder; old folders are not cleaned up.
- **No screen uses `subscribe` yet**: each UI lane adopts it in its own screens. reports-tools-trust draws TR-07 and
  frame-today the FR-14 join and the SH-03 read-only banner over the methods above.
- **Audit timing:** "backup done" and "update checked" show after the next change; unwritten records are lost on quit.
