# Engine methods outside `venture.*`

The product the app shows is the venture launcher, and its methods all start with `venture.`. They are described in [venture/README.md](venture/README.md) and [venture/ink.md](venture/ink.md). This page lists the few methods the engine answers itself, in the method switch of `platform/runtime/engine.ts`. Each one is also on the desktop allowlist in `app/desktop/ipc-contract.cjs`, except `workspace.import` and `workspace.backups.copyTo`, which the desktop shell calls after its own file dialog.

A method being listed here means the engine answers it. It does not mean a live service, a signed installer or a second computer has been tried. The limits are said beside each group.

## Opening and keeping a business

| Methods | What they do | Limits |
|---|---|---|
| `workspace.status`, `workspace.list`, `workspace.create`, `workspace.open`, `workspace.lock`, `workspace.recover`, `workspace.restore`, `workspace.delete` | Make, open, close, recover and delete a business. Each business is one encrypted vault ([vault.md](vault.md)). | The desktop keeps vaults in file storage that the code calls experimental. |
| `workspace.custody.get`, `workspace.custody.passphraseOn`, `workspace.custody.passphraseOff`, `workspace.custody.recoveryCode`, `workspace.custody.neverContactReset` | Where the vault key is kept: with this computer's login, or behind a passphrase. The recovery code. | The Windows key store was run for real. The macOS and Linux ones were tested with stand-ins only ([custody.md](custody.md)). |
| `workspace.backups.list`, `.create`, `.restore`, `.inspect`, `.copyTo`, `workspace.backups.drive.status`, `.connect`, `.disconnect` | Encrypted backups: automatic and by hand, a restore, a second copy in a folder the owner picks, and a copy in the owner's Google Drive. | A build needs its own Google client for Drive. |
| `workspace.transfer.export`, `.import`, `.peek`, `workspace.export`, `workspace.import` | Moving a business to another computer with one file and one code, and saving a copy. | Changes on one computer do not reach the other. |

Tests: `vault.test.ts`, `workspace-custody.test.ts`, `device-custody.test.ts`, `drive-backup-c5.test.ts`, `server.test.ts`.

## Sessions, trust and members

| Methods | What they do |
|---|---|
| `auth.session`, `auth.revoke` | Issue and revoke a member's session. A session is checked against the member's current role and epoch on every request, so an old session never outlives a change. |
| `trust.get`, `trust.update` | Read and change the business's trust policy. |
| `members.add`, `members.revoke` | Add a member and take one away. |

Tests: `auth.test.ts`, `server-auth.test.ts`, `business-engine.test.ts`.

## Calculations and receipts

| Methods | What they do |
|---|---|
| `calculation.run` | Runs one registered calculation (`billed`, `received`, `earned`, `revenue`, `refunds`, `costs`, `purchases`, `net_sales`, `margin`, `aging`, `change`, `scenario`) with exact BigInt minor units, an explicit period and a known-on time. An unknown operation is refused. Outside demo mode the result is checked again in SQL before its receipt is kept ([analytics.md](analytics.md)). |
| `receipts.get` | Reads a saved receipt: the rows, definitions, period and exclusions behind an amount. Access is checked again on every read. |

Billed, received and earned count different events. Margin counts imported costs only. A scenario changes assumptions, never source facts. The venture screens show their own amounts through `venture.receipt.get`; no Ink screen calls `calculation.run` directly.

Tests: `business-engine.test.ts`, `analytics.test.ts`, `database-differential.test.ts`.

## The app itself

| Methods | What they do | Limits |
|---|---|---|
| `updates.status`, `updates.settings`, `updates.check` | The daily check of a signed update feed, and the owner's settings for it ([releases.md](releases.md), [desktop-releases.md](desktop-releases.md)). | The build carries no release key and no feed address yet, so every build reads "not set up". |
| `app.preferences.get`, `app.preferences.set` | The app's own preferences on this computer. | |
| `whatsNew.get`, `whatsNew.seen` | The "What's new" note after an update. | |

Tests: `update-service-c5.test.ts`, `updater.test.ts`, `app-preferences-c3.test.ts`.
