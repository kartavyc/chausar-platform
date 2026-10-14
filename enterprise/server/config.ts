import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { check } from '../../platform/runtime/contracts.ts';
import type { Role } from '../../platform/runtime/contracts.ts';

/** One ordered role rule: the first rule whose claim matches decides role and branches. */
export type RoleRule = { claim: string; equals: string; role: Role; branches: string[] };
export type EnterpriseConfig = {
  listen: { host: string; port: number };
  tls: { certFile: string; keyFile: string };
  publicOrigin: string;
  oidc: { issuer: string; clientId: string; clientSecretFile: string; redirectPath: string; scopes: string[] };
  roles: RoleRule[];
  allowedEmailDomains?: string[];
  sessionTtlMinutes: number;
  dataDirectory: string;
  workspace: { directory: string; folder: string; unlock: { passphraseFile: string } | 'keychain' };
  /** Verified TLS to PostgreSQL: the CA certificate (PEM) that signed the database server's certificate, and optionally the name it carries. */
  database?: { caFile: string; servername?: string };
};

const roles: readonly Role[] = ['owner', 'cofounder', 'accountant', 'viewer'];
const CONFIG_LIMIT = 64 * 1024;
const SECRET_LIMIT = 16 * 1024;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
function exactKeys(value: unknown, required: string[], optional: string[] = []): asserts value is Record<string, any> {
  check(record(value), 'ENTERPRISE_CONFIG_INVALID', 'Each enterprise configuration section must be an object.');
  const keys = Object.keys(value);
  check(required.every(key => keys.includes(key)), 'ENTERPRISE_CONFIG_INVALID', 'The enterprise configuration is missing a required setting.');
  check(keys.every(key => required.includes(key) || optional.includes(key)), 'ENTERPRISE_CONFIG_INVALID', 'The enterprise configuration contains an unknown setting.');
}
const text = (value: unknown, pattern: RegExp, max = 200): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && pattern.test(value);
const absolutePath = (value: unknown): value is string => typeof value === 'string' && value.length <= 1024 && isAbsolute(value) && !value.includes('\0') && !value.split(/[\\/]/).includes('..');
const branchList = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0 && value.length <= 100 && value.every(item => text(item, /^(?:\*|[A-Za-z0-9][A-Za-z0-9 _.-]{0,79})$/)) && (!value.includes('*') || value.length === 1);

