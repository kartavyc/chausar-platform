// Chausar playbook kit: asset records (Ink v2 wave 5, package 5A4; catalogue P8). Every file a run delivers has a
// venture-asset: where it came from (the client's file, generated with a model and prompt, licensed stock with its
// licence id, or unknown), its licence, its credit, its cost (a receipt, or "not measured") and what superseded it.
// The run's own tools say so (assets.record, media.clean); the run stores what they said with the run, in the same
// transaction, as Chausar's own records (storeRunAssets). Accept refuses while a file of the run has no known licence
// (ASSET_LICENCE_UNKNOWN, naming the file), was made with a voice whose consent was withdrawn, is a derived unit whose
// source changed (DERIVED_STALE), still holds its location data, or was asked for again and not made yet. The footage
// share of a cut ("62% your footage") is computed by code from the edit list by source, and goes into the AI
// disclosure line whenever generated footage is above zero. Rerun asks for a new asset that supersedes the old one,
// which is kept; Reuse links an asset into another of the same client's orders, at no new cost.
//
// Learned from open-edit cli/src/providers/assets.ts and cli/src/commands/stills.ts (Apache 2.0): the record's fields
// and Rerun and Reuse. Written here for Chausar; no code copied.
import { ChausarError, check, type Context, type State } from '../../../contracts.ts';
import { currentVenture, exactPayload, findRecord, identifier, listRecords, ventureAction, type VentureTx } from '../../records.ts';
import { readAs } from '../../delivery/shared.ts';
import type { AssetRecord, DelegateRunRecord, Json, ToolCallRecord, VentureDeps, VentureRecord } from '../../contracts.ts';
import { isStale, sourceDigest, staleLine } from './fingerprint.ts';
import { madeWithConsentBlock, requireOrderPeopleConsent, todayOf } from './voice-consent.ts';
import type {
  AssetBody, AssetCost, AssetRerunView, AssetReuseView, AssetSource, AssetsView, AssetView, DerivedUnit, SourceRef,
} from './records-media.ts';

/**
 * What a run's tool says about one file it delivers, before the run stores it: everything the record holds except
 * where it sits (order, client, run, call) and what superseded it.
 */
export type AssetNote = Pick<AssetBody, 'name' | 'fileDigest' | 'source' | 'licence' | 'attribution' | 'cost' | 'consentId' | 'hygiene'> & {
  derived: { unit: DerivedUnit; source: SourceRef } | null;
};

// ---------------------------------------------------------------------------
// Why a file cannot go out
// ---------------------------------------------------------------------------

/**
 * Why Accept refuses this file now, or null: not made yet, its voice's consent withdrawn or ended (read from the consent
 * as it stands at `at`, not only the mark revoke left), an unknown licence, held, or stale.
 */
export function assetBlock(state: State, asset: AssetRecord, at: string = new Date().toISOString()): { code: string; line: string } | null {
  if (asset.state === 'requested') return { code: 'ASSET_NOT_MADE', line: `${asset.name} was asked for again and is not made yet. Run the order again, or reuse the old file.` };
  if (asset.state === 'consent-withdrawn') return { code: 'CONSENT_WITHDRAWN', line: `${asset.name} was made with a voice whose consent was withdrawn. Take it out.` };
  const venture = currentVenture(state);
  const consent = venture ? madeWithConsentBlock(state, venture, asset, todayOf(venture, at)) : null;
  if (consent) return consent;
  if (asset.source.kind === 'unknown' || asset.licence === null) return { code: 'ASSET_LICENCE_UNKNOWN', line: `${asset.name} has no known licence. Record where it came from, or take it out.` };
  if (asset.hygiene.state === 'held') return { code: 'MEDIA_NOT_CLEAN', line: `${asset.name} still has its location data. Clean it before it goes out.` };
  if (isStale(state, asset)) return { code: 'DERIVED_STALE', line: staleLine(state, asset) };
  return null;
}

