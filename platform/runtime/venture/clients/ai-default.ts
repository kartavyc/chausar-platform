// C5 task 7: one "Allow AI for new clients". The owner gives, in advance, the same permission each client otherwise
// gets on their own, worded for every client added from now on. It is off by default. While it is on, every client
// added (money/clients.ts putClient) gets their own recorded consent in the same write, granted by 'business-default'
// with this default's digest and time, so one recorded consent per client stays true. Clients already here are never
// touched; withdrawing one client's permission works as before; turning the default off stops new grants and keeps
// the old ones. Stored as one venture-client-ai-default record per change; the newest is in use.
import { check, newId, type Context, type State } from '../../contracts.ts';
import type { ClientAiConsent, ClientAiDefaultRecord, ClientRecord, VentureDeps, VentureRecord } from '../contracts.ts';
import { exactPayload, listRecords, readVenture, requireAppChannel, ventureAction, type VentureTx } from '../records.ts';
import { digest } from '../../portable.ts';
import { CLIENT_AI_DEFAULT_DISCLOSURE, type ClientAiDefaultView } from './ai-consent-core.ts';

export { CLIENT_AI_DEFAULT_DISCLOSURE };

export type { ClientAiDefaultView };

function newest(state: State, venture: VentureRecord): ClientAiDefaultRecord | undefined {
  return listRecords(state, 'venture-client-ai-default', venture.id).at(-1);
}

/** The digest the owner confirms: this business, the words, and how many times the default changed. */
function digestOf(state: State, venture: VentureRecord): string {
  return digest({ ventureId: venture.id, disclosure: CLIENT_AI_DEFAULT_DISCLOSURE, revision: listRecords(state, 'venture-client-ai-default', venture.id).length });
}

export function clientAiDefaultView(state: State, venture: VentureRecord): ClientAiDefaultView {
  const record = newest(state, venture);
  const on = record?.on === true;
  return {
    on, disclosure: CLIENT_AI_DEFAULT_DISCLOSURE, digest: digestOf(state, venture), setAt: record?.at ?? null,
    line: on ? 'Every client you add gets your AI permission. Clients added before keep their own.' : 'Each new client asks for your AI permission on their own.',
  };
}

/** Inside putClient's write: the new client's own consent when the default is on. */
export function defaultConsentFor(tx: VentureTx, client: ClientRecord): ClientRecord {
  const record = newest(tx.state, tx.venture!);
  if (!record?.on) return client;
  const consent: ClientAiConsent = { id: newId('aiconsent'), revision: 1, disclosureDigest: record.digest, grantedAt: tx.now, grantedBy: 'business-default', withdrawnAt: null };
  return { ...client, aiConsent: consent };
}

/** venture.client.aiDefault.get (read). */
export async function getClientAiDefault(deps: VentureDeps, ctx: Context, payload: unknown): Promise<ClientAiDefaultView> {
  exactPayload(payload, []);
  const { state, venture } = readVenture(deps, ctx);
  return clientAiDefaultView(state, venture);
}

/** venture.client.aiDefault.set { on, digest } (approve, app only): the digest of the words the owner read. */
export async function setClientAiDefault(deps: VentureDeps, ctx: Context, payload: unknown): Promise<ClientAiDefaultView> {
  requireAppChannel(ctx, 'venture.client.aiDefault.set');
  const body = exactPayload(payload, ['on', 'digest'], ['on', 'digest']);
  check(typeof body.on === 'boolean', 'INVALID_VENTURE_REQUEST', 'Send on as true or false.');
  check(typeof body.digest === 'string', 'INVALID_VENTURE_REQUEST', 'Read the permission first.');
  return ventureAction(deps, ctx, 'approve', 'client.aiDefault.set', tx => {
    const venture = tx.venture!;
    const now = clientAiDefaultView(tx.state, venture);
    check(body.digest === now.digest, 'CLIENT_AI_CONSENT_CHANGED', 'Read the current permission and confirm it again.');
    if (now.on === body.on) return now;
    tx.put<ClientAiDefaultRecord>({ ...tx.base('venture-client-ai-default'), on: body.on as boolean, digest: now.digest });
    return clientAiDefaultView(tx.state, venture);
  });
}
