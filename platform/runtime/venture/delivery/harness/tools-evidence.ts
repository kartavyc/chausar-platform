// Chausar delivery harness: the evidence ledger fed by an agent (Ink v2 wave 2, package 2G). On a real order the agent
// notes a fact about the order's client or the business and says where it came from: a file it read (document), a
// calculator receipt from this run (tool-verified), or its own reading (model-inferred). Code looks for the call that
// backs the claim in the run's own trace, never in what the agent says: the first files.read of that file whose answer
// shows the value, or the calculator call that made that receipt when the receipt holds the value. A claim nothing
// backs is kept as the AI's own reading, weak and flagged, and the ledger checks every claim again against the stored
// trace (evidence/ledger.ts). The run stores the notes in the same transaction as its tables and receipts, always as
// suggestions: a real order is latched from its first turn (policy/taint.ts), so even a value two files verify waits
// for the owner to apply it. It writes only Chausar's own ledger, never a client record on its own: policy/effects.ts
// declares that write, and the taint latch lets it through as an internal suggestion (INTERNAL_SUGGESTIONS). Any agent
// may hold it (patches.ts toolCeiling). A rehearsal or an improvement run works on made-up clients: it keeps nothing.
import { ChausarError } from '../../../contracts.ts';
import type { VentureTx } from '../../records.ts';
import type { EvidenceRecord, ToolCallRecord, ToolName } from '../../contracts.ts';
import { evidenceFieldOk, evidenceValue, fitsClientField, recordEvidence } from '../../evidence/ledger.ts';
import { backs, EVIDENCE_TYPE_IDS, type EvidenceType } from '../../evidence/types.ts';
import { fail, fileOf, text, type EvidenceNote, type Spec, type ToolEnv } from './tools.ts';

type EvidenceToolName = Extract<ToolName, 'evidence.record'>;

/** The types an agent may claim. That the owner typed a value is never the agent's to say. */
const AGENT_TYPES: readonly EvidenceType[] = Object.freeze(EVIDENCE_TYPE_IDS.filter(type => type !== 'owner-entered'));
const KEPT = 'Kept as a suggestion. The owner decides on Today; nothing changes until then.';
/** What the agent reads back when nothing in the run backs its claim. */
const UNBACKED: Readonly<Record<EvidenceType, string>> = Object.freeze({
  'owner-entered': '',
  document: 'No file read in this run shows this value, so it is kept as your own reading, unchecked.',
  'tool-verified': 'No calculator receipt from this run holds this value, so it is kept as your own reading, unchecked.',
  'web-page': 'Chausar has no web tool yet, so it is kept as your own reading, unchecked.',
  'model-inferred': 'Kept as your own reading, unchecked.',
});

/** Lower case, with every run of space as one: a value matches however a page wraps or capitalises it. */
const plain = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const SYNTAX = /[.*+?^${}()|[\]\\]/g;

/** Objects in a list of an answer, or none. */
function entries(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object' && !Array.isArray(item)) : [];
}

/**
 * The client's own words in a files.read answer: a PDF's page text, a transcript's timed lines and a table's row cells.
 * Never Chausar's own words: the reader's coverage line, file, table, row and segment ids, column names, the amounts and
 * dates Chausar picked out, or a count of rows.
 */
function clientWords(result: unknown): string[] {
  if (result === null || typeof result !== 'object') return [];
  const answer = result as { pages?: unknown; segments?: unknown; rows?: unknown; sample?: unknown };
  const words: string[] = [];
  for (const page of entries(answer.pages)) if (typeof page.text === 'string') words.push(page.text);
  for (const segment of entries(answer.segments)) if (typeof segment.text === 'string') words.push(segment.text);
  for (const row of [...entries(answer.rows), ...entries(answer.sample)]) {
    for (const [column, cell] of Object.entries(row)) if (column !== 'id' && typeof cell === 'string') words.push(cell);
  }
  return words;
}

/**
 * Whether one page, line or cell shows the value as whole words: nothing that is a letter or a digit right before or
 * right after it, so "or" is not found in "Order form". A value never matches across two cells.
 */
