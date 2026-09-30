# Read-only workbook import

`WorkbookReader` reads XLSX bytes entirely in memory. It parses ZIP directories and OpenXML data with Node builtins and does not open Excel, extract files, evaluate formulas or load workbook code. The engine can show sheet names, let the user select an exact sheet, convert that sheet's literal rows to CSV in memory, and run the existing mapping-language preview, date/currency normalization and source-total reconciliation before committing facts.

Supported data is ordinary worksheet cells, shared strings, rich text strings, inline strings, booleans and literal cached numeric cells. Every numeric cell is returned as its original decimal text. No JavaScript floating point conversion or silent rounding occurs. Source import still requires explicit money/date rules: an amount with unsupported precision is refused by those rules. Formatted Excel date serials remain serial strings; choose a literal date column or normalize it explicitly in a reviewed source recipe. Formatting, charts, pivots, comments, merged-cell interpretation, macros, formula calculation, binary XLS/XLSB and PDF OCR are unsupported.

Limits apply before allocating the sheet grid: 2 MiB compressed workbook, 25 MiB aggregate uncompressed entries, 256 ZIP entries, 64 sheets and 100,000 actual/allocated cells. Sparse extreme coordinates, corrupt CRCs, mismatched ZIP metadata, encrypted entries, ZIP64, traversal, symbolic links and unindexed ZIP payloads are refused. The XML parser has bounded depth and nodes and refuses DTDs, custom entities, external entities, CDATA and arbitrary processing instructions. It supports only UTF-8 XML and standard character entities.

Formula cells are refused in every sheet, including an unselected sheet, even when they carry cached values. External relationship targets, data connections, macros, ActiveX and embedded files are refused. String cells that happen to begin with `=` are literal data; the internal CSV conversion never opens a spreadsheet or executes a formula. That conversion is an ingestion adapter, not an Excel export feature.

This native reader is tested against independently constructed stored and deflated ZIP fixtures, precise decimal strings, hostile formula/relationship/DTD inputs, CRC corruption, truncation, links, sparse allocations and declared expansion bombs. It remains experimental until real business workbooks pass the independent hidden acceptance set. The reader returns `coverage` and `warnings` so the preview can make these limits visible before import.

```ts
const book = readWorkbook(originalBytes, { sheet: 'Sales' });
const csv = workbookSheetToCSV(book.sheets[0]);
// Run csv through ImportService.preview using the same reviewed recipe and expected totals.
```
