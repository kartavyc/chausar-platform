// Chausar venture launcher, journal (Ink v2 wave 4, package 4J10; catalogue H26): the chained journal. Every item of
// the journal is one link in a chain: each step of an entry or a post, each log line of a website edit, the end states
// a provider reported and the outcome per target (end-states.ts), and each tool call a saved rule let run without
// asking (4J1). A link holds seq (from 1), prevDigest (the link before it), the item's own digest and digest, sha256
// over the link's canonical JSON. Items are linked at the end of the Chausar write that made them (records.ts
// ventureAction calls sealWrites): only items that write made (it remembers which items each record held before it
// was replaced), and a whole record only when that write created it. A later write never links an item again, so an
// item edited, added or a record put in outside Chausar stays wrong. The newest link is pinned on the venture record
// too, so a chain cut short or deleted shows. venture.journal.chain {} checks the whole chain; a gap, an edited item,
// a missing item or one added outside Chausar marks it corrupt from the first bad entry, and every journalled action is
// then refused JOURNAL_CORRUPT (journal.ts). The owner may accept the break they saw (venture.journal.acceptBreak, in
// the app, the owner only): a new chain starts there, every item there now linked again, with a line that says so.
// The sequence, previous-digest and record-digest chain with a corrupt stop follows OpenGCUA (Apache-2.0,
// packages/harness/runtime/action_journal.py); this is a rewrite in TypeScript, not a copy.
import { authorize, check, ChausarError, hash, newId, type Context, type State } from '../../contracts.ts';
import type {
  AnyVentureRecord, DeliveryRunRecord, IsoTime, JournalChainLink, JournalChainRecord, JournalChainView, JournalEntry, VentureDeps,
  VentureRecord,
} from '../contracts.ts';
import { pinMac, sealCanonical, sealDigest } from './seal-json.ts';
import { signWrites } from './signing.ts';

export { pinMac, sealDigest };

/** What the first link of a business's first chain points back to. */
export const CHAIN_GENESIS = sealDigest({ chain: 'chausar-journal', version: 1 });

/** What every journalled action is refused with while the chain is corrupt (JOURNAL_CORRUPT). */
export const corruptLine = (seq: number) =>
  `Chausar's record of outside actions doesn't add up from entry ${seq}, so nothing more goes out until you look.`;

// ---------------------------------------------------------------------------
// The items of the journal
// ---------------------------------------------------------------------------

type Item = { key: string; body: string };
type Chained = AnyVentureRecord & { kind: 'venture-journal-entry' | 'venture-connector-post' | 'venture-site-edit' | 'venture-delivery-run' };
const CHAINED_KINDS: ReadonlySet<string> = new Set(['venture-journal-entry', 'venture-connector-post', 'venture-site-edit', 'venture-delivery-run']);
const isChained = (record: unknown): record is Chained => !!record && CHAINED_KINDS.has((record as { kind?: string }).kind ?? '');

/** The fields a record is described by and that never change after it is made. A change to one breaks all its links. */
function headerOf(record: Chained): unknown {
  const base = { kind: record.kind, id: record.id, ventureId: record.ventureId };
  switch (record.kind) {
    case 'venture-journal-entry':
      return {
        ...base, action: record.action, subject: record.subject, target: record.target, actionDigest: record.actionDigest, describe: record.describe,
        agent: record.agent, shadow: record.shadow, quote: record.quote, account: record.account ?? null, operation: record.operation ?? null, provides: record.provides ?? [],
        dependsOn: record.dependsOn ?? [], retryOf: record.retryOf ?? null, covers: record.covers ?? [],
      };
    case 'venture-connector-post':
      return {
        ...base, connectorId: record.connectorId, mode: record.mode, account: record.account, text: record.text, digest: record.digest,
        describe: record.describe, agent: record.agent, draftId: record.draftId ?? null, draftDigest: record.draftDigest ?? null, part: record.part ?? null,
      };
    case 'venture-site-edit':
      // The staged copy itself is left out: turning an edit down removes it (action-extras.ts); its digest stays.
      return { ...base, target: record.target, path: record.path, summary: record.summary, beforeDigest: record.beforeDigest, afterDigest: record.afterDigest, planDigest: record.planDigest };
    default:
      return base;
  }
}

