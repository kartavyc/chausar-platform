// Chausar hosted tier: passkeys (WebAuthn Level 3) checked with Node's own crypto, no new dependencies.
// Registration asks for a discoverable credential with user verification and no attestation. The server checks the
// client data (type, challenge, exact origin), the authenticator data (relying party hash, user present, user
// verified), and for sign-in the signature over authenticatorData || SHA-256(clientDataJSON) with the stored key.
// Attestation is not used to trust a device maker: 'none' is accepted, and 'packed' only after its signature checks.
import { X509Certificate, createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';
import { ChausarError, check } from '../contracts.ts';
import { decodeCbor, decodeFirst, type CborValue } from './cbor.ts';

export type RelyingParty = { id: string; name: string; origin: string };
export type PasskeyAlgorithm = -7 | -8 | -257;
export type StoredPasskey = {
  id: string; // credential id, base64url
  publicKey: string; // SPKI DER, base64url
  alg: PasskeyAlgorithm;
  signCount: number;
  transports: string[];
  backupEligible: boolean;
  backedUp: boolean;
};

const ALGORITHMS: readonly PasskeyAlgorithm[] = [-7, -8, -257];
const TRANSPORTS = ['usb', 'nfc', 'ble', 'internal', 'hybrid', 'smart-card'];
const FLAG_UP = 0x01, FLAG_UV = 0x04, FLAG_BE = 0x08, FLAG_BS = 0x10, FLAG_AT = 0x40, FLAG_ED = 0x80;
const invalid = (message = 'The passkey response is malformed.'): never => { throw new ChausarError('PASSKEY_INVALID', message); };

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest();

function b64(value: unknown, field: string, max = 65536): Buffer {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || !/^[A-Za-z0-9_-]+$/.test(value)) invalid(`The passkey ${field} is malformed.`);
  const bytes = Buffer.from(value as string, 'base64url');
  if (bytes.toString('base64url') !== value) invalid(`The passkey ${field} is malformed.`);
  return bytes;
}

function plainObject(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const record = value as Record<string, unknown>;
  if (!Object.keys(record).every(key => allowed.includes(key))) invalid();
  return record;
}

/** The options the browser passes to navigator.credentials.create(), as JSON (parseCreationOptionsFromJSON shape). */
export function registrationOptions(rp: RelyingParty, user: { handle: string; email: string }, challenge: string, exclude: readonly string[]) {
  return {
    challenge, rp: { id: rp.id, name: rp.name },
    user: { id: user.handle, name: user.email, displayName: user.email },
    pubKeyCredParams: ALGORITHMS.map(alg => ({ type: 'public-key', alg })),
    authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
    attestation: 'none', timeout: 300000,
    excludeCredentials: exclude.map(id => ({ type: 'public-key', id })),
  };
}

/** The options the browser passes to navigator.credentials.get(): discoverable, so no list of credentials. */
export function authenticationOptions(rp: RelyingParty, challenge: string) {
  return { challenge, rpId: rp.id, userVerification: 'required', timeout: 300000, allowCredentials: [] };
}

function clientData(value: unknown, type: 'webauthn.create' | 'webauthn.get', rp: RelyingParty, challenge: string): Buffer {
  const raw = b64(value, 'client data', 8192);
  let parsed: any;
  try { parsed = JSON.parse(raw.toString('utf8')); } catch { invalid(); }
  check(parsed && typeof parsed === 'object', 'PASSKEY_INVALID', 'The passkey response is malformed.');
  check(parsed.type === type, 'PASSKEY_INVALID', 'The passkey answered a different request.');
  check(typeof parsed.challenge === 'string' && parsed.challenge === challenge, 'PASSKEY_CHALLENGE_MISMATCH', 'This passkey request expired. Try again.');
  check(parsed.origin === rp.origin, 'PASSKEY_ORIGIN_MISMATCH', 'This passkey answered for a different site.');
  check(parsed.crossOrigin !== true, 'PASSKEY_ORIGIN_MISMATCH', 'Passkeys from embedded pages are not accepted.');
  return raw;
}

type AuthData = { flags: number; signCount: number; credentialId: Buffer | null; publicKey: Map<CborValue, CborValue> | null };

