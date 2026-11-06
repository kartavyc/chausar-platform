// Canonical browser-safe types, shared by the engine and renderer.
import type { OwnerChannel } from '../../../../shared/venture/playbooks/kit/owner-message.ts';

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

export type LessonDay = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export type LessonLearner = {
  id: string;
  name: string;
  minor: boolean;
  guardianClientId: string;
  orderId: string | null;
  consentId: string | null;
  phone: string | null;
};

export type LessonSession = { id: string; on: string; topic: string; marks: Record<string, LessonMark> };

export type LessonMark = 'present' | 'late' | 'absent';

export type LessonWork = { id: string; kind: 'worksheet' | 'quiz'; title: string; topic: string; items: LessonItem[]; scores: Record<string, { right: number; of: number }> };

export type LessonItem = { prompt: string; answer: string };

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
