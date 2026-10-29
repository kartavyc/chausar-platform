// Source adapters for the shared lexical claim checker. The browser-safe core retains the original algorithm.
import type {Deliverable,HarnessState} from '../../contracts.ts';
import {tablesOfFile,type FileLike} from '../harness/files.ts';
import type {SourceText} from './claim-check-core.ts';
export * from './claim-check-core.ts';

/** The model's words in a draft reply: the title, each text part and each question. Figures code renders from receipts are left out. */
export function deliverableWords(deliverable: Deliverable): string {
  const pieces = [deliverable.title];
  for (const section of deliverable.sections) for (const part of section.parts) if (part.kind === 'text') pieces.push(part.text);
  return [...pieces, ...deliverable.questionsForClient].join('\n');
}

/**
 * The client's spreadsheet files as sources, whole, one row per line. A PDF is left out here: its text reaches the
 * sources through the files.read results the agent asked for (see sourcesFromRun).
 */
export function sourcesFromFiles(files: readonly FileLike[]): SourceText[] {
  const sources: SourceText[] = [];
  for (const file of files) {
    if (file.format === 'pdf') continue;
    let tables: ReturnType<typeof tablesOfFile>;
    try { tables = tablesOfFile(file); } catch { continue; }
    for (const table of tables) {
      sources.push({ id: table.id, text: [table.name, table.columns.join(','), ...table.rows.map(row => table.columns.map(column => row.cells[column] ?? '').join(','))].join('\n') });
    }
  }
  return sources;
}

/** A run's sources: the client's message, every successful tool result, the calculator's receipts and any extra files. */
export function sourcesFromRun(input: {
  clientRequest?: string;
  harness?: HarnessState | null;
  receipts?: readonly { id: string; explanation?: string; figures?: readonly { label: string; display: string }[] }[];
  extra?: readonly SourceText[];
}): SourceText[] {
  const sources: SourceText[] = [];
  if (input.clientRequest) sources.push({ id: 'client-message', text: input.clientRequest });
  for (const call of input.harness?.toolCalls ?? []) if (call.envelope.ok) sources.push({ id: call.id, text: JSON.stringify(call.envelope.result) ?? '' });
  for (const receipt of input.receipts ?? []) {
    sources.push({ id: receipt.id, text: [receipt.explanation ?? '', ...(receipt.figures ?? []).map(figure => `${figure.label}: ${figure.display}`)].join('\n') });
  }
  return [...sources, ...(input.extra ?? [])];
}
