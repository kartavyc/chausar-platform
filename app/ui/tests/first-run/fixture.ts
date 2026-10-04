/**
 * Test-only synthetic Engine port for the first-run slice. No vault, transport, native
 * IPC, network, model or real business data: the packs are the Engine's own
 * `starterPacks`, publication uses the Engine's own `compileDictionary`, and the
 * contextKey is a hash over the synthetic seat and the synthetic ontology, so a
 * publish changes it exactly as the real `ui.context` does. Nothing in app code
 * imports this file.
 *
 * The frozen Engine module is loaded at runtime through a checked boundary (a dynamic
 * import with a non-literal specifier), so the backend never enters the strict UI test
 * type graph; its exports are shape-checked before use and its raw values are the ground
 * truth that the slice's validators are tested against.
 */

import { createHash } from 'node:crypto';
import { validatePacks, validatePublished } from '../../src/screens/first-run/contracts.ts';
import type { DictionaryDraft, FirstRunMethod, FirstRunPort, PublishedDictionary } from '../../src/screens/first-run/contracts.ts';
import type { FirstRunGuard } from '../../src/screens/first-run/controller.ts';
import type { TextDigest } from '../../src/screens/first-run/digest.ts';

export type Role = 'owner' | 'cofounder' | 'accountant' | 'viewer';
export interface Call { readonly method: FirstRunMethod; readonly payload: unknown }
/** Return a value to replace the default reply, or undefined to use it. `defaults()` applies the default, including a real synthetic commit. */
export type Reply = (method: FirstRunMethod, payload: unknown, defaults: () => unknown) => unknown;

export const WORKSPACE = Object.freeze({ id: 'workspace_fixture', name: 'Synthetic first-run fixture', demo: true });
export const MEMBER_ID = 'member_fixture';
export const MEMBER_NAME = 'Fixture seat';
export const ENGINE_PACK_IDS = Object.freeze(['ecommerce', 'retail', 'services', 'distributor', 'manufacturing', 'saas']);
export const refusal = (code: string): Error & { code: string } => Object.assign(new Error(code), { code });

/** SHA-256 hex with Node's own implementation: the independent check for every digest and hash the slice computes. */
export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
export const nodeDigest: TextDigest = async text => sha256(text);

/** The frozen Engine behind a checked boundary. */
export interface FrozenEngine {
  /** The Engine's `starterPacks`, cloned raw. */
  rawPacks(): unknown[];
  rawPack(index: number): Record<string, unknown>;
  /** The Engine's `compileDictionary`, raw result, cloned. */
  compileRaw(draft: unknown, version: number, publishedBy: string, publishedAt?: string): Record<string, unknown>;
  /** The starter packs through the slice's own validator, for typed expectations. */
  packs(): readonly DictionaryDraft[];
  pack(index: number): DictionaryDraft;
  compile(draft: DictionaryDraft, version: number, publishedBy?: string, publishedAt?: string): PublishedDictionary;
  /**
   * The Engine's own `assertCompiledSingleSum` (compiled-calculation.ts): the artifact as received against the
   * published operation id, definition and revision. Returns null when the Engine accepts it, else the Engine's code.
   */
  assertCompiledSum(artifact: unknown, operationId: string, definition: unknown, version: number): string | null;
}

type Compiler = (draft: unknown, version: number, publishedBy: string, publishedAt?: string) => unknown;
type Asserter = (artifact: unknown, operationId: string, definition: unknown, version: number) => void;
const isCompiler = (value: unknown): value is Compiler => typeof value === 'function';
const isAsserter = (value: unknown): value is Asserter => typeof value === 'function';
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

const ENGINE_MODULE = '../../../../platform/runtime/ontology.ts';
const COMPILER_MODULE = '../../../../platform/runtime/compiled-calculation.ts';
let loading: Promise<FrozenEngine> | null = null;

