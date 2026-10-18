# Keeping a business's vault key on this computer

Decided by the founder on 18 October 2026: no passphrase at onboarding; the computer keeps the vault key for the owner's login; an optional "Lock with a passphrase" switch in Trust; automatic encrypted backups; a move to another computer with one file and one code. The design is `.b2c-work/KEYCHAIN-SPEC.md`. This page says what the engine does, what was really run, and the limits.

Code: `platform/runtime/workspace-custody-contracts.ts` (types, method names, fixed words), `device-custody.ts` (the operating system key stores), `workspace-custody.ts` (cards, key records, backup names, rotation, the move code), the custody section of `engine.ts`, and the custody methods of `vault.ts`. Tests: `device-custody.test.ts`, `workspace-custody.test.ts`, the custody cases in `vault.test.ts`.

## How it works

The vault format does not change. A random 32-byte data key encrypts the business (AES-256-GCM), and that key is wrapped twice with scrypt: once in the passphrase slot, once in the recovery slot.

- **This computer (the default).** The engine makes a computer secret (32 random bytes, written as 43 base64url characters) and puts it in the passphrase slot. The operating system keeps the secret for the owner's login. Chausar's files hold only the operating system's protected blob (Windows) or a pointer to the operating system's item (macOS, Linux).
- **With a passphrase.** The passphrase slot holds the owner's passphrase, exactly as before this change.
- **Recovery code.** A this-computer business starts with no usable recovery code (`recovery: 'not-made'`): `Vault.create` makes one and the engine drops it unseen. The owner makes one in Trust (`workspace.custody.recoveryCode`), which replaces the recovery wrapper. Turning the passphrase on always makes one if none was made.

```
workspace.create { name, pack, folder: null }      (no passphrase)
  probe the key store (a success is kept; a failure is asked again after 15 s)
  folder = slug(name), then -2 ... -99
  custody/cards/<folder>.json  state 'creating'
  Vault.create(passphrase = computer secret)        recovery code dropped
  DeviceKeyStore.protect(vaultId, secret)  ->  custody/keys/<vaultId>.json
  attach, publish the pack, hold the draft desk
  card state 'ready', unlock 'this-computer', recovery 'not-made'

workspace.open { folder }                           (no passphrase)
  card -> vault id -> key record -> DeviceKeyStore.unprotect -> secret -> Vault.open
```

Files beside the vault folders, under the engine's `directory`:

| Path | Holds | Secret? |
|---|---|---|
| `custody/cards/<folder>.json` | `chausar.vault-card.v1`: folder, vault id, workspace id, **the business name**, demo, unlock mode, recovery state, the wrappers digest, `state`, `pending`, created and opened times | No. The business name is readable on disk so Welcome back can list businesses before opening (K7). |
| `custody/keys/<vaultId>.json` | `chausar.device-key.v1`: scheme, and the DPAPI blob (Windows) or `{ service, account }` (macOS, Linux, memory) | No. A DPAPI blob opens only for this Windows login on this computer. |
| `transfers/<random>.backup` | an uploaded move file, during one import only, deleted in `finally` | Ciphertext |
| `backups/chausar-<workspaceId>-<ms>-<kind>.backup` | `chausar.backup.v1`, the live envelope, ciphertext only; kind `auto`, `manual` or `safety` | Ciphertext |

Writes are atomic (temp file, fsync, rename) with mode `0o600` and the same no-symlink checks as the vault (`atomicWriteText` in `vault.ts`). On Windows the files inherit the folder's ACL; mode bits mean nothing there. None of these files is written unless the engine is composed with `workspaceCustody` (`server.ts` and `worker.ts` do; hosted engines and tests that leave it out keep today's files exactly).

## The key stores, per platform

