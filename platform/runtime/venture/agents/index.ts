// Chausar venture launcher, agents (Ink v2 wave 4): agent threads, "from now on" proposals, versions, standing orders
// and the chat consent (4B1); notes (4B2); routines (4J13); the business voice, personas, export and import (4J17); what
// the AI knows, ideas and the capability page (4J18). The host loads this file on first use of a method it owns.
// Package 4-0 registered every method with a NOT_BUILT_YET stub; each package replaces only its own lines.
import type { VentureHandlerTable } from '../contracts.ts';
import { threadListHandler, threadSendHandler } from './threads.ts';
import { proposalDecideHandler } from './proposals.ts';
import { ordersListHandler, versionUndoHandler } from './versions.ts';
import { chatsConsentHandler } from './consent.ts';
import { notesEditHandler, notesForgetHandler, notesListHandler, notesUndoHandler } from './notes.ts';
import { agentsCapabilitiesHandler } from './capabilities.ts';
import { knowledgeAddHandler, knowledgeListHandler, knowledgeRemoveHandler, knowledgeTestHandler } from './knowledge.ts';
import { ideasDismissHandler, ideasListHandler, ideasStartHandler } from './ideas.ts';
import { routinesListHandler, routinesRemoveHandler, routinesRunsHandler, routinesSetHandler } from './routines.ts';
import { voiceGetHandler, voiceLearnHandler, voiceSetHandler } from './voice.ts';
import { personaGetHandler, personaSetHandler, personaTestHandler } from './persona.ts';
import { agentsExportHandler, agentsImportHandler } from './export.ts';

export const handlers: VentureHandlerTable = Object.freeze({
  // 4B1 agent threads, proposals, versions, standing orders and the chat consent
  'venture.agents.thread.list': threadListHandler,
  'venture.agents.thread.send': threadSendHandler,
  'venture.agents.proposal.decide': proposalDecideHandler,
  'venture.agents.version.undo': versionUndoHandler,
  'venture.agents.orders.list': ordersListHandler,
  'venture.chats.consent': chatsConsentHandler,
  // 4B2 notes
  'venture.agents.notes.list': notesListHandler,
  'venture.agents.notes.edit': notesEditHandler,
  'venture.agents.notes.forget': notesForgetHandler,
  'venture.agents.notes.undo': notesUndoHandler,
  // 4J13 routines
  'venture.routines.list': routinesListHandler,
  'venture.routines.runs': routinesRunsHandler,
  'venture.routines.set': routinesSetHandler,
  'venture.routines.remove': routinesRemoveHandler,
  // 4J17 the business voice, personas, export and import
  'venture.voice.get': voiceGetHandler,
  'venture.voice.set': voiceSetHandler,
  'venture.voice.learn': voiceLearnHandler,
  'venture.persona.get': personaGetHandler,
  'venture.persona.set': personaSetHandler,
  'venture.persona.test': personaTestHandler,
  'venture.agents.export': agentsExportHandler,
  'venture.agents.import': agentsImportHandler,
  // 4J18 what the AI knows, ideas and the capability page
  'venture.knowledge.list': knowledgeListHandler,
  'venture.knowledge.add': knowledgeAddHandler,
  'venture.knowledge.remove': knowledgeRemoveHandler,
  'venture.knowledge.test': knowledgeTestHandler,
  'venture.ideas.list': ideasListHandler,
  'venture.ideas.start': ideasStartHandler,
  'venture.ideas.dismiss': ideasDismissHandler,
  'venture.agents.capabilities': agentsCapabilitiesHandler,
});

// The record write agent threads share (package 4-0).
export { appendAgentMessage } from './store.ts';
