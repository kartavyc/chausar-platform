// Chausar flagship playbook, YouTube channel: the judge for a draft package (design 7.5). Code checks run first and a
// failure ends it there, so no model is paid to look at a draft code already refused. Then the judge answers each rule
// yes or no, citing trace ids; code checks the citations and counts the votes against each rule's own floor, with no
// averaging (delivery/judge/rules.ts). A code check that did not run keeps the draft unverified, never passed.
// The committed baseline (baselines/youtube.json) runs the held-back cases through the claim checks and this
// playbook's package lint, and fails when the pass rate drops.
//
// Ideas taken, code written here: bridge-mind/bridgeclip (MIT), whose editorial gate asks faithful to source,
// self-contained, opening context, complete ending, supported title and not a sponsor read, each with its own floor.
import {
  DRAFT_RULES, judgeByRules, loadBaseline, notRuled, runBaselineSuite, scoreCase, validateRules,
  type BaselineFile, type CaseResult, type DraftMaker, type JudgeRule, type JudgeTrace, type RulesAsk, type RulesVerdict, type SuiteResult,
} from '../../delivery/judge/index.ts';
import { chapterProblems, parseChapters, parsePackageText, tagsLength, titleThumbnail, youtubeChecksOutcome, type YoutubeCheckResult } from './checks.ts';
import { platformRule } from './platform-rules.ts';
import { YOUTUBE_ID } from './registration.ts';
import { applyEditOps, type EditDocument } from './edit-ops.ts';
import { youtubeCaptions } from './captions.ts';
import { scriptCoverage } from './coverage.ts';
import type { HeldBackCase } from '../../delivery/judge/index.ts';
import { checkClips } from './clip-rules.ts';
import { finishingAdditions } from './finishing-extra.ts';
import { planBroll } from './broll.ts';

const unbacked = DRAFT_RULES.find(rule => rule.id === 'no-unbacked-claims')!;

export const YOUTUBE_DRAFT_RULES: readonly JudgeRule[] = Object.freeze(validateRules([
  { id: 'clip-stands-alone', question: 'Does every short clip make sense without the full video?', text: 'Each short clip must stand alone with a complete thought.', floor: { kind: 'share', percent: 75 } },
  { id: 'broll-fits-claim', question: 'Does every added image support only what the speaker actually said?', text: 'Never use b-roll to imply a claim the speaker did not make.', floor: { kind: 'required-yes' } },
  { id: 'meaning-kept', question: 'Does the edit keep the qualifiers and what the speaker meant?', text: 'Keep the speaker meaning and every qualifier when cutting.', floor: { kind: 'share', percent: 75 } },
  { id: 'no-new-words', question: 'Is the edit free of invented speech?', text: 'Never put new words in the speaker mouth.', floor: { kind: 'required-yes' } },
  {
    id: 'faithful-to-source', question: 'Does every line of the package say only what the footage, the transcript and the brief show?',
    text: 'The package must say only what the footage, the transcript and the brief show.', floor: { kind: 'required-yes' },
  },
  {
    id: 'self-contained', question: 'Does each clip or video make sense to a viewer who has not seen the rest?',
    text: 'Each clip must make sense to a viewer who has not seen the rest.', floor: { kind: 'share', percent: 70 },
  },
  {
    id: 'opening-has-context', question: 'Does the opening line tell a new viewer what this is about?',
    text: 'The opening line must tell a new viewer what this is about.', floor: { kind: 'share', percent: 75 },
  },
  {
    id: 'ending-completes', question: 'Does each clip end on a finished thought rather than mid sentence?',
    text: 'Each clip must end on a finished thought, not mid sentence.', floor: { kind: 'share', percent: 75 },
  },
  {
    id: 'title-supported', question: 'Does the video deliver what the title and thumbnail promise?',
    text: 'The video must deliver what the title and thumbnail promise.', floor: { kind: 'share', percent: 70 },
  },
  {
    id: 'no-sponsor-read-as-talk', question: 'Is the package free of a sponsor read cut so it looks like the speaker\'s own opinion?',
    text: 'Never cut a sponsor read so it looks like the speaker\'s own opinion.', floor: { kind: 'required-yes' },
  },
  {
    id: 'disclosure-kept', question: 'Where the order used an AI voice, an AI presenter or paid promotion, does the package disclose it?',
    text: 'Any AI voice, AI presenter or paid promotion in the order must be disclosed in the package.', floor: { kind: 'required-yes' },
  },
  {
    id: 'ready-for-client', question: 'Could the client use this package as it is, without fixing it first?',
    text: 'The client must be able to use the package without fixing it first.', floor: { kind: 'share', percent: 75 },
  },
  { ...unbacked, floor: { ...unbacked.floor } },
]));