/** Pure structural validation. File checks happen in loadEnterpriseConfig/readPrivateFile. */
export function parseEnterpriseConfig(input: unknown): EnterpriseConfig {
  check(record(input), 'ENTERPRISE_CONFIG_INVALID', 'The enterprise configuration must be a JSON object.');
  // TLS is checked first: no other mistake may hide that a plaintext server was requested.
  check(record(input.tls) && typeof input.tls.certFile === 'string' && typeof input.tls.keyFile === 'string', 'TLS_REQUIRED', 'The enterprise server only runs over HTTPS. Configure a certificate and key file.');
  const secretKey = (value: unknown) => record(value) && ['clientSecret', 'passphrase', 'password'].some(key => Object.hasOwn(value, key));
  check(!secretKey(input.oidc) && !(record(input.workspace) && (secretKey(input.workspace) || secretKey(input.workspace.unlock))), 'ENTERPRISE_INLINE_SECRET', 'Secrets must be supplied as file paths, never inside the configuration.');
  exactKeys(input, ['listen', 'tls', 'publicOrigin', 'oidc', 'roles', 'sessionTtlMinutes', 'dataDirectory', 'workspace'], ['allowedEmailDomains', 'database']);
  exactKeys(input.listen, ['host', 'port']);
  check(text(input.listen.host, /^(?:[0-9.]{7,15}|[0-9a-fA-F:]{2,39}|[a-zA-Z0-9.-]{1,253})$/, 253), 'ENTERPRISE_CONFIG_INVALID', 'Use a listen host name or address.');
  check(Number.isSafeInteger(input.listen.port) && input.listen.port >= 1 && input.listen.port <= 65535, 'ENTERPRISE_CONFIG_INVALID', 'Use a listen port between 1 and 65535.');
  exactKeys(input.tls, ['certFile', 'keyFile']);
  check(absolutePath(input.tls.certFile) && absolutePath(input.tls.keyFile), 'TLS_REQUIRED', 'Certificate and key files must be absolute paths.');
  check(typeof input.publicOrigin === 'string' && input.publicOrigin.length <= 300, 'ENTERPRISE_CONFIG_INVALID', 'Use an HTTPS public origin.');
  let origin: URL; try { origin = new URL(input.publicOrigin); } catch { check(false, 'ENTERPRISE_CONFIG_INVALID', 'Use an HTTPS public origin.'); }
  check(origin.protocol === 'https:' && origin.origin === input.publicOrigin && !origin.username && !origin.password, 'ENTERPRISE_CONFIG_INVALID', 'The public origin must be an exact https origin without a path.');
  exactKeys(input.oidc, ['issuer', 'clientId', 'clientSecretFile', 'redirectPath', 'scopes']);
  check(typeof input.oidc.issuer === 'string' && input.oidc.issuer.length <= 300 && URL.canParse(input.oidc.issuer) && new URL(input.oidc.issuer).protocol === 'https:' && !new URL(input.oidc.issuer).search && !new URL(input.oidc.issuer).hash, 'ENTERPRISE_CONFIG_INVALID', 'The sign-in issuer must be an https URL.');
  check(text(input.oidc.clientId, /^[\x21-\x7e]+$/, 300), 'ENTERPRISE_CONFIG_INVALID', 'Use the client id registered with the sign-in provider.');
  check(absolutePath(input.oidc.clientSecretFile), 'ENTERPRISE_CONFIG_INVALID', 'The client secret must be an absolute file path.');
  check(text(input.oidc.redirectPath, /^\/auth\/[a-z0-9-]{1,40}$/) && !['/auth/login', '/auth/logout'].includes(input.oidc.redirectPath), 'ENTERPRISE_CONFIG_INVALID', 'The redirect path must be a short path under /auth/.');
  check(Array.isArray(input.oidc.scopes) && input.oidc.scopes.length <= 20 && input.oidc.scopes.includes('openid') && input.oidc.scopes.every((scope: unknown) => text(scope, /^[\x21\x23-\x5b\x5d-\x7e]+$/, 100)) && new Set(input.oidc.scopes).size === input.oidc.scopes.length, 'ENTERPRISE_CONFIG_INVALID', 'Scopes must be distinct names and include openid.');
  check(Array.isArray(input.roles) && input.roles.length > 0 && input.roles.length <= 100, 'ENTERPRISE_CONFIG_INVALID', 'Configure between one and one hundred role rules.');
  const rules = input.roles.map((rule: unknown): RoleRule => {
    exactKeys(rule, ['claim', 'equals', 'role', 'branches']);
    check(text(rule.claim, /^[A-Za-z0-9_:./-]+$/, 100) && !['__proto__', 'prototype', 'constructor'].includes(rule.claim), 'ENTERPRISE_CONFIG_INVALID', 'A role rule names one top-level claim.');
    check(typeof rule.equals === 'string' && rule.equals.length > 0 && rule.equals.length <= 300, 'ENTERPRISE_CONFIG_INVALID', 'A role rule compares against one claim value.');
    check(roles.includes(rule.role), 'ENTERPRISE_CONFIG_INVALID', 'A role rule must grant an existing workspace role.');
    check(branchList(rule.branches), 'ENTERPRISE_CONFIG_INVALID', 'A role rule must grant named branches, or only the all-branches mark.');
    return { claim: rule.claim, equals: rule.equals, role: rule.role, branches: [...rule.branches] };
  });
  if (input.allowedEmailDomains !== undefined) check(Array.isArray(input.allowedEmailDomains) && input.allowedEmailDomains.length > 0 && input.allowedEmailDomains.length <= 100 && input.allowedEmailDomains.every((domain: unknown) => text(domain, /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/, 253)), 'ENTERPRISE_CONFIG_INVALID', 'Allowed email domains must be lower-case domain names.');
  const ttl = input.sessionTtlMinutes as number; check(Number.isSafeInteger(ttl) && ttl >= 5 && ttl <= 1440, 'ENTERPRISE_CONFIG_INVALID', 'Session lifetime must be between five minutes and one day.');
  check(absolutePath(input.dataDirectory), 'ENTERPRISE_CONFIG_INVALID', 'The server data directory must be an absolute path.');
  exactKeys(input.workspace, ['directory', 'folder', 'unlock']);
  check(absolutePath(input.workspace.directory), 'ENTERPRISE_CONFIG_INVALID', 'The workspace directory must be an absolute path.');
  check(text(input.workspace.folder, /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/), 'ENTERPRISE_CONFIG_INVALID', 'Use a short workspace folder name.');
  let database: EnterpriseConfig['database'];
  if (input.database !== undefined) {
    exactKeys(input.database, ['caFile'], ['servername']);
    check(absolutePath(input.database.caFile), 'ENTERPRISE_CONFIG_INVALID', 'The database CA certificate must be an absolute file path.');
    check(input.database.servername === undefined || text(input.database.servername, /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/, 253), 'ENTERPRISE_CONFIG_INVALID', 'The database server name must be a host name.');
    database = { caFile: input.database.caFile, ...(input.database.servername ? { servername: input.database.servername } : {}) };
  }
  let unlock: EnterpriseConfig['workspace']['unlock'];
  if (input.workspace.unlock === 'keychain') unlock = 'keychain';
  else { exactKeys(input.workspace.unlock, ['passphraseFile']); check(absolutePath(input.workspace.unlock.passphraseFile), 'ENTERPRISE_CONFIG_INVALID', 'The passphrase must be an absolute file path.'); unlock = { passphraseFile: input.workspace.unlock.passphraseFile }; }
  return {
    listen: { host: input.listen.host, port: input.listen.port }, tls: { certFile: input.tls.certFile, keyFile: input.tls.keyFile }, publicOrigin: input.publicOrigin,
    oidc: { issuer: input.oidc.issuer, clientId: input.oidc.clientId, clientSecretFile: input.oidc.clientSecretFile, redirectPath: input.oidc.redirectPath, scopes: [...input.oidc.scopes] },
    roles: rules, ...(input.allowedEmailDomains ? { allowedEmailDomains: [...input.allowedEmailDomains] } : {}), sessionTtlMinutes: ttl,
    dataDirectory: input.dataDirectory, workspace: { directory: input.workspace.directory, folder: input.workspace.folder, unlock }, ...(database ? { database } : {}),
  };
}

