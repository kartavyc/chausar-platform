import { HostedError, check } from '../shared/errors.ts';
import type { Fetch } from '../shared/module.ts';

/** Sends a sign-in code to a phone. The accounts module never sends SMS any other way. */
export interface OtpProvider {
  readonly id: string;
  send(phoneE164: string, code: string): Promise<void>;
}

export const otpMessage = (code: string) => `Your Chausar sign-in code is ${code}. It expires in five minutes. Do not share it.`;

/** Tests only: records every code instead of sending it. */
export class FakeOtpProvider implements OtpProvider {
  readonly id = 'fake';
  readonly sent: { phone: string; code: string }[] = [];
  async send(phoneE164: string, code: string) { this.sent.push({ phone: phoneE164, code }); }
  last(): string { check(this.sent.length, 'OTP_NOT_SENT', 'No code was sent.', 500); return this.sent[this.sent.length - 1].code; }
}

/** Without SMS credentials sign-in refuses with a typed code rather than pretending to send. */
export class UnconfiguredOtpProvider implements OtpProvider {
  readonly id = 'not-configured';
  async send(): Promise<void> { throw new HostedError('OTP_PROVIDER_NOT_CONFIGURED', 'Sign-in by phone is not set up on this server.', 503); }
}

export type TwilioSettings = { accountSid: string; authToken: string; from: string };
export const isTwilioSid = (value: unknown): value is string => typeof value === 'string' && /^AC[0-9a-f]{32}$/.test(value);

/**
 * Twilio Programmable Messaging. Founder step: SMS to Indian numbers needs the sender and this exact message
 * registered as a DLT template (TRAI) before Indian carriers deliver it; until then codes may be dropped.
 */
export class TwilioSmsOtpProvider implements OtpProvider {
  readonly id = 'twilio';
  readonly #fetch: Fetch; readonly #settings: TwilioSettings;
  constructor(fetch: Fetch, settings: TwilioSettings) {
    check(isTwilioSid(settings.accountSid), 'SERVER_MISCONFIGURED', 'The Twilio account id is not valid.', 500);
    check(typeof settings.authToken === 'string' && /^[A-Za-z0-9]{16,128}$/.test(settings.authToken), 'SERVER_MISCONFIGURED', 'The Twilio token is not valid.', 500);
    check(typeof settings.from === 'string' && /^\+[1-9][0-9]{6,14}$/.test(settings.from), 'SERVER_MISCONFIGURED', 'The Twilio sender number is not valid.', 500);
    this.#fetch = fetch; this.#settings = settings;
  }
  async send(phoneE164: string, code: string): Promise<void> {
    check(/^\+[1-9][0-9]{6,14}$/.test(phoneE164) && /^[0-9]{6}$/.test(code), 'OTP_SEND_FAILED', 'The sign-in code could not be sent.', 500);
    const { accountSid, authToken, from } = this.#settings;
    let status = 0, text = '';
    try {
      const reply = await this.#fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
          'content-type': 'application/x-www-form-urlencoded', accept: 'application/json',
        },
        body: new URLSearchParams({ To: phoneE164, From: from, Body: otpMessage(code) }).toString(),
        signal: AbortSignal.timeout(15000),
      });
      status = reply.status; text = await reply.text();
    } catch { throw new HostedError('OTP_SEND_FAILED', 'The sign-in code could not be sent.', 502); }
    let body: any;
    try { body = JSON.parse(text); } catch { body = undefined; }
    const accepted = (status === 200 || status === 201) && body && typeof body === 'object'
      && typeof body.sid === 'string' && /^(SM|MM)[0-9a-f]{32}$/.test(body.sid)
      && ['accepted', 'queued', 'sending', 'sent', 'scheduled'].includes(body.status);
    check(accepted, 'OTP_SEND_FAILED', 'The sign-in code could not be sent.', 502);
  }
}