/** A tool call a saved rule let run without asking: the fields it had when it was made. */
function allowedCalls(run: DeliveryRunRecord): Item[] {
  const items: Item[] = [];
  for (const call of run.harness?.toolCalls ?? []) {
    if (!call.allowedBy) continue;
    items.push({
      key: `${run.id}@${call.id}`,
      body: sealDigest({ run: run.id, ventureId: run.ventureId, call: { id: call.id, turn: call.turn, tool: call.tool, inputDigest: call.inputDigest, allowedBy: call.allowedBy, startedAt: call.startedAt ?? null } }),
    });
  }
  return items;
}

/** One item's digest: the record's fixed fields, where the item sits, and the item itself. */
const itemBody = (head: string, place: string, item: unknown) => hash(`${head}\n${place}\n${sealCanonical(item)}`);

/** Every item one record holds, in the order they were made. */
export function chainItems(record: Chained): Item[] {
  if (record.kind === 'venture-delivery-run') return allowedCalls(record);
  const head = sealDigest(headerOf(record));
  const steps: unknown[] = record.kind === 'venture-site-edit' ? record.log : record.journal;
  const items: Item[] = steps.map((step, index) => ({ key: `${record.id}#${index}`, body: itemBody(head, `step ${index}`, step) }));
  if (record.kind === 'venture-site-edit') return items;
  if (record.targets) items.push({ key: `${record.id}~targets`, body: itemBody(head, 'targets', record.targets) });
  (record.ends ?? []).forEach((step, index) => items.push({ key: `${record.id}!${index}`, body: itemBody(head, `end ${index}`, step) }));
  return items;
}

function chainedOf(state: State, ventureId: string): Chained[] {
  return (state.conversations as unknown[]).filter((record): record is Chained => isChained(record) && record.ventureId === ventureId);
}
function chainRecordOf(state: State, ventureId: string): JournalChainRecord | undefined {
  return (state.conversations as AnyVentureRecord[]).find((record): record is JournalChainRecord => record?.kind === 'venture-journal-chain' && record.ventureId === ventureId);
}
/** The business's own record as it is in this state: the newest of its id. */
function ventureIndex(state: State, ventureId: string): number {
  for (let index = state.conversations.length - 1; index >= 0; index -= 1) {
    const record = state.conversations[index] as AnyVentureRecord | undefined;
    if (record?.kind === 'venture-record' && record.id === ventureId) return index;
  }
  return -1;
}
type Pin = { seq: number; digest: string; mac?: string };
const pinnedOf = (state: State, ventureId: string): Pin | null => (state.conversations[ventureIndex(state, ventureId)] as VentureRecord | undefined)?.journalHead ?? null;

