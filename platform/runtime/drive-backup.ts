// C5 task 24: encrypted backups to the owner's Google Drive, built up to the OAuth client. OAuth for installed apps with PKCE
// on a 127.0.0.1 loopback port; scope drive.file only, so Chausar sees only what it made; a resumable upload of the encrypted
// backup into one "Chausar backups" folder, keeping that business's newest 5. The refresh token goes to the credential store
// and nowhere else: never a record, a card or a log. The client id comes from build metadata (package.json
// chausarGoogleClientId), never from source; with none, every method answers DRIVE_NOT_SET_UP and no call goes anywhere.
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ChausarError } from './contracts.ts';
import { CUSTODY_WORDS } from './workspace-custody-contracts.ts';
import { parseBackupName } from './workspace-custody.ts';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const DRIVE_FOLDER = 'Chausar backups';
export const DRIVE_KEEP = 5;
const FOLDER_TYPE = 'application/vnd.google-apps.folder';
const GOOGLE = Object.freeze({
  auth: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token',
  files: 'https://www.googleapis.com/drive/v3/files', upload: 'https://www.googleapis.com/upload/drive/v3/files',
});
export type DriveEndpoints = { auth: string; token: string; files: string; upload: string };
/** Where the refresh token lives: the credential store on the desktop. Holds nothing else. */
export type DriveTokens = { read(): Promise<string | null>; write(text: string): Promise<void>; remove(): Promise<void> };
export type DriveState = 'not-connected' | 'connecting' | 'connected';

/** Google asks a resumable chunk to be a multiple of 256 KiB, except the last. */
const CHUNK_BYTES = 8 * 1024 * 1024;
const MAX_RETRIES = 5;
/** How long Chausar waits for the owner to finish in the browser. */
const SIGN_IN_MS = 5 * 60_000;

const notSetUp = () => new ChausarError('DRIVE_NOT_SET_UP', CUSTODY_WORDS.errors.DRIVE_NOT_SET_UP);
const reconnect = () => new ChausarError('DRIVE_RECONNECT', CUSTODY_WORDS.errors.DRIVE_RECONNECT);
const failed = () => new ChausarError('DRIVE_FAILED', "Google Drive didn't take the copy. Chausar tries again with the next backup.");

/** The build's Google client, from package.json's fields. Empty or missing means not set up. */
export function driveClientFrom(meta: unknown): { clientId: string | null; clientSecret: string | null } {
  const read = (key: string) => { const value = (meta as Record<string, unknown> | null)?.[key]; return typeof value === 'string' && value.trim() ? value.trim() : null; };
  return { clientId: read('chausarGoogleClientId'), clientSecret: read('chausarGoogleClientSecret') };
}
/** This build's Google client. Google's desktop clients come with a secret that isn't one (RFC 8252); it sits beside the id. */
export function driveClientOfBuild(): { clientId: string | null; clientSecret: string | null } {
  try { return driveClientFrom(JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))); }
  catch { return { clientId: null, clientSecret: null }; }
}

export class DriveBackup {
  readonly #clientId: string | null;
  readonly #clientSecret: string | null;
  readonly #tokens: DriveTokens;
  readonly #at: DriveEndpoints;
  readonly #chunk: number;
  #access: string | null = null;
  #signIn: { server: Server; done: Promise<void> } | null = null;

  constructor(options: { clientId: string | null; clientSecret?: string | null; tokens: DriveTokens; endpoints?: DriveEndpoints; chunkBytes?: number }) {
    this.#clientId = options.clientId;
    this.#clientSecret = options.clientSecret ?? null;
    this.#tokens = options.tokens;
    this.#at = options.endpoints ?? GOOGLE;
    this.#chunk = options.chunkBytes ?? CHUNK_BYTES;
  }
  #need(): string { if (!this.#clientId) throw notSetUp(); return this.#clientId; }

