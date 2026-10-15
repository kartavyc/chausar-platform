import { lstat, mkdir, readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { check, hash } from '../../platform/runtime/contracts.ts';
import type { Context, Member, Role } from '../../platform/runtime/contracts.ts';
import type { Engine } from '../../platform/runtime/engine.ts';
import type { RoleRule } from './config.ts';
import { MemoryIdentityStore, type IdentityEntry, type IdentityStore } from './state-store.ts';

export type { IdentityEntry, IdentityStore } from './state-store.ts';
export type SignedIn = { context: Context; member: { id: string; role: Role; branches: string[] } };
const FILE_LIMIT = 8 * 1024 * 1024;
/** The identity map of earlier versions, read once on start and renamed after it is in the shared store. */
export const LEGACY_IDENTITY_FILE = 'identities.json';
const roles: readonly string[] = ['owner', 'cofounder', 'accountant', 'viewer'];
const sameBranches = (left: string[], right: string[]) => left.length === right.length && [...left].sort().every((item, index) => item === [...right].sort()[index]);

/** Evaluates rules in order against verified claims; the first match wins. */
export function mapRole(rules: readonly RoleRule[], claims: Readonly<Record<string, unknown>>): { role: Role; branches: string[] } {
  for (const rule of rules) {
    const value = Object.hasOwn(claims, rule.claim) ? claims[rule.claim] : undefined;
    if (value === rule.equals || (Array.isArray(value) && value.length <= 1000 && value.includes(rule.equals))) return { role: rule.role, branches: [...rule.branches] };
  }
  check(false, 'ENTERPRISE_ROLE_UNMAPPED', 'Your account has no Chausar role. Ask an administrator to grant one.');
}
export function checkEmailDomain(allowed: readonly string[] | undefined, claims: Readonly<Record<string, unknown>>) {
  if (!allowed) return;
  const email = claims.email;
  check(typeof email === 'string' && email.length <= 320 && claims.email_verified === true, 'ENTERPRISE_EMAIL_REFUSED', 'Sign in with a verified work email address.');
  const at = email.lastIndexOf('@'); const domain = email.slice(at + 1).toLowerCase();
  check(at > 0 && allowed.includes(domain), 'ENTERPRISE_EMAIL_REFUSED', 'Sign in with a verified work email address.');
}
function memberName(claims: Readonly<Record<string, unknown>>): string {
  for (const key of ['name', 'preferred_username', 'email']) {
    const value = claims[key];
    if (typeof value === 'string') { const clean = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200); if (clean) return clean; }
  }
  return 'Signed-in member';
}
/** Entries of an earlier `identities.json` (version 1, no revoked flag: revocation then lived only in the engine). */
function validEntries(value: unknown): IdentityEntry[] {
  check(!!value && typeof value === 'object' && !Array.isArray(value) && (value as any).version === 1 && Array.isArray((value as any).entries), 'ENTERPRISE_IDENTITY_STORE_INVALID', 'The identity map file is not well formed.');
  return (value as { entries: unknown[] }).entries.map(item => {
    const entry = item as IdentityEntry;
    check(!!entry && typeof entry.issuer === 'string' && /^[0-9a-f]{64}$/.test(entry.subject) && typeof entry.memberId === 'string' && roles.includes(entry.role)
      && Array.isArray(entry.branches) && entry.branches.every(branch => typeof branch === 'string') && typeof entry.updatedAt === 'string', 'ENTERPRISE_IDENTITY_STORE_INVALID', 'The identity map file is not well formed.');
    check(entry.issuer.length > 0 && entry.issuer.length <= 2048 && entry.memberId.length > 0 && entry.memberId.length <= 200 && !Number.isNaN(Date.parse(entry.updatedAt)), 'ENTERPRISE_IDENTITY_STORE_INVALID', 'The identity map file is not well formed.');
    return { issuer: entry.issuer, subject: entry.subject, memberId: entry.memberId, role: entry.role, branches: [...entry.branches], revoked: false, updatedAt: new Date(entry.updatedAt).toISOString() };
  });
}

/** Imports an earlier identities.json into the store once, then renames it `.imported` so it is never read again.
 * A memory store only reads it: the file stays, because nothing durable holds the entries yet. */
async function importLegacyFile(directory: string, store: IdentityStore): Promise<number> {
  const file = join(directory, LEGACY_IDENTITY_FILE);
  const stat = await lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (!stat) return 0;
  check(stat.isFile() && !stat.isSymbolicLink() && stat.size <= FILE_LIMIT, 'ENTERPRISE_IDENTITY_STORE_INVALID', 'The identity map file is not well formed.');
  if (process.platform !== 'win32') check((stat.mode & 0o077) === 0, 'ENTERPRISE_IDENTITY_STORE_INVALID', 'The identity map file must be private to its owner.');
  let value: unknown; try { value = JSON.parse(await readFile(file, 'utf8')); } catch { check(false, 'ENTERPRISE_IDENTITY_STORE_INVALID', 'The identity map file is not well formed.'); }
  const added = await store.importEntries(validEntries(value));
  // Another process sharing this directory may have imported and renamed it first; its entries are already in the store.
  if (store.kind === 'postgres') await rename(file, `${file}.imported`).catch(error => { if (error.code !== 'ENOENT') throw error; });
  return added;
}

