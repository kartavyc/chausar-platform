/**
 * EXPERIMENTAL: Google Drive as the destination of the existing encrypted one-writer sync (sync.ts), end to end.
 *
 * `hosted.drive.connect` creates the dedicated app folder and its head file, or adopts a folder this app created
 * earlier (`drive.file` sees nothing else), records the two ids in the module's vault namespace with an audit line, and
 * attaches a GoogleDriveSyncTransport to the core SyncService. The ids live in the vault, so the transport is attached
 * again lazily after the vault opens: in `hosted.drive.status`, in the module tick and before this module's own Drive calls.
 *
 * Access tokens come only through a broker on every Drive call: by default the connectors-ext Google sign-in (the sealed
 * credential store in `<appdir>/connector-credentials`, a `google-workspace` connection signed in with `drive.file`),
 * or a host-supplied `accessToken` function. Nothing here stores a token, in the vault or anywhere else.
 *
 * Publication itself stays the core's: `sync.enable`, `sync.preview`, `sync.approve`, `sync.push` and `sync.pull`, under
 * the Engine's reviewed device writer admission. An installed app without configured sync options can connect and attach,
 * and `sync.enable` still refuses there until the host supplies a device identity and writer admission.
 */
import { join } from 'node:path';
import { audit, check, ChausarError } from '../contracts.ts';
import type { Context } from '../contracts.ts';
import { moduleState, peekModuleState } from '../modules/types.ts';
import type { ModuleHost } from '../modules/types.ts';
import { ConnectorCredentialStore, hostCredentialServices, loadOAuthClients } from '../connectors-ext/credentials.ts';
import type { CredentialRequest } from '../adapters/read-kit.ts';
import type { SyncService, SyncTransport } from '../sync.ts';
import { createDriveSyncFolder, DRIVE_FILES, DRIVE_SCOPE, GoogleDriveSyncTransport, HEAD_FILE_NAME } from './drive-transport.ts';
import type { Fetch, FetchReply } from './client.ts';
import { MODULE_ID, initialHostedLinkState } from './service.ts';
import type { HostedLinkState } from './service.ts';

/** Trusted host options under `options.drive`. */
export type DriveSyncOptions = {
  fetch?: Fetch;
  /** The sealed store connectors-ext's Google sign-in writes; read here only for the granted scopes. */
  credentialStore?: Pick<ConnectorCredentialStore, 'get'>;
  credentialBroker?: (ctx: Context, request: CredentialRequest) => Promise<string>;
  /** Alternative broker: returns a current `drive.file` access token. Never stored. */
  accessToken?: (ctx: Context) => string | Promise<string>;
  clock?: () => Date;
};
type DriveRecord = NonNullable<HostedLinkState['drive']> & { connectedAt: string; workspaceId: string; vaultId: string; connectionId: string | null; created: boolean };
type GoogleConnection = { id: string; group: string; sourceId: string; status: string };

const FILE_ID = /^[A-Za-z0-9_-]{8,200}$/;
const GOOGLE_ORIGIN = 'https://www.googleapis.com';
const textId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\x00-\x1f\x7f]/.test(value);
const attachedHere = new WeakSet<SyncTransport>();

/**
 * Start-up options for the installed app: a broker over the same sealed credential store and sign-in apps that
 * connectors-ext builds, so a Google sign-in made there with the `drive.file` scope can reach the sync folder. Demo: nothing.
 */
export function driveHostOptions(input: { readonly directory: string; readonly demo: boolean; readonly env: Readonly<Record<string, string | undefined>> }): Record<string, unknown> {
  if (input.demo) return {};
  const credentialStore = new ConnectorCredentialStore(join(input.directory, 'connector-credentials'));
  const clients = loadOAuthClients(input.env.CHAUSAR_OAUTH_CLIENTS_FILE ?? join(input.directory, 'oauth-clients.json'));
  return { drive: Object.freeze({ credentialStore, credentialBroker: hostCredentialServices(credentialStore, { clients }).credentialBroker }) };
}

const options = (host: ModuleHost): DriveSyncOptions => (host.options.drive ?? {}) as DriveSyncOptions;
const fetcher = (o: DriveSyncOptions): Fetch => typeof o.fetch === 'function' ? o.fetch : (url, init) => fetch(url, init as RequestInit);
const shape = (payload: Record<string, any>, allowed: readonly string[]) =>
  check(payload && typeof payload === 'object' && !Array.isArray(payload) && Object.keys(payload).every(k => allowed.includes(k)), 'INVALID_REQUEST', 'The request has missing or unexpected fields.');
const desktopOnly = (ctx: Context) => check(ctx.channel === undefined || ctx.channel === 'desktop', 'OPEN_DESKTOP', 'Open the desktop app for this request.');

