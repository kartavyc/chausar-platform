import { check } from '../shared/errors.ts';
import type { Env, Fetch } from '../shared/module.ts';
import { TwilioSmsOtpProvider, UnconfiguredOtpProvider, type OtpProvider } from './otp.ts';

/** Server-wide limits on OTP starts, on top of the per-phone ones. `trustProxy` says x-forwarded-for comes from our own proxy. */
export type OtpStartLimits = { globalPerHour: number; addressPerHour: number; trustProxy: boolean };
export const DEFAULT_OTP_LIMITS: OtpStartLimits = Object.freeze({ globalPerHour: 300, addressPerHour: 20, trustProxy: false });

/**
 * TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM: all three or none. With none, phone sign-in refuses with
 * OTP_PROVIDER_NOT_CONFIGURED. A partial set is a deployment mistake and stops the server at start.
 * OTP_GLOBAL_PER_HOUR (default 300) and OTP_ADDRESS_PER_HOUR (default 20) cap codes sent per hour across the server and
 * per client address. TRUST_PROXY=1 says the TLS proxy sets x-forwarded-for; without it the per-address limit is skipped.
 */
export function accountsConfig(env: Env, fetch: Fetch): { otp: OtpProvider; otpState: 'configured' | 'not-configured'; limits: OtpStartLimits } {
  const count = (name: string, fallback: number) => {
    const value = env[name]?.trim();
    if (!value) return fallback;
    check(/^[1-9][0-9]{0,6}$/.test(value), 'SERVER_MISCONFIGURED', `${name} must be a whole number above zero.`, 500);
    return Number(value);
  };
  const proxy = env.TRUST_PROXY?.trim() || '0';
  check(proxy === '0' || proxy === '1', 'SERVER_MISCONFIGURED', 'TRUST_PROXY must be 1 or 0.', 500);
  const limits: OtpStartLimits = { globalPerHour: count('OTP_GLOBAL_PER_HOUR', DEFAULT_OTP_LIMITS.globalPerHour), addressPerHour: count('OTP_ADDRESS_PER_HOUR', DEFAULT_OTP_LIMITS.addressPerHour), trustProxy: proxy === '1' };
  const accountSid = env.TWILIO_ACCOUNT_SID?.trim() || undefined, authToken = env.TWILIO_AUTH_TOKEN?.trim() || undefined, from = env.TWILIO_FROM?.trim() || undefined;
  const given = [accountSid, authToken, from].filter(Boolean).length;
  if (given === 0) return { otp: new UnconfiguredOtpProvider(), otpState: 'not-configured', limits };
  check(given === 3, 'SERVER_MISCONFIGURED', 'Set all three Twilio settings or none.', 500);
  return { otp: new TwilioSmsOtpProvider(fetch, { accountSid: accountSid!, authToken: authToken!, from: from! }), otpState: 'configured', limits };
}
