// One-shot C6 task 3 (section 9 idea 29, SCREENS 62 and 159.x1): a client's phone or WhatsApp number.
// The owner's typing is kept as typed; the WhatsApp digits (country code first, no plus) are worked out by code.
// Minimum use: the number only opens WhatsApp for the owner. It is never in what a model reads (CLIENT_AI_FIELDS).
import { check } from '../../portable.ts';

/** Each country Chausar supports (core/countries.ts) and its calling code. XX (elsewhere) needs a number with its +. */
const CALLING_CODES: Readonly<Record<string, string>> = Object.freeze({
  IN: '91', US: '1', GB: '44', CA: '1', AU: '61', NZ: '64', SG: '65', AE: '971', DE: '49', FR: '33', NL: '31', IE: '353', ZA: '27', JP: '81',
});

export const PHONE_REFUSED = 'Use a phone number like 98765 43210, or one that starts with + and the country code.';
const SHAPE = /^\+?[\d\s().-]+$/;

/**
 * The phone as typed (trimmed, one line) and its WhatsApp digits. `country` is the client's country, else the
 * business's. A number that starts with + (or 00) keeps its own country code; otherwise one leading 0 goes and the
 * country's code is put first, unless the number already starts with it at full length. 7 to 15 digits, or refused.
 */
export function clientPhone(raw: unknown, country: string | null): { phone: string; whatsapp: string } {
  check(typeof raw === 'string', 'INVALID_VENTURE_REQUEST', PHONE_REFUSED);
  const phone = raw.trim();
  check(phone.length >= 3 && phone.length <= 40 && SHAPE.test(phone), 'INVALID_VENTURE_REQUEST', PHONE_REFUSED);
  let digits = phone.replace(/\D/g, '');
  const code = country ? CALLING_CODES[country] : undefined;
  if (phone.startsWith('+')) { /* its own code */ }
  else if (digits.startsWith('00')) digits = digits.slice(2);
  else {
    check(code, 'INVALID_VENTURE_REQUEST', PHONE_REFUSED);
    const national = digits.startsWith('0') ? digits.slice(1) : digits;
    // "91 98765 43210" typed in India, or "1 415 555 0100" in the US: the code is already there.
    const hasCode = national.startsWith(code) && national.length - code.length >= 9;
    digits = hasCode ? national : code + national;
  }
  check(digits.length >= 7 && digits.length <= 15 && !digits.startsWith('0'), 'INVALID_VENTURE_REQUEST', PHONE_REFUSED);
  return { phone, whatsapp: digits };
}

/** The wa.me link the owner's WhatsApp opens: to the client's chat when there are digits, else to a chat they pick. */
export function whatsappLink(digits: string | null | undefined, text: string): string {
  const to = typeof digits === 'string' && /^[1-9]\d{6,14}$/.test(digits) ? digits : '';
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}

/** The shape alone, with no country at hand: what the evidence ledger checks before it writes a phone back. */
export function phoneShapeOk(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  return value.trim().length <= 40 && SHAPE.test(value.trim()) && digits.length >= 7 && digits.length <= 17;
}

/**
 * The client fields an AI task may read (the agent's read_client; the chief reads only id and name). Phone and
 * WhatsApp are not here, even for a client who allowed AI (founder decision, 5 Nov): they only open WhatsApp.
 */
export const CLIENT_AI_FIELDS = Object.freeze(['id', 'name', 'email', 'taxId'] as const);
