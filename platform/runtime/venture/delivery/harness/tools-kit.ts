// Chausar delivery harness: the playbook kit's tools (Ink v2 wave 5): 5A3's ideas.add, 5A4's assets.record and
// media.clean, 5A6's localapp.run, mail.read and speech.say. Package 5-0 registered each with a stub that answers
// NOT_BUILT_YET; each package replaces only its own lines. Written for Chausar; nothing here is learned from an outside
// source.
import type { ToolName } from '../../contracts.ts';
import type { Spec } from './tools.ts';
// 5A3: no value import from tools.ts here: a module that loads this file first would load tools.ts, which reads this
// file's table before it is made. The tool's refusals are the harness's own TOOL_FAILED.
import { ChausarError } from '../../../contracts.ts';
// 5A4: assets.record and media.clean, in their own file (it takes no value from tools.ts either).
import { MEDIA_TOOLS } from './tools-kit-media.ts';
// 5A6: localapp.run, mail.read and speech.say, in their own file (it takes no value from tools.ts either).
import { CONNECT_TOOLS } from './tools-kit-connect.ts';

type KitToolName = Extract<ToolName, 'ideas.add' | 'assets.record' | 'media.clean' | 'localapp.run' | 'mail.read' | 'speech.say'>;

export const KIT_TOOLS: Readonly<Record<KitToolName, Spec>> = Object.freeze({
  'ideas.add': ideasAddTool(), // 5A3 (declared at the end of this file)
  'assets.record': MEDIA_TOOLS['assets.record'], // 5A4 (tools-kit-media.ts)
  'media.clean': MEDIA_TOOLS['media.clean'], // 5A4 (tools-kit-media.ts)
  'localapp.run': CONNECT_TOOLS['localapp.run']!, // 5A6 (tools-kit-connect.ts)
  'mail.read': CONNECT_TOOLS['mail.read']!, // 5A6 (tools-kit-connect.ts)
  'speech.say': CONNECT_TOOLS['speech.say']!, // 5A6 (tools-kit-connect.ts)
});

/**
 * 5A3 (P13): ideas.add. On a real order the agent adds one idea to the owner's ideas Inbox, marked with the role its
 * run's turn names, with where it came from (playbooks/kit/ideas.ts addIdea, which redacts a pasted key). It writes
 * only Chausar's own list, which changes no client record and nothing outside sees: policy/effects.ts declares that
 * write, and the taint latch lets it through as an internal suggestion (INTERNAL_SUGGESTIONS), as it does
 * evidence.record's. A rehearsal or an improvement run works on made-up clients: it keeps nothing. The coarse label
 * is 'read' for the same reason as evidence.record's: 'outside-write' would put the step on the always-ask floor.
 */
function ideasAddTool(): Spec {
  return {
    name: 'ideas.add', effect: 'read', tier: 'code', endsTurn: false,
    summary: "Adds one idea to the owner's ideas Inbox as your suggestion, marked with your role, with where it came from. Nothing else changes; the owner decides what to do with it.",
    input: {
      text: { type: 'text', required: true, max: 300, about: 'The idea in one line, such as: a reel on how we price custom cakes.' },
      source: { type: 'text', required: true, max: 120, about: "Where it came from in a few words, such as: the client's question in this order." },
    },
    async run(env, input) {
      const words = String(input.text ?? '').replace(/\s+/g, ' ').trim();
      const source = String(input.source ?? '').replace(/\s+/g, ' ').trim();
      if (words.length < 2 || source.length < 2) throw new ChausarError('TOOL_FAILED', 'Give the idea in one line and where it came from in a few words.');
      if (env.runRef.kind !== 'delivery') return { result: { added: false, practice: true } };
      if (!env.ctx) throw new ChausarError('TOOL_FAILED', 'Only a run the owner approved can add an idea.');
      const runId = env.runRef.runId;
      const [{ addIdea, IDEA_TOOL_NOTE }, { findRecord, ventureAction }] = await Promise.all([import('../../playbooks/kit/ideas.ts'), import('../../records.ts')]);
      await ventureAction(env.deps, env.ctx, 'prepare', 'ideas.add', tx => {
        const turns = findRecord(tx.state, 'venture-delivery-run', runId)?.harness?.turns ?? [];
        const role = [...turns].reverse().find(turn => typeof turn.role === 'string')?.role ?? null;
        addIdea(tx, { text: words.slice(0, 300), source: source.slice(0, 120), by: { kind: 'agent', role, runId } });
      });
      return { result: { added: true, stage: 'inbox', note: IDEA_TOOL_NOTE } };
    },
  };
}
