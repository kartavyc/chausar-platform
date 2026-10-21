// Chausar judge: committed baselines. Each playbook keeps a file of held-back cases (a client's message, the
// sources the agent would have, what the reply must and must not say, and a reference draft) together with the
// pass rate those cases reached. The check suite runs every case through the code checks and fails when the pass
// rate drops below the baseline. A baseline only ever rises. Pass rates are compared by cross-multiplying whole
// counts, never as fractions.
//
// Idea taken, code written here: dboudreau00/Countersign (AGPL-3.0, so ideas only), whose eval cases carry
// must-mention and must-not-mention phrases and whose committed baseline fails CI on a regression.
import { readFile } from 'node:fs/promises';
import { ChausarError, check } from '../../../contracts.ts';
import { houseStyleFindings } from '../../records.ts';
import { checkClaims, type SourceText } from './claim-check.ts';

/** A case kept out of rehearsal and improvement, so it can tell whether a playbook really got better. */
export type HeldBackCase = {
  id: string;
  title: string;
  clientRequest: string;
  sources: SourceText[];
  known?: string[];
  mustMention?: string[];
  mustNotMention?: string[];
  /** A reply that meets the case, used when no draft maker is given. */
  reference: string;
};
export type BaselineFile = {
  version: 1;
  playbook: string;
  recordedAt: string;
  recordedFrom: string;
  /** The pass rate these cases reached, as whole counts. of always equals the number of cases. */
  baseline: { passed: number; of: number };
  cases: HeldBackCase[];
};
export type CaseResult = { id: string; passed: boolean; failures: string[] };
export type SuiteResult = { playbook: string; passed: number; of: number; baseline: { passed: number; of: number }; ok: boolean; cases: CaseResult[]; detail: string };
export type DraftMaker = (item: HeldBackCase) => string | Promise<string>;

/** Where the baselines for the built-in service types live. A playbook folder may keep its own and load it by path. */
export const BASELINE_DIR = new URL('./baselines/', import.meta.url);
const PLAYBOOK_NAME = /^[a-z][a-z0-9-]{0,40}$/;
const MAX_CASES = 200;

const bad = (message: string): never => { throw new ChausarError('INVALID_VENTURE_REQUEST', message); };
const isText = (value: unknown, max = 20000): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const textList = (value: unknown) => value === undefined || (Array.isArray(value) && value.every(item => isText(item, 200)));

function validateCase(raw: unknown): HeldBackCase {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) bad('A held-back case is not an object.');
  const item = raw as Record<string, unknown>;
  const id = item.id;
  if (!isText(id, 60) || !PLAYBOOK_NAME.test(id)) bad('A held-back case needs a short lowercase id.');
  const named = `The case ${id as string}`;
  if (!isText(item.title, 200)) bad(`${named} needs a title.`);
  if (!isText(item.clientRequest)) bad(`${named} needs the client's message.`);
  if (!isText(item.reference)) bad(`${named} needs a reference draft.`);
  if (!Array.isArray(item.sources) || !item.sources.every(source => source && typeof source === 'object' && isText((source as SourceText).id, 120) && typeof (source as SourceText).text === 'string')) {
    bad(`${named} needs its sources as a list of id and text.`);
  }
  if (!textList(item.known) || !textList(item.mustMention) || !textList(item.mustNotMention)) bad(`${named} has a phrase list that is not a list of short phrases.`);
  return {
    id: id as string, title: item.title as string, clientRequest: item.clientRequest as string, reference: item.reference as string,
    sources: (item.sources as SourceText[]).map(source => ({ id: source.id, text: source.text })),
    ...(item.known ? { known: [...item.known as string[]] } : {}),
    ...(item.mustMention ? { mustMention: [...item.mustMention as string[]] } : {}),
    ...(item.mustNotMention ? { mustNotMention: [...item.mustNotMention as string[]] } : {}),
  };
}

