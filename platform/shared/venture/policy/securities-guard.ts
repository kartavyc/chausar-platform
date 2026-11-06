// Chausar venture launcher, policy (wave 6, 6E7 / D49): the securities guard, enforced in code. It rests on the
// 'securities-advice' hard stop (policy/hard-stops.ts), so no attestation, setting or profession unlocks it. Chausar
// never places, suggests or automates a trade, never gives buy, sell or hold advice, tips, target prices, copy trading or
// promised returns, and never connects to a broker with order rights. Hooks: records.ts modelWords (every model text
// that becomes a draft, a reply or a question), agents/answer.ts validateAnswer (agent chat), core/about.ts (About-you
// offers), agent-runtime/external-config.ts (saving an owner MCP server) and agent-runtime/external-mcp.ts (listing and
// calling one). Pure and import-light, so the fake engine runs the same checks. Written for Chausar.
import { ChausarError } from '../../portable.ts';

export const SECURITIES_GUARD_LINE = 'Chausar never places or automates trades, never gives buy, sell or hold advice, tips, target prices or promised returns, and never connects to a broker that can place orders.';

/** Make a word match in any letter case without the i flag, so ticker checks can stay case sensitive. */
const anyCase = (word: string) => word.split('').map(c => /[a-z]/i.test(c) ? `[${c.toLowerCase()}${c.toUpperCase()}]` : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
const ADVICE_VERB = ['buy', 'sell', 'hold', 'accumulate', 'short', 'exit'].map(anyCase).join('|');
const SECURITY = String.raw`(?:shares?|stocks?|equit(?:y|ies)|scrips?|nifty|bank\s?nifty|fin\s?nifty|sensex|call\s+options?|put\s+options?|options?|futures?|f&o|ce|pe|crypto|bitcoin|ipos?|etfs?|mutual\s+funds?|banking\s+stocks?|smallcaps?|midcaps?)`;

/** Each pattern names a kind of advice a model may not give. Words describing a past trade (bought, sold) never match. */
const PATTERNS: readonly { kind: string; re: RegExp }[] = [
  // A recommendation framed as one: "you should buy", "we recommend you sell", "time to accumulate".
  { kind: 'trade advice', re: new RegExp(String.raw`\b(?:you\s+should|we\s+recommend(?:\s+you)?|i\s+recommend(?:\s+you)?|recommend(?:ed)?\s+to|my\s+advice\s+is\s+to|time\s+to|must|should|better\s+to)\s+(?:now\s+)?(?:buy|sell|hold|accumulate|short|exit|book\s+profits?\s+in|add)\b[^.!?\n]{0,40}?\b${SECURITY}\b`, 'iu') },
  // An imperative call at the start of a sentence, naming a ticker in capitals or a security word.
  { kind: 'trade advice', re: new RegExp(String.raw`(?:^|[.!?:;\n]\s*)(?:${ADVICE_VERB})\s+[A-Z][A-Z0-9&-]{1,19}\b`, 'u') },
  { kind: 'trade advice', re: new RegExp(String.raw`(?:^|[.!?:;\n]\s*)(?:${ADVICE_VERB})\s+(?:the\s+|this\s+|your\s+|more\s+)?${SECURITY}\b`, 'iu') },
  // Ratings and calls: "buy rating", "rating: BUY", "strong buy".
  { kind: 'trade advice', re: /\b(?:buy|sell|hold|accumulate|outperform|underperform|overweight|underweight)\s+(?:rating|call|recommendation|signal)s?\b/i },
  { kind: 'trade advice', re: /\b(?:rating|call|recommendation|signal|view)\s*[:=-]\s*(?:strong\s+)?(?:buy|sell|hold|accumulate)\b/i },
  { kind: 'trade advice', re: /\bstrong\s+(?:buy|sell)\b/i },
  // Target prices and stop losses.
  { kind: 'target price', re: /\b(?:target\s+price|price\s+target|tgt\b|stop[- ]?loss|trailing\s+sl\b)/i },
  { kind: 'target price', re: /\bSL\s*(?:at|:|-|@)?\s*\d/ },
  { kind: 'target price', re: /\bentry\s+(?:at|around|near|above|below)\s+(?:₹|rs\.?|inr)?\s*\d/i },
  // Promised returns.
  { kind: 'promised return', re: /\b(?:guaranteed|assured|promised|fixed|sure[- ]?shot|risk[- ]?free)\s+(?:monthly\s+|weekly\s+|daily\s+)?(?:returns?|profits?|gains?|income)\b/i },
  { kind: 'promised return', re: /\breturns?\s+(?:are\s+|is\s+)?(?:guaranteed|assured)\b/i },
  { kind: 'promised return', re: /\bdouble\s+your\s+(?:money|capital|investment|portfolio)\b/i },
  { kind: 'promised return', re: /\d+(?:\.\d+)?\s*%\s*(?:(?:monthly|weekly|daily)\s+)?(?:returns?|profits?|gains?)\s+(?:every|per|a|each)\s+(?:day|week|month|year)\b/i },
  { kind: 'promised return', re: /\b(?:monthly|weekly|daily)\s+returns?\s+of\s+\d/i },
  // Tips, calls, signals and copy trading.
  { kind: 'tips or copy trading', re: /\bcopy[- ]?trad(?:e|es|ing)\b/i },
  { kind: 'tips or copy trading', re: /\bmirror\s+(?:my|our)\s+(?:trades|portfolio|positions)\b/i },
  { kind: 'tips or copy trading', re: /\b(?:stock|share|trading|intraday|options?|f&o|nifty|jackpot|sure[- ]?shot|btst|stbt)\s+tips?\b/i },
  { kind: 'tips or copy trading', re: /\b(?:trade|trading|stock|option|intraday|jackpot)\s+(?:calls|signals|alerts)\b/i },
  { kind: 'tips or copy trading', re: /\b(?:multibagger|jackpot\s+calls?|auto[- ]?trad(?:e|er|ing)|algo[- ]?trading\s+(?:bot|service|signals?))\b/i },
];

/** The first kind of securities advice the text gives, or null. */
export function securitiesAdviceIn(text: string): string | null {
  if (typeof text !== 'string' || !text) return null;
  const flat = text.normalize('NFKC');
  for (const { kind, re } of PATTERNS) {
    try { if (re.test(flat)) return kind; } catch { /* a pattern this runtime cannot read never passes advice */ }
  }
  return null;
}

/** Refuse text that gives securities advice (code MODEL_OUTPUT_REJECTED by default, so model callers fall back). */
export function assertNoSecuritiesAdvice(text: string, field: string, code = 'MODEL_OUTPUT_REJECTED'): void {
  const kind = securitiesAdviceIn(text);
  if (kind) throw new ChausarError(code, `The ${field} gave ${kind}. ${SECURITIES_GUARD_LINE}`);
}

type ToolShape = { name?: unknown; description?: unknown; inputSchema?: unknown };
const ORDER_NAME = /(?:^|[_.\-\s])(?:place|modify|cancel|exit|convert|square[_-]?off|submit|execute|delete)[_.\-\s]?(?:gtt[_.\-\s]?)?(?:orders?|gtt|positions?|baskets?|bracket|cover|sip|mf[_.\-\s]?orders?)(?:$|[_.\-\s])|(?:^|[_.\-\s])(?:buy|sell)[_.\-\s]?(?:stocks?|shares?|orders?|securit(?:y|ies)|options?|futures?|equity|mf)(?:$|[_.\-\s])|(?:^|[_.\-\s])(?:place|modify|cancel)[_.\-\s]?gtt/i;
const ORDER_WORDS = /\b(?:place|modify|cancel|submit|execute)s?\s+(?:an?\s+|the\s+)?(?:buy\s+or\s+sell\s+|buy\s+|sell\s+|market\s+|limit\s+|gtt\s+|bracket\s+|cover\s+)?(?:orders?|trades?)\b|\b(?:buy|sell)\s+or\s+(?:buy|sell)\s+(?:orders?|trades?)\b|\b(?:buy|sell)\s+orders?\s+for\s+(?:a\s+)?(?:stocks?|shares?|securit(?:y|ies)|options?|futures?)\b|\b(?:submit|place)\s+(?:a\s+)?(?:buy|sell)\s+(?:or\s+(?:buy|sell)\s+)?order\b/i;
const ORDER_FIELDS = ['transaction_type', 'transactiontype', 'order_type', 'ordertype', 'tradingsymbol', 'trading_symbol', 'security_id', 'securityid', 'instrument_token', 'product_type', 'producttype'];

/** A tool that places, changes or cancels broker orders, by its name, its description or its argument fields. */
export function brokerOrderTool(tool: ToolShape): boolean {
  const name = typeof tool.name === 'string' ? tool.name : '';
  const description = typeof tool.description === 'string' ? tool.description : '';
  if (ORDER_NAME.test(`_${name}_`)) return true;
  if (ORDER_WORDS.test(description)) return true;
  const properties = (tool.inputSchema as { properties?: unknown } | undefined)?.properties;
  if (properties && typeof properties === 'object') {
    const keys = Object.keys(properties).map(key => key.toLowerCase());
    const hits = ORDER_FIELDS.filter(field => keys.includes(field)).length;
    const side = keys.some(key => ['transaction_type', 'transactiontype', 'side'].includes(key));
    if (hits >= 2 || side && keys.includes('quantity')) return true;
  }
  return false;
}

/** Broker trading API hosts: their tokens carry order rights, so Chausar never connects to them. Data, checked on 1 November 2026. */
export const BROKER_TRADING_HOSTS: readonly string[] = Object.freeze([
  'kite.trade', 'kite.zerodha.com', 'upstox.com', 'dhan.co', 'groww.in', 'angelone.in', 'angelbroking.com', 'fyers.in',
  'icicidirect.com', '5paisa.com', 'kotaksecurities.com', 'kotakneo.com', 'motilaloswal.com', 'sharekhan.com', 'aliceblueonline.com',
]);

/** True when a server address belongs to a broker trading host (the host itself or any of its subdomains). */
export function brokerTradingHost(url: string): boolean {
  let host: string;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return false; }
  return BROKER_TRADING_HOSTS.some(base => host === base || host.endsWith(`.${base}`));
}

/** Always throws HARD_STOP for a broker connection with order rights. */
export function refuseBrokerConnection(what: string): never {
  throw new ChausarError('HARD_STOP', `${what} can place trades through a broker. ${SECURITIES_GUARD_LINE} This is a hard stop. No attestation or setting can unlock it.`);
}
