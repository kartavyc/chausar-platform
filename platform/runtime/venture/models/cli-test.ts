// A2: "Signed in" is earned. A tool's own status command can say it is signed in while a real call still fails (a used-up
// plan, a model the account lacks, a refused token), so Connect your AI shows "Signed in" only after one tiny test call
// worked: a fixed sample sentence and a one-field answer, never the owner's words or any business data. Codex runs only
// through its reviewed setup's arguments and its trusted program (checked again before the call); Claude Code through
// its usual text-only arguments. What the tool printed on stderr is kept screened and short beside the owner words; it is
// never shown.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cliArguments, defaultProcess, type ProcessRequest, type ProcessResult } from '../../gateway.ts';
import { buildCodexCliArguments } from '../../providers/codex-cli.ts';
import type { DelegateCli } from '../contracts.ts';
import { cliEnv, codexHost, parseClaudeCli, parseCodexCli, type CodexHost } from './cli.ts';
import { CODEX_MODEL_DEFAULTS } from './codex-models.ts';
import { toolSaid } from './port.ts';

/** The fixed sample a test call sends. Nothing of the owner's. */
export const TEST_PROMPT = 'This is a connection test from Chausar. Answer with ok set to true.';
export const TEST_SCHEMA = Object.freeze({ type: 'object', additionalProperties: false, required: ['ok'], properties: { ok: { type: 'boolean' } } });
export const TEST_TIMEOUT_MS = 60_000;
/** The small model each tool's test call asks for (Codex's own list decides Codex's; see codex-models.ts). */
export const CLAUDE_TEST_MODEL = 'claude-haiku-5-5';

export type CliTestResult = { ok: true } | { ok: false; code: string; line: string; said?: string };
export type CliTestInput = {
  cli: DelegateCli;
  /** Codex: its reviewed setup; the program is the one the setup names. */
  codex?: CodexHost | null;
  /** Claude Code: the program the search path has (an absolute program, never a script). */
  claudeProgram?: string | null;
  model: string;
  process?: (request: ProcessRequest) => Promise<ProcessResult>;
};

export const TEST_WORDS = Object.freeze({
  noSetup: "Codex can't be tried until you choose it.",
  wrong: (label: string) => `${label} answered the test, but not as asked. Try again.`,
});

/** One tiny test call; never retried. */
export async function tinyTestCall(input: CliTestInput): Promise<CliTestResult> {
  const run = input.process ?? defaultProcess;
  const codex = input.cli === 'codex';
  const evidence = input.codex?.capabilities.evidence;
  const program = codex ? (evidence?.kind === 'installed-help' ? evidence.executable : null) : input.claudeProgram ?? null;
  if (!program || (codex && !input.codex)) return { ok: false, code: 'PRESET_UNAVAILABLE', line: TEST_WORDS.noSetup };
  const folder = await mkdtemp(join(tmpdir(), 'chausar-cli-test-'));
  try {
    const schemaPath = join(folder, 'schema.json');
    await writeFile(schemaPath, JSON.stringify(TEST_SCHEMA), { mode: 0o600 });
    const work = join(folder, 'work');
    await mkdir(work);
    const args = codex
      ? buildCodexCliArguments(input.model, schemaPath, input.codex!.capabilities)
      : cliArguments({ kind: 'claude-cli', model: input.model, maxOutputTokens: 256 }, schemaPath, undefined, { schema: TEST_SCHEMA as never, instructions: TEST_PROMPT });
    const stdin = codex ? `${TEST_PROMPT}\n{}` : '{}';
    let response: ProcessResult;
    try {
      response = await run({ command: program, args, cwd: work, env: cliEnv(codex ? 'codex-cli' : 'claude-cli', 256), stdin, timeoutMs: TEST_TIMEOUT_MS, schema: null } as ProcessRequest);
    } catch (error) {
      const code = (error as { code?: unknown })?.code;
      return { ok: false, code: typeof code === 'string' ? code : 'MODEL_FAILED', line: codex ? 'Codex did not finish the test. Try again.' : 'Claude Code did not finish the test. Try again.' };
    }
    const parsed = codex ? parseCodexCli(response) : parseClaudeCli(response);
    const said = toolSaid((response as { stderr?: unknown }).stderr);
    if (!parsed.ok) return { ok: false, code: parsed.code, line: parsed.message, ...(said ? { said } : {}) };
    const value = parsed.value as { ok?: unknown } | null;
    return value && typeof value === 'object' && value.ok === true ? { ok: true } : { ok: false, code: 'MODEL_OUTPUT_REJECTED', line: TEST_WORDS.wrong(codex ? 'Codex' : 'Claude Code') };
  } finally {
    await rm(folder, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * The desktop's test call for the login desk: Codex through the host's Codex trust (its profile and its checked process
 * port) on the route model Codex's own list gives; Claude Code through the program the search path has.
 */
export async function hostTestCall(cli: DelegateCli, program: { command: string; lead: string[] }, codexSource: unknown, models: { codexModels?(): Promise<{ route: string }> }): Promise<CliTestResult> {
  if (cli === 'codex') {
    const process = codexSource && typeof (codexSource as { process?: unknown }).process === 'function' ? (codexSource as { process: (request: ProcessRequest) => Promise<ProcessResult> }).process : undefined;
    const model = (await models.codexModels?.().catch(() => null))?.route ?? CODEX_MODEL_DEFAULTS.route;
    return tinyTestCall({ cli, codex: codexHost(codexSource), model, ...(process ? { process } : {}) });
  }
  if (program.lead.length) return { ok: false, code: 'CLI_UNAVAILABLE', line: 'Claude Code is on this computer in a form Chausar does not start.' };
  return tinyTestCall({ cli, claudeProgram: program.command, model: CLAUDE_TEST_MODEL });
}
