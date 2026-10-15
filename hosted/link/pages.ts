import type { HostedDeps, HostedModule } from '../shared/module.ts';
import type { HostedResponse, Router } from '../shared/http.ts';
import { BUTTONS, LINK_PAGE, RECOVERY_TEXT } from '../shared/templates.ts';
import type { RelayButtons } from '../relay/relay.ts';
import type { MailConfirmPages } from '../relay/mail-verify.ts';
import type { RecoveryPages } from '../relay/recovery.ts';
import { checkLinkOrigin } from '../relay/relay.ts';

/**
 * The link pages: plain HTML with the wordmark and one line. They hold no data and run no script.
 * GET never consumes anything (mail scanners prefetch links); only POST /b/:token decides, through the relay's single-use path,
 * only POST /v/:token confirms a mail address, and only POST /r/:token confirms or declines a recovery.
 */
export const LINK_PAGE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'content-type': 'text/html; charset=utf-8',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store',
  'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY',
});
const STYLE = 'body{margin:0;font-family:system-ui,sans-serif;background:#faf8f4;color:#1c1b19;display:flex;min-height:100vh;align-items:center;justify-content:center}'
  + 'main{max-width:28rem;padding:2rem;text-align:center}.mark{font-weight:700;font-size:1.5rem;letter-spacing:.02em;margin:0 0 1rem}'
  + 'a.go,button{display:inline-block;margin-top:1.25rem;padding:.75rem 1.5rem;border-radius:.5rem;border:0;background:#1c1b19;color:#faf8f4;font:inherit;text-decoration:none;cursor:pointer}';
// Only catalogue text and fixed paths are ever written into a page, so nothing needs escaping; the guard keeps it that way.
const plain = (text: string) => { if (/[<>&"']/.test(text)) throw new Error('LINK_PAGE_TEXT_INVALID'); return text; };
export function linkPage(line: string, action: string = ''): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<meta name="robots" content="noindex"><meta name="referrer" content="no-referrer"><title>${LINK_PAGE.title}</title><style>${STYLE}</style></head>`
    + `<body><main><p class="mark">${LINK_PAGE.title}</p><p>${plain(line)}</p>${action}</main></body></html>`;
}
const page = (status: number, line: string, action?: string): HostedResponse => ({ status, headers: { ...LINK_PAGE_HEADERS }, body: linkPage(line, action) });
const gone = () => page(410, LINK_PAGE.gone);

export function createLinkPages(deps: HostedDeps, relayButtons: RelayButtons, mailConfirm?: MailConfirmPages, recovery?: RecoveryPages): HostedModule {
  checkLinkOrigin(deps.linkOrigin);
  return {
    id: 'link',
    routes(router: Router) {
      router.add('GET', '/l/:token', async request => {
        const destination = await relayButtons.openDestination(request.params.token);
        if (!destination) return gone();
        return page(200, LINK_PAGE.open, `<a class="go" href="chausar://open/${plain(destination)}">${BUTTONS.open}</a>`);
      });
      router.add('GET', '/b/:token', async request => {
        const decision = await relayButtons.peek(request.params.token, 'mail');
        if (!decision) return gone();
        // One form button posting to this same address. The page names the choice and nothing else.
        const label = decision === 'approve' ? BUTTONS.approve : BUTTONS.notNow;
        return page(200, decision === 'approve' ? LINK_PAGE.confirmApprove : LINK_PAGE.confirmNotNow, `<form method="post"><button type="submit">${label}</button></form>`);
      });
      router.add('POST', '/b/:token', async request => {
        const decision = await relayButtons.decide(request.params.token, 'mail', null);
        return decision ? page(200, LINK_PAGE.done) : gone();
      }, { maxBody: 4096 });
      // The mail address confirmation: one button; single use, a day long; a changed or old link no longer works.
      router.add('GET', '/v/:token', async request => {
        if (!mailConfirm || !await mailConfirm.peek(request.params.token)) return gone();
        return page(200, LINK_PAGE.confirmAddress, `<form method="post"><button type="submit">${BUTTONS.confirm}</button></form>`);
      });
      router.add('POST', '/v/:token', async request => {
        const confirmed = mailConfirm ? await mailConfirm.confirm(request.params.token) : false;
        return confirmed ? page(200, LINK_PAGE.addressConfirmed) : gone();
      }, { maxBody: 4096 });
      // The recovery contact's page: Confirm or I did not ask, once; a day long; nothing about the person or the workspace.
      router.add('GET', '/r/:token', async request => {
        if (!recovery || !await recovery.peek(request.params.token)) return gone();
        return page(200, RECOVERY_TEXT.pageAsk, `<form method="post"><button type="submit" name="choice" value="confirm">${RECOVERY_TEXT.confirm}</button> `
          + `<button type="submit" name="choice" value="decline">${RECOVERY_TEXT.decline}</button></form>`);
      });
      router.add('POST', '/r/:token', async request => {
        const choice = new URLSearchParams(request.body.toString('utf8')).get('choice');
        if (!recovery || (choice !== 'confirm' && choice !== 'decline')) return gone();
        const decided = await recovery.decide(request.params.token, choice);
        return decided === 'confirmed' ? page(200, RECOVERY_TEXT.pageConfirmed) : decided === 'declined' ? page(200, RECOVERY_TEXT.pageDeclined) : gone();
      }, { maxBody: 4096 });
    },
  };
}
