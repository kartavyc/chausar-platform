/** Native driver stream taps. Replay uses the same driver parsers and cannot invoke the underlying tool. */
import { EventEmitter } from 'node:events';
import { StringDecoder } from 'node:string_decoder';
import { PassThrough, Writable } from 'node:stream';
import type { CodexChild } from '../agent-runtime/codex-rpc.ts';
import type { ClaudeQueryFactory } from '../agent-runtime/claude-driver.ts';
import { currentRun, type RunScope } from './scope.ts';
import { maskCaptureText } from './capture.ts';
import { ReplayDiverged, diffRecords } from './replay-run.ts';

type Frame = { direction: 'start' | 'in' | 'out' | 'close' | 'tool'; value?: unknown };
const remaining = new WeakMap<RunScope, Partial<Record<'codex' | 'claude', Frame[][]>>>();
function session(driver: 'codex' | 'claude', run: RunScope): Frame[] {
  let drivers = remaining.get(run); if (!drivers) { drivers = {}; remaining.set(run, drivers); }
  if (!drivers[driver]) {
    const sessions: Frame[][] = []; let current: Frame[] | undefined;
    for (const line of run.replay!.driverLines(driver)) {
      const frame = JSON.parse(line) as Frame;
      if (frame.direction === 'start') { current = [frame]; sessions.push(current); }
      else if (!current) throw new ReplayDiverged(`The ${driver} capture has no session start.`);
      else current.push(frame);
    }
    drivers[driver] = sessions;
    (run.checks ??= []).push(() => { if (sessions.length) throw new ReplayDiverged(`The capture still holds ${sessions.length} unused ${driver} sessions.`); });
  }
  const found = drivers[driver]!.shift();
  if (!found) throw new ReplayDiverged(`The code opened an extra ${driver} session.`);
  return found;
}
/** Keep a bijection for ephemeral UUIDs, including the user-message UUID Claude echoes. */
function frameMatcher(oldRoot?: string, newRoot?: string) {
  const ids = new Map<string, string>();
  const uuid = /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|(?<![a-f0-9])[a-f0-9]{64}(?![a-f0-9])/g;
  const text = (value: unknown) => maskCaptureText(JSON.stringify(safeDriverValue(value)));
  const rooted = (value: string) => oldRoot && newRoot ? value.split(JSON.stringify(oldRoot).slice(1, -1)).join(JSON.stringify(newRoot).slice(1, -1)) : value;
  const match = (left: unknown, right: unknown): boolean => {
    const a = rooted(text(left)), b = text(right), old = [...a.matchAll(uuid)].map(row => row[0]), fresh = [...b.matchAll(uuid)].map(row => row[0]);
    if (old.length !== fresh.length || a.replace(uuid, '<uuid>') !== b.replace(uuid, '<uuid>')) return false;
    for (const [index, id] of old.entries()) {
      const next = fresh[index]!;
      if (ids.has(id) && ids.get(id) !== next || !ids.has(id) && [...ids.values()].includes(next)) return false;
      ids.set(id, next);
    }
    return true;
  };
  return { match, answer: (value: unknown) => JSON.parse(rooted(JSON.stringify(value)).replace(uuid, id => ids.get(id) ?? id)) };
}
export function recordDriverFrame(run: RunScope, driver: 'codex' | 'claude', direction: Frame['direction'], value?: unknown) {
  try { run.recorder!.driver(driver, JSON.stringify({ direction, ...(value === undefined ? {} : { value: safeDriverValue(value) }) })); }
  catch (error) { run.failure ??= error; throw error; }
}
export function runCodexSpawn(spawn: () => CodexChild, jobRoot?: string): CodexChild {
  const run = currentRun(); if (!run) return spawn();
  run.driver = 'codex';
  if (run.recorder) {
    recordDriverFrame(run, 'codex', 'start', { jobRoot });
    const child = spawn(), decoder = new StringDecoder('utf8'); let pending = '', ended = false;
    (run.checks ??= []).push(() => { if (!ended) throw new ReplayDiverged('The captured Codex session is still open.'); });
    const write = child.stdin.write.bind(child.stdin);
    child.stdin.write = ((chunk: any, ...args: any[]) => {
      recordDriverFrame(run, 'codex', 'out', JSON.parse(String(chunk)));
      return (write as any)(chunk, ...args);
    }) as typeof child.stdin.write;
    child.stdout.on('data', chunk => {
      pending += decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      let end: number;
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end); pending = pending.slice(end + 1);
        try { recordDriverFrame(run, 'codex', 'in', JSON.parse(line)); }
        catch (error) { run.failure ??= error; child.kill(); }
      }
    });
    child.once('exit', () => { ended = true; try { recordDriverFrame(run, 'codex', 'close'); } catch { /* Refusal retained on the request scope. */ } });
    return child;
  }
  const frames = session('codex', run), start = frames.shift()!.value as { jobRoot?: string };
  const matcher = frameMatcher(start?.jobRoot, jobRoot); let cursor = 0, killed = false;
  (run.checks ??= []).push(() => { if (cursor !== frames.length) throw new ReplayDiverged('The captured Codex stream was not consumed.'); });
  const child = Object.assign(new EventEmitter(), { stdin: new Writable(), stdout: new PassThrough(), stderr: new PassThrough(), kill() {
    if (killed) return true; killed = true;
    if (frames[cursor]?.direction !== 'close' || cursor !== frames.length - 1) run.failure ??= new ReplayDiverged('The Codex session ended before its captured stream.');
    cursor++; queueMicrotask(() => child.emit('exit', 0)); return true;
  } });
  let pumping = false;
  const pump = async () => {
    if (pumping) return; pumping = true;
    try {
      while (!killed) {
        const frame = frames[cursor];
        if (frame?.direction === 'in') { cursor++; child.stdout.write(`${JSON.stringify(matcher.answer(frame.value))}\n`); }
        else if (frame?.direction === 'tool') { cursor++; await replayTool(run, frame.value, matcher); }
        else break;
      }
    } catch (error) { run.failure ??= error; child.emit('error', error); }
    finally { pumping = false; }
  };
  child.stdin = new Writable({ write(chunk, _encoding, callback) {
    try {
      const frame = frames[cursor++];
      if (frame?.direction !== 'out' || !matcher.match(frame.value, JSON.parse(String(chunk)))) throw new ReplayDiverged(`Codex request ${cursor} diverged from its captured stream.`);
      callback(); queueMicrotask(() => { void pump(); });
    } catch (error) { run.failure ??= error; callback(error as Error); }
  } });
  queueMicrotask(() => { void pump(); });
  return child;
}
export function runClaudeQuery(factory: ClaudeQueryFactory, input: Parameters<ClaudeQueryFactory>[0]): ReturnType<ClaudeQueryFactory> {
  const run = currentRun(); if (!run) return factory(input);
  run.driver = 'claude';
  if (run.recorder) {
    recordDriverFrame(run, 'claude', 'start', { jobRoot: input.options.cwd });
    const prompts = input.prompt; let ended = false;
    (run.checks ??= []).push(() => { if (!ended) throw new ReplayDiverged('The captured Claude session is still open.'); });
    const query = factory({ ...input, prompt: { async *[Symbol.asyncIterator]() { for await (const prompt of prompts) { recordDriverFrame(run, 'claude', 'out', prompt); yield prompt; } } } });
    return {
      interrupt: () => query.interrupt(), close: () => query.close(),
      ...(query.setMcpPermissionModeOverride ? { setMcpPermissionModeOverride: query.setMcpPermissionModeOverride.bind(query) } : {}),
      async *[Symbol.asyncIterator]() { try { for await (const message of query) { recordDriverFrame(run, 'claude', 'in', message); yield message; } } finally { ended = true; recordDriverFrame(run, 'claude', 'close'); } },
    };
  }
  const frames = session('claude', run), start = frames.shift()!.value as { jobRoot?: string };
  const matcher = frameMatcher(start?.jobRoot, input.options.cwd);
  const prompts = input.prompt[Symbol.asyncIterator]();
  let stopped = false, ended = false;
  (run.checks ??= []).push(() => { if (!ended) throw new ReplayDiverged('The captured Claude stream was not consumed.'); });
  return { interrupt: async () => { stopped = true; }, close: () => { stopped = true; }, async *[Symbol.asyncIterator]() {
    for (const frame of frames) {
      if (frame.direction === 'close') { ended = true; return; }
      if (stopped) { run.failure ??= new ReplayDiverged('Claude stopped before its captured stream.'); return; }
      if (frame.direction === 'out') {
        const prompt = await prompts.next();
        if (prompt.done || !matcher.match(frame.value, prompt.value)) { const error = new ReplayDiverged('Claude prompt diverged from its captured stream.'); run.failure ??= error; throw error; }
      } else if (frame.direction === 'tool') await replayTool(run, frame.value, matcher);
      else if (frame.direction === 'in') yield matcher.answer(frame.value) as any;
    }
    const error = new ReplayDiverged('The Claude capture has no session end.'); run.failure ??= error; throw error;
  } };
}

/** Omit only the ephemeral, trusted MCP transport capability. No general secret suppression. */
function safeDriverValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(safeDriverValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'CHAUSAR_AGENT_MCP_TOKEN').map(([key, item]) => [key,
    key === 'CHAUSAR_AGENT_MCP_SOCKET' ? '<sample-broker>' : safeDriverValue(item)]));
}
async function replayTool(run: RunScope, raw: unknown, matcher: ReturnType<typeof frameMatcher>) {
  try {
    const value = raw as { broker: number; session: string; request: unknown; response: unknown };
    const handle = run.tools?.get(value.broker);
    if (!handle) throw new ReplayDiverged('The captured tool call has no bound sample broker.');
    const answer = await handle(matcher.answer(value.request), value.session);
    if (!matcher.match(value.response, answer)) {
      const differences = diffRecords([matcher.answer(value.response)], [answer]);
      throw new ReplayDiverged(`The Chausar tool reply diverged from its capture at ${differences[0]?.split(':')[0] ?? 'reply shape'}.`);
    }
  } catch (error) { run.failure ??= error; throw error; }
}
