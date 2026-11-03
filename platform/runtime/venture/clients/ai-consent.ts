import { check, newId, type Context, type State, type StateStore } from '../../contracts.ts';
import type { ClientAiConsent, ClientAiConsentView, VentureDeps } from '../contracts.ts';
import { exactPayload, findRecord, identifier, readVenture, requireAppChannel, ventureAction } from '../records.ts';
import { clientAiConsentView } from './ai-consent-core.ts';
export { CLIENT_AI_DISCLOSURE, clientAiConsentView } from './ai-consent-core.ts';

const watchers = new WeakMap<StateStore, Map<string, Set<() => void>>>();
/** Each live driver registers its abort signal here; these process-local callbacks carry no client data. */
export function watchClientAiConsent(store: StateStore, clientId: string, stop: () => void): () => void {
  let clients = watchers.get(store);
  if (!clients) { clients = new Map(); watchers.set(store, clients); }
  let jobs = clients.get(clientId);
  if (!jobs) { jobs = new Set(); clients.set(clientId, jobs); }
  jobs.add(stop);
  return () => { jobs.delete(stop); if (!jobs.size) clients.delete(clientId); };
}

/** Call again inside any write transaction and after awaited work; a new grant never revives an old job. */
export function requireClientAiConsent(state: State, ventureId: string, clientId: string,
  expected?: { consentId: string; consentRevision: number }): ClientAiConsent {
  const client = findRecord(state, 'venture-client', clientId);
  check(client && client.ventureId === ventureId, 'CLIENT_NOT_FOUND', 'Choose a client from this business.');
  const consent = client.aiConsent;
  check(consent && !consent.withdrawnAt, 'CLIENT_AI_CONSENT_REQUIRED', 'Allow this client’s data to reach your AI before starting their work.');
  check(!expected || (consent.id === expected.consentId && consent.revision === expected.consentRevision),
    'CLIENT_AI_CONSENT_CHANGED', 'This client’s AI permission changed. Start a new job.');
  return consent;
}

export async function getClientAiConsent(deps: VentureDeps, ctx: Context, payload: unknown): Promise<ClientAiConsentView> {
  const body = exactPayload(payload, ['clientId'], ['clientId']);
  const clientId = identifier(body.clientId, 'Client');
  const { state, venture } = readVenture(deps, ctx);
  const client = findRecord(state, 'venture-client', clientId);
  check(client && client.ventureId === venture.id, 'CLIENT_NOT_FOUND', 'Choose a client from this business.');
  return clientAiConsentView(client);
}

export async function agreeClientAiConsent(deps: VentureDeps, ctx: Context, payload: unknown): Promise<ClientAiConsentView> {
  requireAppChannel(ctx, 'venture.client.aiConsent.agree');
  const body = exactPayload(payload, ['clientId', 'disclosureDigest'], ['clientId', 'disclosureDigest']);
  const clientId = identifier(body.clientId, 'Client');
  return ventureAction(deps, ctx, 'approve', 'client.aiConsent.agree', tx => {
    const client = tx.find('venture-client', clientId);
    check(client, 'CLIENT_NOT_FOUND', 'Choose a client from this business.');
    const view = clientAiConsentView(client);
    check(body.disclosureDigest === view.disclosureDigest, 'CLIENT_AI_CONSENT_CHANGED', 'Read the current permission and confirm it again.');
    if (view.status === 'agreed') return view;
    const consent: ClientAiConsent = { id: newId('aiconsent'), revision: (client.aiConsent?.revision ?? 0) + 1,
      disclosureDigest: view.disclosureDigest, grantedAt: tx.now, grantedBy: ctx.memberId, withdrawnAt: null };
    return clientAiConsentView(tx.replace({ ...client, aiConsent: consent }));
  });
}

export async function withdrawClientAiConsent(deps: VentureDeps, ctx: Context, payload: unknown): Promise<ClientAiConsentView> {
  requireAppChannel(ctx, 'venture.client.aiConsent.withdraw');
  const body = exactPayload(payload, ['clientId'], ['clientId']);
  const clientId = identifier(body.clientId, 'Client');
  const view = await ventureAction(deps, ctx, 'approve', 'client.aiConsent.withdraw', tx => {
    const client = tx.find('venture-client', clientId);
    check(client, 'CLIENT_NOT_FOUND', 'Choose a client from this business.');
    const consent = client.aiConsent;
    if (!consent || consent.withdrawnAt) return clientAiConsentView(client);
    return clientAiConsentView(tx.replace({ ...client, aiConsent: { ...consent, revision: consent.revision + 1, withdrawnAt: tx.now } }));
  });
  // Commit first: every response or pending mutation is already fenced even if process teardown takes time.
  for (const stop of [...(watchers.get(deps.store)?.get(clientId) ?? [])]) stop();
  return view;
}