| Platform | Mechanism | How Chausar calls it | Really run |
|---|---|---|---|
| Windows | DPAPI, `CurrentUser` scope, entropy `chausar.device-key.v1:<vaultId>` | `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe -NoLogo -NoProfile -NonInteractive -Command <fixed script>`; three lines on stdin (op, entropy, base64 data), read with `[Console]::In.ReadLine()`; the child's environment is `{ SystemRoot }` only | **Yes**, Windows 11 Home 10.0.26200, PowerShell 5.1, 18 and 19 October 2026 |
| macOS | Login keychain, generic password, service `chausar.vault-key`, account `<vaultId>` | `/usr/bin/security -i` with the add command on stdin; `find-generic-password -w`; `delete-generic-password` | No. Fake-process tests only. |
| Linux | Secret Service (gnome-keyring, or KWallet with its Secret Service) | `/usr/bin/secret-tool store`, `lookup`, `clear`; the secret on stdin; only `DBUS_SESSION_BUS_ADDRESS`, `XDG_RUNTIME_DIR` and `HOME` passed | No. Fake-process tests only. |
| Electron safeStorage | designed only (KEYCHAIN-SPEC 2.6) | not built | No |
| Anything else | none | the passphrase fallback | n/a |

Every call is one child process with no shell, a timeout (20 s, 30 s on Linux), stdout capped at 64 KiB, and **stderr ignored at the source** (`stdio: ['pipe', 'pipe', 'ignore']`), because it can echo input. The secret never appears in an argument list. `device-custody.ts` never logs. A failure becomes `DEVICE_KEY_FAILED` or `DEVICE_KEYS_UNAVAILABLE` with fixed words and a `reason`; no stdout, stderr or secret reaches a message.

The probe is one real round trip with the operating system (Windows: a protect of 32 random bytes whose script also unprotects and compares; macOS and Linux: store, read back and delete an item named `probe-<16 hex>`). A success is kept for the life of the key store (so once per engine process). A failure, such as a slow cold start of PowerShell, antivirus scanning `powershell.exe`, or a keyring still locked at launch, is kept for only 15 seconds (`PROBE_RETRY_MS`), so a burst of calls doesn't start many processes, and then the next call asks the operating system again; no restart is needed. It runs only when something needs it: `workspace.custody.get`, a create, recover, restore or move without a passphrase, or an open without one. macOS and Linux are switched on when their own probe succeeds on that computer (K16), so the words on screen are true there, but nobody has run them on a Mac or a Linux desktop yet. Before release, someone runs the fake-process cases' real counterparts on each and records it here.

### PowerShell logging

Managed Windows machines often turn on PowerShell module logging by Group Policy (module name `*`). It writes every cmdlet's parameter values to the event log (event 4103 in Microsoft-Windows-PowerShell/Operational, event 800 in Windows PowerShell). So the DPAPI script never passes stdin through a cmdlet or a pipeline: it reads its three lines with `[Console]::In.ReadLine()`, decodes with `[Convert]::FromBase64String`, and writes its answer with `[Console]::Out.Write`. The only cmdlet it runs is `Add-Type -AssemblyName System.Security`, whose parameters are fixed. `device-custody.test.ts` checks that the script has no pipeline and no cmdlet other than `Add-Type`. Script block logging records the script text, which holds no secret.

What was run on 19 October 2026 (this computer, Windows PowerShell 5.1.26100): with module logging switched on inside the child (`LogPipelineExecutionDetails = $true` on `Microsoft.PowerShell.Utility`, the same switch the Group Policy sets), the earlier script (`[Console]::In.ReadToEnd() | ConvertFrom-Json`) wrote a test value from stdin into the Windows PowerShell event log; the current `ReadLine` script did not. With `Start-Transcript` running in the child, neither the stdin line nor the `[Console]::Out.Write` answer appeared in the transcript. Transcription switched on by Group Policy was not run; it is expected to behave the same, but that is not checked.

### What ran on this computer

Windows 11 Home 10.0.26200, Windows PowerShell 5.1.26100, FullLanguage mode, Node 24.13.1:

