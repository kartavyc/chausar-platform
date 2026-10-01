# Authorized private document search

`PostgresInvestigationSearch` searches one complete projection prepared by the trusted host after current investigation, journal, member, source and receipt authorization. It does not discover documents or authorize their disclosure. The host must rebuild or recheck those permissions, document revisions, dictionary and source snapshots before releasing any result. A document digest is a revision pin rather than permission.

```ts
const search = await PostgresInvestigationSearch.connect({
  host: '127.0.0.1', port, user, password, database,
  operationTimeoutMs: 15000, maxConnections: 2,
});
const result = await search.search({
  complete: true, expectedDocuments: documents.length,
  documents: documents.map(({ id, kind, revision, digest, text }) =>
    ({ id, kind, revision, digest, text })),
}, {
  method: 'simple-token-conjunction-v1', query,
  bounds: { maxDocuments: 1000, maxTextBytes: 1048576, maxMatches: 100 },
});
await search.close();
```

The complete assertion belongs to the trusted host. Count equality alone cannot prove that an omitted authorized record does not exist. The port refuses a false completeness flag or mismatching expected count; it never truncates, samples or substitutes an in-process search. Empty authorized projections remain distinguishable from unavailable or failed PostgreSQL search.

The supported method is PostgreSQL `to_tsvector('simple', text) @@ plainto_tsquery('simple', query)`. Plain text is parsed into a conjunction of normalized terms; SQL syntax in a query stays parameter data. This method uses PostgreSQL's simple configuration and parser semantics. It supplies neither stemming, substring matching, ranking nor a general semantic or multilingual recall guarantee. Punctuation with no searchable terms is refused. A no-match result means no match under this declared token method within the supplied authorized projection, rather than universal absence of evidence or a supported business conclusion.

Every request declares document, UTF-8 text byte and match limits. Supported ceilings are 10,000 documents, 8 MiB aggregate text, 10,000 matches and 4 KiB query text. Unknown configuration, duplicate identities, malformed kinds/revisions/digests, invalid UTF-8 strings, oversized complete projections and unsupported methods fail before connection acquisition. The query fetches at most `maxMatches + 1`; overflow fails with `SEARCH_MATCH_LIMIT` instead of returning an incomplete shortlist. Returned metadata omits document text and includes matched identities, kinds, revisions and digests, the method and query digest, the complete sorted projection digest, explicit bounds and a completeness record.

The native constructor imports the pinned `pg` driver, owns its pool and independently checks the actual PostgreSQL database, literal loopback address, explicit unprivileged port and server version. Results carry `engine: 'postgres'` and that server identity. `fromPool()` is a managed-pool injection port; its results always carry `engine: 'injected-sql'` and a null server identity, regardless of the supplied pool's behavior.

Statements use a private temporary table and prepared values. Transaction-local `pg_temp` search path and statement, lock and idle transaction deadlines constrain the operation. Acquisition, initialization, inserts, matching and rollback share one deadline; late or interrupted clients are discarded. Rollback removes the temporary projection, and closing the port interrupts its active work and closes only its owned pool. There is no persistent plaintext search index. This normal transactional behavior does not establish crash, power-loss, memory erasure or installed-runtime acceptance.

The focused suite uses injected pools to check validation, prepared query boundaries, completeness pins, overflow, empty terms, rollback, failures, late clients and interrupted shutdown. It is protocol evidence only. Actual native acceptance is a separate hard gate in `scripts/verify-investigations-native.mjs`, run only against a fresh disposable synthetic PostgreSQL database by the existing operator supervisor. Missing database configuration or missing integration seams must fail that gate. Existing verified D: tools remain read-only; the supervisor owns fresh C: data, temporary files, traces and shutdown. Neither source tests nor a prepared gate establish completed native acceptance.

This implements bounded parts of full-plan 22.11 and 22.12: declared permitted scope, method, readiness, explicit limits, complete matching under that method and governed result release. Interpretation, context-complete fragments, general recall quality, live providers, vendor profiles, enterprise services and release qualification remain separate requirements.
