import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../../runtime/engine.ts';
import type { ModelReplayFixture } from '../../runtime/venture/contracts.ts';
import { createReplayTransport } from '../../runtime/venture/models/replay.ts';
import { createRpcRecorder } from './rpc-recorder.ts';

export const RECORDING_EPOCH = '2026-11-06T12:00:00.000Z';
type Recorder = ReturnType<typeof createRpcRecorder>;
type Scenario = { engine: Engine; rpc: Omit<Recorder, 'request'> & { request: Engine['request'] } };
type Options = { initial?: 'empty' | 'workspace' | 'business'; replay?: ModelReplayFixture; prepare?: (engine: Engine) => Promise<void> };

/** A business built through the real owner-approved template flow, with a priced and accepted plan. */
async function prepareBusiness(engine: Engine) {
  await engine.request('venture.create', { idea: 'Monthly bookkeeping for cafes and small shops in Pune.', countryCode: 'IN', workingName: 'Ledger Cafe Books' });
  await engine.request('venture.interview.next', { useTemplate: true });
  for (const [questionId, answer] of [
    ['q_1', { skipped: true }], ['q_2', { skipped: true }], ['q_pricing_model', { choiceId: 'monthly' }],
    ['q_price', { amount: '2,499' }], ['q_tax', { yes: true }], ['q_tax_rate', { rate: '18' }],
  ]) await engine.request('venture.interview.answer', { questionId, answer });
  const draft = await engine.request('venture.blueprint.draft', { useTemplate: true });
  await engine.request('venture.price.quote', { offerId: 'offer_1' });
  await engine.request('venture.blueprint.accept', { digest: draft.blueprint.digest });
}

/** Real engine answers only. Date is fixed for vault metadata; timers remain live and venture decisions use its injected clock. */
export async function recordScenario(t: TestContext, name: string, flow: (sample: Scenario) => Promise<void>, options: Options = {}) {
  assert.match(name, /^[a-z][a-z0-9-]*$/, 'A scenario name must be a simple file name.');
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(RECORDING_EPOCH) });
  const directory = await mkdtemp(join(tmpdir(), 'chausar-rpc-sample-'));
  const credentials = new Map<string, string>();
  const refuse = async () => { throw new Error('A recorded sample cannot use an outside service or installed tool.'); };
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file',
    workspaceCustody: { deviceKeys: 'none', autoBackups: false, clock: () => Date.parse(RECORDING_EPOCH) },
    venture: { host: 'test', clock: () => new Date(RECORDING_EPOCH), hostProcess: refuse,
      modelTransport: createReplayTransport(options.replay ?? { label: 'synthetic recording', note: 'This scenario needs no model answer.', responses: [] }),
      githubTransport: { kind: 'fixture', read: refuse }, net: { resolve: refuse, send: refuse, tls: refuse },
      credentials: {
        get: async (workspace, name) => credentials.get(`${workspace}:${name}`) ?? null,
        set: async (workspace, name, value) => { credentials.set(`${workspace}:${name}`, value); },
        delete: async (workspace, name) => { credentials.delete(`${workspace}:${name}`); },
      },
    },
  });
  let recorder: Recorder | undefined;
  try {
    if (options.initial !== 'empty') await engine.request('workspace.create', { name: 'Ledger Cafe Books', passphrase: 'recorded-sample-passphrase', pack: 'services', demo: true });
    if ((options.initial ?? 'business') === 'business') await prepareBusiness(engine);
    await options.prepare?.(engine);
    recorder = createRpcRecorder(engine, { epoch: RECORDING_EPOCH, scenario: name });
    await flow({ engine, rpc: recorder as Scenario['rpc'] });
    const actual = `${JSON.stringify(recorder.finish(), null, 2)}\n`;
    const folder = new URL('../../../app/ui/tests/recordings/', import.meta.url);
    const file = new URL(`${name}.json`, folder);
    if (process.env.CHAUSAR_RECORDINGS_UPDATE === '1') {
      await mkdir(folder, { recursive: true });
      await writeFile(file, actual, 'utf8');
    } else {
      let expected: string | undefined;
      try { expected = await readFile(file, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      assert.equal(actual, expected, 'Recordings changed: run npm run recordings:update and commit the diff');
    }
  } finally {
    recorder?.close();
    await engine.close();
    credentials.clear();
    await rm(directory, { recursive: true, force: true });
    t.mock.timers.reset();
  }
}
