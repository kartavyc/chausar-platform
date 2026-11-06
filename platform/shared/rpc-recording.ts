/** D11d test protocol. Pure JSON helpers shared by the engine recorder and the unshipped scripted UI client. */
import { isDigest } from './digest.ts';
export type RecordingJson = null | boolean | number | string | RecordingJson[] | { [key: string]: RecordingJson };
export type RecordingPlaceholder =
  | { kind: 'id'; prefix: string }
  | { kind: 'time'; offsetMs: number; precision?: number }
  | { kind: 'digest' };
export type RecordingPlaceholders = Record<string, RecordingPlaceholder>;
export type RpcFrame =
  | { kind: 'request'; id: number; method: string; payload: RecordingJson }
  | { kind: 'event'; event: RecordingJson }
  | { kind: 'answer'; id: number; result: RecordingJson }
  | { kind: 'error'; id: number; error: { code: string; message: string; reason?: string; owner?: boolean } };
export type RpcRecording = { format: 'chausar-rpc-recording/1'; scenario: string; epoch: string; placeholders: RecordingPlaceholders; frames: RpcFrame[] };

const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const GENERATED = new RegExp(`^(.*_)?(${UUID})$`);
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.(\d{1,3}))?Z$/;
const TOKENS = new RegExp(`(?<![A-Za-z0-9_])(?:\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z|[a-f0-9]{64}|(?:[a-z][a-z0-9_]*_)?${UUID})(?![A-Za-z0-9_])`, 'g');
const PLACEHOLDER = /<(?:id|time|digest)-\d+>/g;

function walk(value: unknown, string: (value: string) => string): RecordingJson {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return string(value);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(item => walk(item, string));
  if (typeof value === 'object') {
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error('A recording accepts plain JSON values only.');
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [string(key), walk(item, string)]));
  }
  throw new Error('A recording accepts plain JSON values only.');
}

/** Only generated UUID identities and whole digest/time tokens vary; ordinary codes and words remain exact. */
export function createRecordingCodec(epoch: string) {
  const base = Date.parse(epoch);
  if (!Number.isFinite(base)) throw new Error('The recording needs a valid fixed clock.');
  const placeholders: RecordingPlaceholders = {};
  const known = new Map<string, string>();
  const counts = { id: 0, time: 0, digest: 0 };
  const token = (value: string) => {
    const previous = known.get(value);
    if (previous) return previous;
    const time = TIME.exec(value);
    const id = GENERATED.exec(value);
    let entry: RecordingPlaceholder;
    if (time) entry = { kind: 'time', offsetMs: Date.parse(value) - base, precision: time[1]?.length ?? 0 };
    else if (isDigest(value)) entry = { kind: 'digest' };
    else if (id) entry = { kind: 'id', prefix: id[1] ?? '' };
    else return value;
    const key = `<${entry.kind}-${++counts[entry.kind]}>`;
    known.set(value, key); placeholders[key] = entry;
    return key;
  };
  return {
    placeholders,
    encode(value: unknown): RecordingJson {
      return walk(value, text => {
        if (/<(?:id|time|digest)-\d+>/.test(text)) throw new Error('A sample value uses a reserved recording placeholder.');
        return text.replace(TOKENS, token);
      });
    },
  };
}

function valuesOf(placeholders: RecordingPlaceholders, epoch: string): Map<string, string> {
  return new Map(Object.entries(placeholders).map(([key, entry]) => {
    const index = Number(/-(\d+)>$/.exec(key)?.[1]);
    if (!Number.isSafeInteger(index) || index < 1) throw new Error('Invalid recording placeholder.');
    if (entry.kind === 'id') return [key, `${entry.prefix}00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`];
    if (entry.kind === 'digest') return [key, index.toString(16).padStart(64, '0')];
    const at = new Date(Date.parse(epoch) + entry.offsetMs).toISOString();
    const precision = entry.precision ?? 3;
    return [key, precision === 0 ? `${at.slice(0, 19)}Z` : `${at.slice(0, 20 + precision)}Z`];
  }));
}

export function hydrateRecordingValue(value: RecordingJson, placeholders: RecordingPlaceholders, epoch: string): RecordingJson {
  const values = valuesOf(placeholders, epoch);
  return walk(value, text => text.replace(PLACEHOLDER, key => {
    const found = values.get(key);
    if (found === undefined) throw new Error(`Missing recording placeholder ${key}.`);
    return found;
  }));
}

/** Match only identities actually supplied by this recording. An unrelated UUID remains a mismatch. */
export function normaliseReplayValue(value: unknown, placeholders: RecordingPlaceholders, epoch: string): RecordingJson {
  const known = new Map([...valuesOf(placeholders, epoch)].map(([key, item]) => [item, key]));
  return walk(value, text => text.replace(TOKENS, token => known.get(token) ?? token));
}
