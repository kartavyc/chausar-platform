// Original tender exports after Countersign's AGPL workflow ideas only. A5 writers own the Office formats.
import {check,ChausarError} from '../../../portable.ts';
import {docxParts} from '../kit/ooxml/docx-parts.ts';
import {xlsxParts} from '../kit/ooxml/xlsx-parts.ts';
import {readXlsxParts} from '../kit/ooxml/read-parts.ts';
import type {ZipEntry} from '../kit/ooxml/zip-core.ts';
import {xmlText,xmlUnescape} from '../kit/ooxml/xml.ts';
import {csvCell} from '../../money/csv-cell.ts';
import {TENDER_KINDS,type TenderKind} from './questions.ts';
export type TenderExportRow={id:string;kind:TenderKind;question:string;answer:string};
export type IssuerTenderMap={sheet:string;questionColumn:string;answerColumn:string;firstRow:number;lastRow:number};
export type IssuerTenderRow={row:number;questionCell:string;answerCell:string;question:string;answer:string};
const decoder=new TextDecoder('utf-8',{fatal:true}),encoder=new TextEncoder();
const fail=(condition:unknown,line:string,code='TENDER_EXPORT_INVALID'):void=>check(condition,code,line);
function bounded(value:unknown,max:number):value is string{return typeof value==='string'&&!!value.trim()&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);}
function col(value:unknown):number{return typeof value==='string'&&/^[A-Z]{1,3}$/.test(value)?[...value].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1:-1;}
function attr(tag:string,name:string):string|null{const hit=new RegExp('\\s'+name+'\\s*=\\s*(["\'])(.*?)\\1').exec(tag);return hit?xmlUnescape(hit[2]!):null;}
function text(entries:readonly ZipEntry[],name:string):string{const entry=entries.find(part=>part.name===name);fail(entry,'The issuer workbook is missing a required part.');try{return decoder.decode(entry!.bytes);}catch{throw new ChausarError('TENDER_EXPORT_INVALID','Issuer workbook XML is not UTF-8.');}}
export function tenderColumnMap(raw:unknown):IssuerTenderMap{
 fail(raw&&typeof raw==='object'&&!Array.isArray(raw)&&Object.keys(raw).sort().join(',')==='answerColumn,firstRow,lastRow,questionColumn,sheet','Choose the sheet, question and answer columns, and first and last rows.','TENDER_COLUMN_MAP_REQUIRED');
 const value=raw as IssuerTenderMap;
 fail(bounded(value.sheet,31)&&col(value.questionColumn)>=0&&col(value.questionColumn)<200&&col(value.answerColumn)>=0&&col(value.answerColumn)<200&&value.questionColumn!==value.answerColumn&&Number.isSafeInteger(value.firstRow)&&Number.isSafeInteger(value.lastRow)&&value.firstRow>=1&&value.lastRow>=value.firstRow&&value.lastRow<=100000&&value.lastRow-value.firstRow<500,'Map distinct columns and at most five hundred rows.','TENDER_COLUMN_MAP_REQUIRED');return {...value};
}
function normalize(path:string):string{const parts:string[]=[];for(const piece of path.split('/')){if(piece==='.'||piece==='')continue;if(piece==='..'){if(parts.length&&parts.at(-1)!=='..')parts.pop();else parts.push(piece);}else parts.push(piece);}return parts.join('/')||'.';}
function source(entries:readonly ZipEntry[],count:number,raw:unknown){
 const map=tenderColumnMap(raw);fail(new Set(entries.map(entry=>entry.name)).size===entries.length,'The issuer workbook repeats an archive part.');
 // A5 omits directory records. Refuse that uncommon profile instead of silently dropping an untargeted entry.
 fail(count===entries.length,'This workbook archive profile needs manual filling to preserve every entry.');
 const book=text(entries,'xl/workbook.xml'),rels=text(entries,'xl/_rels/workbook.xml.rels');
 fail(!/<!DOCTYPE|<!ENTITY/i.test(book+rels),'Unsupported workbook XML declarations.');
 const sheets=[...book.matchAll(/<sheet\b[^>]*\/?\s*>/g)].filter(hit=>attr(hit[0],'name')===map.sheet);
 fail(sheets.length===1,'Choose one existing issuer sheet.','TENDER_COLUMN_MAP_REQUIRED');const id=attr(sheets[0]![0],'r:id');
 const links=[...rels.matchAll(/<Relationship\b[^>]*\/?\s*>/g)].filter(hit=>attr(hit[0],'Id')===id);
 fail(id&&links.length===1&&attr(links[0]![0],'TargetMode')!=='External','The selected sheet needs one internal workbook relationship.');
 const target=attr(links[0]![0],'Target');fail(target&&!target.includes('\\'),'The selected sheet path is unsupported.');
 const path=target!.startsWith('/')?target!.slice(1):normalize('xl/'+target);fail(path.startsWith('xl/')&&!path.includes('../'),'The selected sheet is outside this workbook.');
 const xml=text(entries,path);fail(!/<!DOCTYPE|<!ENTITY/i.test(xml),'Unsupported worksheet XML declarations.');
 const rows=readXlsxParts(entries).sheets.filter(sheet=>sheet.name===map.sheet);fail(rows.length===1,'Choose one existing issuer sheet.','TENDER_COLUMN_MAP_REQUIRED');
 const selected:IssuerTenderRow[]=[];
 for(let row=map.firstRow;row<=map.lastRow;row++){const values=rows[0]!.rows[row-1]??[],question=values[col(map.questionColumn)]??'';if(!question.trim())continue;fail(bounded(question,4000),'An issuer question is too long.');selected.push({row,questionCell:map.questionColumn+row,answerCell:map.answerColumn+row,question,answer:values[col(map.answerColumn)]??''});}
 fail(selected.length>0,'No questions were found in the mapped rows.','TENDER_COLUMN_MAP_REQUIRED');return {entries,path,xml,map,selected};
}
/** Import only after the owner explicitly maps the issuer sheet, question column, answer column and row bounds. */
export function readIssuerTenderParts(entries:readonly ZipEntry[],count:number,map:unknown):IssuerTenderRow[]{return source(entries,count,map).selected;}
function inRange(ref:string,cell:string):boolean{
 const parse=(value:string)=>{const hit=/^([A-Z]{1,3})([1-9]\d*)$/.exec(value.replace(/\$/g,''));return hit?{c:col(hit[1]),r:Number(hit[2])}:null;};
 const [a,b=a]=ref.split(':'),start=parse(a!),end=parse(b!),target=parse(cell);fail(start&&end&&target,'A worksheet cell range is unsupported.','TENDER_WORKBOOK_PROTECTED');return target!.c>=start!.c&&target!.c<=end!.c&&target!.r>=start!.r&&target!.r<=end!.r;
}
/** Fill only mapped answer cells. All other entry contents and worksheet substrings remain unchanged. */
export function fillIssuerTenderParts(entries:readonly ZipEntry[],count:number,map:unknown,answers:readonly {row:number;answer:string}[]):ZipEntry[]{
 const value=source(entries,count,map);fail(Array.isArray(answers)&&answers.length>0&&answers.length<=500&&answers.every(answer=>answer&&Object.keys(answer).sort().join(',')==='answer,row'&&Number.isSafeInteger(answer.row)&&value.selected.some(row=>row.row===answer.row)&&bounded(answer.answer,32767))&&new Set(answers.map(answer=>answer.row)).size===answers.length,'Fill distinct mapped question rows with bounded answer text.');
 fail(!/<sheetProtection\b/.test(value.xml),'The issuer worksheet is protected; fill it manually.','TENDER_WORKBOOK_PROTECTED');
 const targets=new Map(answers.map(answer=>[value.map.answerColumn+answer.row,answer.answer]));
 for(const range of value.xml.matchAll(/<(?:mergeCell|f)\b[^>]*\bref\s*=\s*(["'])(.*?)\1/g))for(const cell of targets.keys())fail(!inRange(range[2]!,cell),'A mapped answer overlaps a merged or array-formula range.','TENDER_WORKBOOK_PROTECTED');
 const seenRows=new Set<number>(),seenCells=new Set<string>(),written=new Set<string>();
 const xml=value.xml.replace(/<row\b[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g,rowXml=>{
  const opening=/^<row\b[^>]*>/.exec(rowXml)?.[0]??'',number=Number(attr(opening,'r'));fail(Number.isSafeInteger(number)&&number>0&&!seenRows.has(number),'The issuer worksheet has ambiguous row identities.');seenRows.add(number);
  const cells=[...rowXml.matchAll(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)];
  for(const cell of cells){const ref=attr(cell[0],'r');fail(ref&&/^[A-Z]{1,3}[1-9]\d*$/.test(ref)&&Number(ref.match(/\d+$/)![0])===number&&!seenCells.has(ref),'The issuer worksheet has ambiguous cell identities.');seenCells.add(ref!);}
  const ref=value.map.answerColumn+number,answer=targets.get(ref);if(answer===undefined)return rowXml;
  const old=cells.find(cell=>attr(cell[0],'r')===ref);let replacement:string;
  if(old){fail(!/<(?:\w+:)?f\b/.test(old[0]),'A mapped answer cell contains a formula; choose another column.','TENDER_WORKBOOK_PROTECTED');
   const open=/^<c\b[^>]*>/.exec(old[0])![0],inner=old[0].slice(open.length).replace(/<\/c>$/,'');fail(/\/>$/.test(open)||!inner.replace(/<(?:v|is)\b[^>]*>[\s\S]*?<\/(?:v|is)>/g,'').trim(),'The answer cell has unsupported content; fill it manually.','TENDER_WORKBOOK_PROTECTED');
   const attributes=open.replace(/^<c\b/,'').replace(/\/?\s*>$/,'').replace(/\s+t\s*=\s*(["']).*?\1/,'');replacement='<c'+attributes+' t="inlineStr"><is><t xml:space="preserve">'+xmlText(answer)+'</t></is></c>';written.add(ref);return rowXml.slice(0,old.index!)+replacement+rowXml.slice(old.index!+old[0].length);
  }
  replacement='<c r="'+ref+'" t="inlineStr"><is><t xml:space="preserve">'+xmlText(answer)+'</t></is></c>';
  const next=cells.find(cell=>col(attr(cell[0],'r')!.replace(/\d+$/,''))>col(value.map.answerColumn)),at=next?.index??rowXml.lastIndexOf('</row>');fail(at>=0,'The mapped answer row cannot be filled.');written.add(ref);return rowXml.slice(0,at)+replacement+rowXml.slice(at);
 });
 fail(written.size===answers.length,'A mapped answer row was not found.');return value.entries.map(entry=>entry.name===value.path?{...entry,bytes:encoder.encode(xml)}:entry);
}
/** Make code-owned export bytes only. The caller binds current owner approval before offering or saving them. */
export function tenderExportParts(input:{title:string;coverLines:readonly string[];rows:readonly TenderExportRow[]}):{docx:ZipEntry[];xlsx:ZipEntry[];csv:string}{
 fail(input&&bounded(input.title,300)&&Array.isArray(input.coverLines)&&input.coverLines.length<=20&&input.coverLines.every(line=>bounded(line,2000))&&Array.isArray(input.rows)&&input.rows.length>0&&input.rows.length<=500,'Use a title, bounded cover and one to five hundred tender answers.');
 fail(input.rows.every(row=>row&&bounded(row.id,200)&&TENDER_KINDS.includes(row.kind)&&bounded(row.question,4000)&&bounded(row.answer,20000))&&new Set(input.rows.map(row=>row.id)).size===input.rows.length,'Export distinct answered tender questions of an offered type.');
 const rows=[['ID','Question','Type','Answer'],...input.rows.map(row=>[row.id,row.question,row.kind,row.answer])];
 return {docx:docxParts({cover:{title:input.title,lines:input.coverLines},sections:input.rows.map(row=>({heading:row.question,paragraphs:[row.kind,row.answer]}))}),xlsx:xlsxParts({sheets:[{name:'Compliance matrix',rows}]}).map(part=>({name:part.name,bytes:encoder.encode(part.text)})),csv:'\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n'};
}
