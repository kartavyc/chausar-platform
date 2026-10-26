// Chausar delivery harness (Ink v2 wave 4, package 4J11, catalogue H33): mock providers for payment links, mail and
// posting, for tests and practice only. Each runs the real checks on what it is asked to do: the payment link and mail
// checks a real request must pass, and for posting exactly the checks build/posting.ts runs before a post is proposed
// (postGate: the channel hold, the accepted files, sent once, the draft binding and the client's answer, the platform's
// length, the risk gate). Used as a journal effect, a mock goes through the real journal (described, approved, then
// applied, rejected or outcome_unknown), and failNext() makes its next call fail in a chosen way, once. Every mock says
// it is one (MOCK_LABEL, mock: true, a practice:// address nobody can open) and reaches no network. Where it may run is
// read from the run's own tool environment or the test host, never from what a caller says (MOCK_REAL_RUN otherwise).
import { ChausarError, check, newId } from '../../../contracts.ts';
import { plainText, singleLine } from '../../records.ts';
import type { Json, VentureDeps } from '../../contracts.ts';
import type { ApplyHandle, ApplyResult } from '../../journal/journal.ts';
import { normalEmail } from '../../network/extract-core.ts';
import { postGate } from '../../build/posting.ts';
import { MOCK_LABEL, MOCK_REAL_RUN_LINE, practiceRun } from './mocks.ts';
import type { ToolEnv } from './tools.ts';

export type MockProviderKind = 'payment-link' | 'mail' | 'posting';
export const MOCK_PROVIDER_KINDS: readonly MockProviderKind[] = Object.freeze(['payment-link', 'mail', 'posting']);
/**
 * Where a mock provider may be used: a test (its deps on host 'test' only), or a practice run, given as the run's own
 * tool environment (a rehearsal or an improvement run; buildToolEnv makes it from the vault).
 */
export type MockUse = { for: 'test'; deps: Pick<VentureDeps, 'host' | 'clock' | 'store'> } | { for: 'practice'; env: Pick<ToolEnv, 'runRef' | 'policy' | 'deps'> };
/** How failNext() makes the next call fail: the provider said no, it stopped part way, or it could not be reached. */
export type MockFailure = 'not-sent' | 'unknown' | 'error';

export type PaymentLinkInput = { amountMinor: string; currency: string; purpose: string; payer?: string | null };
export type MailInput = { to: string; subject: string; body: string };
/** A post is always one of a draft's posts, by its id, as build/posting.ts proposes it: never free text. */
export type PostingInput = { connectorId: string; draftId: string; part?: number | null };
type Checked = Record<string, Json>;

/** What a mock call gives back: always labelled, with an address no browser can open. */
export type MockReceipt = { mock: true; label: string; kind: MockProviderKind; id: string; status: 'created' | 'paid' | 'sent' | 'posted'; url: string; at: string };
/** One call the mock was asked to make, and how it ended. */
export type MockRequest = { id: string; kind: MockProviderKind; input: Json; state: 'sent' | 'not-sent' | 'unknown' | 'failed' };

type Deps = Pick<VentureDeps, 'clock' | 'store'>;

function fields(value: unknown, allowed: readonly string[], required: readonly string[]): Record<string, unknown> {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), 'INVALID_VENTURE_REQUEST', 'Send one request object.');
  const record = value as Record<string, unknown>;
  check(Object.keys(record).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(record, key)), 'INVALID_VENTURE_REQUEST', 'Send the required fields and nothing else.');
  return record;
}

/** The real checks for each kind, the ones a real provider's request must pass first. */
const VALIDATE: Readonly<Record<MockProviderKind, (value: unknown, deps: Deps) => Checked>> = {
  'payment-link': value => {
    const body = fields(value, ['amountMinor', 'currency', 'purpose', 'payer'], ['amountMinor', 'currency', 'purpose']);
    check(typeof body.amountMinor === 'string' && /^[1-9]\d{0,15}$/.test(body.amountMinor), 'INVALID_VENTURE_REQUEST', 'The amount must be a positive whole number of the smallest unit, as text.');
    check(typeof body.currency === 'string' && /^[A-Z]{3}$/.test(body.currency), 'INVALID_VENTURE_REQUEST', 'The currency must be a three-letter code such as INR.');
    const purpose = singleLine(body.purpose, 'The purpose', { max: 120 });
    const payer = body.payer === undefined || body.payer === null ? null : normalEmail(typeof body.payer === 'string' ? body.payer : null);
    check(body.payer === undefined || body.payer === null || payer !== null, 'INVALID_VENTURE_REQUEST', "The payer's address is not an email address.");
    return { amountMinor: body.amountMinor as string, currency: body.currency as string, purpose, payer };
  },
  mail: value => {
    const body = fields(value, ['to', 'subject', 'body'], ['to', 'subject', 'body']);
    const to = normalEmail(typeof body.to === 'string' ? body.to : null);
    check(to !== null, 'INVALID_VENTURE_REQUEST', 'The mail needs one real email address to go to.');
    return { to, subject: singleLine(body.subject, 'The subject', { max: 200 }), body: plainText(body.body, 'The message', { max: 20000 }) };
  },
  // The checks posting.ts runs before it proposes a post, on the vault as it is now.
  posting: (value, deps) => {
    const body = fields(value, ['connectorId', 'draftId', 'part'], ['connectorId', 'draftId']);
    check(typeof body.connectorId === 'string' && typeof body.draftId === 'string', 'INVALID_VENTURE_REQUEST', 'Name the platform and the draft.');
    check(body.part === undefined || body.part === null || (Number.isInteger(body.part) && (body.part as number) >= 1), 'INVALID_VENTURE_REQUEST', 'part is a whole number from 1.');
    const part = (body.part ?? null) as number | null;
    const { gate } = postGate(deps as VentureDeps, deps.store.read(), { connectorId: body.connectorId, draftId: body.draftId, part }, deps.clock().toISOString());
    return { connectorId: body.connectorId, draftId: body.draftId, part, text: gate.text };
  },
};
const DONE_STATUS: Readonly<Record<MockProviderKind, MockReceipt['status']>> = Object.freeze({ 'payment-link': 'created', mail: 'sent', posting: 'posted' });
const DONE_LINE: Readonly<Record<MockProviderKind, string>> = Object.freeze({
  'payment-link': 'Practice: a payment link was made. Nobody can pay it.', mail: 'Practice: the mail was accepted. Nobody got it.', posting: 'Practice: the post was accepted. Nothing was posted.',
});

