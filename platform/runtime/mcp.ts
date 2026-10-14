import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createInterface } from 'node:readline';
import { authorize, audit, check, ChausarError, hash, newId, now } from './contracts.ts';
import type { Context, State, StateStore } from './contracts.ts';
import { ActionService, canonical, current, digest, sourceAccess } from './actions.ts';
import { assertSourceAccess } from './trust.ts';

export const MCP_PROTOCOL_VERSION = '2025-11-25';
export type JSONRPCRequest = { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: any };
export type JSONRPCResponse = { jsonrpc: '2.0'; id: string | number | null; result?: unknown; error?: { code: number; message: string; data?: { code: string } } };
export type RegisteredCalculation = { name: string; description: string; inputSchema: any; calculate: (arguments_: Record<string, unknown>, context: Context) => Promise<{ value: unknown; receipt: any }> | { value: unknown; receipt: any } };
/** A read-only, number-free tool (for example the dictionary layers). It never writes, approves or evaluates expressions. */
export type RegisteredReadTool = { name: string; description: string; inputSchema: any; read: (arguments_: Record<string, unknown>, context: Context) => unknown };
type Session = { identity: string; phase: 'initializing' | 'ready'; protocol: string };
const receiptSchema = { type: 'object', additionalProperties: false, required: ['receiptId'], properties: {
  receiptId: { type: 'string', minLength: 1, maxLength: 200 },
  receiptDigest: { type: 'string', minLength: 64, maxLength: 64, pattern: '^[a-f0-9]{64}$' },
} };
const countedRowsSchema = { ...receiptSchema, required: ['receiptId', 'receiptDigest'], properties: {
  ...receiptSchema.properties, offset: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
  limit: { type: 'integer', minimum: 1, maximum: 100 },
} };
const receiptTools = [
  { name: 'open_receipt', description: 'Open an exact retained calculation receipt under current permissions. An optional digest pins the evidence.', inputSchema: receiptSchema },
  { name: 'list_counted_rows', description: 'Read at most 100 counted rows from an exact digest-pinned receipt under current permissions. This does not recalculate.', inputSchema: countedRowsSchema },
];
const permissionErrors = new Set(['ACCESS_REVOKED', 'SOURCE_REVOKED', 'BRANCH_FORBIDDEN', 'FORBIDDEN_BRANCH', 'RECEIPT_FORBIDDEN']);
const evidenceErrors = new Set(['UNVERIFIED_NUMBER', 'RECEIPT_NOT_FOUND', 'RECEIPT_CHANGED', 'RECEIPT_UNAVAILABLE', 'SOURCE_PROFILE_STALE', 'INVALID_CALCULATION', 'INVALID_PERIOD', 'INVALID_ASOF']);
function receiptSourceAccess(state: State, context: Context, sourceIds: string[]) {
  assertSourceAccess(state, context, sourceIds);
  for (const sourceId of sourceIds) check(!state.sourceRules.some(rule => (rule.sourceId === sourceId || rule.id === sourceId) && (rule.memberId === context.memberId || !rule.memberId) && (rule.active === false || rule.read === false || rule.revoked === true)), 'SOURCE_REVOKED', 'Source read permission was revoked.');
}
function validateArguments(schema: any, args: unknown): Record<string, unknown> {
  check(args && typeof args === 'object' && !Array.isArray(args) && Object.getPrototypeOf(args) === Object.prototype, 'INVALID_ARGUMENTS', 'Tool arguments must be an object.');
  const properties = schema.properties ?? {}; const input = args as Record<string, unknown>;
  check((schema.required ?? []).every((key: string) => Object.hasOwn(input, key)), 'INVALID_ARGUMENTS', 'A required calculation argument is missing.');
  if (schema.additionalProperties === false) check(Object.keys(input).every(key => Object.hasOwn(properties, key)), 'INVALID_ARGUMENTS', 'Unexpected calculation argument.');
  for (const [key, rule] of Object.entries<any>(properties)) {
    if (!Object.hasOwn(input, key)) continue; const value = input[key];
    if (rule.type === 'string') {
      check(typeof value === 'string' && value.length >= (rule.minLength ?? 0) && value.length <= (rule.maxLength ?? 2000), 'INVALID_ARGUMENTS', `${key} must be a bounded string.`);
      if (rule.pattern) check(new RegExp(rule.pattern).test(value), 'INVALID_ARGUMENTS', `${key} has an invalid format.`);
    }
    if (rule.type === 'number') check(typeof value === 'number' && Number.isFinite(value), 'INVALID_ARGUMENTS', `${key} must be a finite number.`);
    if (rule.type === 'integer') check(Number.isSafeInteger(value), 'INVALID_ARGUMENTS', `${key} must be an integer.`);
    if (rule.type === 'number' || rule.type === 'integer') check((rule.minimum === undefined || (value as number) >= rule.minimum) && (rule.maximum === undefined || (value as number) <= rule.maximum), 'INVALID_ARGUMENTS', `${key} is outside the registered bounds.`);
    if (rule.type === 'boolean') check(typeof value === 'boolean', 'INVALID_ARGUMENTS', `${key} must be a boolean.`);
    if (rule.type === 'array') check(Array.isArray(value) && value.length <= (rule.maxItems ?? 100), 'INVALID_ARGUMENTS', `${key} must be a bounded array.`);
    if (rule.type === 'object') check(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_ARGUMENTS', `${key} must be an object.`);
    if (rule.enum) check(rule.enum.includes(value), 'INVALID_ARGUMENTS', `${key} is not a registered choice.`);
  }
  return JSON.parse(canonical(input));
}
export class MCPService {
  store: StateStore; calculations: Map<string, RegisteredCalculation>; sessions: Map<string, Session>;
  receiptReader?: (context: Context, id: string) => any;
  readTools: Map<string, RegisteredReadTool> = new Map();
  constructor(store: StateStore, options: { calculations: RegisteredCalculation[]; receiptReader?: (context: Context, id: string) => any; readTools?: RegisteredReadTool[] }) {
    this.store = store; this.calculations = new Map(); this.sessions = new Map(); this.receiptReader = options.receiptReader;
    for (const c of options.calculations) { check(/^[a-z][a-z0-9_]{0,63}$/.test(c.name) && !this.calculations.has(c.name) && !receiptTools.some(tool => tool.name === c.name), 'INVALID_MCP_TOOL', 'Calculations must have unique registered tool names outside the reserved receipt tools.'); check(c.inputSchema?.type === 'object' && c.inputSchema.additionalProperties === false, 'INVALID_MCP_TOOL', 'Registered calculation arguments must have a closed object schema.'); this.calculations.set(c.name, c); }
    for (const t of options.readTools ?? []) { check(/^[a-z][a-z0-9_]{0,63}$/.test(t.name) && !this.calculations.has(t.name) && !this.readTools.has(t.name) && !receiptTools.some(tool => tool.name === t.name) && typeof t.read === 'function', 'INVALID_MCP_TOOL', 'Read tools must have unique registered names outside calculations and receipt tools.'); check(t.inputSchema?.type === 'object' && t.inputSchema.additionalProperties === false, 'INVALID_MCP_TOOL', 'Registered read tool arguments must have a closed object schema.'); this.readTools.set(t.name, t); }
  }
  scope(context: Context) { return digest({ memberId: context.memberId, role: context.role, epoch: context.epoch }); }
  receipt(context: Context, receipt: any) {
    const state = this.store.read(); const member = current(state, context); check(receipt && typeof receipt.id === 'string', 'UNVERIFIED_NUMBER', 'The calculator did not provide a stored receipt.');
    const stored = state.receipts.find(r => r.id === receipt.id); check(stored && digest(stored) === digest(receipt), 'UNVERIFIED_NUMBER', 'The result’s receipt does not match the engine ledger.');
    const memberId = receipt.memberId ?? receipt.scope?.memberId ?? receipt.context?.memberId;
    const epoch = receipt.epoch ?? receipt.scope?.epoch ?? receipt.context?.epoch;
    if (memberId !== undefined) check(memberId === context.memberId && (epoch === undefined || epoch === context.epoch), 'RECEIPT_FORBIDDEN', 'A receipt must belong to the current authenticated calculation scope.');
    else check(this.receiptReader, 'RECEIPT_FORBIDDEN', 'The calculator must verify this shared receipt against the current context.');
    check(this.receiptReader || (receipt.rowIds === undefined && receipt.rows === undefined && receipt.exclusions === undefined), 'RECEIPT_UNAVAILABLE', 'Retained row evidence requires the current calculator receipt reader.');
    const sourceIds: string[] = receipt.sourceIds ?? receipt.provenance?.sourceIds ?? [...new Set<string>((receipt.rows ?? []).map((r: any) => r.sourceId))];
    const requiredSourceIds = [...new Set<string>([...sourceIds, ...(receipt.requestedSourceIds ?? [])])];
    if (this.receiptReader) receiptSourceAccess(state, context, requiredSourceIds);
    // Owned receipts need the same current evidence, row access and readiness checks as shared receipts.
    if (this.receiptReader) check(digest(this.receiptReader({ ...context, channel: 'mcp' }, receipt.id)) === digest(stored), 'UNVERIFIED_NUMBER', 'The current calculator reader must return the exact retained receipt.');
    check(receipt.verified !== false && receipt.stale !== true && receipt.status !== 'refused' && receipt.status !== 'unverified', 'UNVERIFIED_NUMBER', 'Stale or unverified results are not exposed as numbers.');
    const latest = this.store.read(); const latestMember = current(latest, context);
    check(digest([...member.branches].sort()) === digest([...latestMember.branches].sort()), 'BRANCH_FORBIDDEN', 'Your branch permissions changed during receipt verification.');
    check(latest.receipts.filter(r => r.id === receipt.id).length === 1 && digest(latest.receipts.find(r => r.id === receipt.id)) === digest(stored), 'UNVERIFIED_NUMBER', 'The retained receipt changed during verification.');
    // The reader checks counted and excluded rows. Do not widen a scoped receipt to every branch in its source.
    if (this.receiptReader) receiptSourceAccess(latest, context, requiredSourceIds);
    else sourceAccess(latest, context, requiredSourceIds);
    return structuredClone(stored);
  }
  retainedReceipt(context: Context, args: Record<string, unknown>) {
    check(this.receiptReader, 'RECEIPT_UNAVAILABLE', 'A current calculator receipt reader is required.');
    const stored = this.store.read().receipts.find(receipt => receipt.id === args.receiptId);
    check(stored, 'RECEIPT_NOT_FOUND', 'This receipt is unavailable.'); const receipt = this.receipt(context, stored);
    const receiptDigest = digest(receipt);
    check(args.receiptDigest === undefined || args.receiptDigest === receiptDigest, 'RECEIPT_CHANGED', 'The retained receipt no longer matches the requested evidence.');
    return { receipt, receiptDigest };
  }
  async handle(context: Context, request: JSONRPCRequest, sessionId = 'local'): Promise<JSONRPCResponse | null> {
    const id = request?.id ?? null;
    try {
      authorize(this.store, context); check(request && request.jsonrpc === '2.0' && typeof request.method === 'string' && (request.id === undefined || request.id === null || typeof request.id === 'string' || (typeof request.id === 'number' && Number.isSafeInteger(request.id))), 'INVALID_RPC', 'Use a valid JSON-RPC 2.0 request.');
      check(canonical(request).length <= 65536 && typeof sessionId === 'string' && sessionId.length <= 200, 'INVALID_RPC', 'MCP requests and session IDs must be bounded.');
      const key = `${this.scope(context)}:${sessionId}`; const session = this.sessions.get(key); const respond = (result: unknown): JSONRPCResponse => ({ jsonrpc: '2.0', id, result });
      if (request.method === 'initialize') {
        check(request.id !== undefined && typeof request.params?.protocolVersion === 'string' && request.params?.clientInfo && typeof request.params.clientInfo.name === 'string' && request.params.capabilities && typeof request.params.capabilities === 'object', 'INVALID_RPC', 'Initialize must declare protocol version, capabilities and client information.');
        check(!session, 'ALREADY_INITIALIZED', 'Create a new session to initialize again.'); check(this.sessions.size < 1000, 'MCP_SESSION_LIMIT', 'Close unused MCP sessions before opening another.'); this.sessions.set(key, { identity: this.scope(context), phase: 'initializing', protocol: MCP_PROTOCOL_VERSION });
        return respond({ protocolVersion: MCP_PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'chausar-verified-numbers', version: '0.1.0' }, instructions: 'Read-only registered calculations. Every number includes its engine receipt. No writes, approvals or arbitrary expressions are exposed.' });
      }
      if (request.method === 'notifications/initialized') { check(request.id === undefined && session?.phase === 'initializing', 'NOT_INITIALIZED', 'Initialize this session first.'); session.phase = 'ready'; return null; }
      check(session?.identity === this.scope(context) && session.phase === 'ready', 'NOT_INITIALIZED', 'Complete initialize and notifications/initialized before using tools.');
      if (request.method === 'ping') return respond({});
      if (request.method.startsWith('notifications/')) return null;
      check(request.id !== undefined, 'INVALID_RPC', 'Tool requests need an ID.');
      if (request.method === 'tools/list') return respond({ tools: [...this.calculations.values(), ...(this.receiptReader ? receiptTools : []), ...this.readTools.values()].map(c => ({ name: c.name, description: c.description, inputSchema: structuredClone(c.inputSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } })) });
      if (request.method === 'tools/call') {
        check(typeof request.params?.name === 'string', 'INVALID_ARGUMENTS', 'Provide a registered calculation name.'); const calculation = this.calculations.get(request.params.name);
        const receiptTool = this.receiptReader && receiptTools.find(tool => tool.name === request.params.name);
        const readTool = !calculation && !receiptTool ? this.readTools.get(request.params.name) : undefined;
        check(calculation || receiptTool || readTool, 'UNKNOWN_TOOL', 'This read-only calculation or receipt tool is not registered.');
        const args = validateArguments((calculation || receiptTool || readTool)!.inputSchema, request.params.arguments ?? {});
        try {
          const verified = (structuredContent: unknown) => respond({ content: [{ type: 'text', text: JSON.stringify(structuredContent) }], structuredContent, isError: false });
          if (readTool) { const structuredContent = await readTool.read(args, { ...context, channel: 'mcp' }); authorize(this.store, context); return verified(structuredContent); }
          if (receiptTool) {
            const { receipt, receiptDigest } = this.retainedReceipt(context, args);
            if (receiptTool.name === 'open_receipt') return verified({ receipt, receiptDigest });
            check(Array.isArray(receipt.rows), 'UNVERIFIED_NUMBER', 'This receipt has no retained counted rows.');
            const offset = (args.offset ?? 0) as number, limit = (args.limit ?? 50) as number;
            const rows = structuredClone(receipt.rows.slice(offset, offset + limit));
            return verified({ receiptId: receipt.id, receiptDigest, offset, limit, totalRows: receipt.rows.length, rows, nextOffset: offset + rows.length < receipt.rows.length ? offset + rows.length : null });
          }
          const output = await calculation!.calculate(args, { ...context, channel: 'mcp' }); authorize(this.store, context); const receipt = this.receipt(context, output.receipt);
          check(typeof output.value === 'string' && /^-?\d+$/.test(output.value) && [receipt.totalMinor, receipt.valueMinor, ...(receipt.figures ?? []).map((figure: any) => figure.minor)].includes(output.value), 'UNVERIFIED_NUMBER', 'The exact minor-unit value must appear in its receipt.');
          return verified({ value: output.value, unit: 'minor', receipt, receiptDigest: digest(receipt) });
        }
        catch (error) {
          authorize(this.store, context);
          if (error instanceof ChausarError && permissionErrors.has(error.code)) throw new ChausarError(error.code, 'Your current permissions do not allow this calculation or receipt.');
          return respond({ content: [{ type: 'text', text: 'The requested calculation or receipt could not provide current verified evidence.' }], structuredContent: { code: error instanceof ChausarError && evidenceErrors.has(error.code) ? error.code : 'UNVERIFIED_NUMBER' }, isError: true });
        }
      }
      throw new ChausarError('METHOD_NOT_FOUND', 'This server only exposes read-only verified calculation tools.');
    } catch (error) {
      const code = error instanceof ChausarError ? error.code : 'INTERNAL_ERROR';
      if (request?.id === undefined && request?.method?.startsWith('notifications/')) return null;
      return { jsonrpc: '2.0', id, error: { code: code === 'METHOD_NOT_FOUND' ? -32601 : ['INVALID_ARGUMENTS', 'UNKNOWN_TOOL'].includes(code) ? -32602 : code === 'INVALID_RPC' ? -32600 : -32001, message: error instanceof ChausarError ? error.message : 'MCP request failed.', data: { code } } };
    }
  }
  close(context: Context, sessionId = 'local') { this.sessions.delete(`${this.scope(context)}:${sessionId}`); }
}

