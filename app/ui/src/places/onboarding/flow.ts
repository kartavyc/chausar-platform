/**
 * The one-sentence start, in the engine's own order (docs/venture/onboarding.md; runSetup in the old renderer, removed):
 *
 *   venture.preview        the built-in plan for the sentence and country, before any vault (nothing is stored)
 *   workspace.lock         only when a business is open on this computer: the engine keeps one vault open
 *   workspace.create       the encrypted vault, named after the plan; this computer keeps its key, no passphrase
 *                          (DEVICE_KEYS_UNAVAILABLE: no protected storage, so the owner chooses a passphrase)
 *   venture.create         the business, inside the vault
 *   venture.interview.*    the template interview, answered the way the old renderer answers it when the owner set
 *                          nothing: how they charge per month, no price yet, tax not registered (the preview's own
 *                          assumption); the owner changes all three later from Today's Set your prices row
 *   venture.blueprint.draft { useTemplate: true }: the plan, which Today shows as its first row
 *
 * Connect your AI, Set your prices and Keep this business are not screens here: the queue view makes them Today rows.
 */

import { EngineError, type EngineClient, type InterviewAnswer, type InterviewQuestionLite, type Transport, type WorkspaceCreated } from '../../engine/types';

/** venture.preview and venture.create take 10 to 2000 characters. */
export const OPEN_BOX = { min: 10, max: 2000 } as const;
export const PASSPHRASE_MIN = 12;
/** The working name when the preview names nothing; the engine's own default. Data for the vault, not copy. */
export const DEFAULT_NAME = 'My service business';

export type Request = EngineClient['request'];

/** What the owner wrote and where, with the name the vault gets. */
export interface Sentence { idea: string; countryCode: string; name: string }

/** The region of the browser's language: 'en-IN' gives 'IN'. */
export function browserRegion(language: string | undefined): string | null {
  const region = (language ?? '').split('-')[1];
  return region && /^[A-Za-z]{2}$/.test(region) ? region.toUpperCase() : null;
}

/** The browser's country when Chausar has a table for it, else "another country". */
export function pickCountry(codes: readonly string[], region: string | null): string {
  if (region && codes.includes(region)) return region;
  return codes.includes('XX') ? 'XX' : codes[0] ?? 'XX';
}

/**
 * A country's name as the reader's language writes it (4Z2): the engine sends a code and an English name, so a Hindi
 * screen names the country itself from the code ("भारत"), and "another country" in its own words. English keeps the
 * engine's name.
 */
export function countryWords(country: { code: string; name: string }, language: 'en' | 'hi', t: (key: string) => string): string {
  if (language === 'en') return country.name;
  if (country.code === 'XX') return t('onboarding.country.other');
  try { return new Intl.DisplayNames([language], { type: 'region' }).of(country.code) ?? country.name; } catch { return country.name; }
}

/** The sentence as the engine will read it: Windows line ends made plain, spaces trimmed. */
export function cleanSentence(text: string): string {
  return text.replace(/\r\n/g, '\n').trim();
}

/** The text key for what is wrong with the sentence, or null. The engine checks the same again. */
export function sentenceProblem(idea: string): 'onboarding.empty' | 'onboarding.tooShort' | 'onboarding.tooLong' | null {
  if (!idea) return 'onboarding.empty';
  if (idea.length < OPEN_BOX.min) return 'onboarding.tooShort';
  if (idea.length > OPEN_BOX.max) return 'onboarding.tooLong';
  return null;
}

/** A required question the template answers cannot cover; the owner has to answer it on the plan. */
export class NeedsAnswer extends Error {
  readonly question: string;
  constructor(question: string) { super(question); this.name = 'NeedsAnswer'; this.question = question; }
}

/**
 * The answer the old renderer's answerFor gives when the owner chose nothing: the first way of charging (per month),
 * no price, not registered for tax (sent as assumed, so the plan does not call it the owner's answer), and skip for
 * any question that is not required.
 */
export function answerFor(question: InterviewQuestionLite): InterviewAnswer {
  switch (question.id) {
    case 'q_pricing_model': {
      const choice = question.choices[0];
      if (!choice) throw new NeedsAnswer(question.text);
      return { choiceId: choice.id };
    }
    case 'q_price': return { skipped: true };
    // The owner did not answer: the engine keeps "not registered" as an assumption until they confirm it.
    case 'q_tax': return { yes: false, assumed: true };
    case 'q_tax_rate':
      if (question.prefill) return { rate: question.prefill };
      throw new NeedsAnswer(question.text);
    default:
      if (!question.required) return { skipped: true };
      throw new NeedsAnswer(question.text);
  }
}

/**
 * Make the vault. On this computer a business that is open is closed first, because the engine refuses a second
 * vault while one is open (it opens again from the business menu). Hosted keeps the key on the server, takes no
 * folder and switches the session itself.
 */
export async function makeVault(request: Request, transport: Transport, name: string, passphrase?: string): Promise<WorkspaceCreated> {
  const hosted = transport === 'hosted';
  if (!hosted) {
    const status = await request('workspace.status', {});
    if (status.open) await request('workspace.lock', {});
  }
  const params = hosted ? { name, pack: 'services' as const } : { name, pack: 'services' as const, folder: null };
  return request('workspace.create', passphrase === undefined ? params : { ...params, passphrase });
}

/**
 * Inside the new vault: the business, the template interview, the plan. Running it again after a failure is safe:
 * an existing business is kept (VENTURE_EXISTS) and only unanswered questions are answered.
 */
export async function setUpPlan(request: Request, sentence: Sentence): Promise<void> {
  const payload: { idea: string; countryCode: string; workingName?: string } = { idea: sentence.idea, countryCode: sentence.countryCode };
  const name = sentence.name.trim();
  if (name.length >= 2 && name.length <= 80) payload.workingName = name;
  try { await request('venture.create', payload); }
  catch (error) { if (!(error instanceof EngineError && error.code === 'VENTURE_EXISTS')) throw error; }
  let view = await request('venture.interview.next', { useTemplate: true });
  const asked = new Set<string>();
  for (let guard = 0; guard < 12; guard++) {
    const question = view.interview.questions.find((q) => q.answer === null && !asked.has(q.id));
    if (!question) break;
    asked.add(question.id);
    view = await request('venture.interview.answer', { questionId: question.id, answer: answerFor(question) });
  }
  await request('venture.blueprint.draft', { useTemplate: true });
}
