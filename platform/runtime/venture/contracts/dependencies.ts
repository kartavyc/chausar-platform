// Venture dependencies contract. Types only; public imports use ../contracts.ts.
import type { Context, StateStore } from '../../contracts.ts';
import type { DraftHandoverPort } from '../onboarding-contracts.ts';
import type { NetResolver, PinnedSender } from '../core/net-guard.ts';
import type { TlsConnector } from '../network/imap.ts';
import type { FfmpegPort } from '../playbooks/youtube/finishing.ts';
import type { PrintPort } from '../playbooks/kit/records-report.ts';
import type { FormsBrowserPort } from '../playbooks/data-entry-desk/browser-types.ts';
import type { LocalAppPort, WebhookKind } from '../build/records-connect.ts';
import type { ModelPort, ModelPresetId, ModelTransport } from './models.ts';
import type { IsoTime } from './business.ts';
import type { ConnectorPorts, GitHubTransport } from './build.ts';
import type { DelegatePorts, SandboxPorts } from './delivery.ts';
import type { VentureWorkspacePort } from './views.ts';
import type { VentureEventRecord, VentureRunEvent } from './queue.ts';
import type { WebPushPort } from './records.ts';
import type { VentureMethod, VentureResults } from './methods.ts';

// ---------------------------------------------------------------------------
// 12. Handler tables and dependencies (implemented by packages, wired by P0 and P6)
// ---------------------------------------------------------------------------

/**
 * network:forget: the key of the forgotten list's one-way check (4D1), derived from the vault's own key when it opens.
 * mailbox:password: the owner's mailbox app password (4E3); network:calendar: their private calendar address (4E3).
 * Both are held only while the app is open, as the model keys are, and never in a record, an export or a log.
 * receipt:signing: the seed of the business's receipt signing key (4J10), derived from the vault's own key when it opens.
 * journal:head: the key of the HMAC on the journal's pinned head and the first signing time (4J10), derived the same way.
 */
export type SecretName = `model:${ModelPresetId}` | `github:${string}` | 'network:forget' | 'mailbox:password' | 'network:calendar' | 'receipt:signing' | 'journal:head'
  // 5A6: the owner's n8n or Make webhook address (it is a key in itself), and a speech provider's key, held the same way.
  | `webhook:${WebhookKind}` | `webhook-signing:${WebhookKind}` | `speech:${string}` | `seo:${string}` | `books:${string}` | `site:${string}` | `open-post:${string}` | `youtube:${string}` | `shopify:${string}` | `storefront:${string}`;

/** Memory-only secrets. Never written to state, logs, payloads or the renderer. Cleared on lock. */
export interface SecretShelf {
  get(name: SecretName): string | null;
  set(name: SecretName, value: string): void;
  delete(name: SecretName): void;
  has(name: SecretName): boolean;
  clear(): void;
}

/** The narrow slices of existing engine services the venture packages may call. */
export type VentureEngineServices = {
  calculator: { calculate(ctx: Context, request: Record<string, unknown>): Promise<any>; receipt(ctx: Context, id: string): any };
  ontology: { current(ctx: Context): any; publish(ctx: Context, draft: any): Promise<any> };
  trust: { updatePolicy(ctx: Context, patch: Record<string, unknown>): Promise<any> };
  /** The trusted Python helper (platform/runtime/helper.ts). Delivery agents use only its PDF text extraction, never on the hosted web server. */
  helper?: { run(operation: 'pdf.extract', input: { pdfBase64: string; maxPages?: number }): Promise<{ result: any; receipt: any }> };
  /**
   * The speech service (platform/runtime/speech.ts): a transcript made on this computer by the owner's own whisper.cpp,
   * set up with full paths. It never installs, downloads a model or uploads. YouTube orders use it (Ink v2 wave 2, 2E2).
   */
  speech?: {
    localTranscriber(): { ready: true; providerId: string } | { ready: false; reason: string };
    /** 5B1 trusted host only: the selected local files for provenance hashing. No RPC exposes this. */
    localTranscriptionFiles?(ctx: Context): { providerId: string; command: string; model: string } | null;
    transcribeFile(ctx: Context, input: { path: string; prompt?: string; timeoutMs?: number; signal?: AbortSignal }): Promise<{ srt: string; providerId: string }>;
    /** Puts in place (or removes, with null) the whisper.cpp the owner set up in the app (venture.transcription.set). */
    useLocal(setup: { command: string; model: string } | null): void;
  };
};

export type VentureStorage = 'experimental-file' | 'postgres';

/** Where the engine runs: the desktop window, local web mode, the experimental hosted web server, or a test. */
export type VentureHostKind = 'desktop' | 'local-web' | 'hosted-web' | 'test';

