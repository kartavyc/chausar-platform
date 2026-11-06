/**
 * The fake engine's answers for the idea pipeline (Ink v2 wave 5, package 5A3), in the engine's shapes, codes, order
 * and words (platform/runtime/venture/playbooks/kit/ideas.ts): venture.ideas.add, .move and .grade, the pipeline that
 * venture.ideas.list adds beside 4J18's ideas (fake.ts hands it to the agent extras desk), and Today's grade row seven
 * days after an idea was published. The business's day is India's, as every fake business is. Also the dev page's
 * ?kit-sample answer for venture.rules.list: a kit playbook's dated rules, recipes and measurement boundaries, since no
 * kit playbook has landed yet.
 */

import { EngineError, type IdeaGrade, type IdeaStage, type PipelineIdeaView, type QueueRow, type RulesListView } from './types';
import type { W4DeskHost } from './fake-w4';

const METHODS = new Set<string>([
  'venture.ideas.add',
  'venture.ideas.move',
  'venture.ideas.grade',
]);

const FORWARD: readonly IdeaStage[] = ['inbox', 'triage', 'drafted', 'made', 'published'];
const STAGES: readonly IdeaStage[] = [...FORWARD, 'dropped'];
const GRADES: readonly IdeaGrade[] = ['worked', 'so-so', 'did-not'];
const STAGE_NAMES: Readonly<Record<IdeaStage, string>> = { inbox: 'Inbox', triage: 'Triage', drafted: 'Drafted', made: 'Made', published: 'Published', dropped: 'Dropped' };
const GRADE_NAMES: Readonly<Record<IdeaGrade, string>> = { worked: 'worked', 'so-so': 'so-so', 'did-not': 'did not' };
const EXPIRY_DAYS = 90;
const GRADE_AFTER = 7;
const EXPIRED_REASON = 'Not drafted within 90 days.';
const ONE_SENTENCE = 'Say in one sentence why you are dropping it.';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** A key the engine's secret screen redacts (core/secrets.ts), in its plainest forms. */
const KEY = /\b(?:sk[-_][A-Za-z0-9_-]{12,}|AKIA[0-9A-Z]{12,}|gh[pousr]_[A-Za-z0-9]{20,})\b/g;

interface Idea {
  id: string; text: string; source: string; by: 'owner' | 'agent'; role: string | null; stage: IdeaStage; addedOn: string; movedOn: string;
  reason: string; expired: boolean; publishedOn: string | null; publishedAt: string | null; grade: IdeaGrade | null; at: string;
}

const invalid = (message: string) => new EngineError('INVALID_VENTURE_REQUEST', message);
const localDay = (iso: string): string => new Date(Date.parse(iso) + 330 * 60_000).toISOString().slice(0, 10);
const addDays = (day: string, days: number): string => {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};
const daysFrom = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const dayWords = (day: string) => `${day.slice(8, 10)} ${MONTHS[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`;
const redact = (text: string) => text.replace(KEY, '[redacted secret]');

function exact(p: Record<string, unknown>, allowed: readonly string[], required: readonly string[]): Record<string, unknown> {
  if (!p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).some((key) => !allowed.includes(key)) || required.some((key) => !(key in p))) {
    throw invalid('Send the required fields and nothing else.');
  }
  return p;
}
function id(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,200}$/.test(value)) throw invalid(`${field} must be a known identifier.`);
  return value;
}
/** records.ts singleLine: one line of text, trimmed, between min and max characters, refused with the code given. */
function singleLine(value: unknown, field: string, min: number, max: number, code = 'INVALID_VENTURE_REQUEST'): string {
  if (typeof value === 'string' && /[\n\r\t]/.test(value.trim())) throw new EngineError(code, `${field} must be one line.`);
  if (typeof value !== 'string') throw new EngineError(code, `${field} must be text.`);
  const text = value.replace(/\r\n/g, '\n').trim();
  if (text.length < min || text.length > max) throw new EngineError(code, `${field} must be between ${min} and ${max} characters.`);
  return text;
}

/** The dev page's ?kit-sample flag. Never true in tests, which have no query. */
export function devAsksKitSample(): boolean {
  try { return typeof location !== 'undefined' && new URLSearchParams(location.search).has('kit-sample'); } catch { return false; }
}

/**
 * venture.rules.list for the ?kit-sample page: a kit playbook's rules as the engine words them (kit/rules.ts
 * ruleFreshness, rules-current.ts kitRules), its recipes and its measurement boundaries.
 */
