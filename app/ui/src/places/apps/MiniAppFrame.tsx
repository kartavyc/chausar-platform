import { useEffect, useRef, useState } from 'react';
import { useEngine } from '../../engine/context';
import type { MiniAppView } from '../../engine/types';
import { FRAME_MIN, frameVariables, openBridge } from './bridge';
import s from './Apps.module.css';

/** The sandbox proxy the desktop serves with the mini app policy (public/mini-frame.html, app/desktop/mini-frame.cjs). */
export const MINI_FRAME_SRC = 'mini-frame.html';
/** No powerful features for an app, whatever its code asks. */
export const MINI_FRAME_ALLOW = "camera 'none'; microphone 'none'; geolocation 'none'; display-capture 'none'; clipboard-read 'none'; clipboard-write 'none'; payment 'none'; usb 'none'; serial 'none'; bluetooth 'none'; fullscreen 'none'";

/**
 * The theme Chausar shows (one-shot A1, row 12): the owner's own choice on the page (data-theme, set by public/theme.js)
 * first, the computer's setting only when there is none.
 */
export function chausarTheme(): 'light' | 'dark' {
  const chosen = document.documentElement.getAttribute('data-theme');
  if (chosen === 'light' || chosen === 'dark') return chosen;
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
/** The colours Chausar shows now, for the frame, so an app's words read on its ground in both themes. */
const styles = () => frameVariables((token) => getComputedStyle(document.documentElement).getPropertyValue(token));

/**
 * A mini app, running (W6 6H1, D39). Built on the website preview's frame (SitePreviewFrame): an iframe with a sandbox
 * and no referrer. Here the sandbox allows scripts and never allow-same-origin, so the app has an opaque origin of its
 * own and cannot reach this window, its storage or the engine. The app's inline script cannot run in a blob or srcdoc
 * frame (they inherit the Ink app's strict policy), so the frame loads the sandbox proxy, and the bridge (bridge.ts)
 * hands it the app document. The bridge listens before the frame starts, then relays each allowed tools/call to the
 * engine. The frame grows with the app, within bounds, through the height attribute (no inline style).
 */
export function MiniAppFrame({ app, title, onMoved, sample }: { app: MiniAppView; title: string; onMoved: () => void; /** C4 task 29: every call answers the made-up rows. */ sample?: boolean }) {
  const client = useEngine();
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(FRAME_MIN * 2);
  const moved = useRef(onMoved);
  moved.current = onMoved;
  const tools = app.tools.join(',');

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return undefined;
    const close = openBridge({
      frame, document: app.document, tools: tools ? tools.split(',') : [], theme: chausarTheme, styles, onSize: setHeight, onClosed: () => moved.current(),
      call: (tool, args) => client.request('venture.apps.call', { app: app.id, tool, arguments: args, ...(sample ? { sample: true as const } : {}) }),
    });
    frame.src = MINI_FRAME_SRC;
    // The owner switches the theme, or the computer does: the running app gets the new colours.
    const root = document.documentElement;
    const watch = typeof MutationObserver === 'function' ? new MutationObserver(() => close.themeChanged()) : null;
    watch?.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    const onMedia = () => close.themeChanged();
    media?.addEventListener?.('change', onMedia);
    return () => { watch?.disconnect(); media?.removeEventListener?.('change', onMedia); close(); };
  }, [client, app.id, app.document, tools, sample]);

  return <iframe ref={ref} className={s.frame} title={title} sandbox="allow-scripts" referrerPolicy="no-referrer" allow={MINI_FRAME_ALLOW} height={height} data-mini-app={app.id} data-sample={sample ? '' : undefined} />;
}
