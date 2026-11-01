/** Trusted host contracts. Credentials and MCP capabilities are ephemeral, never saved settings. */
export const AGENT_MCP_TOOL_NAMES = ['read_business', 'read_client', 'read_order', 'list_files', 'read_file', 'calculate', 'draft_document', 'propose_action', 'search_records', 'external_tools', 'external_call'] as const;
export type AgentJobScope = {
  jobId: string; runId: string; ventureId: string; orderId: string; clientId: string;
  agentId: string; memberId: string; epoch: number; consentId: string; consentRevision: number; generation: number;
};

export type AgentDriverSettings = {
  model: string; effort: 'low' | 'medium' | 'high' | 'max'; autoReview: boolean;
  webSearch: boolean; network: boolean; shell: boolean; fallbackModel?: string;
  /** W6 6F5 (D34): the owner turned on the tool's own Gmail connection. Used only with a plan login, never with a key. */
  connectors?: boolean;
};
export type AgentMcpConnection = { name: string; command: string; args: string[]; env: Record<string, string> };
export type AgentDriverCredentials = { apiKey: string; baseUrl?: string };
export type AgentUsage = {
  inputTokens: number; outputTokens: number; cachedInputTokens?: number; cacheWriteTokens?: number; reasoningOutputTokens?: number;
  model?: string; source: 'provider-reported';
};
export type AgentTurnStatus = 'completed' | 'interrupted' | 'failed';
export type AgentDriverEvent = { threadId?: string; turnId?: string; itemId?: string } & (
  | { type: 'started'; sessionId: string; model?: string }
  | { type: 'text-delta'; messageId: string; text: string }
  | { type: 'tool-started'; toolUseId: string; name: string }
  | { type: 'tool-completed'; toolUseId: string; name: string; failed: boolean }
  | { type: 'mode-changed'; mode: string }
  | { type: 'usage'; usage: AgentUsage }
  | { type: 'terminal'; status: AgentTurnStatus; error?: string });
export type AgentTurnResult = {
  status: AgentTurnStatus; text: string; model?: string; usage?: AgentUsage; error?: string; threadId?: string; turnId?: string;
};
/** Exact native request identity and complete inputs, never partial streamed arguments. */
export type AgentApprovalRequest = {
  /** W6 6F1: 'external-input' is an outside tool server's question for the owner (MCP elicitation), answered on the card. */
  /** W6 6F5: 'connector-send' is a send through the tool's own Gmail connection; approving it sends exactly that, once. */
  kind: 'command' | 'file-change' | 'external-tool' | 'external-input' | 'connector-send'; requestId: string; threadId: string; turnId: string; itemId: string;
  name: string; arguments: Record<string, unknown>; description?: string;
};
export type AgentDriverInput = {
  jobId: string; jobRoot: string; settings: AgentDriverSettings; mcp: AgentMcpConnection;
  /** Recheck the current job, consent and generation immediately before sharing another byte. */
  guard: () => void;
  onEvent: (event: AgentDriverEvent) => void;
  signal?: AbortSignal; credentials?: AgentDriverCredentials;
  /** Missing callback means deny. It never grants access outside the job's policy. */
  requestApproval?: (request: AgentApprovalRequest) => Promise<boolean>;
};
export interface AgentDriverSession {
  /** Turns are serial. Continuation reuses only this live, consent-checked session. */
  run(prompt: string): Promise<AgentTurnResult>;
  interrupt(): Promise<void>;
  close(): Promise<void>;
}
export interface AgentDriver { open(input: AgentDriverInput): Promise<AgentDriverSession> }
