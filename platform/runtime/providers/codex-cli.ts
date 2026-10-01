import { isAbsolute } from 'node:path';
import { check, ChausarError, hash } from '../contracts.ts';
import type { ProcessRequest, ProcessResult } from '../gateway.ts';

export type CodexCliProcess = (request: ProcessRequest) => Promise<ProcessResult>;
export type CodexCliEvidence =
  | { kind: 'synthetic-fixture'; label: string }
  | { kind: 'official-docs'; checkedAt: string }
  | { kind: 'installed-help'; executable: string; version: string; helpDigest: string };
export type CodexCliCapabilityProfile = {
  evidence: CodexCliEvidence;
  flags: readonly string[];
  configKeys: readonly string[];
  stdinPrompt: boolean;
  sandboxModes: readonly string[];
};

export const CODEX_CLI_FLAGS = Object.freeze([
  '--ignore-user-config', '--ephemeral', '--skip-git-repo-check',
  '--sandbox', '--json', '--model', '--output-schema', '--config',
]);
// Ordinary documented keys and version-matched public feature controls.
// shell_tool is the parent admission switch for both shell implementations;
// unified_exec can be forced on by managed policy and is not a disable boundary.
// Preserve execution rules and CLI-owned auth; never override provider retry keys.
export const CODEX_CLI_CONFIG = Object.freeze([
  'approval_policy="never"', 'forced_login_method="chatgpt"', 'model_provider="openai"',
  'web_search="disabled"', 'project_doc_max_bytes=0', 'history.persistence="none"',
  'features.view_image=false', 'features.image_generation=false', 'features.sleep_tool=false',
  'features.tool_suggest=false', 'features.request_permissions_tool=false',
  'features.shell_tool=false', 'features.apps=false', 'features.multi_agent=false',
  'features.hooks=false', 'features.memories=false', 'features.goals=false',
  'features.skill_mcp_dependency_install=false',
]);
export const CODEX_CLI_LIMITS = Object.freeze({
  stdoutBytes: 1048576, eventBytes: 262144, events: 256,
  planBytes: 65536, stdinBytes: 262144, schemaBytes: 65536, timeoutMs: 120000,
});

export type CodexCliUsage = {
  input_tokens: number; output_tokens: number;
  cached_input_tokens?: number; reasoning_output_tokens?: number;
};
export type CodexCliOutput = { value: unknown; usage?: CodexCliUsage; completed: true };
export type CodexCliBoundary = {
  receiptBoundary: 'application-to-official-cli'; providerPayloadObserved: false;
  stdinDigest: string; declaredSchemaDigest: string;
};

const ENVIRONMENT_NAMES = new Set([
  'PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE',
  'APPDATA', 'LOCALAPPDATA', 'CODEX_HOME',
]);
const TOOL_ITEMS = new Set([
  'command_execution', 'file_change', 'mcp_tool_call', 'web_search', 'tool_call',
  'function_call', 'computer_use',
]);

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function nativeCommand(command: string): boolean {
  return command === 'codex' || (isAbsolute(command) && /(?:^|[\\/])codex(?:\.exe)?$/i.test(command));
}
function assertCapabilities(profile: CodexCliCapabilityProfile): void {
  check(profile && record(profile.evidence), 'CLI_CAPABILITY_REQUIRED', 'Supply reviewed CLI interface evidence.');
  const evidence = profile.evidence;
  if (evidence.kind === 'synthetic-fixture') check(typeof evidence.label === 'string' && evidence.label.startsWith('synthetic'), 'CLI_CAPABILITY_REQUIRED', 'Label synthetic CLI fixtures explicitly.');
  else if (evidence.kind === 'official-docs') check(typeof evidence.checkedAt === 'string' && Number.isFinite(Date.parse(evidence.checkedAt)), 'CLI_CAPABILITY_REQUIRED', 'Record when the official CLI contract was checked.');
  else if (evidence.kind === 'installed-help') check(typeof evidence.executable === 'string' && nativeCommand(evidence.executable) && isAbsolute(evidence.executable) && typeof evidence.version === 'string' && evidence.version.length > 0 && /^[a-f0-9]{64}$/.test(evidence.helpDigest), 'CLI_CAPABILITY_REQUIRED', 'Record the native executable, version and help digest.');
  else throw new ChausarError('CLI_CAPABILITY_REQUIRED', 'Unknown CLI interface evidence.');
  check(Array.isArray(profile.flags) && CODEX_CLI_FLAGS.every(flag => profile.flags.includes(flag)), 'CLI_CAPABILITY_UNSUPPORTED', 'The reviewed CLI interface is missing a required flag.');
  check(Array.isArray(profile.configKeys) && CODEX_CLI_CONFIG.every(value => profile.configKeys.includes(value.split('=')[0])), 'CLI_CAPABILITY_UNSUPPORTED', 'The reviewed CLI interface is missing a required configuration key.');
  check(profile.stdinPrompt === true && Array.isArray(profile.sandboxModes) && profile.sandboxModes.includes('read-only'), 'CLI_CAPABILITY_UNSUPPORTED', 'The reviewed CLI must support stdin and the read-only sandbox.');
}

