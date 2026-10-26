// Chausar venture launcher, core: the secret screen (catalogue H17). Text that is sent to a model, kept as a call's
// trace, written to the journal, the evidence ledger or a share link passes through here first. These become
// "[redacted secret]": known key shapes (sk-, sk-ant-, ghp_, AKIA, xoxb-, AIza, JWTs, private key blocks and similar),
// a value typed after a secret name (password=, apiKey:, DB_PASSWORD=, JWT_SECRET=, any _SECRET, _TOKEN or _KEY), a
// Bearer value, and long random-looking strings (20 or more characters mixing lower case, upper case and digits, or
// hex of 32 or more). Web addresses lose their user info and secret-looking query and fragment values; their path is
// checked only for key prefixes and on the few hosts that carry a secret in the path (Slack, Telegram and Discord
// webhooks), so profile, map, file and post links stay whole. Browser read-backs are also screened for card numbers
// (Luhn), Aadhaar numbers (Verhoeff), bank accounts beside an IFSC, OTPs and PAN.
// Kept on purpose: hashtags and handles, promo codes, invoice numbers, payment and object ids (pay_, pi_, cus_,
// order_, inv_ and similar), file names before their extension, record ids, Chausar's own digests as whole tokens and
// ids after a label such as trace_id, and stand-ins whose whole tail is a placeholder (<your-key>, ${API_KEY}, xxxx).
// What it cannot catch, said plainly: keys split into chunks under 16 characters can pass, and so can a key with no
// known prefix that uses only lower case and digits, or only capitals and digits. The screen only removes: it never
// adds a value, and it never says what it removed beyond the kind.
// The prefix list, the entropy test and the URL rules follow the scanners surveyed in the 2026-10-21 harvest (jevgrep
// secrets.ts, JobOS browser-url-policy, OpenGCUA action_journal.py); this is a rewrite in TypeScript, not a copy.

export const REDACTED = '[redacted secret]';

type Found = string[] | undefined;
type Rule = { kind: string; pattern: RegExp };

