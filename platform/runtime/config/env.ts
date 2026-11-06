// D11: one place for each flag. Every CHAUSAR_* environment variable the code reads (or sets for a child process it
// starts): what it means, its default, and who reads it. scripts/env-docs.mjs writes .env.example (the names someone
// running Chausar from source may set) and docs/configuration.md (all of them) from this list, and its --check fails
// when source names a CHAUSAR_* variable that is not here. Adding a flag: add its entry, then `node scripts/env-docs.mjs
// --write`. This file only describes; each reader still reads its own variable.

/** Who reads a variable. desktop: Electron main; worker: the desktop's engine process; server: the local web server;
 * hosted: the hosted server; engine: any engine host; child: a process Chausar starts and gives it to; scripts: build,
 * test and release scripts; ci: the GitHub workflows. */
export const ENV_READERS = ['desktop', 'worker', 'server', 'hosted', 'engine', 'child', 'scripts', 'ci'] as const;
export type EnvReader = typeof ENV_READERS[number];

export type EnvEntry = {
  name: string;
  meaning: string;
  /** What happens when it is unset, in words. */
  default: string;
  readers: readonly EnvReader[];
  /** Listed in .env.example: someone running Chausar from source may set it. */
  example?: boolean;
  /** A secret: never given a value in .env.example or the docs. */
  secret?: boolean;
};

/** Code constants whose names start CHAUSAR_ but are not environment variables. */
export const NOT_ENV = ['CHAUSAR_USER_AGENT', 'CHAUSAR_YOUTUBE'] as const;

/** The prefix desktop-package.mjs and feedback-keys.cjs strip or copy as a group (the three entries below). */
export const ENV_PREFIXES = ['CHAUSAR_FEEDBACK_'] as const;

