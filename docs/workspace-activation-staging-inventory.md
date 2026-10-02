# PostgreSQL activation staging inventory

The installed PostgreSQL profile supplies a constructor-only `WorkspaceActivationStagingInventory` capability to backup inventory. It binds the actual source Vault, independently held native journal Vault and canonical application directory. `.workspace-activation-control` cannot be admitted with a generic outside-namespace declaration.

Before staged contents are opened, custody authenticates the source-issued reservation, attempt, paired candidate claim, single-use ledger, complete encrypted manifest, immutable publication payloads and physical attempt generation. The inventory then checks every name and type across the entire staging tree and the relevant reserved target. Unknown attempts, unlisted files, links, replacement, incomplete moves and budget overflow refuse.

While the journal remains prepared, exactly two complete layouts are admitted:

| Source guard | Staging files | Reserved target files |
| --- | --- | --- |
| Before filesystem publication | Complete issued manifest | Empty |
| After filesystem publication | Empty, with exact retained directory skeleton | Complete issued manifest |

Every measured issued file must retain its exact singly linked physical generation, size and ciphertext hash. Both complete layouts and the current source/journal bindings are checked again. Count, byte and depth limits apply across the combined inventory; a second independent budget does not expand custody.

Prepared custody remains unresolved. Inventory never promotes it to committed, authorizes an Engine, retries an activation, adopts an uncertain identity or chooses a database backend. Committed staging retains an empty exact directory skeleton. Current target growth is governed by the existing declared target and independent current-live/native admission, not a stale initial staging manifest.

The optional constructor observer `onActivationDiagnostic` emits only safe Local source-guard metadata: a closed stage, whether this invocation's filesystem publication loop has started, and an explicitly allowlisted error code. It forwards no IDs, context, messages, stacks, SQL text, credentials or payloads. Observer failures cannot affect custody. The Host also supports safe stage diagnostics through its constructor. Public `ACTIVATION_COMMIT_UNKNOWN`, explicit readback and single-use behavior remain unchanged, including provable prepublication refusals after an attempt has begun.

The source repair follows the independent e7bb91b diagnostic: one activation submission, no replay, `BACKUP_INVENTORY_INCOMPLETE` for the unclassified activation control, prepared SQL custody, no target authority or physical publication, and no SQL publish call. The original attempted identity must not be reused. Source protocol tests exercise real Vault encryption and filesystem custody with explicitly injected SQL. Native qualification requires a fresh bounded independent run on the exact repaired tree.

The staging leaf keeps a complete authenticated journal capture before the callback and another complete capture at the final current-custody fence. Between them, it rereads only the exact WAL ledger, local attempts, paired candidate claims and prepared/committed bootstrap/evidence dependencies needed to bind the staging manifest. Every dependency must resolve against an actual captured ref and retain its independently authenticated identity. Unrelated artifacts still participate in both complete authentication, byte accounting and ciphertext-hash fences.

This middle-pass cache lasts only for one dependency interpretation. It is never retained across inventory calls or indexed by State revision: trusted inert artifact writes can leave that revision unchanged. Native currentness checks, source/reservation guards, filesystem preflight and all budgets are unchanged. With N journal artifacts and K distinct required WAL refs, the default callback now performs 2N + K artifact authentication passes instead of 3N; explicit current-custody calls still perform their complete captures. This is a source operation-count reduction, not a measured native latency improvement. Independent profiling and bounded public activation/reopen acceptance remain required.
