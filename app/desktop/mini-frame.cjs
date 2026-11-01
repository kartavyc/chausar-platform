// Mini apps (wave 6 package 6H1, D39): the desktop half of the locked frame. A mini app is HTML the owner's AI wrote.
// The Ink app's strict policy (script-src 'self') is inherited by blob and srcdoc frames, so the frame loads the static
// sandbox proxy (app/ui/public/mini-frame.html) instead, and this file gives that one path its own policy: inline
// script and style only, images and fonts as data, no network, no frames, no forms, no workers, no base URL, and
// sandboxed (allow-scripts, never allow-same-origin) even if something opened it on its own. The policy text is the
// engine's MINI_FRAME_CSP (platform/runtime/venture/apps/frame.ts); a test pins the two equal. The proxy writes the app
// document its parent sends into itself and keeps this policy. subframeAllowed keeps every frame in the window on the
// proxy or on the app's own blob previews (the website preview), so an app cannot steer its frame anywhere else.
const MINI_FRAME_PATH = '/mini-frame.html';
const MINI_FRAME_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; manifest-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'";
const MINI_FRAME_HEADER = `${MINI_FRAME_CSP}; sandbox allow-scripts`;

/** The policy a file of the Ink build is served with: the proxy's own, or the app's. */
function policyFor(pathname, appPolicy) {
  return pathname === MINI_FRAME_PATH ? MINI_FRAME_HEADER : appPolicy;
}

/** Where a frame inside the window may go: the proxy itself, the app's own blob previews, or a blank page. */
function subframeAllowed(url) {
  if (url === 'about:blank' || url === 'about:srcdoc') return true;
  if (url === `chausar://app${MINI_FRAME_PATH}`) return true;
  return typeof url === 'string' && /^blob:chausar:\/\/app\/[0-9a-f-]{36}$/.test(url);
}

module.exports = Object.freeze({ MINI_FRAME_PATH, MINI_FRAME_HEADER, policyFor, subframeAllowed });