/** Key shapes with a known prefix. Order matters only for overlaps: the first rule that matches redacts the span. */
const PREFIX_RULES: readonly Rule[] = Object.freeze([
  { kind: 'private-key', pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g },
  { kind: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { kind: 'anthropic', pattern: /\bsk-ant-[A-Za-z0-9_-]{8,}/g },
  { kind: 'openai', pattern: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/g },
  { kind: 'stripe', pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}/g },
  { kind: 'razorpay', pattern: /\brzp_(?:live|test)_[A-Za-z0-9]{10,}/g },
  { kind: 'github', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g },
  { kind: 'gitlab', pattern: /\bglpat-[A-Za-z0-9_-]{20,}/g },
  { kind: 'aws', pattern: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA)[A-Z0-9]{16}\b/g },
  { kind: 'slack', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { kind: 'google', pattern: /\bAIza[0-9A-Za-z_-]{30,}/g },
  { kind: 'google-oauth', pattern: /\bya29\.[0-9A-Za-z_-]{20,}/g },
  { kind: 'huggingface', pattern: /\bhf_[A-Za-z0-9]{30,}/g },
  { kind: 'npm', pattern: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { kind: 'sendgrid', pattern: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g },
]);
/** The literal start of each known key shape, so a stand-in can be judged by its tail alone. */
const KNOWN_PREFIX = /^(?:sk-ant-(?:api\d\d-|admin\d\d-)?|sk-(?:proj-|svcacct-|admin-)?|(?:sk|rk|rzp)_(?:live|test)_|gh[pousr]_|github_pat_|glpat-|(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA)|xox[abposr]-|AIza|ya29\.|hf_|npm_|SG\.|eyJ)/;

const SECRET_WORD = '(?:api[_-]?key|secret[_-]?key|client[_-]?secret|access[_-]?token|auth[_-]?token|refresh[_-]?token|password|passwd|pwd|passphrase|private[_-]?key)';
/**
 * A value typed after a name that always holds a secret: password=..., "apiKey": "...", client_secret: ..., and
 * environment names in capitals (DB_PASSWORD=, JWT_SECRET=, SESSION_SECRET=, API_KEY=) or any name ending in _SECRET,
 * _TOKEN or _KEY.
 */
const ASSIGNED = new RegExp(`\\b((?:[A-Za-z0-9]+_)*${SECRET_WORD}|(?:[A-Za-z0-9]+_)+(?:secret|token|key))\\b(["']?\\s*[:=]\\s*["']?)([^\\s"',;&]{4,})`, 'gi');
/** Bearer and Basic header values; the value must hold a digit, so "Bearer authentication" stays. */
const BEARER = /\b(Bearer|Basic)(\s+)(?=[A-Za-z0-9._~+/=-]*\d)([A-Za-z0-9._~+/=-]{12,})/gi;
/** Candidates for the entropy test: runs of base64 and base64url characters, 20 or more. */
const TOKEN = /[A-Za-z0-9+/_-]{20,}={0,2}/g;
const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>"'`]+/gi;
const UUID_ANY = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
/** sha1, sha256 and sha512 in lower-case hex as a whole token: the digests Chausar itself writes everywhere. Never 0x... */
const DIGEST_ANY = /(?<![A-Za-z0-9_])(?:[0-9a-f]{128}|[0-9a-f]{64}|[0-9a-f]{40})(?![A-Za-z0-9_])/g;
/** Text just before a token that names it as a secret: "webhook secret: ", "signing key = ". */
const SECRET_NAME_BEFORE = /(?:secret|token|key|password|passwd|pwd|passphrase|signature|salt|credential)s?["']?\s*[:=]?\s*["']?$/i;
/** Text just before a token that names it as an id: "trace_id ", "request-id=", "commit ". */
const ID_LABEL_BEFORE = /\b(?:trace|span|request|req|correlation|run|job|message|msg|event|build|object|record|order|invoice|payment|transaction|txn|file|upload|device)[_ -]?id["']?\s*[:=]?\s*["']?$/i;
/** Payment and object ids that name a thing, not a credential: pay_..., pi_..., cus_..., order_..., inv_... */
const OBJECT_ID = /^(?:pay|pi|pm|ch|cus|order|inv|in|sub|si|price|prod|plan|evt|txn|acct|seti|re|rfnd|plink|po|qr|setl)_[A-Za-z0-9]+$/;
/** A file name runs on to its extension. */
const FILE_EXTENSION = /^\.(?:json|pdf|csv|xlsx?|docx?|pptx?|txt|md|png|jpe?g|gif|webp|svg|mp4|mov|mp3|wav|m4a|srt|vtt|zip|xml|html?|ics|vcf)\b/i;

/**
 * A stand-in, not a key: wrapped in <...>, ${...} or {{...}}, or with a tail (after any known prefix) made only of x,
 * X or * (sk-ant-xxxx, ********). A tail that merely contains a word such as "your" or "HERE" is not a stand-in.
 */
function standIn(value: string, whole: string, offset: number): boolean {
  if (whole[offset - 1] === '<' && whole[offset + value.length] === '>') return true;
  if (/^<[^<>]*>$|^\$\{[^{}]*\}$|^\{\{[^{}]*\}\}$/.test(value) || value.startsWith('[')) return true;
  return /^[xX*._-]*[xX*][xX*._-]*$/.test(value.replace(KNOWN_PREFIX, ''));
}

function shannon(text: string): number {
  const counts = new Map<string, number>();
  for (const char of text) counts.set(char, (counts.get(char) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) bits -= (count / text.length) * Math.log2(count / text.length);
  return bits;
}

/** How often a run of letters and digits changes between lower case, upper case and digit. Separators reset it. */
function classSwitches(text: string): number {
  let switches = 0;
  let previous: string | null = null;
  for (const char of text) {
    const kind = char >= 'a' && char <= 'z' ? 'l' : char >= 'A' && char <= 'Z' ? 'u' : char >= '0' && char <= '9' ? 'd' : null;
    if (kind !== null && previous !== null && kind !== previous) switches += 1;
    previous = kind;
  }
  return switches;
}

/**
 * A long random-looking string. Either 20 or more characters with lower case, upper case and digits, entropy of at
 * least 3 bits a character, and the three interleaved the way generated keys are (at least a third of the characters
 * change class), so names like claude-sonnet-5-5, Diwali2026SpecialsOffer or INV/2026-27/0001 stay; or hex of 32 or
 * more characters (0x allowed). Promo codes (capitals and digits) never qualify. Record ids (a UUID) and whole-token
 * digests inside it are set aside first, unless `named` says a secret name stands right before it.
 */
export function secretLike(token: string, named = false): boolean {
  let core = token.replace(/=+$/, '').replace(UUID_ANY, ' ');
  if (!named) core = core.replace(DIGEST_ANY, ' ');
  return core.split(' ').some(raw => {
    const piece = raw.replace(/^[-_/+]+|[-_/+]+$/g, '');
    if (piece.length < 20 || !/\d/.test(piece) || !/[A-Za-z]/.test(piece) || shannon(piece) < 3) return false;
    if (piece.length >= 32 && /^(?:0x)?[0-9a-f]+$/i.test(piece)) return true;
    if (!/[a-z]/.test(piece) || !/[A-Z]/.test(piece)) return false;
    return classSwitches(piece) >= Math.max(6, Math.floor(piece.length / 3));
  });
}

/** Tokens kept whatever they look like: hashtags, handles, object ids, file names and ids after an id label. */
function keptToken(match: string, offset: number, whole: string, before: string): boolean {
  if (whole[offset - 1] === '#' || whole[offset - 1] === '@') return true;
  return OBJECT_ID.test(match) || FILE_EXTENSION.test(whole.slice(offset + match.length)) || ID_LABEL_BEFORE.test(before);
}

/** The known key prefixes only. Web address paths get this and nothing more. */
function screenPrefixes(text: string, found: Found): string {
  let out = text;
  for (const rule of PREFIX_RULES) {
    out = out.replace(rule.pattern, (match: string, ...rest: unknown[]) => {
      if (standIn(match, rest[rest.length - 1] as string, rest[rest.length - 2] as number)) return match;
      found?.push(rule.kind);
      return REDACTED;
    });
  }
  return out;
}

/** The rules for text that is not a web address, in order: prefixes, named values, Bearer values, then entropy. */
function screenPlain(text: string, found: Found): string {
  let out = screenPrefixes(text, found);
  out = out.replace(ASSIGNED, (match: string, name: string, joint: string, value: string, offset: number, whole: string) => {
    if (standIn(value, whole, offset + name.length + joint.length)) return match;
    found?.push('named-secret');
    return `${name}${joint}${REDACTED}`;
  });
  out = out.replace(BEARER, (match: string, word: string, space: string, value: string, offset: number, whole: string) => {
    if (standIn(value, whole, offset + word.length + space.length)) return match;
    found?.push('bearer');
    return `${word}${space}${REDACTED}`;
  });
  out = out.replace(TOKEN, (match: string, offset: number, whole: string) => {
    const before = whole.slice(Math.max(0, offset - 48), offset);
    if (keptToken(match, offset, whole, before) || !secretLike(match, SECRET_NAME_BEFORE.test(before))) return match;
    found?.push('high-entropy');
    return REDACTED;
  });
  return out;
}

/** Query and fragment names whose value is a secret whenever it is six characters or longer. */
const SECRET_PARAMS = new Set([
  'token', 'accesstoken', 'refreshtoken', 'idtoken', 'authtoken', 'sessiontoken', 'securitytoken', 'xamzsecuritytoken', 'privatetoken', 'csrftoken',
  'code', 'authcode', 'key', 'apikey', 'secret', 'clientsecret', 'password', 'passwd', 'pass', 'pwd', 'sig', 'signature', 'xamzsignature',
  'xamzcredential', 'auth', 'authorization', 'session', 'sessionid', 'sid', 'jwt', 'credential', 'otp',
]);
const normalName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

function decode(text: string): string {
  try { return decodeURIComponent(text.replace(/\+/g, ' ')); } catch { return text; }
}

/** One query or fragment string with secret values replaced, or null when nothing in it is a secret. */
function screenParams(raw: string, found: Found): string | null {
  if (!raw) return null;
  let changed = false;
  const parts = raw.split('&').map(part => {
    const cut = part.indexOf('=');
    const name = cut < 0 ? '' : decode(part.slice(0, cut));
    const value = decode(cut < 0 ? part : part.slice(cut + 1));
    const named = SECRET_PARAMS.has(normalName(name)) && value.length >= 6 && !value.startsWith('[');
    if (!named && screenPlain(value, undefined) === value) return part;
    changed = true;
    found?.push('url-secret');
    return cut < 0 ? encodeURIComponent(REDACTED) : `${part.slice(0, cut)}=${encodeURIComponent(REDACTED)}`;
  });
  return changed ? parts.join('&') : null;
}

/** The last path part that is not empty: where Slack keeps a webhook's secret. */
const lastPart = (segments: string[]) => {
  const filled = segments.flatMap((segment, index) => (segment ? [index] : []));
  return filled.length >= 2 ? [filled[filled.length - 1]] : [];
};
/** The part two after "webhooks": where Discord keeps a webhook's token. */
const afterWebhooks = (segments: string[]) => {
  const at = segments.indexOf('webhooks');
  return at >= 0 && segments[at + 2] ? [at + 2] : [];
};
/** Hosts that carry a secret in the path, and which path parts hold it. */
const PATH_SECRET_HOSTS: Readonly<Record<string, (segments: string[]) => number[]>> = Object.freeze({
  'hooks.slack.com': lastPart,
  'api.telegram.org': (segments: string[]) => segments.flatMap((segment, index) => (/^bot\d+:/.test(decode(segment)) ? [index] : [])),
  'discord.com': afterWebhooks, 'discordapp.com': afterWebhooks, 'ptb.discord.com': afterWebhooks, 'canary.discord.com': afterWebhooks,
});

function screenUrl(text: string, found: Found): string {
  let url: URL;
  try { url = new URL(text); } catch { return screenPlain(text, found); }
  let changed = false;
  if (url.username || url.password) {
    url.username = '';
    url.password = '';
    changed = true;
    found?.push('url-credentials');
  }
  const segments = url.pathname.split('/');
  const held = new Set(PATH_SECRET_HOSTS[url.hostname.toLowerCase()]?.(segments) ?? []);
  const path = segments.map((segment, index) => (segment && (held.has(index) || screenPrefixes(decode(segment), undefined) !== decode(segment)) ? encodeURIComponent(REDACTED) : segment));
  if (path.some((segment, index) => segment !== segments[index])) {
    url.pathname = path.join('/');
    changed = true;
    found?.push('url-secret');
  }
  const search = screenParams(url.search.slice(1), found);
  if (search !== null) { url.search = search; changed = true; }
  const hash = screenParams(url.hash.slice(1), found);
  if (hash !== null) { url.hash = hash; changed = true; }
  return changed ? url.href : text;
}

/** Runs the whole screen over one text, web addresses first, and lists the kinds it removed in `found`. */
function screen(text: string, found: Found): string {
  let out = '';
  let last = 0;
  for (const match of text.matchAll(URL_IN_TEXT)) {
    out += screenPlain(text.slice(last, match.index), found) + screenUrl(match[0], found);
    last = match.index + match[0].length;
  }
  return out + screenPlain(text.slice(last), found);
}

/** The text with every secret it holds replaced by "[redacted secret]". Text without one comes back unchanged. */
export function redactSecrets(text: string): string {
  if (typeof text !== 'string' || text === '') return text;
  return screen(text, undefined);
}

/** The kinds of secret a text holds (never the values), for checks and traces. Empty when it holds none. */
export function secretFindings(text: string): string[] {
  const found: string[] = [];
  if (typeof text === 'string' && text !== '') screen(text, found);
  return found;
}

/** A web address without user info or secret-looking query, fragment and path parts; other text goes through the screen. */
export function redactUrl(url: string): string {
  if (typeof url !== 'string' || url === '') return url;
  return /^https?:\/\//i.test(url) && !/\s/.test(url) ? screenUrl(url, undefined) : screen(url, undefined);
}

/** Object keys whose value is always a secret, whatever it looks like. "pin" is left out: in India it is a postal code. */
const SECRET_KEY = /(?:password|passwd|passphrase|secret|apikey|accesskey|privatekey|signingkey|token|authorization|cookie|credentials?|sessionid|otp)$|^(?:pwd|auth|bearer|jwt)$/;
/** A value under a secret key that is redacted: any text, number, flag or big number. Null and empty text stay. */
const secretValue = (item: unknown) =>
  item !== '' && (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean' || typeof item === 'bigint');

/**
 * A copy of a JSON-like value with every secret removed: any text, number or flag under a secret-named key becomes
 * "[redacted secret]", every other text goes through the screen, and a date becomes its ISO text. Keys and the
 * original value are left as they are.
 */
export function redactPayload<T>(value: T): T {
  if (typeof value === 'string') return redactSecrets(value) as T;
  if (value instanceof Date) return (Number.isNaN(value.getTime()) ? null : value.toISOString()) as T;
  if (Array.isArray(value)) return value.map(item => redactPayload(item)) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key, SECRET_KEY.test(normalName(key)) && secretValue(item) ? REDACTED : redactPayload(item),
    ])) as T;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Browser read-backs
// ---------------------------------------------------------------------------

export type ReadbackKind = 'secret' | 'card' | 'aadhaar' | 'bank-account' | 'otp' | 'pan';

/** The Luhn check card numbers carry. */
export function luhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    let digit = digits.charCodeAt(digits.length - 1 - index) - 48;
    if (index % 2 === 1) { digit *= 2; if (digit > 9) digit -= 9; }
    sum += digit;
  }
  return sum % 10 === 0;
}

const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6], [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1], [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2], [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 7, 6, 8, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1], [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

/** The Verhoeff check Aadhaar numbers carry. */
export function verhoeffValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let check = 0;
  for (let index = 0; index < digits.length; index += 1) {
    check = VERHOEFF_D[check][VERHOEFF_P[index % 8][digits.charCodeAt(digits.length - 1 - index) - 48]];
  }
  return check === 0;
}

