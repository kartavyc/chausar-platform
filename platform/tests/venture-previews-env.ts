// Shared setup for the Ink v2 wave 4 package 4J3 tests (venture-queue-previews, venture-order-steps, venture-delivered,
// venture-poster): the views test business (venture-views-env.ts) with literal record seeds for a YouTube order, its
// transcript, a run's draft package, uploads, posts and CA papers. Nothing here sends, posts or pays for anything.
import type {
  AnyVentureRecord, BlueprintRecord, ClientRecord, Deliverable, OrderIntake, OrderRecord, PlaybookRecord, ToolCallRecord, UploadRecord,
} from '../runtime/venture/contracts.ts';
import { digest, ventureAction, type VentureTx } from '../runtime/venture/records.ts';
import { owner, seedBlueprint, seedOrder, setStage, type Env } from './venture-views-env.ts';

/** Stores records built inside one transaction, as the packages that own them would. */
export function put<T>(env: Env, build: (tx: VentureTx) => T): Promise<T> {
  return ventureAction(env.deps, owner, 'admin', 'seed.records', build);
}

/** A record with a fresh base, for records whose package is not under test. fields: everything but the base. */
export function record<R extends AnyVentureRecord>(tx: VentureTx, kind: R['kind'], fields: Record<string, unknown>): R {
  return tx.put({ ...tx.base(kind), ...fields } as unknown as R);
}

const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');

/** An SRT file whose last line ends at endMs. */
export function srt(endMs: number): string {
  const stamp = (ms: number) => {
    const pad = (value: number, width = 2) => String(value).padStart(width, '0');
    return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
  };
  return `1\n${stamp(0)} --> ${stamp(4000)}\nWelcome to the room.\n\n2\n${stamp(endMs - 3000)} --> ${stamp(endMs)}\nThat is the winner.\n`;
}

/** A transcript upload for an order, as venture.files.add stores one. */
export function transcriptUpload(tx: VentureTx, orderId: string, endMs: number): UploadRecord {
  const encoded = b64(srt(endMs));
  return record<UploadRecord>(tx, 'venture-upload', {
    name: 'episode-14.srt', format: 'transcript', bytes: Buffer.byteLength(srt(endMs)), digest: digest(encoded), contentBase64: encoded,
    scope: { kind: 'order', orderId }, clientData: true,
  });
}

/** A drafted YouTube package, written as the package's labelled lines. */
export function youtubeDraft(title: string, extra: string[] = []): Deliverable {
  return {
    title: 'Episode package', questionsForClient: [],
    sections: [{ heading: 'Package', parts: [`Title: ${title}`, 'Description: We tested the mics in the room.', ...extra].map(text => ({ kind: 'text' as const, text })) }],
  };
}

export const CHAPTERS = ['0:00 The room', '1:20 The mics', '5:10 The winner'];

/** A succeeded youtube.editList call that kept runtimeFrames frames at fps frames a second. */
export function editListCall(runtimeFrames: number, fps: number, tableId = 'worktable_edit'): ToolCallRecord {
  return {
    id: 'call_edit', turn: 1, tool: 'youtube.editList', input: { picks: [{ from: 'seg-1', to: 'seg-2' }], fps: String(fps) }, inputDigest: 'edit-input',
    envelope: { ok: true, result: { table: 't1', fps, ranges: [], runtimeFrames, runtime: 'n/a' } }, outcome: 'succeeded', effect: 'compute', tier: 'code',
    receiptIds: [], tableIds: [tableId], startedAt: '2026-10-15T10:01:00.000Z', finishedAt: '2026-10-15T10:01:01.000Z',
  };
}

export type YoutubeSeed = { plan: BlueprintRecord; order: OrderRecord; client: ClientRecord; playbook: PlaybookRecord };

/**
 * A YouTube channel business at approve each: an accepted plan, one order with its intake, and the flagship playbook
 * record a run of it names.
 */
export async function seedYoutube(env: Env, intake: Partial<OrderIntake> = {}): Promise<YoutubeSeed> {
  const plan = await seedBlueprint(env);
  const { order, client } = await seedOrder(env, plan);
  await setStage(env, 'approve-each');
  return put(env, tx => {
    const withIntake = tx.replace<OrderRecord>({
      ...order, intake: { rights: null, format: 'long', aiVoice: false, aiPresenter: false, paidPromotion: false, cutFile: null, ...intake },
    });
    const playbook = record<PlaybookRecord>(tx, 'venture-playbook', {
      version: 1, hash: 'youtube-hash', blueprintDigest: plan.digest, serviceType: 'studio', steps: [], validated: true, tierCeiling: 'code', format: 2,
      flagship: 'youtube',
    });
    return { plan, order: withIntake, client, playbook };
  });
}
