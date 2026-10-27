// Chausar delivery harness: the playbook kit's tools (Ink v2 wave 5): 5A3's ideas.add, 5A4's assets.record and
// media.clean, 5A6's localapp.run, mail.read and speech.say. Package 5-0 registered each with a stub that answers
// NOT_BUILT_YET; each package replaces only its own lines. Written for Chausar; nothing here is learned from an outside
// source.
import type { ToolName } from '../../contracts.ts';
import { notBuiltTool } from './tool-stub.ts';
import type { Spec } from './tools.ts';

type KitToolName = Extract<ToolName, 'ideas.add' | 'assets.record' | 'media.clean' | 'localapp.run' | 'mail.read' | 'speech.say'>;

export const KIT_TOOLS: Readonly<Record<KitToolName, Spec>> = Object.freeze({
  'ideas.add': notBuiltTool('ideas.add', 'compute', 'Add a suggestion to your ideas list, marked with the role that made it. Nothing else changes.'), // 5A3
  'assets.record': notBuiltTool('assets.record', 'compute', 'Record where a file it delivers came from: its source, licence, credit and cost.'), // 5A4
  'media.clean': notBuiltTool('media.clean', 'compute', 'Remove location and camera data from a client\'s photo or clip before it is kept.'), // 5A4
  'localapp.run': notBuiltTool('localapp.run', 'outside-write', 'Run an app you installed on this computer, only the exact command you approved.'), // 5A6
  'mail.read': notBuiltTool('mail.read', 'read', 'Read the mail you imported or your read-only mailbox synced, screened first.'), // 5A6
  'speech.say': notBuiltTool('speech.say', 'outside-write', 'Turn text into speech with your own provider, after a quote, with a licensed or consented voice.'), // 5A6
});
