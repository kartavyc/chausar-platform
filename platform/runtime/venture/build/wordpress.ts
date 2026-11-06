// Original Chausar WordPress adapter, WordPress REST handbook checked 28 October 2026.
// https://developer.wordpress.org/rest-api/reference/posts/ and authentication documentation.
// loamwright (Apache-2.0) supplied ideas only; no third-party source copied.
import { check } from '../../contracts.ts';
import { checkUrl, guardedFetch, resolvePublic, pinnedSend } from '../core/net-guard.ts';
import { politeFetch, type PoliteNet, CHAUSAR_USER_AGENT } from './fetch-policy.ts';
import { digest } from '../records.ts';
import {observedArticle} from '../playbooks/seo-visibility/observed-article.ts';
export type WordpressConnection = { url: string; username: string; password: string };
export type WordpressDraft = { title: string; content: string; status: 'draft' };
export type WordpressResult = { outcome: 'applied' | 'not-sent' | 'unknown'; id: number | null; link: string | null; line: string };
/** The client-owned installation may live in a subdirectory. Credentials never enter its URL. */
export function wordpressUrl(raw: string): URL {
 const url = checkUrl(raw); check(url.protocol === 'https:' && !url.search && !url.hash, 'WORDPRESS_SITE_INVALID', 'Use the public HTTPS address of the client WordPress installation.');
 url.pathname = url.pathname.replace(/\/+$/, '') + '/'; return url;
}
/** Called once inside the owner's journalled action. An ambiguous response is never retried. */
export async function sendWordpressDraft(config: WordpressConnection, draft: WordpressDraft, net: PoliteNet = {}): Promise<WordpressResult> {
 check(draft.status === 'draft', 'WORDPRESS_DRAFT_ONLY', 'Chausar creates WordPress drafts only. Publish them yourself.');
 check(typeof draft.title === 'string' && draft.title.trim().length > 0 && draft.title.length <= 300 && typeof draft.content === 'string' && draft.content.trim().length > 0 && draft.content.length <= 200000, 'WORDPRESS_DRAFT_INVALID', 'Choose a title and a bounded article draft.');
 check(typeof config.username === 'string' && config.username.trim().length > 0 && !/[:\r\n]/.test(config.username) && typeof config.password === 'string' && config.password.length > 0 && config.password.length <= 300, 'WORDPRESS_CREDENTIALS_REQUIRED', 'Enter the client username and application password in Connections.');
 const site = wordpressUrl(config.url); await resolvePublic(site.hostname, net.resolve);
 try {
  const answer = await guardedFetch({ url: new URL('wp-json/wp/v2/posts', site).href, method: 'POST', maxRedirects: 0, timeoutMs: 15000, maxBytes: 1024 * 1024,
   headers: { authorization: 'Basic ' + Buffer.from(config.username + ':' + config.password).toString('base64'), 'content-type': 'application/json', 'user-agent': CHAUSAR_USER_AGENT }, body: JSON.stringify({ title: draft.title, content: draft.content, status: 'draft' }) }, net);
  if (answer.status >= 400 && answer.status < 500) return { outcome: 'not-sent', id: null, link: null, line: 'WordPress refused this draft. Review the connection before trying again.' };
  if (answer.status === 201) { const body = JSON.parse(answer.body.toString('utf8')); if (Number.isSafeInteger(body.id) && body.id > 0 && body.status === 'draft') { let link: string | null = null; try { const url = checkUrl(body.link); if (url.origin === site.origin) link = url.href; } catch { /* No trusted link was returned. */ } return { outcome: 'applied', id: body.id, link, line: 'WordPress saved a draft. Publish it yourself after reviewing it there.' }; } }
 } catch { /* The request may have reached WordPress. Never infer that a timeout means no draft. */ }
 return { outcome: 'unknown', id: null, link: null, line: 'WordPress may have saved the draft. Check the site before doing anything else. Chausar will not retry it.' };
}
/** After owner publishing, check observed public structure with robots and no credentials. */
export async function verifyWordpressLive(input: { url: string; siteUrl:string; title: string; heading: string; text:string }, net: PoliteNet = {}) {
 check(input.title.trim().length > 0 && input.heading.trim().length > 0, 'WORDPRESS_DRAFT_INVALID', 'Name the expected title and main heading.');
 check(typeof input.text==='string'&&input.text.trim().length>0&&input.text.length<=200000,'WORDPRESS_DRAFT_INVALID','Verify the exact approved article text.');
 const site=wordpressUrl(input.siteUrl),scope=(url:URL)=>url.origin===site.origin&&url.pathname.startsWith(site.pathname);
 check(scope(checkUrl(input.url)),'WORDPRESS_SITE_MISMATCH','Verify a page inside the connected client installation.');
 const answer = await politeFetch({ url: input.url, maxBytes: 1024 * 1024, timeoutMs: 15000, headers: { 'user-agent': CHAUSAR_USER_AGENT } }, {...net,send:target=>{check(target.url.origin===site.origin&&(target.url.pathname==='/robots.txt'||scope(target.url)),'WORDPRESS_SITE_MISMATCH','The page redirected outside the connected client installation.');return (net.send??pinnedSend)(target);}});
 check(scope(checkUrl(answer.url)),'WORDPRESS_SITE_MISMATCH','The page redirected outside the connected client installation.');
 const html = answer.body.toString('utf8'),{titles,headings,articles}=observedArticle(html);
 const expected=input.text.replace(/\r\n/g,'\n');
 const checks = [{ id: 'public-page', pass: answer.status === 200 }, { id: 'title', pass: titles.length===1&&titles[0] === input.title.trim() }, { id: 'main-heading', pass: headings.length === 1 && headings[0] === input.heading.trim() },{id:'approved-article',pass:articles.length===1&&articles[0]===expected}];
 return { pass: checks.every(c => c.pass), checks, url: answer.url, receipt: digest({ url: answer.url, html,approvedText:input.text }), articleDigest:digest(input.text),line: 'This verifies the exact approved article and observed page structure. It makes no ranking claim.' };
}