export function kitSampleRules(today: string): RulesListView {
  const rules = [
    { id: 'gsc-sixteen-months', platform: 'google', rule: 'Search Console keeps sixteen months of performance data.', checkedOn: '2026-10-20', how: 'Read on the Search Console help page on 20 October 2026.', topic: 'Search Console history', limitations: ['Says nothing about data other tools keep.'], sources: [{ title: 'Search Console Help: Performance report', url: 'https://support.google.com/webmasters/answer/7576553' }] },
    { id: 'no-ranking-promise', platform: 'all', rule: 'Never promise a ranking or a number of clicks.', checkedOn: '2026-07-01', how: "Chausar's own rule, set on 1 July 2026.", topic: 'No ranking promises', limitations: ['A rule for our own words, not a platform rule.'], sources: [] as { title: string; url: string }[] },
  ].map((rule) => {
    const age = daysFrom(rule.checkedOn, today);
    const stale = age > 90;
    const house = rule.sources.length === 0;
    return {
      id: rule.id, platform: rule.platform, rule: rule.rule, checkedOn: rule.checkedOn, stale, usedBy: ['figures-match'], limitations: rule.limitations,
      source: rule.sources[0] ?? null, sources: house ? [{ title: "Chausar's own rule", url: '' }] : rule.sources,
      line: stale ? `${rule.topic} was checked ${age} days ago, on ${rule.checkedOn}. Check it again${house ? '' : ' on its source page'} before relying on it.` : `Current. ${rule.how}`,
    };
  });
  const stale = rules.filter((rule) => rule.stale).length;
  return {
    playbook: { id: 'kit-sample', label: 'Kit sample', riskLevel: 'low', lastReviewed: '2026-10-27' }, rules,
    summary: `${rules.length - stale} current, ${stale} to recheck.`,
    recipes: [{
      id: 'traffic-drop', name: 'Find why traffic dropped', whenToUse: 'When clicks fell by a lot in one week.',
      steps: [
        { do: 'Compare the last 28 days with the 28 before.', why: 'A week is too short to tell a drop from a holiday.' },
        { do: 'Split by page, then by search words.', why: 'One page often explains most of the drop.' },
      ],
      howToRead: 'A drop on one page is a page problem; a drop on every page is a site or season problem.',
      mistakes: ['Blaming an update without dates that match.', 'Comparing a holiday week with a normal one.'],
    }],
    boundaries: [
      { evidence: 'A JSON-LD block parsed', canSay: 'The page carries structured data a parser can read.', cannotSay: 'The page is eligible for rich results.' },
      { evidence: 'A rank seen once', canSay: 'Where the page showed for one search, at one time.', cannotSay: 'Where it shows for everyone, every day.' },
    ],
  };
}

export class FakeKitRulesDesk {
  protected readonly host: W4DeskHost;
  protected readonly fresh: boolean;
  private readonly books = new Map<string, Idea[]>();
  private count = 0;

  constructor(host: W4DeskHost, options: { fresh?: boolean } = {}) {
    this.host = host;
    this.fresh = options.fresh ?? false;
  }

  handles(method: string): boolean {
    return METHODS.has(method);
  }
  eraseSources(businessId:string,sources:readonly string[]):void {const existing=this.books.get(businessId);if(existing)this.books.set(businessId,existing.filter(idea=>!sources.includes(idea.source)));}

  request(method: string, p: Record<string, unknown>): unknown {
    if (method === 'venture.ideas.add') return this.add(p);
    if (method === 'venture.ideas.move') return this.move(p);
    if (method === 'venture.ideas.grade') return this.gradeIdea(p);
    throw new EngineError('METHOD_NOT_ALLOWED', `The fake engine does not answer ${method}.`);
  }

  /** The open business's pipeline, newest first, as venture.ideas.list adds it; Today's grade rows follow it. */
  pipeline(): PipelineIdeaView[] {
    const today = this.today();
    this.syncRows(today);
    return [...this.book()].reverse().map((idea) => this.view(idea, today));
  }

  private today(): string {
    return localDay(this.host.now());
  }

  /** The open business's ideas. The sample business, Lumen Studio (not in a fresh fake), starts with three. */
  private book(): Idea[] {
    const key = this.host.current();
    let book = this.books.get(key);
    if (!book) {
      book = !this.fresh && key === 'lumen' ? this.sample() : [];
      this.books.set(key, book);
    }
    return book;
  }

  private sample(): Idea[] {
    const today = this.today();
    const at = this.host.now();
    const base = { reason: '', expired: false, publishedOn: null, publishedAt: null, grade: null, at };
    // Published three days ago: its grade is due in four, so the sample's Today has no grade row until then.
    const published = addDays(today, -3);
    return [
      { ...base, id: 'idea_sample_1', text: 'A reel on how we price a 30-minute video', source: 'A client asked on a call', by: 'owner', role: null, stage: 'published', addedOn: addDays(today, -20), movedOn: published, publishedOn: published, publishedAt: `${published}T06:00:00.000Z` },
      { ...base, id: 'idea_sample_2', text: 'Three mistakes new channels make with thumbnails', source: 'Comments on the last video', by: 'agent', role: 'researcher', stage: 'triage', addedOn: addDays(today, -4), movedOn: addDays(today, -2) },
      { ...base, id: 'idea_sample_3', text: 'A behind-the-scenes short of a recording day', source: 'My own idea', by: 'owner', role: null, stage: 'inbox', addedOn: addDays(today, -1), movedOn: addDays(today, -1) },
    ];
  }

