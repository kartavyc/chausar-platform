// Chausar venture launcher, network (Ink v2 wave 4, package 4D1): the extractor. It reads one of the owner's own files
// and keeps only what Chausar keeps, as a projection: one entry per person with their name, handles and role, and per
// person totals for mail, meetings and LinkedIn messages (never one row per message). The desktop runs it in a worker
// process on the owner's computer (app/desktop/network-files.cjs and extract-worker.ts), the engine runs it again on a
// raw file as a second guard, and the hosted app can run it in the browser (4D4): it is pure, streams text in chunks of
// any size, caps line length, and refuses a file that is not text.
import type { NetworkImportKind } from '../contracts.ts';
import {
  Drops, extractError, LineSplitter, MAX_LINE_CHARS, Problems, PROJECTION_FORMAT, type ExtractOptions, type Projection,
} from './extract-core.ts';
import { connectionsReader, messagesReader, type KindReader } from './extract-linkedin.ts';
import { contactsCsvReader, vcardReader } from './extract-contacts.ts';
import { calendarReader } from './extract-calendar.ts';
import { mailReader } from './extract-mail.ts';

export { MAX_CELLS, MAX_LINE_CHARS, MAX_PEOPLE, PROJECTION_FORMAT } from './extract-core.ts';
export type { ExtractOptions, MailTally, MeetingTally, MessageTally, Projection, ProjectedPerson, Tally } from './extract-core.ts';
export { MAX_MESSAGES } from './extract-mail.ts';

function readerFor(kind: NetworkImportKind, drops: Drops, problems: Problems, options: ExtractOptions): KindReader {
  switch (kind) {
    case 'linkedin-connections': return connectionsReader(drops, problems, options);
    case 'linkedin-messages': return messagesReader(drops, problems, options);
    case 'contacts-csv': return contactsCsvReader(drops, problems, options);
    case 'vcard': return vcardReader(drops, problems, MAX_LINE_CHARS, options);
    case 'calendar-ics': return calendarReader(drops, problems, options, MAX_LINE_CHARS);
    case 'mail-headers': return mailReader(drops, problems, options);
    default: throw extractError('INVALID_VENTURE_REQUEST', 'Choose one of the files Chausar reads.');
  }
}

/**
 * An extractor for one kind of file: push text in chunks of any size, then end() for the projection. Throws (a coded
 * Error) on a line that is not text, on any line it could not read (naming the first), past the mail cap, or when a
 * messages export cannot tell who the owner is.
 */
export function createExtractor(kind: NetworkImportKind, options: ExtractOptions = {}): { push(chunk: string): void; end(): Projection } {
  const drops = new Drops(), problems = new Problems();
  const reader = readerFor(kind, drops, problems, options);
  const lines = new LineSplitter(MAX_LINE_CHARS, (text, line, long) => {
    if (text.includes('\u0000')) {
      throw extractError('NETWORK_FILE_INVALID', `Line ${line}: the file is not plain text. Save it as CSV (UTF-8) or export it again. Nothing was imported.`);
    }
    reader.line(text, line, long);
  });
  let ended = false;
  return {
    push(chunk) { if (ended) throw extractError('INVALID_VENTURE_REQUEST', 'This file was read already.'); lines.push(chunk); },
    end() {
      if (ended) throw extractError('INVALID_VENTURE_REQUEST', 'This file was read already.');
      ended = true;
      lines.end();
      const result = reader.end();
      problems.throwIfAny();
      const people = [...result.people].sort((a, b) => a.line - b.line);
      return { format: PROJECTION_FORMAT, kind, rows: result.rows, dropped: drops.list(), people };
    },
  };
}

/** The projection of a whole file held as text. */
export function extractText(kind: NetworkImportKind, text: string, options: ExtractOptions = {}): Projection {
  const extractor = createExtractor(kind, options);
  extractor.push(text);
  return extractor.end();
}
