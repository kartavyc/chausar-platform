// Chausar venture launcher, connection checks (Ink v2 wave 4, package 4J7, catalogue K7). venture.connectors.check {}
// makes one cheap real read per connection this business has, and answers a row each: answered, failed or skipped
// with its reason, and never a secret.
// - An AI key: the provider's model list (GET /v1/models), which is free, through the network guard. A key the app no
//   longer holds is not asked about: the shelf is memory only, so the row says to paste it again.
// - Claude Code or Codex on this computer: a fresh look at the tool and its own status (4H1, models/cli-status.ts);
//   "signed in" only with the tool's own word for it.
// - The bank account: no bank provider is linked, so a consent reads nothing; its row is skipped and says so.
// - TallyPrime: read only through the back office's Sources, so its row is skipped with the day it was last read.
// - The mailbox: sign in and EXAMINE the inbox, read only, then log out (network/imap.ts); "Connected as" the address.
// - The private calendar address (4E3): one read of it, no redirect followed.
// - Posting through the owner's browser: the day the posting steps last worked (build/posting-steps.ts).
// - GitHub: one read of the followed repo's page. A synthetic recording proves nothing, so it is skipped.
// What can't run here (the mailbox, the calendar, TallyPrime and the CLI on the hosted server) is skipped and says so. The rows are stored as a
// venture-connector-check record with Keeper's connection-checks run (one record per job, keeper.ran emitted). Setup
// health counts Ready (answered, nothing to do), Warnings (an end date near, or a skip the owner can fix) and Blocking
// (failed), each with its one-sentence fix. A routine (4J13) can't be switched on for a connector never checked:
// requireConnectorChecked answers ROUTINE_NEEDS_CHECK.
import { authorize, check, ChausarError, type Context, type State } from '../../contracts.ts';
import { DELEGATE_CLIS } from '../contracts.ts';
import type {
  ConnectorCheckRecord, ConnectorCheckRow, ConnectorChecksView, DelegateCli, IsoDate, KeeperRunRecord, ModelPresetId, VentureDeps, VentureRecord,
} from '../contracts.ts';
import { exactPayload, formatVentureDate, listRecords, readVenture, ventureAction } from '../records.ts';
import { guardedFetch } from '../core/net-guard.ts';
import { anthropicHeaders } from '../models/anthropic.ts';
import { openaiHeaders } from '../models/openai.ts';
import { presetSpec } from '../models/presets.ts';
import { cliStatusView, lastCliTask } from '../models/cli-status.ts';
import { consentStatus } from './bank.ts';
import { latestFollow, secretNameFor } from './github.ts';
import { BROWSER_SCRIPTS } from './browser.ts';
import { stepsCheckedOnOf, stepsRecordOf } from './posting-steps.ts';
import { HOSTED_MAILBOX, mailboxOf, PASSWORD_AGAIN } from '../network/mailbox.ts';
import { openMailbox } from '../network/imap.ts';
import { CALENDAR_WORDS, HOSTED_CALENDAR, calendarFeedOf, calendarUrl } from '../network/calendar-feed.ts';
import { MAX_IMPORT_BYTES } from '../network/import.ts';
import { ENDPOINTS } from '../models/types.ts';
import { latestCheck } from './connector-truth.ts';

/** How long one check's read may take: each is one small request. */
export const CHECK_TIMEOUT_MS = 15_000;
export const CHECK_WORDS = Object.freeze({
  nothing: 'Nothing is connected yet, so there was nothing to check.',
  recording: 'Chausar is reading a synthetic recording here, not your GitHub, so there is nothing real to check.',
  replay: 'Chausar is answering from a synthetic recording here, not your AI provider, so there is nothing real to check.',
  keyGone: 'Chausar keeps your key only while the app is open, so it has none to check now.',
  keyFix: 'Paste the key again under Connections, Your AI.',
  hostedCli: 'Claude Code and Codex run only in the desktop app, so the hosted app checks nothing here.',
  noBank: 'No bank provider is linked; the consent is kept for when one is.',
  tally: 'Chausar reads TallyPrime only when you read it under Sources, so this check does not reach it on its own.',
  hostedTally: 'TallyPrime runs on your computer, so the hosted app cannot reach it.',
});
type Probe = { connectorId: string; name: string; run: () => Promise<Omit<ConnectorCheckRow, 'connectorId' | 'name'>> };
type Result = Omit<ConnectorCheckRow, 'connectorId' | 'name'>;
const answered = (line: string, extra: Partial<Result> = {}): Result => ({ outcome: 'answered', line, account: null, expiresOn: null, fix: null, ...extra });
const failed = (line: string, fix: string, extra: Partial<Result> = {}): Result => ({ outcome: 'failed', line, account: null, expiresOn: null, fix, ...extra });
const skipped = (line: string, fix: string | null = null): Result => ({ outcome: 'skipped', line, account: null, expiresOn: null, fix });

