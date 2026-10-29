import {youtubeServiceChecks} from './youtube/service-checks.ts';
import {isYoutubeService} from './youtube/service-fields.ts';
import {whatIfShown,healthReviewed} from './ca-firm/c2-checks.ts';
import { socialContentChecks } from './social/content-checks.ts';
import { ghostwritingChecks } from './social/structures.ts';
import { checkCitations, citationReferences, CITATION_TABLE, citationTableHash } from './ca-firm/citations.ts';
import { questionNoteFromDraft } from './ca-firm/question-desk.ts';
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
// - YouTube and social (Ink v2 4J16): the writing checks in English and Hindi (writing-checks.ts: hard bans, AI-tell
//   rates against a baseline, the quoted share, bait), each with its rate; on YouTube, quotes-at-source, each quote
//   the draft cites with a time found in the transcript within ten seconds of it (delivery/checks/quote-at.ts).
// - YouTube and social: rules-current, whether the dated platform rules the checks that ran rest on are still inside
//   their recheck window (rules-current.ts); past it, 'not run' naming the rules to recheck, which never blocks Accept.
// The rules judge asks each playbook's own rules in rehearsal (flagshipJudgeRules).
import type { DateOrder, Deliverable, IsoDate, OrderIntake, PlaybookCheckResult, ToolCallRecord, WorkTableRecord } from '../contracts.ts';
import type { AnyReceipt } from '../delivery/deliverable.ts';
import { transcriptCues, type FileLike } from '../delivery/harness/files.ts';
import { deliverableWords } from '../delivery/judge/claim-check.ts';
import type { JudgeRule } from '../delivery/judge/rules.ts';
import { CA_DRAFT_SECTIONS, CA_OFFERS } from './ca-firm/playbook.ts';
import { checkCaDraft, citedSections, CA_JUDGE_RULES, type CalculatorRefusal } from './ca-firm/claims.ts';
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
import { channelCapability, SOCIAL_CHANNELS } from './social/channels.ts';
import { holdsPhrase, makesClaim, VOICE_PLAYBOOK, VOICE_STOP_WORDS } from './voice-match.ts';
import type { CalendarSlot } from './social/calendar.ts';
import { assignSlots, calendarPosts, calendarSlots, socialDraftPosts } from './social/draft-posts.ts';
import { checkReportNarrative, reportFiguresOf } from './social/report.ts';
import { SOCIAL_JUDGE_RULES } from './social/judge.ts';
import { SOCIAL_AGENCY_ID } from './social/registration.ts';
import { PROMPT_LEAK_CHECK, promptLeakLine, promptLeaks, type PromptLeak } from './prompt-leak.ts';
import { rulesCurrentResult } from './rules-current.ts';
import { writingChecks } from './writing-checks.ts';
import { draftQuotes, moveQuoteTimes, quoteCheck } from '../delivery/checks/quote-at.ts';
import { rateFinding } from '../delivery/checks/rating.ts';
import { factsWords, missingOf } from './ca-firm/needs-facts.ts';
import type { PlaybookDefinition } from './kit/define.ts';
import { kitDefinition, kitDefinitions } from './kit/installed.ts';
import { runKitChecks } from './kit/checks.ts';

export type FlagshipCheckInput = {
  formsEntries?: readonly import('./data-entry-desk/checks.ts').FormsReportRow[];
  roomBrief?: import('./kit/client-room-core.ts').RoomBrief | null;
  /** Current engine-resolved episode evidence, including null after Forget. */
  siteProject?: import('./website-studio/records.ts').SiteRequirementBody | null;
  tenderRows?: readonly import('./tender-desk/records.ts').TenderQuestionBody[];
  narrationRows?: readonly import('./narration-studio/checks.ts').NarrationReportRow[];
  newsletterIssue?: import('./newsletter-studio/records.ts').NewsletterIssueBody | null;
  careerPack?: import('./job-search-desk/checks.ts').CareerDraftEvidence;
  articleRecord?: import('./podcast-to-article/records.ts').ArticleLedgerBody | null;
  socialSlotContext?: import('./social/slots-live.ts').SocialSlotContext;
  stageId?: string;
  brandKit?: import('./kit/records-media.ts').ResolvedKit;
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
  caCitationUse?: import('./ca-firm/citations.ts').CitationUse;
  caHealthReviews?: readonly Pick<import('./ca-firm/work-core.ts').CaWorkingBody,'receiptId'|'receiptDigest'|'decisions'>[];
  caExplanations?: readonly { receiptId: string; key: string; note: string }[];
};

