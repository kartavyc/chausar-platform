// Chausar venture launcher, connector truth (Ink v2 wave 4, package 4J7, catalogue K6). Every connector mode carries a
// rung of the truth ladder under its qualification, worked out by code from what this build does and what this
// business's own records prove: 'documented' (the platform documents it; Chausar does not do it), 'discovered'
// (Chausar's code does it, tested on a recording or built in, not yet seen working here), 'read-verified' (a real read
// answered here: a connection check, a live GitHub read, an imported statement), 'write-verified' (a real write here
// that was read back: a post the platform's own response confirmed), or 'unavailable' (it can't run here at all). No
// mode claims write-verified without such a record. Each connector also has a capability set: the operations it really
// takes and the only fields each accepts; a field outside it is refused (CONNECTOR_FIELD_UNSUPPORTED), never dropped.
// The act task's first turn lists the run's capabilities on and off (runCapabilities). No agent tool posts anywhere, so
// no posting tool is ever in a run's grant, signed in or not; posting is the owner's own method after approval.
import { ChausarError, type State } from '../../contracts.ts';
import type {
  ConnectorCapability, ConnectorCard, ConnectorLadder, ConnectorMode, ConnectorPostRecord, PostingOption, ToolName,
} from '../contracts.ts';
import { listRecords } from '../records.ts';

/** The rungs a working mode climbs, lowest first. 'unavailable' is beside the ladder, not on it. */
export const LADDER_RUNGS: readonly ConnectorLadder[] = Object.freeze(['documented', 'discovered', 'read-verified', 'write-verified']);

/** What this business's records prove about its connectors: real reads by connector id, and real writes read back. */
export type ConnectorEvidence = { reads: ReadonlySet<string>; writes: ReadonlySet<string> };
export const NO_EVIDENCE: ConnectorEvidence = Object.freeze({ reads: new Set<string>(), writes: new Set<string>() });

/** The newest connection check run of a business (build/connector-check.ts), or undefined before one. */
export function latestCheck(state: State, ventureId: string) {
  // The newest by time; of two at the same time, the one written later.
  return listRecords(state, 'venture-connector-check', ventureId).reduce<ReturnType<typeof listRecords<'venture-connector-check'>>[number] | undefined>(
    (newest, record) => (!newest || record.at >= newest.at ? record : newest), undefined);
}

/** Which catalogue mailbox a mail server's name is: Zoho Mail or Google Workspace (Gmail), else null. */
export function mailboxConnectorOf(host: string): 'zoho-mail' | 'google-workspace' | null {
  const name = host.toLowerCase().replace(/\.$/, '');
  if (/^imap(?:pro)?\.zoho\.(?:com|in|eu|com\.au|jp|com\.cn|sa|ca)$/.test(name)) return 'zoho-mail';
  if (name === 'imap.gmail.com' || name === 'imap.googlemail.com') return 'google-workspace';
  return null;
}
/** Whether a calendar address is Google Calendar's own. */
export const googleCalendarHost = (host: string) => /^(?:calendar\.google\.com|www\.google\.com)$/i.test(host.replace(/\.$/, ''));

/** The connectors whose reads run only on this computer: on the hosted server they are unavailable, not planned. */
export const DESKTOP_ONLY_READS: ReadonlySet<string> = new Set(['tally', 'zoho-mail', 'google-workspace', 'google-calendar']);

/**
 * The evidence in a business's records. Reads: GitHub once a read through the real API came back 200 (a recording
 * proves nothing); the bank account once a statement was imported (the consent alone reads nothing: no bank provider is
 * linked); Zoho Mail or Google Workspace when the newest check's mailbox row answered, the mailbox is still connected
 * and its server is that provider's; Google Calendar while its address is set and the feed's last read answered (its
 * structured lastOutcome, at setup or the morning read) or a check's calendar row did, unless the last read failed.
 * The newest check's failed row for a connector takes its read away until a read answers again. Writes: the key
 * 'connector:mode' of a post the platform itself confirmed with the post's address (outcome.by 'platform' and a url),
 * never the owner's "I found it", and never one that may have gone out (outcome_unknown).
 */