function record(host: ModuleHost): DriveRecord | null {
  const drive = peekModuleState<HostedLinkState>(host.store.read(), MODULE_ID)?.drive as Partial<DriveRecord> | null | undefined;
  if (!drive || !FILE_ID.test(drive.folderId ?? '') || !FILE_ID.test(drive.headFileId ?? '') || !textId(drive.workspaceId) || !textId(drive.vaultId)) return null;
  return structuredClone(drive) as DriveRecord;
}
function identity(host: ModuleHost) {
  const workspaceId = host.store.read().workspace?.id, vaultId = (host.store as { vaultId?: unknown }).vaultId;
  check(textId(workspaceId) && textId(vaultId), 'SYNC_WORKSPACE_MISMATCH', 'Open the workspace that owns this sync folder.');
  return { workspaceId, vaultId };
}
function syncService(host: ModuleHost): SyncService | null {
  const sync = host.services.sync as SyncService | undefined;
  return sync && typeof sync.attachTransport === 'function' ? sync : null;
}

function hasDriveScope(o: DriveSyncOptions, sourceId: string): boolean {
  try { const item = o.credentialStore!.get(sourceId); return item?.kind === 'oauth' && item.provider === 'google' && item.scopes.includes(DRIVE_SCOPE); }
  catch { return false; }
}
/** Active `google-workspace` connections whose stored sign-in carries `drive.file`. Reads connectors-ext's namespace only. */
function signedIn(host: ModuleHost, o: DriveSyncOptions, connectionId: string | null): GoogleConnection[] {
  if (!o.credentialStore || !o.credentialBroker) return [];
  const connections = peekModuleState<{ connections?: GoogleConnection[] }>(host.store.read(), 'connectors-ext')?.connections ?? [];
  return connections.filter(item => item.group === 'google-workspace' && item.status === 'active' && (connectionId === null || item.id === connectionId) && hasDriveScope(o, item.sourceId));
}
/** The token provider for one call or one attached transport; the connection is resolved again on every token. */
function tokenSource(ctx: Context, host: ModuleHost, connectionId: string | null): { connectionId: string | null; token: () => Promise<string> } {
  const o = options(host);
  if (typeof o.accessToken === 'function') return { connectionId: null, token: async () => o.accessToken!(ctx) };
  const chosen = signedIn(host, o, connectionId)[0];
  check(chosen, 'DRIVE_SIGN_IN_REQUIRED', 'Sign in to Google Drive first: add Google Workspace in Connections and sign in for Drive.');
  return { connectionId: chosen.id, token: async () => {
    const current = signedIn(host, o, chosen.id)[0];
    check(current, 'DRIVE_SIGN_IN_REQUIRED', 'The Google Drive sign-in was removed.');
    return o.credentialBroker!(ctx, { system: 'google', sourceId: current.sourceId, origin: GOOGLE_ORIGIN, scopes: [DRIVE_SCOPE], scheme: 'bearer' });
  } };
}