/** A Chausar refusal's own words; anything else in plain words, never a stack or a path. */
const wordsOf = (error: unknown, fallback: string) => error instanceof ChausarError ? error.message : fallback;

/** One AI key connection: the provider's free model list, with the key in its header and nowhere else. */
function keyProbe(deps: VentureDeps, ctx: Context, presetId: ModelPresetId): Probe {
  const spec = presetSpec(presetId);
  const name = spec.label;
  return {
    connectorId: `model:${presetId}`, name,
    run: async () => {
      if (deps.models.status(ctx).replay.active) return skipped(CHECK_WORDS.replay);
      const key = deps.secrets.get(`model:${presetId}` as never);
      if (!key) return failed(CHECK_WORDS.keyGone, CHECK_WORDS.keyFix);
      const anthropic = spec.kind === 'anthropic-messages';
      // The provider's own origin, from the endpoint the connection sends to (models/types.ts ENDPOINTS).
      const url = new URL('/v1/models', ENDPOINTS[anthropic ? 'anthropic-messages' : 'openai-responses']).href;
      const headers = anthropic ? anthropicHeaders(key) : openaiHeaders(key);
      delete headers['content-type'];
      let status: number;
      try {
        status = (await guardedFetch({ url, method: 'GET', headers, timeoutMs: CHECK_TIMEOUT_MS, maxBytes: 1_000_000, maxRedirects: 0 }, { resolve: deps.net?.resolve, send: deps.net?.send })).status;
      } catch (error) {
        return failed(`Chausar could not reach ${anthropic ? 'Anthropic' : 'OpenAI'}: ${wordsOf(error, 'the request did not finish.')}`, 'Check this computer is online, then run the check again.');
      }
      const provider = anthropic ? 'Anthropic' : 'OpenAI';
      if (status === 200) return answered(`Your ${name} key answered. Listing its models is free, so this check cost nothing.`);
      if (status === 401 || status === 403) return failed(`${provider} refused the key.`, `Make a new key in your ${provider} account and paste it under Connections, Your AI.`);
      if (status === 429) return failed(`${provider} said the key is asking too often right now.`, 'Wait a few minutes, then run the check again.');
      return failed(`${provider} answered with HTTP ${status}, which does not say the key works.`, 'Run the check again later.');
    },
  };
}

const CLI_OF: Readonly<Partial<Record<ModelPresetId, DelegateCli>>> = Object.freeze({ 'claude-code-cli': 'claude-code', 'codex-cli': 'codex' });

/** Claude Code or Codex: a fresh look, and signed in only on the tool's own word. */
function cliProbe(deps: VentureDeps, state: State, venture: VentureRecord, presetId: ModelPresetId, cli: DelegateCli): Probe {
  return {
    connectorId: `cli:${cli}`, name: presetSpec(presetId).label,
    run: async () => {
      if (deps.host === 'hosted-web') return skipped(CHECK_WORDS.hostedCli);
      const inspect = deps.models.inspectCli?.bind(deps.models);
      if (!inspect) return skipped('Chausar cannot look for command-line tools in this build.');
      let view;
      try { view = cliStatusView(await inspect(cli, { fresh: true }), { claudeTerms: deps.claudeCodeTerms, lastTask: lastCliTask(state, venture.id, cli) }); }
      catch (error) { return failed(wordsOf(error, 'Chausar could not look at the tool.'), 'Check the tool runs in a terminal, then run the check again.'); }
      if (!view.found) return failed(view.line, view.fix ?? 'Install it again, then run the check again.');
      if (view.signedIn === 'yes' && view.state === 'ready') return answered(view.line);
      if (view.signedIn === 'no') return failed(view.line, view.fix ?? 'Sign in to it in a terminal, then run the check again.');
      return skipped(view.line, view.fix);
    },
  };
}

