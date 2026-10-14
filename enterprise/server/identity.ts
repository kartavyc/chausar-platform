import { lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { check, hash } from '../../platform/runtime/contracts.ts';
import type { Context, Member, Role } from '../../platform/runtime/contracts.ts';
import type { Engine } from '../../platform/runtime/engine.ts';
import type { RoleRule } from './config.ts';

export type IdentityEntry = { issuer: string; subject: string; memberId: string; role: Role; branches: string[]; updatedAt: string };
export type SignedIn = { context: Context; member: { id: string; role: Role; branches: string[] } };
const FILE_LIMIT = 8 * 1024 * 1024;
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
function validEntries(value: unknown): IdentityEntry[] {
  check(!!value && typeof value === 'object' && !Array.isArray(value) && (value as any).version === 1 && Array.isArray((value as any).entries), 'ENTERPRISE_IDENTITY_STORE_INVALID', 'The identity map file is not well formed.');
  return (value as { entries: unknown[] }).entries.map(item => {
    const entry = item as IdentityEntry;
    check(!!entry && typeof entry.issuer === 'string' && /^[0-9a-f]{64}$/.test(entry.subject) && typeof entry.memberId === 'string' && roles.includes(entry.role)
      && Array.isArray(entry.branches) && entry.branches.every(branch => typeof branch === 'string') && typeof entry.updatedAt === 'string', 'ENTERPRISE_IDENTITY_STORE_INVALID', 'The identity map file is not well formed.');
    return { issuer: entry.issuer, subject: entry.subject, memberId: entry.memberId, role: entry.role, branches: [...entry.branches], updatedAt: entry.updatedAt };
  });
}

/** Maps (issuer, subject) to an engine member. Raw subjects and tokens are never stored. */
export class IdentityDirectory {
  readonly engine: Engine; readonly file: string; readonly rules: readonly RoleRule[]; readonly allowedEmailDomains?: readonly string[];
  #entries: IdentityEntry[]; #queue: Promise<unknown> = Promise.resolve();
  private constructor(engine: Engine, file: string, options: { rules: readonly RoleRule[]; allowedEmailDomains?: readonly string[] }, entries: IdentityEntry[]) {
    this.engine = engine; this.file = file; this.rules = options.rules; this.allowedEmailDomains = options.allowedEmailDomains; this.#entries = entries;
  }
  static async open(engine: Engine, options: { dataDirectory: string; rules: readonly RoleRule[]; allowedEmailDomains?: readonly string[] }): Promise<IdentityDirectory> {
    await mkdir(options.dataDirectory, { recursive: true, mode: 0o700 });
    const directory = await lstat(options.dataDirectory);
    check(directory.isDirectory() && !directory.isSymbolicLink(), 'ENTERPRISE_DATA_DIRECTORY_INVALID', 'The server data directory must be a real directory.');
    if (process.platform !== 'win32') check((directory.mode & 0o077) === 0, 'ENTERPRISE_DATA_DIRECTORY_INVALID', 'The server data directory must be private to its owner.');
    const file = join(options.dataDirectory, 'identities.json'); let entries: IdentityEntry[] = [];
    const stat = await lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (stat) {
      check(stat.isFile() && !stat.isSymbolicLink() && stat.size <= FILE_LIMIT, 'ENTERPRISE_IDENTITY_STORE_INVALID', 'The identity map file is not well formed.');
      if (process.platform !== 'win32') check((stat.mode & 0o077) === 0, 'ENTERPRISE_IDENTITY_STORE_INVALID', 'The identity map file must be private to its owner.');
      let value: unknown; try { value = JSON.parse(await readFile(file, 'utf8')); } catch { check(false, 'ENTERPRISE_IDENTITY_STORE_INVALID', 'The identity map file is not well formed.'); }
      entries = validEntries(value);
    }
    return new IdentityDirectory(engine, file, options, entries);
  }
  private async save(entries: IdentityEntry[]) {
    const temporary = `${this.file}.${randomBytes(8).toString('hex')}.tmp`;
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify({ version: 1, entries })); await handle.sync(); } finally { await handle.close(); }
    try { await rename(temporary, this.file); } catch (error) { await rm(temporary, { force: true }); throw error; }
  }
  private async members(): Promise<Member[]> { return this.engine.requestAs(this.engine.bootstrapContext(), 'members.list'); }
  /** One sign-in at a time, so concurrent first logins cannot provision twice. */
  private serial<T>(work: () => Promise<T>): Promise<T> { const next = this.#queue.then(work, work); this.#queue = next.catch(() => {}); return next; }
  signIn(issuer: string, claims: Readonly<Record<string, unknown>>): Promise<SignedIn> {
    return this.serial(async () => {
      check(typeof claims.sub === 'string' && claims.sub.length > 0, 'OIDC_CLAIMS_INVALID', 'The identity token names no subject.');
      checkEmailDomain(this.allowedEmailDomains, claims);
      const mapped = mapRole(this.rules, claims); const subject = hash(claims.sub);
      const index = this.#entries.findIndex(entry => entry.issuer === issuer && entry.subject === subject);
      const previous = index >= 0 ? this.#entries[index] : undefined;
      let members = await this.members(); let memberId = previous?.memberId;
      if (previous && previous.role === mapped.role && sameBranches(previous.branches, mapped.branches)) {
        const member = members.find(m => m.id === previous.memberId);
        // A member an administrator revoked stays revoked until the provider mapping changes.
        check(member?.active, 'ENTERPRISE_MEMBER_REVOKED', 'Your workspace access was revoked. Ask an administrator.');
      } else {
        const boot = this.engine.bootstrapContext();
        if (previous && members.find(m => m.id === previous.memberId)?.active) await this.engine.requestAs(boot, 'members.revoke', { id: previous.memberId });
        const added: Member = await this.engine.requestAs(boot, 'members.add', { name: memberName(claims), role: mapped.role, branches: mapped.branches });
        memberId = added.id;
        const entry: IdentityEntry = { issuer, subject, memberId: added.id, role: mapped.role, branches: mapped.branches, updatedAt: new Date().toISOString() };
        const entries = [...this.#entries]; if (index >= 0) entries[index] = entry; else entries.push(entry);
        try { await this.save(entries); }
        catch { await this.engine.requestAs(boot, 'members.revoke', { id: added.id }).catch(() => {}); check(false, 'ENTERPRISE_IDENTITY_STORE_FAILED', 'Sign-in could not be recorded. Try again.'); }
        this.#entries = entries; members = await this.members();
      }
      const member = members.find(m => m.id === memberId);
      check(member?.active, 'ENTERPRISE_MEMBER_REVOKED', 'Your workspace access was revoked. Ask an administrator.');
      return { context: { memberId: member.id, role: member.role, epoch: member.epoch, channel: 'desktop' }, member: { id: member.id, role: member.role, branches: [...member.branches] } };
    });
  }
  /** The current member for a session, or null when it was revoked or changed. */
  async current(memberId: string, role: Role, epoch: number): Promise<Member | null> {
    const member = (await this.members()).find(m => m.id === memberId);
    return member && member.active && member.role === role && member.epoch === epoch ? member : null;
  }
  entries(): IdentityEntry[] { return structuredClone(this.#entries); }
}
