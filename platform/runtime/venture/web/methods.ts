// Chausar venture launcher, web (wave 6, 6F3): the web methods, answered by the network package's table.
// venture.web.search: the AI tool's own search setting and the owner's own search key (web/search.ts).
// venture.web.read: reads one public page with Chausar's polite reader (web/reader.ts) so the owner sees exactly what
// Chausar can read from it: the main text, labelled as from a public page and not confirmed. Nothing is stored.
import { authorize, check, type Context } from '../../contracts.ts';
import type { VentureDeps } from '../contracts.ts';
import { exactPayload, isAppChannel, readVenture } from '../records.ts';
import { readPage, type ReaderOptions } from './reader.ts';
import type { WebReadView } from './search-types.ts';
import { READ_WORDS, readLine } from './search-data.ts';
export { webSearchHandler } from './search.ts';

/** The most of a page's text the read method shows, in characters. */
export const READ_SHOWN = 4000;

/** The reader as this host allows it: the guarded network, and the hidden JavaScript window on the desktop only. */
export function readerOptionsOf(deps: VentureDeps): ReaderOptions {
  return { ...(deps.net ? { net: deps.net } : {}), ...(deps.host === 'desktop' && deps.webRender ? { render: deps.webRender } : {}) };
}

/** venture.web.read { url } (prepare, inside the app). */
export async function webRead(deps: VentureDeps, ctx: Context, payload: unknown): Promise<WebReadView> {
  authorize(deps.store, ctx, 'prepare');
  check(isAppChannel(ctx), 'APP_APPROVAL_REQUIRED', 'Approve this inside the Chausar app.');
  const body = exactPayload(payload, ['url'], ['url']);
  check(typeof body.url === 'string' && body.url.length <= 2048, 'INVALID_VENTURE_REQUEST', READ_WORDS.url);
  check(deps.host !== 'hosted-web', 'PRESET_UNAVAILABLE', READ_WORDS.hosted);
  readVenture(deps, ctx);
  const page = await readPage(body.url.trim(), readerOptionsOf(deps));
  const more = page.text.length > READ_SHOWN;
  return {
    url: page.url, title: page.title, siteName: page.siteName, text: page.text.slice(0, READ_SHOWN), words: page.words, more,
    via: page.via, label: page.label,
    line: readLine(page.words, page.via, page.cached),
  };
}