/**
 * The bank account's consent: no bank provider is linked, so there is nothing to read and the consent's dates are no
 * read at all. The row is skipped and says so, with the consent's end date for the owner's own planning.
 */
function bankProbe(account: { label: string; consent: NonNullable<Parameters<typeof consentStatus>[0]> }): Probe {
  return {
    connectorId: 'bank-account', name: `Bank: ${account.label}`,
    run: async () => ({ ...skipped(CHECK_WORDS.noBank), account: account.label, expiresOn: account.consent.expiresAt.slice(0, 10) as IsoDate }),
  };
}

/** TallyPrime: read only through the back office's Sources; this check can't reach it on its own, and says so. */
function tallyProbe(deps: VentureDeps, venture: VentureRecord, lastRead: string): Probe {
  return {
    connectorId: 'tally', name: 'TallyPrime',
    run: async () => {
      if (deps.host === 'hosted-web') return skipped(CHECK_WORDS.hostedTally, 'Read TallyPrime from the desktop app.');
      const day = venture.country ? formatVentureDate(lastRead.slice(0, 10), venture.country.dateOrder) : lastRead.slice(0, 10);
      return skipped(`${CHECK_WORDS.tally} It was last read on ${day}.`);
    },
  };
}

/** The private calendar address: one read of it through the network guard, no redirect followed. */
function calendarProbe(deps: VentureDeps, host: string): Probe {
  return {
    connectorId: 'calendar', name: 'Your calendar',
    run: async () => {
      if (deps.host === 'hosted-web') return skipped(HOSTED_CALENDAR, 'Check the calendar from the desktop app.');
      const address = deps.secrets.get('network:calendar' as never);
      if (!address) return failed(CALENDAR_WORDS.again, 'Paste the calendar address again under Connections.', { account: host });
      let status: number;
      try {
        status = (await guardedFetch({ url: calendarUrl(address).href, method: 'GET', maxRedirects: 0, maxBytes: MAX_IMPORT_BYTES, timeoutMs: CHECK_TIMEOUT_MS, headers: { accept: 'text/calendar' } }, { resolve: deps.net?.resolve, send: deps.net?.send })).status;
      } catch (error) {
        return failed(`Chausar could not read your calendar: ${wordsOf(error, 'the request did not finish.')}`, 'Copy the secret address again and paste it under Connections.', { account: host });
      }
      if (status === 200) return answered(`Your calendar address on ${host} answered.`, { account: host });
      return failed(`Your calendar address on ${host} answered with HTTP ${status}.`, 'Copy the secret address again and paste it under Connections.', { account: host });
    },
  };
}

/** The mailbox: sign in, EXAMINE the inbox read only, log out. Nothing is read or marked. */
function mailboxProbe(deps: VentureDeps, record: { host: string; port: number; user: string }): Probe {
  return {
    connectorId: 'mailbox', name: 'Your mailbox',
    run: async () => {
      if (deps.host === 'hosted-web') return skipped(HOSTED_MAILBOX, 'Check the mailbox from the desktop app.');
      const password = deps.secrets.get('mailbox:password' as never);
      if (!password) return failed(PASSWORD_AGAIN, 'Type the app password again under Connections.', { account: record.user });
      try {
        const session = await openMailbox({ host: record.host, port: record.port, user: record.user, password, resolve: deps.net?.resolve, connect: deps.net?.tls, timeoutMs: CHECK_TIMEOUT_MS });
        try { await session.examine(); } finally { await session.logout(); }
      } catch (error) {
        return failed(wordsOf(error, `Chausar could not open the inbox on ${record.host}.`), 'Check the server and the app password under Connections, then run the check again.', { account: record.user });
      }
      return answered(`Connected as ${record.user} on ${record.host}, read only.`, { account: record.user });
    },
  };
}

