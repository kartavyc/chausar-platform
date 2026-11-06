// Shared fixtures for the pipeline tests (venture-pipeline, venture-followups, venture-lead-score; package 4E1): people
// from the owner's own files, cards added through venture.pipeline.add, sends recorded the way the owner's "I sent it"
// records them (4E2 calls the same recordCardSend), and drafts seeded as 4E2 stores them.
import type { Context } from '../runtime/contracts.ts';
import type {
  LeadRecord, OpportunityRecord, OutreachChannel, OutreachKind, OutreachRecord, OutreachSentChannel, PersonRecord, PipelineCardResult,
  PipelineView, QueueList, QueueRow, VentureDeps,
} from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { recordCardSend } from '../runtime/venture/network/pipeline.ts';
import { handlers as build } from '../runtime/venture/build/index.ts';
import { call, owner, type Env } from './venture-views-env.ts';
import { CONNECTIONS, net, personNamed } from './venture-network-env.ts';

/** Calls one pipeline method (the network package's handlers), as the host would. */
export const pipe = <T>(env: Env, method: string, payload: unknown = {}, ctx: Context = owner) => net<T>(env, method as never, payload, ctx);

/** Asha Rao (Dewdrop Naturals), Rahul Mehta (Ubtan Lab) and Farhan Ali (Ali Spices) from LinkedIn's Connections.csv. */
export async function withPeople(env: Env): Promise<{ asha: PersonRecord; rahul: PersonRecord; farhan: PersonRecord }> {
  await net(env, 'venture.network.import', { kind: 'linkedin-connections', name: 'Connections.csv', text: CONNECTIONS });
  return { asha: personNamed(env, 'Asha Rao'), rahul: personNamed(env, 'Rahul Mehta'), farhan: personNamed(env, 'Farhan Ali') };
}

/** n more people from a contacts file: 'Person 1' at 'Company 1' with p1@people.example, and so on. */
export async function manyPeople(env: Env, n: number): Promise<PersonRecord[]> {
  const rows = Array.from({ length: n }, (_, i) => `Person ${i + 1},p${i + 1}@people.example,Company ${i + 1}`);
  await net(env, 'venture.network.import', { kind: 'contacts-csv', name: 'many.csv', text: ['Name,E-mail 1 - Value,Organization 1 - Name', ...rows].join('\n') + '\n' });
  return Array.from({ length: n }, (_, i) => personNamed(env, `Person ${i + 1}`));
}

/** Adds one person to the pipeline; the owner is the trigger unless a test names another. */
export const add = (env: Env, person: PersonRecord, trigger: Record<string, unknown> = { kind: 'owner' }) =>
  pipe<PipelineCardResult>(env, 'venture.pipeline.add', { personId: person.id, trigger });

/** Records one send the owner made, on a day, as "I sent it" does (4E2's venture.outreach.sent calls the same). */
export async function recordSent(env: Env, cardId: string, input: { on: string; channel: OutreachSentChannel | null; kind?: OutreachKind | null; ref?: string | null }): Promise<OpportunityRecord> {
  return ventureAction(env.deps, owner, 'approve', 'test.sent', tx => recordCardSend(tx, cardId, {
    on: input.on, channel: input.channel, outreachKind: input.kind ?? null, ref: input.ref ?? null, by: owner.memberId,
  }));
}

/** An unsent draft as 4E2 stores it, for a card. */
export async function seedDraft(env: Env, card: { id: string; personId: string }, kind: OutreachKind, channel: OutreachChannel): Promise<OutreachRecord> {
  return ventureAction(env.deps, owner, 'prepare', 'test.draft', tx => tx.put<OutreachRecord>({
    ...tx.base('venture-outreach'), opportunityId: card.id, invoiceId: null, personId: card.personId, outreachKind: kind, channel, to: null, subject: null,
    text: 'Hi, a quick nudge on my note last week.', blurb: null, footer: null, sourceUrl: null, basis: null, lints: [], by: 'agent', callId: null, digest: 'd'.repeat(64),
    sent: null, acceptedOn: null,
  }));
}

export const cards = (env: Env): OpportunityRecord[] => listRecords(env.store.read(), 'venture-opportunity');
export const cardById = (env: Env, id: string): OpportunityRecord => cards(env).find(card => card.id === id)!;
export const board = (env: Env, payload: Record<string, unknown> = {}) => pipe<PipelineView>(env, 'venture.pipeline.list', payload);
/** Every card on the board, whatever its column. */
export const allCards = (view: PipelineView) => view.columns.flatMap(column => column.cards);
export const queue = (env: Env) => call<QueueList>(env, 'venture.queue.list', {});
export const followupRowsOf = async (env: Env): Promise<QueueRow[]> => (await queue(env)).rows.filter(row => row.kind === 'followup');

/** The lead methods (the build package), with a mail-server check that always finds one. */
export function leadDeps(env: Env): VentureDeps {
  return { ...env.deps, mx: async () => [{ exchange: 'mx.example', priority: 10 }] };
}
export const leadCall = <T>(deps: VentureDeps, method: string, payload: unknown, ctx: Context = owner) =>
  ((build as Record<string, (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<unknown>>)[method])(deps, ctx, payload) as Promise<T>;
export const leads = (env: Env): LeadRecord[] => listRecords(env.store.read(), 'venture-lead');

/** Moves the clock forward by whole days. */
export const days = (env: Env, n: number) => env.advance(n * 86_400_000);
