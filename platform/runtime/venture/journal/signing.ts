// Chausar venture launcher, journal (Ink v2 wave 4, package 4J10; catalogue H26): signed receipts. Every stored price,
// sum, work and tie receipt carries an Ed25519 signature over its canonical JSON, made in the commit that writes it
// (records.ts ventureAction, through chain.ts sealWrites), with the business's own key. The key's private half is never
// stored: its seed is derived from the vault's own key when the vault opens (VentureHost, SecretName receipt:signing),
// so no record, export, backup or log carries it. Only public halves are kept (venture-signing-key), every one ever
// used, so an old signature can still be checked. A change Chausar makes to a receipt (it became stale) is signed again
// in that commit, but only when the receipt as it was still matched its signature: a change made outside Chausar is
// never signed over, so it shows. venture.receipt.verify {id} answers whether the stored receipt still matches its
// signature, and how far it can be worked again: reproduction_ready (what it was worked out from is kept, as the CA
// engine's receipts keep their inputs and table versions), incomplete (some of that is gone) or signature_only (it
// keeps its figures, not their inputs). signedReceiptsFile is what an export carries for scripts/verify-receipts.mjs.
// Signed receipts with an offline verifier and a reproducibility label follow decionis (internal/dossier/dossier.go,
// reproduce.go), as the catalogue row H26 names it; this is a rewrite in TypeScript, not a copy.
import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';
import { check, newId, type Context, type State } from '../../contracts.ts';
import type {
  AnyVentureRecord, IsoTime, ReceiptSignature, ReceiptSignatureRecord, ReceiptVerifyView, SignedReceiptsFile, SigningKeyRecord, VentureDeps,
  VentureRecord,
} from '../contracts.ts';
import { pinMac, sealCanonical } from './seal-json.ts';

type SignedKind = ReceiptSignatureRecord['receiptKind'];
/** The receipts Chausar stores and signs. Figures worked out again on every read (fig:, credit-balance:) are not stored. */
export const SIGNED_KINDS: readonly SignedKind[] = Object.freeze(['venture-price-receipt', 'venture-sum-receipt', 'venture-work-receipt', 'venture-tie']);
const SIGNED: ReadonlySet<string> = new Set(SIGNED_KINDS);
type Signable = AnyVentureRecord & { kind: SignedKind };
const isSignable = (record: unknown): record is Signable => !!record && SIGNED.has((record as { kind?: string }).kind ?? '');

/** The text signed: the canonical JSON of the receipt as JSON carries it. A BigInt in it is a ChausarError. */
export const signedText = (receipt: unknown): string => sealCanonical(receipt);
const bytesOf = (text: string) => Buffer.from(text, 'utf8');

const records = (state: State) => state.conversations as AnyVentureRecord[];
function keysOf(state: State, ventureId: string): SigningKeyRecord[] {
  return records(state).filter((record): record is SigningKeyRecord => record?.kind === 'venture-signing-key' && record.ventureId === ventureId);
}
function signaturesOf(state: State, ventureId: string): ReceiptSignatureRecord[] {
  return records(state).filter((record): record is ReceiptSignatureRecord => record?.kind === 'venture-receipt-signature' && record.ventureId === ventureId);
}

/** PKCS#8 for an Ed25519 key from its 32-byte seed (RFC 8410). */
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
/** The private key from the seed the host derived from the vault's own key; null when this host has none. */
function privateFromSeed(seed: string | null): KeyObject | null {
  if (!seed || !/^[0-9a-f]{64}$/i.test(seed)) return null;
  return createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from(seed, 'hex')]), format: 'der', type: 'pkcs8' });
}
const publicOf = (publicKey: string): KeyObject => createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' });

/** The public half's record for this seed, made the first time it signs; every one stays, so old signatures still check. */
function keyIn(state: State, venture: VentureRecord, ctx: Context, now: IsoTime, secret: KeyObject): SigningKeyRecord {
  const publicKey = createPublicKey(secret).export({ format: 'der', type: 'spki' }).toString('base64');
  const found = keysOf(state, venture.id).find(record => record.publicKey === publicKey);
  if (found) return found;
  const record: SigningKeyRecord = { id: newId('signkey'), kind: 'venture-signing-key', ventureId: venture.id, memberId: ctx.memberId, epoch: ctx.epoch, at: now, algorithm: 'ed25519', publicKey };
  state.conversations.push(record);
  return record;
}

