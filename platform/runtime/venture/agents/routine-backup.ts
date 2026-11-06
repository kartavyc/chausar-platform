// C7 tasks 6 and 7: a backup AI for routines. Off by default. The owner names up to two other AIs already connected to
// this business, in order, and turning it on is the owner's approval in the app of each one's own chat consent text,
// recorded as a backup consent for that AI. At Run it a routine tries its main AI first; only when that AI refused
// before anything was sent to it (its plan used up, signed out, missing, unavailable) does the run go to the next
// usable backup: its backup consent holds, the plan meter does not say used up, and the tool is there. A cut stream,
// after something was sent, never falls back. A run that carries a client's data takes a backup only when that
// client's AI consent was given while the backup was already connected. The main chat consent keeps its rule exactly.
import { check, type Context, type State } from '../../contracts.ts';
import { MODEL_PRESET_IDS } from '../contracts.ts';
import type { ChatConsentRecord, IsoTime, ModelPresetId, ModelStatusView, VentureDeps, VentureRecord } from '../contracts.ts';
import { currentVenture, digest, exactPayload, listRecords, readVenture, requireAppChannel, ventureAction } from '../records.ts';
import { planBookOf, planCliOf } from '../models/plan-book.ts';
import { backupConsentHolds, chatConsentText, chatRoute, routeFor, type ChatRoute } from './consent.ts';
export { backupConsentHolds, routeFor } from './consent.ts';

export type RoutineBackup = { on: boolean; order: ModelPresetId[]; at: IsoTime | null };
export const BACKUP_LIMIT = 2;
/** Refusals that happen before anything reaches the AI: the run may go to a backup. Only when nothing was dispatched. */
export const RUN_ELSEWHERE: ReadonlySet<string> = new Set(['NO_MODEL_CONNECTED', 'PRESET_UNAVAILABLE', 'CLI_UNAVAILABLE', 'CODEX_SETUP_UNAVAILABLE', 'MODEL_KEY_MISSING', 'AI_USAGE_LIMIT', 'AI_SIGN_IN_REFUSED', 'AI_MODEL_UNAVAILABLE']);

export const BACKUP_WORDS = Object.freeze({
  notConnected: 'Choose only AIs already connected to this business, other than the one your routines use.',
  tooMany: `Choose at most ${BACKUP_LIMIT} backup AIs.`,
  consent: 'Read and agree to what each backup AI is sent first.',
  clientBefore: "This client agreed to AI use before your backup AI was connected, so their work waits for your main AI. Ask them again to let it run on the backup.",
  /** "Ran on Claude Code because your Codex plan was used up." */
  ranOn: (backup: string, main: string, code: string) => `Ran on ${backup} because ${code === 'AI_USAGE_LIMIT' ? `your ${main} plan was used up` : `${main} couldn't take it`}.`,
});

export function backupOf(venture: VentureRecord): RoutineBackup {
  const saved = venture.routineBackup;
  return saved ? { on: saved.on, order: [...saved.order], at: saved.at } : { on: false, order: [], at: null };
}

/** When the preset's newest connected row was made: a client's consent counts for a backup only from here on. */
export function connectedSince(status: ModelStatusView, presetId: ModelPresetId): IsoTime | null {
  const connection = status.connections.filter(item => item.status === 'connected' && item.presetId === presetId).at(-1);
  return connection ? connection.consentedAt ?? connection.at : null;
}

export type BackupChoice = { presetId: ModelPresetId; label: string; text: string; digest: string };
export type BackupView = { on: boolean; order: ModelPresetId[]; choices: BackupChoice[]; main: string | null };

/** The AIs connected to this business other than the main one, each with the consent text a backup would be sent under. */
function choicesOf(status: ModelStatusView): BackupChoice[] {
  const main = chatRoute(status)?.presetId ?? null;
  const ids = [...new Set(status.connections.filter(item => item.status === 'connected').map(item => item.presetId))];
  return ids.filter(id => id !== main && id !== 'built-in-templates').flatMap(id => {
    const route = routeFor(status, id);
    if (!route) return [];
    const text = chatConsentText(route);
    return [{ presetId: id, label: route.label, text, digest: digest(text) }];
  });
}

