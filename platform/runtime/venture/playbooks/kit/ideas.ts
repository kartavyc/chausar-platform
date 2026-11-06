// Chausar playbook kit: the idea pipeline (Ink v2 wave 5, package 5A3; catalogue P13), on 4J18's ideas: the same
// venture-idea records and the same venture.ideas.list (agents/ideas.ts adds the pipeline beside the rule ideas). The
// owner adds an idea (venture.ideas.add), or an agent of a real order suggests one with the ideas.add tool, marked with
// its role; either goes into Inbox. An idea moves forward only, Inbox, Triage, Drafted, Made, Published (a stage may be
// skipped), or to Dropped with a one-sentence reason; nothing comes back from Dropped or Published. An idea left in
// Inbox or Triage for more than 90 days on the business's own calendar is dropped with "Not drafted within 90 days.":
// every read shows it so, and the next write keeps it in the records. Seven days after Published one Today row asks the
// owner to grade it (worked, so-so, did not). The list is Chausar's own: nothing here sends, spends or posts.
//
// Idea taken, code written here: the idea tracker of content-skills skills/viral-short-form-ideas (MIT; its sponsor
// text left out): stages from Inbox to Published, a 90-day expiry with a one-sentence reason, a grade after a week.
import { ChausarError, check, type Context, type State } from '../../../contracts.ts';
import type { IdeaRecord, IsoDate, QueueAction, VentureDeps, VentureRecord } from '../../contracts.ts';
import { exactPayload, formatVentureDate, identifier, listRecords, requireAppChannel, singleLine, ventureAction, type VentureTx } from '../../records.ts';
import { localDayAt } from '../../local-day.ts';
import { readAs } from '../../delivery/shared.ts';
import { redactSecrets } from '../../core/secrets.ts';
import type { W4RowItem } from '../../views/queue-w4.ts';
import { daysFrom } from './rules.ts';
import type { IdeaAddedView, IdeaAuthor, IdeaGrade, IdeaGradedView, IdeaMovedView, IdeaPipeline, IdeaStage, PipelineIdeaView } from './records-rules.ts';

/** The rule a pipeline idea's record carries, apart from 4J18's rule ideas. */
export const PIPELINE_RULE = 'pipeline';
/** The forward stages, in order. Dropped is reached from any of them but Published. */
export const IDEA_FORWARD: readonly IdeaStage[] = Object.freeze(['inbox', 'triage', 'drafted', 'made', 'published']);
export const IDEA_STAGES: readonly IdeaStage[] = Object.freeze([...IDEA_FORWARD, 'dropped']);
export const IDEA_GRADES: readonly IdeaGrade[] = Object.freeze(['worked', 'so-so', 'did-not']);
/** Inbox and Triage hold an idea this many days after its last move; on the day after, it is dropped. */
export const IDEA_EXPIRY_DAYS = 90;
/** The days after Published before the owner grades it. */
export const IDEA_GRADE_AFTER_DAYS = 7;
export const EXPIRED_REASON = 'Not drafted within 90 days.';
const STAGE_NAMES: Readonly<Record<IdeaStage, string>> = Object.freeze({
  inbox: 'Inbox', triage: 'Triage', drafted: 'Drafted', made: 'Made', published: 'Published', dropped: 'Dropped',
});
const GRADE_NAMES: Readonly<Record<IdeaGrade, string>> = Object.freeze({ worked: 'worked', 'so-so': 'so-so', 'did-not': 'did not' });
const EXPIRING: ReadonlySet<IdeaStage> = new Set(['inbox', 'triage']);

const NOT_FOUND = 'There is no idea with this id in your list.';
const FORWARD_ONLY = 'An idea moves forward only: Inbox, Triage, Drafted, Made, Published. Drop it instead, with a reason.';
const STAYS_DROPPED = 'A dropped idea stays dropped. Add it again if it comes back.';
const STAYS_PUBLISHED = 'A published idea stays published. Grade it seven days after it went out.';
const ONE_SENTENCE = 'Say in one sentence why you are dropping it.';
const AGENT_NOTE = "Added to the owner's ideas Inbox as your suggestion. Nothing else changes.";

