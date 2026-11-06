// Original Chausar KV target, seo-agent (MIT) ideas only; no copied source.
// Cloudflare REST docs checked 28 October 2026: https://developers.cloudflare.com/api/resources/kv/subresources/namespaces/subresources/values/methods/update/
// KV is eventually consistent. A mismatched readback stays needs-inspection in the existing site journal.
import { check } from '../../contracts.ts';
import { guardedFetch } from '../core/net-guard.ts';
import { CHAUSAR_USER_AGENT, type PoliteNet } from './fetch-policy.ts';
import { contentDigest, sitePath, type SiteTarget } from './site-edits.ts';
export type EdgeConnection = { accountId: string; namespaceId: string; token: string };
/** A key replaces only a previously read value; no remote resources or Workers are created. */
export function cloudflareKvTarget(input: EdgeConnection, net: PoliteNet = {}): SiteTarget {
 check(/^[a-f0-9]{32}$/i.test(input.accountId) && /^[a-f0-9]{32}$/i.test(input.namespaceId) && typeof input.token === 'string' && input.token.length > 0 && input.token.length <= 1000 && !/[\r\n]/.test(input.token), 'EDGE_CONNECTION_INVALID', 'Enter the account, namespace and scoped token from your existing Cloudflare setup.');
 const base = `https://api.cloudflare.com/client/v4/accounts/${input.accountId}/storage/kv/namespaces/${input.namespaceId}/values/`;
 const request = (path: string, method: 'GET' | 'PUT', body?: string) => guardedFetch({ url: base + encodeURIComponent(sitePath(path)), method, body, timeoutMs: 15000, maxBytes: 1024 * 1024, maxRedirects: 0, headers: { authorization: 'Bearer ' + input.token, 'user-agent': CHAUSAR_USER_AGENT, ...(method === 'PUT' ? { 'content-type': 'text/plain; charset=utf-8' } : {}) } }, net);
 async function read(path: string): Promise<string | null> { const answer = await request(path, 'GET'); if (answer.status === 404) return null; check(answer.status === 200, 'EDGE_READ_FAILED', 'Cloudflare did not return this key. Check its access and try later.'); return answer.body.toString('utf8'); }
 return { kind: 'cloudflare-kv', identity: `cloudflare-kv:${input.accountId}/${input.namespaceId}`, writable: true, read,
  async replace(path, content, expectedDigest) {
   const current = await read(path); check(current !== null && contentDigest(current) === expectedDigest, 'SITE_CHANGED_SINCE_REVIEW', 'This key changed since review. Nothing was written.');
   const answer = await request(path, 'PUT', content); let ok = false; try { ok = JSON.parse(answer.body.toString('utf8')).success === true; } catch { /* Ambiguous writes are inspected, never retried. */ }
   check(answer.status === 200 && ok, 'EDGE_WRITE_UNKNOWN', 'Cloudflare did not confirm this write. Inspect the key before any other action.');
  } };
}