/** Reads a regular, non-symlink file. Private files must not be group or world readable on Unix. */
export async function readPrivateFile(path: string, options: { private: boolean; limit: number; code: string }): Promise<Buffer> {
  let stat; try { stat = await lstat(path); } catch { check(false, options.code, 'A configured file is missing or unreadable.'); }
  check(stat.isFile() && !stat.isSymbolicLink(), options.code, 'A configured file must be a regular file, not a link.');
  check(stat.size > 0 && stat.size <= options.limit, options.code, 'A configured file is empty or too large.');
  if (options.private && process.platform !== 'win32') check((stat.mode & 0o077) === 0, options.code, 'A private file must be readable by its owner only.');
  try { return await readFile(path); } catch { check(false, options.code, 'A configured file is missing or unreadable.'); }
}
/** Secret files hold one value; one trailing line break is removed. */
export async function readSecretFile(path: string): Promise<string> {
  const value = (await readPrivateFile(path, { private: true, limit: SECRET_LIMIT, code: 'ENTERPRISE_SECRET_FILE_INVALID' })).toString('utf8').replace(/\r?\n$/, '');
  check(value.length > 0 && !/[\r\n\0]/.test(value), 'ENTERPRISE_SECRET_FILE_INVALID', 'A secret file must hold one value on one line.');
  return value;
}
export async function readTlsFiles(config: EnterpriseConfig): Promise<{ cert: Buffer; key: Buffer }> {
  const cert = await readPrivateFile(config.tls.certFile, { private: false, limit: 256 * 1024, code: 'TLS_FILE_INVALID' });
  const key = await readPrivateFile(config.tls.keyFile, { private: true, limit: 64 * 1024, code: 'TLS_FILE_INVALID' });
  return { cert, key };
}
export async function loadEnterpriseConfig(path: string | undefined): Promise<EnterpriseConfig> {
  check(typeof path === 'string' && absolutePath(path), 'ENTERPRISE_CONFIG_INVALID', 'Set CHAUSAR_ENTERPRISE_CONFIG to the absolute path of the configuration file.');
  const raw = await readPrivateFile(path, { private: false, limit: CONFIG_LIMIT, code: 'ENTERPRISE_CONFIG_INVALID' });
  let value: unknown; try { value = JSON.parse(raw.toString('utf8')); } catch { check(false, 'ENTERPRISE_CONFIG_INVALID', 'The enterprise configuration is not valid JSON.'); }
  const config = parseEnterpriseConfig(value);
  await readTlsFiles(config); await readSecretFile(config.oidc.clientSecretFile);
  if (config.workspace.unlock !== 'keychain') await readSecretFile(config.workspace.unlock.passphraseFile);
  if (config.database) await readDatabaseCa(config);
  return config;
}
/** The pinned CA for the database connection. Public material, but it must be a regular file holding a PEM certificate. */
export async function readDatabaseCa(config: EnterpriseConfig): Promise<string | undefined> {
  if (!config.database) return undefined;
  const pem = (await readPrivateFile(config.database.caFile, { private: false, limit: 256 * 1024, code: 'POSTGRES_TLS_FILE_INVALID' })).toString('utf8');
  check(/^-----BEGIN CERTIFICATE-----\r?\n/.test(pem), 'POSTGRES_TLS_FILE_INVALID', 'The database CA file must hold a PEM certificate.');
  return pem;
}