const CARD = /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g;
const AADHAAR = /(?<!\d)[2-9]\d{3}([ -]?)\d{4}\1\d{4}(?!\d)/g;
const IFSC = /\b[A-Z]{4}0[A-Z0-9]{6}\b/g;
const ACCOUNT = /(?<!\d)\d{9,18}(?!\d)/g;
const OTP_LABEL = '(?:otp|one[- ]time (?:password|code|pin)|verification code|security code|passcode|login code)';
/** An OTP after its label: "Your OTP is 482913", "Verification code: 5521". */
const OTP = new RegExp(`\\b(${OTP_LABEL}|code is)\\b([^0-9\\n]{0,20}?)(\\d{4,8})(?!\\d)`, 'gi');
/** An OTP before its label: "482913 is your OTP", "Use 4829 as your one time password". */
const OTP_FIRST = new RegExp(`(?<!\\d)(\\d{4,8})(\\s+(?:is|as)\\s+(?:your|the)\\s+${OTP_LABEL})\\b`, 'gi');
const PAN = /\b[A-Z]{3}[ABCFGHJLPT][A-Z]\d{4}[A-Z]\b/g;
/** A year: after a bare "code is" it names a promo code or an edition, not a one-time code. */
const YEAR = /^(?:19|20)\d\d$/;
/** How close, in characters, an account number must sit to an IFSC to count as a bank account. */
const ACCOUNT_REACH = 80;
/**
 * Words that mark a twelve-digit number as an Aadhaar number, and how close they must sit (before it, or just after).
 * About one random twelve-digit number in ten passes Verhoeff, so a bank reference needs a label to count as one.
 */
