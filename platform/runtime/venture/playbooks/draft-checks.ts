// Chausar flagship playbooks: their own checks on a draft (playbook wiring, design 7.5 and 7.8). Code only, no model.
// The delivery run and the rehearsal run these after the harness checks (delivery/runs.ts, delivery/simulate.ts) and
// keep the results on the run as playbookChecks; a failed one blocks Accept and fails a practice episode. A check that
// could not run says why ("not run: ..."), and that is never a pass.
// - YouTube channel: the package checks of youtube/checks.ts on the drafted package (hook, title and thumbnail,
//   metadata limits, chapters, retention, AI and paid promotion disclosure, rights and source credit), with the
//   client's transcript when one came with the order (SRT or VTT), and the finishing check on the cut named at intake
//   when ffmpeg is on this computer (youtube/finishing.ts).
// - AI-native CA firm: the claim checks of ca-firm/claims.ts on the model's words and the figures it quotes, against the
//   run's receipts (a tax engine's receipt is kept whole on its work receipt); whether a case the calculator does not
//   model reaches the CA through the open items (not-modelled-refused); the run's statement matches listed and tied
//   (differences-listed, gaps-tie); every difference from the portal explained by the CA (portal-diff-explained); and
//   whether the papers wait for the CA of record's sign-off (ca-firm/signoff.ts records it).
// - Social media agency: the post checks of social/checks.ts on each post the draft names a channel for: channel
//   limits (a long X or Threads post split into a thread by code), disclosure, claims against the client's message and
//   files, and the client's words with their own lists from intake; on a content calendar, each slot code planned has
//   its post (calendar-slots); on a monthly report, every figure in the words has a receipt (narrative-receipted).
// - Every flagship: the prompt-leak lint on the agent's words (prompt-leak.ts); a leak fails and blocks Accept.
// - YouTube and social: rules-current, whether the dated platform rules the checks that ran rest on are still inside
//   their recheck window (rules-current.ts); past it, 'not run' naming the rules to recheck, which never blocks Accept.
// The rules judge asks each playbook's own rules in rehearsal (flagshipJudgeRules).
import type { DateOrder, Deliverable, IsoDate, OrderIntake, PlaybookCheckResult, ToolCallRecord, WorkTableRecord } from '../contracts.ts';
import type { AnyReceipt } from '../delivery/deliverable.ts';
import { transcriptCues, type FileLike } from '../delivery/harness/files.ts';
import { deliverableWords } from '../delivery/judge/claim-check.ts';
import type { JudgeRule } from '../delivery/judge/rules.ts';
import { CA_DRAFT_SECTIONS, CA_OFFERS } from './ca-firm/playbook.ts';
import { checkCaDraft, CA_JUDGE_RULES, type CalculatorRefusal } from './ca-firm/claims.ts';
import type { CaReceipt } from './ca-firm/receipt.ts';
import type { Difference, ReconcileWorking, Tie } from './ca-firm/reconcile.ts';
import { portalDiffExplained } from './ca-firm/stored-receipt.ts';
import { CA_FIRM_ID } from './ca-firm/registration.ts';
import { keptHooksOf, parsePackageText, runYoutubeChecks, type YoutubeCheckResult, type YoutubeOrder } from './youtube/checks.ts';
import { finishingCheck, finishingResult, systemFfmpeg, type FfmpegPort } from './youtube/finishing.ts';
import { YOUTUBE_DRAFT_RULES } from './youtube/judge.ts';
import { YOUTUBE_OFFERS, YOUTUBE_STEPS, type YoutubeOfferId } from './youtube/playbook.ts';
import { YOUTUBE_ID } from './youtube/registration.ts';
import { checkDraftClaims, checkSocialDraft, checkWords, countCharacters, type Finding, type PostDraft, type SocialCheckId } from './social/checks.ts';
import { postOfLine, socialRules, threadParts } from './social/post-lines.ts';
import { channelCapability } from './social/channels.ts';
import type { CalendarSlot } from './social/calendar.ts';
import { assignSlots, calendarPosts, calendarSlots, socialDraftPosts } from './social/draft-posts.ts';
import { checkReportNarrative, reportFiguresOf } from './social/report.ts';
import { SOCIAL_JUDGE_RULES } from './social/judge.ts';
import { SOCIAL_AGENCY_ID } from './social/registration.ts';
import { PROMPT_LEAK_CHECK, promptLeakLine, promptLeaks, type PromptLeak } from './prompt-leak.ts';
import { rulesCurrentResult } from './rules-current.ts';