- `device-custody.test.ts`, the real DPAPI case: probe 480 ms, protect 443 ms, unprotect 434 ms, a 262-byte blob for 32 bytes of data. A record made for one vault refused to open as another (exit 1); a blob with one flipped byte refused to open; the probe ran once for the store. (KEYCHAIN-SPEC's own check the day before: protect 515 to 528 ms, unprotect 467 to 490 ms, the first cold call 1.2 to 1.3 s.)
- `workspace-custody.test.ts`, "a new engine on the same folder": an Engine with `deviceKeys: 'os'` made a business with no passphrase, changed it, shut down (which wrote an automatic backup), and a second Engine on the same folder listed it as "with this computer" and opened it with no passphrase. About 2.1 s.
- `workspace-custody.test.ts`, "the local server ... starts again": the real `node platform/runtime/server.ts --demo` on a free port, with a temp `CHAUSAR_VAULT_DIRECTORY`; `workspace.create { name, pack, folder: null }` over HTTP gave `unlock: 'this-computer'` and no recovery code; the process was killed; a new server process listed the business and opened it with `workspace.open { folder }` and no passphrase, with the change still there. About 3.5 s.
- After the stdin change to three `ReadLine` lines (19 October 2026), the real DPAPI case and both "Windows for real" cases above passed again on this computer.
- The app, 19 October 2026: the local web server on port 4391 with the demo replay variables and an empty vault folder, walked in headless Edge by clicking and typing ([onboarding.md](venture/onboarding.md#the-live-walk-19-october)). Keep this plan made `ledger-cafe-books` with a DPAPI key record and no passphrase; the first tick wrote an automatic backup and the plan's acceptance a second one two minutes after the first; the server was killed and started again, and the business opened by itself; "Close this business" and Open from Welcome back opened it again; Lock with a passphrase removed the key record, a restart asked for the passphrase and it opened; turning the lock off made a new key record and resealed every backup (each one "Opens the way your business opens now"); a manual backup restored after a client was added removed the client and saved a safety copy first; a recovery code and a move file were made in this-computer mode. The vault and backup files held no business name in plain text; only the card does.
- `venture-onboarding-e2e.test.ts` now keeps its main plan this way too, with an in-memory key store, and reopens it after a restart from `workspace.list`.

## When no protected storage is available

The engine says why in the words of `CUSTODY_WORDS.unavailable[reason]`, and every create, open, recover, restore and move then needs a passphrase, as before. Reasons: `not-configured` (the engine was composed with `deviceKeys: 'none'`, or `CHAUSAR_DEVICE_KEYS=none`, or without `workspaceCustody`), `platform`, `blocked` (PowerShell not in FullLanguage mode), `no-keyring`, `locked`, `failed`.

## Lock with a passphrase, and back

- **On** (`workspace.custody.passphraseOn { passphrase }`): a safety backup (required while `recovery` is not `made`: if it fails, `SAFETY_BACKUP_FAILED` and nothing changes; best effort otherwise), the card gets the marker `pending: 'to-passphrase'`, `rewrapPassphrase(passphrase)`, a new recovery code if none was made, the card says `unlock: 'passphrase'` and `pending: 'forget'`, every managed backup of this vault is resealed, this computer's key is forgotten (unless another folder of the same vault still opens with it), `pending: null`, audit `custody.passphrase-on`. Returns `{ custody, recoveryCode }`.
- **Off** (`workspace.custody.passphraseOff { passphrase }`): refused with `SYNC_NEEDS_PASSPHRASE` while device sync is on (other devices pull with the passphrase), the current passphrase is checked in constant time (`PASSPHRASE_WRONG`), the probe must pass, the computer secret is made and protected (or the one another folder of the same vault already uses is reused), a safety backup (required while `recovery` is not `made`), the marker `pending: 'to-this-computer'`, `rewrapPassphrase(secret)`, the card says `this-computer`, reseal, audit `custody.passphrase-off`.
- **Recovery code** (`workspace.custody.recoveryCode { passphrase? }`): in passphrase mode the passphrase is required; a new `CHR-` code replaces the recovery wrapper; reseal; audit `custody.recovery-made`.
- **Unlocking afterwards**: a passphrase business is "Needs your passphrase" in the list. `workspace.recover { folder, recoveryCode, passphrase? }` sets the new passphrase, or with none goes back to this computer with a fresh computer secret.
- **A change cut short**: the marker is on the card before the rewrap. If a step after it fails in the running engine (an `EPERM` on a Windows rename, a full disk), the engine puts the vault back with the secret it opened with before (the computer secret, or the passphrase just typed for Off), forgets a key record it had just made, and clears the marker. If even that fails, or the app stops, the marker stays and `workspace.open` tries both ways in: a card that says `this-computer` with `to-passphrase` answers `PASSPHRASE_REQUIRED` when the computer secret no longer opens the vault, and the list shows it as "Needs your passphrase"; a card that says `passphrase` tries this computer's key when it has `to-this-computer` or a key record for the vault exists, and the list shows "Opens with this computer" when the marker and the key record are both there; a typed passphrase that fails while a marker is set tries this computer's key too. `workspace-custody.test.ts` makes `rewrapRecovery`, the undo's rewrap and `writeCard` throw to check each of these.
- **Crash windows**: opening with a typed passphrase always sets the card to `passphrase` and forgets a stale key; opening with the computer secret sets it to `this-computer`; a set `pending` (a marker included) is finished (reseal) on the next open. A crash between making the vault and storing its key leaves an empty vault under a `creating` card that the list hides (K11).

## Automatic backups

| Trigger | Kind | Rule |
|---|---|---|
| A tick (every 30 s from `server.ts` and `worker.ts`) | `auto` | the last backup is older than 6 hours and the revision changed since it |
| After an important change (`BACKUP_AFTER_METHODS`) | `auto` | the next tick writes one when the last is at least 2 minutes old, so bursts become one |
| `workspace.lock`, engine shutdown | `auto` | the revision changed since the last backup |
| Before a custody change or a restore | `safety` | required for a restore, and for a lock change while `recovery` is not `made`; best effort otherwise |
| `workspace.backups.create` | `manual` | |

A business with no backup yet gets one at its first tick. The backup check runs before `tick()`'s autonomy check, counts as an active request (so a transition waits) and shares one serial chain with custody changes, rotation and reseal. A failed automatic backup (for example `ARTIFACT_BACKUP_REQUIRED` while private artifacts exist) is kept in memory as `lastError` and shown by `workspace.custody.get`; it never fails the request that triggered it.

Rotation (`keepBackups`, after every automatic or safety write): among this business's `auto` files keep the union of the 10 newest, the newest of each of the last 14 UTC days and the newest of each of the last 8 ISO weeks (Monday to Sunday); keep the 5 newest `safety` files; never delete `manual` files, old `chausar-<id>-<ms>.backup` files (listed as manual), or anything of another business. At most about 32 automatic files per business.

**Reseal.** The data key never changes for the life of a vault, so after any wrapper change the engine rewrites this vault's managed backups and its encrypted exports (`exports/chausar-<workspaceId>-<ms>.vault`; plaintext `.json` exports are left alone) with the live wrappers at each backup's own revision. Turning the passphrase on really protects the old copies too, and a replaced recovery code stops opening them. When the open folder opens with this computer and another folder of the same vault (a restored copy, for example) is locked with a passphrase, the reseal is skipped: backups are shared by workspace id, and resealing them would quietly undo that passphrase.

Copies outside Chausar's `backups/` and `exports/` folders (a move file, anything the owner copied elsewhere) are not changed, and that can make them stop opening. A copy made in this-computer mode with no recovery code opens only with that computer secret, so after turning the passphrase on (which forgets the secret) no passphrase, code or key opens it. A recovery code made now doesn't help, because the older copy carries the older recovery wrapper. `CUSTODY_WORDS.lock.outsideCopies` is the warning to show before turning the passphrase on while `recovery` is `not-made`. Copies made with a passphrase keep opening with that passphrase and the recovery code of that time. Each `BackupView.opensNow` says whether a file's wrappers equal the business's current ones.

**Restore.** Inside an open business: `workspace.backups.restore { file, confirmed: true }` (this business's managed backups only, `BACKUP_OTHER_BUSINESS` otherwise), a required safety backup, the backup's state committed as the next revision (so sync and pins never see a revision go backwards), the services attached again, audit `backup.restored`. Before opening: `workspace.restore { backupFile, folder?, passphrase?, recoveryCode? }`; with no credentials the computer secret for the backup's vault opens it; `folder: null` picks `<old folder>-restored`, then `-2`.

## Moving to another computer

The computer secret cannot travel, so a move has its own file and its own code.

- `workspace.transfer.export { passphrase? }` (the passphrase is required in passphrase mode): a code `CHT-` + 24 Crockford base32 characters (15 random bytes, 120 bits), and a `chausar.backup.v1` text whose passphrase wrapper is made from that code. The recovery wrapper is kept, so a recovery code the owner already has opens it too. The text carries a plaintext `transfer: { format: 'chausar.transfer.v1', madeAt, recovery }` and no name. The engine keeps no copy.
- `workspace.transfer.import { fileText, transferCode, passphrase? }` before a vault is open: at most 1,900,000 characters, a valid move file, not a vault already on this computer (`TRANSFER_SAME_BUSINESS`), the code normalized (upper case, spaces and dashes dropped, `O` to `0`, `I` and `L` to `1`). The file is written to `transfers/`, restored into `moved-<6 hex>`, rewrapped with a fresh computer secret (or the given passphrase), and deleted in `finally`.
- "One-time", honestly: the code is shown once and never stored, and after the import the moved business no longer opens with it. The file itself still opens with the code wherever it is copied, until it is deleted. The business stays on the old computer, and changes on one don't reach the other.

## For the renderer (the handoff)

- `workspace.create { name, pack, folder: null }` with **no `passphrase` key** makes a this-computer business; the answer adds `folder` and `unlock` and has `recoveryCode: null`, `recoveryKit: null`. Omitting `folder` still means `main`.
- `workspace.open { folder }` with no passphrase opens a this-computer business. `workspace.restore` answers `{ workspace, folder }`.
- `workspace.status` adds `closedByOwner` (true after `workspace.lock`, false after any open) and, with a vault open, `unlock`. Only when the engine has `workspaceCustody`.
- Error codes and words: `CUSTODY_ERRORS` and `CUSTODY_WORDS.errors` in the contract file. `DEVICE_KEYS_UNAVAILABLE` has the message `CUSTODY_WORDS.unavailable[reason]` and `reason` on the error; the local server's JSON error carries `reason`, but the desktop IPC (`engine-harness.cjs`) passes only `code` and `message`, so match the message against `CUSTODY_WORDS.unavailable` to find the reason there.
- `WEAK_PASSPHRASE` (12 to 1024 characters), `CONFIRMATION_REQUIRED` (restore without `confirmed: true`) and `APP_APPROVAL_REQUIRED` (a custody change from a tainted or non-desktop context) are the existing codes.
- `workspace.list` answers `complete: false` on PostgreSQL storage (old vaults there have no file to find, so offer "Open by folder name") or when more than 50 businesses exist.
- A this-computer business refuses `sync.enable { enabled: true }` with `SYNC_NEEDS_PASSPHRASE`, and `passphraseOff` refuses with the same code while sync is on.
- `SAFETY_BACKUP_FAILED` (words `CUSTODY_WORDS.lock.safetyBackupFailed`): a lock change with no recovery code yet couldn't save its safety copy, so nothing changed. Offer "Make a recovery code", then the change again.
- Opening a this-computer business when the computer's protected storage didn't answer gives `DEVICE_KEY_FAILED` with `CUSTODY_WORDS.lock.keyNotAnswering` ("Try again, or use your recovery code"), not the create-time words that promise a passphrase. Trying again asks the operating system again once 15 seconds have passed.
- A row listed `with-this-computer` can still answer `PASSPHRASE_REQUIRED` in one rare case (a lock change cut short twice over). The row should then show its passphrase field, as a `needs-passphrase` row does.
- Before turning the passphrase on while `recovery` is `not-made`, show `CUSTODY_WORDS.lock.outsideCopies`. The Trust note that says copies outside the backups folder "are not changed" should also say they can stop opening.
- Hosted answers `HOSTED_NOT_AVAILABLE` for all ten custody methods; hosted custody is unchanged.

## Threat notes for engineers

- DPAPI blobs can be opened offline by someone who has the user's profile and knows or cracks the login password; a local administrator can act as the user.
- Anyone signed in as the owner, or any program running as the owner, can open a this-computer business. On macOS the keychain item trusts `/usr/bin/security`, so any process of the user can read it without a prompt.
- The computer secret and typed passphrases live briefly as JavaScript strings, which cannot be zeroed; buffers holding them are zeroed after use.
- The business name is readable in the card file.
- scrypt on a random 256-bit secret adds cost, not strength.
- An attacker with disk access can replay an older whole envelope (as before this change).
- Turning the passphrase on doesn't change the data key, so a copy of the computer secret and the files taken earlier still opens that earlier copy.
- Losing the Windows key (a Windows reinstall, a password reset by someone else) with no recovery code loses the business and every backup, which is why Trust and Today ask the owner to make a recovery code (K1).