/**
 * W6 6F7: the host's phone listener (platform/runtime/phone-access.ts). status().addresses: where this computer can be
 * reached on its home network or Tailscale, whether or not the listener runs. link(): starts it when needed and makes a
 * one-time pairing link. stop(): closes it and ends every phone session. Trusted host composition only.
 */
export interface PhoneAccessPort {
  status(): { on: boolean; addresses: { via: 'wifi' | 'tailscale'; address: string }[]; phones: number };
  link(input: { via: 'wifi' | 'tailscale'; hours: number; minutes: number }): Promise<{ link: string; expiresAt: IsoTime }>;
  stop(): Promise<void>;
}

export type VentureDeps = {
  /** One-shot C3 task 9: says which step long work is on (work-progress.ts). Absent in tests that pass none. */
  work?: VentureWork;
  /** Private OS-protected model keys, scoped to the unlocked workspace. Never exposed to the renderer. */
  /** C7: stand-ins for the event relay and the source checks in tests; the host passes none, so the real guard is used. */
  eventPorts?: import('../build/event-triggers.ts').EventPorts;
  credentials?: import('../models/credential-port.ts').HostCredentialPort;
  /** W6 6F7: the host's phone listener; absent on the hosted app and in tests that do not inject one. */
  phoneAccess?: PhoneAccessPort;
  /** A4 fix round: the newest AI setup on this computer (models/ai-setup.ts); absent on the hosted app. */
  aiSetup?: import('../models/ai-setup.ts').AiSetupPort;
  /** Trusted test or desktop composition. Never accepted from an engine request. */
  agentRoute?: (ctx: Context, agentId: string) => Promise<import('../agent-runtime/route-types.ts').AgentRoute>;
  store: StateStore;
  clock: () => Date;
  models: ModelPort;
  services: VentureEngineServices;
  github: GitHubTransport;
  secrets: SecretShelf;
  host: VentureHostKind;
  demo: boolean;
  storage: VentureStorage; // 'experimental-file' means every money screen shows the experimental notice
  /** The container tier's Docker port. Absent means the real one, which spawns docker only when Docker is present, and never on the hosted web server. */
  sandbox?: SandboxPorts;
  /** Heavy work's port. Absent means the real one on the desktop and in local web mode, and none anywhere else. */
  delegate?: DelegatePorts;
  /** The engine's draft desk, so venture.create can adopt the AI and plan made before the vault. Absent on hosted. */
  draft?: DraftHandoverPort;
  /** Claude Code is enabled by default. Explicit 'pending' disables it. */
  claudeCodeTerms?: 'accepted' | 'pending';
  /** Posting ports. Absent means the real ones: a Playwright probe that installs nothing, and no API clients. */
  connectors?: ConnectorPorts;
  /** The businesses on this computer, for Today's queue across businesses. Trusted host composition; absent in most tests. */
  workspace?: VentureWorkspacePort;
  /** The website folder on this computer that staged edits apply to. Trusted host composition, never a payload; never on hosted. */
  siteFolder?: string;
  /** The mail server lookup for lead emails. Absent means node:dns; tests inject a table. */
  mx?: (domain: string) => Promise<{ exchange: string; priority: number }[]>;
  /** The ffmpeg that takes the sound out of a cut for a transcript made here. Absent means the one on PATH; never on hosted. */
  ffmpeg?: FfmpegPort;
  /** Desktop-only emulator command port. Tests inject it; production uses installed Android SDK tools. */
  android?: import('../build/android.ts').AndroidCommandPort;
  sandboxDesktop?: import('../build/sandbox-desktop.ts').DesktopCommandPort;
  /** Trusted website checker port; absent uses owner-installed lintapple, null means unavailable. Never a request payload. */
  seoWebsiteChecker?: { run(url: string, signal?: AbortSignal): Promise<unknown> } | null;
  /** Trusted host composition: the engine stops long local work through it when the workspace closes (VentureClosingPort). */
  closing?: VentureClosingPort;
  /** The network guard's lookup and sender for requests the engine makes itself (bank alert counts). Absent means the real ones; tests inject stubs. */
  net?: { resolve?: NetResolver; send?: PinnedSender; tls?: TlsConnector };
  /** A2: the real desktop and local hosts read the AI providers' status pages after a failure (models/provider-status.ts). */
  statusPages?: boolean;
  /** Wave 6 (6D3): the HTTPS port payment providers are asked through. Tests pass recorded responses; absent: fetch. */
  paymentHttp?: import('../money/billing-types.ts').PaymentHttp;
  /** Called once with the events a venture action committed, after the commit. A listener's failure never undoes it. */
  publish?: (events: VentureEventRecord[]) => void;
  /**
   * The hosted web server's public origin (CHAUSAR_PUBLIC_URL, equal to the hosted origin), for client share links.
   * Trusted host composition, never a payload; only on the hosted web server. Absent: share links get no address.
   */
  publicUrl?: string;
  /**
   * Ink v2 wave 4 (4G1): when the owner last had Chausar open (the desktop window, or an owner's event stream); now
   * while one is. Alerts outside the app wait while the owner watches and for 2 minutes after. Absent or null: unknown.
   */
  watching?: () => IsoTime | null;
  /** Ink v2 wave 4 (4G3): the hosted app's web push key. Only on the hosted web server; absent, phone alerts say so. */
  push?: WebPushPort;
  /**
   * Ink v2 wave 4 (4G3): the owner's own context inside the app (the engine's base context, as its tick uses), for work
   * that runs under the owner's standing setting whoever's request started it: a phone alert. Trusted host composition.
   */
  ownerContext?: () => Context;
  /**
   * Ink v2 wave 4 (4G3): hashes of hosted sessions the account lists as signed out or revoked, whose browsers' records
   * may not be deleted yet; such a browser gets nothing. Trusted host composition, hosted only.
   */
  endedSessions?: () => readonly string[];
  /**
   * Ink v2 wave 4 (4D3): a public web search, for a network search's "Also look outside my network" and "Before you
   * write". Trusted host composition; no host composes one yet, so both say plainly that web search is not set up here.
   */
  webSearch?: WebSearchPort;
  /**
   * Ink v2 wave 4 (4J23): whether this business is temporary, started on the hosted app without an account and not yet
   * claimed. Asked at each write of a refused record: while true, ventureAction refuses an issued invoice, a payment,
   * an issued credit note, a paid bill, a client share link, a file request and an alert address (TRIAL_LIMIT). The
   * trial's size cap is held by the hosted vault store itself. Only on the hosted web server; absent: never temporary.
   */
  trial?: () => boolean;
  /** Ink v2 wave 5 (5A5): the desktop's printer for a report's PDF (Electron's printToPDF). Never on hosted; absent: no PDF. */
  print?: PrintPort;
  /** Desktop-only trusted owner-browser port. Never supplied by a renderer or model. */
  formsBrowser?: FormsBrowserPort;
  /** Wave 6 (6F3): the desktop's hidden window for reading a page that needs JavaScript (web/render-port.ts). Desktop only. */
  webRender?: import('../web/reader.ts').PageRenderPort;
  /** Wave 6 (6H2, D41): the desktop's browser window for recorded flows (flows/port.ts). Desktop only. */
  flowBrowser?: import('../flows/replay.ts').FlowBrowserPort;
  /** 5A6 (K13): the owner's own programs on PATH (build/local-apps.ts). Absent means the real one; never on hosted. */
  localApps?: LocalAppPort;
  /** Wave 6 (6J2, D47): the report services' keys and the app's version, from the build's environment (host-env.ts). Never a payload. */
  feedback?: import('../core/feedback.ts').FeedbackPort;
};

