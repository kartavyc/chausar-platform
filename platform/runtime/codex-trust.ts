// A2: trust both kinds of Codex. Chausar runs a Codex only through a pinned manifest of its reviewed setup: the native
// program's digest and version, and its own `--version`, `exec --help` and `features list` answers, each pinned, which
// loadCodexCliHostGateway (codex-cli-host.ts) checks in full at load, with the program's digest checked again before
// every call. That gate is unchanged. What changed is who records the manifest:
// - operator: the two environment values (CHAUSAR_CODEX_CLI_EVIDENCE_FILE and _SHA256), as before; they win;
// - bundled: the build records the three answers of the Codex it ships (scripts/codex-bundle.mjs, BUNDLE.json); at
//   start the engine checks BUNDLE.json's digests of the program and the three files, writes the manifest for the
//   installed path into the trust folder and loads it through the same loader;
// - owner: a Codex found on this computer is shown to the owner first (path, version, digest, whether its help and
//   features have what Chausar needs, checked by the same loader on a review copy); only when the owner confirms that
//   exact digest is its manifest kept in the trust folder (CHAUSAR_CODEX_TRUST_DIR) and used.
// Review runs only the program itself (never a shell or a script), with no prompt, in an empty folder, and reads no
// sign-in file, token or key.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { ChausarError, check } from './contracts.ts';
import { defaultProcess, type GatewayOptions, type ProcessRequest, type ProcessResult } from './gateway.ts';
import { loadCodexCliHostGateway } from './codex-cli-host.ts';
import { CODEX_CLI_CONFIG, type CodexCliCapabilityProfile } from './providers/codex-cli.ts';
import { cliEnv } from './venture/models/cli.ts';
import { CODEX_NPM_ENTRY, NPM_SHIM_FILE, resolveNpmShim } from './venture/models/npm-shim.ts';
import { locateOnThisComputer } from './venture/models/cli-look.ts';

export type CodexOrigin = 'operator' | 'bundled' | 'owner';
export type CodexHostProfile = { capabilities: CodexCliCapabilityProfile; mode: 'local-cli' | 'synthetic-fixture' };
/**
 * What the owner is shown of a Codex setup. state: 'trusted' (in use), 'review' (found and checked, waiting for the
 * owner's yes), 'refused' (found, but it lacks what Chausar needs, or it is not a program Chausar starts), 'none'.
 */
export type CodexSetupView = {
  state: 'trusted' | 'review' | 'refused' | 'none'; origin: CodexOrigin | null;
  path: string | null; version: string | null; sha256: string | null; line: string;
};
/** One check command: the program, its arguments, an empty folder. */
export type CodexProbe = (command: string, args: string[], cwd: string) => Promise<{ exitCode: number; stdout: string }>;

/**
 * The ordinary configuration keys Chausar's Codex route sends, as reviewed against the official reference: the same
 * list the operator manifests name, kept with the setup Chausar records (re-run live on Codex 0.166.0, 3 Nov 2026).
 */
export const CODEX_CONFIG_REVIEW = Object.freeze({
  source: 'https://developers.openai.com/codex/config-reference',
  reviewedAt: '2026-11-03T00:00:00.000Z',
  keys: Object.freeze(CODEX_CLI_CONFIG.map(value => value.split('=')[0]).filter(key => !key.startsWith('features.'))),
});
/** The three answers a setup pins, by the file names the loader accepts. */
export const SETUP_FILES = Object.freeze({ versionOutput: 'version.stdout.txt', execHelp: 'exec-help.stdout.txt', features: 'features.stdout.txt' });
const SETUP_ARGS: Readonly<Record<keyof typeof SETUP_FILES, string[]>> = Object.freeze({ versionOutput: ['--version'], execHelp: ['exec', '--help'], features: ['features', 'list'] });
const PROBE_TIMEOUT_MS = 15_000;
const PROBE_LIMIT = 262_144;
const EXECUTABLE_LIMIT = 512 * 1024 * 1024;
const TARGETS: Readonly<Record<string, string>> = Object.freeze({
  'win32-x64': 'x86_64-pc-windows-msvc', 'win32-arm64': 'aarch64-pc-windows-msvc',
  'linux-x64': 'x86_64-unknown-linux-musl', 'linux-arm64': 'aarch64-unknown-linux-musl',
  'darwin-x64': 'x86_64-apple-darwin', 'darwin-arm64': 'aarch64-apple-darwin',
});

