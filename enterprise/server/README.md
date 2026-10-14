# Chausar enterprise server

The same Chausar engine for many people over HTTPS: OpenID Connect sign-in, workspace
roles and branch scope, and the new UI in a browser.

**Status: experimental. This is not deployed anywhere.** Nothing here has had a production
security or operations review. Treat the Docker image and `compose.yaml` as a starting point
for that review, not as a finished deployment.

## What it does

- Serves the new UI (`/ui/index.html`) and its fonts. The browser shell
  (`enterprise/server/ui/shell.js`) keeps the session in an HttpOnly cookie, never in script.
- Signs people in with OpenID Connect: authorization code flow with PKCE (S256), one-time
  `state` and `nonce` (10 minutes), `client_secret_basic`, and ID tokens checked locally
  (RS256 or ES256 only, key looked up by `kid`, issuer, audience, `azp`, expiry, `iat`, `nbf`
  with 60 seconds of clock skew, and nonce).
- Maps each person to a workspace member using your role rules (first match wins). The
  engine then enforces the role and branch scope on every request. Someone who matches no
  rule is refused (`ENTERPRISE_ROLE_UNMAPPED`).
- Keeps sessions on the server (random 32-byte id; only its SHA-256 is held). They expire,
  end at sign-out, and end as soon as the member is revoked or changed. The production
  entry point (`main.ts`) keeps sessions, sign-ins in progress (state, nonce, PKCE verifier)
  and the sign-in rate limit in PostgreSQL (`chausar_enterprise_sessions`,
  `chausar_enterprise_logins`, `chausar_enterprise_rate_limits`), so a restart keeps people
  signed in and several server processes share them. Tests and embedders that pass no store
  get the same behaviour in one process's memory (`MemoryEnterpriseStore`).
- Reaches PostgreSQL on another host only over verified TLS: the database certificate is
  checked against a CA you pin (`database.caFile`) and the host name (or `database.servername`).
  There is no `sslmode=prefer` and no plaintext fallback; options in the URL are ignored.

## Step 1: run the local build as a server and open it from a browser

Do this on one machine before any container work.

1. Install Node 24.13.1 and run `npm ci` in the repository.
2. Start PostgreSQL (port 1024 or higher). On loopback (`127.0.0.1`) no TLS is needed. On any
   other host, turn on `ssl` in PostgreSQL, allow only `hostssl` lines in `pg_hba.conf`, and
   set `"database": { "caFile": "/path/to/ca.pem" }` in the configuration; without it the server
   refuses to start (`POSTGRES_TLS_REQUIRED`). The desktop app still accepts loopback only.
3. Make a certificate for `localhost`:

   ```sh
   mkdir -p ~/chausar-enterprise/tls && cd ~/chausar-enterprise
   openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -subj /CN=localhost \
     -addext subjectAltName=DNS:localhost -days 30 -keyout tls/privkey.pem -out tls/fullchain.pem
   chmod 600 tls/privkey.pem
   ```

4. Register a client with your identity provider. Redirect URI:
   `https://localhost:8443/auth/callback`. Put the client secret and a workspace passphrase
   in files readable only by you (`chmod 600`), one value per file.
5. Copy `config.example.json` to `~/chausar-enterprise/config.json` and change the paths,
   the `publicOrigin` (`https://localhost:8443`), the issuer, the client id and the role rules.
6. Put the database URL in a private file and create the workspace once. The recovery code
   is printed once; write it down offline.

   ```sh
   export CHAUSAR_ENTERPRISE_CONFIG=~/chausar-enterprise/config.json
   export CHAUSAR_POSTGRES_URL_FILE=~/chausar-enterprise/postgres_url   # postgres://user:password@127.0.0.1:5432/chausar
   node enterprise/server/main.ts --init-workspace "Your business name"
   ```

7. Start the server and open `https://localhost:8443/` in a browser:

   ```sh
   node enterprise/server/main.ts
   ```