/** Posting through the owner's browser: the day every posting step last worked. */
function stepsProbe(state: State, venture: VentureRecord, connectorId: string, name: string): Probe {
  return {
    connectorId, name: `${name} posting`,
    run: async () => {
      const on = stepsCheckedOnOf(state, connectorId);
      if (!on) return skipped(`The ${name} posting steps have not all worked yet.`, `Run the ${name} posting steps check under Connections.`);
      return answered(`The ${name} posting steps last worked on ${formatVentureDate(on, venture.country?.dateOrder ?? 'day-month-year')}.`);
    },
  };
}

/** GitHub: one read of the followed repo's page, through the business's GitHub transport. */
function githubProbe(deps: VentureDeps, repo: { owner: string; name: string }): Probe {
  const full = `${repo.owner}/${repo.name}`;
  return {
    connectorId: 'github', name: 'GitHub',
    run: async () => {
      if (deps.github.kind === 'fixture') return skipped(CHECK_WORDS.recording);
      let status: number;
      try {
        status = (await deps.github.read({ path: `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`, accept: 'json', etag: null, token: deps.secrets.get(secretNameFor(repo as never)) })).status;
      } catch (error) { return failed(`Chausar could not reach GitHub: ${wordsOf(error, 'the request did not finish.')}`, 'Check this computer is online, then run the check again.'); }
      if (status === 200) return answered(`GitHub answered for ${full}. Chausar reads it and never pushes.`, { account: full });
      if (status === 401 || status === 403) return failed(`GitHub refused the token for ${full}.`, 'Make a new read-only token for this one repo and paste it under Build.', { account: full });
      if (status === 404) return failed(`GitHub could not find ${full}, or the token can't see it.`, 'Check the repo address, and give the token read access to it.', { account: full });
      return failed(`GitHub answered with HTTP ${status} for ${full}.`, 'Run the check again later.', { account: full });
    },
  };
}

/** Every connection this business has, as one probe each, in a fixed order. */
function probesOf(deps: VentureDeps, ctx: Context, state: State, venture: VentureRecord): Probe[] {
  const probes: Probe[] = [];
  const presets = new Set<ModelPresetId>();
  for (const connection of listRecords(state, 'venture-model-connection', venture.id)) {
    if (connection.status !== 'connected' || presets.has(connection.presetId)) continue;
    presets.add(connection.presetId);
    const cli = CLI_OF[connection.presetId];
    if (cli && (DELEGATE_CLIS as readonly string[]).includes(cli)) probes.push(cliProbe(deps, state, venture, connection.presetId, cli));
    else if (connection.routeKind === 'anthropic-messages' || connection.routeKind === 'openai-responses') probes.push(keyProbe(deps, ctx, connection.presetId));
  }
  for (const account of listRecords(state, 'venture-bank-account', venture.id)) {
    if (account.consent) probes.push(bankProbe({ label: account.label, consent: account.consent }));
  }
  // TallyPrime, once the back office read it (the engine's own connector read receipts).
  const tally = ((state as { receipts?: { connector?: unknown; at?: unknown }[] }).receipts ?? [])
    .filter(receipt => typeof receipt?.connector === 'string' && receipt.connector.startsWith('tally') && typeof receipt.at === 'string')
    .map(receipt => receipt.at as string).sort().at(-1);
  if (tally) probes.push(tallyProbe(deps, venture, tally));
  const mailbox = mailboxOf(state, venture.id);
  if (mailbox && mailbox.status !== 'disconnected') probes.push(mailboxProbe(deps, mailbox));
  const feed = calendarFeedOf(state, venture.id);
  if (feed && feed.status !== 'removed') probes.push(calendarProbe(deps, feed.host));
  for (const script of Object.values(BROWSER_SCRIPTS)) {
    if (stepsRecordOf(state, script.connectorId)) probes.push(stepsProbe(state, venture, script.connectorId, script.name));
  }
  const follow = latestFollow(state, venture.id);
  if (follow) probes.push(githubProbe(deps, follow.repo));
  return probes;
}

