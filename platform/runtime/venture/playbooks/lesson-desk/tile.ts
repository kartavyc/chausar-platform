// Lesson desk tile (wave 6, package 6E2): original Chausar product data. Hours and pay are a model estimate, labelled so.
import type { StartTile } from '../kit/define.ts';
export const LESSON_TILE: StartTile = {
  category: 'shops-and-firms', icon: 'book',
  line: 'Batches, attendance, worksheets, quizzes, progress notes and fees for tutors and teachers.',
  youDo: { hoursMin: 6, hoursMax: 20, line: 'Teach the classes, check the work and send parent messages.' },
  team: { roleIds: ['planner', 'writer', 'keeper', 'billing'], line: 'Plans lessons, drafts worksheets and quizzes, counts attendance and scores.' },
  pay: { minRupees: 1500, maxRupees: 8000, per: 'a learner a month' },
};