/** One mock provider of one kind: the real checks, a record of each call, failNext(), and a journal effect. */
export class MockProvider {
  readonly mock = true as const;
  readonly label = MOCK_LABEL;
  readonly requests: MockRequest[] = [];
  readonly kind: MockProviderKind;
  readonly #failures: MockFailure[] = [];
  readonly #receipts = new Map<string, MockReceipt>();
  readonly #deps: Deps;
  constructor(kind: MockProviderKind, deps: Deps) { this.kind = kind; this.#deps = deps; }

  /** The real checks on a request; refuses in plain words with the code the real check uses. */
  validate(input: unknown): Checked {
    return VALIDATE[this.kind](input, this.#deps);
  }

  /** The next call fails this way, once. Several calls queue in order. */
  failNext(failure: MockFailure = 'error'): void {
    check(['not-sent', 'unknown', 'error'].includes(failure), 'INVALID_VENTURE_REQUEST', 'Fail with not-sent, unknown or error.');
    this.#failures.push(failure);
  }

  /** One call, checked first. A queued failure decides how it ends; otherwise it succeeds with a labelled receipt. */
  async send(input: unknown): Promise<MockReceipt & { outcome: 'applied' | 'not-sent' | 'unknown' }> {
    const checked = this.validate(input);
    const id = newId('mock');
    const failure = this.#failures.shift();
    const request: MockRequest = { id, kind: this.kind, input: structuredClone(checked), state: 'sent' };
    this.requests.push(request);
    if (failure === 'error') {
      request.state = 'failed';
      throw new ChausarError('NET_FAILED', 'Practice: the provider could not be reached. Nothing was sent.');
    }
    const receipt: MockReceipt = { mock: true, label: MOCK_LABEL, kind: this.kind, id, status: DONE_STATUS[this.kind], url: `practice://${this.kind}/${id}`, at: this.#deps.clock().toISOString() };
    if (failure) request.state = failure;
    else this.#receipts.set(id, receipt);
    return { ...receipt, outcome: failure === 'not-sent' ? 'not-sent' : failure === 'unknown' ? 'unknown' : 'applied' };
  }

  /** A practice payment link is paid, once: created moves to paid; any other state or id is refused. */
  pay(id: string): MockReceipt {
    check(this.kind === 'payment-link', 'INVALID_VENTURE_REQUEST', 'Only a practice payment link can be paid.');
    const receipt = this.#receipts.get(id);
    check(receipt, 'INVALID_VENTURE_REQUEST', 'There is no practice payment link with that id.');
    check(receipt.status === 'created', 'ALREADY_DECIDED', 'This practice payment link is already paid.');
    const paid: MockReceipt = { ...receipt, status: 'paid' };
    this.#receipts.set(id, paid);
    return paid;
  }

  /**
   * The provider as a journal effect (journal/journal.ts applyAction or journalled): the request is checked when the
   * approved action runs; the journal then settles it applied, rejected (not sent) or outcome_unknown, as a real one.
   */
  effect(input: unknown): (handle: ApplyHandle) => Promise<ApplyResult<MockReceipt>> {
    return async () => {
      const { outcome, ...receipt } = await this.send(input);
      if (outcome === 'not-sent') return { outcome: 'not-sent', line: 'Practice: the provider said no. Nothing was sent.', value: receipt };
      if (outcome === 'unknown') return { outcome: 'unknown', line: 'Practice: the provider stopped part way.', value: receipt };
      return { outcome: 'applied', line: DONE_LINE[this.kind], value: receipt, url: receipt.url, by: 'engine' };
    };
  }
}

/**
 * A mock provider, only where a mock may be: a test (deps on host 'test'), or a practice run, read from the run's own
 * tool environment (a rehearsal or an improvement run). A real order, and a test use on any real host, are refused with
 * MOCK_REAL_RUN.
 */
export function mockProvider(kind: MockProviderKind, use: MockUse): MockProvider {
  check(MOCK_PROVIDER_KINDS.includes(kind), 'INVALID_VENTURE_REQUEST', 'Chausar has practice providers for payment links, mail and posting only.');
  if (use.for === 'test') {
    check(use.deps.host === 'test', 'MOCK_REAL_RUN', MOCK_REAL_RUN_LINE);
    return new MockProvider(kind, use.deps);
  }
  check(use.for === 'practice' && !!use.env?.runRef && practiceRun(use.env, false), 'MOCK_REAL_RUN', MOCK_REAL_RUN_LINE);
  return new MockProvider(kind, use.env.deps);
}