/** Profile support is interface evidence only; it never proves account/model access. */
export function buildCodexCliArguments(model: string, schemaPath: string, profile: CodexCliCapabilityProfile): string[] {
  assertCapabilities(profile);
  check(typeof model === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(model), 'INVALID_ROUTE', 'Select an explicit model identifier.');
  check(typeof schemaPath === 'string' && isAbsolute(schemaPath) && schemaPath.length <= 4096 && !/[\0\r\n]/.test(schemaPath), 'INVALID_SCHEMA', 'Use an absolute schema-file path.');
  return ['exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check',
    '--sandbox', 'read-only', '--json', '--model', model, '--output-schema', schemaPath,
    ...CODEX_CLI_CONFIG.flatMap(value => ['--config', value]), '-'];
}

function usage(value: unknown): CodexCliUsage | undefined {
  if (value === undefined) return undefined;
  check(record(value), 'INVALID_PLAN', 'The CLI returned invalid usage.');
  const input = value.input_tokens; const output = value.output_tokens;
  check(typeof input === 'number' && Number.isSafeInteger(input) && input >= 0 && typeof output === 'number' && Number.isSafeInteger(output) && output >= 0, 'INVALID_PLAN', 'The CLI returned invalid usage.');
  const result: CodexCliUsage = { input_tokens: input, output_tokens: output };
  for (const key of ['cached_input_tokens', 'reasoning_output_tokens'] as const) {
    const tokens = value[key];
    if (tokens !== undefined) {
      check(typeof tokens === 'number' && Number.isSafeInteger(tokens) && tokens >= 0, 'INVALID_PLAN', 'The CLI returned invalid usage.');
      result[key] = tokens;
    }
  }
  return result;
}

/** Bounded JSONL decoding. validatePlan remains the authority for plan semantics. */
export function parseCodexCliOutput(stdout: string): CodexCliOutput {
  check(typeof stdout === 'string' && Buffer.byteLength(stdout) <= CODEX_CLI_LIMITS.stdoutBytes, 'RESPONSE_TOO_LARGE', 'The CLI returned too much output.');
  const lines = stdout.trim().split(/\r?\n/);
  check(lines.length <= CODEX_CLI_LIMITS.events, 'RESPONSE_TOO_LARGE', 'The CLI returned too many events.');
  let finalText: string | undefined; let completed = false; let turnStarted = false; let threadStarted = false;
  let measuredUsage: CodexCliUsage | undefined;
  for (const line of lines) {
    check(line.trim().length > 0, 'INVALID_PLAN', 'The CLI returned an empty event.');
    check(Buffer.byteLength(line) <= CODEX_CLI_LIMITS.eventBytes, 'RESPONSE_TOO_LARGE', 'The CLI returned an oversized event.');
    let event: unknown;
    try { event = JSON.parse(line); } catch { throw new ChausarError('INVALID_PLAN', 'The CLI returned malformed event JSON.'); }
    check(record(event) && typeof event.type === 'string', 'INVALID_PLAN', 'The CLI returned an invalid event.');
    if (event.type === 'turn.failed' || event.type === 'error') throw new ChausarError('MODEL_FAILED', 'The CLI reported failure. The request was not retried or rerouted.');
    check(!completed, 'INVALID_PLAN', 'The CLI returned events after the completed turn.');
    if (event.type === 'thread.started') {
      check(!threadStarted && !turnStarted && finalText === undefined && typeof event.thread_id === 'string' && event.thread_id.length > 0 && event.thread_id.length <= 256, 'INVALID_PLAN', 'The CLI returned an invalid thread start.');
      threadStarted = true;
    } else if (event.type === 'turn.started') {
      check(!turnStarted && finalText === undefined, 'INVALID_PLAN', 'The CLI returned multiple or misplaced turns.'); turnStarted = true;
    } else if (event.type === 'turn.completed') {
      check(finalText !== undefined, 'INVALID_PLAN', 'The CLI completed without a final plan.');
      measuredUsage = usage(event.usage); completed = true;
    } else if (['item.started', 'item.updated', 'item.completed'].includes(event.type)) {
      const item = event.item;
      check(record(item) && typeof item.type === 'string', 'INVALID_PLAN', 'The CLI returned an invalid item.');
      check(!TOOL_ITEMS.has(item.type), 'MODEL_TOOL_ATTEMPT', 'The CLI attempted an unapproved tool.');
      check(item.type === 'agent_message' || item.type === 'reasoning', 'INVALID_PLAN', 'The CLI returned an unsupported item type.');
      if (item.id !== undefined) check(typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 256, 'INVALID_PLAN', 'The CLI returned an invalid item identifier.');
      if (item.text !== undefined) check(typeof item.text === 'string', 'INVALID_PLAN', 'The CLI returned invalid item text.');
      if (item.type === 'agent_message' && event.type === 'item.completed') {
        check(finalText === undefined && typeof item.text === 'string' && item.text.length > 0, 'INVALID_PLAN', 'The CLI must return exactly one final plan.');
        check(Buffer.byteLength(item.text) <= CODEX_CLI_LIMITS.planBytes, 'RESPONSE_TOO_LARGE', 'The CLI returned an oversized plan.');
        finalText = item.text;
      }
    } else throw new ChausarError('INVALID_PLAN', 'The CLI returned an unsupported event type.');
  }
  check(completed && finalText !== undefined, 'INVALID_PLAN', 'A successful completed CLI turn is required.');
  let value: unknown;
  try { value = JSON.parse(finalText); } catch { throw new ChausarError('INVALID_PLAN', 'The CLI did not return valid plan JSON.'); }
  check(record(value), 'INVALID_PLAN', 'The CLI did not return a plan object.');
  return { value, ...(measuredUsage ? { usage: measuredUsage } : {}), completed: true };
}

