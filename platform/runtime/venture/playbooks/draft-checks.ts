// Chausar flagship playbooks: their own checks on a draft (playbook wiring, design 7.5 and 7.8). Code only, no model.
// The delivery run and the rehearsal run these after the harness checks (delivery/runs.ts, delivery/simulate.ts) and
// keep the results on the run as playbookChecks; a failed one blocks Accept and fails a practice episode. A check that
// could not run says why ("not run: ..."), and that is never a pass.
// - YouTube channel: the package checks of youtube/checks.ts on the drafted package (hook, title and thumbnail,
//   metadata limits, chapters, retention, AI and paid promotion disclosure, rights and source credit), with the
//   client's transcript when one came with the order (SRT or VTT), and the finishing check on the cut named at intake
//   when ffmpeg is on this computer (youtube/finishing.ts).
// - AI-native CA firm: the claim checks of ca-firm/claims.ts on the model's words, against the run's receipts, and
//   whether the papers wait for the CA of record's sign-off (ca-firm/signoff.ts records it).
// - Social media agency: the post checks of social/checks.ts on each post the draft names a channel for: channel
//   limits, disclosure, claims against the client's message and files, and the client's words.
// The rules judge asks each playbook's own rules in rehearsal (flagshipJudgeRules).
import type { DateOrder, Deliverable, IsoDate, OrderIntake, PlaybookCheckResult } from '../contracts.ts';
import type { AnyReceipt } from '../delivery/deliverable.ts';
import { transcriptCues, type FileLike } from '../delivery/harness/files.ts';
import { deliverableWords, sourcesFromFiles, type SourceText } from '../delivery/judge/claim-check.ts';
import type { JudgeRule } from '../delivery/judge/rules.ts';
import { CA_OFFERS } from './ca-firm/playbook.ts';
import { checkCaDraft, CA_JUDGE_RULES } from './ca-firm/claims.ts';
import type { CaReceipt } from './ca-firm/receipt.ts';
import { CA_FIRM_ID } from './ca-firm/registration.ts';
import { parsePackageText, runYoutubeChecks, type YoutubeCheckResult, type YoutubeOrder } from './youtube/checks.ts';
import { finishingCheck, finishingResult, systemFfmpeg, type FfmpegPort } from './youtube/finishing.ts';
import { YOUTUBE_DRAFT_RULES } from './youtube/judge.ts';
import { YOUTUBE_OFFERS, YOUTUBE_STEPS, type YoutubeOfferId } from './youtube/playbook.ts';
import { YOUTUBE_ID } from './youtube/registration.ts';
import { SOCIAL_CHANNELS, channelCapability, type SocialChannel } from './social/channels.ts';
import { checkDraftClaims, checkSocialDraft, checkWords, type ClientRules, type Finding, type PostDraft, type SocialCheckId } from './social/checks.ts';
import { SOCIAL_JUDGE_RULES } from './social/judge.ts';
import { SOCIAL_AGENCY_ID } from './social/registration.ts';

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

/** The playbook's checks on a draft. Template outlines are not drafts these checks read, so nothing runs on them. */
export async function runFlagshipChecks(input: FlagshipCheckInput): Promise<PlaybookCheckResult[]> {
  const as = (check: string, outcome: PlaybookCheckResult['outcome'], detail: string): PlaybookCheckResult => ({ playbook: input.flagship, check, outcome, detail });
  if (![YOUTUBE_ID, CA_FIRM_ID, SOCIAL_AGENCY_ID].includes(input.flagship)) return [];
  if (input.servedBy === 'template') return [as('playbook-checks', 'not-run', "not run: this playbook's checks read an agent's draft, and this is a template outline.")];
  if (input.flagship === YOUTUBE_ID) return (await youtubeChecks(input)).map(item => as(item.check, item.outcome, item.detail));
  if (input.flagship === CA_FIRM_ID) return caChecks(input).map(item => as(item.check, item.outcome, item.detail));
  return socialChecks(input).map(item => as(item.check, item.outcome, item.detail));
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
  // The upload settings are the owner's publishing checklist, made from the intake: the publish step ticks them.
  const pkg = { ...parsed, hooks, durationMs, uploadSettings: { aiUse, paidPromotion: !!intake?.paidPromotion } };
  const results = runYoutubeChecks({ checks: VERIFY.youtubeChecks, order, pkg, transcript, today: input.today, finishing: await finishing(input, format) });
  // Practice clients record no rights, so the rights and credit checks have nothing to read in rehearsal.
  return input.mode === 'rehearsal'
    ? results.map(item => (item.check === 'rights-recorded' || item.check === 'source-credit' ? { ...item, outcome: 'not-run' as const, detail: NO_FOOTAGE } : item))
    : results;
}

// ---------------------------------------------------------------------------
// AI-native CA firm
// ---------------------------------------------------------------------------