The server refuses to start without TLS (`TLS_REQUIRED`), with a private key, client secret
or passphrase file that others can read, or with a secret written inside the configuration
(`ENTERPRISE_INLINE_SECRET`).

## Step 2: Docker (experimental)

Build the image from the repository root. Behind a TLS-intercepting proxy, give the proxy's CA
as a build secret; it is used for `npm ci` only and is not stored in the image.

```sh
docker build -f enterprise/server/Dockerfile -t chausar-enterprise:dev .
# behind a proxy:
docker build --network host --build-arg HTTPS_PROXY --secret id=build_ca,src=/path/to/proxy-ca.pem \
  -f enterprise/server/Dockerfile -t chausar-enterprise:dev .
```

The image is `node:24.13.1-bookworm-slim` (529 MB on disk, 130 MB compressed), runs as user
`chausar` (uid 10001), installs production dependencies only (`npm ci --omit=dev
--ignore-scripts`), copies only the paths the server loads, and has no secrets in it. Its
health check calls `/healthz` on port 8443 inside the container, so keep `listen.port` at 8443.

`compose.yaml` runs the server with `postgres:17`. PostgreSQL accepts TLS only (`pg_hba.conf`
has `hostssl` lines and no plaintext `host` line), sits on an internal network with no route
out, and is never published. The server reaches it as `postgres:5432` and verifies its
certificate against `database-ca.pem`. Before `docker compose -f enterprise/server/compose.yaml up -d`,
put these in `enterprise/server/` (or in the directory named by `CHAUSAR_ENTERPRISE_FILES`):

- `config.json`: your configuration, using the container paths from `config.example.json`,
  including `"database": { "caFile": "/etc/chausar/database-ca.pem" }`.
- `tls/`: `fullchain.pem` and `privkey.pem` for the HTTPS port (`privkey.pem` owned by uid
  10001, mode 0600).
- `database-tls/`: `ca.pem` (the CA), `server.pem` (a certificate for the name `postgres`) and
  `server.key` (owned by uid 999, mode 0600).
- `secrets/`: `postgres_password` (owned by uid 999, mode 0400),
  `postgres_url` (`postgres://chausar:<password>@postgres:5432/chausar`),
  `oidc_client_secret` and `workspace_passphrase` (owned by uid 10001, mode 0600).
  Compose bind-mounts these files with their host owner and mode.

Create the workspace once:
`docker compose -f enterprise/server/compose.yaml run --rm server node enterprise/server/main.ts --init-workspace "Your business name"`.

These paths are ignored by the repository (`enterprise/server/.gitignore`).

### Smoke run

`node enterprise/server/testing/compose-smoke.ts` (as root, after building the image) generates
throw-away CAs, certificates and secrets, starts `compose.yaml` plus
`testing/compose.smoke.yaml` (a fake OpenID provider over HTTPS, test only), creates the
workspace, checks `/healthz` from the host, checks that every Chausar database connection
uses TLS and that a plaintext connection is refused, signs in, calls `/api/me` and two engine
methods, restarts the server and checks the session survived, signs out, and removes every
container, network and volume. It never pushes an image.

## Configuration

Every key is checked; unknown keys are refused. See `config.example.json`.

| Key | Meaning |
|---|---|
| `listen.host`, `listen.port` | Address the HTTPS server binds. |
| `tls.certFile`, `tls.keyFile` | Required, absolute, regular files (not links). The key must not be group or world readable. |
| `publicOrigin` | The exact `https://host[:port]` people use. Requests must carry this `Host`; API calls must carry this `Origin`. |
| `oidc.issuer` | Must be https and must equal the `issuer` in the provider's discovery document exactly. |
| `oidc.clientId`, `oidc.clientSecretFile` | The secret is always a file path, never a value. |
| `oidc.redirectPath` | A path under `/auth/`, such as `/auth/callback`. |
| `oidc.scopes` | Must include `openid`. |
| `roles` | Ordered `{ claim, equals, role, branches }`. A rule matches when the top-level claim equals the value or is an array containing it. `branches` is a list of names, or `["*"]` for all. |
| `allowedEmailDomains` | Optional. When set, the `email` claim must be verified and in one of these domains. |
| `sessionTtlMinutes` | 5 to 1440. |
| `dataDirectory` | Private server state (`identities.json`, mode 0600). |
| `workspace.directory`, `workspace.folder` | Where the engine keeps the workspace. |
| `workspace.unlock` | `{ "passphraseFile": "/path" }` or `"keychain"`. |
| `database.caFile`, `database.servername` | Optional. Verified TLS to PostgreSQL: the pinned CA (PEM) and, when the URL host is not the name in the certificate, that name. Required for a database host other than `127.0.0.1`/`::1`. |