/**
 * The rules judge's rules for a flagship or kit playbook's drafts (a kit playbook's are its definition's judgeRules,
 * Ink v2 wave 5, 5A1; definitions: default the landed ones), or null for any other playbook.
 */
export function flagshipJudgeRules(flagship: string | null | undefined, definitions: readonly PlaybookDefinition[] = kitDefinitions()): readonly JudgeRule[] | null {
  if (flagship === YOUTUBE_ID) return YOUTUBE_DRAFT_RULES;
  if (flagship === CA_FIRM_ID) return CA_JUDGE_RULES;
  if (flagship === SOCIAL_AGENCY_ID) return SOCIAL_JUDGE_RULES;
  return kitDefinition(flagship, definitions)?.judgeRules ?? null;
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
export async function runFlagshipChecks(input: FlagshipCheckInput, definitions: readonly PlaybookDefinition[] = kitDefinitions()): Promise<PlaybookCheckResult[]> {
  // Ink v2 wave 5 (5A1): a kit playbook's own checks and their coverage (playbooks/kit/checks.ts), then the same lint.
  const kit = kitDefinition(input.flagship, definitions);
  const own = kit ? (input.servedBy === 'template' && !(input.flagship==='data-entry-desk'&&input.formsEntries||input.flagship==='job-search-desk'&&input.careerPack||input.flagship==='virtual-assistant'&&input.roomBrief||input.flagship==='app-testing'&&input.testingEvidence) ? [{ playbook: input.flagship, check: 'playbook-checks', outcome: 'not-run' as const, detail: TEMPLATE_NOT_RUN }] : kitChecks(kit, input, definitions))
    : await playbookOwnChecks(input);
  if (!own.length || input.servedBy === 'template') return own;
  const line = promptLeakLine(draftLeaks(input));
  return [...own, { playbook: input.flagship, check: PROMPT_LEAK_CHECK, outcome: line ? 'fail' : 'pass', detail: line ?? 'No words meant for the AI and no template placeholders.' }];
}

/** Leaks in the whole draft, and in each social post line read as the exact post (where template labels count too). */
function draftLeaks(input: FlagshipCheckInput): PromptLeak[] {
  const posts = input.flagship === SOCIAL_AGENCY_ID ? textLines(input.deliverable).flatMap(line => postOfLine(line) ?? []) : [];
  return [...promptLeaks(deliverableWords(input.deliverable)), ...posts.flatMap(post => promptLeaks(post.text, 'post'))];
}

/**
 * A kit playbook's checks with their coverage (kit/checks.ts), then rules-current on the dated rules the checks that ran
 * rest on (5A3: not run once one is past its recheck window, which never blocks Accept).
 */
function kitChecks(kit: PlaybookDefinition, input: FlagshipCheckInput, definitions: readonly PlaybookDefinition[]): PlaybookCheckResult[] {
  const results = runKitChecks(kit, input);
  const ran = results.filter(item => item.outcome !== 'not-run').map(item => item.check);
  const rules = rulesCurrentResult(kit.registration.id, input.today, ran, undefined, definitions);
  return rules ? [...results, { playbook: input.flagship, check: rules.check, outcome: rules.outcome, detail: rules.detail }] : results;
}

const TEMPLATE_NOT_RUN = "not run: this playbook's checks read an agent's draft, and this is a template outline.";

async function playbookOwnChecks(input: FlagshipCheckInput): Promise<PlaybookCheckResult[]> {
  const as = (check: string, outcome: PlaybookCheckResult['outcome'], detail: string): PlaybookCheckResult => ({ playbook: input.flagship, check, outcome, detail });
  if (![YOUTUBE_ID, CA_FIRM_ID, SOCIAL_AGENCY_ID].includes(input.flagship)) return [];
  if (input.servedBy === 'template') return [as('playbook-checks', 'not-run', TEMPLATE_NOT_RUN)];
  const scope = { channels: [] as string[], exports: [] as string[], quoted: [] as string[] };
  const own = input.flagship === YOUTUBE_ID ? (await youtubeChecks(input)).map(item => as(item.check, item.outcome, item.detail))
    : input.flagship === CA_FIRM_ID ? caChecks(input).map(item => as(item.check, item.outcome, item.detail))
      : socialChecks(input, scope).map(item => as(item.check, item.outcome, item.detail));
  // The dated platform rules the checks that ran rest on (rules-current.ts, Ink v2 2H): not run once one is past its
  // recheck window, which never blocks Accept. A social group stands for its own checks (GROUPS below); a social draft
  // names only the rules for its own channels and exports, the rules its findings quoted first.
  const ran = own.filter(item => item.outcome !== 'not-run').flatMap(item => [item.check, ...(GROUPS.find(group => group.id === item.check)?.checks ?? [])]);
  const rules = rulesCurrentResult(input.flagship, input.today, ran, input.flagship === SOCIAL_AGENCY_ID ? scope : undefined);
  // Ink v2 4J16: the writing checks (Q20) and quotes at their place (Q4), after the playbook's own.
  const evidence = evidenceChecks(input).map(item => as(item.check, item.outcome, item.detail));
  return rules ? [...own, as(rules.check, rules.outcome, rules.detail), ...evidence] : [...own, ...evidence];
}

// ---------------------------------------------------------------------------
// Writing and quotes (Ink v2 wave 4, 4J16)
// ---------------------------------------------------------------------------

/**
 * The writing checks (writing-checks.ts) on the words of a YouTube or social draft, which go out in public; a social
 * draft's posts are read one by one for stacked asks, and its English bait phrases are left to its own word check. A CA
 * firm's papers go to the client and the CA, so they are not read for tells or bait. A YouTube draft that quotes the
 * talk ("words" (12:40)) has each quote checked at its time in the order's transcript (quotesAtSource). A CA draft
 * whose calculator asked for facts gets facts-answered (factsAnswered).
 */
function evidenceChecks(input: FlagshipCheckInput): { check: string; outcome: PlaybookCheckResult['outcome']; detail: string }[] {
  if (input.flagship === CA_FIRM_ID) { const facts = factsAnswered(input); return facts ? [facts] : []; }
  if (input.flagship !== YOUTUBE_ID && input.flagship !== SOCIAL_AGENCY_ID) return [];
  const social = input.flagship === SOCIAL_AGENCY_ID;
  const posts = social ? socialDraftPosts(input.deliverable).map(post => post.text) : undefined;
  const writing = writingChecks(deliverableWords(input.deliverable), { ...(posts?.length ? { posts } : {}), englishBait: !social });
  const quotes = social ? null : quotesAtSource(input);
  return quotes ? [...writing, quotes] : writing;
}

/**
 * quotes-at-source (Q4): each quote a YouTube draft cites with a time is in the order's transcript within ten seconds
 * of it. Round 1 ran in the draft pre-check (withQuoteFixes); this final check is round 2: a quote still off its place
 * fails, saying where it really is, and the quotes code moved are named. Null when the draft cites no quote; not run
 * when no transcript came with the order.
 */
function quotesAtSource(input: FlagshipCheckInput): { check: string; outcome: PlaybookCheckResult['outcome']; detail: string } | null {
  const cited = draftQuotes(deliverableWords(input.deliverable)).filter(item => item.at.kind === 'time');
  if (!cited.length) return null;
  const check = 'quotes-at-source';
  const cues = transcriptOf(input.files);
  if (cues === 'none') return { check, outcome: 'not-run', detail: 'not run: the draft quotes the talk, and no transcript came with the order to check the quotes against.' };
  if (cues === 'unreadable') return { check, outcome: 'not-run', detail: 'not run: the transcript could not be read, so the quotes were not checked.' };
  const result = quoteCheck(cited, { kind: 'transcript', cues }, 2);
  const fixes = input.deliverable.quoteFixes ?? [];
  // What code moved comes first, inside the part of the line Today shows (160 characters), so the owner reads it before
  // Approve; the row's meta lists the moves too (views/row-meta.ts).
  const moved = fixes.length ? `Chausar moved ${fixes.length === 1 ? '1 quote; check it' : `${fixes.length} quotes; check them`} before you approve: ${fixes.join(' ')} ` : '';
  return { check, outcome: result.outcome === 'pass' ? 'pass' : 'fail', detail: `${moved}${result.detail}` };
}

/**
 * facts-answered (4J16, Q5 with CA8): an open item where a tax figure rests on a fact the calculator asked the client
 * for (NEEDS_FACTS). Its facts are typed by code ({ affects: tax-figure, known }), and its severity comes from the
 * rating table, never from a model: unknown while no later call of that tool worked, or (TDS) while the payee it was
 * about is missing from the later working (the agent left that row out), so it is rated high and fails. Null when no
 * calculator asked for facts in this run.
 */
function factsAnswered(input: FlagshipCheckInput): { check: string; outcome: PlaybookCheckResult['outcome']; detail: string } | null {
  const calls = input.toolCalls ?? [];
  const asked = calls.filter(call => call.tool.startsWith('tax.') && !call.envelope.ok && call.envelope.error.code === 'NEEDS_FACTS');
  if (!asked.length) return null;
  const open = asked.flatMap(call => {
    const items = call.envelope.ok ? [] : missingOf(call.envelope.error.details);
    const worked = calls.findLast(later => later.tool === call.tool && later.turn > call.turn && later.envelope.ok);
    if (!worked || !worked.envelope.ok) return items;
    // A TDS working after the answer must hold each payee the client was asked about; a row left out is still open.
    const payees = ((worked.envelope.result as { payments?: { payee?: unknown }[] } | null)?.payments ?? []).map(row => row.payee);
    return call.tool === 'tax.tds' ? items.filter(item => item.about !== undefined && !payees.includes(item.about)) : [];
  });
  const check = 'facts-answered';
  if (!open.length) return { check, outcome: 'pass', detail: 'The facts the calculator asked the client for were answered, and the tax was worked after that.' };
  const rating = rateFinding('ca-open-item', { affects: 'tax-figure', known: 'unknown' });
  const missing = factsWords(open);
  return {
    check, outcome: rating.priority === 'fix-before-sending' ? 'fail' : 'pass',
    detail: `Rated ${rating.severity} by code: ${rating.rationale.filter(line => line !== rating.rationale.at(-1)).join(' ')} Still open: ${missing}.`,
  };
}

/** The order's transcript as timed lines, or why there is none to read. */
function transcriptOf(files: readonly FileLike[]): { startMs: number; endMs: number; text: string }[] | 'none' | 'unreadable' {
  const sent = files.find(file => file.format === 'transcript');
  if (!sent) return 'none';
  try { return transcriptCues(sent); } catch { return 'unreadable'; }
}

/**
 * Round 1 of the quote check (Q4), in the draft pre-check before the checks run (delivery/runs.ts and simulate.ts, with
 * the order's files): on a YouTube draft, each quote cited with a time that the transcript says at another time has
 * its time moved there by code, and quoteFixes says so; the final check (round 2) names them. One round only: a draft
 * already corrected, another playbook's draft, or one with no readable transcript comes back as it was.
 */
export function withQuoteFixes(deliverable: Deliverable, files: readonly FileLike[], flagship: string | null | undefined): Deliverable {
  if (flagship !== YOUTUBE_ID || deliverable.quoteFixes) return deliverable;
  const cues = transcriptOf(files);
  if (cues === 'none' || cues === 'unreadable') return deliverable;
  const fixes: string[] = [];
  const sections = deliverable.sections.map(section => ({
    ...section,
    parts: section.parts.map(part => {
      if (part.kind !== 'text') return part;
      const moved = moveQuoteTimes(part.text, cues);
      fixes.push(...moved.fixes);
      return moved.fixes.length ? { ...part, text: moved.text } : part;
    }),
  }));
  return fixes.length ? { ...deliverable, sections, quoteFixes: fixes } : deliverable;
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
  if(isYoutubeService(input.offerKey))return youtubeServiceChecks(input);
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
  const measuredCalls = input.toolCalls ?? [];
  const captionApplies = offer !== 'episode-package' || measuredCalls.some(call => call.tool === 'youtube.captions');
  const scriptApplies = measuredCalls.some(call => call.tool === 'youtube.coverage') || input.files.some(file => /(?:^|[\s._-])script(?:[\s._-]|$)/i.test(file.name));
  const checks = VERIFY.youtubeChecks.filter(id => (id !== 'caption-file' || captionApplies) && (id !== 'script-coverage' || scriptApplies));
  const results = runYoutubeChecks({ checks, order, pkg, transcript, today: input.today, finishing: await finishing(input, format) });
  // 5B1: applicable measured checks remain visibly not-run until a completed tool supplies evidence.
  for (const [tool, checkId] of [['youtube.captions', 'caption-file'], ['youtube.coverage', 'script-coverage'], ['youtube.clean', 'cleanup']] as const) {
    const call = [...(input.toolCalls ?? [])].reverse().find(call => call.tool === tool);
    if (!call) continue; // The applicable check remains explicitly not-run from runYoutubeChecks.
    const prior = results.findIndex(result => result.check === checkId);
    if (prior >= 0) results.splice(prior, 1);
    const output = call.envelope.ok && call.envelope.result && typeof call.envelope.result === 'object' && !Array.isArray(call.envelope.result) ? call.envelope.result as Record<string, unknown> : null;
    if (!output || call.outcome !== 'succeeded') { results.push({ check: checkId, outcome: 'not-run', detail: 'The measured word-edit tool did not complete. Its output has not passed.', notes: [] }); continue; }
    const invalid = checkId === 'caption-file' ? !Array.isArray(output.findings) || output.findings.length > 0
      : checkId === 'script-coverage' ? !Array.isArray(output.missing) || output.missing.length > 0
      : !Number.isSafeInteger(output.removedMs) || (output.removedMs as number) < 0 || typeof output.summary !== 'string';
    results.push({ check: checkId, outcome: invalid ? 'fail' : 'pass', detail: invalid ? 'The measured word-edit output has findings to fix before this package goes out.' : 'The measured word-edit output passes its code checks.',
      notes: checkId === 'caption-file' && Array.isArray(output.notRun) ? output.notRun.map(item => String((item as { check?: string }).check ?? 'unmeasured')) : [] });
  }
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
  const words = caDraftWords(input);
  if(receipts.some(receipt=>receipt.engine==='what-if'))results.push({check:'whatif-assumptions-shown',outcome:whatIfShown(receipts,words)?'pass':'fail',detail:'Every actual scenario assumption must appear in the papers.'});
  if(input.offerKey==='books-health-check'){
    const health=input.receipts.filter(receipt=>(receipt as any).ca?.engine==='books-health') as unknown as {id:string;digest:string;ca:{working:unknown}}[];
    const passed=health.length>0&&health.every(receipt=>healthReviewed(receipt,input.caHealthReviews??[]));
    results.push({check:'finding-has-evidence',outcome:passed?'pass':'fail',detail:passed?'Every supplied line was read and each finding has an evidence-backed CA decision.':'Run the source health tool and have the CA decide every finding with evidence before the client report.'});
  }
  const citationCall = [...(input.toolCalls ?? [])].reverse().find(call => call.tool === 'tax.citations' && call.envelope.ok);
  const citationResult = citationCall?.envelope.ok ? citationCall.envelope.result as Record<string, unknown> : null;
  const hasReferences = citationReferences(words).length > 0;
  const incomeDate = typeof input.intake?.fields?.incomeDate === 'string' ? input.intake.fields.incomeDate : receipts.flatMap(receipt=>receipt.tables).find(table=>table.id.includes('income'))?.validFrom;
  let citationPassed = !hasReferences;
  let citationDetail = 'Check this exact draft against the current CA-confirmed citations table, including the dated renumbering note.';
  if (hasReferences && incomeDate) try {
    const checked=checkCitations({draft:words,incomeDate},input.caCitationUse??{mode:input.mode,confirmedBy:null});
    citationPassed=checked.passed;citationDetail=checked.findings.filter(row=>!row.passed).map(row=>row.detail).join(' ');
  } catch(error) { citationDetail=error instanceof Error?error.message:citationDetail; }
  const previousSectionCheck = results.find(row=>row.check==='sections-flagged');
  if(previousSectionCheck){previousSectionCheck.outcome=citationPassed?'pass':'fail';previousSectionCheck.detail=citationPassed?'Every section passed the dated citation register.':citationDetail;}
  results.push({check:'citations-current',outcome:citationPassed?'pass':'fail',detail:citationPassed?'No unchecked section references remain.':citationDetail});
  if(input.offerKey==='itr-form-and-regime'){
    const call=[...(input.toolCalls??[])].reverse().find(row=>row.tool==='tax.formChooser'&&row.envelope.ok);
    const choice=call?.envelope.ok?call.envelope.result as Record<string,any>:null;
    const passed=!!choice&&typeof choice.form==='string'&&words.includes(choice.form)&&choice.regime?.allowed===true;
    results.push({check:'form-choice',outcome:passed?'pass':'fail',detail:passed?'The draft uses the dated form choice and an allowed regime.':'Run the dated form chooser and show its form with an allowed regime.'});
  }
  if (input.offerKey === 'tax-question-desk') {
    const sources = input.files.flatMap((file,index)=> /law|act|statute|notification/i.test(file.name) ? [file.id, 'f'+(index+1)] : []);
    if (input.mode === 'rehearsal' || input.caCitationUse?.confirmedBy) sources.push(...CITATION_TABLE.rows.map(row=>row.id));
    const note = questionNoteFromDraft(input.deliverable,sources);
    results.push({check:'fact-check-form',outcome:note.passed?'pass':'fail',detail:note.passed?'Each claim has a source and all fact-check sections are present.':note.problems.join(' ')});
  }
  if (input.offerKey === 'advance-tax-freelancer' || receipts.some(receipt=>receipt.engine==='advance-tax')) {
    const labelled = /client.?s? (?:own )?(?:tax )?estimate|client-estimate/i.test(words) && /assumption|based on/i.test(words);
    results.push({check:'assumption-labelled',outcome:labelled?'pass':'fail',detail:labelled?'The client estimate is explicitly an assumption.':'Label these instalments as based on the client estimate, an assumption rather than a fact.'});
  }
  if (input.offerKey === 'check-return-elsewhere' || input.offerKey === 'itr-check-draft') {
    const comparisons=input.receipts.filter(receipt=>(receipt as any).ca?.engine==='portal-diff');
    const latest=comparisons.at(-1) as any;
    const income=input.receipts.filter(receipt=>(receipt as any).ca?.engine==='income-tax');
    const rows=(latest?.ca?.working?.rows??[]) as {key:string;state:string;oursMinor:string|null;portalMinor:string|null;receiptId:string|null;rule?:string}[];
    const fresh=!!latest?.ca?.inputs?.includeBothSides&&income.some(receipt=>rows.some(row=>row.receiptId===receipt.id));
    const absent=rows.filter(row=>row.state!=='same').filter(row=>!input.deliverable.sections.some(section=>{
      const text=section.parts.filter(part=>part.kind==='text').map(part=>part.text).join(' ');
      const quoted=(key:string)=>section.parts.some(part=>part.kind==='figure'&&part.receiptId===latest.id&&part.figureKey===key);
      return text.includes(row.rule??'No matching computed line. Ask the CA to identify the applicable rule.')&&(row.oursMinor===null?/missing|no matching/i.test(text):quoted('ours.'+row.key))&&(row.portalMinor===null?/missing|not supplied/i.test(text):quoted('return.'+row.key));
    }));
    const check=results.find(row=>row.check==='differences-listed')!;
    if(!fresh||absent.length){check.outcome='fail';check.detail=!fresh?'Run a fresh income-tax computation and compare every typed return line.':'Show both receipt figures and the calculator rule for each return difference: '+absent.map(row=>row.key).join(', ')+'.';}
  }
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
  const ownRules = input.intake?.clientRules;
  const usesKit = input.brandKit && (!ownRules || ![ownRules.bannedWords, ownRules.bannedTopics, ownRules.competitors, ownRules.protectedPhrases].some(list => list.length));
  const withOrigin = (result: SocialResult): SocialResult => usesKit ? { ...result, detail: result.detail + ' Rule source: ' + [...new Set([input.brandKit!.bannedWords.source, input.brandKit!.bannedTopics.source, input.brandKit!.competitors.source])].join(', ') + '.' } : result;
  const paid = ['ugc-ads','video-ads'].includes(input.offerKey??'') || !!input.intake?.paidPromotion;
  const ai = { person: !!input.intake?.aiPresenter, voice: !!input.intake?.aiVoice };
  const style = ['community-replies','reply-inbox','local-instagram'].includes(input.offerKey??'') ? 'reply' as const : input.offerKey === 'ugc-ads' ? 'ugc-ad' as const : 'post' as const;
  if (input.stageId === 'voice' || input.stageId === 'calendar') {
    const stageDraft: PostDraft = { id: input.stageId, channel: 'linkedin', text: deliverableWords(input.deliverable), style: 'post' };
    const claims = checkDraftClaims(stageDraft, client).findings, words = checkWords(stageDraft, client);
    if (scope) Object.assign(scope, { channels: [], exports: [], quoted: [...claims, ...words].flatMap(item => item.ruleId ?? []) });
    return [grouped('claims', claims, GROUPS[1].pass), withOrigin(grouped('words', words, GROUPS[3].pass))];
  }
  // The ids count the post lines (social/draft-posts.ts), the count posting and the calendar file use, so all name the same posts.
  const posts: PostDraft[] = socialDraftPosts(input.deliverable).map(post => {
    // A post longer than one on a channel with threads goes out as the thread code splits it (social/post-lines.ts).
    const thread = threadParts(post.channel, post.text);
    // The channel toggles are the owner's posting checklist: the publish step turns them on for a paid or AI post.
    return { id: post.id, channel: post.channel, text: post.text, paid, ai, style, platformLabels: { paidPartnership: paid, aiGenerated: ai.person || ai.voice }, ...(thread ? { thread } : {}) };
  });
  const media = { check: 'channel-media', outcome: 'not-run' as const, detail: 'not run: pictures and video come with the briefs; this draft holds text only.' };
  const extra = [...socialContentChecks(input), ...ghostwritingChecks(input), ...[calendarResult(input), narrativeResult(input)].filter((item): item is SocialResult => item !== null)];
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
      withOrigin(grouped('words', wordFindings, GROUPS[3].pass)),
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
  return [limits, media, claims, disclosure, withOrigin(words), ...extra];
}

// ---------------------------------------------------------------------------
// The owner's voice (Ink v2 wave 4, 4J17, A8)
// ---------------------------------------------------------------------------

/** The voice check's id, on every playbook's drafts (the eight fixed steps too). */
export const VOICE_CHECK = 'voice';
/** One voice that is on, as the check reads it (agents/voice.ts voiceRules): its never-use words and claims. */
export type VoiceRule = { language: 'en' | 'hi'; channel: string | null; neverUse: readonly string[]; willNotClaim: readonly string[] };
/** The words the voice check and learning leave out, and how a word is read (voice-match.ts, a leaf module). */
export { VOICE_STOP_WORDS };
/** The label the voice result carries in a run's checks: the owner's own voice, not a playbook's (voice-match.ts). */
export { VOICE_PLAYBOOK };

/**
 * The channels whose voices read a draft, by its playbook: a voice for every channel reads every draft; a social draft's
 * posts are read by the voices for their own channels too; a YouTube package by the YouTube voice; any other reply by
 * the mail voice. The writing turn is given the same voices (agents/voice.ts voicePart).
 */
export function voiceChannelsOf(flagship: string | null): { whole: (string | null)[]; posts: readonly string[] } {
  if (flagship === SOCIAL_AGENCY_ID) return { whole: [null], posts: SOCIAL_CHANNELS };
  return { whole: flagship === YOUTUBE_ID ? [null, 'youtube'] : [null, 'email'], posts: [] };
}

/**
 * The voice check on a draft, by code: every word the owner's voices never use and every claim they will not make,
 * read in the draft's words. A voice for every channel reads the whole draft; a social draft's posts are each read by
 * the voices for their own channel too; a YouTube package by the YouTube voice, and any other reply by the mail voice.
 * Null when no voice that is on applies, so a business without one gets no extra result.
 */
export function voiceDraftCheck(deliverable: Deliverable, rules: readonly VoiceRule[], flagship: string | null): PlaybookCheckResult | null {
  const { whole, posts } = voiceChannelsOf(flagship);
  const texts: { text: string; rules: VoiceRule[] }[] = [{ text: deliverableWords(deliverable), rules: rules.filter(rule => whole.includes(rule.channel)) }];
  if (posts.length) for (const post of socialDraftPosts(deliverable)) texts.push({ text: post.text, rules: rules.filter(rule => rule.channel === post.channel) });
  const read = texts.filter(item => item.rules.length);
  if (!read.length) return null;
  const found: string[] = [];
  for (const { text, rules: applied } of read) {
    for (const rule of applied) {
      for (const word of rule.neverUse) if (holdsPhrase(text, word)) found.push(`The draft uses "${word}", a word your voice never uses.`);
      for (const claim of rule.willNotClaim) if (makesClaim(text, claim)) found.push(`The draft claims "${claim}", which your voice will not claim.`);
    }
  }
  const lines = [...new Set(found)];
  return lines.length
    ? { playbook: VOICE_PLAYBOOK, check: VOICE_CHECK, outcome: 'fail', detail: lines.slice(0, 3).join(' ') }
    : { playbook: VOICE_PLAYBOOK, check: VOICE_CHECK, outcome: 'pass', detail: 'No word your voice never uses, and no claim it will not make.' };
}

/**
 * The draft's checks with the voice check after them. It only ever adds a result: a draft another check failed stays
 * failed whatever the voice says (failedPlaybookCheck finds the first failure).
 */
export function withVoiceCheck(results: readonly PlaybookCheckResult[] | undefined, voice: PlaybookCheckResult | null): PlaybookCheckResult[] | undefined {
  if (!voice) return results ? [...results] : undefined;
  return [...(results ?? []), voice];
}