export type FlagshipCheckInput = {
  flagship: string;
  /** The playbook offer the order is (Offer.playbookOffer), or null. */
  offerKey: string | null;
  servedBy: 'model' | 'template';
  deliverable: Deliverable;
  /** What the client asked for; client data, read by code only. */
  request: string;
  /** The order's intake; null in rehearsal, where practice clients record nothing. */
  intake: OrderIntake | null;
  /** The client's files on the order, or a practice client's files. */
  files: readonly FileLike[];
  /** The business's price receipts and the run's work receipts. */
  receipts: readonly AnyReceipt[];
  /** Names that are never claims: the business, its plan and offers, the client. */
  known: readonly string[];
  mode: 'rehearsal' | 'client';
  today: IsoDate;
  dateOrder: DateOrder;
  /** The ffmpeg the finishing check runs; null where no cut on this computer is read (the hosted server). Default: the ffmpeg on PATH. */
  finishing?: { ffmpeg: FfmpegPort; exists?: (path: string) => boolean } | null;
  /** The CA firm calculator's refusals in this run (ca-firm/claims.ts refusalsOf): a tax working they touch fails, do not retry. */
  refusals?: readonly CalculatorRefusal[];
  /** The tables the run's tools made (the hooks the scorer kept, an edit list), oldest first. */
  tables?: readonly WorkTableRecord[];
  /** The run's tool calls with their envelopes, for checks that read what a tool refused (NOT_MODELLED). */
  toolCalls?: readonly ToolCallRecord[];
  /** The CA of record's explanations of portal differences so far (ca-firm/signoff.ts diffExplanations); none in rehearsal. */
  caExplanations?: readonly { receiptId: string; key: string; note: string }[];
};

/** The rules judge's rules for a flagship playbook's drafts, or null for any other playbook. */
export function flagshipJudgeRules(flagship: string | null | undefined): readonly JudgeRule[] | null {
  if (flagship === YOUTUBE_ID) return YOUTUBE_DRAFT_RULES;
  if (flagship === CA_FIRM_ID) return CA_JUDGE_RULES;
  if (flagship === SOCIAL_AGENCY_ID) return SOCIAL_JUDGE_RULES;
  return null;
}

/** The first failed playbook check, in the owner's words, or null. */
export function failedPlaybookCheck(results: readonly PlaybookCheckResult[] | undefined): PlaybookCheckResult | null {
  return results?.find(item => item.outcome === 'fail') ?? null;
}

/** Every text part of a draft, one line each, in order. Figures and dates come from receipts and are left out. */
function textLines(deliverable: Deliverable): string[] {
  return deliverable.sections.flatMap(section => section.parts.flatMap(part => (part.kind === 'text' ? [part.text] : [])));
}

/**
 * The playbook's checks on a draft, then the prompt-leak lint on the agent's words (prompt-leak.ts). Template outlines
 * are not drafts these checks read, so nothing runs on them.
 */
export async function runFlagshipChecks(input: FlagshipCheckInput): Promise<PlaybookCheckResult[]> {
  const own = await playbookOwnChecks(input);
  if (!own.length || input.servedBy === 'template') return own;
  const line = promptLeakLine(draftLeaks(input));
  return [...own, { playbook: input.flagship, check: PROMPT_LEAK_CHECK, outcome: line ? 'fail' : 'pass', detail: line ?? 'No words meant for the AI and no template placeholders.' }];
}

