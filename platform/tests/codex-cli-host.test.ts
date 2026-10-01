import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { loadCodexCliHostGateway } from '../runtime/codex-cli-host.ts';
import type { CodexCliHostDependencies, CodexCliHostManifest } from '../runtime/codex-cli-host.ts';
import { createServerEngine } from '../runtime/server.ts';
import { CODEX_CLI_CONFIG, CODEX_CLI_FLAGS } from '../runtime/providers/codex-cli.ts';
import type { GatewayOptions, ProcessRequest, ProcessResult } from '../runtime/gateway.ts';

// Every manifest, executable digest, CLI snapshot, model and process result here
// is synthetic. Injected ports never read or execute an installed Codex binary.
const syntheticVersion = '0.999.0';
const syntheticExecutable = resolve('synthetic-native-codex', 'codex.exe');
const syntheticExecutableDigest = 'a'.repeat(64);
const ordinaryKeys = CODEX_CLI_CONFIG.map(value => value.split('=')[0]).filter(key => !key.startsWith('features.'));
const featureKeys = CODEX_CLI_CONFIG.map(value => value.split('=')[0]).filter(key => key.startsWith('features.'));
const help = [
  'Run Codex non-interactively', 'Usage: codex exec [OPTIONS] [PROMPT]', '',
  'Arguments:', '  [PROMPT]',
  "          Initial instructions for the agent. If not specified as an argument (or if '-' is used), instructions are read from stdin",
  '', 'Options:',
  ...CODEX_CLI_FLAGS.filter(flag => flag !== '--sandbox').map(flag => `      ${flag}${flag === '--config' ? ' <key=value>' : ''}`),
  '  -s, --sandbox <SANDBOX_MODE>', '          Select the sandbox policy',
  '          [possible values: read-only, workspace-write, danger-full-access]', '',
].join('\r\n');
const features = featureKeys.map(key => `${key.slice('features.'.length)}\tstable\ttrue`).join('\r\n') + '\r\n';
const completed: ProcessResult = {
  exitCode: 0,
  stdout: [
    { type: 'item.completed', item: { type: 'agent_message', text: '{"operation":"earned"}' } },
    { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } },
  ].map(value => JSON.stringify(value)).join('\n'),
};
type ArtifactRole = 'versionOutput' | 'execHelp' | 'features';
function sha256(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
function code(expected: string) { return (error: unknown) => error instanceof Error && (error as Error & { code?: string }).code === expected; }
async function removeSyntheticDirectory(directory: string): Promise<void> {
  const target = resolve(directory); const child = relative(resolve(tmpdir()), target);
  assert.ok(child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child));
  assert.ok(basename(target).startsWith('chausar-synthetic-'));
  await rm(target, { recursive: true, force: true });
}