function authenticatorData(raw: Buffer, rp: RelyingParty, registering: boolean): AuthData {
  if (raw.length < 37) invalid();
  check(raw.subarray(0, 32).equals(sha256(rp.id)), 'PASSKEY_ORIGIN_MISMATCH', 'This passkey belongs to a different site.');
  const flags = raw[32];
  check((flags & FLAG_UP) !== 0, 'PASSKEY_INVALID', 'The passkey did not confirm you were present.');
  check((flags & FLAG_UV) !== 0, 'PASSKEY_INVALID', 'The passkey did not check it was you. Use a device with a screen lock.');
  if ((flags & FLAG_BS) !== 0 && (flags & FLAG_BE) === 0) invalid();
  const signCount = raw.readUInt32BE(33);
  let at = 37, credentialId: Buffer | null = null, publicKey: Map<CborValue, CborValue> | null = null;
  if (registering) {
    check((flags & FLAG_AT) !== 0, 'PASSKEY_INVALID', 'The passkey sent no key.');
    if (raw.length < at + 18) invalid();
    at += 16; // AAGUID: not used, attestation is not trusted for provenance
    const length = raw.readUInt16BE(at); at += 2;
    if (length < 16 || length > 1023 || raw.length < at + length) invalid();
    credentialId = Buffer.from(raw.subarray(at, at + length)); at += length;
    const key = decodeFirst(raw, at);
    if (!(key.value instanceof Map)) invalid();
    publicKey = key.value as Map<CborValue, CborValue>;
    at = key.end;
  } else if ((flags & FLAG_AT) !== 0) invalid();
  if ((flags & FLAG_ED) !== 0) {
    const extensions = decodeFirst(raw, at);
    if (!(extensions.value instanceof Map)) invalid();
    at = extensions.end;
  }
  if (at !== raw.length) invalid();
  return { flags, signCount, credentialId, publicKey };
}

function coseKey(map: Map<CborValue, CborValue>): { key: KeyObject; alg: PasskeyAlgorithm } {
  const kty = map.get(1), alg = map.get(3);
  const bytes = (label: number, length?: number): string => {
    const value = map.get(label);
    if (!Buffer.isBuffer(value) || (length !== undefined && value.length !== length)) invalid('The passkey key is malformed.');
    return (value as Buffer).toString('base64url');
  };
  try {
    if (kty === 2 && alg === -7) {
      check(map.get(-1) === 1, 'PASSKEY_UNSUPPORTED', 'Only P-256 passkeys are accepted for this key type.');
      return { key: createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: bytes(-2, 32), y: bytes(-3, 32) }, format: 'jwk' }), alg: -7 };
    }
    if (kty === 1 && alg === -8) {
      check(map.get(-1) === 6, 'PASSKEY_UNSUPPORTED', 'Only Ed25519 passkeys are accepted for this key type.');
      return { key: createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: bytes(-2, 32) }, format: 'jwk' }), alg: -8 };
    }
    if (kty === 3 && alg === -257) {
      const n = map.get(-1);
      check(Buffer.isBuffer(n) && n.length >= 256, 'PASSKEY_UNSUPPORTED', 'RSA passkeys need a key of at least 2048 bits.');
      return { key: createPublicKey({ key: { kty: 'RSA', n: bytes(-1), e: bytes(-2) }, format: 'jwk' }), alg: -257 };
    }
  } catch (error) {
    if (error instanceof ChausarError) throw error;
    invalid('The passkey key is malformed.');
  }
  throw new ChausarError('PASSKEY_UNSUPPORTED', 'This passkey uses a key type Chausar does not accept yet.');
}

function signatureValid(alg: PasskeyAlgorithm, key: KeyObject, data: Buffer, signature: Buffer): boolean {
  try {
    if (alg === -7) return verify('sha256', data, { key, dsaEncoding: 'der' }, signature);
    if (alg === -8) return verify(null, data, key, signature);
    return verify('sha256', data, key, signature);
  } catch { return false; }
}

function attestation(raw: Buffer): { fmt: string; attStmt: Map<CborValue, CborValue>; authData: Buffer } {
  const value = decodeCbor(raw);
  if (!(value instanceof Map)) invalid();
  const map = value as Map<CborValue, CborValue>;
  const fmt = map.get('fmt'), attStmt = map.get('attStmt'), authData = map.get('authData');
  if (typeof fmt !== 'string' || !(attStmt instanceof Map) || !Buffer.isBuffer(authData)) invalid();
  return { fmt: fmt as string, attStmt: attStmt as Map<CborValue, CborValue>, authData: authData as Buffer };
}

function checkAttestation(fmt: string, statement: Map<CborValue, CborValue>, signed: Buffer, credential: { key: KeyObject; alg: PasskeyAlgorithm }) {
  if (fmt === 'none') { check(statement.size === 0, 'PASSKEY_INVALID', 'The passkey response is malformed.'); return; }
  check(fmt === 'packed', 'PASSKEY_UNSUPPORTED', 'This passkey sent an attestation format Chausar does not accept. Try another device.');
  const alg = statement.get('alg'), sig = statement.get('sig'), x5c = statement.get('x5c');
  if (!Buffer.isBuffer(sig) || !ALGORITHMS.includes(alg as PasskeyAlgorithm)) invalid();
  if (x5c === undefined) {
    check(alg === credential.alg && signatureValid(credential.alg, credential.key, signed, sig as Buffer), 'PASSKEY_INVALID', 'The passkey signature did not check.');
    return;
  }
  const chain = Array.isArray(x5c) ? x5c : [];
  if (chain.length < 1 || !Buffer.isBuffer(chain[0])) invalid();
  let leaf: KeyObject;
  try { leaf = new X509Certificate(chain[0] as Buffer).publicKey; } catch { return invalid(); }
  check(signatureValid(alg as PasskeyAlgorithm, leaf, signed, sig as Buffer), 'PASSKEY_INVALID', 'The passkey signature did not check.');
}