/** Leaks in the whole draft, and in each social post line read as the exact post (where template labels count too). */
function draftLeaks(input: FlagshipCheckInput): PromptLeak[] {
  const posts = input.flagship === SOCIAL_AGENCY_ID ? textLines(input.deliverable).flatMap(line => postOfLine(line) ?? []) : [];
  return [...promptLeaks(deliverableWords(input.deliverable)), ...posts.flatMap(post => promptLeaks(post.text, 'post'))];
}

async function playbookOwnChecks(input: FlagshipCheckInput): Promise<PlaybookCheckResult[]> {
  const as = (check: string, outcome: PlaybookCheckResult['outcome'], detail: string): PlaybookCheckResult => ({ playbook: input.flagship, check, outcome, detail });
  if (![YOUTUBE_ID, CA_FIRM_ID, SOCIAL_AGENCY_ID].includes(input.flagship)) return [];
  if (input.servedBy === 'template') return [as('playbook-checks', 'not-run', "not run: this playbook's checks read an agent's draft, and this is a template outline.")];
  const scope = { channels: [] as string[], exports: [] as string[], quoted: [] as string[] };
  const own = input.flagship === YOUTUBE_ID ? (await youtubeChecks(input)).map(item => as(item.check, item.outcome, item.detail))
    : input.flagship === CA_FIRM_ID ? caChecks(input).map(item => as(item.check, item.outcome, item.detail))
      : socialChecks(input, scope).map(item => as(item.check, item.outcome, item.detail));
  // The dated platform rules the checks that ran rest on (rules-current.ts, Ink v2 2H): not run once one is past its
  // recheck window, which never blocks Accept. A social group stands for its own checks (GROUPS below); a social draft
  // names only the rules for its own channels and exports, the rules its findings quoted first.
  const ran = own.filter(item => item.outcome !== 'not-run').flatMap(item => [item.check, ...(GROUPS.find(group => group.id === item.check)?.checks ?? [])]);
  const rules = rulesCurrentResult(input.flagship, input.today, ran, input.flagship === SOCIAL_AGENCY_ID ? scope : undefined);
  return rules ? [...own, as(rules.check, rules.outcome, rules.detail)] : own;
}

// ---------------------------------------------------------------------------
// YouTube channel
// ---------------------------------------------------------------------------

const VERIFY = YOUTUBE_STEPS.find(step => step.kind === 'verify')!;
const HOOK = /^\s*hook\s*:\s*(.+)$/i;
const NO_FOOTAGE = 'not run: practice clients send no footage, so no rights are recorded.';

async function finishing(input: FlagshipCheckInput, format: 'long' | 'short'): Promise<YoutubeCheckResult> {
  const notRun = (detail: string): YoutubeCheckResult => ({ check: 'finishing', outcome: 'not-run', detail, notes: [] });
  if (input.finishing === null) return notRun('not run: the hosted server reads no cut from your computer.');
  const cut = input.intake?.cutFile ?? null;
  if (!cut) return notRun('not run: no cut was named for this order.');
  const port = input.finishing ?? { ffmpeg: systemFfmpeg };
  return finishingResult(await finishingCheck(cut, { format, ffmpeg: port.ffmpeg, ...(port.exists ? { exists: port.exists } : {}) }));
}