function syntheticEvidence(gateway?: Omit<GatewayOptions, 'codexCli'>, manifestPath = resolve('synthetic-host-evidence', 'codex-cli-host.json')) {
  const files = new Map<string, Uint8Array>();
  const artifactReads: string[] = [];
  const binaryChecks: string[] = [];
  let binaryDigest = syntheticExecutableDigest;
  const artifact = (file: string, content: string) => {
    const bytes = Buffer.from(content);
    files.set(resolve(dirname(manifestPath), file), bytes);
    return { file, sha256: sha256(bytes), executableSha256: syntheticExecutableDigest, version: syntheticVersion, exitCode: 0 as const };
  };
  const manifest: CodexCliHostManifest = {
    schemaVersion: 1, recordedAt: '2026-10-01T00:00:00.000Z',
    executable: { path: syntheticExecutable, sha256: syntheticExecutableDigest, version: syntheticVersion },
    versionOutput: artifact('version.stdout.txt', `codex-cli ${syntheticVersion}\r\n`),
    execHelp: artifact('exec-help.stdout.txt', help),
    features: artifact('features.stdout.txt', features),
    configReview: { source: 'https://developers.openai.com/codex/config-reference', reviewedAt: '2026-10-01T00:00:00.000Z', keys: [...ordinaryKeys] },
  };
  const environment: NodeJS.ProcessEnv = { CHAUSAR_CODEX_CLI_EVIDENCE_FILE: manifestPath };
  function pinManifest(bytes = Buffer.from(JSON.stringify(manifest))) {
    files.set(manifestPath, bytes); environment.CHAUSAR_CODEX_CLI_EVIDENCE_SHA256 = sha256(bytes);
  }
  function repinArtifact(role: ArtifactRole, content: string | Uint8Array) {
    const bytes = typeof content === 'string' ? Buffer.from(content) : content;
    files.set(resolve(dirname(manifestPath), manifest[role].file), bytes);
    manifest[role].sha256 = sha256(bytes); pinManifest();
  }
  pinManifest();
  const dependencies: CodexCliHostDependencies = {
    gateway,
    readArtifact: async (path, maximumBytes) => {
      artifactReads.push(path); assert.equal(maximumBytes, 262144);
      const bytes = files.get(path);
      if (!bytes) throw Object.assign(new Error('Synthetic missing artifact'), { code: 'ENOENT' });
      return Uint8Array.from(bytes);
    },
    executableSha256: async (path, maximumBytes) => {
      binaryChecks.push(path); assert.equal(maximumBytes, 512 * 1024 * 1024);
      assert.equal(path, syntheticExecutable); return binaryDigest;
    },
  };
  return { manifest, manifestPath, environment, dependencies, files, artifactReads, binaryChecks, pinManifest, repinArtifact,
    setBinaryDigest(value: string) { binaryDigest = value; } };
}

test('synthetic missing host configuration performs no filesystem or binary checks', async () => {
  const f = syntheticEvidence();
  assert.equal(await loadCodexCliHostGateway({}, f.dependencies), undefined);
  assert.deepEqual(f.artifactReads, []); assert.deepEqual(f.binaryChecks, []);
  const processPort: NonNullable<GatewayOptions['process']> = async () => completed;
  const gateway = { process: processPort };
  assert.equal(await loadCodexCliHostGateway({}, { ...f.dependencies, gateway }), gateway);
});

for (const [label, environment] of [
  ['missing digest', { CHAUSAR_CODEX_CLI_EVIDENCE_FILE: resolve('synthetic-host-evidence', 'codex-cli-host.json') }],
  ['missing path', { CHAUSAR_CODEX_CLI_EVIDENCE_SHA256: 'b'.repeat(64) }],
  ['relative path', { CHAUSAR_CODEX_CLI_EVIDENCE_FILE: 'codex-cli-host.json', CHAUSAR_CODEX_CLI_EVIDENCE_SHA256: 'b'.repeat(64) }],
  ['wrong manifest role', { CHAUSAR_CODEX_CLI_EVIDENCE_FILE: resolve('synthetic-host-evidence', 'auth.json'), CHAUSAR_CODEX_CLI_EVIDENCE_SHA256: 'b'.repeat(64) }],
  ['malformed digest', { CHAUSAR_CODEX_CLI_EVIDENCE_FILE: resolve('synthetic-host-evidence', 'codex-cli-host.json'), CHAUSAR_CODEX_CLI_EVIDENCE_SHA256: 'unreviewed' }],
] as const) {
  test(`synthetic ${label} refuses before any file read`, async () => {
    const f = syntheticEvidence();
    await assert.rejects(loadCodexCliHostGateway(environment, f.dependencies), code('CLI_HOST_EVIDENCE_INVALID'));
    assert.deepEqual(f.artifactReads, []); assert.deepEqual(f.binaryChecks, []);
  });
}

test('synthetic pinned snapshots construct exact installed-help interface evidence without entitlement claims', async () => {
  const f = syntheticEvidence(); const gateway = await loadCodexCliHostGateway(f.environment, f.dependencies);
  assert.ok(gateway?.codexCli);
  assert.equal(gateway.codexCli.mode, 'local-cli');
  assert.deepEqual(gateway.codexCli.capabilities.evidence, {
    kind: 'installed-help', executable: syntheticExecutable, version: syntheticVersion, helpDigest: f.manifest.execHelp.sha256,
  });
  assert.deepEqual(gateway.codexCli.capabilities.flags, [...CODEX_CLI_FLAGS]);
  assert.deepEqual(gateway.codexCli.capabilities.configKeys, CODEX_CLI_CONFIG.map(value => value.split('=')[0]));
  assert.equal(gateway.codexCli.capabilities.stdinPrompt, true);
  assert.ok(gateway.codexCli.capabilities.sandboxModes.includes('read-only'));
  assert.deepEqual(f.binaryChecks, [syntheticExecutable]);
  assert.equal(f.artifactReads.length, 4);
});

