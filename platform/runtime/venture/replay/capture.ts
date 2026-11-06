// D11e: capturing one run so it can be replayed against later code (developer-only, sample businesses only). A capture
// holds the starting State, every model answer, the agent drivers' event lines, every fetched answer and every clock
// reading, in order, then the records the run made. Every text passes maskContacts first; a capture that still holds a
// key, a token or another secret is refused and never written. The engine's `capture: { dir }` option (never an
// environment variable, never passed by worker.ts, server.ts or hosted/server.ts) and the driver hooks that feed this
// recorder come after the rebase; this module is the recorder and the file.
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { refuseInsideRepo } from '../../run-root.mjs';
import { ChausarError } from '../../portable.ts';
import { encodePublicRecords } from './public-bytes.ts';
import { maskContacts } from '../network/protected.ts';
import { secretFindings } from '../core/secrets.ts';

export const RUN_CAPTURE_FORMAT = 'chausar-run-capture/1';

export type CaptureEvent =
  | { kind: 'model'; purpose: string; request: string; answer: string }
  | { kind: 'driver'; driver: 'codex' | 'claude'; line: string }
  | { kind: 'fetch'; url: string; status: number; body: string }
  | { kind: 'clock'; at: string };

export type RunCapture = {
  format: typeof RUN_CAPTURE_FORMAT;
  /** Captures are made on sample businesses only; the label says so and a replay checks it. */
  label: 'sample business';
  capturedAt: string;
  startState: unknown;
  operation?: { method: string; payload: Record<string, unknown> };
  events: CaptureEvent[];
  records: unknown[];
};

export type RunRecorder = {
  model(purpose: string, request: string, answer: string): void;
  driver(driver: 'codex' | 'claude', line: string): void;
  fetch(url: string, status: number, body: string): void;
  clock(at: string): void;
  finish(records: unknown[]): RunCapture;
};

/** Refuses a text that holds a secret, by kind only (never the value). */
function refuseSecrets(where: string, text: string): void {
  const found = secretFindings(text);
  if (found.length) throw new ChausarError('CAPTURE_REFUSED', `A run capture cannot hold a secret: ${where} holds ${[...new Set(found)].join(', ')}.`);
}

/** Contact masking must not turn a digest or UUID into a phone number. */
export function maskCaptureText(text: string): string {
  return text.split(/((?<![a-f0-9])(?:[a-f0-9]{64}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(?![a-f0-9]))/g)
    .map((part, index) => index % 2 ? part : maskContacts(part)).join('');
}
export const assertCaptureText = (text: string) => refuseSecrets('the request', text);
const masked = (where: string, text: string) => {
  refuseSecrets(where, text);
  const out = maskCaptureText(String(text));
  refuseSecrets(where, out);
  return out;
};

/** A recorder for one run. Each call masks contacts and refuses secrets at once, so a bad text never sits in memory. */
export function createRunRecorder({ startState, capturedAt }: { startState: unknown; capturedAt: string }): RunRecorder {
  const start = JSON.parse(masked('the starting State', JSON.stringify(encodePublicRecords(startState ?? null))));
  const events: CaptureEvent[] = [];
  let finished = false;
  let refused = false;
  const clean = (where: string, text: string) => { try { return masked(where, text); } catch (error) { refused = true; throw error; } };
  const open = () => { if (refused) throw new ChausarError('CAPTURE_REFUSED', 'This run capture previously held a secret.'); if (finished) throw new ChausarError('CAPTURE_FINISHED', 'This run capture is already finished.'); };
  return {
    model(purpose, request, answer) { open(); events.push({ kind: 'model', purpose, request: clean(`model call ${events.length + 1} (request)`, request), answer: clean(`model call ${events.length + 1} (answer)`, answer) }); },
    driver(driver, line) { open(); events.push({ kind: 'driver', driver, line: clean(`a ${driver} driver line`, line) }); },
    fetch(url, status, body) { open(); events.push({ kind: 'fetch', url: clean('a fetched address', url), status, body: clean(`the answer from ${url}`, body) }); },
    clock(at) { open(); events.push({ kind: 'clock', at }); },
    finish(records) {
      open();
      finished = true;
      const capture: RunCapture = { format: RUN_CAPTURE_FORMAT, label: 'sample business', capturedAt, startState: start, events, records: JSON.parse(clean('the resulting records', JSON.stringify(encodePublicRecords(records)))) };
      refuseSecrets('the capture', JSON.stringify(capture));
      return capture;
    },
  };
}

/** Writes a finished capture into dir as run-<time>.capture.json (through a temporary file and a rename). */
export async function writeRunCapture(dir: string, capture: RunCapture): Promise<string> {
  dir = refuseInsideRepo(dir, { variable: 'capture.dir' });
  const text = `${JSON.stringify(capture, null, 2)}\n`;
  refuseSecrets('the capture', text);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `run-${capture.capturedAt.replace(/[^0-9TZ]/g, '')}.capture.json`);
  await writeFile(`${path}.tmp`, text, { flag: 'wx' });
  await rename(`${path}.tmp`, path);
  return path;
}
