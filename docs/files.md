# Read-only workbook reader

`platform/runtime/workbook.ts` reads an XLSX file an owner adds to an order, for the delivery agents (`venture/delivery/harness/files.ts`). `readWorkbook` reads XLSX bytes entirely in memory. It parses ZIP directories and OpenXML data with Node builtins and does not open Excel, extract files, evaluate formulas or load workbook code. A caller can read sheet names, select an exact sheet and convert that sheet's literal rows to CSV in memory.

Supported data is ordinary worksheet cells, shared strings, rich text strings, inline strings, booleans and literal cached numeric cells. Every numeric cell is returned as its original decimal text. No JavaScript floating point conversion or silent rounding occurs. Formatted Excel date serials remain serial strings. Formatting, charts, pivots, comments, merged-cell interpretation, macros, formula calculation, binary XLS/XLSB and PDF OCR are unsupported.

Limits apply before allocating the sheet grid: 2 MiB compressed workbook, 25 MiB aggregate uncompressed entries, 256 ZIP entries, 64 sheets and 100,000 actual/allocated cells. Sparse extreme coordinates, corrupt CRCs, mismatched ZIP metadata, encrypted entries, ZIP64, traversal, symbolic links and unindexed ZIP payloads are refused. The XML parser has bounded depth and nodes and refuses DTDs, custom entities, external entities, CDATA and arbitrary processing instructions. It supports only UTF-8 XML and standard character entities.

Formula cells are refused in every sheet, including an unselected sheet, even when they carry cached values. External relationship targets, data connections, macros, ActiveX and embedded files are refused. String cells that happen to begin with `=` are literal data; the internal CSV conversion never opens a spreadsheet or executes a formula. That conversion is for reading, not an Excel export feature.

The reader is tested (`platform/tests/workbook.test.ts`) against independently built stored and deflated ZIP fixtures, precise decimal strings, hostile formula, relationship and DTD inputs, CRC corruption, truncation, links, sparse allocations and declared expansion bombs. Those are made-up files; it has not been checked against a set of real business workbooks. The reader returns `coverage` and `warnings`, so a caller can say what was and was not read.

```ts
const book = readWorkbook(originalBytes, { sheet: 'Sales' });
const csv = workbookSheetToCSV(book.sheets[0]);
```