/** venture.routines.backup.get {} (read): the setting and the AIs that may back up the main one. */
export async function backupGetHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<BackupView> {
  exactPayload(payload, []);
  const { venture } = readVenture(deps, ctx);
  const status = deps.models.status(ctx), backup = backupOf(venture);
  return { on: backup.on, order: backup.order, choices: choicesOf(status), main: chatRoute(status)?.label ?? null };
}

/**
 * venture.routines.backup.set { on, order, digests } (approve, app only): off needs nothing; on needs an order of one or
 * two connected AIs that are not the main one, and the digest of each one's consent text as the owner read it. Each is
 * recorded as that AI's backup chat consent.
 */
export async function backupSetHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<BackupView> {
  requireAppChannel(ctx, 'venture.routines.backup.set');
  const input = exactPayload(payload, ['on', 'order', 'digests'], ['on', 'order']);
  check(typeof input.on === 'boolean', 'INVALID_VENTURE_REQUEST', 'Turn the backup on or off.');
  check(Array.isArray(input.order) && input.order.every(id => (MODEL_PRESET_IDS as readonly unknown[]).includes(id)) && new Set(input.order).size === input.order.length, 'INVALID_VENTURE_REQUEST', BACKUP_WORDS.notConnected);
  const order = input.order as ModelPresetId[];
  check(order.length <= BACKUP_LIMIT, 'INVALID_VENTURE_REQUEST', BACKUP_WORDS.tooMany);
  const status = deps.models.status(ctx), choices = choicesOf(status);
  check(order.every(id => choices.some(choice => choice.presetId === id)), 'INVALID_VENTURE_REQUEST', BACKUP_WORDS.notConnected);
  if (input.on) {
    check(order.length > 0, 'INVALID_VENTURE_REQUEST', BACKUP_WORDS.notConnected);
    const digests = input.digests;
    check(Array.isArray(digests) && digests.length === order.length && order.every((id, index) => choices.find(choice => choice.presetId === id)!.digest === digests[index]), 'APPROVAL_STALE', BACKUP_WORDS.consent);
  } else check(input.digests === undefined || Array.isArray(input.digests), 'INVALID_VENTURE_REQUEST', 'Send what you agreed to as a list.');
  await ventureAction(deps, ctx, 'approve', 'routines.backup', tx => {
    const venture = tx.venture!;
    tx.replace<VentureRecord>({ ...venture, routineBackup: { on: input.on as boolean, order, at: tx.now } });
    if (input.on) for (const id of order) {
      const route = routeFor(status, id)!;
      tx.put<ChatConsentRecord>({ ...tx.base('venture-chat-consent'), textDigest: digest(chatConsentText(route)), presetId: id, connectionId: route.connectionId, model: route.model, by: ctx.memberId, backup: true });
    }
  });
  return backupGetHandler(deps, ctx, {});
}

/** The routes a routine may run on, in order: the main one, then each backup while the setting is on. */
export function routineRoutes(status: ModelStatusView, venture: VentureRecord): ChatRoute[] {
  const main = chatRoute(status), backup = backupOf(venture);
  const routes = main ? [main] : [];
  if (backup.on) for (const id of backup.order) { const route = routeFor(status, id); if (route && route.presetId !== main?.presetId) routes.push(route); }
  return routes;
}

/** Whether a backup route may take a run now: its consent holds and its plan is not reported used up. */
export function usableBackup(deps: VentureDeps, state: State, venture: VentureRecord, route: ChatRoute): boolean {
  if (!backupConsentHolds(state, venture, route)) return false;
  const cli = planCliOf(route.presetId);
  return !cli || planBookOf(deps.store).read(cli, deps.clock().toISOString()).state !== 'used-up';
}

/** The open business, for the routine runner. */
export const ventureOf = (deps: VentureDeps) => currentVenture(deps.store.read());

/** Whether a client's data may go to this backup: their AI consent holds and was given at or after it was connected. */
export function clientAllowsBackup(state: State, venture: VentureRecord, clientId: string, status: ModelStatusView, presetId: ModelPresetId): boolean {
  const client = listRecords(state, 'venture-client', venture.id).find(row => row.id === clientId);
  const consent = client?.aiConsent, since = connectedSince(status, presetId);
  return !!consent && !consent.withdrawnAt && !!since && consent.grantedAt >= since;
}
