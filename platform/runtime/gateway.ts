// Running an official command-line AI tool (Codex, Claude Code) for one text answer, and the shapes a trusted host
// uses to hand in its Codex. The venture model ports, speech and the Codex host share these.
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { spawnTree } from './process-tree.ts';
import { check, ChausarError } from './contracts.ts';
import { buildCodexCliArguments, type CodexCliCapabilityProfile } from './providers/codex-cli.ts';

export type ProcessRequest = { command: string; args: string[]; cwd: string; env: Record<string, string>; stdin: string; timeoutMs: number; schema: unknown };
export type ProcessResult = { exitCode: number; stdout: string; stderr?: string };
/** What a trusted host hands in about command-line tools. Never from a request. */
export type GatewayOptions = {
  process?: (request: ProcessRequest) => Promise<ProcessResult>;
  /** The reviewed Codex on this computer, with the evidence of what it accepts. */
  codexCli?: { capabilities: CodexCliCapabilityProfile; mode: 'synthetic-fixture' | 'local-cli' };
};

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

export function cliArguments(route: any, schemaPath: string, codexCapabilities: CodexCliCapabilityProfile | undefined, output: { schema: unknown; instructions: string }): string[] {
  if (route.kind === 'codex-cli') {
    check(codexCapabilities, 'CLI_CAPABILITY_REQUIRED', 'The trusted host must provide the reviewed Codex CLI interface.');
    return buildCodexCliArguments(route.model, schemaPath, codexCapabilities);
  }
  return ['--print', '--restricted', '--safe-mode', '--tools', '', '--disallowedTools', 'mcp__*', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--disable-slash-commands', '--no-chrome', '--no-session-persistence', '--output-format', 'json', '--model', route.model, '--max-turns', '1', '--json-schema', JSON.stringify(output.schema), '--system-prompt', output.instructions];
}