/** Maps (issuer, subject) to an engine member. Raw subjects and tokens are never stored. */
export class IdentityDirectory {
  readonly engine: Engine; readonly store: IdentityStore; readonly rules: readonly RoleRule[]; readonly allowedEmailDomains?: readonly string[];
  /** Entries added from an earlier identities.json when this directory opened. */
  readonly imported: number;
  #queue: Promise<unknown> = Promise.resolve();
  private constructor(engine: Engine, store: IdentityStore, options: { rules: readonly RoleRule[]; allowedEmailDomains?: readonly string[] }, imported: number) {
    this.engine = engine; this.store = store; this.rules = options.rules; this.allowedEmailDomains = options.allowedEmailDomains; this.imported = imported;
  }
  /** `store` is the shared identity map (PostgreSQL in production); without one, a single process keeps it in memory. */
  static async open(engine: Engine, options: { dataDirectory: string; rules: readonly RoleRule[]; allowedEmailDomains?: readonly string[]; store?: IdentityStore }): Promise<IdentityDirectory> {
    await mkdir(options.dataDirectory, { recursive: true, mode: 0o700 });
    const directory = await lstat(options.dataDirectory);
    check(directory.isDirectory() && !directory.isSymbolicLink(), 'ENTERPRISE_DATA_DIRECTORY_INVALID', 'The server data directory must be a real directory.');
    if (process.platform !== 'win32') check((directory.mode & 0o077) === 0, 'ENTERPRISE_DATA_DIRECTORY_INVALID', 'The server data directory must be private to its owner.');
    const store = options.store ?? new MemoryIdentityStore();
    const imported = await importLegacyFile(options.dataDirectory, store);
    return new IdentityDirectory(engine, store, options, imported);
  }
  private async members(): Promise<Member[]> { return this.engine.requestAs(this.engine.bootstrapContext(), 'members.list'); }
  /** One sign-in at a time in this process; the store serializes each identity across processes. */
  private serial<T>(work: () => Promise<T>): Promise<T> { const next = this.#queue.then(work, work); this.#queue = next.catch(() => {}); return next; }
  signIn(issuer: string, claims: Readonly<Record<string, unknown>>): Promise<SignedIn> {
    return this.serial(async () => {
      check(typeof claims.sub === 'string' && claims.sub.length > 0, 'OIDC_CLAIMS_INVALID', 'The identity token names no subject.');
      checkEmailDomain(this.allowedEmailDomains, claims);
      const mapped = mapRole(this.rules, claims); const subject = hash(claims.sub);
      const boot = this.engine.bootstrapContext(); let added: string | undefined;
      let decision;
      try {
        decision = await this.store.withIdentity(issuer, subject, async previous => {
          const members = await this.members(); const at = new Date().toISOString();
          if (previous && previous.role === mapped.role && sameBranches(previous.branches, mapped.branches)) {
            // A member an administrator revoked stays revoked until the provider mapping changes.
            if (previous.revoked || !members.find(m => m.id === previous.memberId)?.active) return { memberId: null, ...(previous.revoked ? {} : { save: { ...previous, revoked: true, updatedAt: at } }) };
            return { memberId: previous.memberId };
          }
          if (previous && members.find(m => m.id === previous.memberId)?.active) await this.engine.requestAs(boot, 'members.revoke', { id: previous.memberId });
          const member: Member = await this.engine.requestAs(boot, 'members.add', { name: memberName(claims), role: mapped.role, branches: mapped.branches });
          added = member.id;
          return { memberId: member.id, save: { issuer, subject, memberId: member.id, role: mapped.role, branches: [...mapped.branches], revoked: false, updatedAt: at } };
        });
      } catch (error) {
        // The member was added but the map did not record it: revoke it, so no unreachable member stays active.
        if (added) { await this.engine.requestAs(boot, 'members.revoke', { id: added }).catch(() => {}); check(false, 'ENTERPRISE_IDENTITY_STORE_FAILED', 'Sign-in could not be recorded. Try again.'); }
        throw error;
      }
      const member = decision.memberId ? (await this.members()).find(m => m.id === decision.memberId) : undefined;
      check(member?.active, 'ENTERPRISE_MEMBER_REVOKED', 'Your workspace access was revoked. Ask an administrator.');
      return { context: { memberId: member.id, role: member.role, epoch: member.epoch, channel: 'desktop' }, member: { id: member.id, role: member.role, branches: [...member.branches] } };
    });
  }
  /** The current member for a session, or null when it was revoked or changed. */
  async current(memberId: string, role: Role, epoch: number): Promise<Member | null> {
    const member = (await this.members()).find(m => m.id === memberId);
    return member && member.active && member.role === role && member.epoch === epoch ? member : null;
  }
  entries(): Promise<IdentityEntry[]> { return this.store.list(); }
}