test('synthetic backtick-quoted stdin marker and wrapped help preserve the installed 0.159.2 format', async () => {
  const f = syntheticEvidence();
  f.repinArtifact('execHelp', help.replace(
    "          Initial instructions for the agent. If not specified as an argument (or if '-' is used), instructions are read from stdin",
    '          Initial instructions for the agent. If not provided as an argument (or if `-` is used),\r\n'
      + '          instructions are read from stdin. If stdin is piped and a prompt is also provided, stdin\r\n'
      + '          is appended as a `<stdin>` block',
  ));
  const gateway = await loadCodexCliHostGateway(f.environment, f.dependencies);
  assert.equal(gateway?.codexCli?.capabilities.stdinPrompt, true);
  assert.deepEqual(f.binaryChecks, [syntheticExecutable]);
});

test('synthetic mismatched quotes cannot admit the stdin marker', async () => {
  const f = syntheticEvidence();
  f.repinArtifact('execHelp', help.replace("'-'", "'-\""));
  await assert.rejects(loadCodexCliHostGateway(f.environment, f.dependencies), code('CLI_CAPABILITY_UNSUPPORTED'));
  assert.deepEqual(f.binaryChecks, []);
});

test('synthetic UTF-8 BOM and CRLF snapshots are pinned as raw bytes before decoding', async () => {
  const f = syntheticEvidence();
  f.repinArtifact('execHelp', `\uFEFF${help}`); f.repinArtifact('versionOutput', `\uFEFFcodex-cli ${syntheticVersion}\r\n`);
  f.pinManifest(Buffer.from(`\uFEFF${JSON.stringify(f.manifest)}\r\n`));
  const gateway = await loadCodexCliHostGateway(f.environment, f.dependencies);
  assert.equal(gateway?.codexCli?.capabilities.evidence.kind, 'installed-help');
  assert.notEqual(f.manifest.execHelp.sha256, sha256(Buffer.from(help)));
});

test('synthetic disabled feature defaults and the reviewed official redirect still describe supported interface keys', async () => {
  const f = syntheticEvidence(); f.manifest.configReview.source = 'https://learn.chatgpt.com/docs/config-file/config-reference';
  f.repinArtifact('features', features.replaceAll('\ttrue', '\tfalse'));
  const gateway = await loadCodexCliHostGateway(f.environment, f.dependencies);
  assert.deepEqual(gateway?.codexCli?.capabilities.configKeys, CODEX_CLI_CONFIG.map(value => value.split('=')[0]));
});

test('synthetic multiword feature stage remains supported without claiming account access', async () => {
  const f = syntheticEvidence(); f.repinArtifact('features', features.replace('shell_tool\tstable\ttrue', 'shell_tool\tunder development\tfalse'));
  const gateway = await loadCodexCliHostGateway(f.environment, f.dependencies);
  assert.ok(gateway?.codexCli);
  assert.ok(gateway.codexCli.capabilities.configKeys.includes('features.shell_tool'));
  assert.equal(gateway.codexCli.capabilities.evidence.kind, 'installed-help');
});

test('synthetic tampered manifest fails its raw pin before parsing or artifact reads', async () => {
  const f = syntheticEvidence(); f.files.set(f.manifestPath, Buffer.from('{tampered'));
  await assert.rejects(loadCodexCliHostGateway(f.environment, f.dependencies), code('CLI_HOST_EVIDENCE_INVALID'));
  assert.deepEqual(f.artifactReads, [f.manifestPath]); assert.deepEqual(f.binaryChecks, []);
});