/** Only the application stdin and declared schema are observed, never provider bytes. */
export function codexCliBoundary(request: ProcessRequest): CodexCliBoundary {
  check(typeof request.stdin === 'string' && Buffer.byteLength(request.stdin) <= CODEX_CLI_LIMITS.stdinBytes, 'PAYLOAD_TOO_LARGE', 'The CLI request is too large.');
  check(record(request.schema), 'INVALID_SCHEMA', 'Supply the declared plan schema.');
  let schema: unknown;
  try { schema = JSON.stringify(request.schema); } catch { throw new ChausarError('INVALID_SCHEMA', 'The declared plan schema is not serializable.'); }
  check(typeof schema === 'string' && Buffer.byteLength(schema) <= CODEX_CLI_LIMITS.schemaBytes, 'INVALID_SCHEMA', 'The declared plan schema is invalid or too large.');
  return { receiptBoundary: 'application-to-official-cli', providerPayloadObserved: false,
    stdinDigest: hash(request.stdin), declaredSchemaDigest: hash(schema) };
}

/** The trusted host supplies the process port; this module never spawns or logs in. */
export function createCodexCliProcessAdapter(options: {
  capabilities: CodexCliCapabilityProfile; process: CodexCliProcess;
  mode: 'synthetic-fixture' | 'local-cli';
}): CodexCliProcess {
  const profile = structuredClone(options.capabilities); assertCapabilities(profile);
  check(typeof options.process === 'function', 'CLI_UNAVAILABLE', 'Supply a trusted process port.');
  check(options.mode === 'synthetic-fixture' || options.mode === 'local-cli', 'CLI_CAPABILITY_REQUIRED', 'Select an explicit process evidence mode.');
  if (options.mode === 'synthetic-fixture') check(profile.evidence.kind === 'synthetic-fixture', 'CLI_CAPABILITY_REQUIRED', 'Synthetic process fixtures need synthetic interface evidence.');
  else check(profile.evidence.kind === 'installed-help', 'CLI_CAPABILITY_REQUIRED', 'A real process needs installed CLI interface evidence.');
  const processPort = options.process;
  return async (request: ProcessRequest): Promise<ProcessResult> => {
    check(typeof request.command === 'string' && nativeCommand(request.command), 'INVALID_COMMAND', 'Use the trusted native Codex executable.');
    if (profile.evidence.kind === 'installed-help') check(request.command === profile.evidence.executable, 'INVALID_COMMAND', 'The executable differs from the reviewed CLI.');
    check(isAbsolute(request.cwd) && !/[\0\r\n]/.test(request.cwd), 'INVALID_COMMAND', 'Use the host-created isolated working directory.');
    check(Number.isSafeInteger(request.timeoutMs) && request.timeoutMs > 0 && request.timeoutMs <= CODEX_CLI_LIMITS.timeoutMs, 'INVALID_ROUTE', 'Use a bounded CLI timeout.');
    check(Array.isArray(request.args) && request.args.every(value => typeof value === 'string'), 'INVALID_COMMAND', 'Supply explicit CLI arguments.');
    const model = request.args[request.args.indexOf('--model') + 1];
    const schemaPath = request.args[request.args.indexOf('--output-schema') + 1];
    const expected = buildCodexCliArguments(model, schemaPath, profile);
    check(request.args.length === expected.length && request.args.every((value, index) => value === expected[index]), 'CLI_CAPABILITY_UNSUPPORTED', 'CLI arguments differ from the reviewed bounded contract.');
    check(record(request.env) && Object.entries(request.env).every(([name, value]) => ENVIRONMENT_NAMES.has(name) && typeof value === 'string'), 'INVALID_CREDENTIAL', 'Use only CLI-owned login and native process environment names.');
    codexCliBoundary(request);
    // Exactly one invocation; no fallback transport, credential broker or retry loop.
    const result = await processPort(structuredClone(request));
    check(Number.isInteger(result.exitCode) && result.exitCode === 0, 'MODEL_FAILED', 'The CLI failed. The request was not retried or rerouted.');
    parseCodexCliOutput(result.stdout);
    return result;
  };
}
