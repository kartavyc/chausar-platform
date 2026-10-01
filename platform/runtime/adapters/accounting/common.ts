import { createHash } from 'node:crypto';
import { check } from '../../contracts.ts';
import type { ReadContinuation, ReadPageRequest, ReadTransportContext, ReadEnvironment } from '../../connector-framework/read.ts';
import { ReadTransportError } from '../../connector-framework/read.ts';
import type { ConnectorOperationScope } from '../../connector-framework/registry.ts';

/** Adapter-local model. This is not an engine schema or an accepted accounting mapping. */
export type AccountingKind = 'invoice' | 'credit-note' | 'payment' | 'refund' | 'account' | 'voucher';
export type AccountingStatus = 'draft' | 'open' | 'paid' | 'void' | 'deleted' | 'unknown';
export type AccountingLine = {
  id: string | null; description: string | null; quantity: string | null; unitAmount: string | null;
  amount: string | null; accountId: string | null; taxAmount: string | null; taxCode: string | null;
  source: Record<string, unknown>;
};
export type AccountingAllocation = {
  documentId: string | null; documentKind: string | null; amount: string | null; source: Record<string, unknown>;
};
export type AccountingAccount = {
  code: string | null; name: string | null; sourceType: string | null; sourceClass: string | null;
  classification: 'asset' | 'liability' | 'equity' | 'income' | 'expense' | 'unknown';
};
export type AccountingRecord = {
  id: string; kind: AccountingKind; revision: string | null; date: string | null; currency: string | null;
  sourceType: string | null; direction: 'receivable' | 'payable' | 'inflow' | 'outflow' | 'unknown';
  total: string | null; subtotal: string | null; taxTotal: string | null; balance: string | null;
  status: AccountingStatus; sourceStatus: string | null; lines: AccountingLine[];
  allocations: AccountingAllocation[]; account: AccountingAccount | null;
  source: Record<string, unknown>; warnings: string[];
};
export type AccountingPage = {
  records: AccountingRecord[]; continuation: ReadContinuation; totalRows: number | null;
  /** A local capture time or response clock must never be promoted to a consistent source snapshot. */
  sourceGeneratedAtMs: number | null; snapshotId: string | null; warnings: string[];
};
export type AccountingHttpRequest = {
  method: 'GET'; url: string; headers: Readonly<Record<string, string>>;
};
export type AccountingHttpResponse = {
  status: number; content: Uint8Array; contentType: string; headers?: Readonly<Record<string, string>>;
  /** Trusted transport must refuse redirects and attest the final allowlisted URL. */
  finalUrl: string;
};
/** Host owns credential resolution. No token or credential value is ever passed to parser/receipts. */
export type AccountingTransport = (request: AccountingHttpRequest, context: ReadTransportContext) => Promise<AccountingHttpResponse>;
export type AccountingReadConfig = {
  environment: ReadEnvironment; transport: AccountingTransport;
};