/** The files a run hands over: those its own calls recorded, and those a method linked to its order (Rerun, Reuse). In use only. */
function assetsForRun(state: State, venture: VentureRecord, run: { id: string; orderId: string }): AssetRecord[] {
  return listRecords(state, 'venture-asset', venture.id)
    .filter(asset => asset.orderId === run.orderId && asset.supersededBy === null && (asset.runId === run.id || asset.runId === null));
}

/** Whether a file made with this consent is withdrawn with it now (the consent revoked, or gone). */
export function consentWithdrawn(state: State, consentId: string, at: string): boolean {
  const venture = currentVenture(state);
  return !!venture && madeWithConsentBlock(state, venture, { name: '', consentId }, todayOf(venture, at))?.code === 'CONSENT_WITHDRAWN';
}

/**
 * The first reason Accept refuses this run, or null: a person the order names whose consent is no longer current (checked
 * again here, not only at intake), then each of its files. Review and the run view both ask it, at their own time.
 */
export function mediaAcceptBlock(state: State, venture: VentureRecord, run: { id: string; orderId: string }, at: string = new Date().toISOString()): { code: string; line: string } | null {
  const order = findRecord(state, 'venture-order', run.orderId);
  if (order) {
    try {
      requireOrderPeopleConsent(state, venture, order, todayOf(venture, at));
    } catch (error) {
      if (!(error instanceof ChausarError)) throw error;
      return { code: error.code, line: error.message };
    }
  }
  for (const asset of assetsForRun(state, venture, run)) {
    const block = assetBlock(state, asset, at);
    if (block) return block;
  }
  return null;
}

/**
 * Every file a run hands over has an asset record: what the owner's own command-line tool left (delegate outputs) is
 * recorded as source unknown, inside the transaction that keeps it, so Accept refuses it until an agent records where it
 * came from (assets.record under the same name takes its place). Tables are Chausar's own work from the client's
 * files and need none. Called by delivery/runs.ts when a delegated run is stored.
 */