const sinceMac = (key: string, ventureId: string, at: IsoTime) => pinMac(key, ventureId, `signing-since\n${at}`);
function signingSinceOf(state: State, ventureId: string): { at: IsoTime; mac?: string } | null {
  for (let index = state.conversations.length - 1; index >= 0; index -= 1) {
    const record = state.conversations[index] as AnyVentureRecord | undefined;
    if (record?.kind === 'venture-record' && record.id === ventureId) return (record as VentureRecord).signingSince ?? null;
  }
  return null;
}
/**
 * The first time this business signed a receipt, pinned on its venture record once, with an HMAC when the host has the
 * head key: deleting the key records then cannot turn a receipt changed since into one "made before signing".
 */
function pinSigningSince(state: State, ventureId: string, now: IsoTime, headKey: string | null): void {
  for (let index = state.conversations.length - 1; index >= 0; index -= 1) {
    const record = state.conversations[index] as AnyVentureRecord | undefined;
    if (record?.kind !== 'venture-record' || record.id !== ventureId) continue;
    const venture = record as VentureRecord;
    if (venture.signingSince) return;
    state.conversations[index] = { ...venture, signingSince: { at: now, ...(headKey ? { mac: sinceMac(headKey, ventureId, now) } : {}) } } as unknown as State['conversations'][number];
    return;
  }
}

/** Whether a stored signature matches a receipt, with the public half it names. */
function matches(state: State, signature: ReceiptSignatureRecord, receipt: unknown): boolean {
  const key = records(state).find((record): record is SigningKeyRecord => record?.kind === 'venture-signing-key' && record.id === signature.keyId);
  if (!key) return false;
  try { return verify(null, bytesOf(signedText(receipt)), publicOf(key.publicKey), Buffer.from(signature.signature, 'base64')); } catch { return false; }
}

/**
 * chain.ts sealWrites: signs each receipt this transaction put in, and each receipt it added another way (a tie the
 * strength work stores in one pass); signs again one it replaced, but only when the receipt as it was still matched
 * its signature. A receipt from before signing, or one changed outside Chausar, is left as it is: signing it now would
 * vouch for what nobody checked. Signatures of receipts that are gone (a tie replaced, a person forgotten) are dropped.
 */
export function signWrites(
  state: State, venture: VentureRecord, ctx: Context, now: IsoTime, written: ReadonlyMap<string, AnyVentureRecord | null>,
  opened: { list: unknown[]; length: number }, seed: string | null, headKey: string | null = null,
): void {
  const reshaped = state.conversations !== opened.list || state.conversations.length !== opened.length;
  if (reshaped) {
    const kept = new Set(records(state).filter(record => isSignable(record) && record.ventureId === venture.id).map(record => record.id));
    const gone = new Set(signaturesOf(state, venture.id).filter(record => !kept.has(record.receiptId)).map(record => record.id));
    if (gone.size) state.conversations = state.conversations.filter(record => !gone.has((record as { id?: string })?.id ?? ''));
  }
  const secret = privateFromSeed(seed);
  if (!secret) return;
  // The ids there before the work, made only when a receipt was not written through tx.put or tx.replace.
  let before: Set<string> | null = null;
  const existed = (id: string) => {
    before ??= new Set(((state.conversations !== opened.list ? opened.list : state.conversations.slice(0, opened.length)) as AnyVentureRecord[]).map(record => record?.id));
    return before.has(id);
  };
  const signed = new Map(signaturesOf(state, venture.id).map(record => [record.receiptId, record]));
  const receipts = records(state).filter((record): record is Signable => {
    if (!isSignable(record) || record.ventureId !== venture.id) return false;
    const known = signed.get(record.id);
    if (written.has(record.id)) {
      const was = written.get(record.id);
      // Put in now: sign it. Replaced: sign again only over a receipt that still matched its own signature.
      if (!was) return true;
      return !!known && matches(state, known, was);
    }
    return !known && !existed(record.id);
  });
  if (!receipts.length) return;
  const key = keyIn(state, venture, ctx, now, secret);
  pinSigningSince(state, venture.id, now, headKey);
  for (const receipt of receipts) {
    const signature = sign(null, bytesOf(signedText(receipt)), secret).toString('base64');
    const known = signed.get(receipt.id);
    const record: ReceiptSignatureRecord = {
      id: known?.id ?? newId('receiptsig'), kind: 'venture-receipt-signature', ventureId: venture.id, memberId: ctx.memberId, epoch: ctx.epoch, at: now,
      receiptId: receipt.id, receiptKind: receipt.kind, keyId: key.id, signature,
    };
    if (known) state.conversations[state.conversations.indexOf(known)] = record;
    else state.conversations.push(record);
  }
}

