// Harmless developer preview: the real Engine and local server, with replay-only AI and no installed tools.
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine } from '../platform/runtime/engine.ts';
import { createLocalServer } from '../platform/runtime/server.ts';
import { createReplayTransport } from '../platform/runtime/venture/models/replay.ts';
import { refuseInsideRepo, runRoot } from '../platform/runtime/run-root.mjs';

/** @param {{ directory: string; port?: number }} options */
export async function createDevSample({ directory, port = 4317 }) {
  refuseInsideRepo(directory);
  if ((await readdir(directory)).length) throw new Error('The UI sample needs a new empty data folder.');
  const refuse = async () => { throw new Error('The UI sample cannot use an outside service or installed tool.'); };
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file',
    workspaceCustody: { deviceKeys: 'none', autoBackups: false },
    venture: { host: 'test', statusPages: false, hostProcess: refuse,
      modelTransport: createReplayTransport({ label: 'synthetic recording', note: 'This sample uses templates and makes no provider request.', responses: [] }),
      githubTransport: { kind: 'fixture', read: refuse }, net: { resolve: refuse, send: refuse, tls: refuse },
      credentials: { get: async () => null, set: async () => {}, delete: async () => {} },
    },
  });
  try {
    await engine.request('workspace.create', { name: 'Sample Ledger Books', passphrase: 'local-sample-passphrase', pack: 'services', demo: true });
    await engine.request('venture.create', { idea: 'Monthly bookkeeping for cafes and small shops in Pune.', countryCode: 'IN', workingName: 'Sample Ledger Books' });
    await engine.request('venture.interview.next', { useTemplate: true });
    for (const [questionId, answer] of [
      ['q_1', { skipped: true }], ['q_2', { skipped: true }], ['q_pricing_model', { choiceId: 'monthly' }],
      ['q_price', { amount: '2499' }], ['q_tax', { yes: false }],
    ]) await engine.request('venture.interview.answer', { questionId, answer });
    const plan = await engine.request('venture.blueprint.draft', { useTemplate: true });
    await engine.request('venture.price.quote', { offerId: 'offer_1' });
    await engine.request('venture.blueprint.accept', { digest: plan.blueprint.digest });
    const app = createLocalServer(engine, { port });
    const address = await app.listen();
    return { engine, ...address, close: () => app.close() };
  } catch (error) { await engine.close(); throw error; }
}

export async function startDevUi() {
  const root = runRoot('ui-engine');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(root, 'sample-'));
  const sample = await createDevSample({ directory });
  let vite;
  const launchFile = join(directory, 'launch.json');
  const launchPage = join(directory, 'launch.html');
  let closing;
  const close = () => closing ??= (async () => {
    try { await vite?.close(); }
    finally {
      try { await sample.close(); }
      finally { await Promise.all([rm(launchFile, { force: true }), rm(launchPage, { force: true })]); }
    }
  })();
  try {
    const { createServer } = await import('vite');
    vite = await createServer({ configFile: fileURLToPath(new URL('../app/ui/vite.config.ts', import.meta.url)), mode: 'engine', logLevel: 'error' });
    await vite.listen();
    const url = `http://127.0.0.1:5178/#token=${sample.token}`;
    await writeFile(launchFile, `${JSON.stringify({ url }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await writeFile(launchPage, `<!doctype html><html lang="en"><meta charset="utf-8"><title>Chausar sample</title><p><a href="${url}">Open the local Chausar sample</a></p></html>\n`, { mode: 0o600, flag: 'wx' });
    console.log(`Chausar sample UI: http://127.0.0.1:5178/\nOpen the private launch page: ${launchPage}\nSample data: ${directory}`);
    return { directory, launchFile, close };
  } catch (error) { await close(); throw error; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const running = await startDevUi();
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void running.close().then(() => process.exit(0), error => { console.error(error.message); process.exit(1); }); });
}