async function youtubeChecks(input: FlagshipCheckInput): Promise<YoutubeCheckResult[]> {
  const lines = textLines(input.deliverable);
  const parsed = parsePackageText(lines.join('\n'));
  const hooks = lines.flatMap(line => { const match = HOOK.exec(line); return match ? [match[1].trim()] : []; });
  const intake = input.intake;
  const offer: YoutubeOfferId = YOUTUBE_OFFERS.some(item => item.id === input.offerKey) ? input.offerKey as YoutubeOfferId : 'episode-package';
  const format = intake?.format ?? 'long';
  const aiUse = !!(intake?.aiVoice || intake?.aiPresenter);
  const order: YoutubeOrder = { offer, format, rights: intake?.rights ?? null, aiVoice: !!intake?.aiVoice, aiPresenter: !!intake?.aiPresenter, paidPromotion: !!intake?.paidPromotion };
  // The client's transcript, when one came with the order: the retention check reads it, and the chapter check takes
  // the end of its last line as how long the talk runs, so a last chapter that starts too near the end fails.
  const sent = input.files.find(file => file.format === 'transcript');
  const transcript = sent ? transcriptCues(sent) : null;
  const durationMs = transcript?.length ? transcript[transcript.length - 1].endMs : null;
  // The upload settings are the owner's publishing checklist, made from the intake: the publish step ticks them. When
  // the scorer kept hooks in this run (youtube.hooks), the hook check judges the better kept one the package uses.
  const pkg = { ...parsed, hooks, keptHooks: keptHooksOf(input.tables ?? []), durationMs, uploadSettings: { aiUse, paidPromotion: !!intake?.paidPromotion } };
  const results = runYoutubeChecks({ checks: VERIFY.youtubeChecks, order, pkg, transcript, today: input.today, finishing: await finishing(input, format) });
  // Practice clients record no rights, so the rights and credit checks have nothing to read in rehearsal.
  return input.mode === 'rehearsal'
    ? results.map(item => (item.check === 'rights-recorded' || item.check === 'source-credit' ? { ...item, outcome: 'not-run' as const, detail: NO_FOOTAGE } : item))
    : results;
}

// ---------------------------------------------------------------------------
// AI-native CA firm
// ---------------------------------------------------------------------------

type CaResult = { check: string; outcome: PlaybookCheckResult['outcome']; detail: string };
const OPEN_ITEMS = CA_DRAFT_SECTIONS[2];

/**
 * A receipt as the CA checks read it: its figures with labels. A tax engine's work receipt (tools-ca.ts) keeps the
 * engine, its working and the rate tables under ca; a calculator receipt passed whole carries them itself. Only those
 * have an engine, which is how the tax figure check tells them from price receipts.
 */
function caReceiptOf(receipt: AnyReceipt): CaReceipt {
  const raw = receipt as unknown as {
    id: string; figures: CaReceipt['figures']; working?: unknown; tables?: CaReceipt['tables']; engine?: CaReceipt['engine'];
    ca?: { engine: CaReceipt['engine']; working: unknown; tables: CaReceipt['tables'] };
  };
  const engine = raw.ca ? raw.ca.engine : raw.engine;
  const tables = raw.ca ? raw.ca.tables : Array.isArray(raw.tables) ? raw.tables : [];
  return { id: raw.id, figures: raw.figures, working: (raw.ca ? raw.ca.working : raw.working) ?? null, tables, ...(engine ? { engine } : {}) } as unknown as CaReceipt;
}

/**
 * The draft as the CA checks read it, the way the client sees it (deliverable.ts renderParts): each section one line,
 * its words and each figure it quotes by reference as "label: value" from the receipt, in order. So a figure from
 * another receipt placed after words about tax is read on that tax line, and an engine label the client reads (a
 * section number in it) reaches the section check. Dates are left out: they come from code, and are not figures.
 */
function caDraftWords(input: FlagshipCheckInput): string {
  const figure = (part: { receiptId: string; figureKey: string }) => {
    const receipt = input.receipts.find(item => item.id === part.receiptId);
    const found = (receipt?.figures as readonly { key: string; label: string; display: string }[] | undefined)?.find(item => item.key === part.figureKey);
    return found ? `${found.label}: ${found.display}` : '';
  };
  const lines = [input.deliverable.title];
  for (const section of input.deliverable.sections) {
    const line = section.parts.reduce((out, part) => {
      const piece = part.kind === 'text' ? part.text : part.kind === 'figure' ? figure(part) : '';
      if (!piece) return out;
      return out === '' ? piece : `${out}${part.kind === 'text' && /^[.,;:!?)]/.test(piece) ? '' : ' '}${piece}`;
    }, '');
    if (line) lines.push(line);
  }
  return [...lines, ...input.deliverable.questionsForClient].join('\n');
}