export const SETUP_WORDS = Object.freeze({
  none: "Codex isn't on this computer.",
  bundled: (version: string) => `Uses the Codex ${version} that comes with Chausar.`,
  owner: (version: string) => `Uses your Codex ${version}, which you chose.`,
  operator: (version: string) => `Uses the Codex ${version} this computer's setup names.`,
  review: (version: string) => `Codex ${version} is on this computer and has what Chausar needs. Use it?`,
  notProgram: 'This Codex is in a form Chausar does not start. Use the Codex that comes with Chausar.',
  lacking: (version: string | null) => `${version ? `Codex ${version}` : 'This Codex'} lacks a setting Chausar needs. Update it, then check again.`,
  noAnswer: 'This Codex did not answer its version check. Update or reinstall it, then check again.',
  noFolder: "Chausar can't keep a chosen Codex here.",
  changed: 'That Codex changed since you looked at it. Check it again.',
});

const sha256Of = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

async function fileDigest(path: string): Promise<string> {
  const info = await stat(path);
  check(info.isFile() && info.size > 0 && info.size <= EXECUTABLE_LIMIT, 'CLI_HOST_EVIDENCE_INVALID', 'Use a bounded native Codex program.');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/** Runs a check command without a shell, with the tool's minimal environment, a time limit and a read limit. */
export const defaultCodexProbe: CodexProbe = (command, args, cwd) => new Promise(resolve => {
  let stdout = '', settled = false;
  const done = (exitCode: number) => { if (!settled) { settled = true; clearTimeout(timer); resolve({ exitCode, stdout }); } };
  let child: ReturnType<typeof spawn>;
  try { child = spawn(command, args, { cwd, env: cliEnv('codex-cli'), shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch { resolve({ exitCode: -1, stdout: '' }); return; }
  const timer = setTimeout(() => { child.kill(); done(-1); }, PROBE_TIMEOUT_MS);
  child.stdout?.on('data', chunk => { if (stdout.length < PROBE_LIMIT) stdout += String(chunk).slice(0, PROBE_LIMIT - stdout.length); });
  child.on('error', () => done(-1));
  child.on('exit', code => done(typeof code === 'number' ? code : -1));
});

/**
 * The native Codex program behind a found path: the path itself when it is a program, or for npm's standard shim the
 * platform package's `bin/codex(.exe)` inside the same @openai/codex install. Null when there is none.
 */
export async function nativeCodexOf(path: string, platform: NodeJS.Platform = process.platform, architecture: string = process.arch, locate = locateOnThisComputer): Promise<string | null> {
  if (!isAbsolute(path)) return null;
  const program = platform === 'win32' ? 'codex.exe' : 'codex';
  if (!NPM_SHIM_FILE.test(path)) return basename(path).toLowerCase() === program ? path : null;
  const shim = resolveNpmShim(path, locate, CODEX_NPM_ENTRY, platform);
  const target = TARGETS[`${platform}-${architecture}`];
  if (!shim || !target) return null;
  const root = dirname(dirname(shim.script));
  const name = `codex-${platform}-${architecture}`;
  for (const vendor of [join(root, 'node_modules', '@openai', name, 'vendor', target), join(root, '..', name, 'vendor', target), join(root, 'vendor', target)]) {
    const candidate = join(vendor, 'bin', program);
    try { const info = await lstat(candidate); if (info.isFile() && !info.isSymbolicLink()) return candidate; } catch { /* next */ }
  }
  return null;
}

/** '~\x\codex.exe' for a path in the home folder. */
function shown(path: string): string {
  const home = homedir();
  const part = relative(home, path);
  return home && part && !part.startsWith('..') && !isAbsolute(part) ? `~${sep}${part}` : path;
}

type Evidence = { executable: { path: string; sha256: string; version: string }; outputs: Record<keyof typeof SETUP_FILES, string>; recordedAt: string };

/** Writes one setup's files and manifest into an empty folder; answers the manifest's path and digest. */
async function writeSetup(folder: string, evidence: Evidence): Promise<{ manifest: string; sha256: string }> {
  await mkdir(folder, { recursive: true });
  const artifact = async (role: keyof typeof SETUP_FILES) => {
    const bytes = Buffer.from(evidence.outputs[role], 'utf8');
    await writeFile(join(folder, SETUP_FILES[role]), bytes);
    return { file: SETUP_FILES[role], sha256: sha256Of(bytes), executableSha256: evidence.executable.sha256, version: evidence.executable.version, exitCode: 0 };
  };
  const manifest = {
    schemaVersion: 1, recordedAt: evidence.recordedAt, executable: evidence.executable,
    versionOutput: await artifact('versionOutput'), execHelp: await artifact('execHelp'), features: await artifact('features'),
    configReview: { source: CODEX_CONFIG_REVIEW.source, reviewedAt: CODEX_CONFIG_REVIEW.reviewedAt, keys: [...CODEX_CONFIG_REVIEW.keys] },
  };
  const text = JSON.stringify(manifest, null, 2) + '\n';
  const path = join(folder, 'codex-cli-host.json');
  await writeFile(path, text);
  return { manifest: path, sha256: sha256Of(text) };
}

/** Loads a written setup through the unchanged loader. */
async function loadSetup(manifest: string, sha256: string, base: Omit<GatewayOptions, 'codexCli'> | undefined): Promise<GatewayOptions> {
  const gateway = await loadCodexCliHostGateway({ CHAUSAR_CODEX_CLI_EVIDENCE_FILE: manifest, CHAUSAR_CODEX_CLI_EVIDENCE_SHA256: sha256 }, base ? { gateway: base } : {});
  check(gateway?.codexCli, 'CLI_HOST_EVIDENCE_INVALID', 'The Codex setup could not be loaded.');
  return gateway;
}

export type CodexTrustOptions = {
  environment?: NodeJS.ProcessEnv;
  /** The operator's verified gateway (loadCodexCliHostGateway on the environment values), when they are set. */
  operator?: GatewayOptions;
  probe?: CodexProbe;
  now?: () => Date;
  platform?: NodeJS.Platform;
  architecture?: string;
  locate?: (command: string) => string | null;
};

/** The one Codex trust of an engine process: the setup in use, and the owner's review of a found Codex. */
export class CodexTrust {
  readonly #options: CodexTrustOptions;
  #gateway: GatewayOptions | undefined;
  #origin: CodexOrigin | null = null;
  #version: string | null = null;
  #path: string | null = null;
  #sha256: string | null = null;
  /** Reviews waiting for the owner's yes, by program digest: the review copy's folder and what it found. */
  #reviews = new Map<string, { folder: string; evidence: Evidence }>();
  /** The last review of a found path, kept while the program's size and time stay the same. */
  #looked = new Map<string, { key: string; view: CodexSetupView }>();

  constructor(options: CodexTrustOptions = {}) { this.#options = options; }

  get #env(): NodeJS.ProcessEnv { return this.#options.environment ?? process.env; }
  get #base(): Omit<GatewayOptions, 'codexCli'> | undefined {
    if (!this.#options.operator) return undefined;
    const { codexCli: _ignored, ...rest } = this.#options.operator;
    void _ignored;
    return rest;
  }
  #now(): string { return (this.#options.now?.() ?? new Date()).toISOString(); }
  #trustFolder(): string | null {
    const folder = this.#env.CHAUSAR_CODEX_TRUST_DIR;
    return typeof folder === 'string' && isAbsolute(folder) && !/[\0\r\n]/.test(folder) ? folder : null;
  }

  /** The setup in use: the operator's, else the owner's choice, else the bundled Codex. Any failure leaves none. */
  async load(): Promise<void> {
    if (this.#options.operator?.codexCli) {
      this.#use(this.#options.operator, 'operator');
      return;
    }
    if (await this.#loadOwner()) return;
    await this.#loadBundled();
  }

  #use(gateway: GatewayOptions, origin: CodexOrigin): void {
    this.#gateway = gateway; this.#origin = origin;
    const evidence = gateway.codexCli!.capabilities.evidence;
    this.#version = evidence.kind === 'installed-help' ? evidence.version : null;
    this.#path = evidence.kind === 'installed-help' ? evidence.executable : null;
  }

  async #loadOwner(): Promise<boolean> {
    const folder = this.#trustFolder();
    if (!folder) return false;
    try {
      const pin = JSON.parse(await readFile(join(folder, 'trusted.json'), 'utf8')) as { manifest?: unknown; sha256?: unknown; programSha256?: unknown };
      check(typeof pin.manifest === 'string' && typeof pin.sha256 === 'string' && typeof pin.programSha256 === 'string', 'CLI_HOST_EVIDENCE_INVALID', 'The kept Codex choice is unreadable.');
      const manifest = join(folder, pin.manifest as string);
      check(dirname(dirname(manifest)) === folder, 'CLI_HOST_EVIDENCE_INVALID', 'The kept Codex choice points outside its folder.');
      this.#use(await loadSetup(manifest, pin.sha256 as string, this.#base), 'owner');
      this.#sha256 = pin.programSha256 as string;
      return true;
    } catch { return false; }
  }

  async #loadBundled(): Promise<boolean> {
    const bundle = this.#env.CHAUSAR_CODEX_BUNDLE_DIR;
    if (typeof bundle !== 'string' || !isAbsolute(bundle)) return false;
    try {
      const manifest = JSON.parse(await readFile(join(bundle, 'BUNDLE.json'), 'utf8')) as {
        version?: unknown; entrypoint?: unknown; files?: Record<string, { sha256?: unknown }>; evidence?: { recordedAt?: unknown; files?: Record<string, unknown> } | null;
      };
      const evidence = manifest.evidence;
      check(typeof manifest.version === 'string' && typeof manifest.entrypoint === 'string' && manifest.files && evidence && typeof evidence.recordedAt === 'string' && evidence.files,
        'CLI_HOST_EVIDENCE_INVALID', 'The bundled Codex has no recorded setup.');
      const program = join(bundle, ...(manifest.entrypoint as string).split('/'));
      const programSha = manifest.files![manifest.entrypoint as string]?.sha256;
      check(typeof programSha === 'string' && await fileDigest(program) === programSha, 'CLI_HOST_EVIDENCE_INVALID', 'The bundled Codex changed after it was built.');
      const outputs = {} as Record<keyof typeof SETUP_FILES, string>;
      for (const role of Object.keys(SETUP_FILES) as (keyof typeof SETUP_FILES)[]) {
        const name = evidence!.files![role];
        check(typeof name === 'string' && /^evidence\/[a-z.-]+\.txt$/.test(name) && typeof manifest.files![name]?.sha256 === 'string', 'CLI_HOST_EVIDENCE_INVALID', 'The bundled Codex setup is incomplete.');
        const bytes = await readFile(join(bundle, ...(name as string).split('/')));
        check(sha256Of(bytes) === manifest.files![name as string]!.sha256, 'CLI_HOST_EVIDENCE_INVALID', 'The bundled Codex setup changed after it was built.');
        outputs[role] = bytes.toString('utf8');
      }
      const base = this.#trustFolder() ?? await mkdtemp(join(tmpdir(), 'chausar-codex-trust-'));
      const folder = join(base, `bundled-${(programSha as string).slice(0, 16)}`);
      await rm(folder, { recursive: true, force: true });
      const written = await writeSetup(folder, { executable: { path: program, sha256: programSha as string, version: manifest.version as string }, outputs, recordedAt: evidence!.recordedAt as string });
      this.#use(await loadSetup(written.manifest, written.sha256, this.#base), 'bundled');
      this.#sha256 = programSha as string;
      return true;
    } catch { return false; }
  }

  /** The host profile in use, or null. */
  profile(): CodexHostProfile | null { return (this.#gateway?.codexCli as CodexHostProfile | undefined) ?? null; }
  /** Where the setup in use came from. */
  origin(): CodexOrigin | null { return this.#origin; }
  /** The trusted process port: the setup's own (it checks the program again before each call), else the plain one. */
  readonly process = (request: ProcessRequest): Promise<ProcessResult> => (this.#gateway?.process ?? defaultProcess)(request);

  /** The setup in use as the owner reads it, or null when there is none. */
  current(): CodexSetupView | null {
    if (!this.#origin || !this.#version) return null;
    const line = this.#origin === 'bundled' ? SETUP_WORDS.bundled(this.#version) : this.#origin === 'owner' ? SETUP_WORDS.owner(this.#version) : SETUP_WORDS.operator(this.#version);
    return { state: 'trusted', origin: this.#origin, path: this.#path ? shown(this.#path) : null, version: this.#version, sha256: this.#sha256, line };
  }

  /**
   * The setup in use, else a review of the Codex found at `found`: its program's digest and version, and whether its help
   * and features have what Chausar needs (the same loader on a review copy). Nothing is kept until the owner says yes.
   */
  async review(found: string | null): Promise<CodexSetupView> {
    const current = this.current();
    if (current) return current;
    if (!found) return { state: 'none', origin: null, path: null, version: null, sha256: null, line: SETUP_WORDS.none };
    const refused = (line: string, version: string | null = null, sha256: string | null = null): CodexSetupView => ({ state: 'refused', origin: null, path: shown(found), version, sha256, line });
    const program = await nativeCodexOf(found, this.#options.platform, this.#options.architecture, this.#options.locate ?? locateOnThisComputer);
    if (!program) return refused(SETUP_WORDS.notProgram);
    let key: string;
    try { const info = await stat(program); key = `${program}|${info.size}|${info.mtimeMs}`; } catch { return refused(SETUP_WORDS.notProgram); }
    const kept = this.#looked.get(found);
    if (kept?.key === key) return structuredClone(kept.view);
    const view = await this.#reviewProgram(found, program);
    this.#looked.set(found, { key, view });
    return structuredClone(view);
  }

  async #reviewProgram(found: string, program: string): Promise<CodexSetupView> {
    const refused = (line: string, version: string | null = null, sha256: string | null = null): CodexSetupView => ({ state: 'refused', origin: null, path: shown(found), version, sha256, line });
    let sha256: string;
    try { sha256 = await fileDigest(program); } catch { return refused(SETUP_WORDS.notProgram); }
    const probe = this.#options.probe ?? defaultCodexProbe;
    const cwd = await mkdtemp(join(tmpdir(), 'chausar-codex-review-'));
    const outputs = {} as Record<keyof typeof SETUP_FILES, string>;
    try {
      for (const role of Object.keys(SETUP_FILES) as (keyof typeof SETUP_FILES)[]) {
        const answer = await probe(program, SETUP_ARGS[role], cwd);
        if (answer.exitCode !== 0 || !answer.stdout.trim()) return role === 'versionOutput' ? refused(SETUP_WORDS.noAnswer, null, sha256) : refused(SETUP_WORDS.lacking(null), null, sha256);
        outputs[role] = answer.stdout;
      }
    } finally { await rm(cwd, { recursive: true, force: true }).catch(() => undefined); }
    const version = /^codex-cli (\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?)\s*$/.exec(outputs.versionOutput.trim())?.[1] ?? null;
    if (!version) return refused(SETUP_WORDS.noAnswer, null, sha256);
    const evidence: Evidence = { executable: { path: program, sha256, version }, outputs, recordedAt: this.#now() };
    const folder = await mkdtemp(join(tmpdir(), 'chausar-codex-review-copy-'));
    try {
      const written = await writeSetup(folder, evidence);
      await loadSetup(written.manifest, written.sha256, this.#base);
    } catch {
      await rm(folder, { recursive: true, force: true }).catch(() => undefined);
      return refused(SETUP_WORDS.lacking(version), version, sha256);
    }
    const earlier = this.#reviews.get(sha256);
    if (earlier) await rm(earlier.folder, { recursive: true, force: true }).catch(() => undefined);
    this.#reviews.set(sha256, { folder, evidence });
    return { state: 'review', origin: null, path: shown(found), version, sha256, line: SETUP_WORDS.review(version) };
  }

  /** venture.ai.setup.trust: the owner said yes to the Codex reviewed with this exact digest. */
  async record(sha256: unknown): Promise<CodexSetupView> {
    check(typeof sha256 === 'string' && /^[a-f0-9]{64}$/.test(sha256), 'INVALID_VENTURE_REQUEST', 'Choose the Codex Chausar showed you.');
    const review = this.#reviews.get(sha256);
    check(review, 'CODEX_SETUP_CHANGED', SETUP_WORDS.changed);
    const folder = this.#trustFolder();
    check(folder, 'CODEX_SETUP_UNAVAILABLE', SETUP_WORDS.noFolder);
    // The program must still be the one the owner was shown.
    let now: string;
    try { now = await fileDigest(review.evidence.executable.path); } catch { now = ''; }
    check(now === sha256, 'CODEX_SETUP_CHANGED', SETUP_WORDS.changed);
    const target = join(folder, `owner-${sha256.slice(0, 16)}`);
    await rm(target, { recursive: true, force: true });
    const written = await writeSetup(target, { ...review.evidence, recordedAt: this.#now() });
    const gateway = await loadSetup(written.manifest, written.sha256, this.#base);
    await writeFile(join(folder, 'trusted.json'), JSON.stringify({ manifest: relative(folder, written.manifest).split(sep).join('/'), sha256: written.sha256, programSha256: sha256, at: this.#now() }, null, 2) + '\n');
    this.#use(gateway, 'owner');
    this.#sha256 = sha256;
    await rm(review.folder, { recursive: true, force: true }).catch(() => undefined);
    this.#reviews.delete(sha256);
    this.#looked.clear();
    return this.current()!;
  }
}

/** A Codex trust source handed to the venture options: a live profile, read at each use. */
export function isCodexTrust(value: unknown): value is CodexTrust {
  return value instanceof CodexTrust;
}

/** Thrown words for a host without a trust object (a test engine, the hosted app). */
export const NO_TRUST = () => new ChausarError('CODEX_SETUP_UNAVAILABLE', SETUP_WORDS.noFolder);