function caChecks(input: FlagshipCheckInput): { check: string; outcome: PlaybookCheckResult['outcome']; detail: string }[] {
  // Price and work receipts read as receipts here: their figures with labels. Only the calculator's tax receipts carry rate tables.
  const receipts = input.receipts.map(receipt => {
    const raw = receipt as unknown as { id: string; figures: CaReceipt['figures']; working?: unknown; tables?: CaReceipt['tables'] };
    return { id: raw.id, figures: raw.figures, working: raw.working ?? null, tables: Array.isArray(raw.tables) ? raw.tables : [] } as unknown as CaReceipt;
  });
  const usesTables = receipts.some(receipt => receipt.tables.length > 0);
  const { findings } = checkCaDraft({ draft: deliverableWords(input.deliverable), receipts, clientRequest: input.request, mode: input.mode, known: [...input.known] });
  const results = findings.map(item => (!usesTables && (item.check === 'rates-confirmed' || item.check === 'rates-in-window')
    ? { check: item.check, outcome: 'not-run' as const, detail: 'not run: the draft rests on no tax working with a rate table.' }
    : { check: item.check, outcome: item.passed ? 'pass' as const : 'fail' as const, detail: item.detail }));
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

const CHANNEL_BY_NAME = new Map<string, SocialChannel>(SOCIAL_CHANNELS.flatMap(id => [[id, id], [channelCapability(id).name.toLowerCase(), id]] as [string, SocialChannel][]));
const POST = /^\s*([A-Za-z][A-Za-z ]{0,20}?)\s*:\s*(.+)$/;
const GROUPS: readonly { id: string; checks: readonly SocialCheckId[]; pass: string }[] = [
  { id: 'channel-limits', checks: ['channel-length', 'channel-hashtags', 'alt-text'], pass: "Every post fits its channel's length and hashtag limits." },
  { id: 'claims', checks: ['claims'], pass: "Every specific in the draft is in the client's message or files." },
  { id: 'disclosure', checks: ['disclosure-paid', 'disclosure-ai', 'synthetic-testimonial'], pass: 'Paid and AI use are labelled where the order needs it.' },
  { id: 'words', checks: ['banned-words', 'banned-topics', 'competitor-names', 'regulated-claims', 'engagement-bait', 'house-style'], pass: 'No banned words, engagement bait or house style problems.' },
];

function grouped(id: string, findings: readonly Finding[], pass: string): { check: string; outcome: PlaybookCheckResult['outcome']; detail: string } {
  const blocks = findings.filter(item => item.severity === 'block');
  if (blocks.length) return { check: id, outcome: 'fail', detail: [...new Set(blocks.map(item => item.line))].slice(0, 3).join(' ') };
  const asks = findings.filter(item => item.severity === 'ask-owner');
  return { check: id, outcome: 'pass', detail: asks.length ? `${pass} For you to decide: ${asks[0].line}` : pass };
}

function socialChecks(input: FlagshipCheckInput): { check: string; outcome: PlaybookCheckResult['outcome']; detail: string }[] {
  const sources: SourceText[] = [{ id: 'client-message', text: input.request }, ...sourcesFromFiles(input.files)];
  const client: ClientRules = { ...(input.known[0] ? { businessName: input.known[0] } : {}), known: [...input.known], proofFiles: sources, dateOrder: input.dateOrder === 'month-day-year' ? 'month-day-year' : 'day-month-year' };
  const paid = input.offerKey === 'ugc-ads' || !!input.intake?.paidPromotion;
  const ai = { person: !!input.intake?.aiPresenter, voice: !!input.intake?.aiVoice };
  const style = input.offerKey === 'community-replies' ? 'reply' as const : input.offerKey === 'ugc-ads' ? 'ugc-ad' as const : 'post' as const;
  const posts: PostDraft[] = textLines(input.deliverable).flatMap((line, index) => {
    const match = POST.exec(line);
    const channel = match ? CHANNEL_BY_NAME.get(match[1].trim().toLowerCase()) : undefined;
    // The channel toggles are the owner's posting checklist: the publish step turns them on for a paid or AI post.
    return channel ? [{ id: `post-${index + 1}`, channel, text: match![2].trim(), paid, ai, style, platformLabels: { paidPartnership: paid, aiGenerated: ai.person || ai.voice } }] : [];
  });
  const media = { check: 'channel-media', outcome: 'not-run' as const, detail: 'not run: pictures and video come with the briefs; this draft holds text only.' };
  if (!posts.length) {
    // A brief or a report names no channel: its claims and words are still checked as one text.
    const whole: PostDraft = { id: 'draft', channel: 'linkedin', text: deliverableWords(input.deliverable), style };
    return [
      { check: 'channel-limits', outcome: 'not-run', detail: 'not run: the draft has no post that names its channel.' }, media,
      grouped('claims', checkDraftClaims(whole, client).findings, GROUPS[1].pass),
      { check: 'disclosure', outcome: 'not-run', detail: 'not run: the draft has no post that names its channel.' },
      grouped('words', checkWords(whole, client), GROUPS[3].pass),
    ];
  }
  // Pictures and video are attached later, so the media rules wait for them; everything else runs on each post.
  const findings = posts.flatMap(post => checkSocialDraft(post, client).findings.filter(item => item.check !== 'channel-media'));
  const [limits, claims, disclosure, words] = GROUPS.map(group => grouped(group.id, findings.filter(item => group.checks.includes(item.check)), group.pass));
  return [limits, media, claims, disclosure, words];
}