for (const [label, bytes] of [
  ['malformed JSON', Buffer.from('{not-json')],
  ['oversized manifest', Buffer.alloc(262145, 32)],
  ['invalid UTF-8', Uint8Array.from([0xff, 0xfe])],
] as const) {
  test(`synthetic correctly pinned ${label} remains invalid evidence`, async () => {
    const f = syntheticEvidence(); f.pinManifest(Buffer.from(bytes));
    await assert.rejects(loadCodexCliHostGateway(f.environment, f.dependencies), code('CLI_HOST_EVIDENCE_INVALID'));
    assert.equal(f.artifactReads.length, 1); assert.equal(f.binaryChecks.length, 0);
  });
}

for (const role of ['versionOutput', 'execHelp', 'features'] as const) {
  test(`synthetic missing ${role} artifact refuses without checking the executable`, async () => {
    const f = syntheticEvidence(); f.files.delete(resolve(dirname(f.manifestPath), f.manifest[role].file));
    await assert.rejects(loadCodexCliHostGateway(f.environment, f.dependencies), code('CLI_HOST_EVIDENCE_INVALID'));
    assert.deepEqual(f.binaryChecks, []);
  });
  test(`synthetic tampered ${role} bytes refuse without accepting the declared digest`, async () => {
    const f = syntheticEvidence(); f.files.set(resolve(dirname(f.manifestPath), f.manifest[role].file), Buffer.from('synthetic tampering'));
    await assert.rejects(loadCodexCliHostGateway(f.environment, f.dependencies), code('CLI_HOST_EVIDENCE_INVALID'));
    assert.deepEqual(f.binaryChecks, []);
  });
}

for (const [label, bytes] of [
  ['oversized help snapshot', Buffer.alloc(262145, 32)],
  ['invalid UTF-8 help snapshot', Uint8Array.from([0xff, 0xfe])],
] as const) {
  test(`synthetic correctly pinned ${label} refuses before binary verification`, async () => {
    const f = syntheticEvidence(); f.repinArtifact('execHelp', bytes);
    await assert.rejects(loadCodexCliHostGateway(f.environment, f.dependencies), code('CLI_HOST_EVIDENCE_INVALID'));
    assert.deepEqual(f.binaryChecks, []);
  });
}

for (const [label, change] of [
  ['unsupported schema', (f: ReturnType<typeof syntheticEvidence>) => { (f.manifest as unknown as { schemaVersion: number }).schemaVersion = 2; }],
  ['wrapper executable', (f: ReturnType<typeof syntheticEvidence>) => { f.manifest.executable.path = resolve('synthetic-native-codex', 'codex.ps1'); }],
  ['artifact escapes directory', (f: ReturnType<typeof syntheticEvidence>) => { f.manifest.execHelp.file = '../exec-help.stdout.txt'; }],
  ['artifact secret filename', (f: ReturnType<typeof syntheticEvidence>) => { f.manifest.execHelp.file = 'auth.json'; }],
  ['artifact has another role', (f: ReturnType<typeof syntheticEvidence>) => { f.manifest.execHelp.file = 'version.stdout.txt'; }],
  ['artifact executable provenance mismatch', (f: ReturnType<typeof syntheticEvidence>) => { f.manifest.features.executableSha256 = 'b'.repeat(64); }],
  ['artifact version provenance mismatch', (f: ReturnType<typeof syntheticEvidence>) => { f.manifest.features.version = '0.998.0'; }],
  ['unsuccessful recorded probe', (f: ReturnType<typeof syntheticEvidence>) => { (f.manifest.execHelp as unknown as { exitCode: number }).exitCode = 1; }],
  ['unreviewed config source', (f: ReturnType<typeof syntheticEvidence>) => { f.manifest.configReview.source = 'https://synthetic-unreviewed.invalid/config'; }],
] as const) {
  test(`synthetic ${label} refuses pinned but invalid evidence`, async () => {
    const f = syntheticEvidence(); change(f); f.pinManifest();
    await assert.rejects(loadCodexCliHostGateway(f.environment, f.dependencies), code('CLI_HOST_EVIDENCE_INVALID'));
    assert.deepEqual(f.binaryChecks, []);
    if (label.startsWith('artifact')) assert.deepEqual(f.artifactReads, [f.manifestPath]);
  });
}