  /** The idea as it stands today: one left in Inbox or Triage past 90 days reads as dropped by the expiry. */
  private asOf(idea: Idea, today: string): Idea {
    if ((idea.stage !== 'inbox' && idea.stage !== 'triage') || daysFrom(idea.movedOn, today) <= EXPIRY_DAYS) return idea;
    return { ...idea, stage: 'dropped', expired: true, reason: EXPIRED_REASON, movedOn: addDays(idea.movedOn, EXPIRY_DAYS + 1) };
  }

  private keepExpired(today: string): void {
    const book = this.book();
    book.forEach((idea, index) => { book[index] = this.asOf(idea, today); });
  }

  private view(stored: Idea, today: string): PipelineIdeaView {
    const idea = this.asOf(stored, today);
    const gradeFrom = idea.publishedOn ? addDays(idea.publishedOn, GRADE_AFTER) : null;
    const next: IdeaStage[] = idea.stage === 'dropped' || idea.stage === 'published' ? [] : [...FORWARD.slice(FORWARD.indexOf(idea.stage) + 1), 'dropped'];
    return {
      id: idea.id, text: idea.text, source: idea.source, by: idea.by, role: idea.role, stage: idea.stage, addedOn: idea.addedOn, movedOn: idea.movedOn, next,
      dropReason: idea.stage === 'dropped' ? idea.reason : null, expired: idea.expired,
      dropsOn: idea.stage === 'inbox' || idea.stage === 'triage' ? addDays(idea.movedOn, EXPIRY_DAYS + 1) : null,
      publishedOn: idea.publishedOn, gradeFrom, gradeDue: idea.stage === 'published' && idea.grade === null && gradeFrom !== null && today >= gradeFrom, grade: idea.grade,
    };
  }

  private changed(today: string, queue = false): void {
    const businessId = this.host.current();
    const at = this.host.now();
    this.syncRows(today);
    this.host.emit({ type: 'idea.changed', businessId, at });
    if (queue) this.host.emit({ type: 'queue.changed', businessId, at });
  }

  /** venture.ideas.add (app only): the owner's idea into Inbox. */
  private add(p: Record<string, unknown>): { idea: PipelineIdeaView; line: string } {
    if (this.host.hosted()) throw new EngineError('APP_APPROVAL_REQUIRED', 'Approve this inside the Chausar app.');
    const body = exact(p, ['text', 'source'], ['text', 'source']);
    const text = singleLine(body.text, 'The idea', 2, 300);
    const source = singleLine(body.source, 'Where it came from', 2, 120);
    const today = this.today();
    this.keepExpired(today);
    this.count += 1;
    const idea: Idea = {
      id: `idea_${Date.parse(this.host.now()).toString(36)}${this.count}`, text: redact(text), source: redact(source), by: 'owner', role: null, stage: 'inbox',
      addedOn: today, movedOn: today, reason: '', expired: false, publishedOn: null, publishedAt: null, grade: null, at: this.host.now(),
    };
    this.book().push(idea);
    this.changed(today);
    return { idea: this.view(idea, today), line: 'Added to Inbox.' };
  }

  private find(ideaId: string): number {
    const index = this.book().findIndex((idea) => idea.id === ideaId);
    if (index < 0) throw new EngineError('IDEA_NOT_FOUND', 'There is no idea with this id in your list.');
    return index;
  }

