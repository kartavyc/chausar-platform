// Chausar venture launcher: bound, single-use approval tokens for the action journal (package P2-journal).
// An approval is a token signed with a key that lives only in this process's memory. It names one journal entry and is
// bound to the exact action digest, the member who approved it, the session it was approved in and the business. Only
// its sha256 is kept, in the entry's approval seal, and the claim marks it used in its own commit before the effect
// starts, so it works once. The token never enters a record, a log or a model's context: the code that approves hands
// it straight to the code that applies. A restart forgets the key, so an approval still waiting then is refused.
// The token bound to action, member, session and workspace, which only the owner's side ever holds, follows
// useopendesk/opendesk (Apache-2.0, internal/ai/assistant/run.go); this is a rewrite in TypeScript, not a copy.
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Context, State } from '../../contracts.ts';
import type { IsoTime } from '../contracts.ts';
import { currentVenture } from '../records.ts';

const PREFIX = 'cjat1';
/** What an approval token looks like. Tests scan prompts, run history and records for it: it must never be there. */
export const APPROVAL_TOKEN_PATTERN = /cjat1\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{16,}/;

export type ApprovalClaims = {
  entryId: string;
  actionDigest: string;
  memberId: string;
  epoch: number;
  session: string;
  businessId: string;
  expiresAt: IsoTime;
  nonce: string;
};

type Keys = { secret: Buffer; session: string };
/** One signing key and one session id per store, the store being one open business in this process. Memory only. */
const KEYS = new WeakMap<object, Keys>();

function keysOf(store: object): Keys {
  let keys = KEYS.get(store);
  if (!keys) {
    keys = { secret: randomBytes(32), session: randomUUID() };
    KEYS.set(store, keys);
  }
  return keys;
}

/** The session an approval belongs to: the channel it came through and this open business in this process. */
export function sessionOf(store: object, ctx: Context): string {
  return `${ctx.channel ?? 'none'}:${keysOf(store).session}`;
}

/** The business an approval belongs to: the workspace and the venture in it. */
export function businessOf(state: State): string {
  return `${state.workspace.id}:${currentVenture(state)?.id ?? 'none'}`;
}

function signature(keys: Keys, body: string): string {
  return createHmac('sha256', keys.secret).update(`${PREFIX}.${body}`).digest('base64url');
}

/** Signs a new token for one approval. The caller keeps it in memory and passes it to apply; nothing stores it. */
export function mintApprovalToken(store: object, claims: Omit<ApprovalClaims, 'nonce'>): string {
  const body = Buffer.from(JSON.stringify({ ...claims, nonce: randomBytes(16).toString('base64url') }), 'utf8').toString('base64url');
  return `${PREFIX}.${body}.${signature(keysOf(store), body)}`;
}

const isText = (value: unknown, max = 400): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;

/** The claims of a token this process signed for this store, or null for anything else: forged, changed or foreign. */
export function readApprovalToken(store: object, token: string): ApprovalClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX || !parts[1] || !parts[2]) return null;
  const expected = Buffer.from(signature(keysOf(store), parts[1]), 'utf8');
  const given = Buffer.from(parts[2], 'utf8');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Partial<ApprovalClaims>;
    const fields = [claims.entryId, claims.actionDigest, claims.memberId, claims.session, claims.businessId, claims.expiresAt, claims.nonce];
    if (!fields.every(value => isText(value)) || !Number.isInteger(claims.epoch)) return null;
    return claims as ApprovalClaims;
  } catch {
    return null;
  }
}

/** What the journal keeps instead of the token. */
export function tokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** True when the text holds something shaped like an approval token. */
export function containsApprovalToken(text: string): boolean {
  return APPROVAL_TOKEN_PATTERN.test(text);
}
