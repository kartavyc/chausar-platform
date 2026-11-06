// Chausar venture launcher, core (wave 6, 6C2): the owner's LinkedIn data export, read for About you. Only Profile.csv
// is looked at, and from it only the headline, summary, industry and location rows (minimum data: names, address, birth
// date, handles and every other file in the export stay behind). Pure and free of Node imports, so the app can repack
// just Profile.csv before sending it, and the fake engine reads it the same way; about.ts inflates on the engine side.
import { ChausarError } from '../../portable.ts';
import { csvRows } from '../../csv.ts';
import { scanZip } from '../playbooks/kit/ooxml/zip-core.ts';
import type { PackedEntry } from '../playbooks/kit/ooxml/zip-core.ts';

export const PROFILE_MAX_BYTES = 1024 * 1024;
const PROFILE_FIELDS: readonly [string, string][] = [['Headline', 'Headline'], ['Summary', 'Summary'], ['Industry', 'Industry'], ['Geo Location', 'Location']];
const invalid = (message: string) => new ChausarError('INVALID_VENTURE_REQUEST', message);

/** Profile.csv's packed entry in the export, refused plainly when the ZIP is unreadable, has none, or it is too big. */
export function profileEntry(bytes: Uint8Array): PackedEntry {
  let entry: PackedEntry | undefined;
  try {
    entry = scanZip(bytes, { maxEntries: 5000, maxBytes: Number.MAX_SAFE_INTEGER }).entries.find(item => /(^|\/)Profile\.csv$/i.test(item.name));
  } catch {
    throw invalid('That file is not a LinkedIn data export ZIP Chausar can read.');
  }
  if (!entry) throw invalid('That ZIP has no Profile.csv. Add the data export ZIP that LinkedIn sends you.');
  if (entry.plainSize > PROFILE_MAX_BYTES) throw invalid('Profile.csv in that ZIP is larger than Chausar reads.');
  return entry;
}

/** The kept rows of Profile.csv as plain lines ("Headline: ..."), or a plain refusal. */
export function profileTextFromCsv(text: string): string {
  let rows: string[][];
  try { rows = csvRows(text); } catch { throw invalid('Profile.csv in that ZIP could not be read.'); }
  const [head, values] = rows;
  if (!head || !values) throw invalid('Profile.csv in that ZIP is empty.');
  const lines = PROFILE_FIELDS.flatMap(([column, label]) => {
    const at = head.findIndex(cell => cell.trim().toLowerCase() === column.toLowerCase());
    const value = at < 0 ? '' : (values[at] ?? '').replace(/\s+/g, ' ').trim();
    return value ? [`${label}: ${value}`] : [];
  });
  if (lines.length === 0) throw invalid('Profile.csv in that ZIP has no headline, summary or industry to read.');
  return lines.join('\n');
}
