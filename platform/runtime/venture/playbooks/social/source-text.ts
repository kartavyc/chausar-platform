// Original Chausar source decoding. Transcript timestamps are never source claims.
import { parseTranscript } from '../youtube/transcript.ts';
import { csvRows } from '../../../csv.ts';
export function socialSourceText(format: string, raw: string): string {
    if (format === 'transcript')
        return parseTranscript(raw).map(cue => cue.text).join('\n');
    if (format === 'csv') {
        const rows = csvRows(raw), column = rows[0]?.findIndex(name => ['text', 'source', 'content'].includes(name.trim().toLowerCase())) ?? -1;
        if (column >= 0)
            return rows.slice(1).map(row => row[column] ?? '').join('\n');
    }
    throw Object.assign(new Error('Use a source transcript or a CSV with a text, source or content column.'), { code: 'SOCIAL_SOURCE_INVALID' });
}