The database URL comes from `CHAUSAR_POSTGRES_URL_FILE` (preferred) or `CHAUSAR_POSTGRES_URL`.
Only its host, port, user, password and database name are used.

## Routes

| Route | Purpose |
|---|---|
| `GET /` | Redirects to `/ui/index.html`. |
| `GET /ui/*`, fonts | The new UI. |
| `GET /auth/login` | Starts sign-in. |
| `GET <redirectPath>` | Finishes sign-in, sets the `__Host-chausar` cookie (HttpOnly, Secure, SameSite=Strict, Path=/). |
| `POST /auth/logout` | Ends the session. |
| `GET /api/me` | The member id, role and branches. |
| `POST /api/rpc` | `{ method, payload }`. Needs the session cookie, `X-Chausar-Request: 1` and `Origin` equal to `publicOrigin`. |
| `GET /healthz` | Liveness for the container health check. |

`/auth/*` is rate limited per client address (60 requests a minute). Behind a reverse proxy
all clients share the proxy's address; the server does not trust forwarded headers.

## Supported and experimental

Supported (tested in `platform/tests/release-enterprise-*.test.ts`):

- OIDC sign-in with PKCE, RS256 and ES256 ID tokens, key rotation (refresh on an unknown key).
- Role rules, branch scope enforced by the engine, refusal of unmapped people and foreign email domains.
- Server-side sessions; sign-out; sessions ending when a member is revoked or changes role.
- Sessions, sign-in state and rate limits shared through PostgreSQL by two server instances
  (`release-enterprise-postgres.test.ts`, run against a real TLS-only PostgreSQL 16).
- Remote PostgreSQL over verified TLS (`release-postgres-tls.test.ts`, a real TLS-only cluster on
  a non-loopback address; wrong CA, wrong name and plaintext are refused).
- CSRF protection (marker header and exact origin), request size limit (2 MB), security
  headers including HSTS, and refusal of local-operator methods over HTTP.

Experimental:

- The Docker image and `compose.yaml`: built and smoke-run on one Linux machine, not in CI.
- `"keychain"` unlock: it needs a native keychain provider, which a container does not have.
- More than one engine on one workspace. Sessions are shared, but the engine is one writer per
  workspace: it holds the workspace in memory and takes a writer lock in the workspace
  directory, so a second engine process would not see the first one's changes and its writes
  would be refused (`REVISION_CONFLICT`). Run one server process per workspace; restarts and
  hand-overs keep sessions.
- Private token search (`PostgresInvestigationSearch`) still accepts a loopback database only,
  so it is unavailable when the database is on another host.

Not available over HTTP (refused with `ENTERPRISE_METHOD_DENIED`): `auth.accept`,
`workspace.create`, `workspace.open`, `workspace.restore`, `workspace.recover`,
`workspace.delete`, `workspace.lock`, `workspace.activation.*`,
`workspace.backup.activation.*`, `updates.*`, `release.*`, `service.*` and `native.*`.
These stay with the local server operator.

## Revocation

When an administrator revokes a member in Chausar, that person's sessions end at once and
signing in again is refused (`ENTERPRISE_MEMBER_REVOKED`) until the identity provider maps
them to a different role or branch list. When the mapping changes, the old member is revoked
and a new one is added.