export type YoutubeJudgeInput = {
  draft: string;
  trace: JudgeTrace;
  /** The deterministic check results for this draft (checks.ts and finishing.ts). */
  code: readonly YoutubeCheckResult[];
  containsClientData: boolean;
  samples?: number;
  context?: string;
};
export type YoutubeJudgeVerdict = {
  outcome: 'pass' | 'fail' | 'unverified';
  /** False when code failed first or no AI is connected: no model was asked. */
  asked: boolean;
  code: 'pass' | 'fail' | 'incomplete';
  rules: RulesVerdict | null;
  callIds: (string | null)[];
  detail: string;
};

/**
 * Code first: a failed check fails the draft and the model is not asked. Then the rules, when an AI is connected; with
 * none every rule stays unverified. The draft passes only when code passed in full and every rule met its floor.
 */
export async function judgeYoutubeDraft(ask: RulesAsk | null, input: YoutubeJudgeInput): Promise<YoutubeJudgeVerdict> {
  const code = youtubeChecksOutcome(input.code);
  if (code === 'fail') {
    const failed = input.code.filter(item => item.outcome === 'fail');
    return { outcome: 'fail', asked: false, code, rules: null, callIds: [], detail: `The code checks failed first: ${failed.map(item => item.detail).join(' ')}` };
  }
  const notRunLine = input.code.filter(item => item.outcome === 'not-run').map(item => `${item.check}: ${item.detail}`).join(' ');
  if (!ask) {
    const rules = notRuled(YOUTUBE_DRAFT_RULES, 'No AI is connected to judge this draft.');
    return { outcome: 'unverified', asked: false, code, rules, callIds: [], detail: `No AI is connected to judge this draft.${notRunLine ? ` Also not run: ${notRunLine}` : ''}` };
  }
  const rules = await judgeByRules(ask, { rules: YOUTUBE_DRAFT_RULES, trace: input.trace, draft: input.draft, containsClientData: input.containsClientData, context: input.context }, input.samples ?? 1);
  const { callIds, ...verdict } = rules;
  if (verdict.outcome === 'fail') return { outcome: 'fail', asked: true, code, rules: verdict, callIds, detail: verdict.detail };
  if (code === 'incomplete') return { outcome: 'unverified', asked: true, code, rules: verdict, callIds, detail: `Some checks did not run, so the draft is not passed: ${notRunLine}` };
  return { outcome: verdict.outcome, asked: true, code, rules: verdict, callIds, detail: verdict.detail };
}

// ---------------------------------------------------------------------------
// The committed baseline
// ---------------------------------------------------------------------------

export const YOUTUBE_BASELINE_DIR = new URL('./baselines/', import.meta.url);

export function loadYoutubeBaseline(): Promise<BaselineFile> {
  return loadBaseline(YOUTUBE_ID, YOUTUBE_BASELINE_DIR);
}