export function recordHandedOverFiles(tx: VentureTx, delegated: Pick<DelegateRunRecord, 'runId' | 'outcome' | 'outputs'>): AssetRecord[] {
  if (delegated.outcome !== 'succeeded') return [];
  const run = tx.find('venture-delivery-run', delegated.runId);
  const order = run ? tx.find('venture-order', run.orderId) : undefined;
  if (!run || !order) return [];
  const made: AssetRecord[] = [];
  for (const output of delegated.outputs) {
    if (tx.list('venture-asset').some(asset => asset.orderId === order.id && asset.runId === run.id && asset.name === output.name && asset.supersededBy === null)) continue;
    made.push(tx.put<AssetRecord>({
      ...tx.base('venture-asset'), orderId: order.id, clientId: order.clientId, runId: run.id, toolCallId: null, name: output.name, fileDigest: output.digest,
      source: { kind: 'unknown' }, licence: null, attribution: null, cost: { kind: 'not-measured' }, consentId: null, state: 'ready',
      hygiene: { state: 'not-media', removed: [] }, derived: null, supersededBy: null, supersedes: null, reusedFrom: null,
    }));
  }
  return made;
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export function sourceLine(source: AssetSource): string {
  switch (source.kind) {
    case 'client-file': return source.uploadId ? "Your client's file" : "Your client's file on this computer";
    case 'generated': return `Made by ${source.model}`;
    case 'licensed-stock': return `Stock from ${source.provider} (licence ${source.licenceId})`;
    default: return 'Source unknown';
  }
}

export function costLine(cost: AssetCost): string {
  return cost.kind === 'receipt' ? 'Cost on its receipt' : cost.kind === 'reused' ? 'Reused, no new cost' : 'Cost not measured';
}

export function assetView(state: State, asset: AssetRecord, at: string = new Date().toISOString()): AssetView {
  const { kind: _kind, ventureId: _venture, memberId: _member, epoch: _epoch, ...body } = asset;
  return { ...structuredClone(body), stale: isStale(state, asset), blocked: assetBlock(state, asset, at), sourceLine: sourceLine(asset.source), costLine: costLine(asset.cost) };
}

// ---------------------------------------------------------------------------
// The footage share and the AI disclosure line
// ---------------------------------------------------------------------------

export type FootageEdit = { assetId: string; startMs: number; endMs: number };
export type FootageShare = { totalMs: number; byKind: Record<AssetSource['kind'], number>; ownPercent: number; generatedMs: number; line: string };

/**
 * How much of a cut is whose, from its edit list: each kept span's length added to its asset's source, in whole
 * milliseconds. ownPercent is the client's own footage, a whole percent rounded half up by integer arithmetic.
 */
export function footageShare(edits: readonly FootageEdit[], assets: readonly Pick<AssetRecord, 'id' | 'source'>[]): FootageShare {
  const byKind: Record<AssetSource['kind'], number> = { 'client-file': 0, generated: 0, 'licensed-stock': 0, unknown: 0 };
  for (const edit of edits) {
    check(Number.isInteger(edit.startMs) && Number.isInteger(edit.endMs) && edit.startMs >= 0 && edit.endMs > edit.startMs,
      'INVALID_VENTURE_REQUEST', 'Each span of the edit list needs a start before its end, in whole milliseconds.');
    const asset = assets.find(item => item.id === edit.assetId);
    check(asset, 'ASSET_NOT_FOUND', 'A span of the edit list names a file with no asset record.');
    byKind[asset.source.kind] += edit.endMs - edit.startMs;
  }
  const totalMs = Object.values(byKind).reduce((sum, value) => sum + value, 0);
  const ownPercent = totalMs ? Math.floor((byKind['client-file'] * 200 + totalMs) / (2 * totalMs)) : 0;
  return { totalMs, byKind, ownPercent, generatedMs: byKind.generated, line: `${ownPercent}% your footage` };
}

/** The AI disclosure line for a cut with generated footage in it, with the share; null when there is none. */
export function disclosureLine(share: FootageShare): string | null {
  return share.generatedMs > 0 ? `This video uses AI-generated footage. ${share.line}.` : null;
}

// ---------------------------------------------------------------------------
// Storing what a run's tools recorded
// ---------------------------------------------------------------------------

const RECORDING_TOOLS: readonly string[] = Object.freeze(['assets.record', 'media.clean']);

/** The note a recording call answered with, or null when it recorded nothing (a practice run, a failure). */
function noteOf(call: ToolCallRecord): AssetNote | null {
  if (!RECORDING_TOOLS.includes(call.tool) || call.outcome !== 'succeeded' || !call.envelope.ok) return null;
  const result = call.envelope.result as { recorded?: unknown; asset?: unknown } | null;
  if (!result || result.recorded === false || !result.asset || typeof result.asset !== 'object') return null;
  const note = result.asset as AssetNote;
  return typeof note.name === 'string' && note.name.length > 0 && note.source && typeof note.source === 'object' ? note : null;
}

/**
 * Stores the files a run's tools recorded as the order's assets, inside the run's own transaction: once per call (a
 * call already stored is skipped). A file with the name of one Rerun asked for on this order fills that request.
 */
export function storeRunAssets(tx: VentureTx, calls: readonly ToolCallRecord[], at: { runId: string; orderId: string; clientId: string }): AssetRecord[] {
  const stored: AssetRecord[] = [];
  for (const call of calls) {
    const note = noteOf(call);
    if (!note) continue;
    const assets = tx.list('venture-asset');
    if (assets.some(asset => asset.toolCallId === call.id)) continue;
    const source = note.derived?.source.kind === 'transcript' ? { kind: 'transcript' as const, orderId: at.orderId } : note.derived?.source ?? null;
    const derived = note.derived && source ? { unit: note.derived.unit, source, sourceDigest: sourceDigest(tx.state, source) ?? '' } : null;
    const body = {
      orderId: at.orderId, clientId: at.clientId, runId: at.runId, toolCallId: call.id, name: note.name, fileDigest: note.fileDigest ?? null,
      source: note.source, licence: note.source.kind === 'unknown' ? null : note.licence ?? null, attribution: note.attribution ?? null, cost: note.cost,
      consentId: note.consentId ?? null, hygiene: note.hygiene ?? { state: 'not-media', removed: [] }, derived,
    } satisfies Partial<AssetBody>;
    const requested = assets.find(asset => asset.orderId === at.orderId && asset.state === 'requested' && asset.name === note.name);
    if (requested) {
      // A Rerun's file keeps the derived link the request had when the call names none.
      stored.push(tx.replace<AssetRecord>({ ...requested, ...body, derived: body.derived ?? requested.derived, state: 'ready' }));
      continue;
    }
    // A clip cleaned (or held again) on a later run takes the place of the clip still held: the notice and the block go.
    // A file recorded under the name of a handed-over file kept as unknown (recordHandedOverFiles) takes its place too.
    const held = call.tool === 'media.clean'
      ? assets.find(asset => asset.orderId === at.orderId && asset.hygiene.state === 'held' && asset.supersededBy === null && asset.source.kind === 'client-file' && asset.source.uploadId === null)
      : assets.find(asset => asset.orderId === at.orderId && asset.runId === at.runId && asset.name === note.name && asset.toolCallId === null && asset.source.kind === 'unknown' && asset.supersededBy === null);
    // A consent withdrawn or ended by the time the run stores the file: the file is withdrawn with it.
    const withdrawn = body.consentId !== null && consentWithdrawn(tx.state, body.consentId, tx.now);
    const made = tx.put<AssetRecord>({
      ...tx.base('venture-asset'), ...body, state: withdrawn ? 'consent-withdrawn' : 'ready', supersededBy: null, supersedes: held?.id ?? null, reusedFrom: null,
    });
    if (held) tx.replace<AssetRecord>({ ...held, supersededBy: made.id });
    stored.push(made);
  }
  return stored;
}

// ---------------------------------------------------------------------------
// Methods
// ---------------------------------------------------------------------------

/** venture.assets.list { orderId?, clientId? } (read): the business's assets, newest first, each with why it blocks Accept. */
export async function assetsListHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<AssetsView> {
  const body = exactPayload(payload, ['orderId', 'clientId']);
  const orderId = body.orderId === undefined ? null : identifier(body.orderId, 'Order');
  const clientId = body.clientId === undefined ? null : identifier(body.clientId, 'Client');
  const { state, venture } = readAs(deps, ctx, 'read');
  const assets = listRecords(state, 'venture-asset', venture.id)
    .filter(asset => (orderId === null || asset.orderId === orderId) && (clientId === null || asset.clientId === clientId))
    .map(asset => assetView(state, asset, deps.clock().toISOString())).reverse();
  const blocked = assets.filter(asset => asset.supersededBy === null && asset.blocked).length;
  const files = assets.length === 1 ? '1 file' : `${assets.length} files`;
  return {
    assets,
    line: !assets.length ? 'No delivered files recorded yet.' : blocked ? `${files}. ${blocked} ${blocked === 1 ? 'needs' : 'need'} you before it can go out.` : `${files}, each with where it came from.`,
  };
}

/**
 * venture.assets.rerun { id } (prepare): asks for a generated file again, with the same model and prompt. The new asset
 * supersedes the old one, which is kept; the order's next run makes it, and Accept waits until it is made.
 */
export async function assetsRerunHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<AssetRerunView> {
  const body = exactPayload(payload, ['id'], ['id']);
  const id = identifier(body.id, 'Asset');
  readAs(deps, ctx, 'prepare');
  return ventureAction(deps, ctx, 'prepare', 'kit.assets.rerun', tx => {
    const old = tx.find('venture-asset', id);
    check(old, 'ASSET_NOT_FOUND', 'That file was not found.');
    check(old.supersededBy === null, 'ASSET_REFUSED', `${old.name} was already made again. Run the newest one again instead.`);
    check(old.source.kind === 'generated', 'ASSET_REFUSED', `${old.name} was not generated, so there is nothing to run again.`);
    check(old.state === 'ready', 'ASSET_REFUSED', old.state === 'consent-withdrawn' ? `${old.name} was made with a voice whose consent was withdrawn. It is not made again.` : `${old.name} is not made yet.`);
    const derived = old.derived ? { ...old.derived, sourceDigest: sourceDigest(tx.state, old.derived.source) ?? '' } : null;
    const next = tx.put<AssetRecord>({
      ...tx.base('venture-asset'), orderId: old.orderId, clientId: old.clientId, runId: null, toolCallId: null, name: old.name, fileDigest: null,
      source: structuredClone(old.source), licence: old.licence, attribution: old.attribution, cost: { kind: 'not-measured' }, consentId: old.consentId,
      state: 'requested', hygiene: { state: 'not-media', removed: [] }, derived, supersededBy: null, supersedes: old.id, reusedFrom: null,
    });
    const superseded = tx.replace<AssetRecord>({ ...old, supersededBy: next.id });
    return {
      asset: assetView(tx.state, next, tx.now), superseded: assetView(tx.state, superseded, tx.now),
      line: `${old.name} is asked for again, with the same request. The old one is kept; the order's next run makes the new one.`,
    };
  });
}

/**
 * venture.assets.reuse { id, orderId } (prepare): links a file into another of the same client's orders, at no new
 * cost. Never into another client's order, never a file that would be refused at Accept, and once per order.
 */
export async function assetsReuseHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<AssetReuseView> {
  const body = exactPayload(payload, ['id', 'orderId'], ['id', 'orderId']);
  const id = identifier(body.id, 'Asset');
  const orderId = identifier(body.orderId, 'Order');
  readAs(deps, ctx, 'prepare');
  return ventureAction(deps, ctx, 'prepare', 'kit.assets.reuse', tx => {
    const asset = tx.find('venture-asset', id);
    check(asset, 'ASSET_NOT_FOUND', 'That file was not found.');
    const order = tx.find('venture-order', orderId);
    check(order, 'ORDER_NOT_FOUND', 'That order was not found.');
    check(order.clientId === asset.clientId, 'ASSET_REFUSED', `${asset.name} belongs to another client's work. Chausar never moves one client's files to another.`);
    check(asset.supersededBy === null, 'ASSET_REFUSED', `${asset.name} was made again. Reuse the newest one.`);
    const block = assetBlock(tx.state, asset, tx.now);
    check(!block, block?.code ?? 'ASSET_REFUSED', block?.line ?? '');
    const root = asset.reusedFrom ?? asset.id;
    const already = tx.list('venture-asset').some(item => item.orderId === orderId && item.supersededBy === null && (item.id === root || item.reusedFrom === root));
    check(!already, 'ASSET_REFUSED', `${asset.name} is already on that order.`);
    const linked = tx.put<AssetRecord>({
      ...structuredClone(asset), ...tx.base('venture-asset'), orderId, runId: null, toolCallId: null, cost: { kind: 'reused', assetId: root },
      supersededBy: null, supersedes: null, reusedFrom: root,
    });
    return { asset: assetView(tx.state, linked, tx.now), line: `${asset.name} is on the order too, reused at no new cost.` };
  });
}

/** A JSON-safe copy of a note, for a tool's answer. */
export const noteJson = (note: AssetNote): Json => structuredClone(note) as unknown as Json;