async function loadFrozenEngine(): Promise<FrozenEngine> {
  const specifier = ENGINE_MODULE;
  const loaded: unknown = await import(/* @vite-ignore */ specifier);
  if (!isRecord(loaded)) throw new Error('The frozen Engine module did not load as a module namespace.');
  const starterPacks = loaded['starterPacks'];
  const compileDictionary = loaded['compileDictionary'];
  if (!Array.isArray(starterPacks) || !isCompiler(compileDictionary)) throw new Error('The frozen Engine does not export starterPacks and compileDictionary.');
  const compilerSpecifier = COMPILER_MODULE;
  const compiler: unknown = await import(/* @vite-ignore */ compilerSpecifier);
  if (!isRecord(compiler)) throw new Error('The frozen Engine compiler module did not load as a module namespace.');
  const assertCompiledSingleSum = compiler['assertCompiledSingleSum'];
  if (!isAsserter(assertCompiledSingleSum)) throw new Error('The frozen Engine compiler does not export assertCompiledSingleSum.');
  const assertCompiledSum = (artifact: unknown, operationId: string, definition: unknown, version: number): string | null => {
    try { assertCompiledSingleSum(structuredClone(artifact), operationId, structuredClone(definition), version); return null; }
    catch (error) {
      const code = isRecord(error) ? error['code'] : undefined;
      return typeof code === 'string' ? code : 'UNKNOWN_ENGINE_ERROR';
    }
  };
  const rawPacks = (): unknown[] => structuredClone(starterPacks);
  const rawPack = (index: number): Record<string, unknown> => {
    const item: unknown = rawPacks()[index];
    if (!isRecord(item)) throw new Error(`No Engine starter pack at index ${index}.`);
    return item;
  };
  const compileRaw = (draft: unknown, version: number, publishedBy: string, publishedAt?: string): Record<string, unknown> => {
    const result = publishedAt === undefined ? compileDictionary(structuredClone(draft), version, publishedBy) : compileDictionary(structuredClone(draft), version, publishedBy, publishedAt);
    if (!isRecord(result)) throw new Error('The frozen Engine compiler did not return a dictionary object.');
    return structuredClone(result);
  };
  const packs = () => validatePacks(rawPacks());
  return Object.freeze({
    rawPacks, rawPack, compileRaw, packs, assertCompiledSum,
    pack: (index: number) => { const item = packs()[index]; if (item === undefined) throw new Error(`No Engine starter pack at index ${index}.`); return item; },
    compile: (draft: DictionaryDraft, version: number, publishedBy = MEMBER_ID, publishedAt?: string) => validatePublished(compileRaw(draft, version, publishedBy, publishedAt)),
  });
}

/** The frozen Engine, loaded once per process. */
export function engine(): Promise<FrozenEngine> {
  loading ??= loadFrozenEngine();
  return loading;
}

/** A raw dictionary with its overall Engine hash recomputed over its (possibly altered) content, same key order. */
export function rehashed(dictionary: Record<string, unknown>): Record<string, unknown> {
  const content: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(dictionary)) if (key !== 'hash') content[key] = value;
  return { ...content, hash: sha256(JSON.stringify(content)) };
}

export interface SyntheticEngine {
  readonly port: FirstRunPort;
  readonly calls: Call[];
  methods(): FirstRunMethod[];
  count(method: FirstRunMethod): number;
  /** Replace the default reply for the next requests. */
  onRequest(reply: Reply | null): void;
  setRole(role: Role): void;
  bumpEpoch(): void;
  /** Some other Engine state changed: the contextKey moves, the seat and the dictionary stay. */
  touch(): void;
  current(): PublishedDictionary | null;
  /** Commit a draft directly, as the Engine would, without going through the port. Returns the validated dictionary. */
  commit(draft: unknown, publishedBy?: string): PublishedDictionary;
  /** The same, returning the raw compiled object for tampering. */
  commitRaw(draft: unknown, publishedBy?: string): Record<string, unknown>;
  contextKey(): string;
}

