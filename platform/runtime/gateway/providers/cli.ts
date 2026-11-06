// The official command-line routes (codex-cli, claude-cli): running the command, its arguments and environment, and
// reading the Claude CLI's answer (split out of gateway.ts, D11; the Codex parser lives in providers/codex-cli.ts).
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { spawnTree } from '../../process-tree.ts';
import { check, ChausarError } from '../../contracts.ts';
import { buildCodexCliArguments, type CodexCliCapabilityProfile } from '../../providers/codex-cli.ts';
import { DEFAULT_OPERATIONS, INSTRUCTIONS, type ProcessRequest, type ProcessResult } from '../model-request.ts';
import { planSchema } from '../plan.ts';

export async function defaultProcess(request: ProcessRequest): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    // A2 second review: through spawnTree, so a time-out or too much output ends what the command started too. One-shot
    // A3 (L3): the search for helpers left behind runs only after such a kill, so an ordinary call starts no PowerShell.
    const child = spawnTree(request.command, request.args, { cwd: request.cwd, env: request.env, stdio: ['pipe', 'pipe', 'pipe'] }, { afterExit: 'killed' }) as ChildProcessWithoutNullStreams;
    let stdout = ''; let stderr = ''; let settled = false;
    const timer = setTimeout(() => { child.kill(); if (!settled) { settled = true; reject(new ChausarError('MODEL_TIMEOUT', 'The installed model command timed out.')); } }, request.timeoutMs);
    child.stdout.on('data', bytes => { stdout += bytes.toString(); if (Buffer.byteLength(stdout) > 1048576) { child.kill(); if (!settled) { settled = true; clearTimeout(timer); reject(new ChausarError('RESPONSE_TOO_LARGE', 'The command returned too much output.')); } } });
    child.stderr.on('data', bytes => { stderr = (stderr + bytes.toString()).slice(-8192); });
    child.on('error', () => { clearTimeout(timer); if (!settled) { settled = true; reject(new ChausarError('CLI_UNAVAILABLE', 'The selected official command is not installed or could not start.')); } });
    child.on('close', code => { clearTimeout(timer); if (!settled) { settled = true; resolve({ exitCode: code ?? 1, stdout, stderr }); } });
    child.stdin.on('error', () => {}); child.stdin.end(request.stdin);
  });
}

export function cliArguments(route: any, schemaPath: string, codexCapabilities?: CodexCliCapabilityProfile, output?: { schema: unknown; instructions: string }): string[] {
  if (route.kind === 'codex-cli') {
    check(codexCapabilities, 'CLI_CAPABILITY_REQUIRED', 'The trusted host must provide the reviewed Codex CLI interface.');
    return buildCodexCliArguments(route.model, schemaPath, codexCapabilities);
  }
  return ['--print', '--restricted', '--safe-mode', '--tools', '', '--disallowedTools', 'mcp__*', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--disable-slash-commands', '--no-chrome', '--no-session-persistence', '--output-format', 'json', '--model', route.model, '--max-turns', '1', '--json-schema', JSON.stringify(output?.schema ?? planSchema(route.operations || DEFAULT_OPERATIONS)), '--system-prompt', output?.instructions ?? INSTRUCTIONS];
}

export function processEnv(route: any): Record<string, string> {
  const result: Record<string, string> = {};
  // The official CLI accesses its own login. This engine never opens authentication files.
  for (const name of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'CODEX_HOME']) if (process.env[name]) result[name] = process.env[name]!;
  if (route.kind === 'claude-cli') Object.assign(result, { CLAUDE_CODE_MAX_RETRIES: '0', MAX_STRUCTURED_OUTPUT_RETRIES: '1', CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK: '1', FALLBACK_FOR_ALL_PRIMARY_MODELS: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1', CLAUDE_CODE_DISABLE_TERMINAL_TITLE: '1', CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(route.maxOutputTokens) });
  return result;
}

/** The claude-cli answer: structured output, or the result text as JSON. */
export function parseClaudeCliOutput(data: any): { value: unknown; usage?: any } {
  return { value: data.structured_output || JSON.parse(data.result), usage: data.usage };
}
