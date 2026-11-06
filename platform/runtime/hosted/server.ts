// Chausar hosted tier: the HTTP server. Experimental and off by default: it starts only with CHAUSAR_HOSTED=1 or --hosted.
//   node platform/runtime/hosted/server.ts --hosted --dev      (npm run start:hosted: http://localhost:4320, development outbox)
// Every response carries a strict content policy. Every POST must come from the configured origin. Sessions live in
// HttpOnly SameSite=Strict cookies; /api/rpc also needs the page's bearer, an HMAC of the session id. The app at /app/ is
// the built Ink app (app/ui/dist), the same build as the desktop, served from an allowlist made at startup and told by
// one meta tag that it runs hosted. Without the build the server refuses to start (npm run build:ui).
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { ChausarError, check } from '../contracts.ts';
import { openLoopbackPool, type PostgresPool } from '../postgres.ts';
import { SESSION_TTL_MS, type Authenticated, type Browser, type SignedIn } from './accounts.ts';
import { HostedApp, SHARE_TOKEN_PATTERN, type FileRequestPageView, type SharePageView } from './app.ts';
import { hostedConfig, type HostedConfig } from './config.ts';
import { HostedCustody } from './custody.ts';
import { hostedPushPort } from './notify.ts';
import { NOT_A_TRIAL_LINE, TRIAL_OFF_LINE } from './trial.ts';
import { FileDirectory, PostgresDirectory, type HostedDirectory } from './directory.ts';
import { DevOutbox, NoMailer, type Mailer } from './mailer.ts';
import { runEventFromActor, sseFrame } from '../venture/views/events.ts';
import { INK_ROOT, INK_TYPES, listInkFiles } from '../ui-ink.ts';
import {siteFormHttp} from '../venture/playbooks/website-studio/form-http.ts';
import {storefrontWidgetHttp} from '../venture/build/storefront-widget-http.ts';
import { supportRatingHtml } from '../venture/playbooks/support-desk/rating-link.ts';

const hostedDir = fileURLToPath(new URL('../../../app/hosted/', import.meta.url));
const TYPES: Readonly<Record<string, string>> = INK_TYPES; // html, js, css, svg, and the Ink build's fonts and data
/** The sign-in page and its two files. Everything under /app/ comes from the Ink build's own allowlist instead. */
const STATIC: Record<string, [string, string]> = {
  '/': [hostedDir, 'index.html'], '/index.html': [hostedDir, 'index.html'], '/hosted.js': [hostedDir, 'hosted.js'], '/hosted.css': [hostedDir, 'hosted.css'],
};
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' data:; img-src 'self' data:; media-src 'self' data:; connect-src 'self'; frame-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
const HOSTED_META = '<meta name="chausar-mode" content="hosted">';

// The client share page (/share/<token>): plain HTML, no scripts, one style allowed by its hash, a form that posts to
// itself and nowhere else. Every field is escaped text. The token is only in the address; the page never repeats it.
const SHARE_STYLE = ':root{color-scheme:light dark;--bg:#fbfbfa;--fg:#16181b;--mute:#5c6168;--line:#e3e5e8}'
  + '@media (prefers-color-scheme:dark){:root{--bg:#111214;--fg:#eceef0;--mute:#9aa0a6;--line:#2a2d31}}'
  + 'body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}'
  + 'main{max-width:40rem;margin:0 auto;padding:2.5rem 1rem 4rem}h1{font-size:1.6rem;font-weight:600;margin:.25rem 0 .5rem}'
  + '.mute{color:var(--mute);font-size:13px;margin:0}.text{white-space:pre-wrap;border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:1.25rem 0;margin:1.5rem 0}'
  + 'form{display:grid;gap:.5rem}label{font-size:13px;color:var(--mute)}textarea{font:inherit;color:inherit;background:transparent;border:1px solid var(--line);border-radius:6px;padding:.5rem}'
  + '.actions{display:flex;gap:.5rem;justify-content:flex-end;margin-top:.5rem}button{font:inherit;border-radius:6px;padding:.45rem .9rem;border:1px solid var(--line);background:transparent;color:inherit;cursor:pointer}'
  + 'button.primary{background:var(--fg);color:var(--bg);border-color:var(--fg)}.said{font-weight:500}'
  + '.item{border-top:1px solid var(--line);padding:1rem 0}.item p{white-space:pre-wrap;margin:.25rem 0 .75rem}input[type=file]{font:inherit}';
const SHARE_CSP = `default-src 'none'; style-src 'sha256-${createHash('sha256').update(SHARE_STYLE).digest('base64')}'; img-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`;
/** A share page form: room for a 1,000-character comment in Hindi, every character percent-encoded (4J7). */
const SHARE_MAX_FORM_BYTES = 12_288;
/**
 * The most a file request's upload body may be (4J7, K9): an order file's own limit (MAX_UPLOAD_BYTES in
 * venture/delivery/harness/files.ts, 1,450,000 bytes, which the vault checks again) and room for the form's own lines.
 */
export const UPLOAD_MAX_BODY_BYTES = 1_450_000 + 16_384;
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
const SHARE_GONE = 'This link does not open. It may have ended or been taken back. Ask whoever sent it for a new one.';

