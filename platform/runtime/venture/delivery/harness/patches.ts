// Chausar delivery harness: typed playbook patches. A playbook is data, never code, so the improvement loop edits it
// with one small typed operation at a time. Code checks every patch before any model money is spent: the step,
// tool, check or dictionary entry must exist, grants stay inside what the service type may hold, outside writes are
// never granted, budgets stay inside fixed choices, and no guidance asks the agent to do sums.
// The owner's own changes from chat (Ink v2 wave 4, 4B1) are checked under the owner rules: guidance only, on the
// steps the agent owns, and a number only when the owner's quoted words hold it.
// The turn choices live in a leaf module, imported first, so a module that reads them at load time never meets them
// unset through an import cycle back to this file (the run controls do).
import { TURN_CHOICES } from './turn-choices.ts';
import { check } from '../../../contracts.ts';
import { digitCopy } from '../../core/secrets.ts';
import { namesMoneyScale, scaledAmountToken } from '../../core/money-words.ts';
import { assertNoMoney, assertNoNumbers, copiedTokens, houseStyleFindings, modelNumbers, tidyWords } from '../../records.ts';
import { CHECK_IDS, PLAYBOOK_PATCH_OPS, TOOL_NAMES } from '../../contracts.ts';
import type { CheckId, HarnessLimits, PlaybookPatch, PlaybookPatchOp, PlaybookStep, ServiceType, ToolName } from '../../contracts.ts';
import { CA_FIRM_ID } from '../../playbooks/ca-firm/registration.ts';
import { SOCIAL_AGENCY_ID } from '../../playbooks/social/registration.ts';
import { YOUTUBE_ID } from '../../playbooks/youtube/registration.ts';
import { toolSpec } from './tools.ts';
import type { PlaybookDefinition } from '../../playbooks/kit/define.ts';
import { kitDefinition, kitDefinitions } from '../../playbooks/kit/installed.ts';

export const MAX_GUIDANCE_LINES = 6;
export { TURN_CHOICES };
const AGENT_KINDS = new Set(['gather', 'question', 'work']);
const SUMS = /\b(add(?:s|ed|ing)? up|sum(?:s|med|ming)?|totals?|totalling|totaling|calculat\w*|comput\w*|subtract\w*|multipl\w*|divid\w*|arithmetic|percent\w*|work(?:s|ed|ing)? out|deduct\w*|minus|net(?:s|ted|ting)? off|tally|tallies)\b/i;

/** A flagship playbook's own tools, by playbook id: only its agents may ever hold them. */
export const FLAGSHIP_TOOLS: Readonly<Record<string, readonly ToolName[]>> = Object.freeze({
  [CA_FIRM_ID]: Object.freeze(['tax.income', 'tax.interest', 'tax.gst', 'tax.tds', 'tax.statements', 'tax.portal'] as const),
  [YOUTUBE_ID]: Object.freeze(['youtube.hooks', 'youtube.editList', 'youtube.chapters', 'youtube.retention', 'youtube.editOps', 'youtube.clean', 'youtube.captions', 'youtube.coverage', 'youtube.dictionary'] as const),
  [SOCIAL_AGENCY_ID]: Object.freeze(['social.report'] as const),
});

/**
 * The tools each service type's agents may ever hold. The bookkeeping tools stay with bookkeeping, and a flagship
 * playbook's own tools with that playbook (flagship: the playbook the business delivers with, or null). A kit
 * playbook's own tools are its definition's tools (Ink v2 wave 5, 5A1; definitions: default the landed ones), so no
 * other playbook's agents ever hold them. Every agent may note where a fact came from (evidence.record).
 */
export function toolCeiling(type: ServiceType, flagship: string | null = null, definitions: readonly PlaybookDefinition[] = kitDefinitions()): ToolName[] {
  const base: ToolName[] = ['files.list', 'files.read', 'dictionary.browse', 'dictionary.resolve', 'calc.sum', 'calc.totals', 'sandbox.transform', 'sandbox.python', 'handoff.client', 'handoff.owner', 'agent.delegate', 'evidence.record'];
  const own: readonly ToolName[] = flagship !== null && Object.hasOwn(FLAGSHIP_TOOLS, flagship) ? FLAGSHIP_TOOLS[flagship]
    : (kitDefinition(flagship, definitions)?.tools ?? []) as readonly ToolName[];
  return [...base, ...(type === 'bookkeeping' ? ['books.reconcile', 'bills.pick'] as const : []), ...own];
}