async function driveRead(o: DriveSyncOptions, token: () => Promise<string>, url: string): Promise<any> {
  let bearer: string;
  try { bearer = await token(); } catch (error) { if (error instanceof ChausarError && error.code === 'DRIVE_SIGN_IN_REQUIRED') throw error; throw new ChausarError('SYNC_ACCESS_DENIED', 'The Drive sign-in is not available.'); }
  check(typeof bearer === 'string' && /^[A-Za-z0-9._~+/-]{10,4096}=*$/.test(bearer), 'SYNC_ACCESS_DENIED', 'The Drive sign-in is not available.');
  let reply: FetchReply;
  try { reply = await fetcher(o)(url, { method: 'GET', headers: { authorization: `Bearer ${bearer}`, accept: 'application/json' }, signal: AbortSignal.timeout(60000) }); }
  catch { throw new ChausarError('SYNC_UNREACHABLE', 'Google Drive could not be reached.'); }
  check(reply.status !== 404, 'DRIVE_FOLDER_NOT_FOUND', 'This app cannot see that Drive folder. Choose a folder Chausar created.');
  check(reply.status !== 401 && reply.status !== 403, 'SYNC_ACCESS_DENIED', 'Google Drive refused this app\'s access.');
  check(reply.ok, 'SYNC_TRANSPORT_FAILED', 'Google Drive refused the request.');
  check(!(Number(reply.headers.get('content-length') ?? '0') > 64 * 1024), 'SYNC_TOO_LARGE', 'The Drive reply exceeds its bounded size.');
  const text = await reply.text().catch(() => { throw new ChausarError('SYNC_UNREACHABLE', 'Google Drive could not be reached.'); });
  check(Buffer.byteLength(text) <= 64 * 1024, 'SYNC_TOO_LARGE', 'The Drive reply exceeds its bounded size.');
  try { return JSON.parse(text); } catch { throw new ChausarError('SYNC_STORE_CORRUPT', 'Google Drive returned something that is not a sync head.'); }
}
/** Finds the head file in a folder this app created and reads the identity it is bound to. */
async function adoptable(o: DriveSyncOptions, token: () => Promise<string>, folderId: string, headFileId: string | null) {
  if (!headFileId) {
    const q = `name = '${HEAD_FILE_NAME}' and '${folderId}' in parents and trashed = false`;
    const listed = await driveRead(o, token, `${DRIVE_FILES}?q=${encodeURIComponent(q)}&fields=${encodeURIComponent('files(id,name)')}&spaces=drive&pageSize=10`);
    check(listed && Array.isArray(listed.files) && listed.files.every((f: any) => f && FILE_ID.test(f.id) && f.name === HEAD_FILE_NAME), 'SYNC_TRANSPORT_FAILED', 'Google Drive returned an unexpected file list.');
    check(listed.files.length === 1, 'DRIVE_FOLDER_NOT_FOUND', 'That folder holds no Chausar sync head this app can see. Choose a folder Chausar created.');
    headFileId = listed.files[0].id as string;
  }
  const head = await driveRead(o, token, `${DRIVE_FILES}/${headFileId}?alt=media`);
  check(head?.format === 'chausar.drive-sync.v1' && textId(head.workspaceId) && textId(head.vaultId), 'SYNC_STORE_CORRUPT', 'The Drive sync head is invalid.');
  return { headFileId: headFileId!, workspaceId: head.workspaceId as string, vaultId: head.vaultId as string };
}
function transportFor(ctx: Context, host: ModuleHost, drive: Pick<DriveRecord, 'folderId' | 'headFileId' | 'workspaceId' | 'vaultId'>, token: () => Promise<string>) {
  const o = options(host);
  const transport = new GoogleDriveSyncTransport({ folderId: drive.folderId, headFileId: drive.headFileId, workspaceId: drive.workspaceId, vaultId: drive.vaultId,
    fetch: fetcher(o), accessToken: token, ...(typeof o.clock === 'function' ? { clock: o.clock } : {}) });
  attachedHere.add(transport);
  return transport;
}
const matches = (transport: SyncTransport, drive: DriveRecord) => {
  const ids = transport.scope?.fileIds ?? [];
  return ids.length === 2 && ids[0] === drive.folderId && ids[1] === drive.headFileId && (transport as Partial<GoogleDriveSyncTransport>).workspaceId === drive.workspaceId;
};

/**
 * A sync preview and its approval name only the transport kind, so an approval given while one folder was attached
 * must not carry over to another: changing the folder voids every open preview and unused approval.
 */
function voidSyncApprovals(state: any): void {
  let voided = 0;
  for (const receipt of state.modelReceipts) {
    if (receipt?.kind === 'sync-preview' && receipt.status === 'preview') { receipt.status = 'voided'; voided++; }
    else if (receipt?.kind === 'sync-approval' && receipt.used === false) { receipt.used = true; receipt.voided = true; voided++; }
  }
  if (voided) audit(state, 'hosted.drive.syncApprovalsVoided', { count: voided });
}

export type Attachment = 'attached' | 'not-connected' | 'host-transport' | 'sign-in-required' | 'unavailable';
/** Brings the core SyncService in line with the recorded folder: attach, keep, or detach. Local only; never calls Drive. */
export function reattach(host: ModuleHost, ctx: Context): Attachment {
  const sync = syncService(host);
  if (!sync) return 'unavailable';
  const drive = record(host), existing = sync.options.transport;
  if (existing && !attachedHere.has(existing)) return 'host-transport';
  if (!drive || host.demo) { if (existing) sync.attachTransport(null); return host.demo ? 'unavailable' : 'not-connected'; }
  if (existing && matches(existing, drive)) return 'attached';
  let token: () => Promise<string>;
  try { token = tokenSource(ctx, host, drive.connectionId).token; }
  catch (error) { if (existing) sync.attachTransport(null); if (error instanceof ChausarError && error.code === 'DRIVE_SIGN_IN_REQUIRED') return 'sign-in-required'; throw error; }
  sync.attachTransport(transportFor(ctx, host, drive, token));
  return 'attached';
}

// Methods