/**
 * What venture.receipt.get adds to a stored receipt: its signature, the public half that checks it, and the stored
 * receipt exactly as signed, whatever view the answer shows. null when it is unsigned or its key is not kept.
 */
export function receiptSignature(state: State, ventureId: string, receiptId: string): ReceiptSignature | null {
  const record = signaturesOf(state, ventureId).find(item => item.receiptId === receiptId);
  const key = record && records(state).find((item): item is SigningKeyRecord => item?.kind === 'venture-signing-key' && item.id === record.keyId);
  const receipt = records(state).find(item => isSignable(item) && item.ventureId === ventureId && item.id === receiptId);
  if (!record || !key || !receipt) return null;
  return { algorithm: 'ed25519', publicKey: key.publicKey, signature: record.signature, signedAt: record.at, signed: signedText(receipt) };
}

// ---------------------------------------------------------------------------
// venture.receipt.verify
// ---------------------------------------------------------------------------

type Label = ReceiptVerifyView['label'];
const exists = (state: State, id: string) => records(state).some(record => record?.id === id);

/** How far a receipt can be worked again from what the business still keeps. */
function labelOf(state: State, receipt: Signable): Label {
  switch (receipt.kind) {
    case 'venture-price-receipt': {
      const inputs = receipt.inputs;
      return inputs && inputs.unitPriceMinor && inputs.quantity && inputs.taxRateBps !== undefined && inputs.taxTreatment ? 'reproduction_ready' : 'incomplete';
    }
    case 'venture-sum-receipt':
      return receipt.addends.every(addend => exists(state, addend.recordId)) ? 'reproduction_ready' : 'incomplete';
    case 'venture-work-receipt': {
      if (receipt.ca) return receipt.ca.inputs !== undefined && (receipt.ca.table !== null || receipt.ca.tables.length > 0) ? 'reproduction_ready' : 'incomplete';
      if (receipt.report?.length) return 'reproduction_ready';
      const tables = receipt.inputs?.tables ?? [];
      if (!tables.length) return 'signature_only';
      const kept = tables.every(table => records(state).some(record => record?.kind === 'venture-work-table' && record.id === table.id && (record as { digest?: string }).digest === table.digest));
      return kept ? 'reproduction_ready' : 'incomplete';
    }
    case 'venture-tie':
      if (!receipt.signals?.length) return 'signature_only';
      return exists(state, receipt.personId) ? 'reproduction_ready' : 'incomplete';
  }
}

const SIGNED_LINE = 'Signed by this business and unchanged since.';
const LABEL_LINES: Readonly<Record<Label, string>> = Object.freeze({
  reproduction_ready: `${SIGNED_LINE} What it was worked out from is kept, so it can be worked out again.`,
  incomplete: `${SIGNED_LINE} Some of what it was worked out from is no longer kept, so it cannot all be worked out again.`,
  signature_only: `${SIGNED_LINE} It keeps its figures, not what they were worked out from.`,
});
export const UNSIGNED_LINE = 'This receipt was made before Chausar signed receipts, so there is no signature to check.';
export const CHANGED_LINE = 'This receipt does not match its signature: it changed after Chausar signed it.';
export const UNSIGNED_SINCE_LINE = 'This receipt has no signature, though this business signed every receipt made since before it, so it was changed or put in outside Chausar.';
/** No key has ever signed here: the host had no signing seed (a store that cannot derive one), so nothing is signed. */
export const NO_KEY_LINE = 'This receipt is not signed: this business has no signing key here, so Chausar signs no receipts on it.';
export const KEY_GONE_LINE ='This receipt was signed with a key no longer kept, so its signature cannot be checked.';
const WORKED_ON_READ = 'This figure is worked out again each time it is shown, so there is no stored receipt to sign.';

/**
 * Whether one stored receipt still matches its signature, with its label. reason (4J22a): a code the screen words, so
 * only a real mismatch (changed, or unsigned though made after signing began) reads as one; no key, an older unsigned
 * receipt and a key no longer kept are not confirmed, never tampered.
 */
