/** D11d: a strict client for checked-in, real-engine test recordings. Never imported by the app entry. */
import { hydrateRecordingValue, normaliseReplayValue, type RecordingJson, type RpcRecording } from '../../../../platform/shared/rpc-recording';
import { EngineError, type EngineClient, type MethodName, type ParamsOf, type ResultOf, type UiRunEvent } from './types';

export type ScriptedClient = EngineClient & { assertComplete(): void };

function stable(value: RecordingJson): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key]!)}`).join(',')}}`;
  return JSON.stringify(value);
}

export function createScriptedClient(recording: RpcRecording): ScriptedClient {
  if (recording.format !== 'chausar-rpc-recording/1') throw new Error('Unsupported RPC recording.');
  const listeners = new Set<(event: UiRunEvent) => void>();
  const waiting = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const violations: string[] = [];
  const deliveries: (() => void)[] = [];
  let cursor = 0;
  let scheduled = false;
  const hydrate = (value: RecordingJson) => hydrateRecordingValue(value, recording.placeholders, recording.epoch);

  const drain = () => {
    while (cursor < recording.frames.length) {
      const frame = recording.frames[cursor]!;
      if (frame.kind === 'request') break;
      cursor++;
      if (frame.kind === 'event') {
        const event = hydrate(frame.event) as unknown as UiRunEvent;
        deliveries.push(() => { for (const listener of [...listeners]) listener(event); });
      } else {
        const pending = waiting.get(frame.id);
        if (!pending) throw new Error(`Recording answer ${frame.id} has no request.`);
        const answer = frame.kind === 'answer' ? hydrate(frame.result) : null;
        const failure = frame.kind === 'error' ? hydrate(frame.error as unknown as RecordingJson) as unknown as { code: string; message: string; owner?: boolean; reason?: string } : null;
        deliveries.push(() => {
          waiting.delete(frame.id);
          if (failure) pending.reject(new EngineError(failure.code, failure.message, failure.reason, failure.owner));
          else pending.resolve(structuredClone(answer));
        });
      }
    }
    if (!scheduled && deliveries.length) {
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        const batch = deliveries.splice(0);
        for (const deliver of batch) deliver();
      });
    }
  };

  return {
    transport: 'fake',
    status: () => ({ state: 'ok' }),
    onStatus: () => () => {},
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    request<M extends MethodName>(method: M, payload?: ParamsOf<M>): Promise<ResultOf<M>> {
      const actual = normaliseReplayValue(payload ?? {}, recording.placeholders, recording.epoch);
      const frame = recording.frames[cursor];
      if (!frame || frame.kind !== 'request' || frame.method !== method || stable(frame.payload) !== stable(actual)) {
        const expected = frame?.kind === 'request' ? `${frame.method} ${stable(frame.payload)}` : 'the end of the recording';
        const message = `Expected ${expected}\nReceived ${method} ${stable(actual)}`;
        violations.push(message);
        return Promise.reject(new Error(message));
      }
      cursor++;
      return new Promise((resolve, reject) => {
        waiting.set(frame.id, { resolve: value => resolve(value as ResultOf<M>), reject });
        drain();
      });
    },
    assertComplete() {
      if (violations.length) throw new Error(`Unexpected scripted requests:\n${violations.join('\n')}`);
      if (cursor !== recording.frames.length || waiting.size || deliveries.length) throw new Error(`Recording has unconsumed frames or answers: ${recording.frames.length - cursor} frames, ${waiting.size} answers.`);
    },
  };
}
