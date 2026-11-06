// Chausar Happenstance read protocol. Proprietary API docs, learn-only; no source copied.
import { check } from '../../../contracts.ts';
import { guardedFetch } from '../../core/net-guard.ts';
import { CHAUSAR_USER_AGENT, type PoliteNet } from '../../build/fetch-policy.ts';
import { digest } from '../../records.ts';
export type HappenstanceQuote = { query: string; credits: string; checkedOn: string; digest: string; source: string };
/** Dated credit quote. A later price table must be rechecked, never guessed. */
export function happenstanceQuote(query: string, today: string): HappenstanceQuote {
  check(typeof query === 'string' && query.trim().length >= 2 && query.length <= 500 && !/[\x00-\x1f]/.test(query), 'INVALID_VENTURE_REQUEST', 'Write the exact network search to approve.');
  const checkedOn = '2026-10-27', age = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${checkedOn}T00:00:00Z`)) / 86400000;
  check(Number.isFinite(age) && age >= 0 && age <= 90, 'LEAD_RATE_STALE', 'Recheck Happenstance credit pricing before searching.');
  const values = { query: query.trim(), credits: '2', checkedOn, source: 'https://developer.happenstance.ai/openapi.json' };
  return { ...values, digest: digest(values) };
}
/** One approved paid read, no retries. Caller journals before entering; keys never enter records or results. */
export async function happenstanceSearch(input: { quote: HappenstanceQuote; approvedDigest: string; key: string }, net: PoliteNet = {}): Promise<{ id: string; url: string; source: string }> {
  const expected = happenstanceQuote(input.quote.query, input.quote.checkedOn);
  check(input.approvedDigest === expected.digest && input.quote.digest === expected.digest && input.quote.credits === expected.credits, 'APPROVAL_CHANGED', 'Approve the exact search and credit cost shown.');
  check(typeof input.key === 'string' && input.key.trim().length >= 8 && input.key.length <= 1000 && !/[\r\n]/.test(input.key), 'KEY_REQUIRED', 'Enter your own Happenstance key.');
  const response = await guardedFetch({ url: 'https://api.happenstance.ai/v1/search', method: 'POST', maxRedirects: 0, timeoutMs: 15000, maxBytes: 100000, headers: { authorization: `Bearer ${input.key}`, 'content-type': 'application/json', 'user-agent': CHAUSAR_USER_AGENT }, body: JSON.stringify({ text: expected.query, include_my_connections: true }) }, net);
  check(response.status === 200, 'HAPPENSTANCE_SEARCH_UNCONFIRMED', 'Happenstance did not confirm the search. Check your account before trying again.');
  let body: any;
  try { body = JSON.parse(response.body.toString('utf8')); } catch { check(false, 'HAPPENSTANCE_SEARCH_UNCONFIRMED', 'Check Happenstance for the search result before trying again.'); }
  check(typeof body.id === 'string' && /^[\w-]{1,100}$/.test(body.id) && typeof body.url === 'string' && new URL(body.url).hostname === 'happenstance.ai' && new URL(body.url).protocol === 'https:', 'HAPPENSTANCE_SEARCH_UNCONFIRMED', 'Check Happenstance for the search result before trying again.');
  return { id: body.id, url: body.url, source: 'from Happenstance' };
}
