// Chausar 5B1 source import. FilmCraft (MIT/Apache-2.0), measured word-time concept; original code.
import { check } from '../../../contracts.ts';
import { validateEditDocument, type EditDocument } from './edit-ops.ts';
import type { YoutubeWordSource } from './records.ts';
/** An owner-imported measured word document, never timings guessed from SRT cue boundaries. */
export function wordSource(value: unknown): YoutubeWordSource {
  check(value && typeof value === 'object' && !Array.isArray(value), 'WORD_TIMES_REQUIRED', 'Import the measured word-time JSON exported by your transcription tool. SRT cue times are not word times.');
  const raw = value as Record<string, unknown>;
  check(Object.keys(raw).every(key => ['label', 'durationMs', 'words', 'micQuiet', 'systemQuiet', 'vadQuiet', 'loudness', 'vertical', 'sources'].includes(key))
    && typeof raw.label === 'string' && raw.label.length > 0 && raw.label.length <= 120 && Array.isArray(raw.words) && raw.words.length <= 5000,
  'WORD_TIMES_REQUIRED', 'Import a named word-time JSON document of at most five thousand measured words.');
  const document: EditDocument = { durationMs: raw.durationMs as number, words: structuredClone(raw.words) as EditDocument['words'], cuts: [], settings: {} };
  validateEditDocument(document);
  for (const key of ['micQuiet', 'systemQuiet', 'vadQuiet', 'loudness', 'sources']) check(raw[key] === undefined || (Array.isArray(raw[key]) && raw[key].length <= 10000), 'EDIT_INVALID', 'Audio measurements must be lists.');
  check(raw.vertical === undefined || typeof raw.vertical === 'boolean', 'EDIT_INVALID', 'The vertical setting is a yes or no.');
  return { label: raw.label, document, vadMeasured: Object.hasOwn(raw, 'vadQuiet'), micQuiet: structuredClone(raw.micQuiet ?? []) as YoutubeWordSource['micQuiet'], systemQuiet: structuredClone(raw.systemQuiet ?? []) as YoutubeWordSource['systemQuiet'],
    vadQuiet: structuredClone(raw.vadQuiet ?? []) as YoutubeWordSource['vadQuiet'], loudness: structuredClone(raw.loudness ?? []) as YoutubeWordSource['loudness'],
    vertical: raw.vertical === true, sources: structuredClone(raw.sources ?? []) as NonNullable<YoutubeWordSource['sources']> };
}
