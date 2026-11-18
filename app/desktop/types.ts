import type { DesktopMethod } from './ipc-contract.cjs';
import type { VentureFrame, VentureMethod, VenturePayloads, VentureResults } from '../../platform/runtime/venture/contracts.ts';

/** Venture methods whose payload has at least one required field; the others may be called without a payload. */
type VentureRequiredMethod = { [M in VentureMethod]: {} extends VenturePayloads[M] ? never : M }[VentureMethod];

export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export interface JsonObject { [key: string]: JsonValue; }
type IdMethods = Extract<DesktopMethod, 'receipts.get' | 'members.revoke'>;
type RequiredPayloads = { [M in IdMethods]: JsonObject & { id: string } } & {
  'workspace.create': JsonObject & { name: string; passphrase: string; folder?: string; demo?: boolean; pack?: string };
  'workspace.open': JsonObject & { passphrase: string; folder?: string };
  'workspace.recover': JsonObject & { recoveryCode: string; passphrase: string; folder?: string };
  'workspace.restore': JsonObject & { backupFile: string; passphrase: string; folder?: string };
  'workspace.delete': JsonObject & { confirmation: string };
};
export type DesktopPayload<M extends DesktopMethod> = M extends VentureMethod ? VenturePayloads[M] : M extends keyof RequiredPayloads ? RequiredPayloads[M] : JsonObject;
export type EngineStatus = Readonly<{ healthy: boolean; state: 'starting' | 'ready' | 'failed' | 'stopping' | 'stopped' }>;
export type DesktopResult<M extends DesktopMethod> =
  M extends VentureMethod ? VentureResults[M] :
  M extends 'workspace.status' ? { open: boolean; experimental: boolean; version: string; storage: string; workspace?: JsonObject } : unknown;
export interface DesktopBridge {
  request<M extends DesktopMethod>(method: M, ...args: M extends keyof RequiredPayloads | VentureRequiredMethod ? [payload: DesktopPayload<M>] : [payload?: DesktopPayload<M>]): Promise<DesktopResult<M>>;
  /** Opens one listed https partner link in the system browser, from an owner click. Rejects with { code } when refused. */
  openExternal(url: string): Promise<void>;
  onEngineStatus(callback: (status: EngineStatus) => void): () => void;
  /** Run events the engine committed (run.* and queue.changed), frozen. Read the queue or the run again on each. */
  onEvent(callback: (event: Readonly<VentureFrame>) => void): () => void;
}
declare global { interface Window { chausar?: Readonly<DesktopBridge>; } }