export const ENV: readonly EnvEntry[] = [
  { name: 'CHAUSAR_AGENT_API_KEY', meaning: 'The owner\'s API key, handed to a Codex agent run that uses a key connection instead of a sign-in.', default: 'Unset: Codex uses its own sign-in.', readers: ['child'], secret: true },
  { name: 'CHAUSAR_AGENT_MCP_SOCKET', meaning: 'The local socket the agent\'s MCP bridge connects to, set by the engine for the bridge it starts.', default: 'Set by the engine; the bridge refuses to start without it.', readers: ['child'] },
  { name: 'CHAUSAR_AGENT_MCP_TOKEN', meaning: 'The one-run token the MCP bridge presents to the engine, set by the engine for the bridge it starts.', default: 'Set by the engine; the bridge refuses to start without it.', readers: ['child'], secret: true },
  { name: 'CHAUSAR_ALLOW_REPO_DATA', meaning: 'Set to 1 to allow a data folder or run output inside the code folder (for one-off debugging only).', default: 'Unset: a data folder or output inside the checkout is refused (DATA_INSIDE_REPO).', readers: ['engine', 'scripts'] },
  { name: 'CHAUSAR_APP_REVIEWED', meaning: 'Comma-separated ids of the platform app reviews this install has passed, so their posting connectors may write.', default: 'Unset: no app review is recorded; those connectors stay read-only or hand-off.', readers: ['engine'] },
  { name: 'CHAUSAR_AUTO_BACKUPS', meaning: 'Set to off to stop the automatic encrypted backups of each business.', default: 'Unset: automatic backups are on.', readers: ['engine'], example: true },
  { name: 'CHAUSAR_BENCH_FREE_BYTES', meaning: 'A stand-in free-space number for bench.mjs, read by that script only, so its own test can fake it.', default: 'Unset: the bench measures the temp drive.', readers: ['scripts'] },
  { name: 'CHAUSAR_BROWSER_PROFILES', meaning: 'The folder that holds the per-platform browser sign-in profiles.', default: 'Unset: ~/.chausar/browser-sessions.', readers: ['engine'], example: true },
  { name: 'CHAUSAR_CLAUDE_CODE_TERMS', meaning: 'Set to pending to turn the Claude Code way off until its terms are accepted.', default: 'Unset: Claude Code is available.', readers: ['engine'], example: true },
  { name: 'CHAUSAR_CODEX_BUNDLE_DIR', meaning: 'The folder of the Codex shipped with the desktop app, set by the desktop for the engine.', default: 'Unset: no bundled Codex; only the owner\'s own Codex is used.', readers: ['desktop', 'engine'] },
  { name: 'CHAUSAR_CODEX_CLI_EVIDENCE_FILE', meaning: 'An operator-supplied manifest of a reviewed Codex command-line setup (paired with its SHA-256).', default: 'Unset: the recorded setups in the trust folder are used.', readers: ['engine'] },
  { name: 'CHAUSAR_CODEX_CLI_EVIDENCE_SHA256', meaning: 'The SHA-256 of the manifest named by CHAUSAR_CODEX_CLI_EVIDENCE_FILE.', default: 'Unset: as above.', readers: ['engine'] },
  { name: 'CHAUSAR_CODEX_TRUST_DIR', meaning: 'The folder where recorded Codex setups are kept, set by the desktop for the engine.', default: 'Unset: no recorded setup can be kept.', readers: ['desktop', 'engine'] },
  { name: 'CHAUSAR_DEMO', meaning: 'Set to 1 by the desktop when it runs the demo business.', default: 'Unset or 0: the real data folder.', readers: ['desktop', 'worker', 'scripts'] },
  { name: 'CHAUSAR_DEVICE_KEYS', meaning: 'Set to none to keep vault keys out of the computer\'s protected storage and ask for a passphrase instead.', default: 'Unset: the computer\'s protected storage keeps each vault key.', readers: ['engine'], example: true },
  { name: 'CHAUSAR_ENGINE_VERSION', meaning: 'The app version the engine reports, set by the desktop from its package.', default: 'Unset: the engine reports no version.', readers: ['desktop', 'worker', 'engine', 'scripts'] },
  { name: 'CHAUSAR_FEEDBACK_POSTHOG_HOST', meaning: 'The PostHog host a build ships for owner-approved feedback, read when packaging.', default: 'Unset: the build ships no feedback keys.', readers: ['desktop', 'engine', 'scripts'] },
  { name: 'CHAUSAR_FEEDBACK_POSTHOG_KEY', meaning: 'The PostHog project key a build ships for owner-approved feedback, read when packaging.', default: 'Unset: the build ships no feedback keys.', readers: ['desktop', 'engine', 'scripts'], secret: true },
  { name: 'CHAUSAR_FEEDBACK_SENTRY_DSN', meaning: 'The Sentry address a build ships for owner-approved crash reports, read when packaging.', default: 'Unset: the build ships no crash report address.', readers: ['desktop', 'engine', 'scripts'], secret: true },
  { name: 'CHAUSAR_HOME', meaning: 'The data home: a local server or worker keeps its data in CHAUSAR_HOME/<kind>.', default: 'Unset: the per-user folder (on Windows %LOCALAPPDATA%\\Chausar\\dev\\<kind>).', readers: ['server', 'hosted', 'engine', 'scripts'], example: true },
  { name: 'CHAUSAR_HOSTED', meaning: 'Set to 1 to start the experimental hosted server (or pass --hosted).', default: 'Unset: hosted mode is off.', readers: ['hosted'] },
  { name: 'CHAUSAR_HOSTED_AI_CEILING_MICROS', meaning: 'The hosted server\'s monthly AI spend ceiling per account, in micro US dollars.', default: 'Unset: the built-in ceiling.', readers: ['hosted'] },
  { name: 'CHAUSAR_HOSTED_BUSINESSES_PER_ACCOUNT', meaning: 'How many businesses one hosted account may keep.', default: 'Unset: the built-in number.', readers: ['hosted'] },
  { name: 'CHAUSAR_HOSTED_CUSTODY_KEY', meaning: 'The hosted server\'s master key (32 random bytes, base64url) that opens every vault on it.', default: 'Unset: refused, except in --dev.', readers: ['hosted'], secret: true },
  { name: 'CHAUSAR_HOSTED_DATA', meaning: 'The hosted server\'s data folder.', default: 'Unset: CHAUSAR_HOME/hosted, else the per-user folder.', readers: ['hosted'] },
  { name: 'CHAUSAR_HOSTED_LISTEN', meaning: 'The address the hosted server listens on.', default: 'Unset: 127.0.0.1.', readers: ['hosted'] },
  { name: 'CHAUSAR_HOSTED_MAILER', meaning: 'How the hosted server sends sign-in mail.', default: 'Unset: dev-outbox in --dev, else none.', readers: ['hosted'] },
  { name: 'CHAUSAR_HOSTED_ORIGIN', meaning: 'The hosted server\'s public https address, like https://app.example.com.', default: 'Unset: refused, except in --dev (http://localhost:4320).', readers: ['hosted'] },
  { name: 'CHAUSAR_HOSTED_PORT', meaning: 'The hosted server\'s port.', default: 'Unset: the origin\'s port, else 4320 in --dev, else 8443.', readers: ['hosted'] },
  { name: 'CHAUSAR_HOSTED_POSTGRES_URL', meaning: 'The hosted server\'s PostgreSQL address on loopback, when its storage is postgres.', default: 'Unset: refused when the storage is postgres.', readers: ['hosted'], secret: true },
  { name: 'CHAUSAR_HOSTED_PUSH', meaning: 'Set to 0 to turn off phone alerts by web push on the hosted server.', default: 'Unset: on.', readers: ['hosted'] },
  { name: 'CHAUSAR_HOSTED_PUSH_CONTACT', meaning: 'The mailto: or https: contact that web push services see.', default: 'Unset: the server\'s https origin.', readers: ['hosted'] },
  { name: 'CHAUSAR_HOSTED_STORAGE', meaning: 'Where the hosted server keeps businesses: experimental-file or postgres.', default: 'Unset: experimental-file.', readers: ['hosted'] },
  { name: 'CHAUSAR_HOSTED_TLS_CERT', meaning: 'The hosted server\'s TLS certificate file (set with CHAUSAR_HOSTED_TLS_KEY).', default: 'Unset: an https origin needs a TLS proxy instead.', readers: ['hosted'] },
  { name: 'CHAUSAR_HOSTED_TLS_KEY', meaning: 'The hosted server\'s TLS key file (set with CHAUSAR_HOSTED_TLS_CERT).', default: 'Unset: as above.', readers: ['hosted'], secret: true },
  { name: 'CHAUSAR_HOSTED_TLS_PROXY', meaning: 'Set to 1 when a TLS proxy stands in front of the hosted server.', default: 'Unset: an https origin needs a certificate.', readers: ['hosted'] },
  { name: 'CHAUSAR_HOSTED_TRIALS', meaning: 'Set to 1 or 0: whether people may start a hosted trial without an account.', default: 'Unset: off, on in --dev.', readers: ['hosted'] },
  { name: 'CHAUSAR_HOSTED_TRIALS_LIVE', meaning: 'How many hosted trials may run at once (1 to 100000).', default: 'Unset: the built-in number.', readers: ['hosted'] },
  { name: 'CHAUSAR_HOSTED_TRIAL_AI_CEILING_MICROS', meaning: 'The AI spend ceiling of one hosted trial, in micro US dollars.', default: 'Unset: the built-in ceiling.', readers: ['hosted'] },
  { name: 'CHAUSAR_HOSTED_TRIAL_IDLE_DAYS', meaning: 'Days a hosted trial may sit unused before it is removed (1 to 30).', default: 'Unset: the built-in number.', readers: ['hosted'] },
  { name: 'CHAUSAR_HOSTED_TRIAL_VAULT_BYTES', meaning: 'The largest vault one hosted trial may keep, in bytes (1 MB to 256 MB).', default: 'Unset: the built-in size.', readers: ['hosted'] },
  { name: 'CHAUSAR_HOSTED_TRUST_PROXY', meaning: 'How many trusted proxies stand in front of the hosted server (true means 1).', default: 'Unset: 0, the socket address is the client.', readers: ['hosted'] },
  { name: 'CHAUSAR_INK_ROOT', meaning: 'The absolute folder of the built Ink app, set by the desktop for the engine\'s web host.', default: 'Unset: app/ui/dist beside the source.', readers: ['desktop', 'engine'] },
  { name: 'CHAUSAR_JOB_LEASE_MS', meaning: 'The lease of a typed background job, in milliseconds (with the other two job variables).', default: 'Unset: typed jobs are off in that process.', readers: ['engine'] },
  { name: 'CHAUSAR_JOB_MAX_ACTIVE', meaning: 'How many typed background jobs run at once (with the other two job variables).', default: 'Unset: typed jobs are off in that process.', readers: ['engine'] },
  { name: 'CHAUSAR_JOB_WORKER_ID', meaning: 'The id this process uses to lease typed background jobs (with the other two job variables).', default: 'Unset: typed jobs are off in that process.', readers: ['engine'] },
  { name: 'CHAUSAR_PERF_STAND_IN', meaning: 'A JSON file of stand-in measures for perf-budgets.mjs, read by that script only, so its test runs no measure.', default: 'Unset: the real measures run.', readers: ['scripts'] },
  { name: 'CHAUSAR_PORT', meaning: 'The local web server\'s port.', default: 'Unset: 4317.', readers: ['server'], example: true },
  { name: 'CHAUSAR_POSTGRES_URL', meaning: 'The local server\'s PostgreSQL address, for real (non-demo) storage.', default: 'Unset: real storage cannot start; the demo uses file storage.', readers: ['server'], example: true, secret: true },
  { name: 'CHAUSAR_PRIVATE_DIR', meaning: 'Where the private repository is checked out, for the screenshot walk\'s --publish.', default: 'Unset: ../chausar-private beside this checkout.', readers: ['scripts'] },
  { name: 'CHAUSAR_PUBLIC_URL', meaning: 'The hosted server\'s own public origin, used for client share links.', default: 'Unset: share links get no address.', readers: ['hosted', 'engine'] },
  { name: 'CHAUSAR_PYTHON', meaning: 'The Python the analytics helper runs with.', default: 'Unset: the desktop sets its bundled Python; the local server finds none.', readers: ['desktop', 'server', 'worker'], example: true },
  { name: 'CHAUSAR_RELEASE_KEY', meaning: 'The Ed25519 private key that signs the update feed, an Actions secret the release workflow writes to a private runner temp file for scripts/release-feed.mjs.', default: 'Unset: the release workflow stops before the feed is signed.', readers: ['ci'], secret: true },
  { name: 'CHAUSAR_RELEASE_PRIVATE_KEY_FILE', meaning: 'The file holding the release signing private key, read by the packaging preflight.', default: 'Unset: refused where a signed release is asked for.', readers: ['scripts'], secret: true },
  { name: 'CHAUSAR_RELEASE_PUBLIC_KEY_FILE', meaning: 'The file holding the release signing public key, read by the packaging preflight.', default: 'Unset: refused where a signed release is asked for.', readers: ['scripts'] },
  { name: 'CHAUSAR_RUN_ROOT', meaning: 'Where test receipts, perf budgets and the screenshot walk write.', default: 'Unset: <temp>/chausar-runs/<date>-<name>.', readers: ['engine', 'scripts', 'ci'], example: true },
  { name: 'CHAUSAR_SITE_FOLDER', meaning: 'The absolute folder of the owner\'s website on this computer, which staged site edits apply to.', default: 'Unset: no site folder; site edits stay staged.', readers: ['engine'] },
  { name: 'CHAUSAR_TEST_DATABASE_DISPOSABLE', meaning: 'Set to 1 to confirm the database-differential check may use a fresh, disposable local database.', default: 'Unset: that check refuses to run.', readers: ['scripts'] },
  { name: 'CHAUSAR_TEST_DATABASE_URL', meaning: 'The disposable local PostgreSQL address for the database-differential check.', default: 'Unset: that check refuses to run.', readers: ['scripts'], secret: true },
  { name: 'CHAUSAR_UPDATES_DIRECTORY', meaning: 'The folder for the daily update check: its state, the staged installer and the log. The desktop sets it inside its user data folder.', default: 'Unset: no daily update check runs.', readers: ['desktop', 'worker'] },
  { name: 'CHAUSAR_UPDATE_CHANNEL', meaning: 'Which release channel the daily check reads, beta or stable.', default: 'Unset: the channel the owner kept, else the build\'s own.', readers: ['desktop', 'worker'] },
  { name: 'CHAUSAR_UPDATE_FEED', meaning: 'The address of the signed update feed, from the build\'s package.json.', default: 'Unset: updates read as not set up.', readers: ['desktop', 'worker'] },
  { name: 'CHAUSAR_UPDATE_PUBLIC_KEY', meaning: 'The publisher\'s PEM public key that update feeds are checked against; never taken from a model.', default: 'Unset: updates are not checked or offered.', readers: ['engine', 'scripts'], example: true },
  { name: 'CHAUSAR_VAULT_DIRECTORY', meaning: 'The folder that holds the business vaults; the desktop sets it to its own user data folder.', default: 'Unset: the data home (CHAUSAR_HOME/<kind>, else the per-user folder); a hand-started worker refuses.', readers: ['desktop', 'worker', 'server', 'engine', 'scripts'], example: true },
  { name: 'CHAUSAR_VENTURE_GITHUB_REPLAY', meaning: 'A recorded GitHub answers file for the demo, used only with replay on.', default: 'Unset: no GitHub replay.', readers: ['hosted', 'engine'] },
  { name: 'CHAUSAR_VENTURE_MODEL_REPLAY', meaning: 'A recorded AI answers file for the demo, used only with replay on.', default: 'Unset: no AI replay.', readers: ['hosted', 'engine'] },
  { name: 'CHAUSAR_VENTURE_REPLAY', meaning: 'Set to 1 (or pass --replay) in demo or --dev mode to answer from the recorded files.', default: 'Unset: off.', readers: ['hosted', 'engine'] },
  { name: 'CHAUSAR_VENTURE_RUNTIME', meaning: 'Which venture runtime the hosted server uses; only local exists.', default: 'Unset: local.', readers: ['hosted'] },
  { name: 'CHAUSAR_WINDOWS_PUBLISHER', meaning: 'The certificate name a Windows installer must be signed with before it may run by itself.', default: 'Unset: a Windows owner gets Show installer; nothing runs by itself.', readers: ['desktop', 'worker'] },
];