  async status(): Promise<{ state: DriveState }> {
    this.#need();
    if (this.#signIn) return { state: 'connecting' };
    return { state: await this.#tokens.read() ? 'connected' : 'not-connected' };
  }

  /** Opens the loopback port and answers the address the owner's browser goes to. The sign-in finishes when Google comes back. */
  async connect(): Promise<{ state: 'connecting'; url: string }> {
    const clientId = this.#need();
    this.#closeSignIn();
    const verifier = randomBytes(48).toString('base64url'), state = randomBytes(24).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    let finish!: (error?: Error) => void;
    const done = new Promise<void>((resolve, reject) => { finish = error => (error ? reject(error) : resolve()); });
    done.catch(() => {});
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const reply = (status: number, words: string) => { response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', connection: 'close' }); response.end(words); };
      const code = url.searchParams.get('code');
      if (url.searchParams.get('state') !== state || !code) { reply(400, 'Chausar did not ask for this. You can close this tab.'); return; }
      const address = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
      void this.#exchange({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: address }).then(async answer => {
        if (typeof answer.refresh_token !== 'string') throw reconnect();
        await this.#tokens.write(JSON.stringify({ refresh: answer.refresh_token }));
        this.#access = typeof answer.access_token === 'string' ? answer.access_token : null;
        reply(200, 'Google Drive is connected. You can close this tab and go back to Chausar.');
        finish();
      }).catch((error: Error) => { reply(500, 'Google Drive did not connect. Go back to Chausar and try again.'); finish(error); }).finally(() => { if (this.#signIn?.server === server) this.#closeSignIn(); });
    });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()); });
    server.unref();
    const timer = setTimeout(() => { if (this.#signIn?.server === server) { this.#closeSignIn(); finish(reconnect()); } }, SIGN_IN_MS);
    timer.unref();
    server.once('close', () => clearTimeout(timer));
    this.#signIn = { server, done };
    const address = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    const query = new URLSearchParams({ client_id: clientId, redirect_uri: address, response_type: 'code', scope: DRIVE_SCOPE, code_challenge: challenge, code_challenge_method: 'S256', state, access_type: 'offline', prompt: 'consent' });
    return { state: 'connecting', url: `${this.#at.auth}?${query}` };
  }
  /** Settles when the sign-in in progress has finished. */
  async connected(): Promise<void> { await this.#signIn?.done; }
  #closeSignIn() { const open = this.#signIn; this.#signIn = null; open?.server.closeAllConnections?.(); open?.server.close(); }

  /** Forgets the tokens on this computer. What is already on Drive stays there, the owner's own. */
  async disconnect(): Promise<{ state: DriveState }> {
    this.#need();
    this.#closeSignIn();
    this.#access = null;
    await this.#tokens.remove();
    return { state: 'not-connected' };
  }
  /** Closes what this object holds open: the loopback port of an unfinished sign-in. */
  close() { this.#closeSignIn(); this.#access = null; }

  async #exchange(form: Record<string, string>): Promise<Record<string, unknown>> {
    const fields = new URLSearchParams({ client_id: this.#need(), ...(this.#clientSecret ? { client_secret: this.#clientSecret } : {}), ...form });
    const response = await fetch(this.#at.token, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: fields.toString() });
    const answer = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (response.status === 400 || response.status === 401) { await this.#tokens.remove(); this.#access = null; throw reconnect(); }
    if (!response.ok) throw failed();
    return answer;
  }
  async #bearer(fresh = false): Promise<string> {
    if (this.#access && !fresh) return this.#access;
    const held = await this.#tokens.read();
    const refresh = held ? (JSON.parse(held) as { refresh?: unknown }).refresh : null;
    if (typeof refresh !== 'string') throw reconnect();
    const answer = await this.#exchange({ grant_type: 'refresh_token', refresh_token: refresh });
    if (typeof answer.access_token !== 'string') throw failed();
    this.#access = answer.access_token;
    return this.#access;
  }
  /** One Drive call with the bearer token, once more with a new token after a 401. */
  async #api(url: string, init: RequestInit = {}): Promise<Response> {
    const call = async (fresh: boolean) => fetch(url, { ...init, headers: { ...init.headers as Record<string, string>, authorization: `Bearer ${await this.#bearer(fresh)}` } });
    let response = await call(false);
    if (response.status === 401) response = await call(true);
    if (response.status === 401) { await this.#tokens.remove(); this.#access = null; throw reconnect(); }
    return response;
  }
  async #list(q: string): Promise<{ id: string; name: string }[]> {
    const response = await this.#api(`${this.#at.files}?${new URLSearchParams({ q, fields: 'files(id,name)', pageSize: '1000', spaces: 'drive' })}`);
    if (!response.ok) throw failed();
    const found = await response.json() as { files?: { id: string; name: string }[] };
    return found.files ?? [];
  }
  async #folder(): Promise<string> {
    const [known] = await this.#list(`name = '${DRIVE_FOLDER}' and mimeType = '${FOLDER_TYPE}' and trashed = false`);
    if (known) return known.id;
    const response = await this.#api(this.#at.files, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: DRIVE_FOLDER, mimeType: FOLDER_TYPE }) });
    if (!response.ok) throw failed();
    return (await response.json() as { id: string }).id;
  }
  /** Sends the rest of the bytes to an open session, asking where it stands after a cut. */
  async #send(session: string, bytes: Buffer): Promise<void> {
    let sent = 0, retries = 0;
    while (true) {
      try {
        const end = Math.min(sent + this.#chunk, bytes.length);
        const response = await fetch(session, { method: 'PUT', headers: { 'content-range': `bytes ${sent}-${end - 1}/${bytes.length}` }, body: bytes.subarray(sent, end) as unknown as BodyInit });
        if (response.ok) return;
        if (response.status !== 308) throw failed();
        await response.arrayBuffer().catch(() => undefined);
        sent = rangeEnd(response.headers.get('range'));
        retries = 0;
      } catch (error) {
        if (error instanceof ChausarError || ++retries > MAX_RETRIES) throw error instanceof ChausarError ? error : failed();
        const asked = await fetch(session, { method: 'PUT', headers: { 'content-range': `bytes */${bytes.length}` } }).catch(() => null);
        if (asked?.ok) return;
        if (asked?.status === 308) sent = rangeEnd(asked.headers.get('range'));
      }
    }
  }
  /** Uploads one encrypted backup, then keeps that business's newest 5 in the folder. Nothing else there is touched. */
  async upload(name: string, bytes: Buffer, workspaceId: string): Promise<void> {
    this.#need();
    const parent = await this.#folder();
    const opened = await this.#api(`${this.#at.upload}?uploadType=resumable`, { method: 'POST', headers: { 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-type': 'application/octet-stream', 'x-upload-content-length': String(bytes.length) }, body: JSON.stringify({ name, parents: [parent] }) });
    const session = opened.headers.get('location');
    if (!opened.ok || !session) throw failed();
    await this.#send(session, bytes);
    const mine = (await this.#list(`'${parent}' in parents and trashed = false`))
      .flatMap(file => { const read = parseBackupName(file.name); return read && read.workspaceId === workspaceId ? [{ ...file, at: read.at }] : []; })
      .sort((a, b) => b.at - a.at);
    for (const old of mine.slice(DRIVE_KEEP)) await this.#api(`${this.#at.files}/${old.id}`, { method: 'DELETE' }).catch(() => undefined);
  }
}

/** How many bytes the session holds, from its Range header: 'bytes=0-1023' is 1024. */
function rangeEnd(range: string | null): number {
  const match = /^bytes=0-(\d+)$/.exec(range ?? '');
  return match ? Number(match[1]) + 1 : 0;
}