const AADHAAR_LABEL = /aadh?aa?r|\buid(?:ai)?\b|आधार/i;
const AADHAAR_BEFORE = 60;
const AADHAAR_AFTER = 30;

/**
 * What a browser page read back may hold that must never be kept or sent on: keys and tokens, card numbers that pass
 * Luhn, Aadhaar numbers that pass Verhoeff beside an Aadhaar label, account numbers beside an IFSC, OTPs beside their
 * label (before or after it), and PAN. Returns the screened text and the kinds found. A number that fails its check
 * digit, or has no label, is left alone. keep: id kinds the caller's work needs (a CA firm keeps the PAN); a key or
 * token is never kept. The untrusted screen (policy/untrusted.ts) uses this same rule set.
 */
export function screenReadback(text: string, options: { keep?: readonly Exclude<ReadbackKind, 'secret'>[] } = {}): { text: string; found: ReadbackKind[] } {
  const found = new Set<ReadbackKind>();
  const keep = new Set<ReadbackKind>(options.keep ?? []);
  const secrets: string[] = [];
  let out = screen(String(text ?? ''), secrets);
  if (secrets.length) found.add('secret');
  if (!keep.has('card')) out = out.replace(CARD, match => {
    const digits = match.replace(/[ -]/g, '');
    if (digits.length < 13 || digits.length > 19 || !luhnValid(digits)) return match;
    found.add('card');
    return '[redacted card number]';
  });
  if (!keep.has('aadhaar')) out = out.replace(AADHAAR, (match: string, _gap: string, offset: number, whole: string) => {
    if (!verhoeffValid(match.replace(/[ -]/g, ''))) return match;
    if (!AADHAAR_LABEL.test(whole.slice(Math.max(0, offset - AADHAAR_BEFORE), offset + match.length + AADHAAR_AFTER))) return match;
    found.add('aadhaar');
    return '[redacted Aadhaar number]';
  });
  const branches = keep.has('bank-account') ? [] : [...out.matchAll(IFSC)].map(match => ({ start: match.index, end: match.index + match[0].length }));
  if (branches.length) {
    out = out.replace(ACCOUNT, (match: string, offset: number) => {
      const near = branches.some(branch => Math.max(branch.start - (offset + match.length), offset - branch.end) <= ACCOUNT_REACH);
      if (!near) return match;
      found.add('bank-account');
      return '[redacted bank account]';
    });
  }
  if (!keep.has('otp')) {
    out = out.replace(OTP, (match: string, label: string, between: string, code: string) => {
      // A year after a bare "code is" ("The promo code is 2025") is not a one-time code.
      if (/^code is$/i.test(label) && YEAR.test(code)) return match;
      found.add('otp');
      return `${label}${between}[redacted OTP]`;
    });
    out = out.replace(OTP_FIRST, (_match: string, _code: string, label: string) => {
      found.add('otp');
      return `[redacted OTP]${label}`;
    });
  }
  if (!keep.has('pan')) out = out.replace(PAN, () => {
    found.add('pan');
    return '[redacted PAN]';
  });
  out = secondLook(out, keep, found);
  return { text: out, found: [...found] };
}