/** A baseline file, checked: version 1, a playbook name, unique cases, and a baseline that counts exactly those cases. */
export function validateBaseline(raw: unknown): BaselineFile {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) bad('The baseline file is not an object.');
  const file = raw as Record<string, unknown>;
  if (file.version !== 1) bad('The baseline file must be version 1.');
  if (!isText(file.playbook, 41) || !PLAYBOOK_NAME.test(file.playbook)) bad('The baseline file needs a short lowercase playbook name.');
  if (!isText(file.recordedAt, 40) || !isText(file.recordedFrom, 400)) bad('The baseline file must say when and from what it was recorded.');
  if (!Array.isArray(file.cases) || file.cases.length < 1 || file.cases.length > MAX_CASES) bad(`The baseline file needs between one and ${MAX_CASES} cases.`);
  const cases = (file.cases as unknown[]).map(validateCase);
  if (new Set(cases.map(item => item.id)).size !== cases.length) bad('Two held-back cases share an id.');
  const baseline = file.baseline as { passed?: unknown; of?: unknown } | undefined;
  const fine = baseline && Number.isInteger(baseline.passed) && Number.isInteger(baseline.of)
    && (baseline.of as number) === cases.length && (baseline.passed as number) >= 0 && (baseline.passed as number) <= (baseline.of as number);
  if (!fine) bad('The baseline must count the cases in the file: passed is a whole number from zero to the number of cases.');
  return {
    version: 1, playbook: file.playbook as string, recordedAt: file.recordedAt as string, recordedFrom: file.recordedFrom as string,
    baseline: { passed: baseline!.passed as number, of: baseline!.of as number }, cases,
  };
}

/** Loads a committed baseline by playbook name from the baselines folder, or from a folder given. */
export async function loadBaseline(playbook: string, dir: URL = BASELINE_DIR): Promise<BaselineFile> {
  check(PLAYBOOK_NAME.test(playbook), 'INVALID_VENTURE_REQUEST', 'A playbook name is short and lowercase.');
  let text: string;
  try { text = await readFile(new URL(`${playbook}.json`, dir), 'utf8'); } catch {
    throw new ChausarError('PLAYBOOK_NOT_FOUND', `There is no baseline for the ${playbook} playbook.`);
  }
  const file = validateBaseline(JSON.parse(text));
  check(file.playbook === playbook, 'INVALID_VENTURE_REQUEST', `The baseline file for ${playbook} names another playbook.`);
  return file;
}

const has = (draft: string, phrase: string) => draft.toLowerCase().includes(phrase.toLowerCase());

/** One case: every code check must pass. Each failure is a plain sentence. */
export function scoreCase(item: HeldBackCase, draft: string): CaseResult {
  const failures: string[] = [];
  const claims = checkClaims(draft, [{ id: 'client-message', text: item.clientRequest }, ...item.sources], { known: item.known });
  if (!claims.passed) failures.push(claims.detail);
  for (const phrase of item.mustMention ?? []) if (!has(draft, phrase)) failures.push(`It never mentions "${phrase}".`);
  for (const phrase of item.mustNotMention ?? []) if (has(draft, phrase)) failures.push(`It mentions "${phrase}", which it must not.`);
  for (const finding of houseStyleFindings(draft)) failures.push(finding.rule === 'em-dash' ? 'It uses a long dash.' : `It uses a word on the avoid list: ${finding.match}.`);
  return { id: item.id, passed: failures.length === 0, failures };
}

/**
 * Runs every held-back case, one after another, through the code checks. With no draft maker the cases' reference
 * drafts are used. ok is false when the pass rate is below the committed baseline.
 */
export async function runBaselineSuite(file: BaselineFile, draftFor: DraftMaker = item => item.reference): Promise<SuiteResult> {
  const cases: CaseResult[] = [];
  for (const item of file.cases) {
    let draft: string;
    try { draft = await draftFor(item); } catch (error) {
      cases.push({ id: item.id, passed: false, failures: [`No draft: ${error instanceof Error ? error.message : 'the draft could not be made.'}`] });
      continue;
    }
    cases.push(scoreCase(item, draft));
  }
  const passed = cases.filter(item => item.passed).length;
  const of = cases.length;
  const ok = passed * file.baseline.of >= file.baseline.passed * of;
  const detail = ok
    ? `${passed} of ${of} held-back cases pass; the baseline is ${file.baseline.passed} of ${file.baseline.of}.`
    : `Quality dropped: ${passed} of ${of} held-back cases pass, below the baseline of ${file.baseline.passed} of ${file.baseline.of}.`;
  return { playbook: file.playbook, passed, of, baseline: { ...file.baseline }, ok, cases, detail };
}

/** A new baseline file when this run did better than the committed one; otherwise the same file. */
export function raiseBaseline(file: BaselineFile, result: SuiteResult, recordedAt: string): BaselineFile {
  const better = result.of === file.cases.length && result.passed * file.baseline.of > file.baseline.passed * result.of;
  return better ? { ...file, recordedAt, baseline: { passed: result.passed, of: result.of } } : file;
}
