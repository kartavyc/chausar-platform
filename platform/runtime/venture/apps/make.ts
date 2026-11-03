// Chausar venture launcher, mini apps (wave 6 package 6H1, D39): what the owner's AI is asked when the owner wants a
// small tool. The AI gets the owner's words (and, for a change, the current version's name and code), never client
// records: the app reads those itself, later, inside its frame, within what the owner allowed. Its answer is data: a
// name, a one-line summary and the HTML. Code checks the words here and the code in apps.ts; nothing it wrote runs
// anywhere but the frame.
import type { Json, ModelTask } from '../contracts.ts';
import { check } from '../../portable.ts';
import { modelWords } from '../records.ts';
import { APP_HTML_MAX, APP_PROTOCOL_VERSION } from './frame.ts';

export type MadeByAi = { name: string; summary: string; html: string };

const INSTRUCTIONS = [
  'You write one small web app for the owner of a small service business, as a single HTML fragment (markup, one <style> and one <script> at most).',
  'It runs inside Chausar in a locked frame with no internet: never link to or load anything from another site, never use fetch, XMLHttpRequest, WebSocket, storage, cookies, eval, new windows, forms, frames or outside fonts.',
  `The only way to reach the business is the global chausar.call(tool, arguments), which returns a Promise of the result (MCP Apps bridge, protocol ${APP_PROTOCOL_VERSION}).`,
  'Tools: clients_list {} gives {clients:[{id,name}]}. orders_list {} gives {orders:[{id,clientId,status,request}]}. invoices_list {} gives {invoices:[{id,number,clientId,status,dueDate,balance:{display,receiptId}}]}.',
  'notes_get {} gives {notes:{key:text}}; notes_set {key, value} keeps one note (value null deletes it); keys use letters, digits, dots, dashes and underscores. Use notes for anything the app records, like attendance marks.',
  'calculate {operation:"add",amounts:["100","250.50"]} or {operation:"times",amounts:["500"],count:"3"} or {operation:"percent-off",amounts:["1500"],percent:"10"} gives {figure:{label,display,receiptId}}. Amounts are the numbers the owner typed.',
  'propose {kind:"draft-reminder",invoiceId} or {kind:"draft-invoice",orderId} puts a card on the owner\'s Today page for their approval; it never sends anything. Say so on the button, for example "Ask to remind".',
  'Never write an amount of money into the code and never add up, multiply or round money yourself: show only the display text that invoices_list or calculate returned. Counts of things are fine.',
  'Use only the tools you need; the owner allows each one. Handle a refused call by showing its message.',
  'Plain English, short labels, no em dashes. Accessible markup: real buttons, table headers, labels for inputs. Keep it under 40000 characters.',
  'Answer with name (a short plain name, up to 60 characters), summary (one plain sentence) and html.',
].join('\n');

const SCHEMA: Json = {
  type: 'object', additionalProperties: false, required: ['name', 'summary', 'html'],
  properties: { name: { type: 'string' }, summary: { type: 'string' }, html: { type: 'string' } },
};

/** The AI's answer, checked as words and as a bounded string; the code checks come after, with reasons for the owner. */
export function validateMade(raw: unknown): MadeByAi {
  check(raw !== null && typeof raw === 'object' && !Array.isArray(raw), 'MODEL_OUTPUT_REJECTED', 'The app was not an object.');
  const value = raw as Record<string, unknown>;
  check(Object.keys(value).length === 3, 'MODEL_OUTPUT_REJECTED', 'The app had other fields.');
  const name = modelWords(value.name, 'name', 60);
  const summary = modelWords(value.summary, 'summary', 200);
  check(typeof value.html === 'string' && value.html.trim().length > 0 && value.html.length <= APP_HTML_MAX, 'MODEL_OUTPUT_REJECTED', 'The app code was empty or too long.');
  return { name, summary, html: value.html };
}

/** The task for the owner's AI: the owner's words, and the current version when this is a change. */
export function makeTask(ask: string, current: { name: string; html: string } | null): ModelTask<MadeByAi> {
  return {
    purpose: 'chief-chat',
    instructions: INSTRUCTIONS,
    input: { ask, current },
    schemaName: 'venture-mini-app',
    schema: SCHEMA,
    validate: validateMade,
    containsClientData: false,
    maxOutputTokens: 8192,
  };
}
