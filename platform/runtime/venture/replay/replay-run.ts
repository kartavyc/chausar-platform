// D11e: replaying a captured run against today's code. createRunReplay answers a run's model calls, driver streams,
// fetches and clock readings from the capture, in the captured order, and says exactly which call diverged when the
// code asks for something else. diffRecords compares the records a replay made with the captured ones after ids,
// times and digests are named by first appearance, and prints one readable line per difference. The engine and driver
// hooks that let a whole run take these answers come after the rebase (D11e); scripts/replay-run.mjs uses this module.
import { ChausarError } from '../../contracts.ts';
import { maskContacts } from '../network/protected.ts';
import { RUN_CAPTURE_FORMAT, type CaptureEvent, type RunCapture } from './capture.ts';

/** A capture read back from its file: the format, the sample label and the event shapes are checked. */
export function readRunCapture(value: unknown): RunCapture {
  const capture = value as RunCapture;
  const fail = (why: string) => { throw new ChausarError('CAPTURE_INVALID', `This is not a run capture: ${why}.`); };
  if (!capture || typeof capture !== 'object') fail('not an object');
  if (capture.format !== RUN_CAPTURE_FORMAT) fail(`the format is not ${RUN_CAPTURE_FORMAT}`);
  if (capture.label !== 'sample business') fail('it is not labelled sample business');
  if (!Array.isArray(capture.events) || !Array.isArray(capture.records)) fail('it has no events or records list');
  for (const event of capture.events as CaptureEvent[]) {
    const ok = event?.kind === 'model' ? typeof event.purpose === 'string' && typeof event.request === 'string' && typeof event.answer === 'string'
      : event?.kind === 'driver' ? (event.driver === 'codex' || event.driver === 'claude') && typeof event.line === 'string'
      : event?.kind === 'fetch' ? typeof event.url === 'string' && Number.isInteger(event.status) && typeof event.body === 'string'
      : event?.kind === 'clock' ? typeof event.at === 'string' : false;
    if (!ok) fail('an event has the wrong shape');
  }
  return capture;
}

export class ReplayDiverged extends ChausarError {
  constructor(message: string) { super('REPLAY_DIVERGED', message); }
}

export type RunReplay = {
  model(purpose: string, request: string): string;
  driverLines(driver: 'codex' | 'claude'): string[];
  fetch(url: string): { status: number; body: string };
  now(): string;
  /** Throws when the run asked for less than the capture holds. */
  done(): void;
};

/** Answers a run from a capture, each kind in its captured order. */
export function createRunReplay(capture: RunCapture): RunReplay {
  const of = <K extends CaptureEvent['kind']>(kind: K) => capture.events.filter((event): event is Extract<CaptureEvent, { kind: K }> => event.kind === kind);
  const models = of('model'), fetches = of('fetch'), clocks = of('clock');
  const drivers = { codex: of('driver').filter(event => event.driver === 'codex'), claude: of('driver').filter(event => event.driver === 'claude') };
  const used = { model: 0, fetch: 0, clock: 0, codex: 0, claude: 0 };
  const short = (text: string) => (text.length > 120 ? `${text.slice(0, 117)}...` : text);
  return {
    model(purpose, request) {
      const index = used.model++;
      const captured = models[index];
      if (!captured) throw new ReplayDiverged(`Model call ${index + 1} (${purpose}) was not in the capture: the code now makes more model calls.`);
      const asked = maskContacts(request);
      if (captured.purpose !== purpose) throw new ReplayDiverged(`Model call ${index + 1} diverged: the capture has purpose ${captured.purpose}, the code asked for ${purpose}.`);
      if (captured.request !== asked) throw new ReplayDiverged(`Model call ${index + 1} (${purpose}) diverged: the request changed.\n  captured: ${short(captured.request)}\n  now:      ${short(asked)}`);
      return captured.answer;
    },
    driverLines(driver) {
      const lines = drivers[driver].slice(used[driver]).map(event => event.line);
      used[driver] = drivers[driver].length;
      return lines;
    },
    fetch(url) {
      const index = used.fetch++;
      const captured = fetches[index];
      if (!captured || captured.url !== maskContacts(url)) throw new ReplayDiverged(`Fetch ${index + 1} diverged: the capture has ${captured ? captured.url : 'no fetch here'}, the code fetched ${url}.`);
      return { status: captured.status, body: captured.body };
    },
    now() {
      const captured = clocks[used.clock++];
      if (!captured) throw new ReplayDiverged(`Clock reading ${used.clock} was not in the capture: the code now reads the clock more often.`);
      return captured.at;
    },
    done() {
      const left = [['model call', models.length - used.model], ['fetch', fetches.length - used.fetch], ['clock reading', clocks.length - used.clock]].filter(([, count]) => Number(count) > 0);
      if (left.length) throw new ReplayDiverged(`The run ended early: the capture still holds ${left.map(([name, count]) => `${count} ${name}${count === 1 ? '' : 's'}`).join(', ')}.`);
    },
  };
}

const ID = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*_[A-Za-z0-9-]{6,}$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const DIGEST = /^[a-f0-9]{64}$/;

/** Records with each distinct id, time and 64-hex digest named by first appearance: <id-1>, <time-1>, <digest-1>. */
export function normaliseRecords(records: unknown): unknown {
  const names = new Map<string, string>(), counts = { id: 0, time: 0, digest: 0 };
  const name = (value: string, kind: keyof typeof counts) => {
    if (!names.has(value)) names.set(value, `<${kind}-${++counts[kind]}>`);
    return names.get(value)!;
  };
  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') return TIME.test(value) ? name(value, 'time') : DIGEST.test(value) ? name(value, 'digest') : ID.test(value) ? name(value, 'id') : value;
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item)]));
    return value;
  };
  return walk(records);
}

/** One line per difference between two record lists, after normalising both: `records[2].status: "draft" -> "sent"`. */
export function diffRecords(captured: unknown[], replayed: unknown[]): string[] {
  const lines: string[] = [];
  const walk = (path: string, left: unknown, right: unknown) => {
    if (JSON.stringify(left) === JSON.stringify(right)) return;
    const plain = (value: unknown) => value === undefined ? '(none)' : JSON.stringify(value);
    if (left && right && typeof left === 'object' && typeof right === 'object' && Array.isArray(left) === Array.isArray(right)) {
      const keys = Array.isArray(left) ? Array.from({ length: Math.max(left.length, (right as unknown[]).length) }, (_, index) => index)
        : [...new Set([...Object.keys(left), ...Object.keys(right as object)])].sort();
      for (const key of keys) walk(Array.isArray(left) ? `${path}[${key}]` : `${path}.${key}`, (left as any)[key], (right as any)[key]);
      return;
    }
    lines.push(`${path}: ${plain(left)} -> ${plain(right)}`);
  };
  walk('records', normaliseRecords(captured), normaliseRecords(replayed));
  return lines;
}