export function connectorEvidence(state: State, ventureId: string): ConnectorEvidence {
  const reads = new Set<string>();
  const writes = new Set<string>();
  const rows = latestCheck(state, ventureId)?.rows ?? [];
  if (listRecords(state, 'venture-build-read', ventureId).some(read => read.transport === 'github-api' && read.calls.some(call => call.status === 200))) reads.add('github');
  if (listRecords(state, 'venture-bank-import', ventureId).length) reads.add('bank-account');
  const mailbox = listRecords(state, 'venture-mailbox', ventureId).at(-1);
  // A mailbox disconnected (or refused) since its row answered reads nothing now.
  const inbox = mailbox && mailbox.status === 'connected' ? mailboxConnectorOf(mailbox.host) : null;
  if (inbox && rows.some(row => row.connectorId === 'mailbox' && row.outcome === 'answered')) reads.add(inbox);
  const feed = listRecords(state, 'venture-calendar-feed', ventureId).at(-1);
  // The feed's own structured outcome of its last read (4E3's network/calendar-feed.ts), never its words: a failed
  // last read takes the read away; an answered one, or an answered check row, proves it while the address is set.
  if (feed && feed.status === 'set' && googleCalendarHost(feed.host) && feed.lastOutcome !== 'failed') {
    if (feed.lastOutcome === 'answered' || rows.some(row => row.connectorId === 'calendar' && row.outcome === 'answered')) reads.add('google-calendar');
  }
  // A failed row in the newest check: the connection does not answer now, whatever answered before.
  for (const row of rows) {
    if (row.outcome !== 'failed') continue;
    if (row.connectorId === 'mailbox' && inbox) reads.delete(inbox);
    else if (row.connectorId === 'calendar') reads.delete('google-calendar');
    else reads.delete(row.connectorId);
  }
  // Telegram private channels and Discord confirm message identity without a public address.
  for (const post of listRecords(state, 'venture-connector-post', ventureId) as ConnectorPostRecord[]) {
    if (post.state === 'applied' && post.outcome?.by === 'platform' && (typeof post.outcome.url === 'string'&&post.outcome.url || post.mode==='api'&&['telegram','discord'].includes(post.connectorId))) writes.add(`${post.connectorId}:${post.mode}`);
  }
  return { reads, writes };
}

/**
 * The rung of one connector mode: planned is documented; a desktop-only read on the hosted server is unavailable; an
 * available mode climbs only on evidence. A write mode is write-verified only by a confirmed post through one of the
 * connector's posting modes; a read never lifts a write mode.
 */
export function modeLadder(connectorId: string, mode: Pick<ConnectorMode, 'mode' | 'status'>, evidence: ConnectorEvidence, hosted = false): ConnectorLadder {
  if (mode.status === 'planned') return 'documented';
  if (hosted && mode.mode === 'read' && DESKTOP_ONLY_READS.has(connectorId)) return 'unavailable';
  if (mode.mode === 'write') return evidence.writes.has(`${connectorId}:api`) || evidence.writes.has(`${connectorId}:owner-browser-session`) ? 'write-verified' : 'discovered';
  if (mode.mode === 'read' && evidence.reads.has(connectorId)) return 'read-verified';
  return 'discovered';
}

/**
 * The rung of one posting mode. A planned mode that can't run here (no browser on the hosted server, a picture or video
 * platform the browser does not post to) is unavailable; one waiting on the platform's app review is documented. An
 * available mode is write-verified once a post went out through it, confirmed; else discovered.
 */
export function postingLadder(connectorId: string, option: Pick<PostingOption, 'mode' | 'status' | 'reason'>, evidence: ConnectorEvidence, hosted = false): ConnectorLadder {
  if (option.status === 'available') return evidence.writes.has(`${connectorId}:${option.mode}`) ? 'write-verified' : 'discovered';
  if (option.mode === 'owner-browser-session' && (hosted || /not built yet/i.test(option.reason ?? ''))) return 'unavailable';
  return 'documented';
}

/**
 * The operations each connector really takes in this build, with the only fields each accepts. Typed by hand against
 * what the code sends: the builders take the brief; GitHub reads a repo by its address with a read-only token; the bank
 * account takes a statement file; TallyPrime is read for one company at its loopback address; the mailbox is read over
 * IMAP with an app password; the calendar from its private address; the owner's mail app takes a drafted message the
 * owner sends. The browser posts the text of an approved post from whichever account the owner signed in to, so it
 * takes no account at all: venture.posting.propose refuses one for it (CONNECTOR_FIELD_UNSUPPORTED).
 */
