import { resolve, join, relative, isAbsolute, basename } from 'node:path';
import { mkdir, readdir, rmdir, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { STORE_LIMIT_BYTES, Vault, atomicWriteText, readBoundedText, safeDirectory, type EncryptedSnapshotAdapter } from './vault.ts';
import { PostgresSnapshotAdapter } from './postgres.ts';
import { OntologyService } from './ontology.ts';
import { seedDemo } from './ingest.ts';
import { CalculatorService } from './calculator.ts';
import { TrustService } from './trust.ts';
import { SpeechService, type SpeechOptions } from './speech.ts';
import { AuthService } from './auth.ts';
import { preferenceChange, readAppPreferences, writeAppPreferences } from './app-preferences.ts';
import { WorkProgress } from './work-progress.ts';
import type { WorkKind } from './venture/views/work-steps.ts';
import { DatabaseCalculator, type DatabaseCalculatorOptions } from './analytics.ts';
import { AnalyticalHelper } from './helper.ts';
import { compareVersions } from './updater.ts';
import { UpdateService, type UpdateServiceOptions } from './update-service.ts';
import { authorize, audit, check, ChausarError, hash, InternalError, internalCheck, type Context, type StateStore } from './contracts.ts';
import type { BusinessSnapshot, BusinessSnapshotRead, SecretShelf, VentureClosingPort, VentureFrame, VentureHostOptions, VentureRunEvent, VentureWorkspacePort } from './venture/contracts.ts';
import type { DraftHandoverPort } from './venture/onboarding-contracts.ts';
import { deviceKeyFailed, deviceKeysUnavailable, noDeviceKeyStore, osDeviceKeyStore, type DeviceKeyRecord, type DeviceKeyStore, type ProbeResult } from './device-custody.ts';
import { DriveBackup, driveClientOfBuild, type DriveEndpoints, type DriveTokens } from './drive-backup.ts';
import { type BackupCopySetting, CustodyFiles, MANAGED_COPY_TAIL, backupDue, backupName, computerView, keepBackups, makeTransferCode, newCard, nextBackupAt, nextFolder,
  normalizeTransferCode, parseBackupName, slugFolder, type BackupSchedule, type VaultCard } from './workspace-custody.ts';
import { aiSetupFile, forgetAiSetup } from './venture/models/ai-setup-file.ts';
import { isAppChannel } from './portable.ts';
import { cliLookFile, cliLookPath } from './venture/models/cli-look-file.ts';
import { BACKUP_AFTER_METHODS, CUSTODY_WORDS, TRANSFER, exportFileName, moveFileName, type BackupCopyView, type BackupInspectView, type BackupKind, type BackupView, type CopyImportResult, type CustodyView, type DriveStatus, type RecoveryState, type UnlockMode } from './workspace-custody-contracts.ts';
import { SNAPSHOT_FORMAT, WorkspaceSnapshots, snapshotDue } from './workspace-snapshots.ts';

/** The engine's view of the draft desk (platform/runtime/venture/draft/): AI state before any vault exists. */
type DraftDeskHandle = {
  request(ctx: Context, method: string, payload: unknown): Promise<unknown>;
  /** workspace.create succeeded: reset and pause the idle timer while the owner keeps the plan safe. */
  hold(): void;
  /** Wipes keys and records. */
  clear(): void;
  handover: DraftHandoverPort;
};

export type EngineOptions = { directory: string; version?: string; demo?: boolean; storage?: 'experimental-file' | 'postgres'; postgresUrl?: string; analytics?: DatabaseCalculatorOptions; pythonExecutable?: string; updatePublicKey?: string;
  /** Trusted local composition: how the speech service starts the local whisper.cpp (tests inject a stand-in). */
  speech?: SpeechOptions;
  venture?: VentureHostOptions;
  /** Trusted host composition, never from an RPC: with storage 'postgres', the PostgreSQL vault adapter for a workspace
   * folder, over a pool the host owns. The hosted server uses it for one slot per business (hosted/runtime/business.ts). */
  vaultStorage?: (folder: string) => Promise<EncryptedSnapshotAdapter>;
  /** Trusted host composition (server.ts, worker.ts): keep each business's vault key with this computer's login and
   * write automatic encrypted backups. Absent: today's behaviour, a passphrase for every vault and no automatic backups. */
  workspaceCustody?: { deviceKeys: 'os' | 'none' | DeviceKeyStore; autoBackups: boolean; clock?: () => number };
  /** C5 task 31: the daily update check: main hands the worker the build's key, feed and folder (update-service.ts). Tests add seams. */
  updates?: Omit<UpdateServiceOptions, 'version' | 'isBusy'>;
  /** C5 task 24: the Google client, for tests; a build's comes from package.json. tokens: where tests keep the refresh token. */
  drive?: { clientId: string | null; clientSecret?: string | null; endpoints?: DriveEndpoints; tokens?: DriveTokens; chunkBytes?: number };
  /** How long a lock, open, create or close waits for the requests in flight to end (BUSY_WAIT_MS); tests shorten it. */
  busyWaitMs?: number;
};
/**
 * How long a lock, open, switch, create or close waits for the requests already in flight before it says what is still
 * running. The window's own reads end in well under a second; ten seconds covers a slow computer.
 */
export const BUSY_WAIT_MS = 10_000;
/** The same wait while long local work (a transcript being made) is being stopped: its programs are killed and waited for. */
const STOP_WORK_WAIT_MS = 20_000;
/**
 * What a request still in flight is, in the owner's words, for the line a lock or a switch answers when it could not
 * wait any longer. The first prefix that fits wins; anything else is not named.
 */
const STILL_RUNNING: readonly (readonly [string, string])[] = Object.freeze([
  ['venture.ai.setup.', 'saving your choice of Codex'],
  ['venture.about.', 'reading about your work'],
  ['venture.country.', 'reading about your work'],
  ['venture.ai.', 'checking your AI'],
  ['venture.models.', 'checking your AI'],
  ['venture.chief.', 'a chat reply'],
  ['venture.books.', 'adding up your books'],
  ['calculation.', 'adding up your books'],
  ['workspace.backups.', 'a backup'],
  ['tick.backup', 'a backup'],
  ['workspace.export', 'a copy of this business'],
  ['workspace.transfer.', 'a copy of this business'],
  ['venture.agents.', 'setting up your team'],
  ['venture.simulation.', 'a rehearsal'],
] as const);
export function stillRunningWords(methods: readonly string[]): string {
  const named = [...new Set(methods.flatMap(method => { const found = STILL_RUNNING.find(([prefix]) => method.startsWith(prefix)); return found ? [found[1]] : []; }))];
  if (!named.length) return 'Chausar is still finishing work in this business. Try again in a moment.';
  const list = named.length === 1 ? named[0] : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
  return `Chausar is still ${list.startsWith('a ') || named.length > 1 ? `busy with ${list}` : list} in this business. Wait for it to finish, then try again.`;
}
/** What a request hears while a lock, open, switch or create is under way. */
const TRANSITION_WORDS = 'Chausar is opening or closing a business. Try again in a moment.';
/** How often the scheduler tick sweeps the venture action journal (venture/build/journal-sweep.ts). */
const JOURNAL_SWEEP_EVERY_MS = 5 * 60_000;
/**
 * How often the scheduler tick lets the notification centre look at Today (venture/notify/centre.ts, Ink v2 wave 4 4G1):
 * a little under a minute, so the hosted app's 60 s housekeeping tick looks every time, never every other minute (4G3).
 */
export const NOTIFY_EVERY_MS = 55_000;

/** The sole product authority. The renderer receives named, bounded results only. */
/** The recovery state a move file says it carries (plaintext metadata, written by transfer.export). */
function transferHint(parsed: any): RecoveryState {
  return parsed?.transfer?.format === 'chausar.transfer.v1' && ['made', 'not-made'].includes(parsed.transfer.recovery) ? parsed.transfer.recovery : 'unknown';
}
/** C4 task 38: when the newest move file was made, unless the owner dismissed the line after it. */
function moveMadeOf(activity: readonly { at: string; event: string }[]): string | null {
  let made: string | null = null;
  for (const item of activity) {
    if (item.event === 'custody.transfer-exported') made = item.at;
    else if (item.event === 'custody.transfer-dismissed') made = null;
  }
  return made;
}

/** C5 task 23: the card's copy setting as the window may see it: the folder's last name, never its path. */
function copyViewOf(copy: BackupCopySetting | null | undefined): BackupCopyView | null {
  return copy ? { folderName: copy.folder.split(/[\\/]/).filter(Boolean).pop() ?? copy.folder, lastCopiedAt: copy.lastCopiedAt, problem: copy.problem } : null;
}

export class Engine {
  options: EngineOptions;
  readonly version: string;
  vault: Vault | null = null;
  /** C5 task 24: the open business's Drive client. */
  #drive: { workspaceId: string; client: DriveBackup } | null = null;
  #baseContext: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
  #requestContext = new AsyncLocalStorage<Context>();
  #transition = false;
  #activeRequests = 0;
  /** The requests in flight by method, so a refused lock can say what is still running. */
  #inFlight = new Map<string, number>();
  #closing = false;
  #idleWaiters = new Set<() => void>();
  /** Waiting for the requests in flight to end, whatever the transition flag says (a lock or open that holds it). */
  #quietWaiters = new Set<() => void>();
  /**
   * Long local work a closing workspace stops (a transcript being made, Ink v2 wave 2 2E2): lock, close, switch and
   * quit abort the signal, and wait (capped) for the requests to end (requestsEnded) instead of answering VAULT_BUSY.
   */
  #stopWork = new AbortController();
  #stoppable = 0;
  #closingPort: VentureClosingPort = (() => {
    const engine = this;
    return Object.freeze({
      get signal() { return engine.#stopWork.signal; },
      hold: () => { engine.#stoppable += 1; let released = false; return () => { if (!released) { released = true; engine.#stoppable -= 1; } }; },
    });
  })();
  get context(): Context { return this.#requestContext.getStore() || this.#baseContext; }
  set context(value: Context) { this.#baseContext = { ...value }; }
  services: Record<string, any> = {};
  // Ink v2 wave 4 (4G3): settle and outsideWork wait for phone alerts under way; endPushSessions ends a hosted session's subscriptions.
  #venture: { request(ctx: Context, method: string, payload: unknown): Promise<unknown>; close(): void; settle(timeoutMs?: number): Promise<void>; outsideWork(): Promise<void> | null } | null = null;
  #venturePromise: Promise<{ request(ctx: Context, method: string, payload: unknown): Promise<unknown>; close(): void; shareLink(ctx: Context, op: 'page' | 'decide' | 'comment' | 'upload', token: string, input?: unknown): Promise<unknown>; endPushSessions(ctx: Context, hashes: readonly string[]): Promise<number>; settle(timeoutMs?: number): Promise<void>; outsideWork(): Promise<void> | null }> | null = null;
  #ventureModule() {
    return import('./venture/host.ts').catch(() => { throw new ChausarError('NOT_BUILT_YET', 'This part of Chausar is not built yet.'); });
  }
  // The draft desk: one per engine process, memory only, loaded on the first draft request. Keys never touch disk.
  #draft: DraftDeskHandle | null = null;
  #draftPending: Promise<DraftDeskHandle> | null = null;
  #draftDesk(): Promise<DraftDeskHandle> {
    if (this.#draft) return Promise.resolve(this.#draft);
    const pending = this.#draftPending ??= import('./venture/draft/index.ts').then(module => {
      const desk = module.createDraftDesk({
        ...(this.options.venture ?? {}), demo: !!this.options.demo,
        ...(this.services.helper ? { helper: this.services.helper } : {}),
        work: { begin: (kind: WorkKind, steps: readonly string[]) => this.#work.begin(kind, steps, { businessId: '' }) },
        ventureExists: () => !!this.vault && this.vault.read().conversations.some(record => record?.kind === 'venture-record'),
        vaultOpen: () => !!this.vault,
        // The newest AI setup on this computer, which venture.ai.reuse connects in a later business's draft.
        ...(this.#aiSetup() ? { aiSetup: this.#aiSetup()! } : {}),
      }) as DraftDeskHandle;
      this.#draft = desk;
      return desk;
    });
    pending.catch(() => { if (this.#draftPending === pending) this.#draftPending = null; });
    return pending.catch(() => { throw new ChausarError('NOT_BUILT_YET', 'This part of Chausar is not built yet.'); });
  }
  /** What venture.create sees: the desk when it is loaded, else nothing to adopt. Trusted host composition only. */
  #draftHandover: DraftHandoverPort = Object.freeze({
    ai: () => this.#draft?.handover.ai() ?? null,
    moveKeys: (target: SecretShelf) => { this.#draft?.handover.moveKeys(target); },
    settle: () => { this.#draft?.handover.settle(); },
  });
  // Run events for the Ink frontend: the desktop worker forwards them over IPC, the local server streams them at /api/events.
  #ventureEventListeners = new Set<(event: VentureFrame) => void>();
  /** One-shot C3 task 9: which step long work is on. Its frames go to the same listeners and are never written anywhere. */
  #work = new WorkProgress(event => this.#publishVentureEvents([event]));
  /** Trusted host hook: hears each run event a venture action committed, and each step of long work. Returns the unsubscribe function. */
  onVentureEvent(listener: (event: VentureFrame) => void): () => void {
    this.#ventureEventListeners.add(listener);
    return () => { this.#ventureEventListeners.delete(listener); };
  }
  /** Work with no boundary inside it, as one step of long work. Opening and closing a vault happen in it, so its frames are the app's ('' business). */
  async #oneStep<T>(kind: WorkKind, step: string, run: () => Promise<T>): Promise<T> {
    const work = this.#work.begin(kind, [step], { businessId: '' });
    work.step(step, 'current');
    try {
      const answer = await run();
      work.step(step, 'done');
      return answer;
    } catch (error) {
      work.failCurrent();
      throw error;
    } finally {
      work.end();
    }
  }
  /** The open business as the screens name it; '' with none open (the draft desk's work). */
  #workBusiness(): string {
    try { return this.vault ? this.#ventureWorkspace.current().id : ''; } catch { return ''; }
  }
  #publishVentureEvents(events: VentureFrame[]) {
    for (const event of events) for (const listener of [...this.#ventureEventListeners]) {
      try { listener(Object.freeze({ ...event })); } catch { /* A listener's failure is its own. */ }
    }
  }
  // Whether the owner is looking at Chausar (Ink v2 wave 4, 4G1): the desktop window shown, not minimised and focused,
  // or the owner's own event stream (the local server's /api/events). Alerts outside the app wait while they are and
  // for 2 minutes after (venture/notify).
  #watchers = 0;
  #windowWatched = false;
  #watchedAt = 0;
  /** Trusted host hook: the owner's event stream opened. Returns its release, which the host calls when it closes. */
  watchEvents(): () => void {
    this.#watchers += 1;
    let open = true;
    return () => { if (!open) return; open = false; this.#watchers -= 1; this.#watchedAt = Date.now(); };
  }
  /** Trusted host hook (the desktop main process, through the worker): the window is shown, not minimised and focused. */
  updateOwnerWatching(watching: boolean): void {
    if (this.#windowWatched && watching !== true) this.#watchedAt = Date.now();
    this.#windowWatched = watching === true;
  }
  /** Now while the owner is looking; else when they last were; null when not since this process started. */
  #watchingAt(): string | null {
    if (this.#watchers > 0 || this.#windowWatched) return new Date().toISOString();
    return this.#watchedAt ? new Date(this.#watchedAt).toISOString() : null;
  }
  /** What Today's queue may know about the businesses on this computer. The id is the workspace folder, as in workspace.list. */
  #ventureWorkspace: VentureWorkspacePort = Object.freeze({
    current: () => {
      const workspace = this.vault?.read().workspace;
      return { id: this.#openFolder ?? workspace?.id ?? 'main', name: workspace?.name ?? '' };
    },
    businesses: async () => this.options.venture?.host === 'hosted-web' ? []
      : (await this.custodyFiles().listBusinesses(this.storageKind())).businesses.map(item => ({ id: item.folder, name: item.name, opens: item.opens, openedAt: item.openedAt })),
    recovery: async () => this.options.venture?.host === 'hosted-web' || !this.custodyHost() ? null : (await this.custodyView()).business?.recovery ?? null,
    // Keeper's backups job (Ink v2 wave 4, 4A1): whether automatic backups are on and the automatic ones only (a copy
    // made by hand or a safety copy is not Keeper's run), with the schedule's last error; none on the hosted app.
    backups: async () => {
      const custody = this.custodyHost(), vault = this.vault;
      if (this.options.venture?.host === 'hosted-web' || !custody || !vault) return null;
      const automatic = (await this.custodyFiles().backupFiles(vault.read().workspace.id)).filter(file => file.kind === 'auto');
      const view = (await this.custodyView()).business?.backups;
      return { auto: !!custody.autoBackups, count: automatic.length, newestAt: automatic[0] ? new Date(automatic[0].at).toISOString() : null, nextDueAt: view?.nextDueAt ?? null, lastError: view?.lastError ?? null };
    },
    // Business snapshots (Ink v2 wave 4, 4J6): the other businesses as Chausar saved them when each was last open; a
    // passphrase one is locked and never read; none on the hosted app.
    snapshots: async () => this.snapshotReads(),
    // C5 task 22: the readable copies of the open business still on this computer; none on the hosted app.
    readableExports: async () => (this.options.venture?.host === 'hosted-web' || !this.vault ? [] : this.custodyFiles().readableExports(this.vault.read().workspace.id)),
    keepReadable: async (file: string) => { await this.custodyFiles().keepReadable(file); },
    deleteReadable: async (file: string) => { await this.custodyFiles().deleteReadable(file); },
    // C5 task 17: a file of the open business in Chausar's own exports folder, under its managed name, so Forget removes it.
    keepFile: async (tail: string, text: string) => {
      if (this.options.venture?.host === 'hosted-web' || !this.vault) return null;
      const name = `chausar-${this.vault.read().workspace.id}-${tail}`;
      check(MANAGED_COPY_TAIL.test(tail), 'INVALID_PATH', 'Chausar names these files itself.');
      const folder = await safeDirectory(resolve(this.options.directory, 'exports'), true);
      await atomicWriteText(join(folder, name), text, true);
      return name;
    },
    // The never-contact list the businesses on this computer share (C10), as keyed checks; nothing on the hosted app.
    neverContact: Object.freeze({
      has: async (values: readonly string[]) => this.snapshotStore()?.neverContactHas(values) ?? false,
      add: async (values: readonly string[]) => { await this.snapshotStore()?.neverContactAdd(values); },
    }),
  });
  /** A4 fix round: the newest AI setup on this computer (models/ai-setup.ts); none on the hosted app. */
  #aiSetup() {
    const venture = this.options.venture ?? {};
    return venture.host === 'hosted-web' ? null : venture.aiSetup ?? aiSetupFile(join(this.options.directory, 'custody', 'ai-setup.json'));
  }
  #ventureHost() {
    const vault = this.store();
    const pending = this.#venturePromise ??= this.#ventureModule().then(({ VentureHost }) => {
      check(this.vault === vault, 'VAULT_LOCKED', 'This business is closed. Open it first.');
      const venture = this.options.venture ?? {};
      const host = new VentureHost(vault, { calculator: this.services.calculator, ontology: this.services.ontology, trust: this.services.trust, helper: this.services.helper, speech: this.services.speech },
        { ...venture, demo: !!this.options.demo, storage: this.options.storage === 'postgres' ? 'postgres' : 'experimental-file',
          ...(venture.host === 'hosted-web' ? {} : { draft: this.#draftHandover, aiSetup: this.#aiSetup()!, cliLooks: cliLookFile(cliLookPath(this.options.directory)) }),
          workspace: venture.workspace ?? this.#ventureWorkspace,
          work: { begin: (kind: WorkKind, steps: readonly string[]) => this.#work.begin(kind, steps, { businessId: this.#workBusiness() }) },
          notify: (events: VentureRunEvent[]) => { venture.notify?.(events); this.#publishVentureEvents(events); },
          watching: venture.watching ?? (() => this.#watchingAt()),
          // Phone alerts run as the owner inside the app, whoever's request started the look (4G3).
          ownerContext: venture.ownerContext ?? (() => ({ ...this.#baseContext })),
          closing: this.#closingPort,
          // The plan meter is this computer's, so it is kept against the engine: a business closed and opened again keeps the reading.
          planKey: this });
      this.#venture = host;
      return host;
    });
    pending.catch(() => { if (this.#venturePromise === pending) this.#venturePromise = null; });
    return pending;
  }
  constructor(options: EngineOptions) { this.version = options.version ?? '0.1.0-preview.1'; compareVersions(this.version, this.version); this.options = { ...options, directory: resolve(options.directory) }; }
  contextForSession(token: string, channel: Context['channel'] = 'desktop'): Context { this.store(); return this.services.auth.authenticate(token, channel); }
  async withContext<T>(context: Context, work: () => T | Promise<T>): Promise<T> {
    const scoped = Object.freeze({ ...context }); if (this.vault) authorize(this.vault, scoped);
    return this.#requestContext.run(scoped, async () => await work());
  }
  async requestAs(context: Context, method: string, payload: any = {}): Promise<any> { return this.withContext(context, () => this.request(method, payload)); }
  /** The hosted /share/<token> page (VentureHost.shareLink). Trusted host only: request() never routes here. */
  async ventureShareLink(context: Context, op: 'page' | 'decide' | 'comment' | 'upload', token: string, input: unknown = {}): Promise<unknown> {
    return this.withContext(context, async () => (await this.#ventureHost()).shareLink(context, op, token, input));
  }
  /** Trusted host hook (the hosted server, 4G3): sessions that signed out or were revoked end their phone alert subscriptions. */
  async ventureEndPushSessions(context: Context, hashes: readonly string[]): Promise<number> {
    return this.withContext(context, async () => (await this.#ventureHost()).endPushSessions(context, hashes));
  }
  /** Trusted host hook (4G3): work the notification centre started outside its looks, or null; the hosted runtime waits on it. */
  ventureOutsideWork(): Promise<void> | null {
    return this.#venture?.outsideWork() ?? null;
  }
  bootstrapContext(): Context {
    if (!this.vault) return { ...this.#baseContext };
    const member = this.currentWorkspaceOwner(this.vault);
    check(member, 'OWNER_REQUIRED', 'The local workspace owner is no longer available.'); return { memberId: member.id, role: member.role, epoch: member.epoch, channel: 'desktop' };
  }
  private currentWorkspaceOwner(vault: Vault) {
    return vault.read().members.find(m => m.id === 'owner' && m.active && m.role === 'owner');
  }
  private store(): Vault { check(this.vault, 'VAULT_LOCKED', 'This business is closed. Open it first.'); return this.vault; }
  private async adapter(folder = 'main') {
    if (this.options.storage === 'experimental-file' && (this.options.demo || this.options.venture?.host === 'desktop')) {
      if (!this.options.vaultStorage) return 'experimental-file' as const;
      // A trusted host's own file store (the hosted server's capped one, 4J23); the same folder-name check first.
      this.workspacePath(folder);
      const adapter = await this.options.vaultStorage(folder);
      if (adapter.kind !== 'experimental-file') { await adapter.close?.(); throw new InternalError('STORAGE_REQUIRED', 'Experimental file storage needs a file vault adapter.'); }
      return adapter;
    }
    if (this.options.storage === 'postgres' && this.options.vaultStorage) {
      this.workspacePath(folder); // the same folder-name check as the other storage paths
      const adapter = await this.options.vaultStorage(folder);
      if (adapter.kind !== 'postgres') { await adapter.close?.(); throw new InternalError('INVALID_POSTGRES_CONFIG', 'PostgreSQL storage needs a PostgreSQL vault adapter.'); }
      return adapter;
    }
    check(this.options.storage === 'postgres' && this.options.postgresUrl, 'DATABASE_REQUIRED', 'Use the desktop encrypted file store or configure PostgreSQL for this host.');
    const url = new URL(this.options.postgresUrl);
    check(url.protocol === 'postgresql:' || url.protocol === 'postgres:', 'INVALID_POSTGRES_CONFIG', 'Use a PostgreSQL connection URL.');
    return PostgresSnapshotAdapter.connect({ host: url.hostname.replace(/^\[|\]$/g, '') as '127.0.0.1' | '::1', port: Number(url.port || 5432), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: decodeURIComponent(url.pathname.slice(1)), vaultSlot: hash(this.workspacePath(folder)) });
  }
  private workspacePath(name = 'main') {
    check(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name), 'INVALID_PATH', 'Use a short workspace folder name without path separators.');
    const path = resolve(this.options.directory, name); const rel = relative(this.options.directory, path);
    check(!rel.startsWith('..') && !isAbsolute(rel), 'INVALID_PATH', 'That place is outside this business\'s folder.'); return path;
  }
  private async attach(vault: Vault) {
    this.#venture?.close(); this.#venture = null; this.#venturePromise = null;
    // A new workspace starts with long local work allowed again.
    if (this.#stopWork.signal.aborted) this.#stopWork = new AbortController();
    const owner = this.currentWorkspaceOwner(vault);
    check(owner, 'OWNER_REQUIRED', 'This business has no owner set up yet.');
    this.vault = vault;
    this.context = { memberId: owner.id, role: owner.role, epoch: owner.epoch, channel: 'desktop' };
    const store: StateStore = vault;
    this.services.ontology = new OntologyService(store);
    // Preview arithmetic is exact integer math. Production additionally refuses
    // numbers until the registered isolated SQL query verifies the same projection.
    const database = this.options.demo ? null : new DatabaseCalculator(this.options.analytics);
    this.services.calculator = new CalculatorService(store, database ? { verifier: receipt => database.verify(receipt) } : {});
    this.services.helper = new AnalyticalHelper({ executable: this.options.pythonExecutable });
    this.services.trust = new TrustService(store);
    this.services.speech = new SpeechService(store, this.options.speech);
    // The whisper.cpp the owner set up in Connections > Your AI, kept in the vault; never on the hosted server.
    if (this.options.venture?.host !== 'hosted-web') this.services.speech.restoreLocal(store.read());
    this.services.auth = new AuthService(store);
  }
  async close() {
    check(!this.#transition, 'VAULT_BUSY', TRANSITION_WORDS);
    if (!this.#activeRequests) { await this.closeVault(); return; }
    // Requests still on their way end first (capped); nothing new starts while they do.
    this.#transition = true;
    try {
      check(await this.requestsEnded(), 'VAULT_BUSY', stillRunningWords([...this.#inFlight.keys()]));
      await this.closeVault();
    } finally { this.endTransition(); }
  }
  private async closeVault() {
    // The business's summary for the others on this computer, written again on lock (4J6). Never throws. Only awaited
    // when there is one to write, and the alerts only when a venture host is open: with nothing to do, closing marks the
    // vault closed in the same turn, so a read after close() is refused at once.
    if (this.snapshotWanted(true)) await this.writeSnapshot(true);
    // Phone alerts under way finish first, for 12 s at most (4G3).
    if (this.#venture) await this.#venture.settle().catch(() => {});
    this.#venture?.close(); this.#venture = null; this.#venturePromise = null;
    this.#draft?.clear();
    if (this.vault) { await this.vault.close(); this.vault = null; this.services = {}; this.resetCustodySession(); }
  }
  async shutdown(timeoutMs = 70000) {
    internalCheck(Number.isSafeInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= 75000, 'INVALID_SHUTDOWN_LIMIT', 'Use a bounded engine shutdown deadline.');
    this.#closing = true;
    // Quitting stops a transcript being made: whisper.cpp and ffmpeg never outlive the engine, nor their temp folders.
    this.#stopWork.abort();
    if (this.#activeRequests || this.#transition) await new Promise<void>((accept, reject) => {
      const finished = () => { clearTimeout(timer); this.#idleWaiters.delete(finished); accept(); };
      const timer = setTimeout(() => { this.#idleWaiters.delete(finished); reject(new Error('Engine shutdown exceeded its deadline; unfinished actions require reconciliation.')); }, timeoutMs);
      this.#idleWaiters.add(finished);
    });
    await this.closingBackup();
    await this.closeVault();
    this.#snapshots?.forgetKey(); // the summary key leaves memory with the engine (4J6)
  }
  private notifyIdle() {
    if (this.#activeRequests) return;
    for (const finished of [...this.#quietWaiters]) finished();
    if (!this.#transition) for (const finished of [...this.#idleWaiters]) finished();
  }
  /** A request is in flight from here to the function it returns; `method` is what a refused lock may name. */
  private beginRequest(method: string): () => void {
    this.#activeRequests++;
    this.#inFlight.set(method, (this.#inFlight.get(method) ?? 0) + 1);
    return () => {
      this.#activeRequests--;
      const left = (this.#inFlight.get(method) ?? 1) - 1;
      if (left > 0) this.#inFlight.set(method, left); else this.#inFlight.delete(method);
      this.notifyIdle();
    };
  }
  /** A lock, open, switch or create is over: requests start again, and long local work is allowed again. */
  private endTransition() {
    this.#transition = false;
    if (this.#stopWork.signal.aborted) this.#stopWork = new AbortController();
    this.notifyIdle();
  }
  /**
   * Waits for the requests in flight to end, for a capped time: true once none is left. The caller holds the transition
   * flag, so no new request starts meanwhile and reads that keep coming can never hold it off. Long local work (a
   * transcript being made: whisper.cpp and ffmpeg are killed, waited for and their folders removed) is stopped first.
   */
  private async requestsEnded(): Promise<boolean> {
    if (!this.#activeRequests) return true;
    const stopping = this.#stoppable > 0;
    if (stopping) this.#stopWork.abort();
    const limit = stopping ? Math.max(STOP_WORK_WAIT_MS, this.busyWaitMs()) : this.busyWaitMs();
    await new Promise<void>(accept => {
      const finished = () => { clearTimeout(timer); this.#quietWaiters.delete(finished); accept(); };
      const timer = setTimeout(finished, limit);
      this.#quietWaiters.add(finished);
    });
    return this.#activeRequests === 0;
  }
  private busyWaitMs(): number {
    const given = this.options.busyWaitMs;
    return typeof given === 'number' && Number.isSafeInteger(given) && given >= 10 && given <= 60_000 ? given : BUSY_WAIT_MS;
  }
  private async attachSafely(vault: Vault) { try {
    await this.attach(vault);
    // The action journal: nothing of this process is in flight while a vault opens, so any claim left behind was
    // interrupted. It becomes outcome_unknown and is never run again on its own. Only for a vault with a business.
    this.#journalSweptAt = Date.now();
    await this.sweepVentureJournal(1);
  } catch (error) { await vault.close(); this.vault = null; this.services = {}; this.resetCustodySession(); throw error; } }
  /** Fix round 7: whether the open business has a routine whose time came since its last look. Never throws. */
  private async routineDue(): Promise<boolean> {
    const vault = this.vault;
    if (!vault || !vault.read().conversations.some((record: any) => record?.kind === 'venture-record')) return false;
    try {
      const host = await this.#ventureHost() as unknown as { routineDue?: () => Promise<boolean> };
      return this.vault === vault && typeof host.routineDue === 'function' ? await host.routineDue() : false;
    } catch { return false; }
  }
  /** When the tick last swept the action journal (wall clock, ms). Opening a vault sweeps it too. */
  #journalSweptAt = 0;
  /** Sweeps the open business's action journal through the venture host. Never throws; null when it did not run. */
  private async sweepVentureJournal(claimLimitMs?: number): Promise<number | null> {
    const vault = this.vault;
    if (!vault || !vault.read().conversations.some((record: any) => record?.kind === 'venture-record')) return null;
    try {
      const host = await this.#ventureHost() as unknown as { sweepJournal?: (ctx: Context, claimLimitMs?: number) => Promise<number | null> };
      if (this.vault !== vault || typeof host.sweepJournal !== 'function') return null;
      return await host.sweepJournal({ ...this.#baseContext }, claimLimitMs);
    } catch { return null; }
  }
  /**
   * At a tick, every few minutes: the journal sweep, with the longest claim limit any effect needs. Fix round 7: sooner
   * when a routine's time has come (a daily review moved to a few minutes from now runs then). Never throws.
   */
  private async journalTick() {
    if (this.#closing || this.#transition || !this.vault) return;
    if (Date.now() - this.#journalSweptAt < JOURNAL_SWEEP_EVERY_MS && !(await this.routineDue())) return;
    this.#journalSweptAt = Date.now();
    const done = this.beginRequest('tick.journal');
    try { await this.sweepVentureJournal(); } finally { done(); }
  }
  /** When the tick last let the notification centre look (wall clock, ms). */
  #notifiedAt = 0;
  /**
   * At a tick, once a minute: the notification centre looks at Today, so time alone can bring an alert (quiet hours
   * that ended, the wait between alerts, the digest's hour). Only for a vault with a business. Never throws.
   */
  private async notifyTick() {
    const vault = this.vault;
    if (this.#closing || this.#transition || !vault || Date.now() - this.#notifiedAt < NOTIFY_EVERY_MS) return;
    if (!vault.read().conversations.some((record: any) => record?.kind === 'venture-record')) return;
    this.#notifiedAt = Date.now();
    const done = this.beginRequest('tick.notify');
    try {
      const host = await this.#ventureHost() as unknown as { notifyTick?: (ctx: Context) => Promise<boolean | null> };
      if (this.vault === vault && typeof host.notifyTick === 'function') await host.notifyTick({ ...this.#baseContext });
    } catch { /* The next tick looks again. */ } finally { done(); }
  }
  /**
   * A2: venture.ai.setup.trust { cli: 'codex', sha256 }: keeps the owner's choice of the Codex they were shown, only for
   * that exact program, in the app and by an owner. The host's Codex trust (codex-trust.ts) checks and records it.
   * A2 second review: only the owner's click in the desktop main process's own dialog approves a Codex. As a request
   * (the window, the local server's bootstrap session, a phone, MCP) it is always refused; main reads the held review
   * (codexChoiceFor), asks the owner, and on "Use this Codex" confirms over the worker's host channel, which no request
   * can write to (confirmCodexSetup).
   */
  #codexChoiceChecked(payload: unknown, confirm = false): { trust: { record(sha256: unknown, path: unknown): Promise<unknown>; held?(sha256: unknown): unknown; current?(): unknown }; sha256: string; path: string | null } {
    const context = this.context;
    check(context && context.channel === 'desktop' && !context.sourceTainted, 'APP_APPROVAL_REQUIRED', 'Do this inside the Chausar app.');
    // A2 review: only the owner says which program Chausar runs (AGENTS.md: the owner approves; a cofounder does not).
    check(context.role === 'owner', 'FORBIDDEN', 'Only the owner chooses which Codex Chausar runs.');
    // One-shot A3: main's confirmation names the path its dialog showed, so the yes records that copy of the program.
    const keys = confirm ? 'cli,path,sha256' : 'cli,sha256';
    const path = (payload as { path?: unknown } | null)?.path;
    check(payload && typeof payload === 'object' && !Array.isArray(payload) && Object.keys(payload).sort().join(',') === keys && (payload as { cli?: unknown }).cli === 'codex'
      && typeof (payload as { sha256?: unknown }).sha256 === 'string' && /^[a-f0-9]{64}$/.test((payload as { sha256: string }).sha256)
      && (!confirm || (typeof path === 'string' && path.length > 0 && path.length <= 4096)),
      'INVALID_VENTURE_REQUEST', 'Choose the Codex Chausar showed you.');
    const trust = this.options.venture?.codexCli as { record?: (sha256: unknown, path: unknown) => Promise<unknown>; held?(sha256: unknown): unknown; current?(): unknown } | undefined;
    check(this.options.venture?.host !== 'hosted-web' && trust && typeof trust.record === 'function', 'CODEX_SETUP_UNAVAILABLE', "Chausar can't keep a chosen Codex here.");
    return { trust: trust as { record(sha256: unknown, path: unknown): Promise<unknown> }, sha256: (payload as { sha256: string }).sha256, path: confirm ? path as string : null };
  }
  /**
   * A2 second review (main only, through the worker's host channel): what main's dialog names, from the engine's held
   * review of that exact program (its real path and version), or { inUse } when that program is already the Codex in
   * use (the owner's earlier choice, or the bundled Codex): the dialog is asked for once per program.
   */
  async codexChoiceFor(payload: unknown): Promise<{ path: string; version: string } | { inUse: unknown }> {
    const { trust, sha256 } = this.#codexChoiceChecked(payload);
    const current = typeof trust.current === 'function' ? trust.current() as { sha256?: unknown } | null : null;
    if (current && current.sha256 === sha256) return { inUse: current };
    const held = typeof trust.held === 'function' ? trust.held(sha256) as { path?: unknown; version?: unknown } | null : null;
    check(held && typeof held.path === 'string' && typeof held.version === 'string', 'CODEX_SETUP_CHANGED', 'That Codex changed since you looked at it. Check it again.');
    return { path: held.path as string, version: held.version as string };
  }
  /** A2 second review (main only, after the owner clicked "Use this Codex" in main's dialog): records the choice. */
  async confirmCodexSetup(payload: unknown): Promise<{ setup: unknown }> {
    check(!this.#closing, 'ENGINE_STOPPING', 'Chausar is finishing its work and closing. Open it again in a moment.');
    check(!this.#transition, 'VAULT_BUSY', TRANSITION_WORDS);
    const done = this.beginRequest('venture.ai.setup.confirm');
    try {
      const { trust, sha256, path } = this.#codexChoiceChecked(payload, true);
      return { setup: await trust.record(sha256, path) };
    } finally { done(); }
  }
  async request(method: string, payload: any = {}): Promise<any> {
    check(!this.#closing, 'ENGINE_STOPPING', 'Chausar is finishing its work and closing. Open it again in a moment.');
    const transitions = new Set(['workspace.create', 'workspace.open', 'workspace.recover', 'workspace.restore', 'workspace.lock', 'workspace.delete', 'workspace.transfer.import', 'workspace.backups.restore', 'workspace.import']);
    const transition = transitions.has(method);
    // One lock, open, switch or create at a time, and no request starts while one is under way.
    check(!this.#transition, 'VAULT_BUSY', TRANSITION_WORDS);
    if (!transition) {
      const done = this.beginRequest(method);
      try {
        const result = await this.handleRequest(method, payload);
        // An important change: the next tick writes an automatic backup (KEYCHAIN-SPEC 4.1).
        if (BACKUP_AFTER_METHODS.includes(method)) this.#schedule.due = true;
        return result;
      } finally { done(); }
    }
    // The flag is taken first, so nothing new starts; then the requests already in flight end (capped: the window's
    // own reads take well under a second), and only then is a vault closed, opened or made. One that does not end
    // in time refuses the transition in plain words, and everything goes on as before.
    this.#transition = true;
    try {
      check(await this.requestsEnded(), 'VAULT_BUSY', stillRunningWords([...this.#inFlight.keys()]));
      const result = await this.handleRequest(method, payload);
      if (BACKUP_AFTER_METHODS.includes(method)) this.#schedule.due = true;
      return result;
    } finally { this.endTransition(); }
  }
  /** C7: whatsNew.get {} answers { version, seen }; whatsNew.seen { version } marks the running version seen. */
  private async whatsNew(method: 'whatsNew.get' | 'whatsNew.seen', payload: Record<string, unknown>): Promise<{ version: string; seen: boolean }> {
    const { markSeen, whatsNewState } = await import('./whats-new-file.ts');
    const custody = join(this.options.directory, 'custody');
    if (method === 'whatsNew.seen') {
      check(Object.keys(payload).length === 1 && payload.version === this.version, 'INVALID_REQUEST', 'Mark the version Chausar is running.');
      await markSeen(custody, this.version);
      return { version: this.version, seen: true };
    }
    check(Object.keys(payload).length === 0, 'INVALID_REQUEST', 'Send an empty request.');
    let hasBusiness = !!this.vault;
    if (!hasBusiness) { try { hasBusiness = (await this.custodyFiles().listBusinesses(this.storageKind())).businesses.length > 0; } catch { hasBusiness = false; } }
    return whatsNewState(custody, this.version, { hasBusiness });
  }
  private async handleRequest(method: string, payload: any = {}): Promise<any> {
    check(typeof method === 'string' && method.length <= 80 && payload && typeof payload === 'object' && !Array.isArray(payload), 'INVALID_REQUEST', 'Use a named request with an object payload.');
    // The first screen's question. With no business open, the check that this computer can keep a key starts now, in the
    // background (warmDeviceKeys below); the answer here never waits for it.
    if (method === 'workspace.status' && !this.vault) this.warmDeviceKeys();
    // folder: the open business's folder on this computer, as workspace.list names it, so the window knows which one to come back to.
    if (method === 'workspace.status') return { open: !!this.vault, workspace: this.vault?.read().workspace, ...(this.vault && this.#openFolder ? { folder: this.#openFolder } : {}), storage: this.options.storage, experimental: !!this.options.demo, version: this.version,
      ...(this.options.workspaceCustody ? { ...(this.vault && this.#openUnlock ? { unlock: this.#openUnlock } : {}), closedByOwner: this.#closedByOwner } : {}) };
    // C7: "What's new", once per version on this computer (whats-new-file.ts), before any vault.
    if (method === 'whatsNew.get' || method === 'whatsNew.seen') return this.whatsNew(method, payload);
    if (method === 'venture.countries') return (await this.#ventureModule()).ventureCountries();
    if (method === 'venture.preview') return (await this.#ventureModule()).venturePreview(payload);
    // Wave 6 (6C6): onboarding shows the profession's rules when it is picked, before any vault exists.
    if (method === 'venture.compliance.get' && !this.vault) return (await import('./venture/core/compliance.ts')).complianceBeforeVault(payload);
    if (method === 'venture.country.suggest' && !this.vault?.read().conversations.some(record => record?.kind === 'venture-record')) {
      return (await this.#draftDesk()).request(this.context, method, payload);
    }
    // The ways to earn (4J8); while a vault is open its state is read (never written) so its business says "You run this".
    // The other businesses here say it from what Chausar saved when each was last open (4J6), never their vaults.
    if (method === 'venture.playbooks.list') return (await this.#ventureModule()).venturePlaybooks(payload, this.vault ? { state: this.vault.read(), businessId: (this.options.venture?.workspace ?? this.#ventureWorkspace).current().id } : null,
      (await this.snapshotReads()).flatMap(read => (read.snapshot ? [{ businessId: read.id, name: read.snapshot.name, playbook: read.snapshot.playbook }] : [])));
    // The draft desk answers these before the vault check: connect an AI and read About you before any vault exists.
    switch (method) {
      case 'venture.ai.options':
      case 'venture.ai.connect':
      case 'venture.ai.disconnect':
      case 'venture.ai.status':
      // Wave 6 (6C1, 6C2): the tools' own sign-in and About you, before the vault.
      case 'venture.ai.tools':
      case 'venture.ai.login.start':
      case 'venture.ai.login.cancel':
      case 'venture.about.read':
      case 'venture.about.pick':
      // A later business: the AI already connected on this computer, connected in the new draft.
      case 'venture.ai.reuse':
        return (await this.#draftDesk()).request(this.context, method, payload);
      // About you's fields are a plain list. The first run reads it from the draft desk; once the open business exists
      // the desk refuses everything (VENTURE_EXISTS), and Settings, About you reads the same list from core (found on the
      // first Windows walk, 15 Nov 2026: the page's request was refused). Who asks still comes first, on the desk: a
      // phone, MCP or tainted context, or someone who is not an owner, gets the desk's refusal as before.
      case 'venture.about.families': {
        const owner = this.context && isAppChannel(this.context) && (this.context.role === 'owner' || this.context.role === 'cofounder');
        if (!owner || !this.vault?.read().conversations.some(record => record?.kind === 'venture-record')) return (await this.#draftDesk()).request(this.context, method, payload);
      }
    }
    // A2: the owner's yes to the Codex found on this computer, before the vault (onboarding) and after it (Your AI).
    // A2 second review: never as a request; only main's dialog confirms a Codex (confirmCodexSetup).
    if (method === 'venture.ai.setup.trust') throw new ChausarError('APP_APPROVAL_REQUIRED', 'Do this inside the Chausar app.');
    // One-shot C3 task 9: the open business's live jobs and any before a business was opened, never another business's.
    if (method === 'venture.work.list') {
      check(Object.keys(payload).length === 0, 'INVALID_VENTURE_REQUEST', 'Send the required fields and nothing else.');
      const here = this.#workBusiness();
      return { work: [...this.#work.list(''), ...(here ? this.#work.list(here) : [])] };
    }
    // One-shot C3: the app's own preference on this computer (animations), answered before the vault check so it works
    // with no business open; with one open, only its owner may change it, as with export.
    if (method === 'app.preferences.get') { check(Object.keys(payload).length === 0, 'INVALID_PREFERENCE', 'Ask for the settings of this app with nothing else.'); return readAppPreferences(this.options.directory); }
    if (method === 'app.preferences.set') {
      const change = preferenceChange(payload);
      if (this.vault) this.requireWorkspaceOwner(this.context);
      return writeAppPreferences(this.options.directory, change);
    }
    // Keeping the vault key on this computer (KEYCHAIN-SPEC 2 to 4). Answered before the vault check.
    switch (method) {
      case 'workspace.custody.get': return this.custodyView();
      // C5 task 31: updates need no business open.
      case 'updates.status': return this.updateService().view();
      case 'updates.settings': return this.updateService().settings(payload);
      case 'updates.check': return this.updateService().checkNow();
      case 'workspace.list': return this.custodyFiles().listBusinesses(this.storageKind());
      case 'workspace.backups.list': return this.backupList();
      case 'workspace.transfer.import': return this.#oneStep('move-in', 'move', () => this.transferImport(payload));
      case 'workspace.transfer.peek': return this.transferPeek(payload);
      case 'workspace.import': return this.importCopy(payload);
    }
    if (method === 'workspace.create') {
      check(!this.vault, 'VAULT_OPEN', 'Lock the current workspace before creating another.');
      check(typeof payload.name === 'string' && payload.name.trim().length >= 2 && payload.name.length <= 100, 'INVALID_NAME', 'Give your business a name.');
      const pack = payload.pack ?? 'ecommerce'; check(new OntologyService({ read: () => { throw new Error('No vault'); }, update: async () => { throw new Error('No vault'); } }).packs().some(p => p.pack === pack), 'UNKNOWN_PACK', 'Choose an available business starter pack.');
      const custody = this.custodyHost(), files = this.custodyFiles(), name = payload.name.trim();
      // No passphrase: this computer keeps a random secret in the passphrase slot (KEYCHAIN-SPEC 2.1, 2.9).
      const computer = payload.passphrase === undefined || payload.passphrase === null;
      if (computer) {
        if (!custody) throw deviceKeysUnavailable('not-configured');
        const probe = await custody.keys.probe(); if (!probe.available) throw deviceKeysUnavailable(probe.reason);
      }
      const taken = payload.folder === null ? await files.takenFolders() : null;
      let folder: string = taken ? slugFolder(name, taken) : payload.folder ?? 'main';
      this.workspacePath(folder);
      let wroteCard = false, record: DeviceKeyRecord | null = null;
      const secret = computer ? randomBytes(32) : null;
      try {
        let result!: Awaited<ReturnType<typeof Vault.create>>;
        for (;;) {
          if (custody && !(await files.readCard(folder))) {
            await files.writeCard(newCard({ folder, name, demo: !!payload.demo, unlock: computer ? 'this-computer' : 'passphrase', recovery: computer ? 'not-made' : 'made', state: 'creating' }));
            wroteCard = true;
          }
          try { result = await Vault.create({ directory: this.workspacePath(folder), passphrase: secret ? secret.toString('base64url') : payload.passphrase, name, demo: !!payload.demo, storage: await this.adapter(folder) }); break; }
          catch (error) {
            // The engine picked the folder, and an old vault with no card holds that slot (PostgreSQL storage
            // keeps no folder to find): take the next name instead. slugFolder stops after -99.
            if (!taken || (error as ChausarError).code !== 'VAULT_EXISTS') throw error;
            if (wroteCard) { await files.removeCard(folder).catch(() => {}); wroteCard = false; }
            taken.push(folder); folder = slugFolder(name, taken); this.workspacePath(folder);
          }
        }
        if (custody && secret) {
          try { record = await custody.keys.protect(result.vault.vaultId, secret); await files.writeKey(record); }
          catch (error) {
            await result.vault.delete().catch(() => {});
            if (record) { await custody.keys.forget(record).catch(() => {}); await files.removeKey(record.vaultId).catch(() => {}); }
            throw error instanceof ChausarError && error.code === 'DEVICE_KEY_FAILED' ? error : deviceKeyFailed();
          }
        }
        try {
          await this.attach(result.vault); await this.services.ontology.publish(this.context, pack);
          if (payload.demo) await seedDemo(this.store(), this.context);
          this.#draft?.hold();
          await this.afterOpen(folder, computer ? 'this-computer' : 'typed', { recovery: computer ? 'not-made' : 'made', created: true });
          wroteCard = false;
          const recoveryCode = computer ? null : result.recoveryCode;
          return { workspace: this.store().read().workspace, folder, unlock: computer ? 'this-computer' : 'passphrase', recoveryKit: recoveryCode, recoveryCode, experimental: !!this.options.demo };
        } catch (error) {
          await result.vault.delete(); this.vault = null; this.services = {}; this.resetCustodySession();
          if (record && custody) { await custody.keys.forget(record).catch(() => {}); await files.removeKey(record.vaultId).catch(() => {}); }
          throw error;
        }
      } catch (error) {
        if (wroteCard) await files.removeCard(folder).catch(() => {});
        throw error;
      } finally { secret?.fill(0); }
    }
    if (method === 'workspace.open') {
      check(!this.vault, 'VAULT_OPEN', 'Lock the current workspace first.'); this.#draft?.clear();
      const folder = payload.folder ?? payload.path ?? 'main'; this.workspacePath(folder);
      const custody = this.custodyHost(), typed = payload.passphrase !== undefined && payload.passphrase !== null;
      const files = this.custodyFiles(), card = custody ? await files.readCard(folder) : null;
      const unlockWith = async (passphrase: string) => Vault.open({ directory: this.workspacePath(folder), passphrase, storage: await this.adapter(folder) });
      const unlockFailed = (error: unknown) => (error as ChausarError)?.code === 'UNLOCK_FAILED';
      const passphraseRequired = () => new ChausarError('PASSPHRASE_REQUIRED', CUSTODY_WORDS.errors.PASSPHRASE_REQUIRED);
      // A lock change cut short (KEYCHAIN-SPEC 3.1, 3.2) leaves its marker on the card: the vault may already open the new way.
      const changing = card?.pending === 'to-passphrase' || card?.pending === 'to-this-computer';
      let vault: Vault, how: 'this-computer' | 'typed';
      if (!custody || typed) {
        try { vault = await unlockWith(payload.passphrase); how = 'typed'; }
        catch (error) {
          const secret = custody && changing && unlockFailed(error) && card?.vaultId ? await this.existingComputerSecret(card.vaultId) : null;
          if (!secret) throw error;
          try { vault = await unlockWith(secret); how = 'this-computer'; } catch { throw error; }
        }
      } else if (card?.unlock === 'passphrase') {
        // Try this computer's key only when the change to it was cut short, or a key record for the vault is on disk.
        const record = card.vaultId ? await files.readKey(card.vaultId) : null;
        const secret = card.vaultId && (card.pending === 'to-this-computer' || record) ? await this.existingComputerSecret(card.vaultId) : null;
        if (!secret) throw passphraseRequired();
        try { vault = await unlockWith(secret); how = 'this-computer'; }
        catch (error) { if (unlockFailed(error)) throw passphraseRequired(); throw error; }
      } else {
        // No card and no envelope to read (PostgreSQL storage, or no such folder): it needs a passphrase.
        const secret = await this.computerSecret(card?.vaultId ?? await files.folderVaultId(folder));
        try { vault = await unlockWith(secret); how = 'this-computer'; }
        catch (error) {
          // Turning the passphrase on was cut short after the rewrap: only the passphrase opens it now.
          if (unlockFailed(error)) throw card?.pending === 'to-passphrase' ? passphraseRequired() : deviceKeyFailed();
          throw error;
        }
      }
      await this.attachSafely(vault);
      await this.afterOpen(folder, how);
      return { workspace: this.store().read().workspace };
    }
    if (method === 'workspace.recover') {
      check(!this.vault, 'VAULT_OPEN', 'Lock the current workspace first.'); this.#draft?.clear();
      const folder = payload.folder ?? 'main'; this.workspacePath(folder);
      const custody = this.custodyHost(), computer = !!custody && (payload.passphrase === undefined || payload.passphrase === null);
      let newPassphrase = payload.passphrase, fresh: Buffer | null = null;
      if (computer) {
        const probe = await custody!.keys.probe(); if (!probe.available) throw deviceKeysUnavailable(probe.reason);
        const files = this.custodyFiles(), card = await files.readCard(folder);
        const vaultId = card?.vaultId ?? await files.folderVaultId(folder);
        // Another folder may already open this vault with this computer's key: keep its secret.
        newPassphrase = vaultId ? await this.existingComputerSecret(vaultId) : null;
        if (!newPassphrase) { fresh = randomBytes(32); newPassphrase = fresh.toString('base64url'); }
      }
      try {
        const vault = await Vault.recover({ directory: this.workspacePath(folder), recoveryCode: payload.recoveryCode, newPassphrase, storage: await this.adapter(folder) });
        if (fresh) await this.storeComputerSecret(vault, fresh);
        await this.attachSafely(vault);
      } finally { fresh?.fill(0); }
      await this.afterOpen(folder, computer ? 'this-computer' : 'typed', { recovery: 'made', reseal: true });
      return { workspace: this.store().read().workspace };
    }
    if (method === 'workspace.restore') {
      check(!this.vault, 'VAULT_OPEN', 'Lock the current workspace before restoring.');
      this.#draft?.clear();
      check(typeof payload.backupFile === 'string', 'INVALID_PATH', 'Choose a backup from this app.');
      const backupRoot = resolve(this.options.directory, 'backups'); const backupFile = resolve(backupRoot, payload.backupFile); const rel = relative(backupRoot, backupFile);
      check(!rel.startsWith('..') && !isAbsolute(rel) && rel.endsWith('.backup'), 'INVALID_PATH', 'Choose a managed backup file.');
      const custody = this.custodyHost(), files = this.custodyFiles();
      const header = custody && !rel.includes('/') && !rel.includes('\\') ? await files.backupHeader(rel) : null;
      const original = header ? (await files.listCards()).find(card => card.vaultId === header.vaultId && card.state === 'ready') ?? null : null;
      const folder = payload.folder === null ? nextFolder(`${original?.folder ?? 'restored'}${original ? '-restored' : ''}`.slice(0, 64), await files.takenFolders()) : payload.folder ?? 'restored';
      this.workspacePath(folder);
      const recoveryCode = typeof payload.recoveryCode === 'string' ? payload.recoveryCode : undefined;
      const typed = payload.passphrase !== undefined && payload.passphrase !== null;
      let how: 'this-computer' | 'typed' = typed ? 'typed' : 'this-computer', fresh: Buffer | null = null, credentials: { passphrase: string } | { recoveryCode: string; newPassphrase: string };
      if (recoveryCode !== undefined && typed) credentials = { recoveryCode, newPassphrase: payload.passphrase };
      else if (recoveryCode !== undefined && custody) {
        const probe = await custody.keys.probe(); if (!probe.available) throw deviceKeysUnavailable(probe.reason);
        let secret = header ? await this.existingComputerSecret(header.vaultId) : null;
        if (!secret) { fresh = randomBytes(32); secret = fresh.toString('base64url'); }
        credentials = { recoveryCode, newPassphrase: secret };
      } else if (!typed && custody) {
        check(header, 'BACKUP_NOT_FOUND', CUSTODY_WORDS.errors.BACKUP_NOT_FOUND);
        credentials = { passphrase: (await this.computerSecret(header.vaultId))! };
      } else { credentials = { passphrase: payload.passphrase }; how = 'typed'; }
      try {
        let vault: Vault;
        try { vault = await Vault.restore({ directory: this.workspacePath(folder), backupFile, ...credentials, storage: await this.adapter(folder) }); }
        catch (error) { if (custody && how === 'this-computer' && !('recoveryCode' in credentials) && (error as ChausarError).code === 'UNLOCK_FAILED') throw deviceKeyFailed(); throw error; }
        if (fresh) await this.storeComputerSecret(vault, fresh);
        await this.attachSafely(vault);
      } finally { fresh?.fill(0); }
      const rewrapped = 'recoveryCode' in credentials;
      await this.afterOpen(folder, how, { recovery: rewrapped ? 'made' : original?.recovery ?? (how === 'typed' ? 'made' : 'unknown'), reseal: rewrapped });
      return { workspace: this.store().read().workspace, folder };
    }
    if (method === 'workspace.lock') {
      if (this.vault) { authorize(this.vault, this.context, 'admin'); await this.closingBackup(); }
      await this.closeVault(); this.#closedByOwner = true; return { locked: true };
    }
    const store = this.store(); const ctx = this.context; authorize(store, ctx);
    const s = this.services;
    switch (method) {
      case 'workspace.custody.passphraseOn': this.requireAppOwner(ctx); return this.custodySerial(() => this.passphraseOn(payload));
      case 'workspace.custody.passphraseOff': this.requireAppOwner(ctx); return this.custodySerial(() => this.passphraseOff(payload));
      case 'workspace.custody.recoveryCode': this.requireAppOwner(ctx); return this.custodySerial(() => this.makeRecoveryCode(payload));
      case 'workspace.custody.neverContactReset': this.requireAppOwner(ctx); return this.custodySerial(() => this.neverContactReset(payload));
      case 'workspace.backups.create': this.requireAppOwner(ctx); return this.custodySerial(() => this.writeBackup('manual'));
      case 'workspace.backups.restore': this.requireAppOwner(ctx); return this.#oneStep('restore', 'restore', () => this.custodySerial(() => this.restoreManagedBackup(payload)));
      case 'workspace.backups.copyTo': this.requireAppOwner(ctx); return this.custodySerial(() => this.backupCopyTo(payload));
      case 'workspace.backups.drive.status': this.requireAppOwner(ctx); return this.driveStatus();
      case 'workspace.backups.drive.connect': this.requireAppOwner(ctx); return this.driveOf().connect();
      case 'workspace.backups.drive.disconnect': this.requireAppOwner(ctx); await this.driveOf().disconnect(); return this.custodySerial(() => this.driveNote(null).then(() => this.driveStatus()));
      // One-shot C6: one read at a time (the custody chain), on the owner's press in the app only.
      case 'workspace.backups.inspect': this.requireAppOwner(ctx); return this.custodySerial(() => this.inspectManagedBackup(payload));
      case 'workspace.transfer.export': this.requireAppOwner(ctx); return this.custodySerial(() => this.transferExport(payload));
      case 'auth.session': return s.auth.issueSession(ctx, payload.memberId ?? ctx.memberId, payload.ttlMs);
      case 'auth.revoke': return s.auth.revokeSession(ctx, payload.sessionId ?? payload.id);
      case 'calculation.run': return s.calculator.calculate(ctx, payload);
      case 'receipts.get': return s.calculator.receipt(ctx, payload.id);
      case 'trust.get': return { ...store.read().policy, policy: store.read().policy, members: ['owner', 'cofounder'].includes(ctx.role) ? store.read().members : [] };
      case 'trust.update': return s.trust.updatePolicy(ctx, payload.policy ?? payload);
      case 'members.add': return s.trust.addMember(ctx, payload);
      case 'members.revoke': return s.trust.revokeMember(ctx, payload.id);
      case 'workspace.export': {
        this.requireWorkspaceOwner(ctx); check(payload.confirmed === true, 'CONFIRMATION_REQUIRED', 'Confirm the export in the app.');
        const tail = payload.plaintext ? 'json' : 'vault';
        // C4 task 36 (206.x1): a path only the desktop's own save dialog chose (main.cjs, export-save.cjs; the window's
        // requests can't carry one): absolute, with the export's own extension. Without one, Chausar's exports folder.
        if (payload.path !== undefined) {
          check(ctx.channel === 'desktop' && !ctx.sourceTainted, 'APP_APPROVAL_REQUIRED', 'Export a copy from inside the app.');
          check(typeof payload.path === 'string' && isAbsolute(payload.path) && payload.path.length <= 1024 && payload.path.toLowerCase().endsWith(`.${tail}`), 'INVALID_PATH', 'Choose where to save the copy in the save dialog.');
          await store.export(payload.path, { plaintext: payload.plaintext === true });
          // C5 task 22: a readable copy notes itself, so Today can ask about it a day later; the path stays in the custody files.
          if (payload.plaintext === true) await this.custodyFiles().noteReadable(`chausar-${store.read().workspace.id}-${Date.now()}.json`, new Date(this.custodyNow()).toISOString(), payload.path).catch(() => {});
          return { path: payload.path, name: basename(payload.path), encrypted: payload.plaintext !== true };
        }
        const folder = join(this.options.directory, 'exports'); await mkdir(folder, { recursive: true }); const path = join(folder, `chausar-${store.read().workspace.id}-${Date.now()}.${tail}`);
        await store.export(path, { plaintext: payload.plaintext === true });
        // C5 task 22: a readable copy notes itself, kind and time only, so Today can ask about it a day later.
        if (payload.plaintext === true) await this.custodyFiles().noteReadable(basename(path), new Date(this.custodyNow()).toISOString()).catch(() => {});
        return { path, name: basename(path), encrypted: payload.plaintext !== true };
      }
      case 'workspace.delete': {
        this.requireWorkspaceOwner(ctx); check(payload.confirmation === store.read().workspace.name, 'CONFIRMATION_REQUIRED', 'Type the business name to delete it.');
        // One-shot A1 (row 1): its backups go; the copies the owner exported stay, and the answer names them.
        const removed = await this.removeManagedBackups(), exportsKept = await this.managedExports();
        const deletedVault = store.vaultId, deletedFolder = this.#openFolder, deletedWorkspace = store.read().workspace.id, deletedName = store.read().workspace.name;
        await store.delete(); await this.closeVault(); await this.forgetBusiness(deletedFolder, deletedVault);
        // A4 review round 2 (M2): the AI setup it saved goes too, so no later business names it. Never fails the delete.
        const aiSetup = this.#aiSetup();
        if (aiSetup) await forgetAiSetup(aiSetup, deletedWorkspace).catch(() => {});
        // One-shot A4 (hands-on S10): the business's own folder goes too, only when nothing is left in it.
        await this.removeEmptyFolder(this.workspacePath(deletedFolder ?? undefined));
        // C4 task 37 (211.x1): the name and how many backups went, for Welcome's "Pune Frames is deleted. 7 backups removed."
        return { deleted: true, name: deletedName, backupsRemoved: removed.length, copiesRemoved: removed, exportsKept, externalCopies: 'Copies made outside this app must be removed by their owner.' };
      }
      case 'venture.create':
      case 'venture.country.suggest':
      case 'venture.get':
      case 'venture.events':
      case 'venture.interview.next':
      case 'venture.interview.answer':
      case 'venture.blueprint.draft':
      case 'venture.blueprint.get':
      case 'venture.blueprint.update':
      case 'venture.blueprint.accept':
      case 'venture.models.presets':
      case 'venture.models.connect':
      case 'venture.models.disconnect':
      case 'venture.models.status':
      case 'venture.agentSettings.get':
      case 'venture.agentSettings.set':
      case 'venture.mcpCredential.set':
      case 'venture.mcpRegistry.list':
      case 'venture.mcpOAuth.start':
      case 'venture.packs.list':
      case 'venture.packs.add':
      case 'venture.packs.remove':
      case 'venture.agentApproval.decide':
      case 'venture.models.calls':
      case 'venture.price.quote':
      case 'venture.receipt.get':
      case 'venture.client.add':
      case 'venture.client.list':
      case 'venture.client.aiConsent.get':
      case 'venture.client.aiConsent.agree':
      case 'venture.client.aiConsent.withdraw':
      case 'venture.billing.get':
      case 'venture.billing.set':
      case 'venture.invoice.pdf':
      case 'venture.payment.receipt':
      case 'venture.invoice.payLink':
      case 'venture.invoice.shared':
      case 'venture.order.create':
      case 'venture.order.list':
      case 'venture.order.deliver':
      case 'venture.invoice.prepare':
      case 'venture.invoice.issue':
      case 'venture.invoice.get':
      case 'venture.invoice.list':
      case 'venture.payment.record':
      case 'venture.books.summary':
      case 'venture.spend.list':
      case 'venture.spend.policy.get':
      case 'venture.spend.policy.set':
      case 'venture.build.brief':
      case 'venture.build.handoff':
      case 'venture.build.handoffOpened':
      case 'venture.build.link':
      case 'venture.build.sync':
      case 'venture.build.status':
      case 'venture.connectors.list':
      case 'venture.delivery.playbook':
      case 'venture.simulation.scenarios':
      case 'venture.simulation.run':
      case 'venture.launch.status':
      case 'venture.launch.advance':
      case 'venture.delivery.run':
      case 'venture.delivery.review':
      case 'venture.delivery.list':
      case 'venture.files.add':
      case 'venture.files.list':
      case 'venture.work.get':
      case 'venture.improve.status':
      case 'venture.improve.run':
      case 'venture.improve.adopt':
      case 'venture.queue.list':
      case 'venture.queue.decide':
      case 'venture.runs.list':
      case 'venture.runs.get':
      case 'venture.team.list':
      case 'venture.team.gate':
      case 'venture.evidence.list':
      case 'venture.evidence.apply':
      case 'venture.journal.list':
      case 'venture.journal.resolve':
      case 'venture.untrusted.mode':
      case 'venture.untrusted.release':
      case 'venture.bank.import':
      case 'venture.bank.consent':
      case 'venture.site.stage':
      case 'venture.site.apply':
      case 'venture.site.revert':
      case 'venture.leads.add':
      case 'venture.leads.list':
      case 'venture.leads.draft':
      case 'venture.leads.recordSend':
      case 'venture.leads.find.view':
      case 'venture.leads.find.propose':
      case 'venture.leads.find.tools':
      case 'venture.queue.view':
      case 'venture.team.posture':
      case 'venture.evidence.dismiss':
      case 'venture.money.overview':
      case 'venture.tax.working':
      case 'venture.ca.get':
      case 'venture.ca.setOfRecord':
      case 'venture.ca.recordSignoff':
      case 'venture.ca.confirmRates':
      case 'venture.leads.block':
      case 'venture.share.create':
      case 'venture.share.list':
      case 'venture.share.revoke':
      case 'venture.delivery.judge':
      case 'venture.delivery.judgeSend':
      case 'venture.improve.rollback':
      case 'venture.files.transcribe':
      case 'venture.posting.propose':
      case 'venture.posting.signIn':
      case 'venture.posting.checkSteps':
      case 'venture.share.recordAnswer':
      case 'venture.social.calendar':
      case 'venture.bank.ledger':
      case 'venture.bank.apply':
      case 'venture.bank.alerts.get':
      case 'venture.bank.alerts.set':
      case 'venture.ca.receipt':
      case 'venture.ca.explainDiff':
      case 'venture.rules.list':
      case 'venture.rules.locks':
      case 'venture.rules.attest':
      case 'venture.compliance.get':
      // Once a business exists (before one, the draft desk answered above).
      case 'venture.about.families':
      case 'venture.compliance.set':
      case 'venture.judge.auto.get':
      case 'venture.judge.auto.set':
      case 'venture.posting.limits.get':
      case 'venture.posting.limits.set':
      case 'venture.transcription.get':
      case 'venture.transcription.set':
      // Ink v2 wave 4 (venture/contracts.ts W4_METHODS; venture.playbooks.list is answered before the vault check)
      case 'venture.team.keeper':
      case 'venture.team.clearQuarantine':
      case 'venture.agents.thread.list':
      case 'venture.agents.thread.send':
      case 'venture.agents.proposal.decide':
      case 'venture.agents.version.undo':
      case 'venture.agents.orders.list':
      case 'venture.chats.consent':
      case 'venture.agents.notes.list':
      case 'venture.agents.notes.edit':
      case 'venture.agents.notes.forget':
      case 'venture.agents.notes.undo':
      case 'venture.chief.threads':
      case 'venture.chief.thread.list':
      case 'venture.chief.thread.send':
      case 'venture.chief.thread.pin':
      case 'venture.chief.thread.state':
      case 'venture.chief.settle.set':
      case 'venture.layout.get':
      case 'venture.layout.change':
      case 'venture.find':
      case 'venture.diagnostics.today':
      case 'venture.build.briefFile':
      case 'venture.accountant.pack.done':
      case 'venture.accountant.schedule.set':
      case 'venture.accountant.schedule.get':
      case 'venture.accountant.set':
      case 'venture.accountant.get':
      case 'venture.notify.telegram.findChat':
      case 'venture.client.aiDefault.set':
      case 'venture.client.aiDefault.get':
      case 'venture.away.preview':
      case 'venture.team.introduced':
      case 'venture.chief.fit':
      case 'venture.proposals.raise':
      case 'venture.proposals.dismiss':
      case 'venture.network.import':
      case 'venture.network.importUndo':
      case 'venture.network.merge':
      case 'venture.network.split':
      case 'venture.network.forget':
      case 'venture.network.hide':
      case 'venture.network.people':
      case 'venture.network.person':
      case 'venture.network.sources':
      case 'venture.network.recompute':
      case 'venture.network.know':
      case 'venture.network.link':
      case 'venture.network.search':
      case 'venture.network.searchMore':
      case 'venture.network.saveSearch':
      case 'venture.network.research':
      case 'venture.pipeline.list':
      case 'venture.pipeline.followups':
      case 'venture.pipeline.add':
      case 'venture.pipeline.setNext':
      case 'venture.pipeline.move':
      case 'venture.pipeline.settings':
      case 'venture.outreach.draft':
      case 'venture.outreach.open':
      case 'venture.outreach.sent':
      case 'venture.outreach.restricted':
      case 'venture.mailbox.connect':
      case 'venture.mailbox.disconnect':
      case 'venture.mailbox.sync':
      case 'venture.inbound.list':
      case 'venture.inbound.confirm':
      case 'venture.network.calendar':
      case 'venture.meeting.digest':
      case 'venture.runs.stop':
      case 'venture.runs.resume':
      case 'venture.runs.roundGate':
      case 'venture.runs.steer':
      case 'venture.business.pause':
      case 'venture.away.set':
      case 'venture.away.get':
      case 'venture.runs.allowWrites':
      case 'venture.notify.list':
      case 'venture.notify.read':
      case 'venture.notify.settings':
      case 'venture.notify.push.key':
      case 'venture.notify.push.subscribe':
      case 'venture.notify.push.unsubscribe':
      case 'venture.notify.relay':
      case 'venture.notify.telegram':
      case 'venture.phone.access':
      case 'venture.web.search':
      case 'venture.web.read':
      case 'venture.people.services':
      case 'venture.people.lookup':
      case 'venture.crm.client':
      case 'venture.crm.client.edit':
      case 'venture.crm.companies':
      case 'venture.crm.company':
      case 'venture.crm.company.save':
      case 'venture.crm.link':
      case 'venture.crm.log':
      case 'venture.crm.lists':
      case 'venture.crm.list':
      case 'venture.crm.list.save':
      case 'venture.crm.list.place':
      case 'venture.memory.list':
      case 'venture.memory.add':
      case 'venture.memory.replace':
      case 'venture.memory.visibility':
      case 'venture.memory.forget':
      case 'venture.agents.retire.check':
      case 'venture.agents.retire':
      case 'venture.agents.restore':
      case 'venture.apps.list':
      case 'venture.apps.get':
      case 'venture.apps.make':
      case 'venture.apps.grant':
      case 'venture.apps.revoke':
      case 'venture.apps.restore':
      case 'venture.apps.pin':
      case 'venture.apps.export':
      case 'venture.apps.call':
      case 'venture.apps.remove':
      case 'venture.talk.get':
      case 'venture.talk.consent':
      case 'venture.talk.setup':
      case 'venture.talk.start':
      case 'venture.talk.hear':
      case 'venture.talk.say':
      case 'venture.feedback.get':
      case 'venture.feedback.consent':
      case 'venture.feedback.send':
      case 'venture.feedback.answer':
      case 'venture.feedback.crash':
      case 'venture.feedback.delete':
      case 'venture.models.cli.status':
      case 'venture.models.roles':
      case 'venture.goals.get':
      case 'venture.goals.set':
      case 'venture.goals.suggest':
      case 'venture.decisions.list':
      case 'venture.earlier.list':
      case 'venture.policy.allowSession':
      case 'venture.queue.sendBack':
      case 'venture.queue.edit':
      case 'venture.queue.undo':
      case 'venture.queue.set':
      case 'venture.triage.set':
      case 'venture.triage.preview':
      case 'venture.delivery.fix':
      case 'venture.delivery.decideChange':
      case 'venture.delivery.changes':
      case 'venture.settings.draft':
      case 'venture.settings.drafts':
      case 'venture.queue.setPreview':
      case 'venture.delivery.copy':
      case 'venture.money.aging':
      case 'venture.money.flow':
      case 'venture.money.cash':
      case 'venture.money.margins':
      case 'venture.money.export':
      case 'venture.bills.add':
      case 'venture.bills.pay':
      case 'venture.bills.list':
      case 'venture.credit.issue':
      case 'venture.invoice.recurring':
      case 'venture.invoice.recurringList':
      case 'venture.invoice.remind':
      case 'venture.payment.clear':
      case 'venture.bills.stop':
      case 'venture.money.across':
      case 'venture.runs.across':
      case 'venture.connectors.check':
      case 'venture.share.request':
      case 'venture.blueprint.suggest':
      case 'venture.owner.get':
      case 'venture.owner.set':
      case 'venture.needs.list':
      case 'venture.receipt.verify':
      case 'venture.journal.chain':
      case 'venture.journal.acceptBreak':
      case 'venture.order.contract':
      case 'venture.order.contract.propose':
      case 'venture.order.contract.sign':
      case 'venture.routines.list':
      case 'venture.routines.suggestions':
      case 'venture.routines.runs':
      case 'venture.routines.set':
      case 'venture.routines.remove':
      case 'venture.drills.run':
      case 'venture.drills.list':
      case 'venture.playbook.guidance':
      case 'venture.voice.get':
      case 'venture.voice.set':
      case 'venture.voice.learn':
      case 'venture.persona.get':
      case 'venture.persona.set':
      case 'venture.persona.test':
      case 'venture.agents.export':
      case 'venture.agents.import':
      case 'venture.knowledge.list':
      case 'venture.knowledge.add':
      case 'venture.knowledge.remove':
      case 'venture.knowledge.test':
      case 'venture.ideas.list':
      case 'venture.ideas.start':
      case 'venture.ideas.dismiss':
      case 'venture.agents.capabilities':
      // Ink v2 wave 5 (venture/contracts.ts W5_METHODS)
      case 'venture.order.chain':
      case 'venture.salesProposal.draft':
      case 'venture.salesProposal.get':
      case 'venture.goNoGo.card':
      case 'venture.goNoGo.list':
      case 'venture.goNoGo.remove':
      case 'venture.ideas.add':
      case 'venture.ideas.move':
      case 'venture.ideas.grade':
      case 'venture.brandKit.get':
      case 'venture.brandKit.set':
      case 'venture.assets.list':
      case 'venture.assets.rerun':
      case 'venture.assets.reuse':
      case 'venture.voiceConsent.record':
      case 'venture.voiceConsent.revoke':
      case 'venture.voiceConsent.list':
      case 'venture.report.render':
      case 'venture.report.share':
      case 'venture.report.shareRotate':
      case 'venture.report.shareDisable':
      case 'venture.report.list':
      case 'venture.monitors.list':
      case 'venture.monitors.add':
      case 'venture.monitors.remove':
      case 'venture.mail.import':
      case 'venture.mail.threads':
      case 'venture.localApps.list':
      case 'venture.webhook.set':
      case 'venture.webhook.send':
      case 'venture.speechOut.providers':
      case 'venture.ca.confirmCitations':
      case 'venture.ca.signoff.get':
      case 'venture.ca.dataPack.export':
      case 'venture.desk.list':
      case 'venture.desk.get':
      case 'venture.models.plan':
      case 'venture.routines.backup.get':
      case 'venture.routines.backup.set':
      case 'venture.trackers.list':
      case 'venture.trackers.get':
      case 'venture.trackers.set':
      case 'venture.trackers.rows.add':
      case 'venture.trackers.rows.edit':
      case 'venture.trackers.rows.remove':
      case 'venture.trackers.rows.undo':
      case 'venture.agents.hire.start':
      case 'venture.agents.hire.answer':
      case 'venture.agents.hire.confirm':
      case 'venture.events.get':
      case 'venture.events.relay.set':
      case 'venture.events.calKey.set':
      case 'venture.agents.hire.duties':
      case 'venture.agents.hire.team':
      case 'venture.chief.plan.get':
      case 'venture.chief.plan.move':
      case 'venture.chief.review.set':
      case 'venture.desk.act':
        return (await this.#ventureHost()).request(ctx, method, payload);
      default: throw new Error(`Unknown request: ${method}`);
    }
  }
  /**
   * One-shot A1 (row 1): the copies in Chausar's exports folder of this business. Delete keeps them (the owner exported
   * them to keep).
   */
  private async managedExports(): Promise<string[]> {
    const folder = resolve(this.options.directory, 'exports'), prefix = `chausar-${this.store().read().workspace.id}-`;
    let files;
    try { files = await readdir(folder, { withFileTypes: true }); } catch (error) { if ((error as any).code === 'ENOENT') return []; throw error; }
    return files.filter(file => file.isFile() && file.name.startsWith(prefix) && MANAGED_COPY_TAIL.test(file.name.slice(prefix.length))).map(file => join(folder, file.name)).sort();
  }
  /** Removes this business's backups from Chausar's own backups folder and answers their names. */
  private async removeManagedBackups(): Promise<string[]> {
    const folder = resolve(this.options.directory, 'backups'), prefix = `chausar-${this.store().read().workspace.id}-`, removed: string[] = [];
    let files;
    try { files = await readdir(folder, { withFileTypes: true }); } catch (error) { if ((error as any).code === 'ENOENT') return removed; throw error; }
    for (const file of files) if (file.isFile() && file.name.startsWith(prefix) && MANAGED_COPY_TAIL.test(file.name.slice(prefix.length))) {
      const path = resolve(folder, file.name); check(relative(folder, path) === file.name, 'INVALID_PATH', 'A managed file left its backups folder.');
      await unlink(path); removed.push(`backups/${file.name}`);
    }
    return removed;
  }
  // ------------------------------------------------------------ keeping the vault key on this computer
  // KEYCHAIN-SPEC sections 2 to 4 and 8. The computer secret sits in the vault's passphrase slot; the
  // operating system keeps it for the owner's login. Secrets never reach a result, a record, a log or an error.
  #custody: { files: CustodyFiles; keys: DeviceKeyStore; autoBackups: boolean; clock: () => number } | null = null;
  #custodyFiles: CustodyFiles | null = null;
  #custodyChain: Promise<unknown> = Promise.resolve();
  #openFolder: string | null = null;
  #openUnlock: UnlockMode | null = null;
  #closedByOwner = false;
  #schedule: BackupSchedule = { lastAt: null, lastRevision: null, due: false, lastError: null };
  private custodyHost() {
    const option = this.options.workspaceCustody; if (!option) return null;
    if (!this.#custody) {
      const keys = option.deviceKeys === 'os' ? osDeviceKeyStore() : option.deviceKeys === 'none' ? noDeviceKeyStore('not-configured') : option.deviceKeys;
      this.#custody = { files: this.custodyFiles(), keys, autoBackups: option.autoBackups === true, clock: option.clock ?? Date.now };
    }
    return this.#custody;
  }
  private custodyFiles(): CustodyFiles { return this.#custodyFiles ??= new CustodyFiles(this.options.directory); }
  /**
   * 15 Nov 2026 (the first Windows walk: workspace.create took 5 to 12 seconds). The check that this computer can keep a
   * key (device-custody.ts probe) is one process start, Windows PowerShell on Windows, and making or opening a business
   * ran it and then the key itself, one after the other. It starts here instead, once for this engine, when the first
   * screen asks its first question, so only the key's own start is left to wait for. The same check with the same
   * answer: the key store keeps a success, asks again after a failure, and never throws.
   */
  #keysWarmed = false;
  private warmDeviceKeys(): void {
    if (this.#keysWarmed) return;
    this.#keysWarmed = true;
    const keys = this.custodyHost()?.keys;
    if (keys) void keys.probe().catch(() => {});
  }
  private custodyNow(): number { return this.custodyHost()?.clock() ?? Date.now(); }
  private storageKind(): 'experimental-file' | 'postgres' {
    return this.vault?.storageKind ?? (this.options.storage === 'experimental-file' && (this.options.demo || this.options.venture?.host === 'desktop') ? 'experimental-file' : 'postgres');
  }
  /** One custody change, backup write, rotation or reseal at a time. */
  private custodySerial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.#custodyChain.then(work); this.#custodyChain = next.catch(() => {}); return next;
  }
  private resetCustodySession() {
    this.#openFolder = null; this.#openUnlock = null;
    this.#schedule = { lastAt: null, lastRevision: null, due: false, lastError: null };
    this.#snapshotMark = { at: null, revision: null };
    // C5 task 24: an unfinished Google sign-in closes with the business.
    this.#drive?.client.close(); this.#drive = null;
  }
  // ------------------------------------------------------------ business snapshots (Ink v2 wave 4, 4J6)
  // What the other businesses on this computer may know about one that is closed (workspace-snapshots.ts): written at
  // most once a minute while it changes and again on lock, only for a business that opens with this computer.
  #snapshots: WorkspaceSnapshots | null = null;
  #snapshotMark: { at: number | null; revision: number | null } = { at: null, revision: null };
  /** The summaries and the never-contact list on this computer; null on the hosted app or without custody. */
  private snapshotStore(): WorkspaceSnapshots | null {
    if (this.options.venture?.host === 'hosted-web') return null;
    const custody = this.custodyHost(); if (!custody) return null;
    return this.#snapshots ??= new WorkspaceSnapshots(this.options.directory, () => custody.keys);
  }
  /** The other businesses as their summaries read, the open one left out; a passphrase one is never read. Never throws. */
  private async snapshotReads(): Promise<BusinessSnapshotRead[]> {
    const store = this.snapshotStore(); if (!store) return [];
    try {
      const files = this.custodyFiles();
      const listed = (await files.listBusinesses(this.storageKind())).businesses;
      const vaults = new Map((await files.listCards()).map(card => [card.folder, card.vaultId]));
      return await store.list(listed.map(item => ({ id: item.folder, name: item.name, opens: item.opens, openedAt: item.openedAt })), vaults, this.vault ? this.#openFolder : null);
    } catch { return []; }
  }
  /**
   * workspace.custody.neverContactReset { confirmation } (4J6): the owner's explicit step to start a new never-contact
   * list, only while the old one can no longer be checked (NEVER_CONTACT_LOST; one that still checks is NEVER_CONTACT_OK).
   * The caller has passed requireAppOwner, so a business is open; confirmation is its name. Refused on the hosted app.
   * The open business adds its own blocklist again at once, the others when next opened; people forgotten elsewhere
   * can't be put back. Journalled in the audit.
   */
  private async neverContactReset(payload: any): Promise<{ line: string }> {
    const store = this.snapshotStore(), vault = this.store();
    check(store, 'TIER_UNAVAILABLE', 'This computer keeps no never-contact list.');
    check(typeof payload?.confirmation === 'string' && payload.confirmation === vault.read().workspace.name, 'CONFIRMATION_REQUIRED', 'Type the business name to start a new never-contact list.');
    let lost = false;
    try { await store.neverContactHas([]); } catch (error) { if ((error as ChausarError)?.code !== 'NEVER_CONTACT_LOST') throw error; lost = true; }
    check(lost, 'NEVER_CONTACT_OK', 'Your never-contact list on this computer still checks, so there is nothing to start again.');
    const line = await store.neverContactReset();
    await vault.update(state => audit(state, 'custody.never-contact-reset', {}));
    this.#snapshotMark = { at: null, revision: null };
    await this.writeSnapshot(false);
    return { line };
  }
  /** At a tick: the open business's summary, when one is due. Never throws. */
  private async snapshotTick() {
    if (this.#closing || this.#transition || !this.vault) return;
    const done = this.beginRequest('tick.snapshot');
    try { await this.writeSnapshot(false); } finally { done(); }
  }
  /**
   * The open business's summary when due, or on lock: written only for a business that opens with this computer; one
   * that needs a passphrase has its summary taken away. Either way the addresses its own blocklist keeps out join the
   * never-contact list, as keyed checks. Never throws: the next tick or lock tries again.
   */
  /** Whether a summary is due now: a store, an open venture business, and snapshotDue. Synchronous; never throws. */
  private snapshotWanted(lock: boolean): boolean {
    const store = this.snapshotStore(), vault = this.vault, folder = this.#openFolder;
    if (!store || !vault || !folder) return false;
    try {
      if (!vault.read().conversations.some((record: any) => record?.kind === 'venture-record')) return false;
      return snapshotDue(this.#snapshotMark, vault.read().revision, this.custodyNow(), lock);
    } catch { return false; }
  }
  private async writeSnapshot(lock: boolean) {
    const store = this.snapshotStore(), vault = this.vault, folder = this.#openFolder;
    if (!store || !vault || !folder) return;
    try {
      if (!this.snapshotWanted(lock)) return;
      const host = await this.#ventureHost() as unknown as { snapshot?: (ctx: Context) => Promise<{ snapshot: Record<string, unknown>; neverContact: string[] } | null> };
      if (this.vault !== vault || typeof host.snapshot !== 'function') return;
      const made = await host.snapshot({ ...this.#baseContext });
      if (!made) return;
      this.#snapshotMark = { at: this.custodyNow(), revision: vault.read().revision };
      if (made.neverContact.length) await store.neverContactAdd(made.neverContact).catch(() => {});
      if (this.#openUnlock !== 'this-computer') { await store.remove(folder); return; }
      await store.write(folder, { format: SNAPSHOT_FORMAT, businessId: folder, vaultId: vault.vaultId, ...made.snapshot } as BusinessSnapshot);
    } catch { /* The next tick or lock tries again. */ }
  }
  private requireAppOwner(ctx: Context) {
    this.requireWorkspaceOwner(ctx);
    check(ctx.channel === 'desktop' && !ctx.sourceTainted, 'APP_APPROVAL_REQUIRED', 'Change how your business is kept from inside the app.');
  }
  /** The secret this computer keeps for a vault. PASSPHRASE_REQUIRED with no key record; DEVICE_KEY_FAILED when the OS refuses. */
  private async computerSecret(vaultId: string | null): Promise<string> {
    const custody = this.custodyHost(); if (!custody) throw deviceKeysUnavailable('not-configured');
    const record = vaultId ? await custody.files.readKey(vaultId) : null;
    if (!record) throw new ChausarError('PASSPHRASE_REQUIRED', CUSTODY_WORDS.errors.PASSPHRASE_REQUIRED);
    // A business already kept by this computer: no passphrase opens it, so never say "Chausar asks for a passphrase".
    const probe = await custody.keys.probe();
    if (!probe.available) throw probe.reason === 'not-configured' || probe.reason === 'platform' ? deviceKeyFailed(probe.reason)
      : Object.assign(new ChausarError('DEVICE_KEY_FAILED', CUSTODY_WORDS.lock.keyNotAnswering), { reason: probe.reason });
    let secret: Buffer | null;
    try { secret = await custody.keys.unprotect(record); } catch { throw deviceKeyFailed(); }
    if (!secret) throw deviceKeyFailed();
    try { return secret.toString('base64url'); } finally { secret.fill(0); }
  }
  /** The secret another folder of the same vault already uses, so both keep opening; null when there is none. */
  private async existingComputerSecret(vaultId: string): Promise<string | null> {
    try { return await this.computerSecret(vaultId); } catch { return null; }
  }
  private async storeComputerSecret(vault: Vault, secret: Buffer) {
    const custody = this.custodyHost()!; let record: DeviceKeyRecord | null = null;
    try { record = await custody.keys.protect(vault.vaultId, secret); await custody.files.writeKey(record); }
    catch {
      if (record) await custody.keys.forget(record).catch(() => {});
      await vault.close().catch(() => {}); throw deviceKeyFailed();
    }
  }
  /** Forget this computer's key for a vault unless another business folder still opens with it. */
  private async forgetKeyIfUnused(vaultId: string, folder: string | null) {
    const custody = this.custodyHost(); if (!custody) return;
    const others = (await custody.files.listCards()).filter(card => card.vaultId === vaultId && card.folder !== folder && card.unlock === 'this-computer');
    if (others.length) return;
    const record = await custody.files.readKey(vaultId); if (!record) return;
    await custody.keys.forget(record).catch(() => {});
    await custody.files.removeKey(vaultId);
  }
  private async currentCard(): Promise<VaultCard> {
    const custody = this.custodyHost(); if (!custody) throw deviceKeysUnavailable('not-configured');
    const card = this.#openFolder ? await custody.files.readCard(this.#openFolder) : null;
    check(card, 'VAULT_LOCKED', 'Open your business first.');
    return card;
  }
  /** After a vault opens: remember how, write or refresh its card, finish an interrupted custody change. */
  private async afterOpen(folder: string, how: 'this-computer' | 'typed', options: { recovery?: RecoveryState; reseal?: boolean; created?: boolean } = {}) {
    this.#openFolder = folder; this.#openUnlock = how === 'this-computer' ? 'this-computer' : 'passphrase'; this.#closedByOwner = false;
    const custody = this.custodyHost(); if (!custody) return;
    await this.loadSchedule();
    const vault = this.store(), state = vault.read(), unlock = this.#openUnlock, prior = await custody.files.readCard(folder);
    const recovery: RecoveryState = options.recovery ?? (prior?.state === 'ready' ? prior.recovery : how === 'typed' ? 'made' : 'unknown');
    const reseal = !!options.reseal || (!!prior && prior.state === 'ready' && (prior.pending !== null || prior.unlock !== unlock));
    const card: VaultCard = { ...(prior ?? newCard({ folder, unlock, recovery })), vaultId: vault.vaultId, workspaceId: state.workspace.id,
      name: state.workspace.name, demo: state.workspace.demo, unlock, recovery, state: 'ready', pending: reseal ? 'reseal' : null,
      wrappersDigest: vault.wrappersDigest, openedAt: new Date(this.custodyNow()).toISOString() };
    await custody.files.writeCard(card);
    if (reseal) await this.resealManaged();
    if (how === 'typed') await this.forgetKeyIfUnused(vault.vaultId, folder);
    if (how === 'typed') await this.snapshotStore()?.remove(folder); // a passphrase business keeps no summary (4J6)
    if (reseal) await custody.files.writeCard({ ...card, pending: null });
  }
  private async loadSchedule() {
    this.#schedule = { lastAt: null, lastRevision: null, due: false, lastError: null };
    const vault = this.vault; if (!vault || !this.custodyHost()) return;
    const files = this.custodyFiles(), newest = (await files.backupFiles(vault.read().workspace.id))[0];
    if (!newest) return;
    const header = await files.backupHeader(newest.name);
    this.#schedule = { ...this.#schedule, lastAt: newest.at, lastRevision: header?.vaultId === vault.vaultId ? header.revision : null };
  }
  /** Re-seal this vault's managed backups and encrypted exports with the live wrappers (KEYCHAIN-SPEC 4.4). Skipped when
   * this folder opens with this computer and another folder of the same vault is locked with a passphrase: the backups
   * are shared by workspace id, and resealing them would quietly undo that passphrase. */
  private async resealManaged() {
    const vault = this.store(), files = this.custodyFiles(), workspaceId = vault.read().workspace.id;
    if (this.#openUnlock !== 'passphrase' && (await files.listCards()).some(card => card.state === 'ready' && card.vaultId === vault.vaultId
      && card.folder !== this.#openFolder && card.unlock === 'passphrase')) return { resealed: [], skipped: [] };
    const paths = [...(await files.backupFiles(workspaceId)).map(file => join(files.backups, file.name)), ...await files.exportFiles(workspaceId)];
    return vault.resealBackups(paths);
  }
  private async backupView(name: string): Promise<BackupView> {
    const files = this.custodyFiles(), cards = this.custodyHost() ? await files.listCards() : [];
    const found = (await files.backupViews(this.store().read().workspace.id, cards)).backups.find(view => view.file === name);
    check(found, 'BACKUP_NOT_FOUND', CUSTODY_WORDS.errors.BACKUP_NOT_FOUND);
    return (await this.labelledBackups([found]))[0]!;
  }
  /** Writes one managed backup (ciphertext only) and, for automatic and safety copies, applies the rotation. */
  private async writeBackup(kind: BackupKind): Promise<BackupView> {
    const vault = this.store(), files = this.custodyFiles(), workspaceId = vault.read().workspace.id, revision = vault.read().revision;
    const folder = await safeDirectory(files.backups, true);
    let at = this.custodyNow(), name = backupName(workspaceId, at, kind);
    for (const taken = new Set((await readdir(folder)).map(item => item.toLowerCase())); taken.has(name.toLowerCase()); name = backupName(workspaceId, ++at, kind));
    await vault.backup(join(folder, name));
    this.#schedule = { lastAt: at, lastRevision: revision, due: false, lastError: null };
    if (kind !== 'manual') {
      const { remove } = keepBackups(await files.backupFiles(workspaceId), this.custodyNow());
      for (const old of remove) await files.removeBackup(old).catch(() => {});
    }
    if (kind === 'auto') await this.copyBackupOut();
    return this.backupView(name);
  }
  /** C5 task 23: sets or clears the drive or folder automatic backups are copied to, and copies the newest now. Main asks this after its own folder pick. */
  private async backupCopyTo(payload: any): Promise<{ copy: BackupCopyView | null }> {
    check(payload.confirmed === true, 'CONFIRMATION_REQUIRED', 'Confirm the folder in the app.');
    const card = await this.currentCard(), files = this.custodyFiles();
    if (payload.folder === null) { await files.writeCard({ ...card, copy: null }); return { copy: null }; }
    check(typeof payload.folder === 'string' && isAbsolute(payload.folder), 'INVALID_PATH', 'Pick the folder in the app.');
    const inside = relative(resolve(this.options.directory), resolve(payload.folder));
    check(inside.startsWith('..') || isAbsolute(inside), 'INVALID_PATH', "Pick a folder outside Chausar's own folders.");
    await files.writeCard({ ...card, copy: { folder: resolve(payload.folder), lastFile: null, lastCopiedAt: null, problem: null } });
    await this.copyBackupOut();
    return { copy: copyViewOf((await this.currentCard()).copy) };
  }
  /** C5 task 24: the open business's Drive client. Its refresh token stays in the credential store, under this business. */
  private driveOf(): DriveBackup {
    const workspaceId = this.store().read().workspace.id;
    if (this.#drive?.workspaceId === workspaceId) return this.#drive.client;
    this.#drive?.client.close();
    const option = this.options.drive, build = option ?? driveClientOfBuild(), port = this.options.venture?.credentials;
    const tokens: DriveTokens = option?.tokens ?? {
      read: async () => (port ? port.get(workspaceId, 'backups:google-drive') : null),
      write: async (text: string) => { if (!port) throw new ChausarError('DRIVE_NOT_SET_UP', CUSTODY_WORDS.errors.DRIVE_NOT_SET_UP); await port.set(workspaceId, 'backups:google-drive', text); },
      remove: async () => { await port?.delete(workspaceId, 'backups:google-drive'); },
    };
    const client = new DriveBackup({ clientId: build.clientId, clientSecret: build.clientSecret ?? null, tokens, ...(option?.endpoints ? { endpoints: option.endpoints } : {}), ...(option?.chunkBytes ? { chunkBytes: option.chunkBytes } : {}) });
    this.#drive = { workspaceId, client };
    return client;
  }
  private async driveStatus(): Promise<DriveStatus> {
    const { state } = await this.driveOf().status();
    const card = this.custodyHost() && this.#openFolder ? await this.custodyFiles().readCard(this.#openFolder) : null;
    return { state, lastCopiedAt: card?.drive?.lastCopiedAt ?? null, problem: card?.drive?.problem ?? null };
  }
  /** What the card remembers about Drive: the last file and when, or the problem. Never a token. */
  private async driveNote(note: NonNullable<VaultCard['drive']> | null): Promise<void> {
    const custody = this.custodyHost(); if (!custody || !this.#openFolder) return;
    const card = await custody.files.readCard(this.#openFolder);
    if (card) await custody.files.writeCard({ ...card, drive: note });
  }
  /** C5 task 24: the newest backup to Drive, when Drive is connected and hasn't got it. Never throws: a problem is said on the card. */
  private async driveBackupOut(): Promise<void> {
    const custody = this.custodyHost(), vault = this.vault;
    if (!custody || !vault || !this.#openFolder) return;
    try {
      const drive = this.driveOf();
      if ((await drive.status()).state !== 'connected') return;
      const card = await custody.files.readCard(this.#openFolder), workspaceId = vault.read().workspace.id;
      const newest = (await custody.files.backupFiles(workspaceId))[0];
      if (!card || !newest || (card.drive?.lastFile === newest.name && !card.drive.problem)) return;
      try {
        await drive.upload(newest.name, Buffer.from(await readBoundedText(custody.files.backupPath(newest.name))), workspaceId);
        await this.driveNote({ lastFile: newest.name, lastCopiedAt: new Date(this.custodyNow()).toISOString(), problem: null });
      } catch (error) {
        await this.driveNote({ lastFile: card.drive?.lastFile ?? null, lastCopiedAt: card.drive?.lastCopiedAt ?? null, problem: error instanceof ChausarError ? error.message : "Google Drive didn't take the copy. Chausar tries again with the next backup." });
      }
    } catch { /* not set up, or nothing to do: Drive is a help, never a gate */ }
  }
  /** C5 task 23: the newest backup to the owner's folder, when it isn't there yet. Never throws: a problem is said on the card, and the next tick tries again. */
  private async copyBackupOut(): Promise<void> {
    const custody = this.custodyHost(), vault = this.vault;
    if (!custody || !vault || !this.#openFolder) return;
    try {
      const files = custody.files, card = await files.readCard(this.#openFolder), copy = card?.copy;
      if (!card || !copy) return;
      const workspaceId = vault.read().workspace.id, newest = (await files.backupFiles(workspaceId))[0];
      if (!newest || (copy.lastFile === newest.name && !copy.problem)) return;
      let next = copy;
      try {
        await files.copyBackupOut(newest.name, copy.folder, workspaceId);
        next = { ...copy, lastFile: newest.name, lastCopiedAt: new Date(this.custodyNow()).toISOString(), problem: null };
      } catch (error) {
        const code = (error as { code?: unknown }).code;
        const words = code === 'ENOENT' || code === 'ENOTDIR' || code === 'ENODEV' ? CUSTODY_WORDS.copy.missing
          : code === 'EACCES' || code === 'EPERM' || code === 'EROFS' ? CUSTODY_WORDS.copy.denied
            : code === 'ENOSPC' || code === 'EDQUOT' ? CUSTODY_WORDS.copy.full : CUSTODY_WORDS.copy.failed;
        next = { ...copy, problem: words };
      }
      await files.writeCard({ ...card, copy: next });
    } catch { /* the copy is a help, never a gate: the next tick tries again */ }
  }
  /** A safety copy before a lock change. Best effort, except with no recovery code yet: then it is the only way back
   * if the change is cut short, so the change is refused (SAFETY_BACKUP_FAILED) and nothing changes. */
  private async safetyBackup(required = false): Promise<BackupView | null> {
    try { return await this.writeBackup('safety'); }
    catch (error) {
      this.#schedule.lastError = (error as Error).message.slice(0, 300);
      if (required) throw new ChausarError('SAFETY_BACKUP_FAILED', CUSTODY_WORDS.lock.safetyBackupFailed);
      return null;
    }
  }
  /** Puts a lock change that failed partway back the way it was, with the secret the vault opened with before.
   * When even that fails, the card keeps its marker and the next open tries both ways in. Never throws. */
  private async undoLockChange(card: VaultCard, secret: string | null, made: DeviceKeyRecord | null) {
    const custody = this.custodyHost(), vault = this.vault; if (!custody || !vault || !secret) return;
    try {
      await vault.rewrapPassphrase(secret);
      await custody.files.writeCard({ ...card, pending: null, wrappersDigest: vault.wrappersDigest });
    } catch { return; }
    this.#openUnlock = card.unlock;
    if (made) { await custody.keys.forget(made).catch(() => {}); await custody.files.removeKey(made.vaultId).catch(() => {}); }
    // The undo made a new wrapper (a new salt), so bring the backups to it again.
    await this.resealManaged().catch(() => {});
  }
  /** At a tick: an automatic backup when one is due (KEYCHAIN-SPEC 4.1). Never throws. */
  private async backupTick() {
    const custody = this.custodyHost();
    if (!custody?.autoBackups || this.#closing || this.#transition || !this.vault) return;
    const done = this.beginRequest('tick.backup');
    try {
      await this.custodySerial(async () => {
        if (!this.vault || !backupDue(this.#schedule, this.vault.read().revision, custody.clock())) return;
        try { await this.writeBackup('auto'); }
        catch (error) { this.#schedule.lastError = (error as Error).message.slice(0, 300); }
      });
      // C5 task 23: a copy that couldn't reach its folder goes when it can.
      await this.custodySerial(() => this.copyBackupOut());
      // C5 task 24: and the newest to Google Drive, once it is connected.
      await this.custodySerial(() => this.driveBackupOut());
    } finally { done(); }
  }
  /** Closing: back up first when the business changed since its last backup. Best effort, never blocks closing. */
  private async closingBackup() {
    const custody = this.custodyHost();
    if (!custody?.autoBackups || !this.vault || this.#schedule.lastRevision === this.vault.read().revision) return;
    await this.custodySerial(async () => {
      try { if (this.vault) await this.writeBackup('auto'); }
      catch (error) { this.#schedule.lastError = (error as Error).message.slice(0, 300); }
    }).catch(() => {});
  }
  private async custodyView(): Promise<CustodyView> {
    const custody = this.custodyHost();
    const probe: ProbeResult = custody ? await custody.keys.probe() : { available: false, reason: 'not-configured' };
    const computer = computerView(custody?.keys.scheme ?? null, probe, probe.available);
    if (!this.vault) return { computer, business: null };
    const vault = this.vault, files = this.custodyFiles(), card = custody && this.#openFolder ? await files.readCard(this.#openFolder) : null;
    const backups = await files.backupFiles(vault.read().workspace.id), next = custody?.autoBackups ? nextBackupAt(this.#schedule, vault.read().revision, this.custodyNow()) : null;
    return { computer, business: { folder: this.#openFolder ?? '', unlock: this.#openUnlock ?? 'passphrase', recovery: card?.recovery ?? 'unknown', storage: vault.storageKind,
      backups: { auto: !!custody?.autoBackups, count: backups.length, newestAt: backups[0] ? new Date(backups[0].at).toISOString() : null,
        nextDueAt: next === null ? null : new Date(next).toISOString(), lastError: this.#schedule.lastError, copy: copyViewOf(card?.copy) },
      // C4 task 36: the name the save dialog offers, by the day on this computer's own clock and zone.
      exportName: exportFileName(vault.read().workspace.name, new Date(this.custodyNow()), Intl.DateTimeFormat().resolvedOptions().timeZone, false),
      // C4 task 37 (210.x2): the copies in Chausar's own exports folder, which Delete keeps.
      exportsHere: (await this.managedExports()).length,
      // C4 task 38 (219.x1): the newest move file made, until the owner dismisses it.
      moveMadeAt: moveMadeOf(vault.read().activity),
      storeBytes: vault.storeBytes(), storeLimit: STORE_LIMIT_BYTES } };
  }
  private async backupList() {
    const files = this.custodyFiles(), cards = await files.listCards();
    const listed = await files.backupViews(this.vault ? this.vault.read().workspace.id : null, cards);
    return this.vault ? { ...listed, backups: await this.labelledBackups(listed.backups) } : listed;
  }
  /** C5 task 20: each backup with what came just before it, read from the open vault. A label that can't be worked out is left off. */
  private async labelledBackups(backups: BackupView[]): Promise<BackupView[]> {
    if (!this.vault || !backups.length) return backups;
    try {
      // A label holds business words, and this list is answered before the vault check: the owner, in the app, only.
      this.requireAppOwner(this.context);
      const { backupLabels } = await import('./venture/journal/backup-labels.ts');
      const labels = backupLabels(this.vault.read(), backups.map(backup => backup.at), this.context.memberId);
      return backups.map((backup, index) => (labels[index] ? { ...backup, after: labels[index]! } : backup));
    } catch { return backups; }
  }
  private async passphraseOn(payload: any) {
    const vault = this.store(), card = await this.currentCard();
    check(card.unlock === 'this-computer', 'CUSTODY_UNCHANGED', CUSTODY_WORDS.errors.CUSTODY_UNCHANGED);
    check(typeof payload.passphrase === 'string' && payload.passphrase.length >= 12 && payload.passphrase.length <= 1024, 'WEAK_PASSPHRASE', 'Use a passphrase of 12 to 1024 characters.');
    const files = this.custodyFiles();
    await this.safetyBackup(card.recovery !== 'made');
    // The secret it opens with now, to put things back if a step below fails.
    const before = await this.existingComputerSecret(vault.vaultId);
    // The marker goes on the card before the rewrap, so a crash after it still finds the way in (workspace.open).
    await files.writeCard({ ...card, pending: 'to-passphrase' });
    let recoveryCode: string | null = null, next: VaultCard;
    try {
      await vault.rewrapPassphrase(payload.passphrase);
      // A passphrase can be forgotten and nobody can reset it, so the owner always leaves holding a recovery code.
      recoveryCode = card.recovery === 'made' ? null : await vault.rewrapRecovery();
      next = { ...card, unlock: 'passphrase', recovery: 'made', pending: 'forget', wrappersDigest: vault.wrappersDigest };
      await files.writeCard(next);
    } catch (error) {
      // Even a failed rewrap may have reached the disk, so commit the old secret again either way.
      await this.undoLockChange(card, before, null);
      throw error;
    }
    this.#openUnlock = 'passphrase';
    await this.snapshotStore()?.remove(card.folder); // its summary goes at once: a passphrase business keeps none (4J6)
    await this.resealManaged();
    await this.forgetKeyIfUnused(vault.vaultId, card.folder);
    await files.writeCard({ ...next, pending: null });
    await vault.update(state => audit(state, 'custody.passphrase-on', { recoveryMade: recoveryCode !== null }));
    return { custody: await this.custodyView(), recoveryCode };
  }
  private async passphraseOff(payload: any) {
    const custody = this.custodyHost()!, vault = this.store(), card = await this.currentCard();
    check(card.unlock === 'passphrase', 'CUSTODY_UNCHANGED', CUSTODY_WORDS.errors.CUSTODY_UNCHANGED);
    check(typeof payload.passphrase === 'string' && await vault.verifyPassphrase(payload.passphrase), 'PASSPHRASE_WRONG', CUSTODY_WORDS.errors.PASSPHRASE_WRONG);
    const probe = await custody.keys.probe(); if (!probe.available) throw deviceKeysUnavailable(probe.reason);
    let secret = await this.existingComputerSecret(vault.vaultId), made: DeviceKeyRecord | null = null;
    if (!secret) {
      const bytes = randomBytes(32);
      try { made = await custody.keys.protect(vault.vaultId, bytes); await custody.files.writeKey(made); secret = bytes.toString('base64url'); }
      catch (error) { if (made) await custody.keys.forget(made).catch(() => {}); throw error instanceof ChausarError && error.code === 'DEVICE_KEY_FAILED' ? error : deviceKeyFailed(); }
      finally { bytes.fill(0); }
    }
    try { await this.safetyBackup(card.recovery !== 'made'); }
    catch (error) { if (made) { await custody.keys.forget(made).catch(() => {}); await custody.files.removeKey(made.vaultId).catch(() => {}); } throw error; }
    // The marker goes on the card before the rewrap; the key record stays until the change is settled either way.
    await custody.files.writeCard({ ...card, pending: 'to-this-computer' });
    let next: VaultCard;
    try {
      await vault.rewrapPassphrase(secret);
      next = { ...card, unlock: 'this-computer', pending: 'reseal', wrappersDigest: vault.wrappersDigest };
      await custody.files.writeCard(next);
    } catch (error) {
      // The typed passphrase was just checked, so it puts the vault back; then the new key record goes.
      await this.undoLockChange(card, payload.passphrase, made);
      throw error;
    }
    this.#openUnlock = 'this-computer';
    await this.resealManaged();
    await custody.files.writeCard({ ...next, pending: null });
    await vault.update(state => audit(state, 'custody.passphrase-off', {}));
    return { custody: await this.custodyView() };
  }
  private async makeRecoveryCode(payload: any) {
    const vault = this.store(), card = await this.currentCard();
    if (card.unlock === 'passphrase') check(typeof payload.passphrase === 'string' && await vault.verifyPassphrase(payload.passphrase), 'PASSPHRASE_WRONG', CUSTODY_WORDS.errors.PASSPHRASE_WRONG);
    const recoveryCode = await vault.rewrapRecovery();
    const next: VaultCard = { ...card, recovery: 'made', pending: 'reseal', wrappersDigest: vault.wrappersDigest };
    await this.custodyFiles().writeCard(next);
    await this.resealManaged();
    await this.custodyFiles().writeCard({ ...next, pending: null });
    await vault.update(state => audit(state, 'custody.recovery-made', {}));
    return { custody: await this.custodyView(), recoveryCode };
  }
  /**
   * One-shot C6 (section 9 idea 25): what a backup of the open business holds and what restoring it would take back.
   * The same checks as a restore; the backup's state is decoded in memory only and never written. The open business
   * only, so no business words ever sit outside its vault.
   */
  private async inspectManagedBackup(payload: any): Promise<BackupInspectView> {
    const vault = this.store(), files = this.custodyFiles(), workspaceId = vault.read().workspace.id;
    const parsed = typeof payload.file === 'string' ? parseBackupName(payload.file) : null;
    check(parsed, 'BACKUP_NOT_FOUND', CUSTODY_WORDS.errors.BACKUP_NOT_FOUND);
    check(parsed.workspaceId === workspaceId, 'BACKUP_OTHER_BUSINESS', CUSTODY_WORDS.errors.BACKUP_OTHER_BUSINESS);
    const header = await files.backupHeader(parsed.name);
    check(header, 'BACKUP_NOT_FOUND', CUSTODY_WORDS.errors.BACKUP_NOT_FOUND);
    check(header.vaultId === vault.vaultId, 'BACKUP_OTHER_BUSINESS', CUSTODY_WORDS.errors.BACKUP_OTHER_BUSINESS);
    const view = await this.backupView(parsed.name);
    const then = await vault.readBackupState(files.backupPath(parsed.name));
    const { backupCounts, backupDiff } = await import('./venture/views/backup-diff.ts');
    return { file: view.file, at: view.at, counts: backupCounts(then), since: backupDiff(vault.read(), then) };
  }
  private async restoreManagedBackup(payload: any) {
    check(payload.confirmed === true, 'CONFIRMATION_REQUIRED', 'Confirm the restore in the app.');
    const vault = this.store(), files = this.custodyFiles(), workspaceId = vault.read().workspace.id;
    const parsed = typeof payload.file === 'string' ? parseBackupName(payload.file) : null;
    check(parsed, 'BACKUP_NOT_FOUND', CUSTODY_WORDS.errors.BACKUP_NOT_FOUND);
    check(parsed.workspaceId === workspaceId, 'BACKUP_OTHER_BUSINESS', CUSTODY_WORDS.errors.BACKUP_OTHER_BUSINESS);
    const header = await files.backupHeader(parsed.name);
    check(header, 'BACKUP_NOT_FOUND', CUSTODY_WORDS.errors.BACKUP_NOT_FOUND);
    check(header.vaultId === vault.vaultId, 'BACKUP_OTHER_BUSINESS', CUSTODY_WORDS.errors.BACKUP_OTHER_BUSINESS);
    const restoredFrom = await this.backupView(parsed.name);
    // The safety copy is required here: the business's current state is about to be replaced.
    const safety = await this.writeBackup('safety');
    await vault.replaceFromBackup(files.backupPath(parsed.name));
    await this.attachSafely(vault);
    await vault.update(state => audit(state, 'backup.restored', { file: parsed.name, revision: header.revision }));
    return { workspace: this.store().read().workspace, restoredFrom, safety };
  }
  private async transferExport(payload: any) {
    // C4 task 38 (219.x1): the owner takes away the "Move file made" line; nothing else changes.
    if (payload && Object.hasOwn(payload, 'dismiss')) {
      check(payload.dismiss === true && Object.keys(payload).length === 1, 'INVALID_REQUEST', 'Send dismiss: true to take the line away.');
      await this.store().update(state => audit(state, 'custody.transfer-dismissed', {}));
      return { dismissed: true };
    }
    const vault = this.store(), card = this.custodyHost() && this.#openFolder ? await this.custodyFiles().readCard(this.#openFolder) : null;
    if ((card?.unlock ?? this.#openUnlock ?? 'passphrase') === 'passphrase')
      check(typeof payload.passphrase === 'string' && await vault.verifyPassphrase(payload.passphrase), 'PASSPHRASE_WRONG', CUSTODY_WORDS.errors.PASSPHRASE_WRONG);
    const transferCode = makeTransferCode(), madeAt = new Date(this.custodyNow()).toISOString();
    const text = await vault.transferText(transferCode, { recovery: (card ? card.recovery === 'made' : true) ? 'made' : 'not-made', madeAt });
    check(text.length <= TRANSFER.maxTextChars, 'TRANSFER_TOO_LARGE', CUSTODY_WORDS.errors.TRANSFER_TOO_LARGE);
    await vault.update(state => audit(state, 'custody.transfer-exported', {}));
    return { fileName: moveFileName(new Date(madeAt)), text, transferCode, bytes: Buffer.byteLength(text) };
  }
  /**
   * C4 task 38 (223.x1): the business name and the time a move file was made, read with its code before "Move it here".
   * Vault-less and quiet: the file's header is opened in memory only and nothing is written. A wrong code gets exactly
   * the refusal the import gives, so a peek never helps a guess.
   */
  private async transferPeek(payload: any) {
    check(payload && typeof payload === 'object' && Object.keys(payload).every(key => key === 'fileText' || key === 'transferCode'), 'INVALID_REQUEST', 'Send the move file and its code.');
    const text = payload.fileText;
    check(typeof text === 'string', 'TRANSFER_INVALID', CUSTODY_WORDS.errors.TRANSFER_INVALID);
    check(text.length <= TRANSFER.maxTextChars, 'TRANSFER_TOO_LARGE', CUSTODY_WORDS.errors.TRANSFER_TOO_LARGE);
    let parsed: any;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    const envelope = parsed?.envelope;
    check(parsed?.backupFormat === 'chausar.backup.v1' && envelope?.format === 'chausar.vault.v1' && typeof envelope.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(envelope.id)
      && [envelope.passphrase, envelope.recovery, envelope.snapshot].every(part => part && typeof part === 'object'), 'TRANSFER_INVALID', CUSTODY_WORDS.errors.TRANSFER_INVALID);
    const code = normalizeTransferCode(payload.transferCode);
    check(code, 'TRANSFER_CODE_WRONG', CUSTODY_WORDS.errors.TRANSFER_CODE_WRONG);
    const seen = await Vault.peekTransfer(text, code);
    check(seen, 'TRANSFER_CODE_WRONG', CUSTODY_WORDS.errors.TRANSFER_CODE_WRONG);
    return { name: seen.name, movedOutAt: seen.madeAt };
  }
  private async transferImport(payload: any) {
    check(!this.vault, 'VAULT_OPEN', 'Lock the current workspace first.');
    this.#draft?.clear();
    const text = payload.fileText;
    check(typeof text === 'string', 'TRANSFER_INVALID', CUSTODY_WORDS.errors.TRANSFER_INVALID);
    check(text.length <= TRANSFER.maxTextChars, 'TRANSFER_TOO_LARGE', CUSTODY_WORDS.errors.TRANSFER_TOO_LARGE);
    let parsed: any;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    const envelope = parsed?.envelope;
    check(parsed?.backupFormat === 'chausar.backup.v1' && envelope?.format === 'chausar.vault.v1' && typeof envelope.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(envelope.id)
      && Number.isSafeInteger(envelope.revision) && envelope.revision >= 0 && [envelope.passphrase, envelope.recovery, envelope.snapshot].every(part => part && typeof part === 'object'),
      'TRANSFER_INVALID', CUSTODY_WORDS.errors.TRANSFER_INVALID);
    const files = this.custodyFiles();
    check(!(await files.vaultIds()).has(envelope.id), 'TRANSFER_SAME_BUSINESS', CUSTODY_WORDS.errors.TRANSFER_SAME_BUSINESS);
    const code = normalizeTransferCode(payload.transferCode);
    check(code, 'TRANSFER_CODE_WRONG', CUSTODY_WORDS.errors.TRANSFER_CODE_WRONG);
    const custody = this.custodyHost(), computer = payload.passphrase === undefined || payload.passphrase === null;
    if (computer) {
      if (!custody) throw deviceKeysUnavailable('not-configured');
      const probe = await custody.keys.probe(); if (!probe.available) throw deviceKeysUnavailable(probe.reason);
    } else check(typeof payload.passphrase === 'string' && payload.passphrase.length >= 12 && payload.passphrase.length <= 1024, 'WEAK_PASSPHRASE', 'Use a passphrase of 12 to 1024 characters.');
    const folder = nextFolder(`moved-${randomBytes(3).toString('hex')}`, await files.takenFolders());
    const path = await files.transferFile(text);
    try {
      let vault: Vault;
      // Review of A1 (row 8): the step a failed move stopped at goes to the custody diagnostic log, with the error's code.
      const note = (step: string, error: unknown) => files.noteDiagnostic('transfer.import', step, error, new Date(this.custodyNow()).toISOString());
      try { vault = await Vault.restore({ directory: this.workspacePath(folder), backupFile: path, passphrase: code, storage: await this.adapter(folder) }); }
      catch (error) {
        if ((error as ChausarError).code === 'UNLOCK_FAILED') throw new ChausarError('TRANSFER_CODE_WRONG', CUSTODY_WORDS.errors.TRANSFER_CODE_WRONG);
        await note('restore', error); throw error;
      }
      let record: DeviceKeyRecord | null = null;
      const secret = computer ? randomBytes(32) : null;
      let step = 'protect';
      try {
        // One-shot A1 (row 8): a key this computer could not keep offers the passphrase instead (DEVICE_KEYS_UNAVAILABLE,
        // which the move screen answers with a passphrase), never "this computer's key didn't open your business".
        if (secret) {
          try { record = await custody!.keys.protect(vault.vaultId, secret); }
          catch (error) {
            const reason = (error as { reason?: unknown }).reason;
            throw deviceKeysUnavailable(typeof reason === 'string' && Object.hasOwn(CUSTODY_WORDS.unavailable, reason) ? reason as keyof typeof CUSTODY_WORDS.unavailable : 'failed');
          }
          step = 'write-key'; await files.writeKey(record);
          step = 'rewrap'; await vault.rewrapPassphrase(secret.toString('base64url'));
        }
        else { step = 'rewrap'; await vault.rewrapPassphrase(payload.passphrase); }
        // The card goes down before attaching, so if attaching fails the list still shows the right way in.
        step = 'write-card';
        const state = vault.read();
        await files.writeCard(newCard({ folder, vaultId: vault.vaultId, workspaceId: state.workspace.id, name: state.workspace.name, demo: state.workspace.demo,
          unlock: computer ? 'this-computer' : 'passphrase', recovery: transferHint(parsed), wrappersDigest: vault.wrappersDigest }));
      } catch (error) {
        await note(step, error);
        await files.removeCard(folder).catch(() => {});
        await vault.delete().catch(() => {});
        if (record) { await custody!.keys.forget(record).catch(() => {}); await files.removeKey(record.vaultId).catch(() => {}); }
        // Anything else that stopped the move (a file Chausar could not write) says so in plain words; nothing was kept.
        throw error instanceof ChausarError ? error : new ChausarError('TRANSFER_FAILED', CUSTODY_WORDS.errors.TRANSFER_FAILED);
      } finally { secret?.fill(0); }
      await this.attachSafely(vault);
    } finally { await files.removeTransfer(path).catch(() => {}); }
    await this.afterOpen(folder, computer ? 'this-computer' : 'typed', { recovery: transferHint(parsed) });
    return { workspace: this.store().read().workspace, folder, unlock: computer ? 'this-computer' : 'passphrase' };
  }
  /**
   * C5 task 21: workspace.import { file, passphrase?, recoveryCode?, restore? }. The desktop's main process asks it after its
   * own file pick, so no window ever names a path. The encrypted export is the backup format. A business not on this computer
   * opens as a new one with its passphrase or recovery code; one already here answers IMPORT_ALREADY_HERE, and with restore
   * goes through the restore path, opening it first when it is closed and making a safety copy first. A readable copy is
   * refused: nothing proves it wasn't changed.
   */
  private async importCopy(payload: any): Promise<CopyImportResult> {
    check(typeof payload.file === 'string' && isAbsolute(payload.file), 'INVALID_PATH', 'Choose the copy in the app.');
    const errors = CUSTODY_WORDS.errors;
    let parsed: any = null;
    try { parsed = JSON.parse(await readBoundedText(payload.file)); } catch { parsed = null; }
    if (parsed && parsed.backupFormat === undefined && parsed.workspace && Number.isSafeInteger(parsed.revision)) throw new ChausarError('IMPORT_READABLE', errors.IMPORT_READABLE);
    if (payload.file.toLowerCase().endsWith('.json') && parsed?.backupFormat === undefined) throw new ChausarError('IMPORT_READABLE', errors.IMPORT_READABLE);
    const envelope = parsed?.envelope;
    check(parsed?.backupFormat === 'chausar.backup.v1' && envelope?.format === 'chausar.vault.v1' && typeof envelope.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(envelope.id)
      && [envelope.passphrase, envelope.recovery, envelope.snapshot].every(part => part && typeof part === 'object'), 'IMPORT_INVALID', errors.IMPORT_INVALID);
    const files = this.custodyFiles(), id: string = envelope.id;
    if (this.vault) {
      this.requireAppOwner(this.context);
      check(this.vault.vaultId === id, 'IMPORT_CLOSE_FIRST', errors.IMPORT_CLOSE_FIRST);
      check(payload.restore === true, 'IMPORT_ALREADY_HERE', errors.IMPORT_ALREADY_HERE);
      return this.custodySerial(() => this.restoreFromCopy(payload.file));
    }
    this.#draft?.clear();
    if ((await files.vaultIds()).has(id)) {
      check(payload.restore === true, 'IMPORT_ALREADY_HERE', errors.IMPORT_ALREADY_HERE);
      const card = (await files.listCards()).find(item => item.vaultId === id && item.state === 'ready');
      await this.handleRequest('workspace.open', { folder: card?.folder ?? 'main', ...(typeof payload.passphrase === 'string' ? { passphrase: payload.passphrase } : {}) });
      return this.custodySerial(() => this.restoreFromCopy(payload.file));
    }
    const recoveryCode = typeof payload.recoveryCode === 'string' && payload.recoveryCode ? payload.recoveryCode : undefined;
    const typed = typeof payload.passphrase === 'string' && payload.passphrase ? payload.passphrase as string : undefined;
    check(recoveryCode !== undefined || typed !== undefined, 'PASSPHRASE_REQUIRED', errors.IMPORT_NEEDS_SECRET);
    const custody = this.custodyHost();
    const folder = nextFolder(`copy-${randomBytes(3).toString('hex')}`, await files.takenFolders());
    this.workspacePath(folder);
    let how: 'this-computer' | 'typed' = 'typed', fresh: Buffer | null = null, credentials: { passphrase: string } | { recoveryCode: string; newPassphrase: string };
    if (recoveryCode !== undefined && typed !== undefined) credentials = { recoveryCode, newPassphrase: typed };
    else if (recoveryCode !== undefined) {
      if (!custody) throw deviceKeysUnavailable('not-configured');
      const probe = await custody.keys.probe(); if (!probe.available) throw deviceKeysUnavailable(probe.reason);
      fresh = randomBytes(32); how = 'this-computer';
      credentials = { recoveryCode, newPassphrase: fresh.toString('base64url') };
    } else credentials = { passphrase: typed! };
    try {
      const vault = await Vault.restore({ directory: this.workspacePath(folder), backupFile: payload.file, ...credentials, storage: await this.adapter(folder) });
      if (fresh) await this.storeComputerSecret(vault, fresh);
      await this.attachSafely(vault);
    } catch (error) {
      await this.removeEmptyFolder(this.workspacePath(folder));
      throw error;
    } finally { fresh?.fill(0); }
    await this.afterOpen(folder, how, { recovery: recoveryCode !== undefined ? 'made' : 'unknown', reseal: recoveryCode !== undefined });
    return { workspace: this.store().read().workspace, folder, unlock: how === 'typed' ? 'passphrase' : 'this-computer' };
  }
  /** The open business from an exported copy of itself, with a safety copy first, as a backup's restore does. */
  private async restoreFromCopy(file: string): Promise<CopyImportResult> {
    const vault = this.store();
    await this.writeBackup('safety');
    await vault.replaceFromBackup(file);
    await this.attachSafely(vault);
    await vault.update(state => audit(state, 'backup.restored', { file: 'exported-copy', revision: vault.read().revision }));
    return { workspace: this.store().read().workspace, folder: this.#openFolder ?? '', unlock: this.#openUnlock ?? 'passphrase', restored: true };
  }
  /** One-shot A4: removes a deleted business's folder when it holds nothing (never recursive); else leaves it. Never throws. */
  private async removeEmptyFolder(path: string) {
    try { await rmdir(path); } catch { /* not empty, or already gone */ }
  }
  private async forgetBusiness(folder: string | null, vaultId: string) {
    const custody = this.custodyHost(); if (!custody || !folder) return;
    await custody.files.removeCard(folder);
    await this.snapshotStore()?.remove(folder); // its summary goes with it (4J6)
    if (!(await custody.files.listCards()).some(card => card.vaultId === vaultId)) {
      const record = await custody.files.readKey(vaultId);
      if (record) { await custody.keys.forget(record).catch(() => {}); await custody.files.removeKey(vaultId); }
    }
  }
  private requireWorkspaceOwner(ctx: Context) { const member = authorize(this.store(), ctx, 'admin'); check(member.role === 'owner' && member.branches.includes('*'), 'FORBIDDEN', 'Only the business\'s owner can copy or delete the whole business.'); }
  /** C5 task 31: one for the engine's life, so its ten quiet minutes count from the start. */
  #updates: UpdateService | null = null;
  private updateService(): UpdateService {
    return this.#updates ??= new UpdateService({ publicKey: this.options.updatePublicKey ?? null, feedUrl: null, directory: resolve(this.options.directory, 'updates'), channel: 'stable', windowsPublisher: null, ...this.options.updates, version: this.version, isBusy: () => this.updatesBusy() });
  }
  /**
   * C5 task 32, trusted main-process route only, at quit: is a run busy, the open data's version, and the safety copy of the
   * open business while its vault is still open (D12 attach points 1 and 2). A failed copy is said; main then installs nothing.
   */
  async prepareUpdateInstall(payload: { backup?: unknown }): Promise<{ busy: boolean; openDataSchema: number | null; backup: 'made' | 'failed' | 'none-open' | 'skipped' }> {
    const busy = this.updatesBusy(), open = this.vault ? this.vault.read().schemaVersion : null;
    if (busy || payload?.backup !== true) return { busy, openDataSchema: open, backup: 'skipped' };
    if (!this.vault) return { busy, openDataSchema: open, backup: 'none-open' };
    return { busy, openDataSchema: open, backup: await this.custodySerial(() => this.safetyBackup()) ? 'made' : 'failed' };
  }
  /** A run is busy: a request is being answered, or an owner's-AI job has a tool running. */
  private updatesBusy(): boolean {
    if (this.#activeRequests > 0 || this.#transition) return true;
    const state = this.vault?.read();
    if (!state) return false;
    return (state.conversations as { kind?: string; agentJob?: { tools?: { status: string }[] } }[]).some(record => record?.kind === 'venture-delivery-run' && record.agentJob?.tools?.some(tool => tool.status === 'running'));
  }
  async tick(): Promise<void> {
    if (!this.#closing) void this.updateService().tick().catch(() => {});
    // Automatic backups, the journal sweep, the notification centre's look at Today and the business summary.
    await this.backupTick();
    await this.journalTick();
    await this.notifyTick();
    await this.snapshotTick();
  }
}