function shows(result: unknown, value: string): boolean {
  const wanted = plain(value);
  if (!wanted) return false;
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${wanted.replace(SYNTAX, '\\$&')}(?![\\p{L}\\p{N}])`, 'u');
  return clientWords(result).some(item => pattern.test(plain(item)));
}

/** The file number a files.read call read from, a sheet of it included, or 0. Reading only the column names reads no value. */
function fileReadBy(call: ToolCallRecord): number {
  const input = call.input as { target?: unknown; part?: unknown } | null;
  if (call.tool !== 'files.read' || !input || typeof input.target !== 'string' || input.part === 'columns') return 0;
  const match = /^f(\d{1,2})(?:\.s\d{1,2})?$/.exec(input.target);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * The id of the earlier call in this run that backs the claim, or null. A document: the first read of that file whose
 * answer shows the value, so reading one file twice is still one source. A calculator value: the call that made that
 * receipt, when the receipt holds the value as one of its figures. Each must be a call the ledger accepts (types.ts backs).
 */
function backingCall(env: ToolEnv, type: EvidenceType, from: string | undefined, value: string): string | null {
  if (from === undefined || type === 'model-inferred') return null;
  const calls = env.calls ?? [];
  const file = /^f\d{1,2}$/.test(from) ? fileOf(env, from) : null;
  const receiptNumber = /^w(\d{1,2})$/.exec(from);
  if (!file && !receiptNumber) fail('from names a file you read, such as f1, or a calculator receipt from this run, such as w1.');
  if (file) {
    if (type !== 'document') return null;
    const number = env.files.indexOf(file) + 1;
    return calls.find(call => backs('document', call) && fileReadBy(call) === number && shows(call.envelope.ok ? call.envelope.result : null, value))?.id ?? null;
  }
  const receipt = env.receipts[parseInt(receiptNumber![1], 10) - 1];
  if (!receipt) fail(`There is no receipt ${from}. The receipts are: ${env.receipts.map((_, index) => `w${index + 1}`).join(', ') || 'none'}.`);
  if (type !== 'tool-verified') return null;
  const made = calls.find(call => call.receiptIds.includes(receipt!.id));
  return made && backs('tool-verified', made) && receipt!.figures.some(figure => plain(figure.display) === plain(value)) ? made.id : null;
}

export const EVIDENCE_TOOLS: Readonly<Record<EvidenceToolName, Spec>> = Object.freeze({
  'evidence.record': {
    // The coarse label (ToolEffect) has no word for an internal suggestion: 'outside-write' would put the step on the
    // always-ask floor and is refused on agent steps. Its real effect is declared in policy/effects.ts (a write to
    // Chausar's own ledger), and the run view names the call by what it did ("Noted where a client fact came from",
    // views/runs.ts), never as a read.
    name: 'evidence.record', effect: 'read', tier: 'code', endsTurn: false,
    summary: "Notes one fact about this order's client or your own business and where it came from: a file you read (document, from f1), a calculator receipt (tool-verified, from w1) or your own reading (model-inferred). Code checks the source; the owner decides whether to use it.",
    input: {
      subject: text("client for this order's client, or business for your own business.", 40),
      field: text('The field, such as name, email, note, gstin or offer_1.name: one short name with no spaces.', 60),
      value: text('The value exactly as the source shows it.', 500),
      type: { type: 'enum', required: true, values: AGENT_TYPES, about: 'Where it came from: document, tool-verified, web-page or model-inferred.' },
      from: text('For document, the file you read, such as f1. For tool-verified, the receipt, such as w1.', 12, false),
      source: text('A few plain words on where in it, such as invoice page 1.', 120, false),
    },
    async run(env, input) {
      const subject = input.subject.trim().toLowerCase();
      if (subject !== 'client' && subject !== 'business') fail("Note facts only about this order's client (subject client) or your own business (subject business).");
      // The ledger's own checks, so the agent is told "recorded" only for a note the ledger keeps (evidence/ledger.ts).
      if (!evidenceFieldOk(input.field)) fail('field is one short name with no spaces that starts with a letter, such as email, gstin or offer_1.name, and is not a name every record already has, such as toString.');
      // The secret screen (W1 H17) before anything is kept or echoed: a key pasted as a value never reaches the ledger.
      const value = evidenceValue(input.value);
      if (!value) fail('value is empty.');
      if (subject === 'client' && !fitsClientField(input.field, value)) fail(`This ${input.field} is not one Chausar can keep for a client.`);
      // Made-up clients: nothing is kept, and nothing is shown to the owner.
      if (env.runRef.kind !== 'delivery') return { result: { recorded: false, practice: true } };
      const type = input.type as EvidenceType;
      const backedBy = backingCall(env, type, input.from, value);
      const note: EvidenceNote = { subject, field: input.field, value, type, backedBy, source: input.source ?? null };
      return {
        result: { recorded: true, applied: false, checked: backedBy !== null, backedBy, note: backedBy !== null ? KEPT : `${UNBACKED[type]} ${KEPT}` },
        evidence: [note],
      };
    },
  },
});

/**
 * Stores the facts one turn noted, inside the run's own transaction and after the run's record holds this turn's
 * calls, so the ledger checks each claim again against the stored trace. Always as suggestions (noAutoApply): the run
 * read a client's file, so only the owner applies a value. A note the ledger refuses is left out; the run goes on.
 */
export function storeRunEvidence(tx: VentureTx, notes: readonly EvidenceNote[], run: { runId: string; clientId: string }): EvidenceRecord[] {
  const kept: EvidenceRecord[] = [];
  for (const note of notes) {
    try {
      kept.push(recordEvidence(tx, {
        subject: note.subject === 'client' ? `client:${run.clientId}` : 'business', field: note.field, value: note.value, type: note.type,
        by: 'agent', runId: run.runId, toolCallId: note.backedBy, ...(note.source ? { source: note.source } : {}), noAutoApply: true,
      }));
    } catch (error) {
      if (!(error instanceof ChausarError)) throw error;
    }
  }
  return kept;
}
