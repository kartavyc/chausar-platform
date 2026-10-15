# core-sync-jobs (round 4)

Branch `claude/lane-core-sync-jobs`. This lane owns `sync.ts`, `auth.ts`, `jobs.ts`, `worker.ts` and the engine event
bus. Its RPC methods live in `platform/runtime/modules/lane-core-sync-jobs.ts`; its code in
`platform/runtime/core-sync-jobs/`.

<!-- SECTIONS: devices, events, jobs, audit, contracts, core edits, gaps -->

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
