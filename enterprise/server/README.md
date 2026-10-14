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
  end at sign-out, and end as soon as the member is revoked or changed.

## Step 1: run the local build as a server and open it from a browser

Do this on one machine before any container work.

1. Install Node 24.13.1 and run `npm ci` in the repository.
2. Start PostgreSQL on loopback (`127.0.0.1`, port 1024 or higher). The engine refuses
   non-loopback database hosts.
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

```sh
docker build -f enterprise/server/Dockerfile -t chausar-enterprise:dev .
```

The image is `node:24.13.1-bookworm-slim`, runs as user `chausar` (uid 10001), installs
production dependencies only (`npm ci --omit=dev --ignore-scripts`), copies only the paths the
server loads, and has no secrets in it. Its health check calls `/healthz` on port 8443 inside
the container, so keep `listen.port` at 8443 there.

`compose.yaml` runs the server with `postgres:17`. Because the engine accepts only a loopback
database, the server shares the database container's network namespace and PostgreSQL
listens on `127.0.0.1` only. Before `docker compose -f enterprise/server/compose.yaml up`:

- `enterprise/server/config.json`: your configuration, using the container paths from
  `config.example.json`.
- `enterprise/server/tls/`: `fullchain.pem` and `privkey.pem` (`privkey.pem` owned by uid
  10001, mode 0600).
- `enterprise/server/secrets/`: `postgres_password` (owned by uid 999, mode 0400),
  `postgres_url` (`postgres://chausar:<password>@127.0.0.1:5432/chausar`),
  `oidc_client_secret` and `workspace_passphrase` (owned by uid 10001, mode 0600).
  Compose bind-mounts these files with their host owner and mode.

Create the workspace once:
`docker compose -f enterprise/server/compose.yaml run --rm server node enterprise/server/main.ts --init-workspace "Your business name"`.

These paths are ignored by git (`enterprise/server/.gitignore`).

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

The database URL comes from `CHAUSAR_POSTGRES_URL_FILE` (preferred) or `CHAUSAR_POSTGRES_URL`.

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
- CSRF protection (marker header and exact origin), request size limit (2 MB), security
  headers including HSTS, and refusal of local-operator methods over HTTP.

Experimental:

- The Docker image and `compose.yaml` (not built or run in CI).
- `"keychain"` unlock: it needs a native keychain provider, which a container does not have.
- Running more than one server process: sessions live in one process's memory, and a
  restart signs everyone out.

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
