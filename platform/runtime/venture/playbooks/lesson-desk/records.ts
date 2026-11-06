import type { LessonBatchBody, LessonDay, LessonLearner, LessonSession, LessonMark, LessonWork, LessonItem, LessonMessage } from '../../../../contract/venture/playbooks/lesson-desk/records.ts';
export type { LessonBatchBody, LessonDay, LessonLearner, LessonSession, LessonMark, LessonWork, LessonItem, LessonMessage } from '../../../../contract/venture/playbooks/lesson-desk/records.ts';
// Chausar playbook: Lesson desk (wave 6, package 6E2). The body of its one record kind, venture-lesson-batch, as
// contracts.ts types it (RecordBase<kind> & LessonBatchRecordBody). One record holds a whole batch: its learners, the
// sessions with their attendance marks, the worksheets and quizzes with code-made scores, and the parent messages
// waiting for the owner. Types only. Written for Chausar; nothing here is learned from an outside source.
import type { OwnerChannel } from '../kit/owner-message.ts';




/**
 * One learner. guardianClientId: the parent, guardian or adult learner who pays (a venture-client). consentId: the
 * person consent record (venture-voice-consent, kit/voice-consent.ts) a parent gave for this child; a child's records
 * reach the AI only while it is current. orderId: the fee order (an existing venture-order of that client).
 */


/** One class on a day, with each learner's mark. */


/** A worksheet or quiz question; a quiz's answer is its key, a worksheet's may be empty. */


/** A worksheet or quiz. scores: a quiz's right answers per learner, counted by code against the key. */


/** A message to a learner's parent or guardian, waiting for the owner's exact approval and their own send. */




export type LessonBatchRecordBody = { batch: LessonBatchBody };