/**
 * 4D3. A public web search the host may give the engine: for one query, up to limit public pages, each with its
 * address, title and the search's own snippet. Chausar opens no page through it; "Before you write" reads a page only
 * through the network guard, and never a LinkedIn or other personal profile page. A host that composes one must first
 * show the owner a consent that names the search provider and what is sent to it (the owner's own words for a search;
 * a person's name and company for "Before you write"), and compose the port only once the owner agrees.
 */
export type WebSearchPort = { search(query: string, options: { limit: number }): Promise<{ url: string; title: string; snippet: string }[]> };

export type VentureHandler<M extends VentureMethod> = (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<VentureResults[M]>;

export type VentureHandlerTable = { [M in VentureMethod]?: VentureHandler<M> };

/** What P6's host passes to P2's createModelPort. */
export type ModelPortOptions = {
  store: StateStore;
  clock: () => Date;
  transport: ModelTransport;
  secrets: SecretShelf;
  host: VentureHostKind;
  demo: boolean;
  codexCli?: unknown; // { capabilities, mode } from the trusted Codex host profile, when present
  /** The Claude Code gate; absent is 'accepted', explicit 'pending' disables it. */
  claudeCodeTerms?: 'accepted' | 'pending';
  /** 4H1: finds a command on this computer's search path (an absolute one where it says). Absent means the real search; tests inject one. */
  locateCli?: (command: string) => string | null;
};

/** Options the engine passes to the venture host. host-env.ts fills the plain fields; tests inject transports. */
/** A handler's way to WorkProgress, bound to its business. */
export type VentureWork = { begin(kind: import('../views/work-steps.ts').WorkKind, stepIds: readonly string[]): import('../../work-progress.ts').Work };

export type VentureHostOptions = {
  /** One-shot C3 task 9: the engine's WorkProgress, never supplied by an engine request. */
  work?: VentureWork;
  /** Trusted host composition for a tool driver, never supplied by an engine request. */
  agentRoute?: VentureDeps['agentRoute'];
  credentials?: import('../models/credential-port.ts').HostCredentialPort;
  /** W6 6F7: the host's phone listener, never supplied by an engine request. */
  phoneAccess?: PhoneAccessPort;
  /** A4 fix round: where the newest AI setup on this computer is kept, never supplied by an engine request. */
  aiSetup?: import('../models/ai-setup.ts').AiSetupPort;
  modelTransport?: ModelTransport;
  /** A transport, or a factory the host calls once with its store (fixtures use it to fill {{briefId}}). */
  githubTransport?: GitHubTransport | ((store: StateStore) => GitHubTransport);
  /** Replay files; host-env.ts sets them only in demo mode with CHAUSAR_VENTURE_REPLAY=1 or --replay. host.ts reads them lazily. */
  modelReplayPath?: string;
  githubReplayPath?: string;
  clock?: () => Date;
  host?: VentureHostKind;
  codexCli?: unknown; // { capabilities, mode } from the trusted Codex host profile, when present
  hostProcess?: (request: any) => Promise<any>; // the trusted host's verified process port (the gateway's process), when present
  sandbox?: SandboxPorts; // tests inject a Docker port; the real one is used otherwise
  delegate?: DelegatePorts; // tests inject a port to a fake command-line tool
  /** Trusted host composition, never from a payload: the engine's draft desk handover. */
  draft?: DraftHandoverPort;
  /** From CHAUSAR_CLAUDE_CODE_TERMS. Absent defaults to accepted; pending disables Claude Code. */
  claudeCodeTerms?: 'accepted' | 'pending';
  /** Trusted host composition, never from a payload: the businesses on this computer (VentureWorkspacePort). */
  workspace?: VentureWorkspacePort;
  /** From CHAUSAR_SITE_FOLDER on this computer (an absolute path): the website folder staged edits apply to. */
  siteFolder?: string;
  /** Trusted host composition: receives the run events each venture action committed, for the desktop push and /api/events. */
  notify?: (events: VentureRunEvent[]) => void;
  /** Trusted host composition (4G1): when the owner last had Chausar open, now while they do (VentureDeps.watching). */
  watching?: () => IsoTime | null;
  /** Trusted host composition (4G3): the hosted app's web push key. Used only when host is 'hosted-web'. */
  push?: WebPushPort;
  /** Trusted host composition (4G3): the owner's own context inside the app (VentureDeps.ownerContext). */
  ownerContext?: () => Context;
  /** Trusted host composition (4G3): hashes of sessions the account lists as ended (VentureDeps.endedSessions). Hosted only. */
  endedSessions?: () => readonly string[];
  /** The network guard's lookup and sender (VentureDeps.net); tests inject stubs, the real ones are used otherwise. */
  net?: VentureDeps['net'];
  /** A2: read the AI providers' status pages after a failure (VentureDeps.statusPages); never on the hosted web server. */
  statusPages?: boolean;
  /** The hosted web server's public origin for client share links (CHAUSAR_PUBLIC_URL). Used only when host is 'hosted-web'. */
  publicUrl?: string;
  /** Trusted host composition: the ffmpeg port for a transcript made here (tests inject a stand-in); never on hosted. */
  ffmpeg?: FfmpegPort;
  /** Trusted host composition from the engine: how a workspace closing stops long local work (VentureClosingPort). */
  closing?: VentureClosingPort;
  /** Trusted host composition (4J23): whether this hosted business is temporary (VentureDeps.trial). Hosted only. */
  trial?: () => boolean;
  /** Trusted host composition (5A5): the desktop's report printer over the worker's channel (VentureDeps.print). Never on hosted. */
  print?: PrintPort;
  /** Desktop host composition for exact approved native HTML form requests. */
  formsBrowser?: FormsBrowserPort;
  /** Wave 6 (6F3): the desktop's hidden window for reading a page that needs JavaScript (web/render-port.ts). Desktop only. */
  webRender?: import('../web/reader.ts').PageRenderPort;
  /** Wave 6 (6H2, D41): the desktop's browser window for recorded flows (flows/port.ts). Desktop only. */
  flowBrowser?: import('../flows/replay.ts').FlowBrowserPort;
  /** Wave 6 (6J2): the report services' keys and the app version, from host-env.ts (VentureDeps.feedback). Never a payload. */
  feedback?: import('../core/feedback.ts').FeedbackPort;
};

/**
 * How the engine stops long local work (a transcript being made) when the workspace locks, closes, switches or the
 * app quits. signal is aborted then; hold() says such work is running and returns its release, so the engine stops it
 * and waits (capped) instead of answering VAULT_BUSY.
 */
export type VentureClosingPort = { readonly signal: AbortSignal; hold(): () => void };
