import type { Context, State } from './contracts.ts';

export const INTERCHANGE_FORMAT = 'chausar.workspace-interchange.v1' as const;
export const STATE_PROFILE = 'chausar.persisted-state.v1' as const;
export const COLLECTION_STORES = [
  'members', 'facts', 'imports', 'receipts', 'answers', 'decisions', 'actions', 'jobs',
  'learning', 'plugins', 'modelReceipts', 'activity', 'conflicts', 'merges', 'tombstones',
  'conversations', 'routes', 'sessions', 'unsupported', 'schedules', 'sourceRules',
] as const;
export const SINGLETON_STORES = ['schemaVersion', 'revision', 'workspace', 'policy', 'ontology'] as const;
export const RETAINED_ARTIFACT_CATEGORIES = [
  'source-originals', 'mapping-recipes', 'dictionary-artifacts', 'report-files',
  'plugin-assets', 'research-evidence', 'conversation-files', 'sync-evidence', 'other-retained',
] as const;

export type Generation = { workspaceId: string; revision: number; captureId: string };
export type StoreProfile = {
  id: string;
  stores: { name: string; kind: 'collection' | 'singleton' }[];
  artifactCategories: string[];
};
export type StoreManifest = {
  name: string; kind: 'collection' | 'singleton'; records: number;
  bytes: number; sha256: string; generation: Generation;
};
export type ArtifactManifest = {
  id: string; category: string; mediaType: string; bytes: number; sha256: string;
  generation: Generation; representation: 'literal-utf8' | 'base64';
};
/** Supplied by trusted root enumeration, never inferred by walking user paths. */
export type RetainedArtifact = {
  id: string; category: string; mediaType: string; bytes: Uint8Array; generation: Generation;
};
export type ArtifactCapture = {
  complete: true; enumerationId: string; generation: Generation;
  categories: string[]; artifacts: RetainedArtifact[];
};
export type WorkspaceInventory = {
  format: 'chausar.workspace-inventory.v1'; profile: StoreProfile; generation: Generation;
  enumerationId: string; accessDigest: string; stateDigest: string;
  stores: StoreManifest[]; artifacts: ArtifactManifest[];
  categoryCounts: { category: string; count: number }[];
};
export type WorkspaceInterchange = {
  format: typeof INTERCHANGE_FORMAT; inventory: WorkspaceInventory;
  stores: { manifest: StoreManifest; text: string }[];
  artifacts: { manifest: ArtifactManifest; text: string }[];
  readable: { definitions: string; recipes: string };
  digest: string;
};
export type WorkspaceCapture = { inventory: WorkspaceInventory; package: WorkspaceInterchange };
/** Every persisted store, including singleton authority records, must be absent. */
export type EmptyTargetInspection = {
  targetId: string; workspaceId: string; generation: string; accessDigest: string;
  ready: boolean; profile: StoreProfile;
  stores: { name: string; records: number }[];
  categoryCounts: { category: string; count: number }[];
  authorityRecords: number; unexpectedEntries: string[];
};
export type WorkspaceImportCandidate = {
  format: 'chausar.workspace-import-candidate.v1'; id: string; inert: true;
  activation: 'root-only'; targetId: string; targetWorkspaceId: string;
  packageDigest: string; sourceInventoryDigest: string; targetProofDigest: string;
  contextDigest: string; archive: WorkspaceInterchange;
};
/** These are host ports, not IPC payloads. They must resolve CURRENT full access. */
export type WorkspaceImportHooks = {
  source(context: Context): { ready: boolean; inventory: WorkspaceInventory };
  target(context: Context, targetId: string): EmptyTargetInspection;
  assertCompleteRead(context: Context, historicalState: State): void;
};
