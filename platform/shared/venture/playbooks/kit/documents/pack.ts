// Chausar playbook kit (wave 6, 6E4): one export pack made by code from a title, cover lines, sections and tables: a
// Word document, a workbook and a spreadsheet-safe CSV. Shared by the tender desk (its response pack and compliance
// matrix) and the document desk (handbooks, SOPs, project reports, estimates). Pure parts only: the caller zips them
// (kit/ooxml/browser.ts storedZipBytes gives the same bytes in the engine and the fake). Written for Chausar from the
// published Office Open XML format; nothing here is learned from an outside source.
import { docxParts } from '../ooxml/docx-parts.ts';
import { xlsxParts } from '../ooxml/xlsx-parts.ts';
import type { XlsxSheet } from '../ooxml/xlsx-parts.ts';
import type { ZipEntry } from '../ooxml/zip-core.ts';
import { csvCell } from '../../../money/csv-cell.ts';

const encoder=new TextEncoder();
export type PackSection={heading:string;paragraphs:readonly string[]};

/** Rows as a spreadsheet-safe CSV with a byte order mark and CRLF lines. */
export function csvText(rows:readonly (readonly string[])[]):string{return '﻿'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';}
/** Workbook parts as zip entries. */
export function xlsxEntries(sheets:readonly XlsxSheet[]):ZipEntry[]{return xlsxParts({sheets}).map(part=>({name:part.name,bytes:encoder.encode(part.text)}));}
/** Word document parts for a cover and sections. */
export function docxEntries(title:string,coverLines:readonly string[],sections:readonly PackSection[]):ZipEntry[]{return docxParts({cover:{title,lines:coverLines},sections});}
