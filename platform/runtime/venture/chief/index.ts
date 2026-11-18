// Chausar venture launcher, chief (Ink v2 wave 4, package 4C1): Chats with Chausar as chief of staff, its read tools,
// typed answers with receipts, and proposals that become Today cards for the owner's approval. The host loads this file
// on first use of a method it owns. Threads and the answer: threads.ts, answer.ts, tools.ts, routing.ts; proposals and
// their gate: proposals.ts, gate.ts; Today's cards: rows.ts (read by views/queue.ts); "Good fit for you": fit.ts. The
// standing plan (the goal, this week's moves, one next best step): plan-core.ts, plan.ts; its daily review and Chausar's
// own daily AI allowance: review.ts, review-offer.ts, own-use.ts.
import type { VentureHandlerTable } from '../contracts.ts';
import { threadListHandler, threadPinHandler, threadSendHandler, threadStateHandler, threadsHandler } from './threads.ts';
import { settleSetHandler } from './states.ts';
import { proposalsDismissHandler, proposalsRaiseHandler } from './proposals.ts';
import { chiefFitHandler } from './fit.ts';
import { planGetHandler, planMoveHandler } from './plan.ts';
import { reviewSetHandler } from './review.ts';

export const handlers: VentureHandlerTable = Object.freeze({
  'venture.chief.threads': threadsHandler,
  'venture.chief.thread.list': threadListHandler,
  'venture.chief.thread.send': threadSendHandler,
  'venture.chief.thread.pin': threadPinHandler,
  // W6 6G1 (D42): a chat's state (states.ts) and the quiet days before one settles on its own.
  'venture.chief.thread.state': threadStateHandler,
  'venture.chief.settle.set': settleSetHandler,
  'venture.chief.fit': chiefFitHandler,
  'venture.proposals.raise': proposalsRaiseHandler,
  'venture.proposals.dismiss': proposalsDismissHandler,
  // The standing plan and its daily review (plan.ts, review.ts).
  'venture.chief.plan.get': planGetHandler,
  'venture.chief.plan.move': planMoveHandler,
  'venture.chief.review.set': reviewSetHandler,
});

// The record writes Chats and proposals share (package 4-0).
export { appendChiefMessage, draftProposal } from './store.ts';
