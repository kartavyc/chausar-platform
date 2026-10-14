import { randomInt } from 'node:crypto';
import { isIP } from 'node:net';
import type { Sql } from '../db/sql.ts';
import type { Clock } from '../shared/clock.ts';
import type { Authenticator, EntitlementSource, Principal } from '../shared/auth.ts';
import type { HostedDeps, HostedModule } from '../shared/module.ts';
import { HostedError, check } from '../shared/errors.ts';
import { bearer, fields, json, ok, type HeaderMap, type Router } from '../shared/http.ts';
import { isId, isOpaqueToken, newId, opaqueToken, sameHex, secretHash } from '../shared/crypto.ts';
import type { OtpProvider } from './otp.ts';
import { DEFAULT_OTP_LIMITS, type OtpStartLimits } from './config.ts';

export const OTP_TTL_MS = 5 * 60000;
export const OTP_MAX_WRONG = 5;
export const OTP_LIMITS = [{ windowMs: 15 * 60000, max: 3 }, { windowMs: 60 * 60000, max: 10 }] as const;
export const SESSION_TTL_MS = 30 * 24 * 3600000;
/** Sessions slide: each use at least this long after the last one moves expiry to 30 days from now. */
const TOUCH_MS = 60000;

/** India only: +91 and ten digits starting 6 to 9. */
export const isIndianPhone = (value: unknown): value is string => typeof value === 'string' && /^\+91[6-9][0-9]{9}$/.test(value);
const codeHash = (pepper: string, challengeId: string, code: string) => secretHash(pepper, 'otp', challengeId + code);
const isoOf = (value: Date | string | null) => value === null ? null : new Date(value).toISOString();

/** The client address, only behind a proxy we trust to set x-forwarded-for; its first entry is the client. */
export function clientAddress(headers: HeaderMap, trustProxy: boolean): string | null {
  if (!trustProxy) return null;
  const first = (headers['x-forwarded-for'] ?? '').split(',')[0].trim().toLowerCase();
  return first.length <= 64 && isIP(first) ? first : null;
}

function deviceName(value: unknown): string {
  check(typeof value === 'string', 'INVALID_REQUEST', 'The device name must be text.');
  const name = value.trim();
  check(name.length >= 1 && name.length <= 80 && !/[\u0000-\u001f\u007f]/.test(name), 'DEVICE_NAME_INVALID', 'The device name must be one to eighty characters.');
  return name;
}

/** Turns a Bearer session token into a Principal. Unknown, expired and revoked all refuse alike. */
export function authenticator(sql: Sql, pepper: string, clock: Clock): Authenticator {
  return async request => {
    const token = bearer(request);
    check(isOpaqueToken(token), 'UNAUTHENTICATED', 'Sign in first.', 401);
    const at = clock();
    const { rows: [row] } = await sql.query(
      `SELECT s.id, s.account_id, s.device_id, s.last_seen_at FROM sessions s JOIN devices d ON d.id = s.device_id
       WHERE s.token_hash = $1 AND s.expires_at > $2 AND d.revoked_at IS NULL`, [secretHash(pepper, 'session', token), at.toISOString()]);
    check(row, 'UNAUTHENTICATED', 'Sign in first.', 401);
    if (at.getTime() - new Date(row.last_seen_at).getTime() >= TOUCH_MS) {
      await sql.query('UPDATE sessions SET last_seen_at = $2, expires_at = $3 WHERE id = $1', [row.id, at.toISOString(), new Date(at.getTime() + SESSION_TTL_MS).toISOString()]);
      await sql.query('UPDATE devices SET last_seen_at = $2 WHERE id = $1 AND last_seen_at < $2', [row.device_id, at.toISOString()]);
    }
    const principal: Principal = { accountId: row.account_id, deviceId: row.device_id, sessionId: row.id };
    return principal;
  };
}

type VerifyOutcome = { failed: 'invalid' | 'expired' | 'locked' } | { accountId: string; deviceId: string; sessionToken: string; expiresAt: string };