/**
 * not-modelled-refused: a tax tool the calculator answered NOT_MODELLED in this run (a capital gain, a credit note) is
 * a part of the case only the CA can work, so the open items must hand it to the CA. Even when a later call worked
 * the rest, the part it refused stays the CA's.
 */
function notModelledRefused(input: FlagshipCheckInput): CaResult {
  const check = 'not-modelled-refused';
  const refused = (input.toolCalls ?? []).flatMap(call => (call.tool.startsWith('tax.') && !call.envelope.ok && call.envelope.error.code === 'NOT_MODELLED' ? [call.envelope.error.message] : []));
  if (!refused.length) return { check, outcome: 'pass', detail: 'The calculator refused no part of this case as not modelled.' };
  const words = [...new Set(refused)].join(' ');
  const open = input.deliverable.sections.find(section => section.heading === OPEN_ITEMS);
  const handed = !!open?.parts.some(part => part.kind === 'text' && /\bCA\b/.test(part.text));
  return handed
    ? { check, outcome: 'pass', detail: `The open items hand the CA what the calculator does not model: ${words}` }
    : { check, outcome: 'fail', detail: `The calculator does not model part of this case: ${words} Put it in ${OPEN_ITEMS} and hand it to the CA.` };
}

const STATEMENT_WORDS: Readonly<Record<string, string>> = { ais: 'AIS', '26as': '26AS', form16: 'Form 16' };

/**
 * The statement matches that stand now (tax.statements, Ink v2 2A2): for each statement (AIS, 26AS, Form 16), the newest
 * match of it in the run settles the earlier ones, its differences and its ties alike. receipts are in run order.
 */
function currentMatches(receipts: readonly CaReceipt[]): { matched: boolean; differences: Difference[]; ties: Tie[] } {
  const newest = new Map<string, ReconcileWorking>();
  for (const receipt of receipts) {
    if (receipt.engine !== 'reconcile' || !receipt.working) continue;
    const working = receipt.working as ReconcileWorking;
    for (const against of new Set((working.ties ?? []).map(item => item.against))) newest.set(against, working);
  }
  const current = [...newest.entries()];
  return {
    matched: receipts.some(receipt => receipt.engine === 'reconcile'),
    differences: current.flatMap(([against, working]) => (working.differences ?? []).filter(item => item.against === against)),
    ties: current.flatMap(([against, working]) => (working.ties ?? []).filter(item => item.against === against)),
  };
}

/**
 * gaps-tie (Ink v2 2A2), arithmetic only: for each statement matched (its newest match), the gap from the books over
 * the income that statement reports equals the differences listed, for the amounts and for the tax deducted. The
 * engine compares each statement only on what it reports (Form 16 is salary, 26AS is income with tax deducted), so a
 * real working always ties; a failure means the working does not add up. It does not show a statement is complete.
 */
function gapsTie(matches: { matched: boolean; ties: readonly Tie[] }): CaResult {
  const check = 'gaps-tie';
  if (!matches.matched) return { check, outcome: 'not-run', detail: 'not run: no statements were matched to the books in this run.' };
  const open = matches.ties.filter(item => !item.ties).map(item => `${STATEMENT_WORDS[item.against] ?? item.against} ${item.field === 'gross' ? 'amounts' : 'tax deducted'}`);
  if (open.length) return { check, outcome: 'fail', detail: `Arithmetic only: the differences listed do not add up to the gap from the books for ${[...new Set(open)].join(', ')}. Match the statements again.` };
  const sources = [...new Set(matches.ties.map(item => STATEMENT_WORDS[item.against] ?? item.against))];
  return {
    check, outcome: 'pass',
    detail: `Arithmetic only: each gap from the books equals the differences listed (${sources.join(', ') || 'no statement'}). Each statement is compared on the income it reports; this does not show a statement is complete.`,
  };
}

