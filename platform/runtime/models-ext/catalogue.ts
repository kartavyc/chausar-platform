/** Every way Chausar can reach a model. Status words follow the lane rule: supported or experimental. */
export type RouteCatalogueEntry = {
  kind: string; label: string; order: number; protocol: string; defaultEndpoint: string | null; auth: string;
  receiptBoundary: 'application-to-official-cli' | 'application-to-provider-http'; purposes: string[];
  status: 'supported' | 'experimental'; costModel: string; needsFromFounder: string | null; notes: string; docs: string[];
};

const TEXT = ['analysis', 'business-context', 'conversation', 'conversation-synthesis'];

export const ROUTE_CATALOGUE: readonly RouteCatalogueEntry[] = Object.freeze([
  { kind: 'codex-cli', label: 'Your installed Codex', order: 0, protocol: 'Official Codex CLI, locked profile, one turn, JSON schema output', defaultEndpoint: null,
    auth: 'The CLI owns its own login. Chausar never reads a subscription token.', receiptBoundary: 'application-to-official-cli', purposes: TEXT,
    status: 'experimental', costModel: 'Your plan with usage limits. Not counted in rupees.', needsFromFounder: 'An installed, signed-in Codex CLI on the machine.',
    notes: 'The receipt holds the exact text handed to the CLI; the CLI may add its own unpublished system prompt.', docs: ['https://developers.openai.com/codex/cli/reference'] },
  { kind: 'claude-cli', label: 'Your installed Claude Code', order: 1, protocol: 'Official Claude Code CLI, print mode, no tools, one turn, JSON schema output', defaultEndpoint: null,
    auth: 'The CLI owns its own login. Chausar never reads a subscription token.', receiptBoundary: 'application-to-official-cli', purposes: TEXT,
    status: 'experimental', costModel: 'Your plan with usage limits. Not counted in rupees.', needsFromFounder: 'An installed, signed-in Claude Code CLI on the machine.',
    notes: 'The receipt holds the exact text handed to the CLI; the CLI may add its own unpublished system prompt.', docs: ['https://code.claude.com/docs/en/cli-reference'] },
  { kind: 'openai-responses', label: 'OpenAI API key (Responses API)', order: 2, protocol: 'POST /v1/responses, tools off, store off, JSON schema output', defaultEndpoint: 'https://api.openai.com/v1/responses',
    auth: 'Bearer API key held in engine memory or the credential broker, never in the workspace.', receiptBoundary: 'application-to-provider-http', purposes: TEXT,
    status: 'experimental', costModel: 'Per token, from the dated price table and your FX setting.', needsFromFounder: 'A paid OpenAI API key with a spend cap set on the provider page.',
    notes: 'Exact JSON body on the receipt.', docs: ['https://developers.openai.com/api/docs/pricing'] },
  { kind: 'anthropic-messages', label: 'Anthropic API key (Messages API)', order: 2, protocol: 'POST /v1/messages, no tools declared, output_config JSON schema', defaultEndpoint: 'https://api.anthropic.com/v1/messages',
    auth: 'x-api-key header from engine memory or the credential broker, never in the workspace.', receiptBoundary: 'application-to-provider-http', purposes: TEXT,
    status: 'experimental', costModel: 'Per token, from the dated price table and your FX setting.', needsFromFounder: 'A paid Anthropic API key with a spend cap set on the provider page.',
    notes: 'Exact JSON body on the receipt. Thinking blocks are ignored; only the final text is parsed.', docs: ['https://platform.claude.com/docs/en/build-with-claude/structured-outputs'] },
  { kind: 'openai-compatible', label: 'OpenAI-compatible API', order: 3, protocol: 'POST chat/completions, tools none, json_schema response format', defaultEndpoint: 'https://api.openai.com/v1/chat/completions',
    auth: 'Bearer API key held in engine memory or the credential broker.', receiptBoundary: 'application-to-provider-http', purposes: TEXT,
    status: 'experimental', costModel: 'Per token when you enter the provider rates; otherwise not counted.', needsFromFounder: 'An HTTPS endpoint and key from a compatible provider.',
    notes: 'Exact JSON body on the receipt.', docs: [] },
  { kind: 'ollama', label: 'Local model (Ollama)', order: 4, protocol: 'POST /api/chat on localhost, schema-constrained', defaultEndpoint: 'http://127.0.0.1:11434/api/chat',
    auth: 'None. Loopback only.', receiptBoundary: 'application-to-provider-http', purposes: TEXT,
    status: 'experimental', costModel: 'Free on your own machine.', needsFromFounder: null,
    notes: 'Still subject to the send level. Needs Ollama and a pulled model on the machine.', docs: [] },
  { kind: 'managed', label: 'Chausar allowance', order: 5, protocol: "Responses-format request to hosted-link's allowance proxy", defaultEndpoint: null,
    auth: 'A short-lived allowance credential from the paired hosted service; provider keys stay on the server.', receiptBoundary: 'application-to-provider-http', purposes: TEXT,
    status: 'experimental', costModel: 'Metered in rupees by the allowance proxy.', needsFromFounder: 'A deployed allowance proxy, a payment partner and a paid plan. Nothing is deployed in this build.',
    notes: 'Configured through modelsx.connectAllowance once hosted-link pairing exists.', docs: [] },
  { kind: 'subq-snap', label: 'SubQ Snap (decision model)', order: 6, protocol: 'POST /v1/systemone, two choice questions: calculation and period', defaultEndpoint: 'https://api.subq.ai/v1/systemone',
    auth: 'Bearer API key held in engine memory or the credential broker.', receiptBoundary: 'application-to-provider-http', purposes: ['analysis'],
    status: 'experimental', costModel: 'Input tokens only, from the dated price table (unverified third-party rate) and your FX setting.', needsFromFounder: 'A SubQ console key with credits.',
    notes: 'Chooses a registered calculation and a period preset from probabilities; below 0.6 confidence it asks for clarification. Never writes text, never fills branch or customer.',
    docs: ['https://docs.subq.ai/endpoints/decisions-api/'] },
]);
