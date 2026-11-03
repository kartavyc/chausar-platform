// A2: a site that keeps refusing is closed for the rest of a run. When a site refuses Chausar three times in a row (an
// answer of 401, 403, 429 or 451, or the fetch policy stopping at its CAPTCHA, its slow-down or its robots.txt), Chausar
// stops asking it for the rest of that run and names it as unavailable, instead of trying it again and again. Any other
// answer from the site resets its count. Another run starts fresh. Nothing here retries, waits out or gets around a
// refusal: it only stops asking sooner.
import { ChausarError } from '../../contracts.ts';
import type { PinnedSender } from '../core/net-guard.ts';

export const SITE_CLOSED_AFTER = 3;
/** Answers that are the site saying no. */
export const REFUSED_STATUSES: ReadonlySet<number> = new Set([401, 403, 429, 451]);
/** Chausar's own stops that come from what the site said (fetch-policy.ts). */
export const REFUSING_CODES: ReadonlySet<string> = new Set(['CAPTCHA_STOP', 'SITE_PAUSED', 'ROBOTS_REFUSED']);
export const SITE_WORDS = Object.freeze({
  closed: (host: string) => `${host} refused Chausar three times in a row, so this run will not ask it again.`,
});

const hostOf = (url: URL | string) => (typeof url === 'string' ? new URL(url) : url).hostname.toLowerCase().replace(/\.$/, '');

/** One run's count of refusals per site, and the sites it closed. */
export class SiteBreaker {
  readonly #streak = new Map<string, number>();
  readonly #closed: string[] = [];
  readonly #onClose: ((host: string) => void) | undefined;

  constructor(onClose?: (host: string) => void) { this.#onClose = onClose; }

  /** The sites closed in this run, in the order they were closed. */
  unavailable(): string[] { return [...this.#closed]; }

  #refused(host: string): void {
    const streak = (this.#streak.get(host) ?? 0) + 1;
    this.#streak.set(host, streak);
    if (streak >= SITE_CLOSED_AFTER && !this.#closed.includes(host)) {
      this.#closed.push(host);
      try { this.#onClose?.(host); } catch { /* the note is best effort; the site stays closed */ }
    }
  }

  /** A sender that refuses a closed site before anything is sent, and counts what each site answers. */
  wrap(send: PinnedSender): PinnedSender {
    return async target => {
      const host = hostOf(target.url);
      if (this.#closed.includes(host)) throw new ChausarError('SITE_UNAVAILABLE', SITE_WORDS.closed(host));
      let answer: Awaited<ReturnType<PinnedSender>>;
      try { answer = await send(target); }
      catch (error) {
        if (error instanceof ChausarError && REFUSING_CODES.has(error.code)) this.#refused(host);
        throw error;
      }
      if (REFUSED_STATUSES.has(answer.status)) this.#refused(host);
      else this.#streak.set(host, 0);
      return answer;
    };
  }

  /** For a policy layer that throws after looking at the answer (fetch-policy.ts noteAnswer): count its refusal too. */
  note(url: URL | string, error: unknown): void {
    if (error instanceof ChausarError && REFUSING_CODES.has(error.code)) this.#refused(hostOf(url));
  }
}