/** One-time phone approval tokens are narrowly bound to an exact simple message. */
export class PhoneApprovalService {
  store: StateStore; actions: ActionService; clock: () => number;
  constructor(store: StateStore, actions: ActionService, options: { clock?: () => number } = {}) { this.store = store; this.actions = actions; this.clock = options.clock ?? Date.now; }
  async issue(context: Context, actionId: string, expectedDigest: string, ttlMs = 300000) {
    check(Number.isInteger(ttlMs) && ttlMs > 0 && ttlMs <= 300000, 'INVALID_PHONE_TOKEN', 'Phone tokens expire within five minutes.'); const token = randomBytes(32).toString('base64url');
    await this.store.update(state => { current(state, context, 'approve'); check(context.role === 'owner' && !context.sourceTainted && context.channel !== 'phone', 'APP_APPROVAL_REQUIRED', 'The owner must issue the token inside the app.'); const action = this.actions.find(state, actionId); sourceAccess(state, context, action.sourceIds); check(this.actions.operation(action.connector, action.operation).impact === 'message' && action.status === 'prepared', 'PHONE_MONEY_FORBIDDEN', 'Phone tokens approve only prepared simple messages.'); check(action.digest === expectedDigest && action.digest === this.actions.identity(action), 'PREVIEW_CHANGED', 'The exact message changed.'); state.sessions.push({ id: newId('phone'), type: 'phone-approval', tokenHash: hash(token), memberId: context.memberId, role: context.role, epoch: context.epoch, actionId, digest: expectedDigest, expiresAt: new Date(this.clock() + ttlMs).toISOString(), used: false }); audit(state, 'phone.token-issued', { actionId, digest: expectedDigest }); });
    return { token, actionId, digest: expectedDigest, expiresAt: new Date(this.clock() + ttlMs).toISOString(), scope: 'simple-message-approval' };
  }
  async approve(token: string) {
    check(typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token), 'INVALID_PHONE_TOKEN', 'Invalid phone approval token.');
    const reserved = await this.store.update(state => { const tokenHash = hash(token); const session = state.sessions.find(s => s.type === 'phone-approval' && typeof s.tokenHash === 'string' && s.tokenHash.length === tokenHash.length && timingSafeEqual(Buffer.from(s.tokenHash), Buffer.from(tokenHash))); check(session && !session.used && Date.parse(session.expiresAt) > this.clock(), 'INVALID_PHONE_TOKEN', 'This token expired or was already used.'); current(state, { memberId: session.memberId, role: session.role, epoch: session.epoch }, 'approve'); check(session.role === 'owner', 'PHONE_OWNER_REQUIRED', 'Phone approval is limited to the owner.'); const action = this.actions.find(state, session.actionId); sourceAccess(state, { memberId: session.memberId, role: session.role, epoch: session.epoch }, action.sourceIds); check(this.actions.operation(action.connector, action.operation).impact === 'message' && action.digest === session.digest && action.digest === this.actions.identity(action), 'PREVIEW_CHANGED', 'The exact simple message changed.'); session.used = true; audit(state, 'phone.token-consumed', { actionId: session.actionId }); return structuredClone(session); });
    return this.actions.approve({ memberId: reserved.memberId, role: reserved.role, epoch: reserved.epoch, channel: 'phone' }, reserved.actionId, reserved.digest);
  }
}

export async function serveMCPStdio(service: MCPService, context: Context, input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout) {
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) { if (line.length > 65536) { output.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request exceeds 64 KiB.' } })}\n`); continue; } try { const response = await service.handle(context, JSON.parse(line), 'stdio'); if (response) output.write(`${JSON.stringify(response)}\n`); } catch { output.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON.' } })}\n`); } }
  service.close(context, 'stdio');
}
