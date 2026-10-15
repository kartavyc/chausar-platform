// Chausar venture launcher, package P2 (models): the content check for client data.
// The containsClientData flag on a task is the first guard. This is the second: it looks at the exact text
// about to be sent under standing consent, so a package that forgets the flag still cannot send client data.
import type { State } from '../../contracts.ts';

export type ClientDataFinding = { kind: 'client-email' | 'client-name' | 'order-request' | 'edited-draft'; recordId: string };

const WINDOW = 40;
/** Client texts shorter than one window are checked whole once they reach this length. */
const SHORT_TEXT_MIN = 20;
const MAX_DECODE_NODES = 20000;

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The text strings inside a JSON payload, decoded, including JSON nested inside strings (the user message of a
 * provider body is itself JSON text). Client text with quotes or new lines is escaped in the raw payload; this
 * view catches it anyway.
 */
function decodedStrings(payloadText: string): string {
  const out: string[] = [];
  let nodes = 0;
  const visit = (value: unknown, depth: number): void => {
    if (++nodes > MAX_DECODE_NODES) return;
    if (typeof value === 'string') {
      out.push(value);
      if (depth < 4) {
        const brace = value.search(/[[{]/);
        if (brace >= 0) parse(value.slice(brace), depth + 1);
      }
      return;
    }
    if (Array.isArray(value)) { for (const item of value) visit(item, depth); return; }
    if (value && typeof value === 'object') for (const item of Object.values(value)) visit(item, depth);
  };
  const parse = (text: string, depth: number): void => {
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { return; }
    visit(parsed, depth);
  };
  parse(payloadText, 0);
  return out.join('\n');
}

function windowsOf(text: string, into: Set<string>) {
  for (let index = 0; index + WINDOW <= text.length; index += 1) into.add(text.slice(index, index + WINDOW));
}

/**
 * What client data the payload holds, without repeating it: every venture client email (any case), every client
 * name of four or more characters (case-sensitive, as a whole word), and any 40-character window of an order
 * request or an edited delivery draft (lower-cased, whitespace runs collapsed). Client texts shorter than 40
 * characters but at least 20 are checked whole.
 */
export function clientDataFindings(payloadText: string, state: State): ClientDataFinding[] {
  const findings: ClientDataFinding[] = [];
  const haystacks = [payloadText, decodedStrings(payloadText)];
  const lowered = haystacks.map(text => text.toLowerCase());
  const collapsed = haystacks.map(text => text.replace(/\s+/g, ' '));
  const normalized = haystacks.map(normalize);
  const records = Array.isArray(state.conversations) ? state.conversations : [];

  for (const client of records.filter(record => record?.kind === 'venture-client')) {
    const email = typeof client.email === 'string' ? client.email.trim().toLowerCase() : '';
    if (email && lowered.some(text => text.includes(email))) findings.push({ kind: 'client-email', recordId: client.id });
    const name = typeof client.name === 'string' ? client.name.trim() : '';
    if (name.length >= 4) {
      const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${name.split(/\s+/).map(escapeRegExp).join('\\s+')}(?![\\p{L}\\p{N}_])`, 'u');
      if (collapsed.some(text => pattern.test(text))) findings.push({ kind: 'client-name', recordId: client.id });
    }
  }

  const clientTexts: { kind: 'order-request' | 'edited-draft'; recordId: string; text: string }[] = [];
  for (const record of records) {
    if (record?.kind === 'venture-order' && typeof record.request === 'string') clientTexts.push({ kind: 'order-request', recordId: record.id, text: record.request });
    if (record?.kind === 'venture-delivery-run' && typeof record.editedText === 'string') clientTexts.push({ kind: 'edited-draft', recordId: record.id, text: record.editedText });
  }
  if (clientTexts.length) {
    const windows = new Set<string>();
    for (const text of normalized) windowsOf(text, windows);
    for (const item of clientTexts) {
      const text = normalize(item.text).trim();
      let found = false;
      if (text.length >= WINDOW) {
        for (let index = 0; index + WINDOW <= text.length && !found; index += 1) found = windows.has(text.slice(index, index + WINDOW));
      } else if (text.length >= SHORT_TEXT_MIN) {
        found = normalized.some(haystack => haystack.includes(text));
      }
      if (found) findings.push({ kind: item.kind, recordId: item.recordId });
    }
  }
  return findings;
}
