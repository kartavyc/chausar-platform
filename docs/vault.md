# The encrypted vault

Each business is one vault (`platform/runtime/vault.ts`). `Vault` implements `StateStore`. Its unlocked state and AES key are private engine fields; reads return detached copies. The window never receives a raw key. Callers must authorize an operation before invoking the vault because this subsystem provides storage protection, not member authorization.

Every authority snapshot uses AES-256-GCM with a fresh 96-bit nonce. Authenticated associated data binds the format, vault ID, revision, and both key wrappers. A random 256-bit data encryption key is independently wrapped by a passphrase and by a random recovery code. Each wrapper uses its own 128-bit salt, fixed scrypt N=32768/r=8/p=1, and AES-GCM. Untrusted envelope fields cannot increase KDF work. `Vault.create` returns the recovery code once, in its answer. A business kept with this computer's login starts without a usable recovery code, and the owner makes one in the app ([custody.md](custody.md)).

## Engine API

```ts
const { vault, recoveryCode } = await Vault.create({
  directory: '/absolute/path/to/private-vault',
  name: 'My business', passphrase: 'a long private passphrase',
  storage: 'experimental-file', demo: true,
});
const state = vault.read();
await vault.update(draft => { draft.workspace.name = 'Updated business'; });
await vault.backup('/absolute/path/to/new-backup.chausar');
await vault.close();
const reopened = await Vault.open({ directory, passphrase, storage });
const recovered = await Vault.recover({ directory, recoveryCode, newPassphrase, storage });
const restored = await Vault.restore({ directory: newDirectory, backupFile, passphrase, storage });
// A backup also supports recoveryCode plus newPassphrase instead of passphrase.
await restored.export('/absolute/path/to/new-file.json'); // encrypted by default
await restored.export('/absolute/path/to/readable.json', { plaintext: true });
await restored.delete();
```

Custody changes keep the data key inside the class and never take or return it (see [custody.md](custody.md)):

```ts
vault.wrappersDigest;                                // sha256 of the live passphrase and recovery wrappers (public metadata)
await vault.verifyPassphrase(secret);                // true or false, never throws for a wrong secret
await vault.rewrapPassphrase(secret);                // a new passphrase wrapper, committed as revision + 1
const code = await vault.rewrapRecovery();           // a new CHR- code; the old one stops opening the live vault
const text = await vault.transferText(moveCode, { recovery: 'made', madeAt }); // a chausar.backup.v1 move file
await vault.resealBackups([absoluteBackupPaths]);    // old backups of this vault open the way it opens now
await vault.replaceFromBackup(absoluteBackupPath);   // a backup's state of this vault, committed as revision + 1
```

State updates run in one serial queue. Each callback sees a detached draft; failures leave the in-memory committed state untouched. Only a durable adapter commit publishes the new state. Revisions increase on successful updates and passphrase recovery. Nested transactions are rejected. The shared process lock atomically publishes a complete PID, random token and start timestamp before admitting a writer. A crashed writer is reclaimed only when the OS reports its PID absent (`ESRCH`); live or reused PIDs, permission failures and unverifiable records are refused. Existing vault `{token,pid}` lock records are supported during migration. An atomic recovery claim serializes contenders for the exact original bytes, which are checked again before removal. Crashed recovery claims advance through at most 32 immutable generations, with two retries for a disappearing claim. Successful recovery removes its claims; interrupted recovery can leave private claim or temporary files, and exhausting the bounds requires inspection after all writers have stopped. Tests that really kill a child process show that reopening and recovery keep the last committed encrypted file snapshot and admit exactly one writer. Power-loss behaviour has not been tested on real hardware. An entire old valid envelope can be replayed by an attacker with disk access; the current implementation does not claim hardware-backed rollback protection.

Backups contain the authenticated encrypted envelope, including both wrapped keys. Restore validates and decrypts before writing to a new empty storage location. Plaintext export requires the explicit `plaintext: true` engine request and is outside encrypted-vault protection. Exported files are never overwritten. Delete removes this authority record and the optional keychain entry, clears the engine key, and closes the writer lock. Independent backups and exports remain under their owners' control; deletion cannot promise physical secure erasure on SSDs or removal of copies outside this subsystem.

## PostgreSQL storage

The desktop app does not use PostgreSQL: its engine always opens the file adapter below. PostgreSQL storage is for the local server outside demo mode (`CHAUSAR_POSTGRES_URL`) and for the experimental hosted server ([venture/hosted.md](venture/hosted.md)).

`PostgresSnapshotAdapter.connect` requires explicit loopback host, port, database, user, password, and vault slot. It dynamically imports the pinned `pg` dependency. No machine default database or shell environment is consulted. All dynamic data uses bound SQL parameters. Each write acquires a PostgreSQL advisory transaction lock and a row lock, checks the previous revision, writes encrypted JSONB, and commits. This prevents two writers from silently losing updates even when their lock directories differ. Existing state is never sent to PostgreSQL as plaintext. The adapter stores routing metadata, revision, and update time in plaintext. There is no adapter for a remote database over TLS.

`scripts/postgres-runtime.mjs` can start a PostgreSQL that someone supplies. Nothing in the app starts it today, and no PostgreSQL ships with any build. Supply absolute paths to bundled `postgres`, `initdb`, and `pg_ctl` binaries, an explicit data directory, a private password file, a user, and a port. It initializes SCRAM authentication, binds only `127.0.0.1`, disables Unix sockets, enables fsync/full-page-writes/synchronous commits, refuses an already occupied port, and stops through bundled `pg_ctl`. It never searches PATH for a PostgreSQL installed on the computer.

```text
node scripts/postgres-runtime.mjs --postgres /bundle/postgres --initdb /bundle/initdb --pg-ctl /bundle/pg_ctl --data /private/pg-data --password-file /private/pg-password --user chausar --port 15432
```

## File storage

The file adapter is what the desktop app uses. It is selected by the name `experimental-file`, and the app tells the owner the storage is a test version. It writes ciphertext to a private temporary file, fsyncs the file, atomically renames it, and fsyncs the directory where supported. Windows directory fsync is not available through the same Node API, so there is no full power-loss guarantee there. Directory and file paths reject symlinks, roots, and relative paths. Filesystem mode bits alone do not certify Windows ACL protection.

An optional trusted `KeychainHook` receives key registration/removal calls; no implementation uses it. Keeping a vault on this computer works differently: the engine puts a random computer secret in the passphrase slot and the operating system keeps that secret for the owner's login (Windows DPAPI, checked on a real Windows 11 computer; macOS Keychain and Linux Secret Service, designed and tested with fake processes only). The envelope format does not change. See [custody.md](custody.md) for the design, what was run and the limits. On 19 October 2026 the app itself was walked with the Windows key store: a business kept with no passphrase opened again after a server restart, the passphrase lock went on and off, and a backup was made and restored. A failed registration rolls back initial creation so a recovery code is never lost behind a failed create response. Ownership of a supplied adapter transfers to the vault, including closing it when validation or unlocking fails. Still not done: a crash and restore test on a real PostgreSQL, a real run of the macOS and Linux key stores, and a check of file permissions on each system. Unit tests exercise real encrypted files, corruption, wrong credentials, serial rollback, subprocess locking, recovery, backup restore, explicit export, and path safety.
