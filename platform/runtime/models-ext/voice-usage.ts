/**
 * Voice minutes and their cost per provider per calendar month (India time), read from speech receipts only:
 * - recorded uploads and local whisper count the recording length; uploads cost their per-minute charge, local costs nothing;
 * - live voice counts the minutes the engine recorded for the session, ended at the approved cap at the latest;
 * - the browser transcript sends Chausar text only, so its minutes and cost are "not counted".
 * Paise are BigInt strings; a figure that cannot be counted is the words "not counted", never zero.
 */
import type { State } from '../contracts.ts';
import { peekModuleState } from '../modules/types.ts';
import { MODULE_ID } from './part.ts';

export const NOT_COUNTED = 'not counted';
const IST_OFFSET_MS = 19800000;
/** The calendar month, India time, of an epoch-millisecond instant: 'YYYY-MM'. */
export const voiceMonth = (ms: number) => new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 7);
export const isVoiceMonth = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

type Basis = 'browser-text-only' | 'local-free' | 'recorded-length-at-rate' | 'live-minutes-at-rate';
export type VoiceUsageRow = { providerId: string; kind: string; minutes: string; minutesMs: number | typeof NOT_COUNTED; costMinor: string; basis: Basis };
export type VoiceUsage = { month: string; providers: VoiceUsageRow[]; totals: { minutesMs: number; costMinor: string } };

const BASIS: Record<string, Basis> = { 'browser-transcript': 'browser-text-only', 'local-command': 'local-free', 'api-upload': 'recorded-length-at-rate', 'sarvam-stt': 'recorded-length-at-rate', 'bhashini-asr': 'recorded-length-at-rate', 'live-voice': 'live-minutes-at-rate' };
const durationOf = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : null;
const paiseOf = (value: unknown) => typeof value === 'string' && /^\d{1,30}$/.test(value) ? BigInt(value) : null;

/** One counted use, or null when the receipt is not a finished speech use. */
function useOf(receipt: Record<string, any>, kinds: ReadonlyMap<string, string>): { at: string; providerId: string; kind: string; ms: number | null; cost: bigint | null } | null {
  if (!['speech-receipt', 'speech-preview'].includes(receipt.kind)) return null;
  const kind = typeof receipt.providerKind === 'string' ? receipt.providerKind : kinds.get(receipt.providerId) ?? 'browser-transcript';
  const providerId = String(receipt.providerId);
  if (kind === 'live-voice') {
    if (typeof receipt.liveEndedAt !== 'string') return null;
    return { at: receipt.liveEndedAt, providerId, kind, ms: durationOf(receipt.liveMinutesMs), cost: paiseOf(receipt.liveChargedMinor) };
  }
  if (receipt.kind === 'speech-preview' && receipt.status !== 'completed') return null;
  const at = typeof receipt.voiceAt === 'string' ? receipt.voiceAt : receipt.completedAt ?? receipt.createdAt;
  if (typeof at !== 'string') return null;
  if (kind === 'browser-transcript') return { at, providerId, kind, ms: null, cost: null };
  if (kind === 'local-command') return { at, providerId, kind, ms: durationOf(receipt.durationMs), cost: 0n };
  return { at, providerId, kind, ms: durationOf(receipt.durationMs), cost: paiseOf(receipt.costReservedMinor) };
}

const minutesWords = (ms: number) => String(Math.ceil(ms / 60000));

export function voiceUsage(state: State, month: string): VoiceUsage {
  const providers = peekModuleState<{ speech?: { providers?: { id: string; kind: string }[] } }>(state, MODULE_ID)?.speech?.providers ?? [];
  const kinds = new Map(providers.map(p => [p.id, p.kind]));
  const rows = new Map<string, { providerId: string; kind: string; ms: number; msCounted: boolean; cost: bigint; costCounted: boolean }>();
  for (const receipt of state.modelReceipts) {
    const use = useOf(receipt, kinds); if (!use) continue;
    const at = Date.parse(use.at); if (!Number.isFinite(at) || voiceMonth(at) !== month) continue;
    const row = rows.get(use.providerId) ?? { providerId: use.providerId, kind: use.kind, ms: 0, msCounted: false, cost: 0n, costCounted: false };
    if (use.ms !== null) { row.ms += use.ms; row.msCounted = true; }
    if (use.cost !== null) { row.cost += use.cost; row.costCounted = true; }
    rows.set(use.providerId, row);
  }
  const list: VoiceUsageRow[] = [...rows.values()].sort((a, b) => a.providerId.localeCompare(b.providerId)).map(row => ({
    providerId: row.providerId, kind: row.kind, minutes: row.msCounted ? minutesWords(row.ms) : NOT_COUNTED, minutesMs: row.msCounted ? row.ms : NOT_COUNTED,
    costMinor: row.costCounted ? String(row.cost) : NOT_COUNTED, basis: BASIS[row.kind] ?? 'recorded-length-at-rate' }));
  const counted = list.filter(row => row.costMinor !== NOT_COUNTED);
  return { month, providers: list, totals: {
    minutesMs: list.reduce((sum, row) => sum + (row.minutesMs === NOT_COUNTED ? 0 : row.minutesMs), 0),
    costMinor: list.length > 0 && counted.length === 0 ? NOT_COUNTED : String(counted.reduce((sum, row) => sum + BigInt(row.costMinor), 0n)) } };
}

/** For `modelsx.meters`: the month's counted voice minutes and their cost in paise ("not counted" when only uncountable use happened). */
export function voiceMeters(state: State, month: string): { voiceMinutesMs: number; voiceCostMinor: string } {
  const { totals } = voiceUsage(state, month); return { voiceMinutesMs: totals.minutesMs, voiceCostMinor: totals.costMinor };
}
