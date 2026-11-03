// A2: why an AI turn failed, read from what the tool itself reported (Codex's error info, a Claude Code result, the
// tool's stderr), and said to the owner in plain words with the one fix to offer. The tool's own text is matched against
// fixed phrases and never shown. A failure that matches none keeps the plain "stopped with an error" words.
// The codes are in VENTURE_ERRORS (contracts.ts), so owner-error.ts lets their words through.

export type AiFailureKind = 'usage-limit' | 'context-full' | 'max-turns' | 'stream-cut' | 'sign-in-refused' | 'model-missing';
export type AiToolName = 'Codex' | 'Claude Code' | 'Claude' | 'The AI';

export const AI_FAILURE_CODES = Object.freeze({
  'usage-limit': 'AI_USAGE_LIMIT',
  'context-full': 'AI_CONTEXT_FULL',
  'max-turns': 'AI_MAX_TURNS',
  'stream-cut': 'AI_STREAM_CUT',
  'sign-in-refused': 'AI_SIGN_IN_REFUSED',
  'model-missing': 'AI_MODEL_UNAVAILABLE',
} as const satisfies Record<AiFailureKind, string>);

/** The owner's words: what happened, then the fix. */
export function aiFailureWords(kind: AiFailureKind, tool: AiToolName): string {
  switch (kind) {
    case 'usage-limit': return `${tool} has used up your plan for now. Wait for it to reset, or choose another AI in Settings.`;
    case 'context-full': return `This was too long for ${tool} to read in one go. Try again with fewer or smaller files.`;
    case 'max-turns': return `${tool} reached its step limit before it finished. Run it again.`;
    case 'stream-cut': return `The connection to ${tool} dropped before it finished. Check your internet, then try again.`;
    case 'sign-in-refused': return `${tool} refused your sign-in. Sign in to ${tool} again, then try again.`;
    case 'model-missing': return `Your ${tool} account doesn't offer this model. Choose one from your AI's list in Settings.`;
  }
}

/** The kind behind Codex's app-server error info (TurnError.codexErrorInfo), or null for any other. */
export function classifyCodexInfo(info: unknown): AiFailureKind | null {
  const name = typeof info === 'string' ? info : info && typeof info === 'object' && !Array.isArray(info) ? Object.keys(info)[0] ?? '' : '';
  switch (name) {
    case 'usageLimitExceeded': case 'rateLimitExceeded': return 'usage-limit';
    case 'contextWindowExceeded': return 'context-full';
    case 'sessionBudgetExceeded': return 'max-turns';
    case 'unauthorized': return 'sign-in-refused';
    case 'modelNotFound': return 'model-missing';
    case 'responseStreamDisconnected': case 'responseStreamConnectionFailed': case 'httpConnectionFailed': return 'stream-cut';
    default: return null;
  }
}

/** Fixed phrases, in the order they are tried: a refused sign-in first, a dropped connection last. */
const PHRASES: readonly [AiFailureKind, RegExp][] = [
  ['sign-in-refused', /\b(?:401|unauthori[sz]ed|not (?:logged|signed) in|please (?:run )?\/?login|(?:log|sign) ?in again|invalid (?:api[ _-]?key|x-api-key|bearer)|authentication (?:failed|error)|token (?:has )?expired|refresh token|oauth token)\b/i],
  ['model-missing', /\b(?:model_not_found|model not found|(?:does not|doesn't) (?:exist|have access)|model is not supported|not supported when using codex)\b/i],
  ['usage-limit', /\b(?:usage[ _]limit|rate[ _]limit|insufficient_quota|quota (?:exceeded|reached)|exceeded your (?:current )?quota|too many requests|credit balance is too low|limit (?:reached|exceeded))\b/i],
  ['context-full', /\b(?:context[ _](?:window|length)|context_length_exceeded|prompt is too long|maximum context|input is too long|too many tokens)\b/i],
  ['max-turns', /\b(?:max(?:imum)?[ _-]?turns|error_max_turns|turn limit)\b/i],
  ['stream-cut', /\b(?:stream (?:disconnected|closed|ended|error)|stream_error|disconnected before completion|connection (?:reset|closed|dropped|refused)|ECONNRESET|socket hang up|premature close|network error)\b/i],
];

/** The kind a tool's own words name (stderr, an error event's message, a result text), or null. */
export function classifyAiText(text: string): AiFailureKind | null {
  if (typeof text !== 'string' || !text) return null;
  const sample = text.slice(0, 16_384);
  for (const [kind, pattern] of PHRASES) if (pattern.test(sample)) return kind;
  return null;
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** A Codex exec answer (JSONL events) and its stderr: the kind of its failure, or null. */
export function classifyCodexExec(stdout: string, stderr: string | undefined): AiFailureKind | null {
  const said: string[] = [];
  for (const line of (typeof stdout === 'string' ? stdout : '').slice(0, 1_048_576).split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event: unknown;
    try { event = JSON.parse(line); } catch { continue; }
    if (!record(event) || (event.type !== 'turn.failed' && event.type !== 'error')) continue;
    const error = record(event.error) ? event.error : event;
    const info = classifyCodexInfo(error.codexErrorInfo ?? error.codex_error_info);
    if (info) return info;
    if (typeof error.message === 'string') said.push(error.message);
  }
  return classifyAiText([...said, typeof stderr === 'string' ? stderr : ''].join('\n'));
}

/** A Claude Code result message (stream or JSON output): the kind of its failure, or null. */
export function classifyClaudeResult(result: unknown): AiFailureKind | null {
  if (!record(result)) return null;
  if (result.subtype === 'error_max_turns') return 'max-turns';
  const words = [typeof result.result === 'string' ? result.result : '', ...(Array.isArray(result.errors) ? result.errors.filter((item): item is string => typeof item === 'string') : [])];
  return classifyAiText(words.join('\n'));
}
