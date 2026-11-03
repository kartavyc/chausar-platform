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
// A2 review: only the reviewed Codex versions are accepted (REVIEWED_CODEX_VERSIONS); on the desktop the owner's choice
// is sealed with a key Electron's safeStorage keeps, so a file written into the trust folder by anything else is not
// taken; each choice is kept in a sealed decision journal; a program that changes while Chausar runs drops the setup and
// asks for a new review; agent jobs get the program only after its digest is checked again.
import { spawn } from 'node:child_process';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream, rmSync } from 'node:fs';
import { appendFile, lstat, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { ChausarError, check } from './contracts.ts';
import { defaultProcess, type GatewayOptions, type ProcessRequest, type ProcessResult } from './gateway.ts';
import { loadCodexCliHostGateway } from './codex-cli-host.ts';
import { CODEX_CLI_CONFIG, CODEX_QUIET_ARGS, type CodexCliCapabilityProfile } from './providers/codex-cli.ts';
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
/** A2 review: the desktop's sealed key store (Electron safeStorage, through the worker's credential port). */
export type CodexSeal = { get(workspaceId: string, name: string): Promise<string | null>; set(workspaceId: string, name: string, value: string): Promise<void> };
export const SEAL_SCOPE = Object.freeze({ workspaceId: 'chausar-host', name: 'trust:codex-seal' });

/**
 * The ordinary configuration keys Chausar's Codex route sends, as reviewed against the official reference: the same
 * list the operator manifests name, kept with the setup Chausar records (re-run live on Codex 0.166.0, 3 Nov 2026).
 */
export const CODEX_CONFIG_REVIEW = Object.freeze({
  source: 'https://developers.openai.com/codex/config-reference',
  reviewedAt: '2026-11-03T00:00:00.000Z',
  keys: Object.freeze(CODEX_CLI_CONFIG.map(value => value.split('=')[0]).filter(key => !key.startsWith('features.'))),
});
/** A2 review: the Codex versions that review (CODEX_CONFIG_REVIEW and the agent driver's protocol pin) covers. */
export const REVIEWED_CODEX_VERSIONS: readonly string[] = Object.freeze(['0.166.0']);
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
const REVIEWED = REVIEWED_CODEX_VERSIONS.join(' or ');

export const SETUP_WORDS = Object.freeze({
  none: "Codex isn't on this computer.",
  bundled: (version: string) => `Uses the Codex ${version} that comes with Chausar.`,
  owner: (version: string) => `Uses your Codex ${version}, which you chose.`,
  operator: (version: string) => `Uses the Codex ${version} this computer's setup names.`,
  review: (version: string) => `Codex ${version} is on this computer and has what Chausar needs. Use it?`,
  notProgram: (bundle: boolean) => (bundle
    ? 'This Codex is in a form Chausar does not start. Use the Codex that comes with Chausar.'
    : 'This Codex is in a form Chausar does not start. Install Codex with its own installer, then check again.'),
  otherVersion: (version: string, bundle: boolean) => `This is Codex ${version}. Chausar works with Codex ${REVIEWED}. ${bundle ? 'Update it, or use the Codex that comes with Chausar.' : 'Update it, then check again.'}`,
  lacking: (version: string | null) => `${version ? `Codex ${version}` : 'This Codex'} lacks a setting Chausar needs. Update it, then check again.`,
  noAnswer: 'This Codex did not answer its version check. Update or reinstall it, then check again.',
  noFolder: "Chausar can't keep a chosen Codex here.",
  noSetup: 'Choose the Codex Chausar found under Connect your AI first.',
  changed: 'That Codex changed since you looked at it. Check it again.',
  // A2 second review: the seal key could not be read; a new one was made, and the owner looks again before choosing.
  resealed: 'Chausar could not read the lock on your Codex choice and made a new one. Check the Codex again.',
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

/** The sealed fields of the owner's choice, in a fixed order. */
const sealText = (pin: { manifest: string; sha256: string; programSha256: string; at: string }) => JSON.stringify([pin.manifest, pin.sha256, pin.programSha256, pin.at]);
const macOf = (key: string, text: string) => createHmac('sha256', Buffer.from(key, 'hex')).update(text).digest('hex');
/** One line of the decision journal, without its seal, in a fixed order. */
export type CodexDecision = { at: string; decision: 'chose' | 'dropped'; by: 'owner'; sha256: string | null; version: string | null; path: string | null };
const DECISIONS_FILE = 'decisions.jsonl';
/** A2 second review: a journal line's seal covers the line before it (its seal, '' for the first), so lines chain. */
const chainText = (previous: string, entry: CodexDecision) => JSON.stringify([previous, entry.at, entry.decision, entry.by, entry.sha256, entry.version, entry.path]);
function decisionOf(value: unknown): CodexDecision | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const text = (field: unknown) => (field === null || typeof field === 'string' ? field : undefined);
  if (typeof v.at !== 'string' || (v.decision !== 'chose' && v.decision !== 'dropped') || v.by !== 'owner') return null;
  const sha256 = text(v.sha256), version = text(v.version), path = text(v.path);
  if (sha256 === undefined || version === undefined || path === undefined) return null;
  return { at: v.at, decision: v.decision, by: 'owner', sha256, version, path };
}
function sameMac(a: unknown, b: string): boolean {
  if (typeof a !== 'string' || !/^[a-f0-9]{64}$/.test(a)) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

/** Temp folders a trust made (review copies, a bundled setup without a trust folder), removed when the process exits. */
const TEMP_FOLDERS = new Set<string>();
let exitHooked = false;
function keepTemp(folder: string): string {
  TEMP_FOLDERS.add(folder);
  if (!exitHooked) {
    exitHooked = true;
    process.once('exit', () => { for (const path of TEMP_FOLDERS) { try { rmSync(path, { recursive: true, force: true }); } catch { /* best effort */ } } });
  }
  return folder;
}
async function dropTemp(folder: string): Promise<void> {
  TEMP_FOLDERS.delete(folder);
  await rm(folder, { recursive: true, force: true }).catch(() => undefined);
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
  /**
   * A2 review: the desktop's sealed key store. Absent (a test, the local web server), or answering CREDENTIAL_NO_STORE
   * (this computer has no safeStorage or keyring at all), the file is unsealed; any other failure refuses the file.
   */
  seal?: CodexSeal;
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
  #reviews = new Map<string, { folder: string; evidence: Evidence; found: string }>();
  /** The last review of a found path, kept while the program's size and time stay the same. */
  #looked = new Map<string, { key: string; view: CodexSetupView }>();
  /** Reviews under way, by found path, so a poll joins the one already running. */
  #inflight = new Map<string, Promise<CodexSetupView>>();
  /** A2 second review: journal lines are written one at a time, each chained to the one before. */
  #journalQueue: Promise<void> = Promise.resolve();

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
  /** The bundled Codex's program, when this install carries one. */
  #bundleProgram(): string | null {
    const bundle = this.#env.CHAUSAR_CODEX_BUNDLE_DIR;
    return typeof bundle === 'string' && isAbsolute(bundle) ? join(bundle, 'bin', (this.#options.platform ?? process.platform) === 'win32' ? 'codex.exe' : 'codex') : null;
  }
  async #hasBundle(): Promise<boolean> {
    const program = this.#bundleProgram();
    if (!program) return false;
    try { return (await lstat(program)).isFile(); } catch { return false; }
  }

  /**
   * The seal key, made on first use; null where there is no sealed store (the file then stays unsealed). A2 second review:
   * only the store's own CREDENTIAL_NO_STORE means that. A failed, timed-out or unanswered store throws, so a file
   * written into the trust folder cannot be taken by breaking the store.
   */
  async #sealKey(create: boolean): Promise<string | null> {
    const seal = this.#options.seal;
    if (!seal) return null;
    let key: string | null;
    try { key = await seal.get(SEAL_SCOPE.workspaceId, SEAL_SCOPE.name); }
    catch (error) {
      // This computer has no protected store at all: keep the unsealed behaviour (noted in the A2 notes).
      if ((error as { code?: unknown })?.code === 'CREDENTIAL_NO_STORE') return null;
      throw error;
    }
    if (key && /^[a-f0-9]{64}$/.test(key)) return key;
    if (!create) return '';
    key = randomBytes(32).toString('hex');
    await seal.set(SEAL_SCOPE.workspaceId, SEAL_SCOPE.name, key);
    return key;
  }

  /**
   * A2 review: one sealed line per choice, appended to the trust folder's decision journal. A2 second review: each
   * line's seal covers the seal of the line before it, so a removed, edited or reordered line breaks the chain.
   */
  #journal(decision: 'chose' | 'dropped', fields: { sha256: string | null; version: string | null; path: string | null }): Promise<void> {
    const entry: CodexDecision = { at: this.#now(), decision, by: 'owner', sha256: fields.sha256, version: fields.version, path: fields.path };
    const work = this.#journalQueue.then(async () => {
      const folder = this.#trustFolder();
      if (!folder) return;
      const key = await this.#sealKey(decision === 'chose');
      const file = join(folder, DECISIONS_FILE);
      let previous = '';
      if (key) {
        const last = (await readFile(file, 'utf8').catch(() => '')).trim().split('\n').at(-1) ?? '';
        try { const mac = (JSON.parse(last) as { mac?: unknown }).mac; previous = typeof mac === 'string' ? mac : ''; } catch { previous = ''; }
      }
      const line = JSON.stringify({ ...entry, ...(key ? { mac: macOf(key, chainText(previous, entry)) } : {}) });
      await mkdir(folder, { recursive: true });
      await appendFile(file, line + '\n');
    }).catch(() => { /* the journal never blocks the choice itself */ });
    this.#journalQueue = work;
    return work;
  }

  /**
   * A2 second review: the decision journal as read back, with whether its chain holds: every line sealed over the one
   * before it with this computer's key. Where there is no sealed store the lines carry no seal and nothing can be checked.
   */
  async decisions(): Promise<{ entries: CodexDecision[]; intact: boolean }> {
    await this.#journalQueue;
    const folder = this.#trustFolder();
    if (!folder) return { entries: [], intact: true };
    let text: string;
    try { text = await readFile(join(folder, DECISIONS_FILE), 'utf8'); } catch { return { entries: [], intact: true }; }
    const lines = text.split('\n').filter(line => line.trim());
    let key: string | null;
    try { key = await this.#sealKey(false); } catch { key = ''; }
    const entries: CodexDecision[] = [];
    let intact = true, previous = '';
    for (const line of lines) {
      let parsed: unknown;
      try { parsed = JSON.parse(line); } catch { intact = false; continue; }
      const entry = decisionOf(parsed);
      if (!entry) { intact = false; continue; }
      entries.push(entry);
      const mac = (parsed as { mac?: unknown }).mac;
      if (key === null) { if (mac !== undefined) intact = false; continue; }
      if (!key || !sameMac(mac, macOf(key, chainText(previous, entry)))) intact = false;
      previous = typeof mac === 'string' ? mac : '';
    }
    return { entries, intact };
  }

  /** The setup in use: the operator's, else the owner's choice, else the bundled Codex. Any failure leaves none. */
  async load(): Promise<void> {
    if (this.#options.operator?.codexCli) {
      this.#use(this.#options.operator, 'operator');
      // The program digest the operator's pinned manifest names, for the agent route's own check.
      try {
        const manifest = JSON.parse(await readFile(String(this.#env.CHAUSAR_CODEX_CLI_EVIDENCE_FILE), 'utf8')) as { executable?: { sha256?: unknown } };
        this.#sha256 = typeof manifest.executable?.sha256 === 'string' ? manifest.executable.sha256 : null;
      } catch { this.#sha256 = null; }
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

  /** A2 review: the setup in use stopped matching its program: nothing runs it until the owner reviews it again. */
  #drop(): void {
    const was = { sha256: this.#sha256, version: this.#version, path: this.#path };
    const owner = this.#origin === 'owner';
    this.#gateway = undefined; this.#origin = null; this.#version = null; this.#path = null; this.#sha256 = null;
    this.#looked.clear();
    if (owner) void this.#journal('dropped', was);
  }

  async #loadOwner(): Promise<boolean> {
    const folder = this.#trustFolder();
    if (!folder) return false;
    try {
      const pin = JSON.parse(await readFile(join(folder, 'trusted.json'), 'utf8')) as { manifest?: unknown; sha256?: unknown; programSha256?: unknown; at?: unknown; mac?: unknown };
      check(typeof pin.manifest === 'string' && typeof pin.sha256 === 'string' && typeof pin.programSha256 === 'string' && typeof pin.at === 'string', 'CLI_HOST_EVIDENCE_INVALID', 'The kept Codex choice is unreadable.');
      // A2 review: on the desktop the choice is sealed; an unsealed or changed file is not taken, and the owner reviews again.
      const key = await this.#sealKey(false);
      if (key !== null) check(key !== '' && sameMac(pin.mac, macOf(key, sealText(pin as { manifest: string; sha256: string; programSha256: string; at: string }))), 'CLI_HOST_EVIDENCE_INVALID', 'The kept Codex choice is not sealed by this computer.');
      const manifest = join(folder, pin.manifest as string);
      check(dirname(dirname(manifest)) === folder, 'CLI_HOST_EVIDENCE_INVALID', 'The kept Codex choice points outside its folder.');
      const gateway = await loadSetup(manifest, pin.sha256 as string, this.#base);
      const evidence = gateway.codexCli!.capabilities.evidence;
      check(evidence.kind === 'installed-help' && REVIEWED_CODEX_VERSIONS.includes(evidence.version), 'CLI_HOST_EVIDENCE_INVALID', 'The kept Codex is not a reviewed version.');
      this.#use(gateway, 'owner');
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
      check(typeof manifest.version === 'string' && REVIEWED_CODEX_VERSIONS.includes(manifest.version) && typeof manifest.entrypoint === 'string' && manifest.files && evidence && typeof evidence.recordedAt === 'string' && evidence.files,
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
      const base = this.#trustFolder() ?? keepTemp(await mkdtemp(join(tmpdir(), 'chausar-codex-trust-')));
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
  /**
   * The trusted process port: the setup's own (it checks the program again before each call), else the plain one.
   * A2 review: a program that changed while Chausar runs drops the setup and says so, so the owner can review it again.
   */
  readonly process = async (request: ProcessRequest): Promise<ProcessResult> => {
    const gateway = this.#gateway;
    try { return await (gateway?.process ?? defaultProcess)(request); }
    catch (error) {
      if (gateway && gateway === this.#gateway && (error as { code?: unknown })?.code === 'CLI_HOST_EVIDENCE_INVALID') {
        this.#drop();
        throw new ChausarError('CODEX_SETUP_CHANGED', SETUP_WORDS.changed);
      }
      throw error;
    }
  };

  /**
   * A2 review: the native program of the setup in use, for an agent job, only after its digest is checked again against
   * the setup. No setup in use, or a changed program, refuses: there is no search-path fallback.
   */
  async verifiedProgram(): Promise<string> {
    const path = this.#path, expected = this.#sha256;
    check(this.#gateway && path, 'CODEX_SETUP_UNAVAILABLE', SETUP_WORDS.noSetup);
    let now = '';
    try { now = await fileDigest(path); } catch { now = ''; }
    if (!expected || now !== expected) {
      this.#drop();
      throw new ChausarError('CODEX_SETUP_CHANGED', SETUP_WORDS.changed);
    }
    return path;
  }

  /** The setup in use as the owner reads it, or null when there is none. */
  current(): CodexSetupView | null {
    if (!this.#origin || !this.#version) return null;
    const line = this.#origin === 'bundled' ? SETUP_WORDS.bundled(this.#version) : this.#origin === 'owner' ? SETUP_WORDS.owner(this.#version) : SETUP_WORDS.operator(this.#version);
    return { state: 'trusted', origin: this.#origin, path: this.#path ? shown(this.#path) : null, version: this.#version, sha256: this.#sha256, line };
  }

  /**
   * The setup in use, else a review of the Codex found at `found`: its program's digest and version, and whether its help
   * and features have what Chausar needs (the same loader on a review copy). Nothing is kept until the owner says yes.
   * A Codex of a version Chausar has not reviewed is refused; when this install has its own Codex, that one is offered.
   */
  async review(found: string | null): Promise<CodexSetupView> {
    const current = this.current();
    if (current) return current;
    if (!found) return { state: 'none', origin: null, path: null, version: null, sha256: null, line: SETUP_WORDS.none };
    const running = this.#inflight.get(found);
    if (running) return structuredClone(await running);
    const work = this.#reviewFound(found).finally(() => { this.#inflight.delete(found); });
    this.#inflight.set(found, work);
    return structuredClone(await work);
  }

  async #reviewFound(found: string): Promise<CodexSetupView> {
    const bundle = await this.#hasBundle();
    const program = await nativeCodexOf(found, this.#options.platform, this.#options.architecture, this.#options.locate ?? locateOnThisComputer);
    if (!program) return this.#offerBundle(found, { state: 'refused', origin: null, path: shown(found), version: null, sha256: null, line: SETUP_WORDS.notProgram(bundle) });
    let key: string;
    try { const info = await stat(program); key = `${program}|${info.size}|${info.mtimeMs}`; }
    catch { return { state: 'refused', origin: null, path: shown(found), version: null, sha256: null, line: SETUP_WORDS.notProgram(bundle) }; }
    const kept = this.#looked.get(found);
    if (kept?.key === key) return kept.view;
    const view = await this.#offerBundle(found, await this.#reviewProgram(found, program, bundle));
    this.#looked.set(found, { key, view });
    return view;
  }

  /** A found Codex that cannot be used, while this install has its own: the owner is offered the bundled one instead. */
  async #offerBundle(found: string, view: CodexSetupView): Promise<CodexSetupView> {
    const bundled = this.#bundleProgram();
    if (view.state !== 'refused' || !bundled || !(await this.#hasBundle()) || found === bundled) return view;
    const offered = await this.#reviewProgram(bundled, bundled, true);
    return offered.state === 'review' ? offered : view;
  }

  async #reviewProgram(found: string, program: string, bundle: boolean): Promise<CodexSetupView> {
    // A2 review: the path shown is the program that is hashed and run (codex.exe), not the shim that found it.
    const refused = (line: string, version: string | null = null, sha256: string | null = null): CodexSetupView => ({ state: 'refused', origin: null, path: shown(program), version, sha256, line });
    let sha256: string;
    try { sha256 = await fileDigest(program); } catch { return refused(SETUP_WORDS.notProgram(bundle)); }
    const probe = this.#options.probe ?? defaultCodexProbe;
    const outputs = {} as Record<keyof typeof SETUP_FILES, string>;
    let version: string | null = null;
    const cwd = await mkdtemp(join(tmpdir(), 'chausar-codex-review-'));
    try {
      for (const role of Object.keys(SETUP_FILES) as (keyof typeof SETUP_FILES)[]) {
        const answer = await probe(program, [...CODEX_QUIET_ARGS, ...SETUP_ARGS[role]], cwd);
        if (answer.exitCode !== 0 || !answer.stdout.trim()) return role === 'versionOutput' ? refused(SETUP_WORDS.noAnswer, null, sha256) : refused(SETUP_WORDS.lacking(null), null, sha256);
        outputs[role] = answer.stdout;
        // A2 review: only a reviewed version goes on to the rest of the checks.
        if (role === 'versionOutput') {
          version = /^codex-cli (\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?)\s*$/.exec(answer.stdout.trim())?.[1] ?? null;
          if (!version) return refused(SETUP_WORDS.noAnswer, null, sha256);
          if (!REVIEWED_CODEX_VERSIONS.includes(version)) return refused(SETUP_WORDS.otherVersion(version, bundle), version, sha256);
        }
      }
    } finally { await rm(cwd, { recursive: true, force: true }).catch(() => undefined); }
    if (!version) return refused(SETUP_WORDS.noAnswer, null, sha256);
    const evidence: Evidence = { executable: { path: program, sha256, version }, outputs, recordedAt: this.#now() };
    const folder = keepTemp(await mkdtemp(join(tmpdir(), 'chausar-codex-review-copy-')));
    try {
      const written = await writeSetup(folder, evidence);
      await loadSetup(written.manifest, written.sha256, this.#base);
    } catch {
      await dropTemp(folder);
      return refused(SETUP_WORDS.lacking(version), version, sha256);
    }
    const earlier = this.#reviews.get(sha256);
    if (earlier) await dropTemp(earlier.folder);
    this.#reviews.set(sha256, { folder, evidence, found });
    return { state: 'review', origin: null, path: shown(program), version, sha256, line: SETUP_WORDS.review(version) };
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
    if (now !== sha256) {
      await dropTemp(review.folder);
      this.#reviews.delete(sha256);
      this.#looked.clear();
      throw new ChausarError('CODEX_SETUP_CHANGED', SETUP_WORDS.changed);
    }
    // A2 second review: a seal key that cannot be read (CREDENTIAL_INVALID) is replaced, and the owner looks again; a
    // store that fails any other way refuses the choice.
    let key: string | null;
    try { key = await this.#sealKey(true); }
    catch (error) {
      if ((error as { code?: unknown })?.code !== 'CREDENTIAL_INVALID' || !this.#options.seal) throw error;
      await this.#options.seal.set(SEAL_SCOPE.workspaceId, SEAL_SCOPE.name, randomBytes(32).toString('hex'));
      await dropTemp(review.folder);
      this.#reviews.delete(sha256);
      this.#looked.clear();
      throw new ChausarError('CODEX_SETUP_CHANGED', SETUP_WORDS.resealed);
    }
    const target = join(folder, `owner-${sha256.slice(0, 16)}`);
    await rm(target, { recursive: true, force: true });
    const written = await writeSetup(target, { ...review.evidence, recordedAt: this.#now() });
    const gateway = await loadSetup(written.manifest, written.sha256, this.#base);
    const pin = { manifest: relative(folder, written.manifest).split(sep).join('/'), sha256: written.sha256, programSha256: sha256, at: this.#now() };
    await writeFile(join(folder, 'trusted.json'), JSON.stringify({ ...pin, ...(key ? { mac: macOf(key, sealText(pin)) } : {}) }, null, 2) + '\n');
    this.#use(gateway, 'owner');
    this.#sha256 = sha256;
    await this.#journal('chose', { sha256, version: review.evidence.executable.version, path: review.evidence.executable.path });
    await dropTemp(review.folder);
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