test('synthetic correctly pinned version text cannot contradict its executable version', async () => {
  const f = syntheticEvidence(); f.repinArtifact('versionOutput', 'codex-cli 0.998.0\r\n');
  await assert.rejects(loadCodexCliHostGateway(f.environment, f.dependencies), code('CLI_HOST_EVIDENCE_INVALID'));
  assert.equal(f.binaryChecks.length, 0);
});

for (const [label, content] of [
  ['required flag missing', help.replace('      --json\r\n', '')],
  ['flag appears only in prose', help.replace('      --json', 'Synthetic prose mentions --json')],
  ['stdin unsupported', help.replace('instructions are read from stdin', 'instructions are unavailable')],
  ['read-only sandbox missing', help.replace('read-only, ', '')],
] as const) {
  test(`synthetic ${label} refuses even with matching artifact hashes`, async () => {
    const f = syntheticEvidence(); f.repinArtifact('execHelp', content);
    await assert.rejects(loadCodexCliHostGateway(f.environment, f.dependencies), code('CLI_CAPABILITY_UNSUPPORTED'));
    assert.equal(f.binaryChecks.length, 0);
  });
}

for (const [label, content] of [
  ['required feature missing', features.replace('shell_tool\tstable\ttrue\r\n', '')],
  ['required feature removed', features.replace('shell_tool\tstable', 'shell_tool\tremoved')],
  ['feature appears only in prose', features.replace('shell_tool\tstable\ttrue', 'Synthetic prose mentions shell_tool stable true')],
] as const) {
  test(`synthetic ${label} refuses without importing a capability claim from generic help`, async () => {
    const f = syntheticEvidence(); f.repinArtifact('features', content);
    await assert.rejects(loadCodexCliHostGateway(f.environment, f.dependencies), code('CLI_CAPABILITY_UNSUPPORTED'));
    assert.equal(f.binaryChecks.length, 0);
  });
}

test('synthetic missing ordinary config key refuses despite generic --config support', async () => {
  const f = syntheticEvidence(); f.manifest.configReview.keys = ordinaryKeys.filter(key => key !== 'forced_login_method'); f.pinManifest();
  await assert.rejects(loadCodexCliHostGateway(f.environment, f.dependencies), code('CLI_CAPABILITY_UNSUPPORTED'));
  assert.equal(f.binaryChecks.length, 0);
});

test('synthetic startup executable digest mismatch refuses before exposing a process gateway', async () => {
  let invocations = 0; const f = syntheticEvidence({ process: async () => { invocations++; return completed; } });
  f.setBinaryDigest('b'.repeat(64));
  await assert.rejects(loadCodexCliHostGateway(f.environment, f.dependencies), code('CLI_HOST_EVIDENCE_INVALID'));
  assert.deepEqual(f.binaryChecks, [syntheticExecutable]); assert.equal(invocations, 0);
});

test('synthetic imported capability object cannot bypass the pinned host manifest', async () => {
  const f = syntheticEvidence();
  const gateway = { codexCli: { mode: 'synthetic-fixture', capabilities: {} } } as unknown as Omit<GatewayOptions, 'codexCli'>;
  await assert.rejects(loadCodexCliHostGateway(f.environment, { ...f.dependencies, gateway }), code('CLI_HOST_EVIDENCE_INVALID'));
  assert.deepEqual(f.artifactReads, []); assert.deepEqual(f.binaryChecks, []);
});

test('synthetic default artifact reader verifies temporary public snapshots with an injected binary digest', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-synthetic-host-snapshots-'));
  t.after(() => removeSyntheticDirectory(directory));
  const f = syntheticEvidence(undefined, join(directory, 'codex-cli-host.json'));
  for (const [path, bytes] of f.files) await writeFile(path, bytes);
  const gateway = await loadCodexCliHostGateway(f.environment, { executableSha256: f.dependencies.executableSha256 });
  assert.equal(gateway?.codexCli?.capabilities.evidence.kind, 'installed-help');
  assert.deepEqual(f.binaryChecks, [syntheticExecutable]);
});