/** Checks a navigator.credentials.create() response (PublicKeyCredential.toJSON() shape). Returns the key to store. */
export function verifyRegistration(rp: RelyingParty, input: unknown, expected: { challenge: string }): StoredPasskey {
  const body = plainObject(input, ['id', 'rawId', 'type', 'response', 'authenticatorAttachment', 'clientExtensionResults']);
  check(body.type === 'public-key', 'PASSKEY_INVALID', 'The passkey response is malformed.');
  const response = plainObject(body.response, ['clientDataJSON', 'attestationObject', 'transports', 'publicKeyAlgorithm', 'publicKey', 'authenticatorData']);
  const client = clientData(response.clientDataJSON, 'webauthn.create', rp, expected.challenge);
  const { fmt, attStmt, authData } = attestation(b64(response.attestationObject, 'attestation'));
  const parsed = authenticatorData(authData, rp, true);
  const id = (parsed.credentialId as Buffer).toString('base64url');
  check(body.id === id && body.rawId === id, 'PASSKEY_INVALID', 'The passkey response is malformed.');
  const credential = coseKey(parsed.publicKey as Map<CborValue, CborValue>);
  checkAttestation(fmt, attStmt, Buffer.concat([authData, sha256(client)]), credential);
  const transports = Array.isArray(response.transports) ? response.transports.filter((t): t is string => typeof t === 'string' && TRANSPORTS.includes(t)).slice(0, 6) : [];
  return {
    id, publicKey: credential.key.export({ type: 'spki', format: 'der' }).toString('base64url'), alg: credential.alg,
    signCount: parsed.signCount, transports, backupEligible: (parsed.flags & FLAG_BE) !== 0, backedUp: (parsed.flags & FLAG_BS) !== 0,
  };
}

/** The credential id and user handle a sign-in response claims, read before the stored key is looked up. */
export function assertionIdentity(input: unknown): { id: string; userHandle: string | null } {
  const body = plainObject(input, ['id', 'rawId', 'type', 'response', 'authenticatorAttachment', 'clientExtensionResults']);
  check(body.type === 'public-key' && typeof body.id === 'string' && body.id === body.rawId, 'PASSKEY_INVALID', 'The passkey response is malformed.');
  b64(body.id, 'id', 2048);
  const response = plainObject(body.response, ['clientDataJSON', 'authenticatorData', 'signature', 'userHandle']);
  const userHandle = response.userHandle === undefined || response.userHandle === null ? null : b64(response.userHandle, 'user handle', 128).toString('base64url');
  return { id: body.id as string, userHandle };
}

/** Checks a navigator.credentials.get() response against the stored key. Returns the new counter and backup state. */
export function verifyAuthentication(rp: RelyingParty, input: unknown, expected: { challenge: string; passkey: StoredPasskey; userHandle: string }) {
  const identity = assertionIdentity(input);
  check(identity.id === expected.passkey.id, 'PASSKEY_INVALID', 'The passkey response is malformed.');
  check(identity.userHandle === null || identity.userHandle === expected.userHandle, 'PASSKEY_INVALID', 'This passkey belongs to a different account.');
  const response = (input as { response: Record<string, unknown> }).response;
  const client = clientData(response.clientDataJSON, 'webauthn.get', rp, expected.challenge);
  const rawAuth = b64(response.authenticatorData, 'authenticator data');
  const parsed = authenticatorData(rawAuth, rp, false);
  const key = createPublicKey({ key: b64(expected.passkey.publicKey, 'stored key'), format: 'der', type: 'spki' });
  check(signatureValid(expected.passkey.alg, key, Buffer.concat([rawAuth, sha256(client)]), b64(response.signature, 'signature', 1024)), 'PASSKEY_INVALID', 'The passkey signature did not check.');
  if (expected.passkey.signCount !== 0 || parsed.signCount !== 0) {
    check(parsed.signCount > expected.passkey.signCount, 'PASSKEY_CLONED', 'This passkey looks copied. Sign in with an email link and remove it.');
  }
  return { signCount: parsed.signCount, backedUp: (parsed.flags & FLAG_BS) !== 0 };
}
