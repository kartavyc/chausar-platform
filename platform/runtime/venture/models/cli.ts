// Chausar venture launcher, package P2 (models): the Claude Code and Codex command-line routes.
// The engine never reads or stores a subscription token: each tool uses its own login on this computer.
// The Claude Code flags come from cliArguments in gateway.ts; Codex flags come from the reviewed host profile
// (providers/codex-cli.ts). Since Ink v2 wave 4 (4H1) both lists are checked against the installed tool's own help
// before a connection (cli-status.ts), so a flag the tool does not know refuses it instead of failing every call.
import { isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';
import { ChausarError } from '../../contracts.ts';
import { cliArguments } from '../../gateway.ts';
import { CODEX_CLI_CONFIG, CODEX_CLI_FLAGS, buildCodexCliArguments, parseCodexCliOutput, type CodexCliCapabilityProfile } from '../../providers/codex-cli.ts';
import type { Json, ModelProcessResponse, ModelTask } from '../contracts.ts';
import { sanitizeSchema } from './schema.ts';
import { RESPONSE_LIMIT_BYTES, isPlainRecord, readUsage, type Parsed } from './types.ts';
import { TELEMETRY_OFF_ENV } from '../core/telemetry.ts';

/** Stands in for the real schema file path until dispatch, so a preview can be built before any file exists. */
export const SCHEMA_PLACEHOLDER = join(tmpdir(), 'chausar-venture-schema-placeholder', 'schema.json');
/** How the schema file path is written in the stored payload text. */
export const SCHEMA_FILE_WORD = '<schema-file>';
export const TEMP_PREFIX = 'chausar-venture-model-';

const BASE_ENV_NAMES = ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA'];

/** Only the names a command-line tool needs to start and find its own login, plus fixed Claude Code settings. Never a key. */
export function cliEnv(kind: 'claude-cli' | 'codex-cli', maxOutputTokens?: number): Record<string, string> {
  const result: Record<string, string> = {};
  const names = kind === 'codex-cli' ? [...BASE_ENV_NAMES, 'CODEX_HOME'] : BASE_ENV_NAMES;
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === 'string' && value.length > 0) result[name] = value;
  }
  if (kind === 'claude-cli') {
    Object.assign(result, {
      CLAUDE_CODE_MAX_RETRIES: '0', MAX_STRUCTURED_OUTPUT_RETRIES: '1', CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK: '1', FALLBACK_FOR_ALL_PRIMARY_MODELS: '1',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1', CLAUDE_CODE_DISABLE_TERMINAL_TITLE: '1',
    });
    if (maxOutputTokens !== undefined) result.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(maxOutputTokens);
  }
  // Telemetry off for whichever tool runs (W1 H18).
  Object.assign(result, TELEMETRY_OFF_ENV[kind === 'codex-cli' ? 'codex' : 'claude-code']);
  return result;
}

export type CodexHost = { capabilities: CodexCliCapabilityProfile; mode: string };

/** The trusted Codex host profile from ModelPortOptions.codexCli, or null when there is none. */
export function codexHost(value: unknown): CodexHost | null {
  if (!isPlainRecord(value) || !isPlainRecord(value.capabilities) || !isPlainRecord(value.capabilities.evidence)) return null;
  return value as unknown as CodexHost;
}

/** The executable named by installed-help evidence, else the plain command name. */
export function codexCommand(host: CodexHost): string {
  const evidence = host.capabilities.evidence;
  return evidence.kind === 'installed-help' && isAbsolute(evidence.executable) ? evidence.executable : 'codex';
}

export type CliPlan = {
  kind: 'claude-cli' | 'codex-cli';
  command: string;
  args: string[]; // the schema file appears as SCHEMA_PLACEHOLDER until dispatch
  stdin: string;
  schema: Json;
  maxOutputTokens: number;
  payloadText: string;
};

export function cliPayloadText(command: string, args: string[], stdin: string): string {
  return JSON.stringify({ command, args: args.map(arg => (arg === SCHEMA_PLACEHOLDER ? SCHEMA_FILE_WORD : arg)), stdin });
}

export function claudePlan(model: string, task: ModelTask<unknown>): CliPlan {
  const schema = sanitizeSchema(task.schema);
  const args = cliArguments({ kind: 'claude-cli', model, maxOutputTokens: task.maxOutputTokens }, SCHEMA_PLACEHOLDER, undefined, { schema, instructions: task.instructions });
  const stdin = JSON.stringify(task.input);
  return { kind: 'claude-cli', command: 'claude', args, stdin, schema, maxOutputTokens: task.maxOutputTokens, payloadText: cliPayloadText('claude', args, stdin) };
}

/** Codex has no system prompt flag in the reviewed profile, so the instructions lead the stdin text, as in gateway.ts. */
export function codexPlan(model: string, task: ModelTask<unknown>, host: CodexHost): CliPlan {
  const schema = sanitizeSchema(task.schema);
  const command = codexCommand(host);
  const args = buildCodexCliArguments(model, SCHEMA_PLACEHOLDER, host.capabilities);
  const stdin = `${task.instructions}\n${JSON.stringify(task.input)}`;
  return { kind: 'codex-cli', command, args, stdin, schema, maxOutputTokens: task.maxOutputTokens, payloadText: cliPayloadText(command, args, stdin) };
}

/** The distinct flags in an argument list, in the order they first appear; values ('', JSON, paths) are not flags. */
function flagsIn(args: readonly string[]): string[] {
  return [...new Set(args.filter(arg => /^--[A-Za-z]/.test(arg)))];
}