export async function driveConnect(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  desktopOnly(ctx); shape(payload, ['folderName', 'folderId', 'headFileId', 'connectionId', 'expectedWorkspaceId']);
  check(!host.demo, 'DEMO_EXTERNAL_DISABLED', 'Synthetic demo mode keeps external systems disabled.');
  const adopt = payload.folderId !== undefined;
  check(adopt ? FILE_ID.test(payload.folderId) && payload.folderName === undefined && (payload.headFileId === undefined || FILE_ID.test(payload.headFileId))
    : payload.headFileId === undefined && payload.expectedWorkspaceId === undefined && (payload.folderName === undefined || (textId(payload.folderName) && payload.folderName.length <= 100)),
  'INVALID_REQUEST', 'Name a new folder, or choose a folder Chausar created earlier.');
  check(payload.connectionId === undefined || textId(payload.connectionId), 'INVALID_REQUEST', 'Choose a Google connection.');
  check(payload.expectedWorkspaceId === undefined || textId(payload.expectedWorkspaceId), 'INVALID_REQUEST', 'Name the workspace the folder belongs to.');
  check(!record(host), 'DRIVE_ALREADY_CONNECTED', 'A Drive folder is already connected. Disconnect it first.');
  const sync = syncService(host); check(sync, 'SYNC_UNAVAILABLE', 'Device sync is not available in this app.');
  check(!sync!.options.transport || attachedHere.has(sync!.options.transport), 'SYNC_TRANSPORT_CONFIGURED', 'This device\'s sync destination was configured by the host.');
  const own = identity(host), o = options(host), source = tokenSource(ctx, host, payload.connectionId ?? null);
  let drive: Omit<DriveRecord, 'recordedAt' | 'connectedAt'>;
  if (adopt) {
    const found = await adoptable(o, source.token, payload.folderId, payload.headFileId ?? null);
    const ours = found.workspaceId === own.workspaceId && found.vaultId === own.vaultId;
    check(ours || found.workspaceId === payload.expectedWorkspaceId, 'SYNC_WORKSPACE_MISMATCH', 'That Drive folder belongs to another workspace. To stage a restore from it, name that workspace.');
    drive = { folderId: payload.folderId, headFileId: found.headFileId, workspaceId: found.workspaceId, vaultId: found.vaultId, connectionId: source.connectionId, created: false };
    await transportFor(ctx, host, drive as DriveRecord, source.token).getHead(); // full validation of the head before anything is recorded
  } else {
    const ids = await createDriveSyncFolder(fetcher(o), source.token, own, payload.folderName ?? 'Chausar encrypted sync');
    drive = { ...ids, ...own, connectionId: source.connectionId, created: true };
  }
  const connectedAt = new Date().toISOString();
  const recorded = await host.store.update(state => {
    const s = moduleState(state, MODULE_ID, initialHostedLinkState);
    check(!s.drive, 'DRIVE_ALREADY_CONNECTED', 'A Drive folder is already connected. Disconnect it first.');
    const next: DriveRecord = { ...drive, recordedAt: connectedAt, connectedAt };
    s.drive = next;
    audit(state, 'hosted.drive.connected', { folderId: next.folderId, headFileId: next.headFileId, created: next.created, workspaceId: next.workspaceId });
    voidSyncApprovals(state);
    return structuredClone(next);
  });
  const attachment = reattach(host, ctx);
  return { connected: true, folderId: recorded.folderId, headFileId: recorded.headFileId, connectedAt: recorded.connectedAt, created: recorded.created,
    workspaceId: recorded.workspaceId, connectionId: recorded.connectionId, attachment, experimental: true, scope: DRIVE_SCOPE };
}

export function driveStatus(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  shape(payload, []);
  const attachment = reattach(host, ctx), drive = record(host), o = options(host);
  const sync = syncService(host)?.status(ctx) ?? null;
  return { connected: !!drive, folderId: drive?.folderId ?? null, headFileId: drive?.headFileId ?? null, connectedAt: drive?.connectedAt ?? null, created: drive?.created ?? null,
    workspaceId: drive?.workspaceId ?? null, connectionId: drive?.connectionId ?? null, attachment,
    signIn: host.demo ? 'unavailable' : typeof o.accessToken === 'function' || (drive ? signedIn(host, o, drive.connectionId) : signedIn(host, o, null)).length > 0 ? 'available' : 'required',
    sync: sync ? { enabled: sync.enabled, transport: sync.transport, deviceId: sync.deviceId } : null, demo: host.demo, experimental: true, scope: DRIVE_SCOPE };
}

export async function driveDisconnect(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  desktopOnly(ctx); shape(payload, []);
  const had = await host.store.update(state => {
    const s = moduleState(state, MODULE_ID, initialHostedLinkState), before = s.drive as DriveRecord | null;
    if (!before) return null;
    s.drive = null;
    audit(state, 'hosted.drive.disconnected', { folderId: before.folderId });
    voidSyncApprovals(state);
    return before.folderId;
  });
  const attachment = reattach(host, ctx);
  return { disconnected: had !== null, folderId: had, attachment, filesKept: true,
    note: 'The folder and its encrypted records stay in Google Drive. Remove them there if you no longer need them.' };
}
