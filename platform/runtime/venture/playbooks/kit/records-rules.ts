// Chausar playbook kit: the idea pipeline's shapes (Ink v2 wave 5, package 5A3; catalogue P13), on 4J18's venture-idea
// records. A pipeline idea is a venture-idea whose rule is 'pipeline' and which carries these pipeline parts; its words
// sit in the record's title, a drop's reason in its reason, so Forget reaches both as it reaches every idea. Types only.
//
// Idea taken, code written here: the idea tracker of content-skills skills/viral-short-form-ideas (MIT; its sponsor
// text left out): stages from Inbox to Published, a 90-day expiry with a one-sentence reason, a grade after a week.
import type { Display, IsoDate, IsoTime } from '../../contracts.ts';

/** The stages an idea moves through, forward only, or to dropped with a reason. */
export type IdeaStage = 'inbox' | 'triage' | 'drafted' | 'made' | 'published' | 'dropped';
/** The owner's grade seven days after an idea was published. */
export type IdeaGrade = 'worked' | 'so-so' | 'did-not';

/** Who added an idea: the owner, or an agent of a real order's run (its playbook role, as the run's turn names it). */
export type IdeaAuthor = { kind: 'owner' } | { kind: 'agent'; role: string | null; runId: string };

/** The pipeline parts of a venture-idea record. Days are the business's own calendar days (localDayAt). */
export type IdeaPipeline = {
  stage: IdeaStage;
  by: IdeaAuthor;
  /** Where the idea came from, in the words of whoever added it. */
  source: string;
  addedOn: IsoDate;
  /** The day of the last move (the day it was added, before any): Inbox and Triage expire 90 days after it. */
  movedOn: IsoDate;
  history: { stage: IdeaStage; on: IsoDate; at: IsoTime }[];
  publishedOn: IsoDate | null;
  grade: IdeaGrade | null;
  gradedOn: IsoDate | null;
  /** Dropped by the 90-day expiry rather than by the owner. */
  expired: boolean;
};

/** One pipeline idea as the screens show it. */
export type PipelineIdeaView = {
  id: string;
  text: Display;
  source: Display;
  by: 'owner' | 'agent';
  /** The agent's role id, for an agent's suggestion; null for the owner's own idea or a role the run did not name. */
  role: string | null;
  stage: IdeaStage;
  addedOn: IsoDate;
  movedOn: IsoDate;
  /** Where it may move now: the later stages and dropped; none once published or dropped. */
  next: IdeaStage[];
  dropReason: Display | null;
  expired: boolean;
  /** In Inbox or Triage: the day it is dropped if nothing moves it; null in every other stage. */
  dropsOn: IsoDate | null;
  publishedOn: IsoDate | null;
  /** The first day it may be graded (seven days after it was published); null before. */
  gradeFrom: IsoDate | null;
  /** Published, not graded, and its seven days are over: Today asks for the grade. */
  gradeDue: boolean;
  grade: IdeaGrade | null;
};

/** venture.ideas.add's answer. */
export type IdeaAddedView = { idea: PipelineIdeaView; line: Display };
/** venture.ideas.move's answer. */
export type IdeaMovedView = { idea: PipelineIdeaView; line: Display };
/** venture.ideas.grade's answer. */
export type IdeaGradedView = { idea: PipelineIdeaView; line: Display };
