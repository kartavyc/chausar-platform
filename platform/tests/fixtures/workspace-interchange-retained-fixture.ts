import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import type { TestContext } from 'node:test';
import { digest, sourceAccess } from '../../runtime/actions.ts';
import { authorize, check, type Context, type StateStore } from '../../runtime/contracts.ts';
import { createEngineLessonService, type EngineLessonOptions } from '../../runtime/engine-lessons.ts';
import { EngineScenarioService, type EngineScenarioOptions } from '../../runtime/engine-scenarios.ts';
import type { LessonApplicableContext } from '../../runtime/lesson-contracts.ts';
import type { ScenarioCreateRequest, ScenarioView } from '../../runtime/scenario-contracts.ts';
import { ExperimentalFileSnapshotAdapter, Vault } from '../../runtime/vault.ts';
import { captureWorkspaceInterchange } from '../../runtime/workspace-interchange.ts';
import { decision, fixture as lessonProtocol, pin, proposal } from './lesson-fixture.ts';
import { artifactsFor, deterministicShopState } from './workspace-interchange-fixture.ts';

// Actual encrypted custody and service-produced records; all calculator,
// personal-target and evaluation qualification ports remain synthetic. No
// listener, native/database/browser, credential provider or business effect.
export const retainedOwner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
export const retainedCut = '2026-10-03T00:00:00.000Z';
export const retainedSource = 'demo-export';
export const retainedApplicable: LessonApplicableContext = {
  branchId: 'main', sourceIds: ['source-job'], conditions: { task: 'weekly-overview', presentation: 'receipts' },
};
const passphrase = 'Synthetic retained interchange fixture passphrase';

export async function retainedInterchangeFixture(t: TestContext, options: { populate?: boolean } = {}) {
  const base = await realpath(tmpdir());
  const directory = await realpath(await mkdtemp(join(base, 'chausar-interchange-retained-')));
  assert.equal(dirname(directory), base);
  let vault = (await Vault.create({ directory, storage: new ExperimentalFileSnapshotAdapter(directory),
    passphrase, name: 'Synthetic retained interchange' })).vault;
  t.after(async () => {
    await vault.close();
    const actual = await realpath(directory), child = relative(base, actual);
    assert.equal(dirname(actual), base);
    assert.ok(child && !isAbsolute(child) && !child.startsWith('..') && child.startsWith('chausar-interchange-retained-'));
    await rm(actual, { recursive: true, force: true });
  });
  const protocol = lessonProtocol();
  await vault.update(state => {
    const initial = deterministicShopState();
    initial.workspace.id = state.workspace.id;
    Object.assign(state, initial);
    state.jobs.push(...structuredClone(protocol.workspace.jobs));
  });
  let clock = retainedCut;
  const scenarioOptions: EngineScenarioOptions = {
    now: () => clock,
    discoveryAuthorityRevision: state => String(state.revision),
    calculatorOptions: view => ({
      consumerGuard: context => { authorize(view, context); },
      receiptGuard: context => { authorize(view, context); },
      verifier: async () => ({ qualification: 'synthetic-protocol', nativeSqlExecuted: false }),
    }),
  };
  const lessonOptions: EngineLessonOptions = {
    targets: protocol.targets,
    evidenceResolver(state, context, reference) {
      const collection = reference.kind === 'job' ? state.jobs : state.receipts;
      const record = collection.find(item => item.id === reference.id);
      check(record && record.available && record.memberId === context.memberId && record.epoch === context.epoch,
        'SYNTHETIC_EVIDENCE_UNAVAILABLE', 'Only the existing synthetic job or receipt owner and current epoch may resolve evidence.');
      return { pin: { kind: reference.kind, id: record.id, revision: record.revision, digest: digest(record),
        sourceIds: [...record.sourceIds], branchIds: [...record.branchIds] },
      available: record.available, sourceTainted: record.sourceTainted,
      sourceMarkings: structuredClone(record.sourceMarkings), summary: record.summary };
    },
    evaluations: { ...protocol.evaluations,
      assertSourceAccess(context, sourceIds) { sourceAccess(vault.read(), context, sourceIds); } },
  };
  const store: StateStore = { read: () => vault.read(), update: change => vault.update(change) };
  const scenarios = () => new EngineScenarioService(vault, scenarioOptions);
  const lessons = () => createEngineLessonService(store, lessonOptions);
  async function complete(original: ScenarioView): Promise<ScenarioView> {
    const service = scenarios();
    let view = await service.reopen(retainedOwner, original.scenarioId, original.revision.id);
    for (let pass = 0; pass <= view.revision.jobs.length; pass++) {
      if (view.jobs.every(job => job.status === 'ready')) return view;
      const job = view.revision.jobs.find(job => view.jobs.find(item => item.jobId === job.id)!.status !== 'ready'
        && job.dependsOn.every(id => view.jobs.find(item => item.jobId === id)!.status === 'ready'));
      assert.ok(job);
      const run = await service.beginRun(retainedOwner, view.scenarioId, view.revision.id, job.id);
      await service.evaluate(retainedOwner, view.scenarioId, run.id);
      view = await service.reopen(retainedOwner, view.scenarioId, view.revision.id);
    }
    return assert.fail('The finite synthetic scenario graph must complete.');
  }
  const request: ScenarioCreateRequest = { version: 1, label: 'Synthetic retained same-label histories',
    baseline: { label: 'Measured baseline', request: { operation: 'scenario', sourceIds: [retainedSource], branch: 'main',
      period: { from: '2026-01-01', to: '2026-12-31' }, assumptions: { priceChangeBps: '00' }, asOf: retainedCut } },
    alternatives: [{ label: 'Same display label', priceChangeBps: '1000' }, { label: 'Same display label', priceChangeBps: '2000' }] };
  async function populate() {
    const service = scenarios(), first = await service.create(retainedOwner, request);
    await complete(first);
    await service.finalize(retainedOwner, first.scenarioId, first.revision.id);
    const historical = await service.reopen(retainedOwner, first.scenarioId, first.revision.id);
    const head = await service.changeAssumption(retainedOwner, first.scenarioId, first.revision.id, first.revision.branches[1].id, '3000');
    const lesson = lessons();
    const proposed = await lesson.propose(retainedOwner, proposal({ applicability: {
      memberId: 'owner', sourceIds: ['source-job'], branchIds: ['main'], conditions: { task: 'weekly-overview', presentation: 'receipts' },
    } }));
    const references = protocol.registerEvaluations(pin(proposed.candidate));
    await lesson.bindEvaluations(retainedOwner, pin(proposed.candidate), references);
    const reviewed = await lesson.review(retainedOwner, pin(proposed.candidate));
    const approved = await lesson.decideLesson(retainedOwner, decision(reviewed));
    return { historical, head, approved };
  }
  const populated = options.populate === false ? undefined : await populate();
  return { directory, get vault() { return vault; }, get exportClock() { return clock; }, protocol, store, scenarios, lessons, scenarioOptions, lessonOptions,
    populated, populate, setClock: (at: string) => { clock = at; },
    capture() { const state = vault.read(); return captureWorkspaceInterchange(state, artifactsFor(state)); },
    async reopen() {
      await vault.close();
      vault = await Vault.open({ directory, storage: new ExperimentalFileSnapshotAdapter(directory), passphrase });
    },
  };
}