export function verifyStoredReceipt(state: State, venture: VentureRecord, id: string, headKey: string | null = null): ReceiptVerifyView {
  check(!id.startsWith('fig:') && !id.startsWith('credit-balance:'), 'RECEIPT_NOT_FOUND', WORKED_ON_READ);
  const receipt = records(state).find((record): record is Signable => isSignable(record) && record.ventureId === venture.id && record.id === id);
  check(receipt, 'RECEIPT_NOT_FOUND', 'This receipt was not found.');
  const label = labelOf(state, receipt);
  const signature = signaturesOf(state, venture.id).find(item => item.receiptId === id);
  if (!signature) {
    // Unsigned: honest only for a receipt made before this business's first key; after it, every receipt is signed.
    // When signing began: the pin on the venture record (its HMAC checked with the head key), else the oldest key kept.
    // A pin that does not hold fails closed: every unsigned receipt reads changed.
    const pin = signingSinceOf(state, venture.id);
    if (pin && headKey && pin.mac !== sinceMac(headKey, venture.id, pin.at)) return { id, valid: false, label, reason: 'unsigned-since', line: UNSIGNED_SINCE_LINE };
    let first: IsoTime | null = pin?.at ?? null;
    for (const key of keysOf(state, venture.id)) if (first === null || key.at < first) first = key.at;
    if (first === null) return { id, valid: false, label, reason: 'no-key', line: NO_KEY_LINE };
    return receipt.at >= first ? { id, valid: false, label, reason: 'unsigned-since', line: UNSIGNED_SINCE_LINE } : { id, valid: false, label, reason: 'unsigned-old', line: UNSIGNED_LINE };
  }
  if (!records(state).some(record => record?.kind === 'venture-signing-key' && record.id === signature.keyId)) return { id, valid: false, label, reason: 'key-gone', line: KEY_GONE_LINE };
  const valid = matches(state, signature, receipt);
  return { id, valid, label, reason: valid ? 'signed' : 'changed', line: valid ? LABEL_LINES[label] : CHANGED_LINE };
}

/** venture.receipt.verify { id } (read): whether a stored receipt still matches the business's signature on it. */
export async function receiptVerifyHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<ReceiptVerifyView> {
  const { exactPayload, identifier, readVenture } = await import('../records.ts');
  const body = exactPayload(payload, ['id'], ['id']);
  const id = typeof body.id === 'string' && /^(fig|credit-balance):/.test(body.id) && body.id.length <= 200 ? body.id : identifier(body.id, 'Receipt');
  const { state, venture } = readVenture(deps, ctx);
  const { sealKeysOf } = await import('./chain.ts');
  return verifyStoredReceipt(state, venture, id, sealKeysOf(deps).head);
}

// ---------------------------------------------------------------------------
// The file an export carries
// ---------------------------------------------------------------------------

export const SIGNED_RECEIPTS_FORMAT = 'chausar-signed-receipts/1';
export type { SignedReceiptsFile };

/**
 * Every signed receipt of the business with its signature and the public half of the key that made it, for the CA's
 * export (venture.money.export) and for node scripts/verify-receipts.mjs, which checks it with nothing else.
 * publicKey: the newest key. Never a private half: none is stored.
 */
export function signedReceiptsFile(state: State, venture: VentureRecord): SignedReceiptsFile {
  const keys = keysOf(state, venture.id);
  const byId = new Map(keys.map(key => [key.id, key]));
  const signed = new Map(signaturesOf(state, venture.id).map(record => [record.receiptId, record]));
  const receipts: SignedReceiptsFile['receipts'] = [];
  for (const record of records(state)) {
    if (!isSignable(record) || record.ventureId !== venture.id) continue;
    const signature = signed.get(record.id);
    const key = signature && byId.get(signature.keyId);
    if (!signature || !key) continue;
    receipts.push({ id: record.id, kind: record.kind, receipt: JSON.parse(signedText(record)), signature: signature.signature, signedAt: signature.at, publicKey: key.publicKey });
  }
  const newest = keys.reduce<SigningKeyRecord | null>((last, key) => (!last || key.at >= last.at ? key : last), null);
  return { format: SIGNED_RECEIPTS_FORMAT, business: venture.id, algorithm: 'ed25519', publicKey: newest?.publicKey ?? null, keys: keys.map(key => ({ id: key.id, publicKey: key.publicKey })), receipts };
}
