/** TR-10 the readable, tamper-evident record: a hash chain over the activity log. */
import { check } from '../contracts.ts';
import type { State } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';
import { canonicalJson, computerLabel, fields, memberName, sha256, tools } from './tools-common.ts';

export type Link = { seq: number; id: string; hash: string; at: string; computer: string };
const GENESIS = '0'.repeat(64);
const LIMIT = 'This record shows tampering. It cannot stop the owner of a computer from wiping that computer.';

const WORDS: Record<string, string> = {
  'trust.policy.changed': 'Changed the privacy rules', 'trustx.autonomy.changed': 'Changed what may run without asking', 'trustx.change.confirmed': 'Confirmed a change that needed two people', 'trustx.change.requested': 'Asked for a change that needs a second person', 'trustx.keep.changed': 'Changed how long data is kept', 'trustx.marking.changed': 'Changed a marking', 'trustx.seat.invited': 'Invited a person to a seat', 'trustx.seat.removed': 'Removed a seat', 'trustx.send.changed': 'Changed what may be sent to an AI model', 'trust.member.created': 'Added a person to the workspace', 'trust.member.revoked': 'Removed a person from the workspace',
  'trust.source.deleted': 'Deleted a source and what came from it', 'trust.source.grant.changed': 'Changed who may see a source', 'trust.retention.cleaned': 'Removed records past their keep date',
  'plugin.installed': 'Installed a plugin', 'plugin.enabled': 'Turned a plugin on', 'plugin.disabled': 'Turned a plugin off', 'plugin.removed': 'Removed a plugin', 'plugin.ran': 'Ran a plugin in its locked box', 'plugin.refused': 'Stopped a plugin run',
  'decision.created': 'Wrote down a decision', 'decision.reviewed': 'Reviewed a decision', 'decision.revised': 'Changed a decision',
  'calculation.completed': 'Calculated a number with a receipt', 'source.imported': 'Brought in a source', 'source.import-refused': 'Refused a source that did not check out', 'facts.appended': 'Added records from a source',
  'action.prepared': 'Prepared a change', 'action.approved': 'Approved a change', 'action.attempt': 'Tried an approved change', 'action.settled': 'Settled a change', 'action.reconciled': 'Checked an uncertain change', 'action.cancelled': 'Cancelled a change',
  'model.route.configured': 'Set up an AI model', 'model.route.revoked': 'Turned off an AI model', 'model.dispatch.prepared': 'Prepared a request to an AI model', 'model.outbound.approved': 'Approved a request to an AI model', 'model.dispatch.completed': 'Sent a request to an AI model',
  'learning.sharing': 'Changed the sharing switch', 'learning.consented': 'Agreed to share the shape of some work', 'learning.export-settled': 'Shared the shape of some work',
  'auth.session.issued': 'Signed someone in', 'auth.session.revoked': 'Signed someone out', 'auth.invitation.created': 'Invited a person', 'auth.invitation.accepted': 'Accepted an invitation',
  'sync.push.completed': 'Copied the locked workspace to the sync store', 'dictionary.published': 'Published the business dictionary', 'job.created': 'Set up a job', 'job.cancelled': 'Cancelled a job',
};
const RULES: [string, string][] = [
  ['trust.', 'Only an owner may change this.'], ['plugin.', 'Plugins run in a locked box with no network.'], ['model.', 'The send rule decides what may leave.'],
  ['action.', 'A change waits for approval of exactly that change.'], ['learning.', 'Sharing is off unless you turn it on, and shares structure only.'],
  ['calculation.', 'Every number carries its receipt.'], ['sync.', 'Only locked files leave for sync.'],
];

/** Append links for activity not yet in the chain. Runs inside `store.update`. */
export function extendChain(state: State): number {
  const record = (tools(state).record ??= { links: [] as Link[] }); const links: Link[] = record.links;
  const linked = new Set(links.map(link => link.id)); let added = 0; const computer = computerLabel();
  for (const entry of state.activity) {
    if (linked.has(entry.id)) continue;
    const previous = links.at(-1)?.hash ?? GENESIS;
    links.push({ seq: links.length + 1, id: entry.id, hash: sha256(previous + canonicalJson(entry)), at: entry.at, computer }); linked.add(entry.id); added++;
  }
  return added;
}
const behind = (state: State) => { const links: Link[] = tools(state).record?.links ?? []; const linked = new Set(links.map(link => link.id)); return state.activity.some(entry => !linked.has(entry.id)); };
export async function syncChain(host: ModuleHost) { if (behind(host.store.read())) await host.store.update(state => extendChain(state)); }

function head(links: Link[]) { const last = links.at(-1); return { hash: last?.hash ?? GENESIS, short: (last?.hash ?? GENESIS).slice(0, 8), at: last?.at ?? null, count: links.length }; }

export async function recordView(_ctx: unknown, payload: Record<string, any>, host: ModuleHost) {
  const { memberId, day } = fields(payload, ['memberId', 'day']);
  check(memberId === undefined || (typeof memberId === 'string' && memberId.length <= 200), 'INVALID_REQUEST', 'Choose a person.');
  check(day === undefined || (typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)), 'INVALID_REQUEST', 'Give the day as YYYY-MM-DD.');
  await syncChain(host);
  const state = host.store.read(); const links: Link[] = tools(state).record?.links ?? []; const byId = new Map(state.activity.map(entry => [entry.id, entry]));
  const items = [...links].reverse().flatMap(link => {
    const entry = byId.get(link.id); if (!entry) return [];
    const who = entry.details?.memberId;
    if (memberId !== undefined && who !== memberId) return [];
    if (day !== undefined && !String(entry.at).startsWith(day)) return [];
    return [{ seq: link.seq, at: entry.at, who: memberName(state, who), what: WORDS[entry.event] ?? String(entry.event), rule: RULES.find(([prefix]) => String(entry.event).startsWith(prefix))?.[1] ?? null, computer: link.computer }];
  }).slice(0, 500);
  return { items, head: head(links), limit: LIMIT };
}

export async function verifyRecord(_ctx: unknown, payload: Record<string, any>, host: ModuleHost) {
  fields(payload, []);
  await syncChain(host);
  const state = host.store.read(); const links: Link[] = tools(state).record?.links ?? []; const byId = new Map(state.activity.map(entry => [entry.id, entry]));
  let brokenAt: number | null = null; let previous = GENESIS;
  for (const link of links) {
    const entry = byId.get(link.id);
    if (!entry || sha256(previous + canonicalJson(entry)) !== link.hash) { brokenAt = link.seq; break; }
    previous = link.hash;
  }
  return { verified: brokenAt === null, brokenAt, head: head(links) };
}