  /** venture.ideas.move: forward only, a stage may be skipped; Dropped only with one sentence; a reason with a drop only. */
  private move(p: Record<string, unknown>): { idea: PipelineIdeaView; line: string } {
    const body = exact(p, ['id', 'stage', 'reason'], ['id', 'stage']);
    const ideaId = id(body.id, 'Idea');
    if (typeof body.stage !== 'string' || !(STAGES as readonly string[]).includes(body.stage)) throw invalid('Choose a stage: inbox, triage, drafted, made, published or dropped.');
    const stage = body.stage as IdeaStage;
    let reason = '';
    if (stage === 'dropped') {
      if (body.reason === undefined) throw new EngineError('IDEA_DROP_REASON', ONE_SENTENCE);
      reason = singleLine(body.reason, 'The reason', 3, 200, 'IDEA_DROP_REASON');
      if (/[.!?।]\s+\S/u.test(reason)) throw new EngineError('IDEA_DROP_REASON', ONE_SENTENCE);
    } else if (body.reason !== undefined) {
      throw invalid('A reason goes with a drop only.');
    }
    const today = this.today();
    this.keepExpired(today);
    const index = this.find(ideaId);
    const idea = this.book()[index]!;
    if (idea.stage === 'dropped') throw new EngineError('IDEA_STAGE_BACKWARD', 'A dropped idea stays dropped. Add it again if it comes back.');
    if (idea.stage === 'published') throw new EngineError('IDEA_STAGE_BACKWARD', 'A published idea stays published. Grade it seven days after it went out.');
    if (!this.view(idea, today).next.includes(stage)) throw new EngineError('IDEA_STAGE_BACKWARD', 'An idea moves forward only: Inbox, Triage, Drafted, Made, Published. Drop it instead, with a reason.');
    const moved: Idea = {
      ...idea, stage, movedOn: today, ...(stage === 'published' ? { publishedOn: today, publishedAt: this.host.now() } : {}),
      ...(stage === 'dropped' ? { reason: redact(reason) } : {}),
    };
    this.book()[index] = moved;
    this.changed(today);
    return { idea: this.view(moved, today), line: `Moved to ${STAGE_NAMES[stage]}.` };
  }

  /** venture.ideas.grade: a published idea, from seven days after it went out, once. */
  private gradeIdea(p: Record<string, unknown>): { idea: PipelineIdeaView; line: string } {
    const body = exact(p, ['id', 'grade'], ['id', 'grade']);
    const ideaId = id(body.id, 'Idea');
    if (typeof body.grade !== 'string' || !(GRADES as readonly string[]).includes(body.grade)) throw invalid('Choose a grade: worked, so-so or did-not.');
    const grade = body.grade as IdeaGrade;
    const today = this.today();
    this.keepExpired(today);
    const index = this.find(ideaId);
    const idea = this.book()[index]!;
    if (idea.stage !== 'published' || !idea.publishedOn) throw new EngineError('IDEA_NOT_PUBLISHED', 'Grade an idea once it is published.');
    const from = addDays(idea.publishedOn, GRADE_AFTER);
    if (today < from) throw new EngineError('IDEA_GRADE_EARLY', `Grade it from ${dayWords(from)}, seven days after it was published, when its results have had time to come in.`);
    if (idea.grade !== null) throw new EngineError('ALREADY_DECIDED', 'You graded this idea already.');
    const graded: Idea = { ...idea, grade };
    this.book()[index] = graded;
    this.changed(today, true);
    return { idea: this.view(graded, today), line: `Graded: ${GRADE_NAMES[grade]}.` };
  }

  /**
   * Today's grade rows (playbooks/kit/ideas.ts ideaGradeRows): one per published idea due for its grade, Open and
   * Later. fake.ts calls it as Today is listed, so a row comes due as the clock moves, as the engine lists it.
   */
  syncRows(today = this.today()): void {
    const business = this.host.current();
    if (!business) return;
    const others = this.host.rows().filter((row) => !(row.businessId === business && row.notice?.probe === 'idea'));
    const name = this.host.rows().find((row) => row.businessId === business)?.businessName ?? '';
    const made: QueueRow[] = this.book().flatMap((idea) => {
      const view = this.view(idea, today);
      if (!view.gradeDue || !view.publishedOn) return [];
      const subject = `idea-grade:${idea.id}`;
      const text = view.text.length <= 60 ? view.text : `${view.text.slice(0, 59).replace(/\s+\S*$/, '')}…`;
      // The engine's row id (views/queue.ts rowId): the subject, then the version in the identifier alphabet.
      const version = `${idea.id}:${view.publishedOn}`;
      const row = {
        id: `${subject}:${version.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 80)}`, businessId: business, businessName: name, kind: 'notice' as const,
        title: `How did "${text}" do?`, line: `You published it on ${dayWords(view.publishedOn)}. Grade it: worked, so-so or did not.`,
        createdAt: idea.publishedAt ?? idea.at,
        actions: [{ id: 'later' as const, label: 'Later', primary: false }, { id: 'open' as const, label: 'Grade it', primary: true }],
        notice: { probe: 'idea' as const, severity: 'low' as const, link: '/work?state=ideas' },
      };
      return [{ ...row, digest: this.host.digest({ ...row, version }) } as QueueRow];
    });
    const before = this.host.rows().filter((row) => row.businessId === business && row.notice?.probe === 'idea').map((row) => row.digest).join();
    if (before === made.map((row) => row.digest).join()) return;
    this.host.setRows([...others, ...made]);
    // Today reads its rows again; nothing changes on the next listing, so this is said once per change.
    this.host.emit({ type: 'queue.changed', businessId: business, at: this.host.now() });
  }
}
