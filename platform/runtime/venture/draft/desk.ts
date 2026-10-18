// Chausar venture launcher, the draft desk: AI and plan state before any vault exists (onboarding spec 2.2, 2.3).
// One per engine process, memory only. Keys sit on a memory-only shelf, the connection and call records in an
// in-memory store, and one compose session at a time. The same model port code as the vault serves it, so every
// rule holds before the vault too: calls recorded before they are sent, the monthly cap, the consent digest, the
// client-data guard and one dispatch per call. Idle for sixty minutes (while running) wipes it all.
import { readFile } from 'node:fs/promises';
import { ChausarError, check, type Context } from '../../contracts.ts';
import { DRAFT_METHODS } from '../contracts.ts';
import type { ModelPort, ModelReplayFixture, ModelTransport, SecretShelf, VentureDeps, VentureEngineServices, VentureHostOptions } from '../contracts.ts';
import { DRAFT_IDLE_MS } from '../onboarding-contracts.ts';
import type { DraftHandoverPort } from '../onboarding-contracts.ts';
import { isAppChannel } from '../records.ts';
import { createSecretShelf } from '../host.ts';
import { countryProfile } from '../core/countries.ts';
import { createModelPort, createReplayTransport, defaultModelTransport } from '../models/index.ts';
import { DRAFT_HANDLERS, type ComposeSession, type DeskHandle } from './handlers.ts';
import { createHandover } from './handover.ts';
import { DraftStore } from './store.ts';

export type DraftDeskOptions = VentureHostOptions & {
  demo: boolean;
  /** True when the open vault already holds a venture: every draft method then refuses VENTURE_EXISTS. */
  ventureExists: () => boolean;
  /** True while any vault is open: the idle timer stays paused (the resume path, and Keep it safe). */
  vaultOpen: () => boolean;
};

export const VENTURE_EXISTS_WORDS = 'Your business already has its AI settings under Trust.';
const HOSTED_WORDS = 'The hosted web app adds your AI after you keep your business.';

type Parts = { store: DraftStore; shelf: SecretShelf; deps: VentureDeps };

/** The desk never reaches the engine's own services: it has no vault, books or trust settings. */
const NO_SERVICES: VentureEngineServices = Object.freeze({
  calculator: { calculate: async () => { throw new ChausarError('NOT_BUILT_YET', 'There is no vault yet.'); }, receipt: () => { throw new ChausarError('NOT_BUILT_YET', 'There is no vault yet.'); } },
  ontology: { current: () => null, publish: async () => { throw new ChausarError('NOT_BUILT_YET', 'There is no vault yet.'); } },
  trust: { updatePolicy: async () => { throw new ChausarError('NOT_BUILT_YET', 'There is no vault yet.'); } },
});

export class DraftDesk {
  #options: DraftDeskOptions;
  #clock: () => Date;
  #parts: Parts | null = null;
  #pending: Promise<Parts> | null = null;
  #session: ComposeSession | null = null;
  #lastTouch: number | null = null;
  #held = false;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #generation = 0;
  readonly handover: DraftHandoverPort;

