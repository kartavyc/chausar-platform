// Chausar delivery harness: the kit's connector tools (Ink v2 wave 5, package 5A6): localapp.run, mail.read and
// speech.say. Like 5A3's and 5A4's, this file takes no value from tools.ts (a module that loads it first would load
// tools.ts, which reads the tool table before it is made), and loads the engine code it calls only when a call runs.
// Written for Chausar; nothing here is learned from an outside source.
import { ChausarError } from '../../../contracts.ts';
import type { ToolName } from '../../contracts.ts';
import type { Field, Spec } from './tools.ts';

type ConnectToolName = Extract<ToolName, 'localapp.run' | 'mail.read' | 'speech.say'>;

const line = (about: string, max = 200, required = true): Field => ({ type: 'text', required, max, about });
export const REAL_ORDER_ONLY_APPS = 'Apps on your computer run only on a real order, as the exact command the owner approved. Rehearsals never start them.';

/**
 * localapp.run: one command of an app the owner installed (build/local-apps.ts). On a real order the taint latch holds
 * this call until the owner approves exactly it, so a call that runs is the owner's approved command: asking the app
 * its version or help runs as it is; anything else is journalled as that command and run with --yes, added by Chausar.
 * A rehearsal never starts an app. Its output is untrusted (policy/effects.ts), screened before the agent reads it.
 */
function localAppRunTool(): Spec {
  return {
    name: 'localapp.run', effect: 'outside-write', tier: 'owner-cli', endsTurn: false,
    summary: 'Runs one command of an app the owner installed on this computer (BaoCut, Kimo or FilmCraft), only as the exact command the owner approves. Never add --yes: Chausar adds it after approval.',
    input: {
      app: { type: 'enum', required: true, values: ['baocut', 'kimo', 'filmcraft'], about: 'Which app.' },
      args: { type: 'list', required: true, max: 20, item: line('One argument.'), about: 'The command\'s arguments, one per item, without --yes.' },
    },
    async run(env, input) {
      if (env.runRef.kind !== 'delivery') throw new ChausarError('TOOL_FAILED', REAL_ORDER_ONLY_APPS);
      if (!env.ctx) throw new ChausarError('TOOL_FAILED', 'Only a run the owner approved can start an app.');
      const apps = await import('../../build/local-apps.ts');
      const args = apps.commandOf(input.args);
      const result = apps.readOnlyCommand(args)
        ? await apps.runReadOnlyLocalApp(env.deps, env.ctx, { app: input.app, args })
        : await apps.runApprovedLocalApp(env.deps, env.ctx, { app: input.app, args });
      return { result: { done: true, line: result.line, output: result.output as never } };
    },
  };
}

/**
 * mail.read: the mail of the order's own client, from the read-only mailbox (4E3) and imported files, one thread at a
 * time (build/mail-in.ts). With no thread named it lists that client's threads. Only on a real order, and only that
 * order's client's mail (minimum data). Mail is untrusted: the result is screened before the agent reads it.
 */
function mailReadTool(): Spec {
  return {
    name: 'mail.read', effect: 'read', tier: 'code', endsTurn: false,
    summary: "Reads the mail of this order's client, imported or from the owner's read-only mailbox, screened first. Without a thread, lists the client's threads.",
    input: { thread: line('A thread id from the list, such as thread_1a2b3c4d5e6f7a8b.', 40, false) },
    async run(env, input) {
      if (env.runRef.kind !== 'delivery') throw new ChausarError('TOOL_FAILED', 'Mail is read only on a real order, and only that order\'s client\'s.');
      const [{ findRecord, currentVenture }, mail] = await Promise.all([import('../../records.ts'), import('../../build/mail-in.ts')]);
      const state = env.deps.store.read();
      const venture = currentVenture(state);
      const run = findRecord(state, 'venture-delivery-run', env.runRef.runId);
      const order = run ? findRecord(state, 'venture-order', run.orderId) : undefined;
      if (!venture || !order) throw new ChausarError('TOOL_FAILED', 'This run\'s order was not found.');
      const threads = mail.mailThreadsOf(state, venture).filter(thread => thread.clientId === order.clientId);
      if (!input.thread) return { result: { threads: threads.map(thread => ({ id: thread.id, subject: thread.subject, count: thread.count, lastAt: thread.lastAt, held: thread.held })) } };
      if (!threads.some(thread => thread.id === input.thread)) throw new ChausarError('TOOL_FAILED', 'That thread is not mail from this order\'s client.');
      return { result: mail.threadForAgent(state, venture, String(input.thread)) as never };
    },
  };
}

/**
 * speech.say: the quote for turning text into speech with a provider and voice (build/speech-out.ts): characters, the
 * cost at the provider's dated price, and the digest the call will be bound to. It spends nothing. Making the audio is
 * the engine's speechSay, called by the playbook that keeps the file (narration, dubbing), after the quote is shown,
 * with the spend reserved first; in this build every provider is planned, so no audio is made.
 */
function speechSayTool(): Spec {
  return {
    name: 'speech.say', effect: 'read', tier: 'code', endsTurn: false,
    summary: 'Quotes turning text into speech with a provider and a stock voice: characters, the cost at its dated price, and what the call is bound to. Spends nothing.',
    input: {
      provider: { type: 'enum', required: true, values: ['google-tts', 'sarvam-tts', 'elevenlabs'], about: 'The provider.' },
      voice: line('A stock voice id of that provider.', 60),
      text: line('The words to speak.', 5000),
    },
    async run(_env, input) {
      const speech = await import('../../build/speech-out.ts');
      const provider = speech.SPEECH_PROVIDERS.find(item => item.id === input.provider)!;
      if (!provider.voices.some(voice => voice.id === input.voice)) throw new ChausarError('VOICE_NOT_ALLOWED', 'Use one of the provider\'s stock voices, with its licence.');
      const quote = speech.speechQuote(provider, String(input.voice), String(input.text));
      return { result: { quote: quote as never, planned: !provider.request, note: 'A quote only: nothing was made or spent.' } };
    },
  };
}

export const CONNECT_TOOLS: Readonly<Partial<Record<ConnectToolName, Spec>>> = Object.freeze({
  'localapp.run': localAppRunTool(),
  'mail.read': mailReadTool(),
  'speech.say': speechSayTool(),
});
