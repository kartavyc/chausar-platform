// Chausar own-site enrichment. Ideas from scraper-kit and revenue-squad (MIT), rewritten; no copied source.
import { check } from '../../../contracts.ts';
import { guardedFetch, pinnedSend } from '../../core/net-guard.ts';
import { checkFetchPolicy, robotsSafe, type PoliteNet } from '../../build/fetch-policy.ts';
/** Reads a homepage and at most three same-host contact pages, obeying policy and robots on every redirect. */
export async function enrichSite(raw: string, net: PoliteNet = {}): Promise<{ emails: string[]; pages: string[] }> {
  const home = checkFetchPolicy(raw);
  home.hash = '';
  const pages: string[] = [], all = new Set<string>();
  const links: string[] = [home.href];
  const polite = robotsSafe(net.send ?? pinnedSend, net.resolve);
  for (let index = 0; index < links.length && index < 4; index++) {
    const response = await guardedFetch({ url: links[index], maxBytes: 500000, timeoutMs: 10000 }, { resolve: net.resolve, send: async target => {
      check(target.url.hostname === home.hostname, 'LEAD_HOST_CHANGED', 'Contact pages must stay on the business own site.');
      return polite(target);
    } });
    if (response.status !== 200) continue;
    pages.push(response.url);
    const html = response.body.toString('utf8').replace(/&#64;|&commat;/gi, '@').replace(/&amp;/gi, '&');
    for (const match of html.matchAll(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi)) {
      const email = match[0].toLowerCase().replace(/\.+$/, '');
      if (email.length > 254 || /^(?:no[._-]?reply|donotreply|example|test)@/.test(email) || /\.(?:png|jpg|jpeg|webp|svg|gif|woff|css|js)$/.test(email) || /@(?:example\.com|sentry\.io|wixpress\.com)$/.test(email)) continue;
      all.add(email);
    }
    if (index === 0) for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      let link: URL;
      try { link = new URL(match[1], home); } catch { continue; }
      link.hash = '';
      if (link.hostname === home.hostname && /^https?:$/.test(link.protocol) && !link.username && !link.password && /contact|about|support/i.test(`${link.pathname} ${match[2]}`) && !links.includes(link.href) && links.length < 4) links.push(link.href);
    }
  }
  const host = home.hostname.replace(/^www\./, '');
  const own = (email: string) => { const domain = email.split('@')[1]; return domain === host || domain.endsWith(`.${host}`); };
  return { emails: [...all].sort((a, b) => Number(own(b)) - Number(own(a))).slice(0, 3), pages };
}
