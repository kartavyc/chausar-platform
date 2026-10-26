// Chausar venture launcher, chief (Ink v2 wave 4, package 4C1): Chats with Chausar as chief of staff, its read tools,
// typed answers with receipts, and proposals that become Today cards for the owner's approval. The host loads this file
// on first use of a method it owns. Threads and the answer: threads.ts, answer.ts, tools.ts, routing.ts; proposals and
// their gate: proposals.ts, gate.ts; Today's cards: rows.ts (read by views/queue.ts); "Good fit for you": fit.ts.
import type { VentureHandlerTable } from '../contracts.ts';
import { threadListHandler, threadPinHandler, threadSendHandler, threadsHandler } from './threads.ts';
import { proposalsDismissHandler, proposalsRaiseHandler } from './proposals.ts';
import { chiefFitHandler } from './fit.ts';

export const handlers: VentureHandlerTable = Object.freeze({
  'venture.chief.threads': threadsHandler,
  'venture.chief.thread.list': threadListHandler,
  'venture.chief.thread.send': threadSendHandler,
  'venture.chief.thread.pin': threadPinHandler,
  'venture.chief.fit': chiefFitHandler,
  'venture.proposals.raise': proposalsRaiseHandler,
  'venture.proposals.dismiss': proposalsDismissHandler,
});

// The record writes Chats and proposals share (package 4-0).
export { appendChiefMessage, draftProposal } from './store.ts';