  constructor(options: DraftDeskOptions) {
    this.#options = options;
    this.#clock = options.clock ?? (() => new Date());
    this.handover = createHandover({
      parts: () => (this.#parts ? { store: this.#parts.store, shelf: this.#parts.shelf } : null),
      session: () => this.#session,
      clear: () => this.clear(),
    });
  }

  /** Answers one draft method for the owner inside the app. */
  async request(ctx: Context, method: string, payload: unknown): Promise<unknown> {
    check((DRAFT_METHODS as readonly string[]).includes(method), 'INVALID_VENTURE_REQUEST', 'This venture request is not supported.');
    check(this.#options.host !== 'hosted-web', 'HOSTED_NOT_AVAILABLE', HOSTED_WORDS);
    check(!this.#options.ventureExists(), 'VENTURE_EXISTS', VENTURE_EXISTS_WORDS);
    check(isAppChannel(ctx), 'APP_APPROVAL_REQUIRED', 'Do this inside the Chausar app.');
    check(ctx.role === 'owner' || ctx.role === 'cofounder', 'FORBIDDEN', 'An owner sets up the AI and the plan.');
    this.#expireIfIdle();
    this.#touch();
    const generation = this.#generation;
    const parts = await this.#ready();
    const handle: DeskHandle = {
      deps: parts.deps,
      now: () => this.#clock(),
      idleUntil: () => this.#idleUntil(),
      session: () => (this.#generation === generation ? this.#session : null),
      keep: session => { if (this.#generation === generation && this.#parts === parts) this.#session = session; },
    };
    const handler = DRAFT_HANDLERS[method];
    check(handler, 'NOT_BUILT_YET', 'This part of Chausar is not built yet.');
    return handler(handle, payload ?? {});
  }

  /** workspace.create succeeded: reset the idle timer and pause it while the owner keeps the plan safe. */
  hold(): void {
    this.#held = true;
    this.#lastTouch = this.#clock().getTime();
    this.#stopTimer();
  }

  /** Wipes the shelf, the store and the session, and ends any pause. The next request starts fresh. */
  clear(): void {
    this.#generation += 1;
    this.#parts?.shelf.clear();
    this.#parts = null;
    this.#pending = null;
    this.#session = null;
    this.#lastTouch = null;
    this.#held = false;
    this.#stopTimer();
  }

  #paused(): boolean {
    return this.#held || this.#options.vaultOpen();
  }

  #connected(): boolean {
    const store = this.#parts?.store;
    return !!store && store.read().conversations.some(record => record?.kind === 'venture-model-connection' && record.status === 'connected');
  }

  #idleUntil(): string | null {
    if (this.#paused() || this.#lastTouch === null || !this.#connected()) return null;
    return new Date(this.#lastTouch + DRAFT_IDLE_MS).toISOString();
  }

  #expireIfIdle(): void {
    if (this.#paused() || this.#lastTouch === null) return;
    if (this.#clock().getTime() - this.#lastTouch >= DRAFT_IDLE_MS) this.clear();
  }

  #touch(): void {
    this.#lastTouch = this.#clock().getTime();
    this.#stopTimer();
    if (this.#paused()) return;
    // A real timer too, so keys never linger in memory longer than the idle limit. Never keeps the process alive.
    const timer = setTimeout(() => { this.#timer = null; this.#expireIfIdle(); }, DRAFT_IDLE_MS + 1000);
    timer.unref?.();
    this.#timer = timer;
  }

  #stopTimer(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  #ready(): Promise<Parts> {
    if (this.#parts) return Promise.resolve(this.#parts);
    const generation = this.#generation;
    const pending = this.#pending ??= this.#build().then(parts => {
      if (this.#generation !== generation) throw new ChausarError('COMPOSE_NOT_FOUND', 'Your AI and plan were cleared. Connect again.');
      this.#parts = parts;
      return parts;
    });
    pending.catch(() => { if (this.#pending === pending) this.#pending = null; });
    return pending;
  }

  async #build(): Promise<Parts> {
    const options = this.#options;
    let transport: ModelTransport;
    if (options.modelTransport) transport = options.modelTransport;
    else if (options.modelReplayPath) {
      let fixture: unknown;
      try { fixture = JSON.parse(await readFile(options.modelReplayPath, 'utf8')); }
      catch { throw new ChausarError('NOT_BUILT_YET', 'The model recording could not be read, so model calls are off.'); }
      transport = createReplayTransport(fixture as ModelReplayFixture);
    } else {
      transport = defaultModelTransport(options.hostProcess ? { hostProcess: options.hostProcess } : {});
    }
    const store = new DraftStore(countryProfile('XX'));
    const shelf = createSecretShelf();
    const host = options.host ?? 'test';
    const claudeCodeTerms = options.claudeCodeTerms === 'accepted' ? 'accepted' : 'pending';
    const port: ModelPort = createModelPort({
      store, clock: this.#clock, transport, secrets: shelf, host, demo: options.demo, claudeCodeTerms,
      ...(options.codexCli !== undefined ? { codexCli: options.codexCli } : {}),
    });
    const deps: VentureDeps = Object.freeze({
      store, clock: this.#clock, models: port, services: NO_SERVICES,
      github: Object.freeze({ kind: 'fixture' as const, read: async () => { throw new ChausarError('NOT_BUILT_YET', 'There is no vault yet.'); } }),
      secrets: shelf, host, demo: options.demo, storage: 'experimental-file' as const, claudeCodeTerms,
    });
    return { store, shelf, deps };
  }
}
