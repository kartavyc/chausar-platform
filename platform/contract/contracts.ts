// Canonical browser-safe types, shared by the engine and renderer.


export type State = {
  schemaVersion: number; revision: number; workspace: { id: string; name: string; currency: string; demo: boolean; createdAt: string };
  members: Member[]; policy: TrustPolicy; ontology: any; facts: Fact[]; imports: any[]; receipts: any[]; answers: any[]; decisions: any[];
  actions: any[]; jobs: any[]; learning: any[]; plugins: any[]; modelReceipts: any[]; activity: any[]; conflicts: any[]; merges: any[]; tombstones: any[];
  conversations: any[]; routes: any[]; sessions: any[]; unsupported: any[]; schedules: any[]; sourceRules: any[];
};

export type Member = { id: string; name: string; role: Role; active: boolean; epoch: number; branches: string[] };

export type Role = 'owner' | 'cofounder' | 'accountant' | 'viewer';

export type TrustPolicy = { send: 'nothing' | 'shape' | 'samples'; autonomy: boolean; allowedSources: string[]; retentionDays: number; sharing: boolean };

export type Fact = { id: string; entityId: string; sourceId: string; sourceRow: number; kind: string; validFrom: string; validTo: string | null; learnedAt: string; supersededAt: string | null; fields: Record<string, unknown>; deletedAt?: string; branch?: string };