function caChecks(input: FlagshipCheckInput): CaResult[] {
  const receipts = input.receipts.map(caReceiptOf);
  const usesTables = receipts.some(receipt => receipt.tables.length > 0);
  // The run's statement matches that stand now (tax.statements, Ink v2 2A2): their differences must be among the open items.
  const matches = currentMatches(receipts);
  const { findings } = checkCaDraft({
    draft: caDraftWords(input), receipts, clientRequest: input.request, mode: input.mode, known: [...input.known],
    offer: input.offerKey, refusals: input.refusals ?? [], differences: matches.differences,
  });
  const results: CaResult[] = findings.map(item => (!usesTables && (item.check === 'rates-confirmed' || item.check === 'rates-in-window')
    ? { check: item.check, outcome: 'not-run' as const, detail: 'not run: the draft rests on no tax working with a rate table.' }
    : { check: item.check, outcome: item.passed ? 'pass' as const : 'fail' as const, detail: item.detail }));
  results.push(notModelledRefused(input), gapsTie(matches));
  // The portal's figures against the receipts (tax.portal), each key as its newest comparison left it, with the CA's
  // explanations recorded so far; venture.ca.explainDiff works this check again on the run (ca-firm/signoff.ts).
  const portal = input.receipts.map(receipt => ({ id: receipt.id, ca: (receipt as unknown as { ca?: { engine: string; working: unknown; inputs?: unknown } }).ca ?? null }));
  results.push(portalDiffExplained(portal, input.caExplanations ?? []));
  const offer = CA_OFFERS.find(item => item.id === input.offerKey);
  if (!offer?.regulated) return [...results, { check: 'signoff-recorded', outcome: 'pass', detail: 'This work is not regulated, so it needs no sign-off from the CA.' }];
  return [...results, {
    check: 'signoff-recorded', outcome: 'not-run',
    detail: input.mode === 'rehearsal' ? 'not run: practice papers are never signed off.' : 'not run: these regulated papers wait for the CA of record to sign them off. Chausar records the sign-off when it comes.',
  }];
}

// ---------------------------------------------------------------------------
// Social media agency
// ---------------------------------------------------------------------------

const GROUPS: readonly { id: string; checks: readonly SocialCheckId[]; pass: string }[] = [
  { id: 'channel-limits', checks: ['channel-length', 'channel-hashtags', 'alt-text'], pass: "Every post fits its channel's length and hashtag limits." },
  { id: 'claims', checks: ['claims'], pass: "Every specific in the draft is in the client's message or files." },
  { id: 'disclosure', checks: ['disclosure-paid', 'disclosure-ai', 'synthetic-testimonial'], pass: 'Paid and AI use are labelled where the order needs it.' },
  { id: 'words', checks: ['banned-words', 'banned-topics', 'competitor-names', 'regulated-claims', 'engagement-bait', 'house-style'], pass: 'No banned words, engagement bait or house style problems.' },
];

type SocialResult = { check: string; outcome: PlaybookCheckResult['outcome']; detail: string };

/** notes: lines a passing check adds after its own (a thread code split, with each part's length). */
function grouped(id: string, findings: readonly Finding[], pass: string, notes: readonly string[] = []): SocialResult {
  const blocks = findings.filter(item => item.severity === 'block');
  if (blocks.length) return { check: id, outcome: 'fail', detail: [...new Set(blocks.map(item => item.line))].slice(0, 3).join(' ') };
  const asks = findings.filter(item => item.severity === 'ask-owner');
  return { check: id, outcome: 'pass', detail: [asks.length ? `${pass} For you to decide: ${asks[0].line}` : pass, ...notes].join(' ') };
}

