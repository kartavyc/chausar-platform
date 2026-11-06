// Chausar playbook: Lesson desk offers and intake questions (wave 6, package 6E2). Portable data with no imports,
// so the kit definition (definition.ts) and the fake engine's onboarding read the very same words. Written for Chausar;
// nothing here is learned from an outside source.
/** The offer and question shapes the kit's KitOffer and KitIntakeField accept (kit/define.ts), kept import-free here. */
export type MetaOffer = { id: string; name: string; description: string; pricing: 'monthly' | 'project' | 'hourly'; unit: string; price: 'owner-sets'; stages: readonly string[]; includes: readonly string[]; pilotable: boolean; rights: readonly []; intake: readonly string[]; audience: 'client' };
export type MetaField = { id: string; label: string; help: string; kind: 'people' | 'text' | 'date'; required: boolean; options?: readonly string[] };

export const LESSON_OFFERS: readonly MetaOffer[] = [
  { id: 'monthly-classes', name: 'Monthly classes', description: 'Regular classes for a batch, with worksheets, quizzes and parent updates.', pricing: 'monthly', unit: 'a learner a month', price: 'owner-sets', stages: ['draft'], includes: ['Lesson plans', 'Worksheets and quizzes'], pilotable: true, rights: [], intake: ['learners', 'level', 'syllabus'], audience: 'client' },
  { id: 'worksheet-pack', name: 'Worksheet pack', description: 'A set of worksheets and quizzes with answer keys for a topic.', pricing: 'project', unit: 'per pack', price: 'owner-sets', stages: ['draft'], includes: ['Worksheets', 'Answer keys'], pilotable: false, rights: [], intake: ['level', 'syllabus'], audience: 'client' },
  { id: 'progress-reports', name: 'Progress reports', description: "Progress notes for parents with Chausar's own attendance and score counts.", pricing: 'monthly', unit: 'a learner a month', price: 'owner-sets', stages: ['draft'], includes: ['Progress notes'], pilotable: false, rights: [], intake: ['learners'], audience: 'client' },
  { id: 'exam-prep', name: 'Exam preparation', description: 'A short course of practice papers and revision for an exam.', pricing: 'project', unit: 'per course', price: 'owner-sets', stages: ['draft'], includes: ['Practice papers', 'Revision plan'], pilotable: false, rights: [], intake: ['learners', 'level', 'syllabus'], audience: 'client' },
];

export const LESSON_INTAKE_FIELDS: readonly MetaField[] = [
  { id: 'learners', label: 'Children in this order', help: "Each child needs a parent's recorded consent before their records reach your AI.", kind: 'people', required: false },
  { id: 'level', label: 'Class or level', help: 'The class, grade or level you teach.', kind: 'text', required: false },
  { id: 'syllabus', label: 'Syllabus or exam', help: 'The board, syllabus or exam the work follows.', kind: 'text', required: false },
];

/** The registry entry's data (registration.ts types it as a PlaybookRegistration). */
export const LESSON_REGISTRATION_DATA = Object.freeze({
  id: 'lesson-desk',
  label: 'Lesson desk for tutors and teachers',
  serviceType: 'teaching' as const,
  picks: ['lesson desk', 'tuition classes', 'home tuition', 'coaching classes', 'online tutoring', 'tutor for school children', 'spoken english classes', 'yoga classes', 'music classes', 'dance classes'],
  summary: 'Agents plan lessons and draft worksheets, quizzes and progress notes; Chausar counts attendance and scores, and you send every parent message yourself.',
  riskLevel: 'medium' as const,
  lastReviewed: '2026-11-01',
});
