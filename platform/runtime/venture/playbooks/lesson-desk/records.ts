// Chausar playbook: Lesson desk (wave 6, package 6E2). The body of its one record kind, venture-lesson-batch, as
// contracts.ts types it (RecordBase<kind> & LessonBatchRecordBody). One record holds a whole batch: its learners, the
// sessions with their attendance marks, the worksheets and quizzes with code-made scores, and the parent messages
// waiting for the owner. Types only. Written for Chausar; nothing here is learned from an outside source.
import type { OwnerChannel } from '../kit/owner-message.ts';

export type LessonDay = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export type LessonMark = 'present' | 'late' | 'absent';

/**
 * One learner. guardianClientId: the parent, guardian or adult learner who pays (a venture-client). consentId: the
 * person consent record (venture-voice-consent, kit/voice-consent.ts) a parent gave for this child; a child's records
 * reach the AI only while it is current. orderId: the fee order (an existing venture-order of that client).
 */
export type LessonLearner = {
  id: string;
  name: string;
  minor: boolean;
  guardianClientId: string;
  orderId: string | null;
  consentId: string | null;
  phone: string | null;
};

/** One class on a day, with each learner's mark. */
export type LessonSession = { id: string; on: string; topic: string; marks: Record<string, LessonMark> };

/** A worksheet or quiz question; a quiz's answer is its key, a worksheet's may be empty. */
export type LessonItem = { prompt: string; answer: string };

/** A worksheet or quiz. scores: a quiz's right answers per learner, counted by code against the key. */
export type LessonWork = { id: string; kind: 'worksheet' | 'quiz'; title: string; topic: string; items: LessonItem[]; scores: Record<string, { right: number; of: number }> };

/** A message to a learner's parent or guardian, waiting for the owner's exact approval and their own send. */
export type LessonMessage = {
  id: string;
  learnerId: string;
  kind: 'progress' | 'update';
  channel: OwnerChannel;
  to: string | null;
  subject: string | null;
  text: string;
  digest: string;
  handedOffAt: string | null;
  journalId: string | null;
};

export type LessonBatchBody = {
  name: string;
  subject: string;
  days: LessonDay[];
  time: string;
  minutes: number;
  learners: LessonLearner[];
  sessions: LessonSession[];
  works: LessonWork[];
  messages: LessonMessage[];
  /** The last number used for an id inside the batch (l1, s1, w1, m1), so the engine and the fake name things alike. */
  seq: number;
};

export type LessonBatchRecordBody = { batch: LessonBatchBody };