const andList = (items: readonly string[]) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items[0] ?? '');
/** A post code split into a thread: which one, into how many posts, and each part's length as the platform counts it. */
function threadNote(post: PostDraft): string | null {
  if (!post.thread?.length) return null;
  const lengths = post.thread.map(part => countCharacters(part, post.channel).toLocaleString('en-US'));
  return `${post.id} on ${channelCapability(post.channel).name} is split into ${post.thread.length} posts by code: ${andList(lengths)} characters.`;
}

/**
 * calendar-slots, on a content calendar's draft: every slot code planned from the intake has its post under Drafts, in
 * slot order per channel, and each post takes its slot's date. Without a calendar it did not run.
 */
function calendarResult(input: FlagshipCheckInput): SocialResult | null {
  if (input.offerKey !== 'content-calendar') return null;
  const notRun = (detail: string): SocialResult => ({ check: 'calendar-slots', outcome: 'not-run', detail });
  let slots: CalendarSlot[] | null;
  try { slots = calendarSlots(input.intake); } catch (error) { return notRun(`not run: ${error instanceof Error ? error.message : 'the calendar could not be planned.'}`); }
  if (!slots) return notRun(input.mode === 'rehearsal' ? 'not run: practice clients send no calendar.' : 'not run: this order has no calendar, so code planned no slots.');
  const assignment = assignSlots(calendarPosts(input.deliverable), slots);
  if (assignment.problems.length) return { check: 'calendar-slots', outcome: 'fail', detail: assignment.problems.join(' ') };
  const shown = assignment.filled.slice(0, CALENDAR_DETAIL_SLOTS).map(item => `${item.post.id} takes ${item.slot.id} on ${item.slot.date}`);
  const more = assignment.filled.length - shown.length;
  return { check: 'calendar-slots', outcome: 'pass', detail: `Each post has its slot from code: ${shown.join('; ')}${more > 0 ? `; and ${more} more, each on its slot's date` : ''}.` };
}
/** Slots a passing calendar check names in its line; the rest are counted. */
const CALENDAR_DETAIL_SLOTS = 12;

/**
 * narrative-receipted, on a monthly report (or any draft whose run worked out report figures): every figure in the
 * words, in digits, words, multipliers or change words, is one a social.report receipt holds (social/report.ts
 * checkReportNarrative). A client's monthly report with no such receipt fails: it reports nothing from the exports.
 * Practice clients send no exports, so in rehearsal that reads "not run" unless the words hold a figure.
 */
function narrativeResult(input: FlagshipCheckInput): SocialResult | null {
  const figures = reportFiguresOf(input.receipts);
  if (input.offerKey !== 'monthly-report' && !figures.length) return null;
  const narrative = checkReportNarrative(deliverableWords(input.deliverable), figures);
  const result = (outcome: SocialResult['outcome'], detail: string): SocialResult => ({ check: 'narrative-receipted', outcome, detail });
  if (figures.length) return result(narrative.passed ? 'pass' : 'fail', narrative.line);
  if (input.mode === 'rehearsal') return narrative.passed ? result('not-run', 'not run: practice clients send no exports.') : result('fail', narrative.line);
  return result('fail', [NO_REPORT_RECEIPT, ...(narrative.passed ? [] : [narrative.line])].join(' '));
}
const NO_REPORT_RECEIPT = "This report has no figures worked out from the client's exports. Upload them to the order, and the figures come from social.report.";

/** The platforms the run's report receipts (social.report) read exports from, for the export rules their figures rest on. */
function reportPlatforms(receipts: readonly AnyReceipt[]): string[] {
  return [...new Set(receipts.flatMap(receipt => {
    const work = receipt as unknown as { operation?: string; report?: { platform?: string }[] };
    return work.operation === 'social.report' ? (work.report ?? []).flatMap(item => (item.platform ? [item.platform] : [])) : [];
  }))];
}

/** The sections whose lines go out with the posts (the drafts step's own headings, social/playbook.ts). */
const WITH_POSTS = ['Alt text', 'Hashtags'];
/** The alt text and hashtag lines of a draft that are not posts themselves. */
function companionLines(deliverable: Deliverable): string[] {
  return deliverable.sections.filter(section => WITH_POSTS.includes(section.heading))
    .flatMap(section => section.parts.flatMap(part => (part.kind === 'text' && !postOfLine(part.text) ? [part.text] : [])));
}

/**
 * scope (2H), when given, is filled with what the checks read for rules-current: the posts' channels, the platforms
 * the run's report exports came from, and the rules the findings quoted, in order.
 */
function socialChecks(input: FlagshipCheckInput, scope?: { channels: string[]; exports: string[]; quoted: string[] }): SocialResult[] {
  // The client's own word lists from intake (banned words and topics, competitors, phrases never flagged) join the proof.
  const client = socialRules({ ...input, clientRules: input.intake?.clientRules ?? null });
  const paid = input.offerKey === 'ugc-ads' || !!input.intake?.paidPromotion;
  const ai = { person: !!input.intake?.aiPresenter, voice: !!input.intake?.aiVoice };
  const style = input.offerKey === 'community-replies' ? 'reply' as const : input.offerKey === 'ugc-ads' ? 'ugc-ad' as const : 'post' as const;
  // The ids count the post lines (social/draft-posts.ts), the count posting and the calendar file use, so all name the same posts.
  const posts: PostDraft[] = socialDraftPosts(input.deliverable).map(post => {
    // A post longer than one on a channel with threads goes out as the thread code splits it (social/post-lines.ts).
    const thread = threadParts(post.channel, post.text);
    // The channel toggles are the owner's posting checklist: the publish step turns them on for a paid or AI post.
    return { id: post.id, channel: post.channel, text: post.text, paid, ai, style, platformLabels: { paidPartnership: paid, aiGenerated: ai.person || ai.voice }, ...(thread ? { thread } : {}) };
  });
  const media = { check: 'channel-media', outcome: 'not-run' as const, detail: 'not run: pictures and video come with the briefs; this draft holds text only.' };
  const extra = [calendarResult(input), narrativeResult(input)].filter((item): item is SocialResult => item !== null);
  const scoped = (found: readonly Finding[]) => {
    if (scope) Object.assign(scope, { channels: posts.map(post => post.channel), exports: reportPlatforms(input.receipts), quoted: found.flatMap(item => item.ruleId ?? []) });
  };
  if (!posts.length) {
    // A brief or a report names no channel: its claims and words are still checked as one text.
    const whole: PostDraft = { id: 'draft', channel: 'linkedin', text: deliverableWords(input.deliverable), style };
    const claimFindings = checkDraftClaims(whole, client).findings;
    const wordFindings = checkWords(whole, client);
    scoped([...claimFindings, ...wordFindings]);
    return [
      { check: 'channel-limits', outcome: 'not-run', detail: 'not run: the draft has no post that names its channel.' }, media,
      grouped('claims', claimFindings, GROUPS[1].pass),
      { check: 'disclosure', outcome: 'not-run', detail: 'not run: the draft has no post that names its channel.' },
      grouped('words', wordFindings, GROUPS[3].pass),
      ...extra,
    ];
  }
  // Pictures and video are attached later, so the media rules wait for them; everything else runs on each post. The
  // alt text and hashtag lines go out with the posts, so the client's words are checked on them too.
  const findings = [
    ...posts.flatMap(post => checkSocialDraft(post, client).findings.filter(item => item.check !== 'channel-media')),
    ...companionLines(input.deliverable).flatMap((line, index) => checkWords({ id: `with-posts-${index + 1}`, channel: 'linkedin', text: line, paid, style }, client)),
  ];
  scoped(findings);
  const threads = posts.flatMap(post => threadNote(post) ?? []);
  const [limits, claims, disclosure, words] = GROUPS.map(group => grouped(group.id, findings.filter(item => group.checks.includes(item.check)), group.pass, group.id === 'channel-limits' ? threads : []));
  return [limits, media, claims, disclosure, words, ...extra];
}