test('synthetic default filesystem binary hashing detects replacement before the injected process port is invoked', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-synthetic-host-binary-'));
  t.after(() => removeSyntheticDirectory(directory));
  const binaryPath = join(directory, 'codex.exe');
  const binaryBytes = Buffer.from('Synthetic text fixture. This file is not a native executable.\r\n');
  const binaryDigest = sha256(binaryBytes);
  const f = syntheticEvidence(undefined, join(directory, 'codex-cli-host.json'));
  f.manifest.executable = { ...f.manifest.executable, path: binaryPath, sha256: binaryDigest };
  for (const role of ['versionOutput', 'execHelp', 'features'] as const) f.manifest[role].executableSha256 = binaryDigest;
  f.pinManifest(); await writeFile(binaryPath, binaryBytes);
  for (const [path, bytes] of f.files) await writeFile(path, bytes);
  let invocations = 0;
  // Only artifact reads and streaming SHA256 use their default filesystem ports.
  // A synthetic process port makes a zero-dispatch assertion explicit and prevents
  // any native execution even if binary verification regresses.
  const gateway = await loadCodexCliHostGateway(f.environment, { gateway: { process: async () => { invocations++; return completed; } } });
  assert.ok(gateway?.process); assert.equal(gateway.codexCli?.capabilities.evidence.kind, 'installed-help');
  await writeFile(binaryPath, 'Synthetic replacement bytes.\r\n');
  await assert.rejects(gateway.process({ command: binaryPath, args: [], cwd: directory, env: {}, stdin: 'synthetic prompt', timeoutMs: 10, schema: {} }), code('CLI_HOST_EVIDENCE_INVALID'));
  assert.equal(invocations, 0);
});

test('synthetic process gateway rechecks the exact binary before dispatch and preserves other trusted ports', async () => {
  const requests: ProcessRequest[] = [];
  const http: NonNullable<GatewayOptions['http']> = async request => ({ status: 200, body: '{}', endpoint: request.endpoint });
  const credentialBroker = async () => undefined;
  const f = syntheticEvidence({ http, credentialBroker, process: async request => { requests.push(request); return completed; } });
  const gateway = await loadCodexCliHostGateway(f.environment, f.dependencies); assert.ok(gateway?.process);
  assert.equal(gateway.http, http); assert.equal(gateway.credentialBroker, credentialBroker);
  const request: ProcessRequest = { command: syntheticExecutable, args: ['exec'], cwd: resolve('synthetic-work'), env: {}, stdin: 'synthetic prompt', timeoutMs: 10, schema: {} };
  assert.deepEqual(await gateway.process(request), completed); assert.equal(requests[0], request);
  assert.deepEqual(f.binaryChecks, [syntheticExecutable, syntheticExecutable]);
  f.setBinaryDigest('b'.repeat(64));
  await assert.rejects(gateway.process(request), code('CLI_HOST_EVIDENCE_INVALID')); assert.equal(requests.length, 1);
  const other = { ...request, command: 'synthetic-claude-cli' };
  assert.deepEqual(await gateway.process(other), completed); assert.equal(requests[1], other);
  assert.equal(f.binaryChecks.length, 3);
});

test('synthetic unreadable binary at dispatch becomes a host evidence refusal before any process invocation', async () => {
  let invocations = 0, checks = 0;
  const f = syntheticEvidence({ process: async () => { invocations++; return completed; } });
  const gateway = await loadCodexCliHostGateway(f.environment, { ...f.dependencies, executableSha256: async () => {
    checks++;
    if (checks === 1) return syntheticExecutableDigest;
    throw Object.assign(new Error('Synthetic deleted binary fixture'), { code: 'ENOENT' });
  } });
  assert.ok(gateway?.process);
  await assert.rejects(gateway.process({ command: syntheticExecutable, args: [], cwd: resolve('synthetic-work'), env: {}, stdin: 'synthetic prompt', timeoutMs: 10, schema: {} }), code('CLI_HOST_EVIDENCE_INVALID'));
  assert.equal(checks, 2); assert.equal(invocations, 0);
});

