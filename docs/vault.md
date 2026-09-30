# Encrypted authority vault

`Vault` implements `StateStore`. Its unlocked state and AES key are private engine fields; reads return detached copies. The renderer never receives a raw key. Callers must authorize an operation before invoking the vault because this subsystem provides storage protection, not member authorization.

Every authority snapshot uses AES-256-GCM with a fresh 96-bit nonce. Authenticated associated data binds the format, vault ID, revision, and both key wrappers. A random 256-bit data encryption key is independently wrapped by a passphrase and by a random recovery code. Each wrapper uses its own 128-bit salt, fixed scrypt N=32768/r=8/p=1, and AES-GCM. Untrusted envelope fields cannot increase KDF work. The recovery code appears only in the successful create response; print it in the engine-mediated setup flow and keep it outside the computer.

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

State updates run in one serial queue. Each callback sees a detached draft; failures leave the in-memory committed state untouched. Only a durable adapter commit publishes the new state. Revisions increase on successful updates and passphrase recovery. Nested transactions are rejected. The shared process lock atomically publishes a complete PID, random token and start timestamp before admitting a writer. A crashed writer is reclaimed only when the OS reports its PID absent (`ESRCH`); live or reused PIDs, permission failures and unverifiable records are refused. Existing vault `{token,pid}` lock records are supported during migration. An atomic recovery claim serializes contenders for the exact original bytes, which are checked again before removal. Crashed recovery claims advance through at most 32 immutable generations, with two retries for a disappearing claim. Successful recovery removes its claims; interrupted recovery can leave private claim or temporary files, and exhausting the bounds requires inspection after all writers have stopped. Real killed-child tests prove reopening and recovery preserve the last committed encrypted file snapshot and admit exactly one writer. Production PostgreSQL and hardware power-loss behavior still require native qualification. An entire old valid envelope can be replayed by an attacker with disk access; the current implementation does not claim hardware-backed rollback protection.

Backups contain the authenticated encrypted envelope, including both wrapped keys. Restore validates and decrypts before writing to a new empty storage location. Plaintext export requires the explicit `plaintext: true` engine request and is outside encrypted-vault protection. Exported files are never overwritten. Delete removes this authority record and the optional keychain entry, clears the engine key, and closes the writer lock. Independent backups and exports remain under their owners' control; deletion cannot promise physical secure erasure on SSDs or removal of copies outside this subsystem.

## Production PostgreSQL storage

`PostgresSnapshotAdapter.connect` requires explicit loopback host, port, database, user, password, and vault slot. It dynamically imports the pinned `pg` dependency. No machine default database or shell environment is consulted. All dynamic data uses bound SQL parameters. Each write acquires a PostgreSQL advisory transaction lock and a row lock, checks the previous revision, writes encrypted JSONB, and commits. This prevents two writers from silently losing updates even when their lock directories differ. Existing state is never sent to PostgreSQL as plaintext. The adapter stores routing metadata, revision, and update time in plaintext. Enterprise remote database transport requires a future explicit TLS-capable deployment adapter.

Launch a shipped PostgreSQL runtime with `scripts/postgres-runtime.mjs`. Supply absolute paths to bundled `postgres`, `initdb`, and `pg_ctl` binaries, an explicit data directory, a private password file, a user, and a port. It initializes SCRAM authentication, binds only `127.0.0.1`, disables Unix sockets, enables fsync/full-page-writes/synchronous commits, refuses an already occupied port, and stops through bundled `pg_ctl`. It never searches PATH for a developer PostgreSQL installation. Packaging must ship audited platform-specific binaries; none are bundled by these source files.

```text
node scripts/postgres-runtime.mjs --postgres /bundle/postgres --initdb /bundle/initdb --pg-ctl /bundle/pg_ctl --data /private/pg-data --password-file /private/pg-password --user chausar --port 15432
```

The file adapter is available only when explicitly selecting `experimental-file`. It writes ciphertext to a private temporary file, fsyncs the file, atomically renames it, and fsyncs the directory where supported. Windows directory fsync is not available through the same Node API; full power-loss guarantees need packaged PostgreSQL validation. Directory and file paths reject symlinks, roots, and relative paths. Filesystem mode bits alone do not certify Windows ACL protection.

An optional trusted `KeychainHook` receives key registration/removal calls. No native keychain implementation is bundled or claimed verified. Passphrase protection remains required. A failed registration rolls back initial creation so a recovery code is never lost behind a failed create response. Ownership of a supplied adapter transfers to the vault, including closing it when validation or unlocking fails. Production release still needs real PostgreSQL crash/restore testing, keychain integration, signed runtime packaging, and OS-specific permissions verification. Unit tests exercise real encrypted files, corruption, wrong credentials, serial rollback, subprocess locking, recovery, backup restore, explicit export, and path safety.