export const sha256 = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
export function freezeOperation(scope: ConnectorOperationScope): ConnectorOperationScope {
  const pinned = structuredClone(scope);
  Object.freeze(pinned.applicability); return Object.freeze(pinned);
}
export function object(value: unknown, code = 'ACCOUNTING_OBJECT_REQUIRED'): Record<string, unknown> {
  check(value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype, code, 'Expected a source object.');
  return value as Record<string, unknown>;
}
export function array(value: unknown, code = 'ACCOUNTING_ARRAY_REQUIRED'): unknown[] {
  check(Array.isArray(value), code, 'Expected a source collection.'); return value;
}
export function text(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  check(typeof value === 'string' && value.length <= 100_000, 'ACCOUNTING_TEXT_REQUIRED', 'Source values must be exact text.');
  return value;
}
export function requiredText(value: unknown, code = 'ACCOUNTING_ID_REQUIRED'): string {
  const result = text(value); check(result !== null && result.length > 0 && result.length <= 1000 && !/[\u0000-\u001f]/.test(result), code, 'A bounded source identity is required.'); return result;
}
export function integer(value: unknown, min = 0, max = 1_000_000): number {
  const result = typeof value === 'number' ? value : typeof value === 'string' && /^(?:0|[1-9]\d*)$/.test(value) ? Number(value) : NaN;
  check(Number.isSafeInteger(result) && result >= min && result <= max, 'ACCOUNTING_INTEGER_REQUIRED', 'Expected bounded pagination metadata.'); return result;
}
export function date(value: unknown): string | null {
  const result = text(value); if (result === null || result === '') return null;
  const parsed = new Date(`${result}T00:00:00.000Z`);
  check(/^\d{4}-\d{2}-\d{2}$/.test(result) && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === result,
    'ACCOUNTING_DATE_INVALID', 'A real source calendar date is required.'); return result;
}
export function currency(value: unknown): string | null {
  const result = text(value); if (result === null || result === '') return null;
  check(/^[A-Z]{3}$/.test(result), 'ACCOUNTING_CURRENCY_INVALID', 'An explicit ISO currency is required.'); return result;
}
/** Preserve source decimal spelling; no binary floating point or silent rounding. */
export function decimal(value: unknown): string | null {
  const result = text(value); if (result === null || result === '') return null;
  check(/^-?(?:0|[1-9]\d{0,99})(?:\.\d{1,100})?$/.test(result), 'ACCOUNTING_DECIMAL_INVALID', 'A bounded exact decimal is required.'); return result;
}
export function makeRecord(input: Pick<AccountingRecord, 'id' | 'kind' | 'source'> & Partial<AccountingRecord>): AccountingRecord {
  return { revision: null, date: null, currency: null, total: null, subtotal: null, taxTotal: null, balance: null,
    sourceType: null, direction: 'unknown', status: 'unknown', sourceStatus: null, lines: [], allocations: [], account: null, warnings: [], ...input };
}
export function makeLine(input: Pick<AccountingLine, 'source'> & Partial<AccountingLine>): AccountingLine {
  return { id: null, description: null, quantity: null, unitAmount: null, amount: null, accountId: null, taxAmount: null, taxCode: null, ...input };
}

/** Bounded recursive JSON parser, rejecting duplicate and prototype keys before any field mapping. */
export function parseExactJson(content: string, wireShape = false): unknown {
  check(typeof content === 'string' && Buffer.byteLength(content) <= 4 * 1024 * 1024, 'ACCOUNTING_PAGE_LIMIT', 'Source page exceeds the import limit.');
  const input = content.replace(/^\uFEFF/, ''); let position = 0, values = 0;
  const numericToken = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  const fail = () => check(false, 'ACCOUNTING_JSON_INVALID', 'Malformed or ambiguous JSON source.');
  const whitespace = () => { while (/[\t\r\n ]/.test(input[position] ?? '') && position < input.length) position++; };
  const quoted = (): string => {
    const start = position++; let escaped = false;
    while (position < input.length) {
      const char = input[position++];
      if (!escaped && char === '"') { try { return JSON.parse(input.slice(start, position)); } catch { fail(); } }
      if (!escaped && char.charCodeAt(0) < 32) fail();
      if (!escaped && char === '\\') escaped = true; else escaped = false;
    }
    fail(); return '';
  };
  const value = (depth: number): unknown => {
    check(depth <= 48 && ++values <= 200_000, 'ACCOUNTING_JSON_LIMIT', 'JSON source exceeds the structural limit.'); whitespace();
    const char = input[position];
    if (char === '"') { const result = quoted(); return wireShape ? 'string' : result; }
    if (char === '{') {
      position++; whitespace(); const result: Record<string, unknown> = {};
      if (input[position] === '}') { position++; return result; }
      for (;;) {
        if (input[position] !== '"') fail(); const key = quoted();
        check(!['__proto__', 'prototype', 'constructor'].includes(key) && !Object.hasOwn(result, key), 'ACCOUNTING_JSON_KEY_INVALID', 'Duplicate and reserved source fields are refused.');
        whitespace(); if (input[position++] !== ':') fail(); result[key] = value(depth + 1); whitespace();
        if (input[position] === '}') { position++; return result; }
        if (input[position++] !== ',') fail(); whitespace();
      }
    }
    if (char === '[') {
      position++; whitespace(); const result: unknown[] = [];
      if (input[position] === ']') { position++; return result; }
      for (;;) { result.push(value(depth + 1)); whitespace(); if (input[position] === ']') { position++; return result; } if (input[position++] !== ',') fail(); whitespace(); }
    }
    for (const [literal, result] of [['true', true], ['false', false], ['null', null]] as const) {
      if (input.startsWith(literal, position)) { position += literal.length; return wireShape ? (result === null ? 'null' : 'boolean') : result; }
    }
    numericToken.lastIndex = position;
    const numeric = numericToken.exec(input);
    if (!numeric) { fail(); return null; }
    position += numeric[0].length; return wireShape ? 'number' : numeric[0];
  };
  const result = value(0); whitespace(); if (position !== input.length) fail(); return result;
}