export async function syntheticEngine(options: { role?: Role; current?: unknown } = {}): Promise<SyntheticEngine> {
  const frozen = await engine();
  let role: Role = options.role ?? 'owner';
  let epoch = 1;
  let touched = 0;
  const initial: unknown = options.current ?? null;
  let ontology: { current: unknown; history: unknown[] } = { current: initial, history: initial === null ? [] : [initial] };
  let override: Reply | null = null;
  const calls: Call[] = [];
  const contextKey = () => sha256(JSON.stringify({ kind: 'synthetic-first-run-context', workspace: WORKSPACE.id, member: { id: MEMBER_ID, role, epoch }, ontology, touched }));
  const currentVersion = (): number => {
    const item = ontology.current;
    return isRecord(item) && typeof item['version'] === 'number' ? item['version'] : 0;
  };
  const commitRaw = (draft: unknown, publishedBy = MEMBER_ID): Record<string, unknown> => {
    const compiled = frozen.compileRaw(draft, currentVersion() + 1, publishedBy);
    ontology = { current: compiled, history: [...ontology.history, compiled] };
    return structuredClone(compiled);
  };
  const defaults = (method: FirstRunMethod, payload: unknown): unknown => {
    switch (method) {
      case 'ui.context':
        return { workspace: { ...WORKSPACE }, member: { id: MEMBER_ID, name: MEMBER_NAME, role, epoch, branches: ['*'] }, contextKey: contextKey() };
      case 'ontology.packs':
        return frozen.rawPacks();
      case 'ontology.get':
        return structuredClone(ontology);
      case 'ontology.publish': {
        if (role !== 'owner' && role !== 'cofounder') throw refusal('ACCESS_DENIED');
        const body = isRecord(payload) ? payload : {};
        return commitRaw(body['draft']);
      }
    }
  };
  const port: FirstRunPort = {
    async request(method, payload) {
      calls.push({ method, payload: structuredClone(payload) });
      if (override !== null) {
        const value = await override(method, payload, () => defaults(method, payload));
        if (value !== undefined) return value;
      }
      return defaults(method, payload);
    },
  };
  return {
    port, calls,
    methods: () => calls.map(call => call.method),
    count: method => calls.filter(call => call.method === method).length,
    onRequest: reply => { override = reply; },
    setRole: next => { role = next; },
    bumpEpoch: () => { epoch += 1; },
    touch: () => { touched += 1; },
    current: () => (ontology.current === null ? null : validatePublished(structuredClone(ontology.current))),
    commit: (draft, publishedBy) => validatePublished(commitRaw(draft, publishedBy)),
    commitRaw,
    contextKey,
  };
}

export interface TestGuard extends FirstRunGuard { set(live: boolean): void }
export function guard(initial = true): TestGuard {
  let live = initial;
  return { live: () => live, set: next => { live = next; } };
}

export function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** A digest that can hold its next call open, so a test can change Engine state during an await. */
export function gatedDigest(): { digest: TextDigest; holdNext(): { release: () => void; held: Promise<void> } } {
  let next: { open: Promise<void>; reached: () => void } | null = null;
  const digest: TextDigest = async text => {
    if (next !== null) {
      const gate = next;
      next = null;
      gate.reached();
      await gate.open;
    }
    return sha256(text);
  };
  return {
    digest,
    holdNext() {
      const open = deferred<void>();
      const reached = deferred<void>();
      next = { open: open.promise, reached: () => reached.resolve(undefined) };
      return { release: () => open.resolve(undefined), held: reached.promise };
    },
  };
}

export async function settle(ticks = 32): Promise<void> {
  for (let i = 0; i < ticks; i++) await Promise.resolve();
}

/** Waits until the synthetic port has counted `expected` calls of `method`, so an issued call is proven issued. */
export async function issued(fixture: SyntheticEngine, method: FirstRunMethod, expected: number): Promise<boolean> {
  for (let i = 0; i < 256 && fixture.count(method) < expected; i++) await Promise.resolve();
  return fixture.count(method) === expected;
}
