// Canonical browser-safe types, shared by the engine and renderer.


export type AgentDriverSettings = {
  model: string; effort: 'low' | 'medium' | 'high' | 'max'; autoReview: boolean;
  webSearch: boolean; network: boolean; shell: boolean; fallbackModel?: string;
  /** W6 6F5 (D34): the owner turned on the tool's own Gmail connection. Used only with a plan login, never with a key. */
  connectors?: boolean;
};
