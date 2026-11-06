// Chausar venture launcher, journal (Ink v2 wave 4, package 4J10): the canonical JSON the chained journal and the
// signed receipts are made over. It is exactly canonical() (platform/runtime/actions.ts) of the value as JSON carries
// it, keys sorted, a field left undefined dropped, made in one walk so a large journal checks quickly. A value JSON
// cannot carry (a BigInt, a cycle) is refused with a plain ChausarError, never a TypeError.
import { createHmac } from 'node:crypto';
import { ChausarError, hash } from '../../contracts.ts';

const UNSEALABLE = 'This record holds a value Chausar cannot seal, such as a BigInt. Keep amounts as text.';

function walk(value: unknown, seen: Set<object>): string | undefined {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string': return JSON.stringify(value);
    case 'boolean': return value ? 'true' : 'false';
    case 'number': return Number.isFinite(value) ? JSON.stringify(value) : 'null';
    case 'bigint': throw new ChausarError('INVALID_VENTURE_REQUEST', UNSEALABLE);
    case 'undefined': case 'function': case 'symbol': return undefined;
  }
  const object = value as object;
  if (seen.has(object)) throw new ChausarError('INVALID_VENTURE_REQUEST', UNSEALABLE);
  seen.add(object);
  let out: string;
  if (Array.isArray(object)) {
    out = `[${object.map(item => walk(item, seen) ?? 'null').join(',')}]`;
  } else if (typeof (object as { toJSON?: unknown }).toJSON === 'function') {
    out = walk((object as { toJSON(): unknown }).toJSON(), seen) ?? 'null';
  } else {
    const parts: string[] = [];
    for (const key of Object.keys(object).sort()) {
      const text = walk((object as Record<string, unknown>)[key], seen);
      if (text !== undefined) parts.push(`${JSON.stringify(key)}:${text}`);
    }
    out = `{${parts.join(',')}}`;
  }
  seen.delete(object);
  return out;
}

/** Canonical JSON of plain data, as canonical(JSON.parse(JSON.stringify(value))) would give it. */
export function sealCanonical(value: unknown): string {
  return walk(value, new Set()) ?? 'null';
}

/** sha256 over sealCanonical. */
export function sealDigest(value: unknown): string {
  return hash(sealCanonical(value));
}

/**
 * HMAC-SHA256 with a key derived from the vault's own key (journal:head), over one business and one statement: the
 * journal's pinned head and the first signing time on the venture record.
 */
export function pinMac(key: string, ventureId: string, statement: string): string {
  return createHmac('sha256', Buffer.from(key, 'hex')).update(`${ventureId}\n${statement}`).digest('hex');
}