/** Ready, Warnings and Blocking: failed is blocking; an answer with a fix (an end date near) or a skip with one is a warning. */
export function setupHealth(rows: readonly Pick<ConnectorCheckRow, 'outcome' | 'fix'>[]): ConnectorChecksView['health'] {
  const health = { ready: 0, warnings: 0, blocking: 0 };
  for (const row of rows) {
    if (row.outcome === 'failed') health.blocking += 1;
    else if (row.fix) health.warnings += 1;
    else if (row.outcome === 'answered') health.ready += 1;
  }
  return health;
}

/** Keeper's line for the run, from the counts. */
function keeperLine(rows: readonly ConnectorCheckRow[], health: ConnectorChecksView['health']): { outcome: KeeperRunRecord['outcome']; line: string } {
  if (!rows.length) return { outcome: 'ok', line: CHECK_WORDS.nothing };
  const part = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  const line = `${part(health.ready, 'connection is ready', 'connections are ready')}, ${part(health.warnings, 'warning', 'warnings')}, ${part(health.blocking, 'blocking', 'blocking')}.`;
  return { outcome: health.blocking ? 'failed' : health.warnings ? 'warn' : 'ok', line };
}

/**
 * venture.connectors.check {} (prepare): one cheap real read per connection, stored with Keeper's run. With
 * { last: true } (4J21) it reads the newest check as the screens show it, with no new read and nothing stored, so the
 * Check connections tile is not empty when it opens; null before any check.
 */
export async function connectorsCheckHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<ConnectorChecksView | null> {
  const body = exactPayload(payload ?? {}, ['last']);
  check(!Object.hasOwn(body, 'last') || body.last === true, 'INVALID_VENTURE_REQUEST', 'Send last as true, or nothing.');
  const { state, venture } = readVenture(deps, ctx);
  authorize(deps.store, ctx, 'prepare');
  if (body.last === true) return lastChecksView(state, venture.id);
  const rows: ConnectorCheckRow[] = [];
  // One at a time, so a slow provider never holds the others' answers, and each has its own deadline.
  for (const probe of probesOf(deps, ctx, state, venture)) {
    let result: Result;
    try { result = await probe.run(); }
    catch (error) { result = failed(wordsOf(error, 'The check did not finish.'), 'Run the check again.'); }
    rows.push({ connectorId: probe.connectorId, name: probe.name, ...result });
  }
  const health = setupHealth(rows);
  const ran = keeperLine(rows, health);
  return ventureAction(deps, ctx, 'prepare', 'connectors.check', tx => {
    const record = tx.put<ConnectorCheckRecord>({
      ...tx.base('venture-connector-check'),
      rows: rows.map(row => ({ connectorId: row.connectorId, name: row.name, outcome: row.outcome, line: row.line, account: row.account, expiresOn: row.expiresOn, fix: row.fix })),
    });
    const old = tx.list('venture-keeper-run').filter(item => item.job === 'connection-checks');
    const run: KeeperRunRecord = { ...tx.base('venture-keeper-run'), job: 'connection-checks', outcome: ran.outcome, line: ran.line };
    if (old[0]) tx.replace({ ...run, id: old[0].id }); else tx.put(run);
    tx.emit('keeper.ran', { jobs: ['connection-checks'] });
    return { at: record.at, rows, health };
  });
}

/** Whether any connection check of this business has a row for the connector. */
export function connectorChecked(state: State, ventureId: string, connectorId: string): boolean {
  return listRecords(state, 'venture-connector-check', ventureId).some(record => record.rows.some(row => row.connectorId === connectorId));
}

/** For 4J13: a routine for a connector never checked is refused, with what to do. */
export function requireConnectorChecked(state: State, ventureId: string, connectorId: string): void {
  if (!connectorChecked(state, ventureId, connectorId)) {
    throw new ChausarError('ROUTINE_NEEDS_CHECK', 'Run Check connections once before a routine uses this connection, so Chausar knows it works.');
  }
}

/** The newest check as the screens read it, or null before one. */
export function lastChecksView(state: State, ventureId: string): ConnectorChecksView | null {
  const record = latestCheck(state, ventureId);
  if (!record) return null;
  const rows = record.rows.map(row => ({ ...row, name: row.name ?? row.connectorId, fix: row.fix ?? null }));
  return { at: record.at, rows, health: setupHealth(rows) };
}
