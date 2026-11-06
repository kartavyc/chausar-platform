/**
 * Phone alerts in this browser (Ink v2 wave 4, 4G4; spec 5.7 and 8, catalogue O13, W3's U18), on the hosted app only.
 * The browser's own push service carries a count and nothing else (the service worker, public/sw.js, shows "3 need
 * you"). This file is the one place the app touches the browser's Notification, permission and push APIs:
 *   - the permission is asked for only from a press of "Turn on phone alerts" (Business > Notifications), never on load;
 *   - the page follows the permission live while it is open (the Permissions API, and again when the page shows);
 *   - at every load of the hosted app the service worker is registered and, when this browser already allowed alerts and
 *     holds a subscription, it is sent again, so the engine ties it to the session now signed in (4G3 review).
 * Nothing here is kept in browser storage; the browser keeps the subscription itself.
 */

import { createContext, useContext } from 'react';
import type { EngineClient, PushSubscriptionInput } from '../engine/types';

export type PushPermission = 'granted' | 'denied' | 'default';

export interface BrowserPush {
  /** Whether this browser can take phone alerts at all (notifications, a service worker and a push manager). */
  supported(): boolean;
  /** The permission now. */
  permission(): PushPermission;
  /** Calls back when the permission may have changed while the page is open. Returns the way to stop. */
  onPermission(callback: () => void): () => void;
  /** Asks the browser. Call it only from the owner's press. */
  ask(): Promise<PushPermission>;
  /** This browser's subscription for Chausar, or null. */
  current(): Promise<PushSubscriptionInput | null>;
  /** Subscribes with the server's public key (base64url). */
  subscribe(publicKey: string): Promise<PushSubscriptionInput>;
  /** Ends this browser's subscription; answers the address it had, or null when there was none. */
  unsubscribe(): Promise<string | null>;
  /** Registers the service worker (public/sw.js, beside the page). */
  register(): Promise<void>;
}

const WORKER = 'sw.js';

/** base64url to bytes, for the push manager's applicationServerKey. */
function keyBytes(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '=');
  const text = atob(base64);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i);
  return bytes;
}

function asInput(subscription: PushSubscription): PushSubscriptionInput {
  const json = subscription.toJSON();
  return {
    endpoint: json.endpoint ?? subscription.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
    expirationTime: json.expirationTime ?? null,
  };
}

/** The browser's own push, through its APIs. */
export function browserPush(w: Window & { Notification: typeof Notification } = window): BrowserPush {
  const nav = w.navigator;
  const supported = () => 'Notification' in w && 'serviceWorker' in nav && 'PushManager' in w;
  const registration = async () => (await nav.serviceWorker.getRegistration()) ?? nav.serviceWorker.register(WORKER, { scope: './' });
  return {
    supported,
    permission: () => (supported() ? (w.Notification.permission as PushPermission) : 'default'),
    onPermission(callback) {
      let status: PermissionStatus | null = null;
      let stopped = false;
      const shown = () => { if (w.document.visibilityState === 'visible') callback(); };
      w.document.addEventListener('visibilitychange', shown);
      nav.permissions?.query({ name: 'notifications' as PermissionName }).then((found) => {
        if (stopped) return;
        status = found;
        found.addEventListener('change', callback);
      }, () => {});
      return () => {
        stopped = true;
        status?.removeEventListener('change', callback);
        w.document.removeEventListener('visibilitychange', shown);
      };
    },
    ask: async () => (await w.Notification.requestPermission()) as PushPermission,
    async current() {
      const found = await nav.serviceWorker.getRegistration();
      const subscription = await found?.pushManager.getSubscription();
      return subscription ? asInput(subscription) : null;
    },
    async subscribe(publicKey) {
      const ready = await registration();
      const subscription = await ready.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) as BufferSource });
      return asInput(subscription);
    },
    async unsubscribe() {
      const found = await nav.serviceWorker.getRegistration();
      const subscription = await found?.pushManager.getSubscription();
      if (!subscription) return null;
      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();
      return endpoint;
    },
    async register() {
      if (supported()) await registration();
    },
  };
}

/** Tests and the parts page give their own; the app uses the browser's. */
export const BrowserPushContext = createContext<BrowserPush | null>(null);

let shared: BrowserPush | null = null;
export function useBrowserPush(): BrowserPush {
  const given = useContext(BrowserPushContext);
  if (given) return given;
  shared ??= browserPush();
  return shared;
}

/**
 * At every load of the hosted app: register the service worker, and when this browser already allowed phone alerts
 * and holds a subscription, send it again so the engine ties it to the session now signed in. It never asks the
 * browser for anything. Off the hosted app it does nothing; a failure is quiet (Notifications says what is on).
 */
export async function startHostedPush(client: Pick<EngineClient, 'transport' | 'request'>, push: BrowserPush): Promise<void> {
  if (client.transport !== 'hosted' || !push.supported()) return;
  try {
    await push.register();
    if (push.permission() !== 'granted') return;
    const subscription = await push.current();
    if (subscription) await client.request('venture.notify.push.subscribe', { subscription });
  } catch {
    // The settings page reads the engine and the browser again when it opens.
  }
}