test('synthetic worker module import registers no IPC, lifecycle or termination listeners', async () => {
  const events = ['message', 'disconnect', 'SIGTERM'] as const;
  const counts = events.map(event => process.listenerCount(event));
  const worker = await import('../runtime/worker.ts'); assert.equal(typeof worker.createWorkerEngine, 'function');
  assert.deepEqual(events.map(event => process.listenerCount(event)), counts);
});

const entrypoints = [
  { label: 'server', create: (environment: NodeJS.ProcessEnv, dependencies: CodexCliHostDependencies, demo: boolean) => createServerEngine(environment, demo ? ['synthetic-node', 'synthetic-server', '--demo'] : ['synthetic-node', 'synthetic-server'], dependencies) },
  { label: 'worker', create: async (environment: NodeJS.ProcessEnv, dependencies: CodexCliHostDependencies, demo: boolean) => {
    const { createWorkerEngine } = await import('../runtime/worker.ts');
    return createWorkerEngine({ ...environment, CHAUSAR_DEMO: demo ? '1' : '0' }, dependencies);
  } },
];

for (const entrypoint of entrypoints) {
  test(`synthetic ${entrypoint.label} factory injects pinned profile and preserves production environment options`, async () => {
    const f = syntheticEvidence(); const environment = {
      ...f.environment, CHAUSAR_VAULT_DIRECTORY: resolve('synthetic-vault'), CHAUSAR_ENGINE_VERSION: '0.1.0-preview.1',
      CHAUSAR_POSTGRES_URL: 'postgresql://synthetic-user:synthetic-fixture-password@127.0.0.1/synthetic',
      CHAUSAR_PYTHON: 'synthetic-python', CHAUSAR_UPDATE_PUBLIC_KEY: 'synthetic-public-key',
      CHAUSAR_JOB_WORKER_ID: 'synthetic-worker', CHAUSAR_JOB_MAX_ACTIVE: '2', CHAUSAR_JOB_LEASE_MS: '45000',
    };
    const engine = await entrypoint.create(environment, f.dependencies, false);
    assert.equal(engine.options.directory, environment.CHAUSAR_VAULT_DIRECTORY); assert.equal(engine.options.demo, false);
    assert.equal(engine.options.storage, 'postgres'); assert.equal(engine.options.postgresUrl, environment.CHAUSAR_POSTGRES_URL);
    assert.equal(engine.options.pythonExecutable, 'synthetic-python'); assert.equal(engine.options.updatePublicKey, 'synthetic-public-key');
    assert.equal(engine.options.durableJobs?.workerId, 'synthetic-worker'); assert.equal(engine.options.durableJobs?.maxActiveJobs, 2);
    assert.equal(engine.options.durableJobs?.leaseMs, 45000); assert.equal(engine.options.durableJobs?.networkAvailable(), false);
    assert.equal(engine.options.gateway?.codexCli?.capabilities.evidence.kind, 'installed-help');
    assert.deepEqual(f.binaryChecks, [syntheticExecutable]); assert.equal(engine.vault, null);
    await engine.shutdown();
  });

  for (const [label, alter] of [
    ['missing evidence', (f: ReturnType<typeof syntheticEvidence>) => { delete f.environment.CHAUSAR_CODEX_CLI_EVIDENCE_SHA256; }],
    ['tampered evidence', (f: ReturnType<typeof syntheticEvidence>) => { f.files.set(f.manifestPath, Buffer.from('synthetic tampering')); }],
    ['unsupported interface', (f: ReturnType<typeof syntheticEvidence>) => { f.repinArtifact('execHelp', help.replace('      --json\r\n', '')); }],
  ] as const) {
    test(`synthetic ${entrypoint.label} factory refuses ${label} before constructing an Engine`, async () => {
      const f = syntheticEvidence(); alter(f);
      await assert.rejects(entrypoint.create(f.environment, f.dependencies, true), code(label === 'unsupported interface' ? 'CLI_CAPABILITY_UNSUPPORTED' : 'CLI_HOST_EVIDENCE_INVALID'));
      assert.equal(f.binaryChecks.length, 0);
    });
  }

  async function attached(t: TestContext, hostConfiguration: boolean) {
    const directory = await mkdtemp(join(tmpdir(), `chausar-synthetic-${entrypoint.label}-host-`));
    const invocations: ProcessRequest[] = [];
    const f = syntheticEvidence({ process: async request => { invocations.push(structuredClone(request)); return completed; } });
    const engine = await entrypoint.create({ ...(hostConfiguration ? f.environment : {}), CHAUSAR_VAULT_DIRECTORY: directory }, f.dependencies, true);
    t.after(async () => { try { await engine.shutdown(); } finally { await removeSyntheticDirectory(directory); } });
    await engine.request('workspace.create', { name: 'Synthetic host wiring business', passphrase: 'synthetic-host-wiring-passphrase', demo: true });
    await engine.request('trust.update', { send: 'shape' });
    const route = await engine.request('models.configure', { config: { id: 'synthetic-host-codex', kind: 'codex-cli', model: 'synthetic-exact-model', command: syntheticExecutable } });
    return { f, engine, invocations, route };
  }

  test(`synthetic ${entrypoint.label} attached Engine dispatches through verified exact-command gateway`, async t => {
    const { f, engine, invocations, route } = await attached(t, true);
    assert.equal(route.interfaceEvidenceKind, 'installed-help'); assert.equal(route.credentialConfigured, false);
    assert.equal(route.authenticationStatus, 'cli-managed-unverified'); assert.equal(route.accountAccess, 'unverified');
    assert.equal(route.modelAccess, 'unverified');
    const listed = await engine.request('models.list'); assert.equal(listed[0].installationVerified, false);
    const preview = await engine.request('models.preview', { question: 'What was earned?', routeId: 'synthetic-host-codex' });
    const approval = await engine.request('models.approve', { id: preview.id });
    await engine.request('conversation.ask', { question: 'What was earned?', routeId: 'synthetic-host-codex', previewId: preview.id, approvalId: approval.id });
    assert.equal(invocations.length, 1); assert.equal(invocations[0].command, syntheticExecutable);
    assert.equal(invocations[0].args[invocations[0].args.indexOf('--model') + 1], 'synthetic-exact-model');
    assert.equal(invocations[0].stdin, preview.payload); assert.deepEqual(f.binaryChecks, [syntheticExecutable, syntheticExecutable]);
    f.setBinaryDigest('b'.repeat(64));
    const next = await engine.request('models.preview', { question: 'What was earned?', routeId: 'synthetic-host-codex' });
    const nextApproval = await engine.request('models.approve', { id: next.id });
    await assert.rejects(engine.request('conversation.ask', { question: 'What was earned?', routeId: 'synthetic-host-codex', previewId: next.id, approvalId: nextApproval.id }), code('CLI_HOST_EVIDENCE_INVALID'));
    assert.equal(invocations.length, 1);
  });

  test(`synthetic ${entrypoint.label} attached Engine without host configuration retains the capability gate`, async t => {
    const { f, engine, invocations, route } = await attached(t, false);
    assert.equal(route.interfaceEvidenceKind, 'unverified');
    const preview = await engine.request('models.preview', { question: 'What was earned?', routeId: 'synthetic-host-codex' });
    const approval = await engine.request('models.approve', { id: preview.id });
    await assert.rejects(engine.request('conversation.ask', { question: 'What was earned?', routeId: 'synthetic-host-codex', previewId: preview.id, approvalId: approval.id }), code('CLI_CAPABILITY_REQUIRED'));
    assert.equal(invocations.length, 0); assert.deepEqual(f.artifactReads, []); assert.deepEqual(f.binaryChecks, []);
    const listed = await engine.request('models.list'); assert.equal(listed[0].costConsumedMinor, '0');
  });

  test(`synthetic ${entrypoint.label} attached Engine refuses a route command outside the verified binary`, async t => {
    const { f, engine, invocations } = await attached(t, true);
    await engine.request('models.configure', { config: { id: 'synthetic-host-codex', kind: 'codex-cli', model: 'synthetic-exact-model', command: 'codex' } });
    await assert.rejects(engine.request('conversation.ask', { question: 'What was earned?', routeId: 'synthetic-host-codex' }), code('INVALID_COMMAND'));
    assert.equal(invocations.length, 0); assert.deepEqual(f.binaryChecks, [syntheticExecutable]);
  });

}