/** The record an item key belongs to: '<id>#n' a step, '<id>~targets', '<id>!n' an end state, '<run>@<call>' a call. */
const recordOfItem = (key: string) => key.split(/[#~!@]/)[0];
/** Whether the business holds any record a chain once linked (its chainSeq stamp). */
const stampedIn = (state: State, ventureId: string) =>
  chainedOf(state, ventureId).some(record => record.kind !== 'venture-delivery-run' && typeof (record as { chainSeq?: unknown }).chainSeq === 'number');
/**
 * Stamps each journalled record the chain now links with the seq of its first link (chainSeq), once. A vault holding a
 * stamped record with no chain record or no pin then reads corrupt, not as a vault from before the chain: deleting the
 * chain and the pin together would also mean editing every stamped record. Delivery runs are not stamped.
 */
function stampLinked(state: State, ventureId: string, record: JournalChainRecord): void {
  const first = new Map<string, number>();
  for (const link of record.links) {
    const id = recordOfItem(link.item);
    if (!first.has(id)) first.set(id, link.seq);
  }
  for (let index = 0; index < state.conversations.length; index += 1) {
    const held = state.conversations[index] as unknown;
    if (!isChained(held) || held.ventureId !== ventureId || held.kind === 'venture-delivery-run') continue;
    if (typeof (held as { chainSeq?: unknown }).chainSeq === 'number' || !first.has(held.id)) continue;
    state.conversations[index] = { ...held, chainSeq: first.get(held.id) } as unknown as State['conversations'][number];
  }
}

// ---------------------------------------------------------------------------
// The keys the host derived from the vault's own key
// ---------------------------------------------------------------------------

/**
 * The receipt signing seed (receipt:signing) and the HMAC key on the pinned head (journal:head), from the secret shelf
 * where VentureHost derived them from the vault's own key. null for either when these deps have no shelf or no key:
 * receipts are then not signed and pins carry no HMAC (venture.receipt.verify and the chain check say so). Never throws.
 */
export type SealKeys = { signing: string | null; head: string | null };
export function sealKeysOf(deps: { secrets?: unknown }): SealKeys {
  const shelf = deps.secrets as { get?: (name: 'receipt:signing' | 'journal:head') => string | null } | undefined;
  const read = (name: 'receipt:signing' | 'journal:head') => {
    if (!shelf || typeof shelf.get !== 'function') return null;
    try {
      const value = shelf.get(name);
      return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value) ? value : null;
    } catch {
      return null;
    }
  };
  return { signing: read('receipt:signing'), head: read('journal:head') };
}
/** The signing seed alone (see sealKeysOf). */
export const signingSeedOf = (deps: { secrets?: unknown }): string | null => sealKeysOf(deps).signing;

/** The keys of each draft state's transaction, set by records.ts as it starts. */
const KEYS = new WeakMap<State, SealKeys>();
/** records.ts ventureAction, as the transaction starts: the keys its checks and seals use. */
export function noteSealKeys(state: State, deps: { secrets?: unknown }): void {
  KEYS.set(state, sealKeysOf(deps));
}
/** The keys of this state's transaction, or none. */
export const keysOfState = (state: State): SealKeys => KEYS.get(state) ?? { signing: null, head: null };

const headMac = (key: string, ventureId: string, head: { seq: number; digest: string }) => pinMac(key, ventureId, `journal-head\n${head.seq}\n${head.digest}`);

// ---------------------------------------------------------------------------
// The writes of one transaction (records.ts)
// ---------------------------------------------------------------------------

/**
 * What each draft state had written through tx.put and tx.replace, until its transaction seals it: the record as it
 * was before the first replace (its items then), or null for a record the transaction put in.
 */
const PENDING = new WeakMap<State, Map<string, AnyVentureRecord | null>>();

/** records.ts: one record was put (before null) or replaced (before: the record it replaced) in this draft state. */
export function noteWrite(state: State, id: string, before: unknown = null): void {
  const written = PENDING.get(state) ?? new Map<string, AnyVentureRecord | null>();
  if (!written.has(id)) written.set(id, (before ?? null) as AnyVentureRecord | null);
  PENDING.set(state, written);
}

/** The keys of the items a written record held before this transaction; null when the transaction made it. */
function keysBefore(pending: ReadonlyMap<string, AnyVentureRecord | null>, id: string): ReadonlySet<string> | null {
  const before = pending.get(id);
  if (!before) return null;
  return new Set(isChained(before) ? chainItems(before).map(item => item.key) : []);
}

/** The next link after link (or the start of the chain), covering one item. */
function linkAfter(previous: { seq: number; digest: string }, item: Item): JournalChainLink {
  const body = { seq: previous.seq + 1, prevDigest: previous.digest, item: item.key, body: item.body };
  return { ...body, digest: sealDigest(body) };
}

/** Where the chain in force starts: after the newest accepted break, else the beginning. */
function startOf(record: JournalChainRecord): { seq: number; digest: string } {
  const last = record.breaks[record.breaks.length - 1];
  return last ? { seq: last.startSeq - 1, digest: last.digest } : { seq: 0, digest: CHAIN_GENESIS };
}
/** The newest link of the chain in force, else where it starts. */
function headOf(record: JournalChainRecord): { seq: number; digest: string } {
  const start = startOf(record);
  const last = record.links[record.links.length - 1];
  return last && last.seq > start.seq ? { seq: last.seq, digest: last.digest } : start;
}

/** Links every item to the chain's end, in order. */
function appendItems(record: JournalChainRecord, items: Item[]): void {
  let head = headOf(record);
  for (const item of items) {
    const link = linkAfter(head, item);
    record.links.push(link);
    head = link;
  }
}

/** The pin for a head: its seq and digest, and the HMAC when this host has the key. */
export function pinFor(key: string | null, ventureId: string, head: { seq: number; digest: string }): Pin {
  return { seq: head.seq, digest: head.digest, ...(key ? { mac: headMac(key, ventureId, head) } : {}) };
}

/** Pins the chain's newest link on the venture record, in place, so a chain cut short or deleted shows. */
function pinHead(state: State, ventureId: string, head: { seq: number; digest: string }, key: string | null): void {
  const index = ventureIndex(state, ventureId);
  if (index < 0) return;
  const venture = state.conversations[index] as VentureRecord;
  const pin = pinFor(key, ventureId, head);
  if (venture.journalHead?.seq === pin.seq && venture.journalHead.digest === pin.digest && venture.journalHead.mac === pin.mac) return;
  state.conversations[index] = { ...venture, journalHead: pin } as unknown as State['conversations'][number];
}

/**
 * records.ts ventureAction, after the work and before the commit: signs the receipts written (signing.ts), then links
 * the items this transaction made in the journalled records it wrote: every item of a record it put in, and of a
 * record it replaced only the items that record did not hold before. The business's first chain adopts every item it
 * already holds; a chain that was pinned and is now gone is never made again, so its loss stays visible. When the state
 * this transaction began from was checked and found sound, the state it commits is remembered as sound too (see
 * promoteSealed), so the next check of it is not a full one.
 */
export function sealWrites(
  state: State, venture: VentureRecord | null, ctx: Context, now: IsoTime, opened: { list: unknown[]; length: number }, seed?: string | null,
): void {
  const pending = PENDING.get(state) ?? new Map<string, AnyVentureRecord | null>();
  PENDING.delete(state);
  if (!venture) return;
  const keys = keysOfState(state);
  const signing = seed === undefined ? keys.signing : seed;
  const before = cacheKeyOf(state, venture.id, state.revision, keys.head);
  sealInto(state, venture, ctx, now, opened, pending, signing, keys.head);
  promoteSealed(state, venture.id, before, pending, opened, keys.head);
}

function sealInto(
  state: State, venture: VentureRecord, ctx: Context, now: IsoTime, opened: { list: unknown[]; length: number },
  pending: Map<string, AnyVentureRecord | null>, signing: string | null, headKey: string | null,
): void {
  const reshaped = state.conversations !== opened.list || state.conversations.length !== opened.length;
  if (!pending.size && !reshaped) return;
  signWrites(state, venture, ctx, now, pending, opened, signing, headKey);
  const touched = chainedOf(state, venture.id).filter(record => pending.has(record.id));
  if (!touched.length) return;
  const found = chainRecordOf(state, venture.id);
  if (!found) {
    if ((pinnedOf(state, venture.id)?.seq ?? 0) > 0 || stampedIn(state, venture.id)) return;
    const record: JournalChainRecord = {
      id: newId('jchain'), kind: 'venture-journal-chain', ventureId: venture.id, memberId: ctx.memberId, epoch: ctx.epoch, at: now, links: [], breaks: [],
    };
    appendItems(record, chainedOf(state, venture.id).flatMap(chainItems));
    state.conversations.push(record);
    stampLinked(state, venture.id, record);
    pinHead(state, venture.id, headOf(record), headKey);
    return;
  }
  const linked = new Set(found.links.map(link => link.item));
  const fresh = touched.flatMap(record => {
    const earlier = keysBefore(pending, record.id);
    return chainItems(record).filter(item => !linked.has(item.key) && (!earlier || !earlier.has(item.key)));
  });
  if (!fresh.length) return;
  const copy = structuredClone(found);
  appendItems(copy, fresh);
  state.conversations[state.conversations.indexOf(found)] = copy;
  stampLinked(state, venture.id, copy);
  pinHead(state, venture.id, headOf(copy), headKey);
}

// ---------------------------------------------------------------------------
// Checking the chain
// ---------------------------------------------------------------------------

export type ChainCheck = {
  ok: boolean; entries: number; firstBadSeq: number | null; head: { seq: number; digest: string }; record: JournalChainRecord | null;
  /** The items that do not add up, sorted: their keys, or a seq for a gap, the head or the chain record. */
  badItems: string[];
};

/** Results by business, state revision and shape: two checks of the same committed state reuse the first. */
const CHECKED = new Map<string, ChainCheck>();
/** A sound result for the state a transaction is about to commit, waiting for records.ts to confirm the commit. */
const PROMOTED = new WeakMap<State, { key: string; result: ChainCheck }>();
const CACHE_MAX = 64;
const remember = <V>(map: Map<string, V>, key: string, value: V) => {
  if (map.size >= CACHE_MAX) map.delete(map.keys().next().value as string);
  map.set(key, value);
};

/** The cache key of a state: the business, the revision, the chain's shape, the pin and whether a head key checks it. */
function cacheKeyOf(state: State, ventureId: string, revision: number, headKey: string | null): string {
  const record = chainRecordOf(state, ventureId);
  const pinned = pinnedOf(state, ventureId);
  return `${ventureId}|${revision}|${record?.id ?? ''}|${record?.links.length ?? -1}|${record?.links[record.links.length - 1]?.digest ?? ''}|${pinned?.seq ?? 0}|${pinned?.mac ?? ''}|${headKey ? 'k' : '-'}`;
}

/**
 * After the seal: when the state this transaction began from was checked sound, and the transaction only added items
 * (every earlier item of each record it wrote still matches its link, nothing was taken out or put in another way),
 * the state it commits is sound too. It is remembered for the next revision once records.ts confirms the commit.
 * Links are still digested in every full check: this only spares the check of a state Chausar itself just sealed.
 */
function promoteSealed(
  state: State, ventureId: string, before: string, pending: ReadonlyMap<string, AnyVentureRecord | null>, opened: { list: unknown[] }, headKey: string | null,
): void {
  const sound = CHECKED.get(before);
  if (!sound?.ok || state.conversations !== opened.list) return;
  const record = chainRecordOf(state, ventureId) ?? null;
  if (sound.record && !record) return;
  const latest = new Map<string, JournalChainLink>();
  for (const link of record?.links ?? []) latest.set(link.item, link);
  for (const held of chainedOf(state, ventureId)) {
    if (!pending.has(held.id)) continue;
    for (const item of chainItems(held)) if (latest.get(item.key)?.body !== item.body) return;
  }
  const added = (record?.links.length ?? 0) - (sound.record?.links.length ?? 0);
  if (added < 0) return;
  const result: ChainCheck = { ok: true, entries: sound.entries + added, firstBadSeq: null, head: record ? headOf(record) : sound.head, record, badItems: [] };
  PROMOTED.set(state, { key: cacheKeyOf(state, ventureId, state.revision + 1, headKey), result });
}

/** records.ts ventureAction, once the commit landed: the sound result of the state it committed is remembered. */
export function confirmSeal(state: State): void {
  const promoted = PROMOTED.get(state);
  PROMOTED.delete(state);
  if (promoted) remember(CHECKED, promoted.key, promoted.result);
}

/**
 * Checks the chain in force: each link's seq, prevDigest and digest, the pinned head and its HMAC, then every item the
 * business holds against its newest link. Inside a transaction, the items it made and has not sealed yet are its own:
 * a record it put in, or items a replaced record did not hold before. Anything else unlinked was added outside Chausar.
 * headKey: the HMAC key on the pin; by default the key of this state's transaction.
 */
export function checkChain(state: State, ventureId: string, headKey: string | null = keysOfState(state).head): ChainCheck {
  // A transaction's own puts leave the revision and the chain as they were, so its later checks reuse its first one.
  const cacheKey = cacheKeyOf(state, ventureId, state.revision, headKey);
  const cached = CHECKED.get(cacheKey);
  if (cached) return cached;
  const result = checkFully(state, ventureId, chainRecordOf(state, ventureId) ?? null, pinnedOf(state, ventureId), headKey);
  // Only a check with nothing of its own transaction waiting is the state as committed.
  if (!PENDING.get(state)?.size) remember(CHECKED, cacheKey, result);
  return result;
}

function checkFully(state: State, ventureId: string, record: JournalChainRecord | null, pinned: Pin | null, headKey: string | null): ChainCheck {
  const bad: { seq: number; key: string }[] = [];
  if (!record) {
    // A pin, or any record a chain once linked, with no chain record: the chain was taken away.
    if ((pinned?.seq ?? 0) > 0 || stampedIn(state, ventureId)) bad.push({ seq: 1, key: 'chain-record' });
    return finish(bad, 0, { seq: 0, digest: CHAIN_GENESIS }, null);
  }
  const start = startOf(record);
  let previous = start;
  let entries = 0;
  const bySeq = new Map<number, JournalChainLink>();
  // Every link is digested again on every full check: an edited link always shows.
  for (const link of record.links) {
    if (link.seq <= start.seq) continue;
    if (link.seq !== previous.seq + 1) { bad.push({ seq: previous.seq + 1, key: `seq:${previous.seq + 1}` }); break; }
    const { digest: own, ...body } = link;
    if (link.prevDigest !== previous.digest || own !== sealDigest(body)) { bad.push({ seq: link.seq, key: `seq:${link.seq}` }); break; }
    bySeq.set(link.seq, link);
    previous = { seq: link.seq, digest: own };
    entries += 1;
  }
  const head = headOf(record);
  // Stamped records and a chain record with no pin: the pin was taken away, with or without the head key.
  if (!pinned && stampedIn(state, ventureId)) bad.push({ seq: start.seq + 1, key: 'journal-head' });
  // The pin. With the head key, a chain in force with no pin, or a pin whose HMAC does not hold, is corrupt from where
  // the chain starts: nothing after it can be trusted. An older pin replayed with its own valid HMAC is not caught.
  if (headKey && head.seq > start.seq && (!pinned || pinned.mac !== headMac(headKey, ventureId, pinned))) {
    bad.push({ seq: start.seq + 1, key: 'journal-head' });
  }
  if (pinned && pinned.seq > start.seq) {
    if (pinned.seq > head.seq) bad.push({ seq: head.seq + 1, key: 'journal-head' });
    else if (bySeq.has(pinned.seq) && bySeq.get(pinned.seq)!.digest !== pinned.digest) bad.push({ seq: pinned.seq, key: 'journal-head' });
  }
  const latest = new Map<string, JournalChainLink>();
  for (const link of record.links) latest.set(link.item, link);
  const pending = PENDING.get(state);
  const present = new Set<string>();
  for (const held of (state.conversations as unknown[]).filter((item): item is Chained => isChained(item) && item.ventureId === ventureId)) {
    const own = pending?.has(held.id) ? keysBefore(pending, held.id) : undefined;
    for (const item of chainItems(held)) {
      present.add(item.key);
      const link = latest.get(item.key);
      if (!link) {
        // Unlinked: fine only when this very transaction made it and has not sealed it yet.
        const ours = own !== undefined && (own === null || !own.has(item.key));
        if (!ours) bad.push({ seq: head.seq + 1, key: item.key });
        continue;
      }
      if (link.body !== item.body) bad.push({ seq: Math.max(link.seq, start.seq + 1), key: item.key });
    }
  }
  for (const [key, link] of latest) if (link.seq > start.seq && !present.has(key)) bad.push({ seq: link.seq, key });
  return finish(bad, entries, head, record);
}

function finish(bad: { seq: number; key: string }[], entries: number, head: { seq: number; digest: string }, record: JournalChainRecord | null): ChainCheck {
  let first: number | null = null;
  for (const item of bad) if (first === null || item.seq < first) first = item.seq;
  return { ok: first === null, entries, firstBadSeq: first, head, record, badItems: [...new Set(bad.map(item => item.key))].sort() };
}

/** journal.ts: refuses every journalled action while the chain is corrupt. */
export function refuseCorrupt(state: State, ventureId: string | undefined): void {
  if (!ventureId) return;
  const result = checkChain(state, ventureId);
  if (!result.ok) throw new ChausarError('JOURNAL_CORRUPT', corruptLine(result.firstBadSeq!));
}

const entriesWord = (count: number) => (count === 1 ? '1 entry' : `${count} entries`);

/**
 * The chain as Money > Journal shows it. digest binds what the owner saw: the state, the first bad entry, the newest
 * link and every item that does not add up, so accepting a break never accepts one the owner was not shown.
 */
export function chainView(state: State, venture: VentureRecord, headKey: string | null = keysOfState(state).head): JournalChainView {
  const result = checkChain(state, venture.id, headKey);
  const seen = sealDigest({ ok: result.ok, firstBadSeq: result.firstBadSeq, head: result.head, bad: result.badItems });
  if (!result.ok) return { state: 'corrupt', entries: result.entries, firstBadSeq: result.firstBadSeq, line: corruptLine(result.firstBadSeq!), digest: seen };
  const accepted = result.record?.breaks[result.record.breaks.length - 1];
  const after = accepted ? ` A new record started at entry ${accepted.startSeq}, after the break you accepted from entry ${accepted.fromSeq}.` : '';
  const line = result.entries === 0 && !accepted
    ? 'Chausar\'s record of outside actions is empty: nothing has gone out yet.'
    : `Chausar's record of outside actions adds up: ${entriesWord(result.entries)}, each one checked against the one before it.${after}`;
  return { state: 'ok', entries: result.entries, firstBadSeq: null, line, digest: seen };
}

/** The breaks the owner accepted, as journal entries (journal/list.ts), so the journal says where a new record began. */
export function chainBreakEntries(state: State, venture: VentureRecord): JournalEntry[] {
  const record = chainRecordOf(state, venture.id);
  return (record?.breaks ?? []).map((accepted, index) => ({
    id: `${record!.id}/break-${index + 1}`, action: 'Record of outside actions', target: 'Journal', state: 'applied', at: accepted.at, line: accepted.line,
  }));
}

// ---------------------------------------------------------------------------
// The methods
// ---------------------------------------------------------------------------

/** venture.journal.chain {} (read): whether Chausar's record of outside actions adds up, and from where it does not. */
export async function journalChainHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<JournalChainView> {
  // records.ts imports this file for sealWrites, so its helpers are loaded on use here.
  const { exactPayload, readVenture } = await import('../records.ts');
  exactPayload(payload, []);
  const { state, venture } = readVenture(deps, ctx);
  return chainView(state, venture, sealKeysOf(deps).head);
}

/** The line a break the owner accepted leaves in the journal. */
export const breakLine = (fromSeq: number, startSeq: number) =>
  `You accepted a break in Chausar's record of outside actions from entry ${fromSeq}. A new record starts at entry ${startSeq}; what came before it was not checked again.`;

/**
 * venture.journal.acceptBreak { digest } (approve, in the app, the owner only): the owner looked at the break and
 * accepts exactly the one they saw (digest from venture.journal.chain). A new chain starts after it, every item the
 * business holds now linked again, and the journal and the decision record say so. Nothing is sent or run.
 */
export async function journalAcceptBreakHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<JournalChainView> {
  const { exactPayload, isAppChannel, ventureAction } = await import('../records.ts');
  const { recordDecision } = await import('./decisions.ts');
  const body = exactPayload(payload, ['digest'], ['digest']);
  check(typeof body.digest === 'string' && /^[0-9a-f]{64}$/.test(body.digest), 'INVALID_VENTURE_REQUEST', 'Send the digest of the break you saw.');
  check(isAppChannel(ctx), 'APP_APPROVAL_REQUIRED', 'Accept this inside the Chausar app.');
  authorize(deps.store, ctx, 'approve');
  check(ctx.role === 'owner', 'FORBIDDEN', 'Only the owner can accept a break in Chausar\'s record of outside actions.');
  return ventureAction(deps, ctx, 'approve', 'journal.acceptBreak', tx => {
    const venture = tx.venture!;
    const seen = chainView(tx.state, venture);
    check(seen.state === 'corrupt', 'INVALID_VENTURE_REQUEST', 'Chausar\'s record of outside actions adds up. There is no break to accept.');
    check(seen.digest === body.digest, 'APPROVAL_STALE', 'This changed since you looked. Look at the record again.');
    const result = checkChain(tx.state, venture.id);
    const pinned = pinnedOf(tx.state, venture.id);
    // A chain record that is gone starts again after the newest link it was known to have.
    const record: JournalChainRecord = result.record ? structuredClone(result.record) : {
      ...tx.base('venture-journal-chain'), links: [], breaks: [],
    };
    const last = Math.max(result.head.seq, pinned?.seq ?? 0);
    const fromSeq = result.firstBadSeq!;
    const startSeq = last + 1;
    const line = breakLine(fromSeq, startSeq);
    const digest = sealDigest({ break: { fromSeq, startSeq, after: result.head.digest, bad: result.badItems, at: tx.now, by: ctx.memberId } });
    record.breaks.push({ at: tx.now, by: ctx.memberId, fromSeq, startSeq, digest, line });
    appendItems(record, chainedOf(tx.state, venture.id).flatMap(chainItems));
    stampLinked(tx.state, venture.id, record);
    if (result.record) tx.replace(record); else tx.put(record);
    const head = headOf(record);
    tx.replace({ ...tx.venture!, journalHead: pinFor(keysOfState(tx.state).head, venture.id, head) });
    recordDecision(tx, { subject: 'journal:chain', action: 'accept-break', who: 'owner', ruleId: null, reason: line, rowId: null });
    return chainView(tx.state, tx.venture!);
  });
}
