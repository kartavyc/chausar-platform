// Original Chausar CSV reader, shared by engine and browser fake without server dependencies.
/** Read quoted CSV cells exactly, refusing malformed quoting. */
export function csvRows(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false, afterQuote = false;
  const endCell = () => { row.push(cell); cell = ''; afterQuote = false; };
  const endRow = () => { endCell(); if (row.some(value => value.trim().length)) rows.push(row); row = []; };
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
    if (quoted) {
      if (c === '"') { if (source[i + 1] === '"') { cell += '"'; i += 1; } else { quoted = false; afterQuote = true; } } else cell += c;
      continue;
    }
    if (afterQuote && c !== ',' && c !== '\n' && c !== '\r') throw new Error('Unexpected text after a quoted cell.');
    if (c === '"' && cell.length === 0) quoted = true;
    else if (c === ',') endCell();
    else if (c === '\n' || c === '\r') { if (c === '\r' && source[i + 1] === '\n') i += 1; endRow(); }
    else cell += c;
  }
  if (quoted) throw new Error('A quoted cell was cut short.');
  if (cell.length || row.length || afterQuote) endRow();
  return rows;
}
