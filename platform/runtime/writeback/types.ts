/**
 * The writeback adapter contract. Every external write in the catalogue is one `ActionAdapter`:
 * it validates its exact business payload, reads the system to prepare a preview and its
 * postconditions, acts once under a stable effect key, and reads the system back independently.
 *
 * Adapters reach a system only through the injected `ports`: an HTTP transport, a line-socket
 * dialer (mail) and a credential broker. Production installs the real ports; tests, demo mode
 * and Practice install the stateful fakes from `platform/fakes/`.
 */
import type { Context } from '../contracts.ts';

export type WireMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type WireRequest = { method: WireMethod; url: string; headers: Record<string, string>; body?: string };
export type WireResponse = { status: number; headers: Record<string, string>; body: string };
/** One bounded request: no redirects, no retries. A thrown error means the outcome is unknown. */
export type Transport = (request: WireRequest) => Promise<WireResponse>;

/** A line-oriented socket for SMTP and IMAP. `upgrade` performs STARTTLS on the same connection. */
export interface LineSocket {
  readLine(): Promise<string>;
  write(data: string): Promise<void>;
  upgrade(): Promise<void>;
  close(): void;
}
export type MailEndpoint = { host: string; port: number; security: 'implicit-tls' | 'starttls' };
export type Dialer = (endpoint: MailEndpoint) => Promise<LineSocket>;

export const SYSTEMS = ['tally', 'zoho-books', 'razorpay', 'shopify', 'google-workspace', 'whatsapp', 'mail', 'gst-portal'] as const;
export type SystemId = typeof SYSTEMS[number];

/** Credential material by field name (accessToken, username, password, apiKey, …). Never stored in the vault. */
export type Secret = Readonly<Record<string, string>>;
/** `sourceId` names the sealed credential: a linked read connection's source, or this write connection's own. */
export type CredentialScope = { system: SystemId; connectionId: string; account: Readonly<Record<string, string>>; environment: Environment; sourceId: string; group: string };
export type WriteCredentials = (context: Context, scope: CredentialScope) => Promise<Secret>;

export type Environment = 'live' | 'sandbox' | 'practice';
/** A person-registered target account. `account` holds identifiers only (org id, shop, sheet id, sender address), never secrets. */
export type Connection = {
  id: string; system: SystemId; label: string; environment: Environment;
  account: Record<string, string>;
  /** Read and write are separate grants; write is per catalogue action. */
  read: boolean; write: string[];
  /** The connectors-ext read connection whose credential this write connection shares. Its read grant never grants writing here. */
  link: { connectionId: string; sourceId: string; group: string } | null;
  createdAt: string; createdBy: string; revokedAt: string | null;
};

/** Plain JSON business data. Money is always whole paise as a string. */
export type WireValue = null | boolean | string | number | WireValue[] | { [field: string]: WireValue };
export type WireObject = { [field: string]: WireValue };

export type Preview = { asWritten: string } | { fields: { name: string; before: string; after: string }[] };
export type Preparation = {
  /** What the system holds now for the target, or null when the target does not exist yet. */
  before: WireObject | null;
  /** The exact command that will be sent. */
  command: WireObject;
  /** Fields the read-back must observe for the action to count as applied. */
  postconditions: WireObject;
  preview: Preview;
  target: { label: string; ref: string | null };
  /** The system's own version of the target when it offers one (updated_at, etag, quantity). */
  sourceVersion: string | null;
  /** The effect is already present in the system under this key: nothing will be sent. */
  alreadyApplied: { externalId: string | null } | null;
};
export type DoReceipt = { outcome: 'accepted' | 'provider-claims-applied' | 'rejected'; externalId: string | null; data: WireObject | null };
export type Observation =
  | { outcome: 'confirmed-applied'; observed: WireObject; externalId: string | null; businessSuccess: boolean }
  | { outcome: 'confirmed-not-applied'; reason: string }
  | { outcome: 'inconclusive' | 'conflicting'; reason: string };

export type AdapterContext = {
  connection: Connection;
  http: Transport;
  dial: Dialer;
  credentials(): Promise<Secret>;
  clock(): string;
};

export interface ActionAdapter<P extends WireObject = WireObject> {
  /** Strict data validation. Unknown fields and ambiguous meanings are refused. Never calculates. */
  validate(payload: unknown): P;
  /** Read-only: observe the target, build the exact command, preview and postconditions. */
  prepare(ctx: AdapterContext, payload: P, key: string): Promise<Preparation>;
  /** Act once. The effect key is embedded through the entry's idempotency method. */
  do(ctx: AdapterContext, payload: P, preparation: Preparation, key: string): Promise<DoReceipt>;
  /** Independent read of the system. An empty or lagging lookup is `inconclusive`, never `not-applied`. */
  readBack(ctx: AdapterContext, payload: P, preparation: Preparation, key: string, receipt: DoReceipt | null): Promise<Observation>;
}
export type SystemAdapters = Readonly<Record<string, ActionAdapter<any>>>;

/** A stateful fake system: it serves the system's own wire protocol from memory. */
export interface FakeSystem {
  readonly system: SystemId;
  /** HTTP systems serve requests here. */
  readonly transport?: Transport;
  /** Mail systems serve SMTP and IMAP sessions here. */
  readonly dial?: Dialer;
  /** Fault injection for the next matching write: lose the reply after committing, or fail before. */
  fault(kind: 'drop-after-commit' | 'fail-before-commit' | 'none'): void;
  /** Make the target of a prepared action exist, from its recorded before-state. */
  prime(payload: WireObject, before: WireObject | null): void;
  /** Plain JSON snapshot of the fake's records, for Practice diffs and tests. */
  snapshot(): WireObject;
  /** Every request served, credentials removed. */
  readonly log: { method: string; target: string; body: string | null }[];
}
