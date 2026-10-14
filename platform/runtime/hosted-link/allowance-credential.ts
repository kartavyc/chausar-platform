/**
 * The allowance as a model route. `hosted.allowanceCredential` asks the hosted service for an allowance-scoped
 * credential and answers exactly what the models-ext lane's `connectAllowance` passes to the core gateway:
 *   { endpoint, credential, model?, budgetMinor? }
 * - endpoint: `<hosted origin>/v1/allowance/responses` (the client refuses any other address from the server);
 * - credential: the bearer token, returned once to the caller and never kept here (the gateway's credential store owns it);
 * - model: the first priced model the allowance status lists, when there is one;
 * - budgetMinor: this month's grant in whole paise, a digit string as `RouteConfig.budgetMinor` takes it, only when the
 *   grant is set (an unset grant is left out, never sent as zero).
 * Only the credential id is recorded, with an audit line, so `hosted.allowanceRevoke` can end them later. The token
 * opens nothing but the Responses endpoint; revoking the device on unpair ends it on the server too.
 */
import { audit, ChausarError } from '../contracts.ts';
import type { Context, State } from '../contracts.ts';
import { moduleState, peekModuleState } from '../modules/types.ts';
import type { ModuleHost } from '../modules/types.ts';
import { connected, desktopOnly, initialHostedLinkState, input, MODULE_ID } from './service.ts';
import type { HostedLinkState } from './service.ts';

/** The hosted service keeps at most this many live per device; issuing another revokes its oldest. */
export const MAX_LIVE_ALLOWANCE_CREDENTIALS = 3;
/** The gateway's model identifier form (gateway.ts configureRoute). */
const GATEWAY_MODEL = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/;
const PAISE = /^[1-9]\d{0,17}$/;

type CredentialRecord = { credentialId: string; deviceId: string; createdAt: string };
type WithCredentials = HostedLinkState & { allowanceCredentials?: CredentialRecord[] };
export type AllowanceCredentialGrant = { endpoint: string; credential: string; model?: string; budgetMinor?: string };

const records = (state: State): CredentialRecord[] => structuredClone(peekModuleState<WithCredentials>(state, MODULE_ID)?.allowanceCredentials ?? []);
const namespace = (state: State) => moduleState(state, MODULE_ID, initialHostedLinkState) as WithCredentials;

export async function allowanceCredential(ctx: Context, payload: Record<string, any>, host: ModuleHost): Promise<AllowanceCredentialGrant> {
  desktopOnly(ctx); input(payload, []);
  const { client, pairing } = connected(host);
  const status = await client.allowance(pairing.sessionToken);
  const issued = await client.allowanceCredential(pairing.sessionToken);
  await host.store.update(state => {
    const m = namespace(state);
    // Records of an earlier pairing are dead on the server (its device was revoked); the server rotated out the oldest.
    m.allowanceCredentials = [...(m.allowanceCredentials ?? []).filter(r => r.deviceId === pairing.deviceId),
      { credentialId: issued.credentialId, deviceId: pairing.deviceId, createdAt: issued.createdAt }].slice(-MAX_LIVE_ALLOWANCE_CREDENTIALS);
    audit(state, 'hosted.allowance.credential.issued', { credentialId: issued.credentialId, deviceId: pairing.deviceId });
  });
  const model = status.models.map(m => m.model).find(name => GATEWAY_MODEL.test(name));
  const budgetMinor = status.grantState === 'set' && typeof status.grantPaise === 'string' && PAISE.test(status.grantPaise) ? status.grantPaise : undefined;
  return { endpoint: issued.endpoint, credential: issued.credential, ...(model !== undefined ? { model } : {}), ...(budgetMinor !== undefined ? { budgetMinor } : {}) };
}

/** Revokes every allowance credential this computer recorded. One the server no longer knows counts as revoked. */
export async function allowanceRevoke(ctx: Context, payload: Record<string, any>, host: ModuleHost): Promise<{ revoked: string[]; failed: string[] }> {
  desktopOnly(ctx); input(payload, []);
  const { client, pairing } = connected(host);
  const mine = records(host.store.read()).filter(r => r.deviceId === pairing.deviceId);
  const revoked: string[] = [], failed: string[] = [];
  for (const record of mine) {
    try { await client.revokeAllowanceCredential(pairing.sessionToken, record.credentialId); revoked.push(record.credentialId); }
    catch (error) {
      if (!(error instanceof ChausarError)) throw error;
      (error.code === 'NOT_FOUND' ? revoked : failed).push(record.credentialId);
    }
  }
  await host.store.update(state => {
    const m = namespace(state);
    m.allowanceCredentials = (m.allowanceCredentials ?? []).filter(r => r.deviceId === pairing.deviceId && !revoked.includes(r.credentialId));
    audit(state, 'hosted.allowance.credential.revoked', { credentialIds: revoked, failed });
  });
  return { revoked, failed };
}