// ---------------------------------------------------------------------------
// The second look: numbers written to slip past the rules above (Ink v2 wave 4 review of 4B1)
// ---------------------------------------------------------------------------

/** Taken out of the copy the second look reads: format characters (zero-width spaces, joiners, bidi marks, tags) and the soft hyphen. */
const INVISIBLE = /[\p{Cf}\u00AD]/u;
const ANY_DIGIT = /\p{Nd}/u;
const digitValues = new Map<number, string>();

/** A digit of any script as 0 to 9. Every run of decimal digits in Unicode starts at a zero, so its place in the run is its value. */
function asciiDigit(char: string): string {
  const code = char.codePointAt(0)!;
  const known = digitValues.get(code);
  if (known !== undefined) return known;
  let start = code;
  while (start > 0 && ANY_DIGIT.test(String.fromCodePoint(start - 1))) start -= 1;
  const value = String((code - start) % 10);
  digitValues.set(code, value);
  return value;
}

/**
 * The text as the second look reads it: format characters and soft hyphens taken out and every digit, in any script,
 * written 0 to 9. A card number split by zero-width spaces or written in Devanagari digits reads as one here. Used by
 * the chat's own checks (agents) as well.
 */
export function digitCopy(text: string): string {
  return lookCopy(text).copy;
}

