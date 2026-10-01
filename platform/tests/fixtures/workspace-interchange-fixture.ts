import { hash, initialState, type Context, type State, type StateStore } from '../../runtime/contracts.ts';
import { ImportService, demoCsv, demoRecipe } from '../../runtime/ingest.ts';
import { compileDictionary, starterPacks } from '../../runtime/ontology.ts';
import { workspaceStateProfile } from '../../runtime/workspace-interchange.ts';
import type { ArtifactCapture, EmptyTargetInspection, Generation } from '../../runtime/workspace-interchange-contracts.ts';

export const interchangeOwner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
export const fixedTime = '2026-10-01T00:00:00.000Z';
export const inertLiterals = ['=1+1', '+SUM(A1:A9)', '-00123', '@external', '\t=HYPERLINK("https://example.invalid","literal")',
  'quoted,"cell"\r\nnext line', 'नमस्ते', '0000900719925474099391', '900719925474099391', '-900719925474099391', '<script>fixture()</script>'];
export class InterchangeFixtureStore implements StateStore {
  #state: State;
  writes = 0;
  constructor(state: State) { this.#state = structuredClone(state); }
  read(): State { return structuredClone(this.#state); }
  async update<T>(change: (state: State) => T | Promise<T>): Promise<T> {
    const draft = this.read(); const result = await change(draft); draft.revision++; this.#state = draft; this.writes++; return result;
  }
}
export function deterministicShopState(): State {
  const state = initialState('Synthetic portable shop', true);
  state.workspace.id = 'workspace_synthetic_source'; state.workspace.createdAt = fixedTime;
  const dictionary = compileDictionary(starterPacks[0], 1, 'owner', fixedTime);
  state.ontology = { current: dictionary, history: [dictionary] };
  const store = new InterchangeFixtureStore(state);
  const preview = new ImportService(store).preview(interchangeOwner, { sourceId: 'demo-export', format: 'csv', content: demoCsv,
    recipe: demoRecipe, expectedTotals: { rowCount: 10, amountMinor: '1230000' } });
  if (!preview.accepted) throw new Error('Synthetic fixture must pass the public import preview.');
  state.facts = preview.facts.map((fact, index) => ({ ...fact, id: `fact_fixture_${index + 1}`, learnedAt: fixedTime,
    validTo: fact.validTo ?? null, supersededAt: null }));
  state.imports = [{ id: 'import_fixture', sourceId: 'demo-export', format: 'csv', at: fixedTime,
    recipeHash: hash(demoRecipe), contentHash: hash(demoCsv), rowIds: state.facts.map(fact => fact.id), coverage: preview.coverage,
    totalsMinor: preview.totalsMinor, expectedTotals: { rowCount: 10, amountMinor: '1230000' }, qualification: 'experimental' }];
  return state;
}
export function artifactsFor(state: State): ArtifactCapture {
  const generation: Generation = { workspaceId: state.workspace.id, revision: state.revision, captureId: 'capture_fixture_1' };
  return { complete: true, enumerationId: 'enumeration_fixture_1', generation, categories: workspaceStateProfile().artifactCategories,
    artifacts: [
      { id: 'source_demo', category: 'source-originals', mediaType: 'text/csv', bytes: Buffer.from(demoCsv), generation },
      { id: 'recipe_demo', category: 'mapping-recipes', mediaType: 'application/json', bytes: Buffer.from(JSON.stringify(demoRecipe)), generation },
      { id: 'literal_fixture', category: 'other-retained', mediaType: 'text/plain', bytes: Buffer.from(inertLiterals.join('\r\n')), generation },
      { id: 'binary_fixture', category: 'plugin-assets', mediaType: 'application/octet-stream', bytes: Uint8Array.from([0, 255, 192, 0, 128]), generation },
    ] };
}
export function emptyTarget(): EmptyTargetInspection {
  const profile = workspaceStateProfile();
  return { targetId: 'target_fixture', workspaceId: 'workspace_synthetic_empty_target', generation: 'empty_fence_1',
    accessDigest: hash('synthetic target access'), ready: true, profile,
    stores: profile.stores.map(store => ({ name: store.name, records: 0 })),
    categoryCounts: profile.artifactCategories.map(category => ({ category, count: 0 })), authorityRecords: 0, unexpectedEntries: [] };
}
