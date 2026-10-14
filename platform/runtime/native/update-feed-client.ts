import { isIP } from 'node:net';
import { ChausarError, check } from '../contracts.ts';
import { boundedHttp, type BoundedHttp, type HttpRequest } from '../connectors.ts';
import { MAX_CHANNEL_BYTES, type ReleaseArchitecture, type ReleasePlatform } from './update-channel.ts';

const MAX_SIGNATURE_BYTES = 256, MAX_MANIFEST_BYTES = 64 * 1024, TIMEOUT_MS = 15000;
export type SignedText = Readonly<{ text:string; signature:string }>;

/** Feed URLs must be canonical public HTTPS without credentials, query, fragment, IP literal or custom port. */
export function validateFeedUrl(value:unknown):string {
  let url:URL|undefined; try { url = new URL(value as string); } catch {}
  check(url, 'UPDATE_FEED_URL_REFUSED', 'Configure an explicit HTTPS update feed URL.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  check(url.protocol === 'https:', 'UPDATE_FEED_URL_REFUSED', 'The update feed must use HTTPS.');
  check(!url.username && !url.password, 'UPDATE_FEED_URL_REFUSED', 'The update feed URL must not carry credentials.');
  check(!url.search && !url.hash && (!url.port || url.port === '443') && !isIP(host) && host.includes('.') && !/(?:^|\.)(localhost|local|internal|test)$/.test(host) && url.href === value && url.pathname.endsWith('.json'),
    'UPDATE_FEED_URL_REFUSED', 'The update feed must be a canonical public HTTPS .json URL without query, fragment or custom port.');
  return url.href;
}
/**
 * Fetches the signed channel document (`<feed>.json` + `<feed>.json.sig`) and per-release manifests
 * (`releases/<version>/<platform>-<arch>.json` + `.sig`, relative to the feed) with one bounded request each.
 * No redirects, retries or credentials. Demo mode refuses before any request.
 */
export class UpdateFeedClient {
  #url:string; #http:BoundedHttp; #demo:boolean;
  constructor(options:{ feedUrl:string; http?:BoundedHttp; demo:boolean }) {
    this.#demo = options.demo !== false; this.#url = validateFeedUrl(options.feedUrl); this.#http = options.http ?? boundedHttp;
  }
  get feedUrl() { return this.#url; }
  async #get(url:string, maxBytes:number, accept:string):Promise<string> {
    check(!this.#demo, 'DEMO_EXTERNAL_DISABLED', 'Demo mode keeps update checks switched off.');
    const request:HttpRequest = { url, method: 'GET', headers: { Accept: accept }, maxBytes, timeoutMs: TIMEOUT_MS, redirect: 'error' };
    let response;
    try { response = await this.#http(request); }
    catch (error) { if (error instanceof ChausarError) throw error; check(false, 'UPDATE_FEED_UNAVAILABLE', 'The update feed could not be reached.'); }
    check(!(response.status >= 300 && response.status < 400) && (!response.url || response.url === url), 'UPDATE_FEED_REDIRECT_REFUSED', 'The update feed redirected; redirects are refused.');
    check(response.status === 200, 'UPDATE_FEED_UNAVAILABLE', 'The update feed did not return the requested file.');
    const bytes = typeof response.body === 'string' ? Buffer.from(response.body) : Buffer.from(response.body);
    check(bytes.length <= maxBytes, 'UPDATE_FEED_TOO_LARGE', 'The update feed response exceeds its byte limit.');
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { check(false, 'UPDATE_FEED_INVALID', 'The update feed response is not valid text.'); }
  }
  async #signed(url:string, maxBytes:number):Promise<SignedText> {
    const text = await this.#get(url, maxBytes, 'application/json'), signature = (await this.#get(url + '.sig', MAX_SIGNATURE_BYTES, 'text/plain')).trim();
    return Object.freeze({ text, signature });
  }
  fetchChannel():Promise<SignedText> { return this.#signed(this.#url, MAX_CHANNEL_BYTES); }
  fetchManifest(version:string, platform:ReleasePlatform, architecture:ReleaseArchitecture):Promise<SignedText> {
    check(/^[0-9A-Za-z.-]{5,100}$/.test(version) && ['win32','linux','darwin'].includes(platform) && ['x64','arm64'].includes(architecture), 'INVALID_VERSION', 'Use a validated release version and target.');
    return this.#signed(new URL(`releases/${version}/${platform}-${architecture}.json`, this.#url).href, MAX_MANIFEST_BYTES);
  }
}