/** The copy, and for each of its code units the place in the text it came from. */
function lookCopy(text: string): { copy: string; from: number[] } {
  let copy = '';
  const from: number[] = [];
  let at = 0;
  for (const char of text) {
    if (!INVISIBLE.test(char)) {
      const kept = ANY_DIGIT.test(char) ? asciiDigit(char) : char;
      copy += kept;
      for (let unit = 0; unit < kept.length; unit += 1) from.push(at + unit);
    }
    at += char.length;
  }
  return { copy, from };
}

/** Up to two spaces (any kind), dots, slashes or dashes between digits. */
const GAP = '[\\s./-]{0,2}';
/** A card written in groups with any of those between them: 4-4-4-x, and the 4-6-5 of American Express. */
const LOOSE_CARDS: readonly RegExp[] = [
  new RegExp(`(?<!\\d)\\d{4}(?:[\\s./-]{1,2}\\d{4}){2}[\\s./-]{1,2}\\d{1,7}(?!\\d)`, 'g'),
  new RegExp(`(?<!\\d)\\d{4}[\\s./-]{1,2}\\d{6}[\\s./-]{1,2}\\d{4,5}(?!\\d)`, 'g'),
  CARD,
];
/** A card number after its label ("my card number is ..."): a card even when its check digit fails. */
const LABELLED_CARD = new RegExp(`(?:\\b(?:my|the|our|your|his|her|their|client'?s?|customer'?s?|debit|credit|atm|visa|master ?card|rupay)\\s+card\\b(?:\\s+(?:number|no\\.?|num|#))?|\\bcard\\s+(?:number|no\\.?|num|#)|कार्ड\\s+(?:नंबर|संख्या))[^\\d\\n]{0,24}?(\\d(?:${GAP}\\d){12,18})(?!\\d)`, 'gi');
/** Twelve digits in three groups of four, not the tail of a longer number: with an Aadhaar label close by, an Aadhaar number even when its check digit fails. */
const LOOSE_AADHAAR = new RegExp(`(?<!\\d${GAP})\\d{4}${GAP}\\d{4}${GAP}\\d{4}(?!${GAP}\\d)`, 'g');
/** How close an Aadhaar label must sit to a number the second look reads, on the same line: before it, or just after. */
const LOOSE_LABEL_BEFORE = 30;
const LOOSE_LABEL_AFTER = 15;
/** What the first pass wrote in place of what it took out: blanked before the second look reads labels, so "[redacted Aadhaar number]" is never a label. */
const MARKER = /\[redacted [^\]\n]*\]/g;
/** An IFSC in any case, not inside a longer word. */
const LOOSE_IFSC = /(?<![A-Za-z0-9])[A-Za-z]{4}0[A-Za-z0-9]{6}(?![A-Za-z0-9])/g;
/** Nine to eighteen digits with gaps, not running on from letters (so an IFSC's own digits are never taken as one). */
const LOOSE_ACCOUNT = new RegExp(`(?<![A-Za-z0-9])\\d(?:${GAP}\\d){8,17}(?!\\d)`, 'g');
const LOOSE_OTP_LABEL = `(?:otp|one[- ]time (?:password|code|pin)|verification code|security code|passcode|login code)`;
/** A one-time code after its label, with gaps, in Hindi too (ओटीपी), and "the code I got". */
const LOOSE_OTP = new RegExp(`(?:\\b(${LOOSE_OTP_LABEL}|code is|code (?:i|we) (?:got|received))\\b|(ओटीपी))[^0-9\\n]{0,20}?(\\d(?:${GAP}\\d){3,7})(?!\\d)`, 'gi');
/** A one-time code before its label: "482913 is my OTP". */
const LOOSE_OTP_FIRST = new RegExp(`(?<!\\d)(\\d(?:${GAP}\\d){3,7})(?!\\d)\\s+(?:is|as)\\s+(?:your|the|my)\\s+(?:${LOOSE_OTP_LABEL}|ओटीपी)`, 'gi');
type Hit = { start: number; end: number; kind: Exclude<ReadbackKind, 'secret'> };
/** Which name an overlapping find takes, strongest evidence first. */
const STRENGTH: readonly Hit['kind'][] = ['bank-account', 'aadhaar', 'card', 'otp', 'pan'];
const LABELS: Readonly<Record<Hit['kind'], string>> = {
  card: '[redacted card number]', aadhaar: '[redacted Aadhaar number]', 'bank-account': '[redacted bank account]', otp: '[redacted OTP]', pan: '[redacted PAN]',
};

