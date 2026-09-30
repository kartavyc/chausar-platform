import type { DesktopMethod } from './ipc-contract.cjs';

export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export interface JsonObject { [key: string]: JsonValue; }
type IdMethods = Extract<DesktopMethod, 'receipts.get' | 'sources.delete' | 'memory.undo' | 'actions.execute' | 'actions.reconcile' | 'jobs.pause' | 'jobs.resume' | 'jobs.run' | 'members.revoke' | 'models.approve' | 'speech.approve' | 'plugins.disable' | 'plugins.remove' | 'plugins.run'>;
type DigestMethods = Extract<DesktopMethod, 'actions.approve' | 'jobs.approve' | 'plugins.enable'>;
type RequiredPayloads = { [M in IdMethods]: JsonObject & { id: string } } & { [M in DigestMethods]: JsonObject & { id: string; digest: string } } & {
  'workspace.create': JsonObject & { name: string; passphrase: string; folder?: string; demo?: boolean; pack?: string };
  'workspace.open': JsonObject & { passphrase: string; folder?: string };
  'workspace.recover': JsonObject & { recoveryCode: string; passphrase: string; folder?: string };
  'workspace.restore': JsonObject & { backupFile: string; passphrase: string; folder?: string };
  'workspace.delete': JsonObject & { confirmation: string };
  'conversation.ask': JsonObject & { question: string };
  'actions.revise': JsonObject & { id: string; payload: JsonObject };
  'jobs.reject': JsonObject & { id: string; reason: string };
  'updates.verify': JsonObject & { manifest: JsonObject | string; signature: string };
  'updates.stage': JsonObject & { manifest: JsonObject | string; signature: string; confirmed: true };
};
export type DesktopPayload<M extends DesktopMethod> = M extends keyof RequiredPayloads ? RequiredPayloads[M] : JsonObject;
export type EngineStatus = Readonly<{ healthy: boolean; state: 'starting' | 'ready' | 'failed' | 'stopping' | 'stopped' }>;
export type DesktopResult<M extends DesktopMethod> = M extends 'workspace.status' ? { open: boolean; experimental: boolean; version: string; storage: string; workspace?: JsonObject } : unknown;
export interface DesktopBridge {
  request<M extends DesktopMethod>(method: M, ...args: M extends keyof RequiredPayloads ? [payload: DesktopPayload<M>] : [payload?: DesktopPayload<M>]): Promise<DesktopResult<M>>;
  onEngineStatus(callback: (status: EngineStatus) => void): () => void;
}
declare global { interface Window { chausar?: Readonly<DesktopBridge>; } }
