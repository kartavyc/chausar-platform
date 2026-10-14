import { check } from '../shared/errors.ts';
import type { Env, Fetch } from '../shared/module.ts';
import { TwilioSmsOtpProvider, UnconfiguredOtpProvider, type OtpProvider } from './otp.ts';

/**
 * TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM: all three or none. With none, phone sign-in refuses with
 * OTP_PROVIDER_NOT_CONFIGURED. A partial set is a deployment mistake and stops the server at start.
 */
export function accountsConfig(env: Env, fetch: Fetch): { otp: OtpProvider; otpState: 'configured' | 'not-configured' } {
  const accountSid = env.TWILIO_ACCOUNT_SID?.trim() || undefined, authToken = env.TWILIO_AUTH_TOKEN?.trim() || undefined, from = env.TWILIO_FROM?.trim() || undefined;
  const given = [accountSid, authToken, from].filter(Boolean).length;
  if (given === 0) return { otp: new UnconfiguredOtpProvider(), otpState: 'not-configured' };
  check(given === 3, 'SERVER_MISCONFIGURED', 'Set all three Twilio settings or none.', 500);
  return { otp: new TwilioSmsOtpProvider(fetch, { accountSid: accountSid!, authToken: authToken!, from: from! }), otpState: 'configured' };
}
