/**
 * Test-only join to the actual Engine and encrypted experimental file Vault.
 * Every workspace contains synthetic data in a verified temporary directory.
 * No transport, desktop bridge, native, provider, PostgreSQL or acquisition
 * integration is exercised or qualified by this fixture.
 *
 * The runtime is loaded through a checked non-literal import so it does not
 * enter the strict UI type graph. Replies cross the production UI validators;
 * this fixture does not manufacture dictionary or publication receipt DTOs.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import type { TestContext } from 'node:test';
import type { FirstRunMethod, FirstRunPort } from '../../src/screens/first-run/contracts.ts';
import type { FirstRunGuard } from '../../src/screens/first-run/controller.ts';
import type { TextDigest } from '../../src/screens/first-run/digest.ts';

export interface SyntheticActor {
  readonly memberId: string;
  readonly role: 'owner' | 'cofounder' | 'accountant' | 'viewer';
  readonly epoch: number;
  readonly channel: 'desktop';
}
export const ENGINE_JOIN_OWNER: SyntheticActor = Object.freeze({ memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' });
const PASSPHRASE = 'Synthetic actual Engine first-run join passphrase';
const TEMP_PREFIX = 'chausar-ui-first-run-engine-join-';
const ENGINE_MODULE = '../../../../platform/runtime/engine.ts';

interface ActualVault {
  read(): unknown;
  snapshot<T>(work: (state: unknown) => Promise<T>): Promise<T>;
  update<T>(change: (state: unknown) => T | Promise<T>): Promise<T>;
}
export interface ActualEngine {
  requestAs(actor: SyntheticActor, method: string, payload: unknown): Promise<unknown>;
  close(): Promise<void>;
  readonly vault: ActualVault | null;
}
type EngineConstructor = new (options: { directory: string; demo: true; storage: 'experimental-file' }) => ActualEngine;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const engineConstructor = (value: unknown): value is EngineConstructor => typeof value === 'function';
let loading: Promise<EngineConstructor> | null = null;

async function loadEngine(): Promise<EngineConstructor> {
  const specifier = ENGINE_MODULE;
  const loaded: unknown = await import(/* @vite-ignore */ specifier);
  if (!record(loaded) || !engineConstructor(loaded['Engine'])) throw new Error('The actual Engine constructor is unavailable.');
  return loaded['Engine'];
}

export const engineJoinSha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
export const engineJoinDigest: TextDigest = async text => engineJoinSha256(text);
export function engineJoinDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export interface EngineJoinGuard extends FirstRunGuard { set(value: boolean): void }
export function engineJoinGuard(): EngineJoinGuard {
  let active = true;
  return { live: () => active, set: value => { active = value; } };
}
export interface EngineJoinCall { readonly method: FirstRunMethod; readonly payload: unknown }
export type EngineJoinHook = (method: FirstRunMethod, payload: unknown, forward: () => Promise<unknown>) => Promise<unknown>;

export interface EngineJoinFixture {
  readonly directory: string;
  readonly engine: ActualEngine;
  readonly port: FirstRunPort;
  readonly calls: EngineJoinCall[];
  count(method: FirstRunMethod): number;
  intercept(hook: EngineJoinHook | null): void;
  request(method: string, payload?: unknown, actor?: SyntheticActor): Promise<unknown>;
  ciphertext(): Promise<Buffer>;
  /** Register gates and accepted requests so a failed assertion cannot strand the Engine during cleanup. */
  releaseOnCleanup(release: () => void): void;
  track<T>(pending: Promise<T>): Promise<T>;
  holdVaultQueue(): Promise<{ release(): void; drained: Promise<void> }>;
  lock(): Promise<void>;
  reopen(): Promise<void>;
}

export async function actualEngineJoin(t: TestContext): Promise<EngineJoinFixture> {
  loading ??= loadEngine();
  const Engine = await loading;
  const base = await realpath(tmpdir());
  const directory = await realpath(await mkdtemp(join(base, TEMP_PREFIX)));
  const child = relative(base, directory);
  assert.equal(dirname(directory), base);
  assert.ok(child && !isAbsolute(child) && !child.startsWith('..') && child.startsWith(TEMP_PREFIX));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  assert.equal(typeof engine.requestAs, 'function'); assert.equal(typeof engine.close, 'function');
  const releases: Array<() => void> = [];
  const pending: Promise<unknown>[] = [];
  const track = <T>(request: Promise<T>): Promise<T> => {
    pending.push(request);
    // Some tests lose an accepted reply intentionally; keep that request observed.
    void request.catch(() => {});
    return request;
  };
  t.after(async () => {
    for (const release of releases) release();
    await Promise.allSettled(pending);
    await engine.close();
    const actual = await realpath(directory), actualChild = relative(base, actual);
    assert.equal(dirname(actual), base);
    assert.equal(actual, directory);
    assert.ok(actualChild && !isAbsolute(actualChild) && !actualChild.startsWith('..') && actualChild.startsWith(TEMP_PREFIX));
    await rm(actual, { recursive: true, force: true });
  });
  await engine.requestAs(ENGINE_JOIN_OWNER, 'workspace.create', {
    name: 'Synthetic actual Engine first-run join', passphrase: PASSPHRASE, dictionaryMode: 'deferred', demo: false,
  });
  let hook: EngineJoinHook | null = null;
  const calls: EngineJoinCall[] = [];
  const port: FirstRunPort = {
    async request(method, payload) {
      calls.push({ method, payload: structuredClone(payload) });
      const forward = () => engine.requestAs(ENGINE_JOIN_OWNER, method, payload);
      return hook === null ? forward() : hook(method, payload, forward);
    },
  };
  return {
    directory, engine, port, calls, track,
    count: method => calls.filter(call => call.method === method).length,
    intercept: next => { hook = next; },
    request: (method, payload = {}, actor = ENGINE_JOIN_OWNER) => engine.requestAs(actor, method, payload),
    ciphertext: () => readFile(join(directory, 'main', 'authority.encrypted.json')),
    releaseOnCleanup: release => { releases.push(release); },
    async holdVaultQueue() {
      assert.ok(engine.vault);
      const reached = engineJoinDeferred<void>(), gate = engineJoinDeferred<void>();
      const release = () => gate.resolve(undefined);
      releases.push(release);
      const drained = track(engine.vault.snapshot(async () => { reached.resolve(undefined); await gate.promise; }));
      await reached.promise;
      return { release, drained };
    },
    async lock() { await engine.requestAs(ENGINE_JOIN_OWNER, 'workspace.lock', {}); },
    async reopen() { await engine.requestAs(ENGINE_JOIN_OWNER, 'workspace.open', { passphrase: PASSPHRASE }); },
  };
}