export type PlaybookBody = { steps: PlaybookStep[]; limits: HarnessLimits; aliases: Record<string, string[]> };

const refuse = (message: string): never => { check(false, 'INVALID_VENTURE_REQUEST', message); throw new Error(message); };

// ---------------------------------------------------------------------------
// Words in an owner change: numbers only as the owner wrote them, no money, nothing hidden (4B1)
// ---------------------------------------------------------------------------

/** Hidden characters (format controls such as zero-width spaces, bidi overrides and the tag block, and controls), as records.ts modelWords refuses them. */
const HIDDEN_CHARACTER = /[\p{Cf}\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;
/** A number as written, whole: digits with their comma or point groups, a percent sign and letters joined to it ("1,00,000", "20%", "20k", "2nd"). */
const NUMBER_SPAN = /\p{Nd}+(?:[,.]\p{Nd}+)*%?\p{L}*/gu;
/** Words in Devanagari, with their vowel signs. */
const HINDI_WORD = /[\p{L}\p{M}]+/gu;
/** Hindi words compared without the nukta, so हज़ार and हजार are one word. */
export const plainHindi = (text: string): string => text.normalize('NFD').replace(/\u093C/g, '').normalize('NFC');
/**
 * Hindi number words: two to ten, the teens and tens, a hundred, thousand, lakh and crore, halves and multiples, and
 * percent. एक (one) is left out, as "one" is in English.
 */
const HINDI_NUMBERS: ReadonlySet<string> = new Set([
  'दो', 'तीन', 'चार', 'पाँच', 'पांच', 'छह', 'छः', 'छे', 'सात', 'आठ', 'नौ', 'दस', 'ग्यारह', 'बारह', 'तेरह', 'चौदह', 'पंद्रह', 'पन्द्रह', 'सोलह', 'सत्रह',
  'अठारह', 'उन्नीस', 'बीस', 'पच्चीस', 'तीस', 'पैंतीस', 'चालीस', 'पैंतालीस', 'पचास', 'पचपन', 'साठ', 'पैंसठ', 'सत्तर', 'पचहत्तर', 'अस्सी', 'नब्बे',
  'सौ', 'हज़ार', 'हजार', 'लाख', 'करोड़', 'करोड', 'आधा', 'आधी', 'आधे', 'डेढ़', 'ढाई', 'सवा', 'साढ़े', 'दुगना', 'दुगुना', 'दोगुना', 'तिगुना', 'चौगुना',
  'दर्जन', 'प्रतिशत', 'फ़ीसदी', 'फीसदी',
].map(plainHindi));
/** Hindi currency words: rupees and paise. */
const HINDI_CURRENCY = /(?:^|[^\p{L}\p{M}])(?:रुपये|रुपए|रुपया|रुपयों|रूपये|रूपए|रु|पैसे|पैसा)(?=$|[^\p{L}\p{M}])/u;
/** Discounts: a price change in any words. */
const DISCOUNT = /\bdiscount\w*|\p{Nd}\s*%?\s*off\b|छूट|डिस्काउंट/iu;
/** Currency codes; the owner writing one ("INR 500") never lets an amount through. */
const CURRENCY_CODES: ReadonlySet<string> = new Set(['inr', 'gbp', 'usd', 'eur', 'aud', 'cad', 'sgd', 'aed', 'nzd', 'jpy']);

/** The Hindi number words in a text, compared without the nukta. */
export function hindiNumberWords(text: string): string[] {
  return [...plainHindi(text).matchAll(HINDI_WORD)].map(match => match[0]).filter(word => HINDI_NUMBERS.has(word));
}

/**
 * True when the words state an amount of money: what assertNoMoney refuses (with no currency code let through, even
 * one the owner wrote), a Hindi currency word, or a lakh or crore scale (core/money-words.ts, shared with the chief's
 * cut, 4C1): a scaled amount the owner wrote ("2L") is never let through as a copied name either. quote: the owner's
 * words, whose names (B2B, Web3) may be copied.
 */
export function statesMoney(words: string, quote: string): boolean {
  const allowed = copiedTokens(quote).filter(token => !CURRENCY_CODES.has(token) && !scaledAmountToken(token));
  try { assertNoMoney(words, 'words', allowed); } catch { return true; }
  return HINDI_CURRENCY.test(plainHindi(words)) || namesMoneyScale(words);
}

/** A number joined to its unit by a hyphen ("60-second"): the unit is not a second number. */
const HYPHEN_UNIT = /\p{Nd}+(?:[,.]\p{Nd}+)*-(?:seconds?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?|pages?|words?|lines?|steps?|points?|parts?|slides?|frames?|clips?|shorts?|episodes?)\b/giu;
/** "one" in English and Hindi (एक): a number like any other when the owner did not say it. */
const ONE = /(?<![\p{L}\p{M}])(?:one|एक)(?![\p{L}\p{M}])/giu;

/** A number span as compared: every digit read as 0 to 9 (Devanagari, fullwidth ...) and grouping commas dropped, so "1,00,000" is "100000". */
function spanKey(span: string): string {
  return digitCopy(span).replace(/,(?=\d)/g, '').toLowerCase();
}

/**
 * True when the words hold a number the owner's quote does not: a whole number span, compared as read ("६०" is "60",
 * "1,00,000" is "100000", but "1,000" is not "1,000,000" and "20%" is not "20"), a Hindi number word, "one", an
 * English number word, or a percent sign or number character on its own. A unit joined by a hyphen ("60-second") is
 * part of its number. Exported for the agents' notes (4B2), which keep only the numbers the owner said.
 */
export function unsaidFigure(words: string, quote: string): boolean {
  const spans = (text: string) => [...text.matchAll(NUMBER_SPAN)].map(match => spanKey(match[0]));
  const said = new Set(spans(quote));
  if (spans(words).some(span => !said.has(span))) return true;
  const saidHindi = new Set(hindiNumberWords(quote));
  if (hindiNumberWords(words).some(word => !saidHindi.has(word))) return true;
  const saidOnes = new Set((quote.match(ONE) ?? []).map(word => word.toLowerCase()));
  if ((words.match(ONE) ?? []).some(word => !saidOnes.has(word.toLowerCase()))) return true;
  const saidTokens = [...quote.toLowerCase().matchAll(/[\p{L}\p{Nd}]+(?:[-./'’][\p{L}\p{Nd}]+)*/gu)].map(match => match[0]);
  return modelNumbers(words.replace(HYPHEN_UNIT, ' ').replace(NUMBER_SPAN, ' '), saidTokens);
}

/**
 * Words a patch adds: tidy, short, nothing hidden, no numbers, house style, and never an instruction to do sums.
 * quote: the owner's own words an owner patch came from; a number the quote holds, as written, may stay (keep shorts
 * under 60 seconds), one the owner did not say may not, and an amount of money or a discount never does.
 */
function patchWords(value: string, field: string, max: number, quote: string | null = null): string {
  check(!HIDDEN_CHARACTER.test(value), 'INVALID_VENTURE_REQUEST', `The ${field} held hidden characters. Chausar keeps plain words only.`);
  const words = tidyWords(value);
  check(words.length >= 2 && words.length <= max, 'INVALID_VENTURE_REQUEST', `The ${field} must be between two and ${max} characters.`);
  if (quote === null) {
    try { assertNoNumbers(words, field); } catch { refuse(`The ${field} contained a number. Numbers come from the calculator.`); }
  } else {
    if (statesMoney(words, quote) || DISCOUNT.test(words)) refuse(`The ${field} named an amount of money or a discount. Prices come from your plan and the calculator, not from an agent's instructions.`);
    if (unsaidFigure(words, quote)) refuse(`The ${field} has a number you did not say. An instruction from chat keeps only the numbers in your own words.`);
  }
  check(houseStyleFindings(words).length === 0, 'INVALID_VENTURE_REQUEST', `The ${field} breaks the house style.`);
  return words;
}

/** The changes the owner may make from chat (4B1): guidance only. Tools, checks, limits and words for the dictionary are not. */
export const OWNER_PATCH_OPS: readonly PlaybookPatchOp[] = Object.freeze(['guidance.add', 'guidance.remove']);

/** Why chat cannot make a change: it would touch what always asks the owner, money, or the tools, checks and limits. */
export const FLOOR_REASON = 'Publishing, sending, money out and deleting always ask you first, at every posture. Chat does not change that.';
export const MONEY_REASON = "Spend, prices and discounts are set by you in Money and Business, not by an agent's instructions.";
export const CONTROLS_REASON = 'Tools, checks and limits are not changed from chat.';
/**
 * Words that ask for more than guidance, matched on the words with format characters and soft hyphens taken out and
 * without the nukta. Skipping the owner: without asking, skip my approval, don't wait for me, approve it yourself
 * (बिना पूछे, पूछे बिना; bina pooche, puche bina). An action on the floor: publish, post, share, upload, go or put live,
 * schedule a post, send, email, mail, WhatsApp or message the client, reply to clients directly, invoice, pay, refund,
 * transfer, delete (पब्लिश, अपलोड, पोस्ट कर, भेज दो, भुगतान, डिलीट, मिटा; post karo, bhej do). Spend, prices, rates and
 * discounts (कीमत, दाम, रेट, छूट, खर्च, बजट; rate badha, daam). Tools, checks, limits, permissions and posture.
 */
const CONTROL: readonly { pattern: RegExp; reason: string }[] = Object.freeze([
  { pattern: /\bwithout (?:asking|checking with (?:me|you)|my (?:ok|okay|approval|go-?ahead)|approval|waiting)\b|\b(?:don'?t|do not|no need to|never) (?:ask|check with) me\b|\bask me never\b|\bon (?:its|your) own\b/i, reason: FLOOR_REASON },
  { pattern: /\bskip\w*\s+(?:my |your |the |our )?(?:approval|ok|okay|sign-?off|go-?ahead|say-?so)\b|\b(?:don'?t|do not|never|no need to)\s+wait\s+(?:for\s+(?:me|my|approval|you|the owner)|to be approved)\b|\bno need to wait\b/i, reason: FLOOR_REASON },
  { pattern: /\bapprov\w*(?:\s+(?:it|this|them|that|everything|each\s+\w+|every\s+\w+|the\s+\w+))?\s+(?:yourself|on your own|without me)\b|\bself[- ]?approv\w*/i, reason: FLOOR_REASON },
  { pattern: /\bbina\s+p(?:oo|u)c?hh?e\b|\bp(?:oo|u)c?hh?e\s+bina\b|बिना\s+प[ूु]छे|प[ूु]छे\s+बिना|मत\s+पूछ|पूछना\s+मत/iu, reason: FLOOR_REASON },
  { pattern: /\b(?:publish\w*|go(?:es)? live|upload\w*|send (?:it|this|them|the|to|out)|email (?:it|the|them|clients?)|invoic\w*|pay (?:for|the|out|it|them)|payments?|refund\w*|transfer\w*|delet\w*|eras\w*)\b/i, reason: FLOOR_REASON },
  { pattern: /(?:^|[,.;:!]\s*|\b(?:to|and|then|please|always|never|just|also|you|can|will|go ahead and|ab se|hamesha)\s+)(?:post|share|tweet|upload|publish)(?:s|ed|ing)?\b|\bpost\s+kar\w*|\bshare\b[^.]{0,40}\b(?:instagram|youtube|facebook|linkedin|twitter|tiktok|whatsapp|reels?)\b/i, reason: FLOOR_REASON },
  { pattern: /\b(?:reply|respond|write\s+back|answer)\s+(?:back\s+)?(?:to\s+)?(?:the\s+)?clients?\s+directly\b|\b(?:reply|respond)\s+directly\b|\bdirectly\s+(?:reply|respond)\w*|\bwhats\s?app\w*|\b(?:e-?mail|mail|message|dm|text|sms)\s+(?:it\s+to\s+|this\s+to\s+)?(?:the\s+)?clients?\b/i, reason: FLOOR_REASON },
  { pattern: /\b(?:put|make|take|push|set)\s+(?:it|them|this|that|the\s+\w+)\s+live\b|\bschedul\w*\s+(?:the\s+|a\s+|each\s+|every\s+)?(?:posts?|shorts?|videos?|uploads?|reels?|tweets?)\b|\bbhej\s+(?:do|dena|dein|diya|dijiye)\b/i, reason: FLOOR_REASON },
  { pattern: /पब्लिश|अपलोड|पोस्ट\s+कर|भुगतान|पेमेंट|रिफंड|डिलीट|मिटा|भेज\s+(?:दो|देना|दें|दीजिए|दिया)/u, reason: FLOOR_REASON },
  { pattern: /\b(?:spend\w*|spent|budget\w*|prices?|pricing|priced|discount\w*|fees?|charg(?:e|es|ed|ing)|quote (?:below|above|under|over|less|more|at)|rate card|cheaper|costlier)\b|\p{Nd}\s*%\s*off\b|कीमत|दाम|रेट|छूट|डिस्काउंट|खर्च|बजट|\b(?:kimat|keemat|daam)\b/iu, reason: MONEY_REASON },
  { pattern: /\b(?:increase|raise|bump|hike|lower|cut|drop|reduce|change|double|halve)\w*\b[^.]{0,30}\brates?\b|\brates?\b[^.]{0,20}\b(?:up|down|higher|lower)\b|\brates?\s+(?:badha|ghata|kam|zyada)\w*/i, reason: MONEY_REASON },
  { pattern: /\btools?\b|\bskip\w*\s+(?:the\s+|any\s+|all\s+)?(?:[\w-]+\s+){0,3}(?:checks?|reviews?|verification)\b|\b(?:turn(?:s|ed)? off|disabl\w*|switch(?:es|ed)? off|drop|remove)\s+(?:the\s+|any\s+|all\s+)?(?:[\w-]+\s+){0,3}checks?\b|\blimits?\b|\b(?:more|fewer|extra) turns\b|\bturn limit\b|\bpermissions?\b|\baccess to\b|\bgrant\w*\b|\bposture\b|\bauto(?:matically)?[ -]approv\w*\b/i, reason: CONTROLS_REASON },
]);

/**
 * Why words from chat cannot become guidance, or null when they can: they ask for more than how the agent works
 * (skipping the owner, an action on the floor, spend, prices or rates, tools, checks or limits). Code, not a model.
 * Format characters and soft hyphens are taken out first, so a zero-width space cannot split "without".
 */
export function ownerControlReason(text: string): string | null {
  const plain = plainHindi(text.replace(/[\p{Cf}\u00AD]/gu, ''));
  return CONTROL.find(item => item.pattern.test(plain))?.reason ?? null;
}

/**
 * Who may change a playbook from chat, checked before an owner patch applies. owner, when the caller knows it: the
 * steps the agent owns, and the guidance lines the owner added before (the only lines chat may remove). A rebuild for
 * a changed plan replays an owner patch without it: the step and the words are checked again, the role was checked
 * when the owner accepted it. A line that asks for more than guidance is refused like a tool or check change.
 */
function ownerRules(patch: PlaybookPatch, owner: { steps: readonly string[]; added: readonly string[] } | undefined): string {
  check(OWNER_PATCH_OPS.includes(patch.op), 'PATCH_OWNER_OP', CONTROLS_REASON);
  const quote = patch.source?.quote;
  check(typeof quote === 'string' && quote.trim().length > 0 && typeof patch.source?.messageId === 'string', 'INVALID_VENTURE_REQUEST', 'A change from chat keeps the words you said.');
  if (patch.op === 'guidance.add') {
    const control = ownerControlReason(patch.value);
    check(control === null, 'PATCH_OWNER_OP', control ?? '');
  }
  if (owner) {
    check(owner.steps.includes(patch.stepId), 'PATCH_NOT_YOUR_STEP', "That step is another agent's. Ask the agent that does it.");
    if (patch.op === 'guidance.remove') {
      check(owner.added.includes(patch.value), 'PATCH_OWNER_OP', 'That instruction is built into the playbook, so chat cannot remove it. Chat removes only instructions you gave.');
    }
  }
  return quote;
}

/**
 * Applies one patch to a playbook body and returns a new body; the input is never changed. Refuses (with a plain
 * reason) any patch that does not apply cleanly or would leave the playbook outside its limits. flagship: the
 * playbook the business delivers with (deliveryFlagship), whose own tools it may grant; absent or null for none.
 * A patch proposedBy 'owner' (from chat, 4B1) is checked under the owner rules first (ownerRules); owner gives the
 * agent's steps and the owner's earlier lines when the caller knows them. Model and Chausar patches keep these rules.
 */
export function applyPatch(body: PlaybookBody, patch: PlaybookPatch, context: { serviceType: ServiceType; entryIds: readonly string[]; flagship?: string | null; owner?: { steps: readonly string[]; added: readonly string[] }; definitions?: readonly PlaybookDefinition[] }): PlaybookBody {
  check((PLAYBOOK_PATCH_OPS as readonly string[]).includes(patch.op), 'INVALID_VENTURE_REQUEST', 'The patch names an unknown change.');
  const quote = patch.proposedBy === 'owner' ? ownerRules(patch, context.owner) : null;
  const next: PlaybookBody = structuredClone(body);
  const stepOf = (kinds: (kind: string) => boolean, what: string): PlaybookStep => {
    const step = next.steps.find(item => item.id === patch.stepId);
    if (!step || !kinds(step.kind)) refuse(`The patch names ${JSON.stringify(patch.stepId)}, which is not ${what} in this playbook.`);
    return step!;
  };
  switch (patch.op) {
    case 'guidance.add': {
      const step = stepOf(kind => AGENT_KINDS.has(kind) || kind === 'write', 'an agent or writing step');
      const words = patchWords(patch.value, 'guidance', 200, quote);
      if (SUMS.test(words)) refuse("Guidance can't ask the agent to do sums; the calculator does them.");
      const lines = step.guidance ?? [];
      if (lines.includes(words)) refuse('The step already has that guidance.');
      if (lines.length >= MAX_GUIDANCE_LINES) refuse(`A step holds at most ${MAX_GUIDANCE_LINES} lines of guidance.`);
      step.guidance = [...lines, words];
      break;
    }
    case 'guidance.remove': {
      const step = stepOf(kind => AGENT_KINDS.has(kind) || kind === 'write', 'an agent or writing step');
      const lines = step.guidance ?? [];
      if (!lines.includes(patch.value)) refuse('The step has no such guidance to remove.');
      step.guidance = lines.filter(line => line !== patch.value);
      break;
    }
    case 'tools.grant': {
      const step = stepOf(kind => AGENT_KINDS.has(kind), 'an agent step');
      const tool = patch.value as ToolName;
      if (!(TOOL_NAMES as readonly string[]).includes(tool)) refuse(`There is no tool called ${JSON.stringify(patch.value)}.`);
      if (toolSpec(tool)?.effect === 'outside-write') refuse('Outside actions wait for your approval; an agent step never holds them.');
      if (!toolCeiling(context.serviceType, context.flagship ?? null, context.definitions).includes(tool)) refuse(`A ${context.serviceType} agent may not hold ${tool}.`);
      if ((step.tools ?? []).includes(tool)) refuse(`The step already holds ${tool}.`);
      step.tools = [...(step.tools ?? []), tool];
      break;
    }
    case 'tools.revoke': {
      const step = stepOf(kind => AGENT_KINDS.has(kind), 'an agent step');
      if (!(step.tools ?? []).includes(patch.value as ToolName)) refuse(`The step does not hold ${patch.value}.`);
      step.tools = (step.tools ?? []).filter(tool => tool !== patch.value);
      break;
    }
    case 'checks.add': {
      const step = stepOf(kind => kind === 'verify' || kind === 'write', 'a writing or checking step');
      if (!(CHECK_IDS as readonly string[]).includes(patch.value)) refuse(`There is no check called ${JSON.stringify(patch.value)}.`);
      if (step.checks.includes(patch.value as CheckId)) refuse('The step already runs that check.');
      step.checks = [...step.checks, patch.value as CheckId];
      break;
    }
    case 'limits.turns': {
      if (!(TURN_CHOICES as readonly string[]).includes(patch.value)) refuse(`Turn limits are one of ${TURN_CHOICES.join(', ')}.`);
      const turns = parseInt(patch.value, 10);
      if (turns === next.limits.maxTurns) refuse('The playbook already has that turn limit.');
      next.limits = { ...next.limits, maxTurns: turns, maxToolCalls: turns * 3 };
      break;
    }
    case 'alias.add': {
      const split = patch.value.indexOf('=');
      const entryId = split > 0 ? patch.value.slice(0, split).trim() : '';
      if (!context.entryIds.includes(entryId)) refuse(`The dictionary has no entry ${JSON.stringify(entryId)}.`);
      const word = patchWords(patch.value.slice(split + 1), 'alias', 40);
      const list = next.aliases[entryId] ?? [];
      if (list.map(item => item.toLowerCase()).includes(word.toLowerCase())) refuse('The entry already has that word.');
      if (list.length >= 8) refuse('An entry holds at most eight extra words.');
      next.aliases = { ...next.aliases, [entryId]: [...list, word] };
      break;
    }
  }
  return next;
}

/** Plain words for one change, for the owner's diff. */
export function describePatch(patch: PlaybookPatch, steps: readonly PlaybookStep[]): string {
  const title = steps.find(step => step.id === patch.stepId)?.title ?? patch.stepId;
  switch (patch.op) {
    case 'guidance.add': return `Adds to "${title}": ${patch.value}`;
    case 'guidance.remove': return `Removes from "${title}": ${patch.value}`;
    case 'tools.grant': return `Lets "${title}" use ${patch.value}.`;
    case 'tools.revoke': return `Stops "${title}" using ${patch.value}.`;
    case 'checks.add': return `Adds the ${patch.value} check to "${title}".`;
    case 'limits.turns': return `Gives the agent ${patch.value} turns before it must write.`;
    case 'alias.add': return `Teaches the dictionary another word: ${patch.value.slice(patch.value.indexOf('=') + 1)}.`;
  }
}
