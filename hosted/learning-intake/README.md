# Learning intake service

**Status: written and tested, not deployed.** Label: experimental.

This service receives structure-only learning batches. A Chausar desktop app sends them only after its owner has turned sharing on and consented. The service checks each batch for values and names, stores it, and keeps one credit per accepted event for the contributor. It is deployed on its own. It imports nothing from `platform/` or `app/`. It uses Node built-ins plus `pg@8.23.0`.

- `src/vocabulary.ts` is an identical copy of `platform/runtime/learning-ext/vocabulary.ts`. A test keeps the two the same.
- `src/validate.ts` checks the batch schema and vocabulary, and scans the raw text of the events for values.
- `src/store.ts` holds the `IntakeStore` interface with two implementations: `MemoryIntakeStore` and `PostgresIntakeStore` (parameterised SQL, writes run in transactions).
- `src/server.ts` provides `createIntakeHandler(options)` and `startIntakeServer(options)`.
- `src/main.ts` runs the service locally against PostgreSQL.
- `schema.sql` creates the tables.
- The tests are in `platform/tests/learning-ext-intake.test.ts`.

## API

Every error looks like `{ "error": { "code": "..." } }`. The code is a fixed upper-case word. An error never repeats the request content.

| Request | Success | Errors |
| --- | --- | --- |
| `GET /v1/status` | 200 `{ open, schema: "chausar.learning.v1", boxes: ["setup-shapes","corrections"] }` | |
| `POST /v1/batches` | 201 `{ reference, accepted, credits, replayed: false }`; a replay returns 200 `{ reference, accepted, credits, replayed: true }` | INTAKE_CLOSED 503, UNAUTHORIZED 401, RATE_LIMITED 429, INVALID_BATCH 400, TOO_LARGE 413, VALUE_FOUND 422 (with `hits`), BOX_NOT_OPEN 422, IDEMPOTENCY_CONFLICT 409, NOT_FOUND 404 (replay of a deleted batch) |
| `DELETE /v1/batches/:reference` | 200 `{ deleted: true }` | NOT_FOUND 404, FORBIDDEN 403 |
| `GET /v1/credits` | 200 `{ credits, publicName }` | UNAUTHORIZED 401, RATE_LIMITED 429 |
| `GET /v1/credits/public` | 200 `[{ publicName, credits }]` | |

A wrong method on a known path returns METHOD_NOT_ALLOWED 405. An unknown path returns NOT_FOUND 404. An unexpected failure returns INTERNAL_ERROR 500.

### POST /v1/batches headers

- `content-type: application/json`.
- `authorization: Bearer <token>`. The token is the contributor's 43-character base64url token. The contributor's identity is the token's SHA-256. The token itself is never stored.
- `idempotency-key: <key>`. The key is 1 to 200 characters from `A-Za-z0-9_.:-`.
- `x-deletion-token: <token>`. The client generates this 43-character base64url token. The server stores only its SHA-256, with the batch.

### POST /v1/batches body and checks

The body is `{ "batch": <batch>, "contributor": { "publicName": string | null } }`.

- The scan runs over the raw text of `batch.events`. It refuses GSTIN, PAN, IFSC, UPI ids, mail addresses, Indian phone numbers and any digit, and answers VALUE_FOUND with `hits: [{ line, code }]`.
- Line numbers count from the first line of the batch. Build the body as `{"batch":` + `batchBytes(batch)` + `,"contributor":{...}}` and the line numbers match the lines the desktop shows.
- After the scan, each event may hold only vocabulary keys and tokens. Lists must be sorted and unique, and `fields` must be sorted, unique `[name, type]` pairs.
- A batch holds 1 to 5,000 events. Every box must be open. Naming `account-words` or `question-shapes` returns BOX_NOT_OPEN.
- `publicName` is 2 to 40 letters, spaces, `.`, `-` or `'`, or null. Each new batch replaces the stored name, and null removes the contributor from the public list.

### Idempotency

The service records a digest of the contributor and the canonical body.

- The same key with the same digest is a replay. It returns the original reference and changes nothing. A replay keeps the first deletion-token hash, even if the replay sends a different token.
- The same key with a different body, or from a different contributor, returns IDEMPOTENCY_CONFLICT.

### Deleting a batch

Deleting a batch hard-deletes its events and its credits. The batch row stays, marked deleted, so its idempotency key is never reused.

### Credits and limits

- Each accepted event earns one credit.
- `GET /v1/credits/public` lists only named contributors with credits. It is sorted by credits (highest first), then by name.
- The default body limit is 1 MiB. Change it with `maxBytes`.
- The default rate limit is 30 requests per contributor per minute. Change it with `rateLimit: { max, windowMs }`, or turn it off with `false`.

## Run it locally

```sh
createdb chausar_intake
psql chausar_intake -f hosted/learning-intake/schema.sql
cd hosted/learning-intake
DATABASE_URL=postgres://localhost/chausar_intake INTAKE_OPEN=true PORT=8787 node src/main.ts
```

The service binds to `127.0.0.1` unless `HOST` is set. Without `INTAKE_OPEN=true` it answers INTAKE_CLOSED to every batch.

## Founder boundary

These steps are for the founder, not the build:

- Deployment: hosting, TLS, backups, retention, monitoring and the production database.
- The public domain the desktop app points at.
- A lawyer's review of the consent text before the intake opens.
- That same review before the `account-words` and `question-shapes` boxes are added to `OPEN_BOXES`. Opening a box means changing both vocabulary copies together.
