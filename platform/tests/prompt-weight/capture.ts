// D2 task 14: what each route would send for one task, made by the routes' own body builders (the model port sends
// exactly these): the Anthropic and OpenAI key bodies and the Claude command line's arguments and stdin. The fixed
// prompt leads each one, so a provider's prompt cache can reuse it from one call to the next.
import type { ModelTask } from '../../runtime/venture/contracts.ts';
import { anthropicBody } from '../../runtime/venture/models/anthropic.ts';
import { openaiBody } from '../../runtime/venture/models/openai.ts';
import { claudePlan } from '../../runtime/venture/models/cli.ts';
import type { Built } from './tasks.ts';

export type Captured = { purpose: string | null; instructions: string; input: string; schemaName: string | null; bodies: { anthropic: string; openai: string; claudeCli: string } | null };

/** The task as each route sends it; a builder that gives only its instructions has no bodies. */
export function capture(built: Built): Captured {
  const complete = built.input !== undefined && built.schema !== undefined;
  const task = { purpose: 'decide', schemaName: 'x', containsClientData: false, maxOutputTokens: 1024, validate: (raw: unknown) => raw, ...built } as ModelTask<unknown>;
  return {
    purpose: built.purpose ?? null, instructions: built.instructions, input: JSON.stringify(built.input ?? null), schemaName: built.schemaName ?? null,
    bodies: complete ? { anthropic: anthropicBody('claude-model', task), openai: openaiBody('openai-model', task), claudeCli: claudePlan('claude-model', task).payloadText } : null,
  };
}
