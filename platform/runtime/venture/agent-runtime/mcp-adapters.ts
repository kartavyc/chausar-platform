/**
 * W6 6F1 (D30): per-service rules on top of the MCP client. An adapter recognises one service's server, may refuse a
 * tool outright (throw), and may add exact fields to the owner's card, such as a code-computed cost with its receipt
 * and a rights record. Fields it adds are part of the approval digest, so the owner approves exactly what is shown.
 * An adapter never approves anything and never turns a write into a read. Other packages add theirs to the list below.
 */
import type { Context } from '../../contracts.ts';
import type { VentureDeps } from '../contracts.ts';
import type { ExternalMcpServer } from './external-config.ts';
import type { ExternalTool } from './external-client.ts';
import type { JobCapability } from './scope.ts';
import { sunraAdapter } from '../media/sunra.ts';

export type McpCallPlan = {
  /** Exact extra fields for the owner's card. A plan with a card always asks, even for a checked read-only tool. */
  card?: Record<string, unknown>;
  /** The card's one line, in place of the default. */
  description?: string;
  /** After the owner approves and before Chausar sends the call: record intent, so a crash leaves a known state. */
  approved?(): Promise<void>;
  /** When the owner declines. */
  declined?(): Promise<void>;
  /** After the call returns or fails. A failure may still have acted at the service. */
  settled?(outcome: { ok: true; result: unknown } | { ok: false }): Promise<void>;
};
export type McpCallInput = { deps: VentureDeps; ctx: Context; capability: JobCapability; server: ExternalMcpServer; tool: ExternalTool; input: Record<string, unknown> };
export type McpCallAdapter = {
  id: string;
  matches(server: ExternalMcpServer): boolean;
  /** Throw a ChausarError to refuse. Return undefined for the default handling. */
  plan(call: McpCallInput): Promise<McpCallPlan | undefined>;
};

/** The adapters every job uses. W6 6F9: Sunra's images and video. */
export const DEFAULT_MCP_ADAPTERS: readonly McpCallAdapter[] = Object.freeze([sunraAdapter()]);