/**
 * Reads a copy of the screened text (secondLook's copy: nothing invisible, every digit 0 to 9, gaps of up to two
 * spaces, dots, slashes or dashes allowed) for what the first pass missed: a card number in groups (Luhn), or after its
 * label (any check digit); an Aadhaar number beside its label (any check digit); an account number beside an IFSC in
 * any case; a one-time code beside its label, before or after it, except a year after a bare "code is". Each find is
 * taken out of the text itself, at the place the copy came from. keep: kinds the caller's work needs.
 */
function secondLook(text: string, keep: ReadonlySet<ReadbackKind>, found: Set<ReadbackKind>): string {
  const looked = lookCopy(text);
  const from = looked.from;
  // The first pass's markers are blanked, places kept, so they are never read as a label or a number.
  const copy = looked.copy.replace(MARKER, marker => ' '.repeat(marker.length));
  const hits: Hit[] = [];
  const digitsOf = (value: string) => value.replace(/\D/g, '');
  const sameLine = (a: number, b: number) => !copy.slice(Math.min(a, b), Math.max(a, b)).includes('\n');
  const lineAround = (start: number, end: number, before: number, after: number) => {
    const head = copy.slice(Math.max(0, start - before), start);
    const tail = copy.slice(end, end + after);
    return `${head.slice(head.lastIndexOf('\n') + 1)} ${tail.split('\n')[0]}`;
  };
  if (!keep.has('card')) {
    for (const pattern of LOOSE_CARDS) {
      for (const match of copy.matchAll(new RegExp(pattern.source, 'g'))) {
        const digits = digitsOf(match[0]);
        if (digits.length >= 13 && digits.length <= 19 && luhnValid(digits)) hits.push({ start: match.index, end: match.index + match[0].length, kind: 'card' });
      }
    }
    for (const match of copy.matchAll(LABELLED_CARD)) {
      const start = match.index + match[0].length - match[1].length;
      hits.push({ start, end: start + match[1].length, kind: 'card' });
    }
  }
  if (!keep.has('aadhaar')) {
    for (const match of copy.matchAll(LOOSE_AADHAAR)) {
      const end = match.index + match[0].length;
      if (AADHAAR_LABEL.test(lineAround(match.index, end, LOOSE_LABEL_BEFORE, LOOSE_LABEL_AFTER))) hits.push({ start: match.index, end, kind: 'aadhaar' });
    }
  }
  if (!keep.has('bank-account')) {
    const branches = [...copy.matchAll(LOOSE_IFSC)].map(match => ({ start: match.index, end: match.index + match[0].length }));
    if (branches.length) {
      for (const match of copy.matchAll(LOOSE_ACCOUNT)) {
        const end = match.index + match[0].length;
        // Beside an IFSC on the same line (the first pass already took the plain ones within reach across lines).
        if (branches.some(branch => Math.max(branch.start - end, match.index - branch.end) <= ACCOUNT_REACH && sameLine(branch.start, match.index))) {
          hits.push({ start: match.index, end, kind: 'bank-account' });
        }
      }
    }
  }
  if (!keep.has('otp')) {
    for (const match of copy.matchAll(LOOSE_OTP)) {
      const code = match[3];
      if (match[1] && /^code is$/i.test(match[1]) && YEAR.test(digitsOf(code))) continue;
      const start = match.index + match[0].length - code.length;
      hits.push({ start, end: start + code.length, kind: 'otp' });
    }
    for (const match of copy.matchAll(LOOSE_OTP_FIRST)) hits.push({ start: match.index, end: match.index + match[1].length, kind: 'otp' });
  }
  if (!hits.length) return text;
  // Back to the text's own places; where two finds overlap they become one, named by the stronger evidence (an IFSC
  // beside it, then an Aadhaar label, then a card, then a one-time code). Replaced from the end so earlier places hold.
  const spans = hits.map(hit => {
    const last = from[hit.end - 1];
    return { start: from[hit.start], end: last + ((text.codePointAt(last) ?? 0) > 0xFFFF ? 2 : 1), kind: hit.kind };
  }).sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: typeof spans = [];
  for (const span of spans) {
    const previous = kept.at(-1);
    if (previous && span.start < previous.end) {
      previous.end = Math.max(previous.end, span.end);
      if (STRENGTH.indexOf(span.kind) < STRENGTH.indexOf(previous.kind)) previous.kind = span.kind;
      continue;
    }
    kept.push({ ...span });
  }
  let out = text;
  for (const span of kept.reverse()) {
    found.add(span.kind);
    out = `${out.slice(0, span.start)}${LABELS[span.kind]}${out.slice(span.end)}`;
  }
  return out;
}