export function responseText(response: AccountingHttpResponse, expectedUrl: string, context: ReadTransportContext): string {
  check(response.content instanceof Uint8Array, 'ACCOUNTING_RESPONSE_INVALID', 'Transport must retain raw source bytes.');
  const bytes = response.content.byteLength;
  if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) throw new ReadTransportError('invalid-request', null, 'settled', bytes);
  if (bytes > context.maxBytes || bytes > 4 * 1024 * 1024) throw new ReadTransportError('invalid-request', null, 'settled', bytes);
  if (response.status >= 300 && response.status < 400 || response.finalUrl !== expectedUrl) throw new ReadTransportError('unsupported', null, 'settled', bytes);
  if (response.status < 200 || response.status >= 300) {
    const kind = response.status === 401 ? 'authentication-expired' : response.status === 403 ? 'permission-denied' : response.status === 429 ? 'rate-limited' : response.status >= 500 ? 'temporarily-unavailable' : 'invalid-request';
    const retryValue = response.headers?.['retry-after'] ?? response.headers?.['Retry-After'];
    // Unsupported HTTP-date/malformed floors force retry-budget refusal; never retry earlier by treating them as absent.
    const retryAfter = retryValue === undefined ? null : /^\d+$/.test(retryValue) && Number(retryValue) <= 86400 ? Number(retryValue) * 1000 : 86_400_000;
    throw new ReadTransportError(kind, retryAfter, 'settled', bytes);
  }
  if (!/^application\/(?:json|[^;]+\+json)(?:;|$)/i.test(response.contentType)) throw new ReadTransportError('unsupported', null, 'settled', bytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(response.content); }
  catch { throw new ReadTransportError('invalid-request', null, 'settled', bytes); }
}

/** Observed wire structure, independent of scalar values and collection ordering. Null/optional variation is deliberately conservative. */
export function wireSchemaFingerprint(value: unknown): string {
  // Pass original JSON text for source fingerprints so numeric and quoted wire values remain distinct.
  const wire = typeof value === 'string';
  if (wire) value = parseExactJson(value as string, true);
  const shape = (item: unknown): unknown => {
    if (Array.isArray(item)) return { array: [...new Set(item.map(entry => JSON.stringify(shape(entry))))].sort() };
    if (item !== null && typeof item === 'object') return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, shape(entry)]));
    return wire ? item : item === null ? 'null' : typeof item;
  };
  return sha256(JSON.stringify(shape(value)));
}

/** Adapters must include already received response bytes when decoding fails. */
export function parseResponse<T>(response: AccountingHttpResponse, expectedUrl: string, context: ReadTransportContext, parse: (content: string) => T): T {
  const content = responseText(response, expectedUrl, context);
  try { return parse(content); }
  catch (error) { if (error instanceof ReadTransportError) throw error; throw new ReadTransportError('invalid-request', null, 'settled', response.content.byteLength); }
}
export function assertCompany(request: ReadPageRequest, companyId: string, organizationId?: string): void {
  check(request.authority.companyId === companyId && (!organizationId || request.authority.organizationId === organizationId)
    && request.dataScope?.company === companyId, 'ACCOUNTING_COMPANY_MISMATCH', 'Read authority and dataset must bind the configured company.');
}