function shareDocument(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`
    + `<meta name="robots" content="noindex, nofollow"><title>${escapeHtml(title)}</title><style>${SHARE_STYLE}</style></head><body><main>${body}</main></body></html>`;
}

/** What each kind of link says it shares (4J7). */
const SHARED_WORDS: Readonly<Record<NonNullable<SharePageView['kind']>, string>> = Object.freeze({
  draft: 'shared a draft with you. Read only.', 'order-status': 'shared where your order stands. Read only.',
  statement: 'shared what you owe them. Read only.', books: 'shared a month of its books with you. Read only.',
  report: 'shared a report with you. Read only.', // 5A5 (playbooks/kit/report/share.ts)
});

/**
 * The page for an open link: what it shares, read only. A draft link also has the client's answer or the form to give
 * it, and while it may answer, a comment form for each post (4J7, O20). Other kinds have no form at all.
 */
function sharePageHtml(page: SharePageView, said: string | null): string {
  const kind = page.kind ?? 'draft';
  const canAnswer = page.canAnswer ?? !page.decision;
  let decision = '';
  if (page.canRequest) {
    decision='<form method="post"><input type="hidden" name="item" value="room-request"><label for="request">What do you need? / आपको क्या चाहिए?</label><textarea id="request" name="text" rows="4" maxlength="1000" required></textarea><div class="actions"><button class="primary" type="submit">Send request / अनुरोध भेजें</button></div></form>';
  } else if (kind === 'draft') {
    decision = page.decision
      ? `<p class="said">${page.decision.decision === 'approved' ? 'You approved this draft.' : 'You asked for changes.'}</p>`
        + (page.decision.comment ? `<p>${escapeHtml(page.decision.comment)}</p>` : '')
      : !canAnswer ? '<p class="mute">This link can\'t answer for the draft. Ask whoever sent it for a new one.</p>'
        : `<form method="post"><input type="hidden" name="digest" value="${escapeHtml(page.digest)}">`
          + `<label for="comment">Anything to change? (optional)</label><textarea id="comment" name="comment" rows="3" maxlength="1000"></textarea>`
          + `<div class="actions"><button type="submit" name="decision" value="changes">Ask for changes</button>`
          + `<button class="primary" type="submit" name="decision" value="approved">Approve</button></div></form>`;
  }
  const items = kind === 'draft' && canAnswer && !page.decision ? (page.items ?? []).map((item, index) => `<div class="item"><p class="mute">${escapeHtml(item.name)}</p><p>${escapeHtml(item.text)}</p>`
    + `<form method="post"><input type="hidden" name="item" value="${escapeHtml(item.id)}"><label for="note-${index + 1}">A comment on this post (optional)</label>`
    + `<textarea id="note-${index + 1}" name="text" rows="2" maxlength="1000"></textarea><div class="actions"><button type="submit">Send the comment</button></div></form></div>`).join('') : '';
  const comments = (page.comments ?? []).length
    ? `<div class="item"><p class="mute">Your comments</p>${(page.comments ?? []).map(item => `<p>${escapeHtml(item.text)}</p>`).join('')}</div>` : '';
  return shareDocument(`${page.title} from ${page.businessName}`,
    `<p class="mute">${escapeHtml(page.businessName)} ${SHARED_WORDS[kind]}</p><h1>${escapeHtml(page.title)}</h1>`
    + `<p class="mute">This link ends on ${escapeHtml(page.expires)}.</p>${said ? `<p class="said">${escapeHtml(said)}</p>` : ''}`
    + `<div class="text">${escapeHtml(page.text)}</div>${decision}${items}${comments}`);
}

/** The client's file request page (4J7, K9): the note, the line about where the file goes, and one file field. */
function uploadPageHtml(page: FileRequestPageView, said: string | null): string {
  if (!page.open) return shareDocument(`A file for ${page.businessName}`, `<h1>Nothing to send here</h1><p>${escapeHtml(page.reason)}</p>${said ? `<p class="said">${escapeHtml(said)}</p>` : ''}`);
  const megabytes = (page.maxBytes / 1_000_000).toFixed(2).replace(/0$/, '');
  return shareDocument(`A file for ${page.businessName}`,
    `<p class="mute">${escapeHtml(page.businessName)} asked you for a file.</p><h1>Send a file</h1>`
    + (page.note ? `<div class="text">${escapeHtml(page.note)}</div>` : '')
    + `<p>${escapeHtml(page.line)}</p><p class="mute">One file, at most ${megabytes} MB: CSV or XLSX, or a transcript as SRT or VTT. This link works once and ends at ${escapeHtml(page.expires)}.</p>`
    + `${said ? `<p class="said">${escapeHtml(said)}</p>` : ''}`
    + `<form method="post" enctype="multipart/form-data"><label for="file">Your file</label><input id="file" type="file" name="file" required>`
    + `<div class="actions"><button class="primary" type="submit">Send the file</button></div></form>`);
}

/**
 * One file from a multipart/form-data body: exactly one part, named "file", with a file name. Anything else is refused.
 * The name's bytes are read as UTF-8, and only its last path part is kept.
 */
export function multipartFile(body: Buffer, contentType: string): { name: string; bytes: Buffer } {
  const boundary = /boundary=(?:"([^"]{1,70})"|([^;\s]{1,70}))/i.exec(contentType);
  check(boundary, 'INVALID_REQUEST', 'Send the file from the page itself.');
  const mark = Buffer.from(`--${boundary[1] ?? boundary[2]}`, 'latin1');
  const parts: Buffer[] = [];
  let at = body.indexOf(mark);
  check(at === 0, 'INVALID_REQUEST', 'Send the file from the page itself.');
  while (at >= 0) {
    const start = at + mark.length;
    if (body.subarray(start, start + 2).toString('latin1') === '--') break;
    const next = body.indexOf(mark, start);
    check(next > start, 'INVALID_REQUEST', 'Send the file from the page itself.');
    // Each part sits between "\r\n" after the boundary and "\r\n" before the next one.
    parts.push(body.subarray(start + 2, next - 2));
    at = next;
  }
  check(parts.length === 1, 'INVALID_REQUEST', 'Send one file.');
  const part = parts[0];
  const split = part.indexOf('\r\n\r\n');
  check(split > 0, 'INVALID_REQUEST', 'Send the file from the page itself.');
  const headers = part.subarray(0, split).toString('latin1');
  const disposition = /^content-disposition:\s*form-data;([^\r\n]*)$/im.exec(headers);
  check(disposition && /\bname="file"/.test(disposition[1]), 'INVALID_REQUEST', 'Send the file from the page itself.');
  const filename = /\bfilename="([^"]*)"/.exec(disposition[1]);
  check(filename && filename[1].length > 0, 'INVALID_REQUEST', 'Choose a file first.');
  const name = Buffer.from(filename[1], 'latin1').toString('utf8').split(/[\\/]/).pop()!.trim();
  check(name.length > 0, 'INVALID_REQUEST', 'Choose a file first.');
  return { name, bytes: part.subarray(split + 4) };
}

// The hosted app's manifest (4J9): the Ink build's own manifest.webmanifest with one change, its name, "Chausar: {the
// open business}" for a signed-in owner. The name comes from the session's own business list in the directory: no
// vault is opened, and nothing about the owner (email, first name) is ever in it. That is the name the business got
// when it was made on this server, which can differ from the working name inside the app after a rename; accepted, as
// reading the working name would mean opening the vault for every manifest fetch. The desktop and the local web keep
// the build's static file.
const MANIFEST_PATH = '/app/manifest.webmanifest';
const MANIFEST_NAME_MAX = 45;
/** Used when the build has no manifest of its own (or one that is not a JSON object). */
const PLAIN_MANIFEST = Object.freeze({
  name: 'Chausar', short_name: 'Chausar', start_url: './', scope: './', display: 'standalone',
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
});
/** Bidirectional controls, which can make a name read backwards on the home screen. */
const DIRECTION_CONTROLS = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

/** "Chausar: {business}" when the business has a name and the whole fits 45 characters; otherwise "Chausar". */
function manifestName(business: string | null): string {
  const clean = (business ?? '').replace(DIRECTION_CONTROLS, '').replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim();
  const name = `Chausar: ${clean}`;
  return clean && [...name].length <= MANIFEST_NAME_MAX ? name : 'Chausar';
}

/** JSON with <, >, & and the two line separators written as escapes, so no reader can take the name for markup. */
const manifestJson = (manifest: Record<string, unknown>) =>
  JSON.stringify(manifest, null, 2).replace(/[<>&\u2028\u2029]/g, ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);

/** A link tag whose rel holds the manifest token, quoted or not. */
const MANIFEST_REL = /\srel\s*=\s*(?:"[^"]*\bmanifest\b[^"]*"|'[^']*\bmanifest\b[^']*'|manifest(?=[\s/>]))/i;
/** A crossorigin attribute in any form: bare, or with a quoted or plain value. */
const CROSSORIGIN_ATTRIBUTE = /\s+crossorigin(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?(?=[\s/>])/gi;

/**
 * The page's manifest link asks with credentials: without crossorigin="use-credentials" a browser fetches the manifest
 * without the session cookie, and the name would always be "Chausar". Idempotent: whatever crossorigin the build wrote
 * is replaced, never doubled; a page with no manifest link is left as it is.
 */
function manifestLinkWithCookie(html: string): string {
  return html.replace(/<link\b[^>]*>/gi, tag => !MANIFEST_REL.test(tag) ? tag : tag.replace(CROSSORIGIN_ATTRIBUTE, '')
    .replace(/\s*(\/?)>$/, (_end, slash: string) => (slash ? ' crossorigin="use-credentials" />' : ' crossorigin="use-credentials">')));
}
const MAX_STREAMS_PER_USER = 3;

export type HostedServerOptions = {
  origin: string;
  tls: HostedConfig['tls'];
  trustProxy: boolean;
  /** With trustProxy: how many proxies stand in front (config.proxyHops); the address is that many entries from the right. Default 1. */
  proxyHops?: number;
  maxBodyBytes: number;
  /** Loaded certificate files when tls.kind is 'files'. */
  certificate?: { cert: Buffer; key: Buffer };
  /** The built Ink app and its allowlist (listInkFiles), served at /app/. startHosted always passes it; without it (tests
   * of the API alone) /app/ answers 404. */
  ink?: { folder: string; files: Record<string, string> };
};

const statusOf = (code: string | undefined) => {
  switch (code) {
    case 'NOT_FOUND': return 404;
    case 'UNAUTHENTICATED': return 401;
    case 'METHOD_NOT_ALLOWED': return 405;
    case 'RATE_LIMITED': return 429;
    case 'REQUEST_TOO_LARGE': return 413;
    case 'HOSTED_BUSY': case 'HOSTED_STOPPING': case 'HOSTED_STORAGE_UNAVAILABLE': return 503;
    case 'FORBIDDEN': case 'INVALID_HOST': case 'INVALID_ORIGIN': return 403;
    default: return 400;
  }
};

function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of (header ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at <= 0) continue;
    const name = part.slice(0, at).trim(), value = part.slice(at + 1).trim();
    if (!cookies.has(name)) cookies.set(name, value);
  }
  return cookies;
}

async function readJson(req: IncomingMessage, limit: number): Promise<unknown> {
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    check(size <= limit, 'REQUEST_TOO_LARGE', 'This request is too large.');
    chunks.push(chunk);
  }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw new ChausarError('INVALID_REQUEST', 'Send JSON.'); }
  const inspect = (input: unknown, depth: number) => {
    check(depth < 40, 'INVALID_REQUEST', 'Request nesting is too deep.');
    if (input && typeof input === 'object') for (const [key, item] of Object.entries(input)) {
      check(!['__proto__', 'prototype', 'constructor'].includes(key), 'INVALID_REQUEST', 'Unsafe object keys are not accepted.');
      inspect(item, depth + 1);
    }
  };
  inspect(value, 0);
  return value;
}

export function createHostedServer(app: HostedApp, options: HostedServerOptions) {
  const origin = new URL(options.origin);
  const secure = origin.protocol === 'https:';
  const names = secure ? { session: '__Host-chausar-session', browser: '__Host-chausar-browser' } : { session: 'chausar-session', browser: 'chausar-browser' };
  const streams = new Map<string, number>();
  let closing = false;
  /** The files served as they are: the sign-in page, and everything under /app/ from the Ink build's own allowlist. */
  const ink = options.ink ?? null;
  const staticFile = (path: string): readonly [string, string] | null => {
    if (ink && path.startsWith('/app/')) { const key = path.slice('/app'.length); return Object.hasOwn(ink.files, key) ? [ink.folder, ink.files[key]] : null; }
    return Object.hasOwn(STATIC, path) ? STATIC[path] : null;
  };

  const cookie = (name: string, value: string, maxAgeSeconds: number) =>
    `${name}=${value}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}; Max-Age=${maxAgeSeconds}`;

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const setCookies: string[] = [];
    const send = (status: number, body: unknown, extra: Record<string, string> = {}) => {
      if (setCookies.length) res.setHeader('Set-Cookie', setCookies);
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
      res.end(JSON.stringify(body));
    };
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    try {
      check(!closing, 'HOSTED_STOPPING', 'The server is restarting. Try again in a moment.');
      check(req.headers.host === origin.host, 'INVALID_HOST', 'This address is not served here.');
      const url = new URL(req.url ?? '/', origin);
      // With more than one server process, sessions and sign-ins made by the others are in the shared store.
      if (url.pathname.startsWith('/api/') && url.pathname !== '/api/health') await app.options.directory.refresh?.();
      const cookies = parseCookies(req.headers.cookie);
      // Behind trusted proxies, each appends the address it saw: the browser's is the entry as many from the right as
      // there are proxies (1: the last). Every entry before it came from the browser, which can write anything there.
      // A header shorter than that did not come through all of them, so the connection's own address is used.
      const hops = options.proxyHops ?? 1;
      const entries = typeof req.headers['x-forwarded-for'] === 'string' ? req.headers['x-forwarded-for'].split(',').map(part => part.trim()).filter(Boolean) : [];
      const forwarded = hops >= 1 && entries.length >= hops ? entries[entries.length - hops] : '';
      const address = (options.trustProxy && forwarded) || req.socket.remoteAddress || 'unknown';
      const binding = (create: boolean): string => {
        const current = cookies.get(names.browser);
        if (current && /^[A-Za-z0-9_-]{43}$/.test(current)) return current;
        check(create, 'SIGN_IN_RESTART', 'Start signing in again from this browser.');
        const fresh = randomBytes(32).toString('base64url');
        setCookies.push(cookie(names.browser, fresh, 86400));
        return fresh;
      };
      const browser = (create: boolean): Browser => ({ binding: binding(create), address });
      // 4J7: /share/<token>/upload is the client's file request page; a share page knows its owner's own session (a preview).
      if (/^\/share\/[A-Za-z0-9_-]{32}\/upload$/.test(url.pathname)) return await upload(url.pathname.slice('/share/'.length, -'/upload'.length), address, req, res);
      if (url.pathname.startsWith('/site-form/')) return await siteFormHttp(app, url.pathname.slice('/site-form/'.length), address, req, res);
      if (url.pathname.startsWith('/store-assistant/')) return await storefrontWidgetHttp(app,url.pathname.slice('/store-assistant/'.length),address,origin.origin,req,res);
      if (url.pathname.startsWith('/support-rating/')) return await supportRating(url.pathname.slice('/support-rating/'.length), address, req, res);
      if (url.pathname === '/share' || url.pathname.startsWith('/share/')) return await share(url.pathname.slice('/share/'.length), address, req, res, cookies.get(names.session));
      const auth = (): Authenticated => app.accounts.authenticate(cookies.get(names.session));
      const signIn = (signed: SignedIn) => {
        setCookies.push(cookie(names.session, signed.token, Math.floor(SESSION_TTL_MS / 1000)));
        return { user: signed.user, session: signed.session, created: signed.created, ...(signed.claimed ? { claimed: true } : {}) };
      };
      /** A temporary business's cookie lasts as long as it does: 7 days from this use (4J23). */
      const trialCookie = (token: string) => setCookies.push(cookie(names.session, token, Math.floor(app.options.limits.trialIdleMs / 1000)));

      if (req.method === 'GET' || req.method === 'HEAD') {
        if (url.pathname === '/app') { res.writeHead(308, { Location: '/app/' }); res.end(); return; }
        if (ink && url.pathname === MANIFEST_PATH) return await manifest(ink.folder, cookies.get(names.session), req, res);
        const found = staticFile(url.pathname);
        if (found) {
          const [base, file] = found;
          let data: Buffer | string = await readFile(join(base, file));
          if (url.pathname === '/app/' || url.pathname === '/app/index.html') {
            data = manifestLinkWithCookie(data.toString('utf8').replace('<head>', `<head>\n  ${HOSTED_META}`));
          }
          if (file.endsWith('.html')) binding(true);
          if (setCookies.length) res.setHeader('Set-Cookie', setCookies);
          res.writeHead(200, { 'Content-Type': TYPES[file.slice(file.lastIndexOf('.'))] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
          res.end(req.method === 'HEAD' ? undefined : data);
          return;
        }
        // 4J21: whether this server lets people start without an account, so the sign-in page offers it only then.
        if (url.pathname === '/api/health') {
          // With trials on, how long a temporary business lasts after its last use (trial.ts), so the page says it truly.
          const limits = app.options.limits;
          const trial = app.options.trials === true ? { trialIdleDays: Math.max(1, Math.round(limits.trialIdleMs / 86_400_000)), trialEmptyMinutes: Math.round(limits.trialEmptyMs / 60_000) } : {};
          return send(200, { status: 'ok', mode: 'hosted-experimental', trials: app.options.trials === true, ...trial });
        }
        if (url.pathname === '/api/hosted/session') {
          const session = auth();
          if (session.session.method === 'trial') trialCookie(cookies.get(names.session) as string);
          return send(200, { token: app.options.custody.rendererKey(session.session.id), me: app.me(session) });
        }
        if (url.pathname === '/api/hosted/events') return stream(auth(), req, res);
        // The Ink app's run events: the session cookie and the page's bearer, as /api/rpc asks for.
        if (url.pathname === '/api/events') {
          const session = auth();
          const bearer = req.headers.authorization ?? '';
          check(bearer.startsWith('Bearer ') && app.options.custody.sameRendererKey(session.session.id, bearer.slice(7)), 'UNAUTHENTICATED', 'Your session ended. Sign in again.');
          return stream(session, req, res, true);
        }
        throw new ChausarError('NOT_FOUND', 'Nothing is here.');
      }

      check(req.method === 'POST', 'METHOD_NOT_ALLOWED', 'Use POST for requests.');
      check(req.headers.origin === origin.origin, 'INVALID_ORIGIN', 'Requests must come from the Chausar page.');
      const site = req.headers['sec-fetch-site'];
      check(site === undefined || site === 'same-origin', 'INVALID_ORIGIN', 'Requests must come from the Chausar page.');
      check((req.headers['content-type'] ?? '').startsWith('application/json'), 'INVALID_CONTENT_TYPE', 'Send JSON.');
      const body = await readJson(req, options.maxBodyBytes) as Record<string, unknown>;
      check(body && typeof body === 'object' && !Array.isArray(body), 'INVALID_REQUEST', 'Send one request object.');

      switch (url.pathname) {
        case '/api/auth/magic-link': return send(200, await app.accounts.requestMagicLink(body, browser(true)));
        case '/api/auth/magic-link/verify': return send(200, signIn(await app.accounts.verifyMagicLink(body, browser(false))));
        case '/api/auth/passkey/login/options': return send(200, await app.accounts.passkeyLoginOptions(browser(true)));
        case '/api/auth/passkey/login/verify': {
          check(Object.keys(body).every(key => key === 'credential'), 'INVALID_REQUEST', 'Send the passkey answer.');
          return send(200, signIn(await app.accounts.passkeyLoginVerify(body.credential, browser(false))));
        }
        case '/api/auth/passkey/register/options': return send(200, await app.accounts.passkeyRegisterOptions(auth()));
        case '/api/auth/passkey/register/verify': return send(200, await app.accounts.passkeyRegisterVerify(auth(), body));
        case '/api/auth/passkey/remove': return send(200, await app.accounts.removePasskey(auth(), body));
        case '/api/auth/sign-out': {
          const session = auth();
          check(Object.keys(body).every(key => key === 'everywhere') && (body.everywhere === undefined || typeof body.everywhere === 'boolean'), 'INVALID_REQUEST', 'Send everywhere as true or false.');
          const result = await app.accounts.signOut(session, body.everywhere === true);
          setCookies.push(cookie(names.session, '', 0));
          return send(200, result);
        }
        case '/api/account/delete': {
          const result = await app.accounts.deleteAccount(auth(), body);
          setCookies.push(cookie(names.session, '', 0));
          return send(200, result);
        }
        case '/api/hosted/select': return send(200, await app.select(auth(), body));
        // Ink v2 wave 4 (4J23): start without an account, then keep the business with an email link or an account's
        // passkey. The email travels only in the body; the link is the sign-in link's own #signin= pattern.
        case '/api/hosted/trial': {
          // Off unless the server was started with trials on (CHAUSAR_HOSTED_TRIALS). Claiming stays open either way.
          check(app.options.trials === true, 'HOSTED_NOT_AVAILABLE', TRIAL_OFF_LINE);
          check(Object.keys(body).length === 0, 'INVALID_REQUEST', 'Send an empty request.');
          const started = await app.accounts.startTrial(browser(true), cookies.get(names.session));
          trialCookie(started.token);
          return send(200, { user: started.user, session: started.session, created: started.created, trial: app.trialView(app.accounts.authenticate(started.token)) });
        }
        case '/api/hosted/trial/claim': return send(200, await app.accounts.requestClaimLink(auth(), body, browser(true)));
        case '/api/hosted/trial/claim/passkey': {
          const session = auth();
          check(session.session.method === 'trial' && session.user.trial, 'NOT_A_TRIAL', NOT_A_TRIAL_LINE);
          check(Object.keys(body).every(key => key === 'credential'), 'INVALID_REQUEST', 'Send the passkey answer.');
          return send(200, signIn(await app.accounts.passkeyLoginVerify(body.credential, browser(false), session.user.id)));
        }
        case '/api/rpc': {
          const session = auth();
          const bearer = req.headers.authorization ?? '';
          check(bearer.startsWith('Bearer ') && app.options.custody.sameRendererKey(session.session.id, bearer.slice(7)), 'UNAUTHENTICATED', 'Your session ended. Sign in again.');
          check(Object.keys(body).every(key => key === 'method' || key === 'payload'), 'INVALID_REQUEST', 'Send a method and a payload.');
          return send(200, { result: await app.rpc(session, body.method, body.payload) });
        }
        default: throw new ChausarError('NOT_FOUND', 'Nothing is here.');
      }
    } catch (error) {
      // Only Chausar's own refusals show their words. Node's errors (ENOENT, ERR_...) can carry paths, so they don't.
      const raw = error as { code?: unknown; syscall?: unknown; errno?: unknown };
      const known = error instanceof ChausarError || (typeof raw?.code === 'string' && /^[A-Z_]{1,64}$/.test(raw.code) && !raw.code.startsWith('ERR_')
        && raw.syscall === undefined && raw.errno === undefined);
      const code = known ? (error as ChausarError).code : 'SERVER_ERROR';
      const message = known ? (error as Error).message : 'Something went wrong on the server. Nothing was changed by this request.';
      if (!known) console.error('[hosted] request failed', (error as Error)?.stack ?? error);
      if (res.headersSent) { res.end(); return; }
      const extra: Record<string, string> = {};
      if (code === 'RATE_LIMITED') extra['Retry-After'] = String((error as any).retryAfterSeconds ?? 60);
      send(statusOf(code), { error: { code, message } }, extra);
    }
  };

  /**
   * The share and upload pages' own answer: their content policy, and Referrer-Policy same-origin (4J7) in place of the
   * server's no-referrer, so a browser posting the page's own form sends the page's origin rather than "null".
   */
  const sharePageWriter = (req: IncomingMessage, res: ServerResponse) => (status: number, html: string) => {
    res.setHeader('Content-Security-Policy', SHARE_CSP);
    res.setHeader('Referrer-Policy', 'same-origin');
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : html);
  };

  /**
   * A POST from the share or upload page itself: its own origin, or "null" (what a browser sends for a page served with
   * no-referrer, an older copy of the page) only when the browser also says the request is same-origin. Any other
   * Sec-Fetch-Site is refused; a client without it (an old browser) must name the origin.
   */
  const fromThisPage = (req: IncomingMessage): boolean => {
    const site = req.headers['sec-fetch-site'];
    if (site !== undefined && site !== 'same-origin') return false;
    return req.headers.origin === origin.origin || (req.headers.origin === 'null' && site === 'same-origin');
  };

  /** 5G: one optional customer rating, no scripts, pixels, cookies or ticket text. */
  const supportRating = async (token: string, address: string, req: IncomingMessage, res: ServerResponse) => {
    const page = (status: number, html: string) => {
      res.setHeader('Content-Security-Policy', "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : html);
    };
    const gone = () => page(404, '<!doctype html><html lang="en"><meta charset="utf-8"><title>Nothing is here</title><body><p>Nothing is here.</p></body></html>');
    try {
      if (!SHARE_TOKEN_PATTERN.test(token)) return gone();
      let score: number | undefined;
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        check(req.method === 'POST', 'METHOD_NOT_ALLOWED', 'Use the rating form.');
        check(fromThisPage(req), 'INVALID_ORIGIN', 'Answer from the rating page itself.');
        check((req.headers['content-type'] ?? '').startsWith('application/x-www-form-urlencoded'), 'INVALID_CONTENT_TYPE', 'Use the rating form.');
        let size = 0; const chunks: Buffer[] = [];
        for await (const chunk of req) { size += chunk.length; check(size <= 1024, 'REQUEST_TOO_LARGE', 'Use the rating form.'); chunks.push(chunk); }
        const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
        check([...form.keys()].every(key => key === 'score') && form.getAll('score').length === 1 && /^[1-5]$/.test(form.get('score') ?? ''), 'INVALID_REQUEST', 'Choose one rating.');
        score = Number(form.get('score'));
      }
      const found = score === undefined ? await app.supportRating(token, address) : await app.supportRating(token, address, score);
      return found ? page(200, supportRatingHtml(found)) : gone();
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      const status = code === 'SUPPORT_RATING_EXISTS' ? 409 : code === 'RATE_LIMITED' ? 429 : code === 'INVALID_ORIGIN' ? 403 : error instanceof ChausarError ? 400 : 500;
      return page(status, '<!doctype html><html lang="en"><meta charset="utf-8"><title>Rating not recorded</title><body><p>The rating was not recorded. Open the link again.</p></body></html>');
    }
  };
  /**
   * /share/<token>: the client share page. GET shows the draft read only; POST (a same-origin form) records Approve or
   * Ask for changes through the business's vault, or (4J7) a comment on one post. No session and no cookie: the token
   * is the key; a session cookie that is the business owner's own makes the GET a preview, which never counts as viewed.
   * Every miss answers the same plain 404 page, and nothing about the request is logged.
   */
  const share = async (token: string, address: string, req: IncomingMessage, res: ServerResponse, viewer?: string) => {
    const page = sharePageWriter(req, res);
    const gone = () => page(404, shareDocument('Nothing is here', `<h1>Nothing is here</h1><p>${escapeHtml(SHARE_GONE)}</p>`));
    try {
      if (!SHARE_TOKEN_PATTERN.test(token)) return gone();
      if (req.method === 'GET' || req.method === 'HEAD') {
        // 4J7: a HEAD (a link checker, a chat app peeking) never counts as the client opening the page.
        const found = await app.sharePage(token, address, undefined, viewer, undefined, req.method === 'HEAD');
        return found ? page(200, sharePageHtml(found, null)) : gone();
      }
      check(req.method === 'POST', 'METHOD_NOT_ALLOWED', 'Use the buttons on the page.');
      check(fromThisPage(req), 'INVALID_ORIGIN', 'Answer from the page itself.');
      check((req.headers['content-type'] ?? '').startsWith('application/x-www-form-urlencoded'), 'INVALID_CONTENT_TYPE', 'Answer from the page itself.');
      let size = 0; const chunks: Buffer[] = [];
      for await (const chunk of req) { size += chunk.length; check(size <= SHARE_MAX_FORM_BYTES, 'REQUEST_TOO_LARGE', 'That comment is too long.'); chunks.push(chunk); }
      const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
      if (form.has('item')) {
        // 4J7 (O20): a comment on one post, without an account.
        check([...form.keys()].every(key => key === 'item' || key === 'text') && form.getAll('item').length === 1 && form.getAll('text').length === 1, 'INVALID_REQUEST', 'Write the comment in the box under the post.');
        const commented = await app.sharePage(token, address, undefined, undefined, { item: form.get('item'), text: form.get('text') });
        return commented ? page(200, sharePageHtml(commented, 'Thank you. Your comment is recorded.')) : gone();
      }
      check([...form.keys()].every(key => key === 'decision' || key === 'comment' || key === 'digest') && form.getAll('decision').length === 1 && form.getAll('digest').length === 1
        && form.getAll('comment').length <= 1, 'INVALID_REQUEST', 'Choose Approve or Ask for changes.');
      const answer = { decision: form.get('decision'), digest: form.get('digest'), comment: form.get('comment') ?? undefined };
      let saved: SharePageView | null;
      try { saved = await app.sharePage(token, address, answer); }
      catch (error) {
        const code = (error as { code?: unknown })?.code;
        if (code !== 'ALREADY_DECIDED' && code !== 'APPROVAL_STALE') throw error;
        const current = await app.sharePage(token, address);
        return current ? page(409, sharePageHtml(current, code === 'ALREADY_DECIDED' ? 'An answer was already recorded on this draft.' : 'This draft changed since you opened it. Read it again.')) : gone();
      }
      return saved ? page(200, sharePageHtml(saved, 'Thank you. Your answer is recorded.')) : gone();
    } catch (error) {
      const code = error instanceof ChausarError ? error.code : (error as { code?: unknown })?.code;
      if (code === 'RATE_LIMITED') res.setHeader('Retry-After', String((error as any).retryAfterSeconds ?? 60));
      const status = typeof code === 'string' && code !== 'SERVER_ERROR' ? statusOf(code) : 500;
      // Only Chausar's own refusals show their words; nothing about the link or the request is logged.
      const known = error instanceof ChausarError;
      if (!known) console.error('[hosted] share page failed');
      if (res.headersSent) { res.end(); return; }
      return page(known ? status : 500, shareDocument('Not done', `<h1>Not done</h1><p>${escapeHtml(known ? (error as Error).message : 'Something went wrong on the server. Nothing was recorded.')}</p>`));
    }
  };

  /** What a refused upload answers with, by its code; the words are Chausar's own. */
  const uploadStatus = (code: unknown) => code === 'SHARE_USED' ? 409 : code === 'SHARE_EXPIRED' ? 410 : code === 'TRIAL_LIMIT' ? 403
    : code === 'UPLOAD_LIMIT' || code === 'REQUEST_TOO_LARGE' ? 413 : code === 'UNSUPPORTED_UPLOAD' || code === 'TIER_UNAVAILABLE' ? 415 : statusOf(typeof code === 'string' ? code : undefined);

  /**
   * 4J7 (K9) /share/<token>/upload: the client's file request page. GET shows the owner's note, where the file goes and
   * one file field; POST (a same-origin multipart form) takes the link's in-flight lock first, then reads at most
   * UPLOAD_MAX_BODY_BYTES, and the vault checks the file's size and type by its bytes and keeps it with the order. A
   * refused file frees the lock, so the client can try again while the link lasts; a stored one uses the link. No session
   * and no cookie: the token is the key. A temporary business takes no file. Nothing about the request is logged.
   */
  const upload = async (token: string, address: string, req: IncomingMessage, res: ServerResponse) => {
    const page = sharePageWriter(req, res);
    const gone = () => page(404, shareDocument('Nothing is here', `<h1>Nothing is here</h1><p>${escapeHtml(SHARE_GONE)}</p>`));
    let lock: string | null = null;
    try {
      if (!SHARE_TOKEN_PATTERN.test(token)) return gone();
      const shown = await app.fileRequest(token, address, { step: 'page' }) as FileRequestPageView | null;
      if (!shown) return gone();
      if (req.method === 'GET' || req.method === 'HEAD') return page(200, uploadPageHtml(shown, null));
      check(req.method === 'POST', 'METHOD_NOT_ALLOWED', 'Use the button on the page.');
      check(fromThisPage(req), 'INVALID_ORIGIN', 'Send the file from the page itself.');
      const type = req.headers['content-type'] ?? '';
      check(type.startsWith('multipart/form-data'), 'INVALID_CONTENT_TYPE', 'Send the file from the page itself.');
      check(Number(req.headers['content-length'] ?? 0) <= UPLOAD_MAX_BODY_BYTES, 'REQUEST_TOO_LARGE', 'Send a file smaller than one and a half megabytes.');
      lock = ((await app.fileRequest(token, address, { step: 'claim' })) as { lock?: string } | null)?.lock ?? null;
      if (!lock) return gone();
      let size = 0; const chunks: Buffer[] = [];
      for await (const chunk of req) { size += chunk.length; check(size <= UPLOAD_MAX_BODY_BYTES, 'REQUEST_TOO_LARGE', 'Send a file smaller than one and a half megabytes.'); chunks.push(chunk); }
      const file = multipartFile(Buffer.concat(chunks), type);
      const stored = await app.fileRequest(token, address, { step: 'store', lock, name: file.name, contentBase64: file.bytes.toString('base64') });
      lock = null;
      if (!stored) return gone();
      return page(200, shareDocument('File sent', `<h1>Thank you</h1><p>${escapeHtml(`The file is with ${shown.businessName} now. You can close this page.`)}</p>`));
    } catch (error) {
      if (lock) await app.fileRequest(token, address, { step: 'release', lock }).catch(() => {});
      const code = error instanceof ChausarError ? error.code : (error as { code?: unknown })?.code;
      if (code === 'RATE_LIMITED') res.setHeader('Retry-After', String((error as any).retryAfterSeconds ?? 60));
      const known = error instanceof ChausarError;
      if (!known) console.error('[hosted] upload page failed');
      if (res.headersSent) { res.end(); return; }
      // A body left unread is drained, so the browser reads the answer instead of a reset connection.
      req.resume();
      return page(known ? uploadStatus(code) : 500, shareDocument('Not sent', `<h1>Not sent</h1><p>${escapeHtml(known ? (error as Error).message : 'Something went wrong on the server. Nothing was kept.')}</p>`));
    }
  };

  /** The build's manifest, read once: its own file, or the plain one when it has none or it is not a JSON object. */
  let inkManifest: Record<string, unknown> | null = null;
  const baseManifest = async (folder: string): Promise<Record<string, unknown>> => {
    if (inkManifest) return inkManifest;
    let parsed: unknown = null;
    try { parsed = JSON.parse(await readFile(join(folder, 'manifest.webmanifest'), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
    inkManifest = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : { ...PLAIN_MANIFEST };
    return inkManifest;
  };

  /** The name of the business the session has open, from the session's own list only; null without a live session. */
  const openBusinessName = async (secret: string | undefined): Promise<string | null> => {
    if (!secret) return null;
    await app.options.directory.refresh?.();
    let session: Authenticated;
    try { session = app.accounts.authenticate(secret); }
    catch (error) { if (error instanceof ChausarError) return null; throw error; }
    const open = session.session.businessId;
    return session.user.businesses.find(business => business.id === open)?.name ?? null;
  };

  /** /app/manifest.webmanifest on the hosted app (4J9): the build's manifest named for the open business, never cached. */
  const manifest = async (folder: string, secret: string | undefined, req: IncomingMessage, res: ServerResponse) => {
    const body = manifestJson({ ...(await baseManifest(folder)), name: manifestName(await openBusinessName(secret)) });
    res.writeHead(200, { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Cookie' });
    res.end(req.method === 'HEAD' ? undefined : body);
  };

  /** runEvents: the Ink app's stream, run events only, each as a VentureRunEvent for the open business (views/events.ts). */
  const stream = (session: Authenticated, req: IncomingMessage, res: ServerResponse, runEvents = false) => {
    const open = streams.get(session.user.id) ?? 0;
    check(open < MAX_STREAMS_PER_USER, 'RATE_LIMITED', 'Too many open pages. Close one and try again.');
    let off: (() => void) | null = null;
    const businessId = session.session.businessId ?? '';
    off = app.subscribe(session, runEvents
      ? event => { const run = runEventFromActor(event, businessId); if (run) res.write(sseFrame(run)); }
      : event => { res.write(`id: ${event.seq}\nevent: ${event.name}\ndata: ${JSON.stringify(event)}\n\n`); });
    streams.set(session.user.id, open + 1);
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write('retry: 5000\n\n');
    const heartbeat = setInterval(() => res.write(': still here\n\n'), 25_000);
    heartbeat.unref();
    const done = () => {
      clearInterval(heartbeat);
      if (off) { off(); off = null; const left = (streams.get(session.user.id) ?? 1) - 1; if (left > 0) streams.set(session.user.id, left); else streams.delete(session.user.id); }
    };
    req.on('close', done); res.on('close', done);
  };

  const server: Server = options.tls.kind === 'files'
    ? createHttpsServer({ cert: options.certificate?.cert, key: options.certificate?.key, minVersion: 'TLSv1.2' }, handler)
    : createHttpServer(handler);
  server.headersTimeout = 20_000;
  server.requestTimeout = 180_000;

  return {
    server,
    async listen(host: string, port: number): Promise<{ port: number }> {
      await new Promise<void>((accept, reject) => { server.once('error', reject); server.listen(port, host, () => { server.off('error', reject); accept(); }); });
      const address = server.address();
      check(address && typeof address === 'object', 'SERVER_FAILED', 'No port was assigned.');
      return { port: address.port };
    },
    async close() {
      closing = true;
      await new Promise<void>(accept => { server.close(() => accept()); server.closeIdleConnections(); setTimeout(() => { server.closeAllConnections(); }, 10_000).unref(); });
      await app.close();
    },
  };
}

/** The development custody key lives in the data folder so restarts keep working. Never in production. */
async function devCustody(dataDirectory: string): Promise<HostedCustody> {
  const path = join(dataDirectory, 'dev-custody.key');
  try { return HostedCustody.fromKey((await readFile(path, 'utf8')).trim()); }
  catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
  const key = randomBytes(32).toString('base64url');
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(key); await file.sync(); } finally { await file.close(); }
  return HostedCustody.fromKey(key);
}

/** Opens the sealed directory: the file store, or the PostgreSQL store over a pool the business vaults share. */
async function openDirectory(config: HostedConfig, custody: HostedCustody, connect: (options: NonNullable<HostedConfig['postgres']>) => Promise<PostgresPool>) {
  if (config.storage !== 'postgres') return { directory: await FileDirectory.open(config.dataDirectory, custody) as HostedDirectory, pool: undefined };
  check(config.postgres, 'HOSTED_CONFIG_INVALID', 'PostgreSQL storage needs CHAUSAR_HOSTED_POSTGRES_URL.');
  const pool = await connect(config.postgres);
  try { return { directory: await PostgresDirectory.open(pool, custody, { endPoolOnClose: true }) as HostedDirectory, pool }; }
  catch (error) { await pool.end().catch(() => {}); throw error; }
}

/**
 * Builds the app from a checked config: custody, the sealed directory, mail, transports, the runtime. Tests pass a
 * stand-in for the PostgreSQL connection; the server itself always opens a loopback pool.
 */
export async function startHosted(config: HostedConfig, print: (line: string) => void = line => console.log(line),
  connect: (options: NonNullable<HostedConfig['postgres']>) => Promise<PostgresPool> = options => openLoopbackPool(options, 'chausar-hosted')) {
  // Listed before anything opens, so an unbuilt Ink app stops the start with its own plain reason (UI_NOT_BUILT).
  const ink = { folder: INK_ROOT, files: await listInkFiles(INK_ROOT) };
  await mkdir(config.dataDirectory, { recursive: true, mode: 0o700 });
  const custody = config.custody.kind === 'env' ? HostedCustody.fromKey(config.custody.key) : await devCustody(config.dataDirectory);
  const { directory, pool } = await openDirectory(config, custody, connect);
  try {
    const mailer: Mailer = config.mailer === 'dev-outbox' ? new DevOutbox(print) : new NoMailer();
    const models = await import('../venture/models/index.ts');
    const build = await import('../venture/build/index.ts');
    let modelTransport = models.defaultModelTransport();
    let githubTransport: any = build.defaultGitHubTransport();
    if (config.replay?.model) modelTransport = models.createReplayTransport(JSON.parse(await readFile(resolve(config.replay.model), 'utf8')));
    if (config.replay?.github) {
      const fixture = JSON.parse(await readFile(resolve(config.replay.github), 'utf8'));
      githubTransport = (store: any) => build.createFixtureGitHubTransport(fixture, () => ({
        briefId: [...store.read().conversations].reverse().find((r: any) => r.kind === 'venture-brief')?.briefId ?? '' }));
    }
    // Phone alerts (Ink v2 wave 4, 4G3): the web push key is derived from the custody key, never read from or written to a file.
    const push = config.push ? hostedPushPort(custody, config.push.subject) : null;
    const app = new HostedApp({ root: config.dataDirectory, rp: config.rp, directory, custody, mailer, limits: config.limits, version: '0.1.0-preview.1', modelTransport, githubTransport, postgres: pool, publicUrl: config.publicUrl, push,
      trials: config.trials });
    const certificate = config.tls.kind === 'files' ? { cert: await readFile(config.tls.cert), key: await readFile(config.tls.key) } : undefined;
    const http = createHostedServer(app, { origin: config.origin, tls: config.tls, trustProxy: config.trustProxy, proxyHops: config.proxyHops, maxBodyBytes: config.limits.maxBodyBytes, certificate, ink });
    app.startHousekeeping();
    return { app, http, custody };
  } catch (error) { await directory.close().catch(() => {}); throw error; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let config: HostedConfig;
  try { config = hostedConfig(process.env, process.argv); }
  catch (error) { console.error((error as Error).message); process.exit(1); }
  let started: Awaited<ReturnType<typeof startHosted>>;
  try { started = await startHosted(config); }
  catch (error) { if ((error as ChausarError).code !== 'UI_NOT_BUILT') throw error; console.error((error as Error).message); process.exit(1); }
  const { http } = started;
  await http.listen(config.listen.host, config.listen.port);
  console.log(`Chausar hosted web (experimental) at ${config.origin}, listening on ${config.listen.host}:${config.listen.port}.`);
  console.log(config.storage === 'postgres'
    ? 'Accounts and businesses are kept in PostgreSQL, sealed and encrypted. Experimental: not yet tested on a real deploy.'
    : 'Businesses are kept in experimental encrypted file storage. Practise here; nothing is deployed.');
  if (config.custody.kind === 'dev-file') console.log(`Development custody key in ${join(config.dataDirectory, 'dev-custody.key')}. Never use it for real accounts.`);
  if (config.mailer === 'dev-outbox') console.log('Sign-in links are printed here, not emailed.');
  console.log(`The app is at ${config.origin}/app/, built from app/ui.`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void http.close().finally(() => process.exit(0)); });
}
