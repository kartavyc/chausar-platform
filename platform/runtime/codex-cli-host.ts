import { createHash } from 'node:crypto';
import { lstat, open, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { check, ChausarError } from './contracts.ts';
import { defaultProcess, type GatewayOptions } from './gateway.ts';
import { CODEX_CLI_CONFIG, CODEX_CLI_FLAGS, type CodexCliCapabilityProfile } from './providers/codex-cli.ts';

/** Operator-owned snapshots, never renderer/RPC configuration or account evidence. */
export type CodexCliHostArtifact = {
  file: string; sha256: string; executableSha256: string; version: string; exitCode: 0;
};
export type CodexCliHostManifest = {
  schemaVersion: 1; recordedAt: string;
  executable: { path: string; sha256: string; version: string };
  versionOutput: CodexCliHostArtifact; execHelp: CodexCliHostArtifact; features: CodexCliHostArtifact;
  configReview: { source: string; reviewedAt: string; keys: string[] };
};
export type CodexCliHostDependencies = {
  readArtifact?: (path: string, maximumBytes: number) => Promise<Uint8Array>;
  executableSha256?: (path: string, maximumBytes: number) => Promise<string>;
  /** Trusted imports may supply process ports. Public route configuration cannot. */
  gateway?: Omit<GatewayOptions, 'codexCli'>;
};

const ARTIFACT_LIMIT = 262144;
const EXECUTABLE_LIMIT = 512 * 1024 * 1024;
const CONFIG_SOURCES = new Set([
  'https://developers.openai.com/codex/config-reference',
  'https://learn.chatgpt.com/docs/config-file/config-reference',
]);
const ARTIFACT_NAMES = {
  versionOutput: new Set(['version.stdout.txt', 'cli-version.txt', 'desktop-cli-version.txt']),
  execHelp: new Set(['exec-help.stdout.txt', 'cli-exec-help.txt', 'desktop-cli-exec-help.txt']),
  features: new Set(['features.stdout.txt', 'cli-features.txt', 'desktop-cli-features.txt']),
};
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function digest(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function timestamp(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function sha256(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
function invalid(message: string): never { throw new ChausarError('CLI_HOST_EVIDENCE_INVALID', message); }

/** Reads regular files with a hard byte bound, without running any executable. */
async function boundedFile(path: string, maximumBytes: number): Promise<Uint8Array> {
  const entry = await lstat(path);
  check(entry.isFile() && !entry.isSymbolicLink(), 'CLI_HOST_EVIDENCE_INVALID', 'CLI snapshots must be regular evidence files, not links.');
  const file = await open(path, 'r');
  try {
    const info = await file.stat();
    check(info.isFile() && info.size <= maximumBytes, 'CLI_HOST_EVIDENCE_INVALID', 'CLI evidence must be a bounded regular file.');
    const chunks: Buffer[] = []; let count = 0;
    while (true) {
      const chunk = Buffer.alloc(Math.min(65536, maximumBytes + 1 - count));
      const { bytesRead } = await file.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      count += bytesRead;
      check(count <= maximumBytes, 'CLI_HOST_EVIDENCE_INVALID', 'CLI evidence exceeded its byte limit.');
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks);
  } finally { await file.close(); }
}
async function binaryDigest(path: string, maximumBytes: number): Promise<string> {
  const file = await open(path, 'r');
  try {
    const info = await file.stat();
    check(info.isFile() && info.size > 0 && info.size <= maximumBytes, 'CLI_HOST_EVIDENCE_INVALID', 'Use a bounded native CLI executable.');
    const hasher = createHash('sha256'); const chunk = Buffer.alloc(65536); let count = 0;
    while (true) {
      const { bytesRead } = await file.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      count += bytesRead;
      check(count <= maximumBytes, 'CLI_HOST_EVIDENCE_INVALID', 'The CLI executable exceeded its byte limit.');
      hasher.update(chunk.subarray(0, bytesRead));
    }
    return hasher.digest('hex');
  } finally { await file.close(); }
}
function decode(bytes: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''); }
  catch { return invalid('CLI evidence must contain valid UTF-8.'); }
}
function artifact(value: unknown, kind: keyof typeof ARTIFACT_NAMES, directory: string, executable: CodexCliHostManifest['executable']): CodexCliHostArtifact {
  check(record(value), 'CLI_HOST_EVIDENCE_INVALID', 'Supply all version-matched CLI evidence artifacts.');
  check(typeof value.file === 'string' && value.file.length <= 4096 && !/[\0\r\n]/.test(value.file), 'CLI_HOST_EVIDENCE_INVALID', 'Use a recorded CLI evidence artifact path.');
  const path = resolve(directory, value.file); const child = relative(directory, path);
  check(child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child) && ARTIFACT_NAMES[kind].has(basename(path)), 'CLI_HOST_EVIDENCE_INVALID', 'CLI artifacts must be named evidence files within the manifest directory.');
  check(digest(value.sha256) && value.executableSha256 === executable.sha256 && value.version === executable.version && value.exitCode === 0, 'CLI_HOST_EVIDENCE_INVALID', 'CLI evidence must record successful probes of the exact selected executable and version.');
  return { file: path, sha256: value.sha256, executableSha256: executable.sha256, version: executable.version, exitCode: 0 };
}
function support(help: string, features: string, review: unknown): Pick<CodexCliCapabilityProfile, 'flags' | 'configKeys' | 'stdinPrompt' | 'sandboxModes'> {
  const optionLines = help.split(/\r?\n/).filter(line => /^\s+-/.test(line));
  const flags = CODEX_CLI_FLAGS.filter(flag => optionLines.some(line => new RegExp(`(?:^|[\\s,])${flag}(?=[\\s=<]|$)`).test(line)));
  const stdinPrompt = /instructions are read from stdin/i.test(help) && /(?:if|when)[^\r\n]*(['"`])-\1/i.test(help);
  const sandbox = help.match(/--sandbox\b[\s\S]{0,700}?\[possible values:\s*([^\]]+)\]/i);
  const sandboxModes = sandbox ? sandbox[1].split(',').map(value => value.trim()) : [];
  const ordinaryKeys = CODEX_CLI_CONFIG.map(value => value.split('=')[0]).filter(key => !key.startsWith('features.'));
  check(record(review) && typeof review.source === 'string' && CONFIG_SOURCES.has(review.source) && timestamp(review.reviewedAt) && Array.isArray(review.keys) && review.keys.every(key => typeof key === 'string'), 'CLI_HOST_EVIDENCE_INVALID', 'Record the explicit ordinary configuration-key review against the official reference.');
  const reviewedKeys = review.keys;
  check(ordinaryKeys.every(key => reviewedKeys.includes(key)), 'CLI_CAPABILITY_UNSUPPORTED', 'The official configuration review is missing a required key.');
  const featureRows = features.split(/\r?\n/).map(line => line.trim().match(/^([a-z][a-z0-9_]*)\s+(stable|experimental|under development|deprecated|removed)\s+(true|false)$/));
  const featureKeys = CODEX_CLI_CONFIG.map(value => value.split('=')[0]).filter(key => key.startsWith('features.'));
  check(featureKeys.every(key => featureRows.some(row => row !== null && row[1] === key.slice('features.'.length) && row[2] !== 'removed')), 'CLI_CAPABILITY_UNSUPPORTED', 'The selected CLI feature listing is missing a required supported feature.');
  check(flags.length === CODEX_CLI_FLAGS.length && stdinPrompt && sandboxModes.includes('read-only'), 'CLI_CAPABILITY_UNSUPPORTED', 'The recorded CLI help is missing a required flag, stdin prompt or read-only sandbox.');
  return { flags, configKeys: [...ordinaryKeys, ...featureKeys], stdinPrompt, sandboxModes };
}

/** Opt-in host activation: inspect pinned public interface evidence, never login or infer. */
export async function loadCodexCliHostGateway(environment: NodeJS.ProcessEnv, dependencies: CodexCliHostDependencies = {}): Promise<GatewayOptions | undefined> {
  check(!dependencies.gateway || !Object.hasOwn(dependencies.gateway, 'codexCli'), 'CLI_HOST_EVIDENCE_INVALID', 'Construct CLI capabilities from pinned host evidence only.');
  const manifestPath = environment.CHAUSAR_CODEX_CLI_EVIDENCE_FILE;
  const manifestDigest = environment.CHAUSAR_CODEX_CLI_EVIDENCE_SHA256;
  if (manifestPath === undefined && manifestDigest === undefined) return dependencies.gateway;
  check(typeof manifestPath === 'string' && isAbsolute(manifestPath) && basename(manifestPath) === 'codex-cli-host.json' && !/[\0\r\n]/.test(manifestPath) && digest(manifestDigest), 'CLI_HOST_EVIDENCE_INVALID', 'Configure both an absolute codex-cli-host.json path and its SHA256 pin.');
  const read = dependencies.readArtifact ?? boundedFile;
  const executableSha256 = dependencies.executableSha256 ?? binaryDigest;
  try {
    const bytes = await read(manifestPath, ARTIFACT_LIMIT);
    check(bytes instanceof Uint8Array && bytes.byteLength <= ARTIFACT_LIMIT && sha256(bytes) === manifestDigest, 'CLI_HOST_EVIDENCE_INVALID', 'The host manifest does not match its SHA256 pin.');
    let manifest: unknown;
    try { manifest = JSON.parse(decode(bytes)); } catch { return invalid('The pinned CLI host manifest is not valid JSON.'); }
    check(record(manifest) && manifest.schemaVersion === 1 && timestamp(manifest.recordedAt) && record(manifest.executable), 'CLI_HOST_EVIDENCE_INVALID', 'Use a versioned CLI host evidence manifest.');
    const native = manifest.executable;
    check(typeof native.path === 'string' && isAbsolute(native.path) && /(?:^|[\\/])codex(?:\.exe)?$/i.test(native.path) && !/[\0\r\n]/.test(native.path) && digest(native.sha256) && typeof native.version === 'string' && /^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(native.version), 'CLI_HOST_EVIDENCE_INVALID', 'Bind evidence to one exact native Codex executable, digest and version.');
    const executable = { path: native.path, sha256: native.sha256, version: native.version };
    const directory = dirname(manifestPath);
    const version = artifact(manifest.versionOutput, 'versionOutput', directory, executable);
    const execHelp = artifact(manifest.execHelp, 'execHelp', directory, executable);
    const features = artifact(manifest.features, 'features', directory, executable);
    const physicalDirectory = dependencies.readArtifact ? undefined : await realpath(directory);
    async function text(proof: CodexCliHostArtifact): Promise<string> {
      if (physicalDirectory !== undefined) {
        const child = relative(physicalDirectory, await realpath(proof.file));
        check(child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child), 'CLI_HOST_EVIDENCE_INVALID', 'CLI artifacts must remain within the physical manifest directory.');
      }
      const content = await read(proof.file, ARTIFACT_LIMIT);
      check(content instanceof Uint8Array && content.byteLength <= ARTIFACT_LIMIT && sha256(content) === proof.sha256, 'CLI_HOST_EVIDENCE_INVALID', 'A recorded CLI artifact does not match its SHA256 pin.');
      return decode(content);
    }
    const versionText = await text(version);
    check(versionText.trim() === `codex-cli ${executable.version}`, 'CLI_HOST_EVIDENCE_INVALID', 'The version output differs from the selected CLI version.');
    const helpText = await text(execHelp); const featuresText = await text(features);
    const capabilities: CodexCliCapabilityProfile = { evidence: { kind: 'installed-help', executable: executable.path, version: executable.version, helpDigest: execHelp.sha256 }, ...support(helpText, featuresText, manifest.configReview) };
    async function verifyBinary(): Promise<void> {
      try {
        check(await executableSha256(executable.path, EXECUTABLE_LIMIT) === executable.sha256, 'CLI_HOST_EVIDENCE_INVALID', 'The native CLI executable differs from the pinned interface evidence.');
      } catch (error) {
        if (error instanceof ChausarError) throw error;
        return invalid('The selected native CLI executable could not be read and verified.');
      }
    }
    await verifyBinary();
    const processPort = dependencies.gateway?.process ?? defaultProcess;
    return { ...dependencies.gateway, codexCli: { capabilities, mode: 'local-cli' }, process: async request => {
      // Other provider transports retain their existing behavior. The Codex adapter
      // additionally binds arguments/schema/command before reaching this port.
      if (request.command === executable.path) await verifyBinary();
      return processPort(request);
    } };
  } catch (error) {
    if (error instanceof ChausarError) throw error;
    return invalid('The configured native CLI evidence could not be read and verified.');
  }
}
