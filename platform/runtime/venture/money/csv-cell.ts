// Original spreadsheet-safe CSV text cell, shared by native and browser exports.
/**
 * One CSV cell: text that a spreadsheet would run as a formula (it begins with =, +, -, @, a tab or a carriage return)
 * gets an apostrophe first; a cell with a comma, a quote or a line break is quoted, its quotes doubled.
 */
export function csvCell(value: string): string {
  const cell = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}