/** An ISO day moved by whole days, by calendar arithmetic only. */
function addDays(day: IsoDate, days: number): IsoDate {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

/** The pipeline parts of a record, or null for one of 4J18's rule ideas. */
const pipelineOf = (record: IdeaRecord): IdeaPipeline | null => (record.rule === PIPELINE_RULE && record.pipeline ? record.pipeline : null);

/** Whether the 90-day expiry has dropped this idea by the owner's day. */
const expiresBy = (pipeline: IdeaPipeline, today: IsoDate): boolean => EXPIRING.has(pipeline.stage) && daysFrom(pipeline.movedOn, today) > IDEA_EXPIRY_DAYS;

/** The record as it stands on the owner's day: an expired idea as dropped, with the expiry's reason. */
function asOf(record: IdeaRecord, today: IsoDate): { record: IdeaRecord; pipeline: IdeaPipeline; expiredNow: boolean } {
  const pipeline = pipelineOf(record)!;
  if (!expiresBy(pipeline, today)) return { record, pipeline, expiredNow: false };
  const on = addDays(pipeline.movedOn, IDEA_EXPIRY_DAYS + 1);
  const dropped: IdeaPipeline = { ...pipeline, stage: 'dropped', expired: true, movedOn: on, history: [...pipeline.history, { stage: 'dropped', on, at: `${on}T00:00:00.000Z` }] };
  return { record: { ...record, reason: EXPIRED_REASON, status: 'dismissed', pipeline: dropped }, pipeline: dropped, expiredNow: true };
}

/** Where an idea may move from its stage: the later forward stages and Dropped; nothing from Dropped or Published. */
function nextStages(stage: IdeaStage): IdeaStage[] {
  if (stage === 'dropped' || stage === 'published') return [];
  return [...IDEA_FORWARD.slice(IDEA_FORWARD.indexOf(stage) + 1), 'dropped'];
}

/** One pipeline idea as the screens show it, on the owner's day. */
export function pipelineIdeaView(stored: IdeaRecord, today: IsoDate): PipelineIdeaView {
  const { record, pipeline } = asOf(stored, today);
  const gradeFrom = pipeline.publishedOn ? addDays(pipeline.publishedOn, IDEA_GRADE_AFTER_DAYS) : null;
  return {
    id: record.id, text: record.title, source: pipeline.source, by: pipeline.by.kind, role: pipeline.by.kind === 'agent' ? pipeline.by.role : null,
    stage: pipeline.stage, addedOn: pipeline.addedOn, movedOn: pipeline.movedOn, next: nextStages(pipeline.stage),
    dropReason: pipeline.stage === 'dropped' ? record.reason : null, expired: pipeline.expired,
    dropsOn: EXPIRING.has(pipeline.stage) ? addDays(pipeline.movedOn, IDEA_EXPIRY_DAYS + 1) : null,
    publishedOn: pipeline.publishedOn, gradeFrom,
    gradeDue: pipeline.stage === 'published' && pipeline.grade === null && gradeFrom !== null && today >= gradeFrom,
    grade: pipeline.grade,
  };
}

/** The business's pipeline ideas, newest first, on the owner's day. None while the business has no country yet. */
export function pipelineIdeas(state: State, venture: VentureRecord, nowMs: number): PipelineIdeaView[] {
  if (!venture.country) return [];
  const today = localDayAt(new Date(nowMs), venture.country);
  return listRecords(state, 'venture-idea', venture.id).filter(record => pipelineOf(record)).reverse().map(record => pipelineIdeaView(record, today));
}

/** The owner's day inside a transaction. */
const todayIn = (tx: VentureTx): IsoDate => localDayAt(tx.now, tx.venture!.country);

/** Keeps every drop the 90-day expiry made since the last write, so the records say what the screens say. */
function keepExpired(tx: VentureTx, today: IsoDate): void {
  for (const record of tx.list('venture-idea')) {
    if (!pipelineOf(record)) continue;
    const now = asOf(record, today);
    if (now.expiredNow) tx.replace<IdeaRecord>({ ...now.record, decidedAt: tx.now });
  }
}

/**
 * Puts one idea into Inbox: its words in the record's title (Forget reaches them there), where it came from and who
 * added it. A key or token pasted into either is redacted before anything is kept. Emits idea.changed.
 */
export function addIdea(tx: VentureTx, input: { text: string; source: string; by: IdeaAuthor }): IdeaRecord {
  const today = todayIn(tx);
  keepExpired(tx, today);
  const pipeline: IdeaPipeline = {
    stage: 'inbox', by: input.by, source: redactSecrets(input.source), addedOn: today, movedOn: today,
    history: [{ stage: 'inbox', on: today, at: tx.now }], publishedOn: null, grade: null, gradedOn: null, expired: false,
  };
  const record = tx.put<IdeaRecord>({
    ...tx.base('venture-idea'), title: redactSecrets(input.text), reason: '', evidence: [], prompt: '', rule: PIPELINE_RULE, status: 'open', decidedAt: null, pipeline,
  });
  tx.emit('idea.changed', { id: record.id });
  return record;
}

/** The pipeline idea with this id, as it stands on the owner's day; refused (IDEA_NOT_FOUND) for any other id. */
function pipelineIdea(tx: VentureTx, id: string, today: IsoDate): { record: IdeaRecord; pipeline: IdeaPipeline } {
  const stored = tx.list('venture-idea').find(record => record.id === id && pipelineOf(record));
  if (!stored) throw new ChausarError('IDEA_NOT_FOUND', NOT_FOUND);
  return asOf(stored, today);
}

const textOf = (value: unknown, field: string, max: number) => singleLine(value, field, { min: 2, max });

// ---------------------------------------------------------------------------
// The methods
// ---------------------------------------------------------------------------

/** venture.ideas.add { text, source } (prepare, app only): the owner's idea goes into Inbox. */
export async function ideasAddHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<IdeaAddedView> {
  requireAppChannel(ctx, 'venture.ideas.add');
  const body = exactPayload(payload, ['text', 'source'], ['text', 'source']);
  const text = textOf(body.text, 'The idea', 300);
  const source = textOf(body.source, 'Where it came from', 120);
  readAs(deps, ctx, 'prepare');
  return ventureAction(deps, ctx, 'prepare', 'ideas.add', tx => {
    const record = addIdea(tx, { text, source, by: { kind: 'owner' } });
    return { idea: pipelineIdeaView(record, todayIn(tx)), line: 'Added to Inbox.' };
  });
}

/**
 * venture.ideas.move { id, stage, reason? } (prepare): forward only, a stage may be skipped; to Dropped only with a
 * one-sentence reason, and a reason goes with a drop only. Nothing comes back from Dropped or Published.
 */
export async function ideasMoveHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<IdeaMovedView> {
  const body = exactPayload(payload, ['id', 'stage', 'reason'], ['id', 'stage']);
  const id = identifier(body.id, 'Idea');
  check(typeof body.stage === 'string' && (IDEA_STAGES as readonly string[]).includes(body.stage), 'INVALID_VENTURE_REQUEST', 'Choose a stage: inbox, triage, drafted, made, published or dropped.');
  const stage = body.stage as IdeaStage;
  let reason = '';
  if (stage === 'dropped') {
    check(body.reason !== undefined, 'IDEA_DROP_REASON', ONE_SENTENCE);
    reason = singleLine(body.reason, 'The reason', { min: 3, max: 200 }, 'IDEA_DROP_REASON');
    check(!/[.!?।]\s+\S/u.test(reason), 'IDEA_DROP_REASON', ONE_SENTENCE);
  } else {
    check(body.reason === undefined, 'INVALID_VENTURE_REQUEST', 'A reason goes with a drop only.');
  }
  readAs(deps, ctx, 'prepare');
  return ventureAction(deps, ctx, 'prepare', 'ideas.move', tx => {
    const today = todayIn(tx);
    keepExpired(tx, today);
    const { record, pipeline } = pipelineIdea(tx, id, today);
    if (pipeline.stage === 'dropped') throw new ChausarError('IDEA_STAGE_BACKWARD', STAYS_DROPPED);
    if (pipeline.stage === 'published') throw new ChausarError('IDEA_STAGE_BACKWARD', STAYS_PUBLISHED);
    check(nextStages(pipeline.stage).includes(stage), 'IDEA_STAGE_BACKWARD', FORWARD_ONLY);
    const moved: IdeaPipeline = {
      ...pipeline, stage, movedOn: today, history: [...pipeline.history, { stage, on: today, at: tx.now }],
      publishedOn: stage === 'published' ? today : pipeline.publishedOn,
    };
    const kept = tx.replace<IdeaRecord>({
      ...record, pipeline: moved, ...(stage === 'dropped' ? { reason: redactSecrets(reason), status: 'dismissed' as const, decidedAt: tx.now } : {}),
    });
    tx.emit('idea.changed', { id });
    return { idea: pipelineIdeaView(kept, today), line: `Moved to ${STAGE_NAMES[stage]}.` };
  });
}

/** venture.ideas.grade { id, grade } (prepare): a published idea, from seven days after it went out, once. */
export async function ideasGradeHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<IdeaGradedView> {
  const body = exactPayload(payload, ['id', 'grade'], ['id', 'grade']);
  const id = identifier(body.id, 'Idea');
  check(typeof body.grade === 'string' && (IDEA_GRADES as readonly string[]).includes(body.grade), 'INVALID_VENTURE_REQUEST', 'Choose a grade: worked, so-so or did-not.');
  const grade = body.grade as IdeaGrade;
  readAs(deps, ctx, 'prepare');
  return ventureAction(deps, ctx, 'prepare', 'ideas.grade', tx => {
    const today = todayIn(tx);
    keepExpired(tx, today);
    const { record, pipeline } = pipelineIdea(tx, id, today);
    check(pipeline.stage === 'published' && pipeline.publishedOn, 'IDEA_NOT_PUBLISHED', 'Grade an idea once it is published.');
    const from = addDays(pipeline.publishedOn, IDEA_GRADE_AFTER_DAYS);
    check(today >= from, 'IDEA_GRADE_EARLY', `Grade it from ${formatVentureDate(from, tx.venture!.country.dateOrder)}, seven days after it was published, when its results have had time to come in.`);
    check(pipeline.grade === null, 'ALREADY_DECIDED', 'You graded this idea already.');
    const kept = tx.replace<IdeaRecord>({ ...record, pipeline: { ...pipeline, grade, gradedOn: today } });
    tx.emit('idea.changed', { id });
    // Today's grade row goes with the grade.
    tx.emit('queue.changed', { ideaId: id });
    return { idea: pipelineIdeaView(kept, today), line: `Graded: ${GRADE_NAMES[grade]}.` };
  });
}

// ---------------------------------------------------------------------------
// Today: one row per published idea whose seven days are over and that has no grade yet
// ---------------------------------------------------------------------------

const GRADE_ACTIONS: QueueAction[] = [{ id: 'later', label: 'Later', primary: false }, { id: 'open', label: 'Grade it', primary: true }];

/** "A reel on pricing" cut to fit a title, at a word where it can. */
function shortText(text: string, max = 60): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** The grade rows for Today (views/queue-w4.ts source 'idea'): Open leads to Work's ideas; Later is Today's own. */
export function ideaGradeRows(deps: VentureDeps, _ctx: Context, state: State, venture: VentureRecord): W4RowItem[] {
  if (!venture.country) return [];
  const today = localDayAt(deps.clock(), venture.country);
  return listRecords(state, 'venture-idea', venture.id).flatMap(record => {
    if (!pipelineOf(record)) return [];
    const view = pipelineIdeaView(record, today);
    if (!view.gradeDue || !view.publishedOn) return [];
    const at = record.pipeline!.history.find(item => item.stage === 'published')?.at ?? record.at;
    return [{
      kind: 'notice' as const, subject: `idea-grade:${record.id}`, version: `${record.id}:${view.publishedOn}`, createdAt: at,
      title: `How did "${shortText(view.text)}" do?`,
      line: `You published it on ${formatVentureDate(view.publishedOn, venture.country.dateOrder)}. Grade it: worked, so-so or did not.`,
      actions: GRADE_ACTIONS.map(item => ({ ...item })),
      navigate: 'Open Work, then Ideas, to grade it.',
      notice: { probe: 'idea' as const, severity: 'low' as const, link: '/work?state=ideas' },
    }];
  });
}

/** The ideas.add tool's answers, for tools-kit.ts. */
export const IDEA_TOOL_NOTE = AGENT_NOTE;