/** The package lint that needs no order: title and thumbnail pairing, YouTube's limits, and chapter rules when chapters are listed. */
export function packageTextFailures(draft: string): string[] {
  const pkg = parsePackageText(draft);
  const failures: string[] = [];
  const limits = platformRule('metadata-limits').limits;
  if (pkg.title) for (const issue of titleThumbnail(pkg.title, pkg.thumbnailText).issues) if (issue.blocks) failures.push(issue.detail);
  if (Buffer.byteLength(pkg.description, 'utf8') > limits.descriptionBytes) failures.push(`The description is over ${limits.descriptionBytes} bytes.`);
  if (/[<>]/.test(pkg.description)) failures.push('YouTube refuses < and > in a description.');
  if (tagsLength(pkg.tags) > limits.tagsChars) failures.push(`The tags are over ${limits.tagsChars} characters.`);
  const chapters = parseChapters(pkg.description);
  if (chapters.length) failures.push(...chapterProblems(chapters, null));
  return failures;
}

/**
 * Every held-back case through the shared code checks (claims against sources, must and must-not mentions, house style)
 * and this playbook's package lint. ok is false when the pass rate is below the committed baseline.
 */
export async function runYoutubeBaseline(file: BaselineFile, draftFor: DraftMaker = item => item.reference): Promise<SuiteResult> {
  const drafts = new Map<string, string>();
  const shared = await runBaselineSuite(file, async item => { const draft = await draftFor(item); drafts.set(item.id, draft); return draft; });
  const cases: CaseResult[] = shared.cases.map(result => {
    const draft = drafts.get(result.id);
    if (draft === undefined) return result;
    const item = file.cases.find(entry => entry.id === result.id)!;
    const failures = [...scoreCase(item, draft).failures, ...packageTextFailures(draft), ...wordEditBaselineFailures(item, draft)];
    return { id: result.id, passed: failures.length === 0, failures };
  });
  const passed = cases.filter(item => item.passed).length;
  const of = cases.length;
  const ok = passed * file.baseline.of >= file.baseline.passed * of;
  const detail = ok
    ? `${passed} of ${of} held-back cases pass; the baseline is ${file.baseline.passed} of ${file.baseline.of}.`
    : `Quality dropped: ${passed} of ${of} held-back cases pass, below the baseline of ${file.baseline.passed} of ${file.baseline.of}.`;
  return { playbook: file.playbook, passed, of, baseline: { ...file.baseline }, ok, cases, detail };
}

/** Real deterministic checks behind the three word-edit held-back cases. */
function wordEditBaselineFailures(item: HeldBackCase, draft: string): string[] {
  try {
    if (item.id === 'short-clip-rules') {
      const source = JSON.parse(item.sources[0].text);
      return checkClips(source.words, source.picks, 'shorts').passed ? [] : ['The short clip fails its measured boundary checks.'];
    }
    if (item.id === 'compilation-commentary') {
      const source = JSON.parse(item.sources[0].text);
      return finishingAdditions(source).find(row => row.id === 'commentary-share')?.outcome === 'pass' ? [] : ['The compilation lacks its required commentary share.'];
    }
    if (item.id === 'broll-licensed') {
      const source = JSON.parse(item.sources[0].text);
      const plan = planBroll(source.words, source.beats, source.assets, []);
      return plan.assetBindings.length === 1 ? [] : ['The b-roll needs its owned or licensed asset.'];
    }
    if (item.id === 'cleanup-summary') {
      const source = JSON.parse(item.sources[0].text) as EditDocument;
      const made = applyEditOps(source, [{ kind: 'cut', from: 'w1', to: 'w1' }]);
      return draft.includes(made.summary) ? [] : ['The cleanup summary differs from the applied edit.'];
    }
    if (item.id === 'caption-file') {
      const words = JSON.parse(item.sources[0].text);
      const made = youtubeCaptions({ words, profile: 'web', sourceDigest: 'baseline', currentDigest: 'baseline' });
      return made.findings.length ? ['The caption file fails its validator.'] : [];
    }
    if (item.id === 'scripted-coverage') {
      const source = JSON.parse(item.sources[0].text);
      const made = scriptCoverage(source.script, source.words);
      return made.missing.length === 1 && draft.includes(made.missing[0].words.join(' ')) ? [] : ['The missing scripted passage is not shown.'];
    }
    return [];
  } catch { return ['The word-edit baseline fixture could not run.']; }
}
