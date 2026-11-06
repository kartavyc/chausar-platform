// Chausar playbook kit (Ink v2 wave 5, package 5A5, P11): a Word document (.docx) made by code: a cover (a title and a
// few lines) and sections (a heading and paragraphs), text only. The smallest set of parts Word, LibreOffice and Google
// Docs open: content types, the package relationship, the document, its styles. Every value is XML-escaped; a line
// break inside a paragraph is a break, not a new paragraph. The same input gives the same bytes. Written for Chausar
// from the published Office Open XML format (ECMA-376); nothing here is learned from an outside source.
import { ChausarError } from '../../../../portable.ts';
import { XML_HEAD, xmlText } from './xml.ts';
import type {ZipEntry} from './zip-core.ts';

/** What a document holds: the cover's title and lines, then each section's heading and paragraphs. */
export type DocxInput = {
  cover: { title: string; lines?: readonly string[] };
  sections: readonly { heading: string; paragraphs: readonly string[] }[];
};

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
/** The most paragraphs one document takes: a report, a cover letter or a tender answer is far smaller. */
const MAX_PARAGRAPHS = 20_000;

function paragraph(text: string, style: 'Title' | 'Subtitle' | 'Heading1' | null): string {
  const runs = text.split('\n').map((line, index) => `${index ? '<w:br/>' : ''}<w:t xml:space="preserve">${xmlText(line)}</w:t>`).join('');
  return `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r>${runs}</w:r></w:p>`;
}

const STYLES = `${XML_HEAD}<w:styles xmlns:w="${W}">`
  + '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Nirmala UI"/><w:sz w:val="22"/><w:lang w:val="en-IN" w:bidi="hi-IN"/></w:rPr></w:rPrDefault>'
  + '<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
  + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
  + '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="44"/></w:rPr></w:style>'
  + '<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:rPr><w:color w:val="595959"/></w:rPr></w:style>'
  + '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="320"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style>'
  + '</w:styles>';

/**
 * The .docx bytes for a cover and sections. Refuses (OOXML_INVALID) a document with no title or more than 20,000
 * paragraphs. Characters XML cannot carry are dropped, never sent.
 */
export function docxParts(input: DocxInput): ZipEntry[] {
  const title = typeof input?.cover?.title === 'string' ? input.cover.title.trim() : '';
  if (!title) throw new ChausarError('OOXML_INVALID', 'A document needs a title.');
  const body: string[] = [paragraph(title, 'Title'), ...(input.cover.lines ?? []).map(line => paragraph(line, 'Subtitle'))];
  for (const section of input.sections ?? []) {
    body.push(paragraph(section.heading, 'Heading1'));
    for (const text of section.paragraphs) body.push(paragraph(text, null));
  }
  if (body.length > MAX_PARAGRAPHS) throw new ChausarError('OOXML_INVALID', 'This document is too long for one file. Split it into parts.');
  const document = `${XML_HEAD}<w:document xmlns:w="${W}" xmlns:r="${REL}"><w:body>${body.join('')}`
    + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>';
  const types = `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>';
  const rels = `${XML_HEAD}<Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`;
  const documentRels = `${XML_HEAD}<Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${REL}/styles" Target="styles.xml"/></Relationships>`;
  const utf8 = (text: string) => new TextEncoder().encode(text);
  return [
    { name: '[Content_Types].xml', bytes: utf8(types) },
    { name: '_rels/.rels', bytes: utf8(rels) },
    { name: 'word/document.xml', bytes: utf8(document) },
    { name: 'word/_rels/document.xml.rels', bytes: utf8(documentRels) },
    { name: 'word/styles.xml', bytes: utf8(STYLES) },
  ];
}