/**
 * Ink v2 wave 4 (4H1): every flag the route sends to the tool, taken from the argument builders themselves
 * (cliArguments in gateway.ts for Claude Code, buildCodexCliArguments for Codex's exec), so the check of an installed
 * tool's help can never drift from what a call passes.
 */
export function cliRouteFlags(kind: 'claude-cli' | 'codex-cli'): string[] {
  if (kind === 'claude-cli') {
    return flagsIn(cliArguments({ kind: 'claude-cli', model: 'claude-sonnet-5-5', maxOutputTokens: 256 }, SCHEMA_PLACEHOLDER, undefined, { schema: {}, instructions: 'Flag list.' }));
  }
  const profile: CodexCliCapabilityProfile = {
    evidence: { kind: 'synthetic-fixture', label: 'synthetic flag list' },
    flags: [...CODEX_CLI_FLAGS], configKeys: CODEX_CLI_CONFIG.map(value => value.split('=')[0]), stdinPrompt: true, sandboxModes: ['read-only'],
  };
  return flagsIn(buildCodexCliArguments('gpt-6-luna', SCHEMA_PLACEHOLDER, profile));
}

/**
 * Route flags a tool accepts without listing them in its --help, so the help check does not require them; every
 * other route flag must be listed. Kept short and from evidence only: Claude Code 2.1.286 (checked on the founder's
 * computer, 23 Oct 2026) takes --max-turns but its help page does not show it. Codex's exec lists all of its flags.
 */
export const CLI_UNLISTED_FLAGS: Readonly<Record<'claude-cli' | 'codex-cli', readonly string[]>> = Object.freeze({
  'claude-cli': Object.freeze(['--max-turns']),
  'codex-cli': Object.freeze([]),
});

/**
 * How each tool says it does not know an option: Claude Code's parser ("error: unknown option '--x'") and Codex's
 * ("error: unexpected argument '--x' found", or "Found argument '--x' which wasn't expected" before that).
 */
const UNKNOWN_OPTION: readonly RegExp[] = [
  /\bunknown option ['"]?(--[A-Za-z0-9][A-Za-z0-9-]*)/gi,
  /\bunexpected argument ['"](--[A-Za-z0-9][A-Za-z0-9-]*)/gi,
  /\bunrecognized (?:option|argument) ['"]?(--[A-Za-z0-9][A-Za-z0-9-]*)/gi,
  /\bFound argument ['"](--[A-Za-z0-9][A-Za-z0-9-]*)['"] which wasn't expected/gi,
];

/**
 * The route flags a failed call's output says the tool does not know, in the route's order; empty when it names none
 * of them. This is how a flag the help check lets through (CLI_UNLISTED_FLAGS) is caught if a tool ever drops it.
 */
export function unknownRouteFlags(kind: 'claude-cli' | 'codex-cli', output: string): string[] {
  const named = new Set<string>();
  for (const pattern of UNKNOWN_OPTION) for (const match of output.slice(0, 16_384).matchAll(pattern)) named.add(match[1]);
  return cliRouteFlags(kind).filter(flag => named.has(flag));
}

function tooLarge(stdout: string): boolean {
  return Buffer.byteLength(stdout) > RESPONSE_LIMIT_BYTES;
}

/** Claude Code JSON output: structured_output, else the result text parsed as JSON; usage from usage. */
export function parseClaudeCli(response: ModelProcessResponse): Parsed {
  if (response.exitCode !== 0) return { ok: false, code: 'MODEL_FAILED', message: 'Claude Code stopped with an error. Chausar did not retry it.', usage: null };
  if (typeof response.stdout !== 'string' || tooLarge(response.stdout)) return { ok: false, code: 'MODEL_FAILED', message: 'Claude Code returned too much output.', usage: null };
  let data: unknown;
  try { data = JSON.parse(response.stdout); } catch { return { ok: false, code: 'MODEL_FAILED', message: 'Claude Code sent output Chausar could not read.', usage: null }; }
  if (!isPlainRecord(data)) return { ok: false, code: 'MODEL_FAILED', message: 'Claude Code sent output Chausar could not read.', usage: null };
  const usage = readUsage(data.usage);
  if (data.is_error === true) return { ok: false, code: 'MODEL_FAILED', message: 'Claude Code reported an error. Chausar did not retry it.', usage };
  if (data.structured_output !== undefined && data.structured_output !== null) return { ok: true, value: data.structured_output, usage };
  if (typeof data.result !== 'string') return { ok: false, code: 'MODEL_OUTPUT_REJECTED', message: 'Claude Code returned no answer.', usage };
  try { return { ok: true, value: JSON.parse(data.result), usage }; } catch {
    return { ok: false, code: 'MODEL_OUTPUT_REJECTED', message: 'The model answer was not valid JSON.', usage };
  }
}

/** Codex JSONL events through parseCodexCliOutput; its codes are mapped to the venture codes. */
export function parseCodexCli(response: ModelProcessResponse): Parsed {
  if (response.exitCode !== 0) return { ok: false, code: 'MODEL_FAILED', message: 'Codex stopped with an error. Chausar did not retry it.', usage: null };
  try {
    const parsed = parseCodexCliOutput(response.stdout);
    return { ok: true, value: parsed.value, usage: readUsage(parsed.usage) };
  } catch (error) {
    const code = error instanceof ChausarError ? error.code : '';
    if (code === 'MODEL_FAILED' || code === 'RESPONSE_TOO_LARGE') return { ok: false, code: 'MODEL_FAILED', message: 'Codex reported a failure or sent too much output. Chausar did not retry it.', usage: null };
    return { ok: false, code: 'MODEL_OUTPUT_REJECTED', message: 'Codex returned something other than one JSON answer.', usage: null };
  }
}