export function createAccountsModule(deps: HostedDeps, options: { otp: OtpProvider; entitlements: EntitlementSource; limits?: OtpStartLimits }): HostedModule {
  const { sql, clock, pepper } = deps, limits = options.limits ?? DEFAULT_OTP_LIMITS;
  secretHash(pepper, 'check', 'pepper');

  async function start(phone: string, address: string | null): Promise<{ challengeId: string; expiresAt: string }> {
    const at = clock(), id = newId('otp'), code = String(randomInt(0, 1000000)).padStart(6, '0');
    const expiresAt = new Date(at.getTime() + OTP_TTL_MS).toISOString(), hourAgo = new Date(at.getTime() - 60 * 60000).toISOString();
    // Only a keyed hash of the client address is kept, and only as long as the challenge row.
    const clientHash = address === null ? null : secretHash(pepper, 'otp-client', address);
    const limited = await sql.transaction(async (tx): Promise<'server' | 'address' | 'phone' | null> => {
      // One lock for every start: the server-wide, per-address and per-phone counts are decided together. Starts are rare.
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['otp:start']);
      const { rows: [all] } = await tx.query<{ n: number }>('SELECT count(*)::int AS n FROM otp_challenges WHERE created_at > $1', [hourAgo]);
      if (all.n >= limits.globalPerHour) return 'server';
      if (clientHash !== null) {
        const { rows: [mine] } = await tx.query<{ n: number }>('SELECT count(*)::int AS n FROM otp_challenges WHERE client_hash = $1 AND created_at > $2', [clientHash, hourAgo]);
        if (mine.n >= limits.addressPerHour) return 'address';
      }
      for (const limit of OTP_LIMITS) {
        const { rows: [count] } = await tx.query<{ n: number }>('SELECT count(*)::int AS n FROM otp_challenges WHERE phone = $1 AND created_at > $2',
          [phone, new Date(at.getTime() - limit.windowMs).toISOString()]);
        if (count.n >= limit.max) return 'phone';
      }
      await tx.query('INSERT INTO otp_challenges (id, phone, code_hash, client_hash, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6)',
        [id, phone, codeHash(pepper, id, code), clientHash, at.toISOString(), expiresAt]);
      return null;
    });
    check(limited !== 'phone', 'OTP_RATE_LIMITED', 'Too many codes were asked for this number. Try again later.', 429);
    check(limited === null, 'OTP_RATE_LIMITED', 'Too many sign-in codes were asked for. Try again later.', 429);
    // Sent after the row commits: a failed send still counts toward the limits, so retries cannot flood a number.
    await options.otp.send(phone, code);
    return { challengeId: id, expiresAt };
  }

  async function verify(challengeId: string, code: string, name: string): Promise<VerifyOutcome> {
    return sql.transaction(async (tx): Promise<VerifyOutcome> => {
      const at = clock();
      const { rows: [challenge] } = await tx.query('SELECT id, phone, code_hash, wrong_tries, expires_at, used_at FROM otp_challenges WHERE id = $1 FOR UPDATE', [challengeId]);
      if (!challenge || challenge.used_at) return { failed: 'invalid' };
      if (challenge.wrong_tries >= OTP_MAX_WRONG) return { failed: 'locked' };
      if (new Date(challenge.expires_at).getTime() <= at.getTime()) return { failed: 'expired' };
      if (!sameHex(codeHash(pepper, challengeId, code), challenge.code_hash)) {
        await tx.query('UPDATE otp_challenges SET wrong_tries = wrong_tries + 1 WHERE id = $1', [challengeId]);
        return { failed: 'invalid' };
      }
      await tx.query('UPDATE otp_challenges SET used_at = $2 WHERE id = $1', [challengeId, at.toISOString()]);
      const { rows: [account] } = await tx.query<{ id: string }>(
        'INSERT INTO accounts (id, phone, created_at) VALUES ($1, $2, $3) ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone RETURNING id',
        [newId('acct'), challenge.phone, at.toISOString()]);
      const deviceId = newId('dev'), sessionToken = opaqueToken(), expiresAt = new Date(at.getTime() + SESSION_TTL_MS).toISOString();
      await tx.query('INSERT INTO devices (id, account_id, device_name, created_at, last_seen_at) VALUES ($1, $2, $3, $4, $4)', [deviceId, account.id, name, at.toISOString()]);
      await tx.query('INSERT INTO sessions (id, token_hash, account_id, device_id, created_at, last_seen_at, expires_at) VALUES ($1, $2, $3, $4, $5, $5, $6)',
        [newId('sess'), secretHash(pepper, 'session', sessionToken), account.id, deviceId, at.toISOString(), expiresAt]);
      return { accountId: account.id, deviceId, sessionToken, expiresAt };
    });
  }

  return {
    id: 'accounts',
    routes(router: Router) {
      router.add('POST', '/v1/accounts/otp/start', async request => {
        const body = fields<{ phone: unknown }>(json(request), ['phone']);
        check(isIndianPhone(body.phone), 'INVALID_PHONE', 'Enter an Indian mobile number as +91 and ten digits.');
        return ok(await start(body.phone, clientAddress(request.headers, limits.trustProxy)), 202);
      }, { maxBody: 4096 });

      router.add('POST', '/v1/accounts/otp/verify', async request => {
        const body = fields<{ challengeId: unknown; code: unknown; deviceName: unknown }>(json(request), ['challengeId', 'code', 'deviceName']);
        const name = deviceName(body.deviceName);
        check(typeof body.code === 'string' && /^[0-9]{6}$/.test(body.code), 'OTP_INVALID', 'The code is not right.', 401);
        check(isId(body.challengeId, 'otp'), 'OTP_INVALID', 'The code is not right.', 401);
        const result = await verify(body.challengeId, body.code, name);
        if ('failed' in result) {
          if (result.failed === 'expired') throw new HostedError('OTP_EXPIRED', 'The code has expired. Ask for a new one.', 410);
          if (result.failed === 'locked') throw new HostedError('OTP_LOCKED', 'Too many wrong codes. Ask for a new one.', 429);
          throw new HostedError('OTP_INVALID', 'The code is not right.', 401);
        }
        return ok(result);
      }, { maxBody: 4096 });

      router.add('GET', '/v1/accounts/me', async request => {
        const principal = await deps.authenticate(request);
        const { rows: [account] } = await sql.query('SELECT id, phone FROM accounts WHERE id = $1', [principal.accountId]);
        check(account, 'UNAUTHENTICATED', 'Sign in first.', 401);
        const { rows: devices } = await sql.query('SELECT id, device_name, created_at, last_seen_at FROM devices WHERE account_id = $1 AND revoked_at IS NULL ORDER BY created_at, id', [principal.accountId]);
        const entitlements = await options.entitlements(principal.accountId);
        return ok({
          accountId: account.id, phone: account.phone, plan: entitlements.plan, entitlements,
          devices: devices.map(d => ({ deviceId: d.id, deviceName: d.device_name, createdAt: isoOf(d.created_at), lastSeenAt: isoOf(d.last_seen_at), current: d.id === principal.deviceId })),
        });
      });

      router.add('POST', '/v1/accounts/devices/:deviceId/revoke', async request => {
        const principal = await deps.authenticate(request);
        fields(json(request), []);
        const deviceId = request.params.deviceId;
        check(isId(deviceId, 'dev'), 'DEVICE_NOT_FOUND', 'No such device on this account.', 404);
        const revokedAt = await sql.transaction(async tx => {
          const { rows: [device] } = await tx.query('SELECT revoked_at FROM devices WHERE id = $1 AND account_id = $2 FOR UPDATE', [deviceId, principal.accountId]);
          check(device, 'DEVICE_NOT_FOUND', 'No such device on this account.', 404);
          const at = device.revoked_at ? isoOf(device.revoked_at)! : clock().toISOString();
          if (!device.revoked_at) await tx.query('UPDATE devices SET revoked_at = $2 WHERE id = $1', [deviceId, at]);
          await tx.query('DELETE FROM sessions WHERE device_id = $1', [deviceId]);
          return at;
        });
        return ok({ deviceId, revokedAt });
      }, { maxBody: 1024 });
    },
    /** Challenges older than the longest rate window, and expired sessions. */
    async sweep() {
      const at = clock().getTime();
      await sql.query('DELETE FROM otp_challenges WHERE created_at <= $1', [new Date(at - OTP_LIMITS[1].windowMs).toISOString()]);
      await sql.query('DELETE FROM sessions WHERE expires_at <= $1', [new Date(at).toISOString()]);
    },
  };
}
