// A2: a site that keeps refusing is closed for the rest of a run. When a site refuses Chausar three times in a row (an
// answer of 401, 403, 429 or 451, or the fetch policy stopping at its CAPTCHA or challenge page, its slow-down or its
// robots.txt), Chausar stops asking it for the rest of that run and names it as unavailable, instead of trying it again
// and again. An answer the policy lets through resets the count. Another run starts fresh. Nothing here retries, waits
// out or gets around a refusal: it only stops asking sooner.
// A2 review: the count is kept at the policy layer (politeFetch carries the run's breaker in PoliteNet.sites), because
// the CAPTCHA, robots and slow-down stops are raised there, above the network sender.
import { ChausarError } from '../../contracts.ts';

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

  /** Refuses a closed site before anything is asked of it. */
  refuseClosed(url: URL | string): void {
    const host = hostOf(url);
    if (this.#closed.includes(host)) throw new ChausarError('SITE_UNAVAILABLE', SITE_WORDS.closed(host));
  }

  /** An answer the policy let through: a refusing status counts, anything else resets the site's count. */
  answered(url: URL | string, status: number): void {
    const host = hostOf(url);
    if (REFUSED_STATUSES.has(status)) this.#refused(host);
    else this.#streak.set(host, 0);
  }

  /** A failed read: the policy's CAPTCHA, slow-down and robots stops count; a network fault does not. */
  note(url: URL | string, error: unknown): void {
    if (error instanceof ChausarError && REFUSING_CODES.has(error.code)) this.#refused(hostOf(url));
  }
}
