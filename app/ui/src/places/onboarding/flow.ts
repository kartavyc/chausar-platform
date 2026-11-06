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

import type { Language } from '../../text';
import { EngineError, type EngineClient, type InterviewAnswer, type InterviewQuestionLite, type Transport, type WorkspaceCreated } from '../../engine/types';
import { COUNTRY_TIME_ZONES } from '../../../../../platform/runtime/venture/local-day-data';

/** venture.preview and venture.create take 10 to 2000 characters. */
export const OPEN_BOX = { min: 10, max: 2000 } as const;
export const PASSPHRASE_MIN = 12;
/** The working name when the preview names nothing; the engine's own default. Data for the vault, not copy. */
export const DEFAULT_NAME = 'My service business';

export type Request = EngineClient['request'];

/** What the owner wrote and where, with the name the vault gets. */
/**
 * offers and by (one-shot A1, row 3): the offers the owner saw and kept on About you and who wrote them (the AI's
 * reading, or the keywords or a tile), saved as the plan's offers; without them the plan keeps the template's.
 */
export interface Sentence { idea: string; countryCode: string; name: string; offers?: readonly { name: string; line: string }[]; by?: 'model' | 'template'; callId?: string }

const ZONE_COUNTRIES: Readonly<Record<string, string>> = Object.freeze({
  ...Object.fromEntries(Object.entries(COUNTRY_TIME_ZONES).map(([country, zone]) => [zone, country])),
  'Asia/Calcutta': 'IN',
  'America/Los_Angeles': 'US', 'America/Chicago': 'US', 'America/Denver': 'US', 'America/Phoenix': 'US',
  'America/Detroit': 'US', 'America/Anchorage': 'US', 'America/Adak': 'US', 'Pacific/Honolulu': 'US',
  'America/Boise': 'US', 'America/Juneau': 'US', 'America/Nome': 'US', 'America/Sitka': 'US', 'America/Yakutat': 'US',
  'America/Vancouver': 'CA', 'America/Edmonton': 'CA', 'America/Winnipeg': 'CA', 'America/Halifax': 'CA',
  'America/St_Johns': 'CA', 'America/Regina': 'CA', 'America/Whitehorse': 'CA', 'America/Dawson': 'CA',
  'America/Moncton': 'CA', 'America/Glace_Bay': 'CA', 'America/Goose_Bay': 'CA', 'America/Iqaluit': 'CA',
  'America/Rankin_Inlet': 'CA', 'America/Resolute': 'CA', 'America/Cambridge_Bay': 'CA', 'America/Inuvik': 'CA',
  'America/Dawson_Creek': 'CA', 'America/Fort_Nelson': 'CA', 'America/Swift_Current': 'CA',
  'Pacific/Chatham': 'NZ', 'Europe/Busingen': 'DE',
});

/** A supported country from the computer's IANA time zone. Unknown zones need the owner's choice. */
export function timeZoneCountry(zone: string | undefined): string | null {
  if (!zone) return null;
  if (zone.startsWith('Australia/')) return 'AU';
  if (zone.startsWith('America/Indiana/') || zone.startsWith('America/Kentucky/') || zone.startsWith('America/North_Dakota/')) return 'US';
  return ZONE_COUNTRIES[zone] ?? null;
}

export function computerCountry(): string | null {
  try { return timeZoneCountry(Intl.DateTimeFormat().resolvedOptions().timeZone); }
  catch { return null; }
}

/** The time zone's country when Chausar has a table for it, else "another country". */
export function pickCountry(codes: readonly string[], region: string | null): string {
  if (region && codes.includes(region)) return region;
  return codes.includes('XX') ? 'XX' : codes[0] ?? 'XX';
}

/** Country labels keep the engine's English wording. Translation plumbing remains at the call sites. */
export function countryWords(country: { code: string; name: string }, _language: Language, _t: (key: string) => string): string {
  return country.name;
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
 * Inside the new vault: the business, the template interview, the plan. reuseAi: the Start gallery's business reuses the
 * AI set up in another business on this computer. Running it again after a failure is safe:
 * an existing business is kept (VENTURE_EXISTS) and only unanswered questions are answered.
 */
export async function setUpPlan(request: Request, sentence: Sentence, options: { reuseAi?: boolean } = {}): Promise<void> {
  const payload: { idea: string; countryCode: string; workingName?: string; reuseAi?: true } = { idea: sentence.idea, countryCode: sentence.countryCode };
  // A4 fix round: from the Start gallery, the AI set up in another business comes along (the engine decides what).
  if (options.reuseAi) payload.reuseAi = true;
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
  // Review of A1 (row 3): the first plan is the one About you showed, its words still the AI's or the template's.
  const offers = (sentence.offers ?? []).filter((offer) => offer.name.trim().length >= 2).slice(0, 3).map((offer) => ({ name: offer.name.trim(), line: offer.line.trim() }));
  const shownName = sentence.name.trim();
  try {
    await request('venture.blueprint.draft', offers.length && shownName.length >= 2 && shownName.length <= 60
      ? { useTemplate: true, shown: { name: shownName, by: sentence.by ?? 'template', ...(sentence.callId ? { callId: sentence.callId } : {}), offers } } : { useTemplate: true });
  } catch (error) {
    // A retry after the kept plan was saved: it is saved already, so running this again stays safe.
    if (!(error instanceof EngineError && error.code === 'PLAN_ALREADY_KEPT')) throw error;
  }
}