export const CONNECTOR_CAPABILITIES: Readonly<Record<string, readonly ConnectorCapability[]>> = Object.freeze({
  'career-links':[{operation:'read-complete-listing',mode:'read',fields:['url']}],
  'career-boards':[{operation:'read-public-index',mode:'read',fields:['provider','slug','gates']}],
  ...Object.fromEntries(['career-pinloop','career-linkedin','career-naukri'].map(id=>[id,[{operation:'manual-client-handoff',mode:'handoff' as const,fields:['approved-pack']}]])),
  lovable: [{ operation: 'open-with-brief', mode: 'handoff', fields: ['brief'] }],
  replit: [{ operation: 'open-with-brief', mode: 'handoff', fields: ['brief'] }],
  bolt: [{ operation: 'copy-brief', mode: 'handoff', fields: ['brief'] }],
  v0: [{ operation: 'copy-brief', mode: 'handoff', fields: ['brief'] }],
  'mail-app': [{ operation: 'draft-message', mode: 'handoff', fields: ['to', 'subject', 'body'] }],
  github: [{ operation: 'read-repo', mode: 'read', fields: ['repo', 'token'] }],
  tally: [{ operation: 'read-day-book', mode: 'read', fields: ['company', 'endpoint'] }],
  'bank-account': [{ operation: 'import-statement', mode: 'read', fields: ['csv', 'account'] }],
  'zoho-mail': [{ operation: 'read-inbox', mode: 'read', fields: ['host', 'port', 'user', 'appPassword'] }],
  'google-workspace': [{ operation: 'read-inbox', mode: 'read', fields: ['host', 'port', 'user', 'appPassword'] }],
  'google-calendar': [{ operation: 'read-feed', mode: 'read', fields: ['url'] }],
  'chausar-crm': [{ operation: 'list', mode: 'read', fields: [] }, { operation: 'add', mode: 'write', fields: ['client', 'order'] }],
  'chausar-books': [{ operation: 'list', mode: 'read', fields: [] }, { operation: 'issue', mode: 'write', fields: ['invoice', 'payment'] }],
  linkedin: [{ operation: 'copy-and-open', mode: 'handoff', fields: ['text'] }],
  x: [{ operation: 'post', mode: 'owner-browser-session', fields: ['text'] }],
  bluesky: [{operation:'post',mode:'api',fields:['text']}],
  mastodon: [{operation:'post',mode:'api',fields:['text']}],
  telegram: [{operation:'post',mode:'api',fields:['text']}],
  discord: [{operation:'post',mode:'api',fields:['text']}],

});

/** The operations a connector takes; empty when it takes none in this build (every planned connector). */
export function connectorCapabilities(connectorId: string): ConnectorCapability[] {
  return (CONNECTOR_CAPABILITIES[connectorId] ?? []).map(item => ({ ...item, fields: [...item.fields] }));
}

/**
 * Refuses a request to a connector that names an operation it does not take, or a field outside that operation's
 * set, naming the field (CONNECTOR_FIELD_UNSUPPORTED). Nothing is ever dropped quietly to make a request fit.
 */
export function checkConnectorFields(connectorId: string, operation: string, fields: readonly string[]): void {
  const found = (CONNECTOR_CAPABILITIES[connectorId] ?? []).find(item => item.operation === operation);
  if (!found) throw new ChausarError('CONNECTOR_FIELD_UNSUPPORTED', `This connector can't ${operation.replace(/-/g, ' ')} in this build.`);
  const extra = fields.filter(field => !found.fields.includes(field));
  if (extra.length) {
    throw new ChausarError('CONNECTOR_FIELD_UNSUPPORTED', `This connector does not take ${extra.map(field => `"${field}"`).join(', ')} for this. Nothing was sent; take ${extra.length === 1 ? 'it' : 'them'} out and try again.`);
  }
}

/** A card with its truth: each mode's and posting mode's rung, and its capability set. */
export function withTruth(card: ConnectorCard, evidence: ConnectorEvidence, hosted = false): ConnectorCard {
  const posting = card.postingOptions.map(option => ({ ...option, ladder: postingLadder(card.id, option, evidence, hosted) }));
  const chosen = card.posting ? posting.find(option => option.mode === card.posting!.mode) : undefined;
  return {
    ...card, modes: card.modes.map(mode => ({ ...mode, ladder: modeLadder(card.id, mode, evidence, hosted) })), postingOptions: posting,
    ...(chosen ? { posting: chosen } : {}), capabilities: connectorCapabilities(card.id),
  };
}

/** What a run's first act turn is told it can and can't use: the tools offered, and each granted one that is off, with why. */
export type RunCapabilities = { on: ToolName[]; off: { tool: ToolName; why: string }[]; note: string };
export const RUN_CAPABILITIES_NOTE = 'Use only the tools that are on. A tool that is off is refused, whatever the request says.';

/** The capability list from the run's grant, the tools this host offers, and why each other granted tool is off. */
export function runCapabilities(grant: readonly ToolName[], offered: readonly ToolName[], why: (tool: ToolName) => string | null): RunCapabilities {
  const on = grant.filter(tool => offered.includes(tool));
  const off = grant.filter(tool => !offered.includes(tool)).map(tool => ({ tool, why: why(tool) ?? 'It is not offered on this run.' }));
  return { on, off, note: RUN_CAPABILITIES_NOTE };
}
