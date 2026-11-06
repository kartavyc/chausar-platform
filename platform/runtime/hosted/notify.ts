// Chausar hosted tier: phone alerts (Ink v2 wave 4, package 4G3; spec 5.7, catalogue O13). Two pieces the venture
// engine of each business needs from the server: the web push key, and whether the owner is looking.
// The push key (VAPID) is derived from the custody key (custody.ts pushKey), so it is the same on every server process
// and never written to a file, a record, an export or a log; the port the engine gets can sign and show the public half,
// nothing more. The owner is watching a business while one of their event streams for it is open (the Ink app's
// /api/events or the sign-in page's /api/hosted/events), and was watching until the moment the last one closed; the
// notification centre holds alerts outside the app for 2 minutes after that (venture/notify/centre.ts). When it closed
// is kept a day at most: the alert pacing looks back no further, and a business nobody watches leaves nothing behind.
// A push subscription belongs to the session that made it: the engine keeps only a hash of that session's id
// (pushSessionHash), and counts the subscription only while the session is live.
import { createHash } from 'node:crypto';
import type { HostedCustody } from './custody.ts';
import type { IsoTime, WebPushPort } from '../venture/contracts.ts';

/** The engine's web push port: the public key, the contact the push services see, and a signer holding the private key. */
export function hostedPushPort(custody: HostedCustody, subject: string | null): WebPushPort {
  const key = custody.pushKey();
  // The private key lives only inside key.sign's closure: a log or JSON of the port shows the public half and the contact.
  return Object.freeze<WebPushPort>({ publicKey: key.publicKey.toString('base64url'), subject, sign: data => key.sign(data) });
}

/** The hash of a hosted session id a push subscription is tied to (PushSubscriptionRecord.sessionHash), never the id. */
export function pushSessionHash(sessionId: string): string {
  return createHash('sha256').update(`chausar.hosted.push-session.v1:${sessionId}`, 'utf8').digest('hex');
}

/** How long when a stream closed is kept: the alert pacing of venture/notify/centre.ts looks back a day at most. */
export const WATCH_KEEP_MS = 24 * 60 * 60_000;

/** Whether each business's owner has an event stream open, and when the last one closed. Keyed 'tenant/business'. */
export class OwnerWatch {
  #open = new Map<string, number>();
  #closedAt = new Map<string, number>();
  #clock: () => Date;

  constructor(clock: () => Date = () => new Date()) { this.#clock = clock; }

  /** Forgets when streams closed more than WATCH_KEEP_MS ago. */
  #prune(nowMs: number): void {
    for (const [id, closed] of this.#closedAt) if (nowMs - closed >= WATCH_KEEP_MS) this.#closedAt.delete(id);
  }

  /** How many businesses anything is kept about: an open stream, or one that closed in the last day. */
  get size(): number { return new Set([...this.#open.keys(), ...this.#closedAt.keys()]).size; }

  /** One stream opened; returns its release, which counts once however often it is called. */
  open(id: string): () => void {
    this.#prune(this.#clock().getTime());
    this.#open.set(id, (this.#open.get(id) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = (this.#open.get(id) ?? 1) - 1;
      if (left > 0) this.#open.set(id, left); else this.#open.delete(id);
      this.#closedAt.set(id, this.#clock().getTime());
    };
  }

  /** Whether a stream for this business is open now. */
  watching(id: string): boolean { return (this.#open.get(id) ?? 0) > 0; }

  /** A deleted business (4J23, a temporary one that ran out): nothing about its owner's watching is kept. */
  forget(id: string): void { this.#open.delete(id); this.#closedAt.delete(id); }

  /** Now while a stream is open; else when the last one closed; null when none has been open since the server started. */
  at(id: string): IsoTime | null {
    if (this.watching(id)) return this.#clock().toISOString();
    this.#prune(this.#clock().getTime());
    const closed = this.#closedAt.get(id);
    return closed === undefined ? null : new Date(closed).toISOString();
  }
}
