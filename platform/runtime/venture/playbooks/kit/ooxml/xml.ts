// Chausar playbook kit (Ink v2 wave 5, package 5A5): the XML text rules DOCX and XLSX share. Every value is escaped,
// and characters XML 1.0 cannot carry (control characters other than tab and new line, lone surrogates, U+FFFE and
// U+FFFF) are dropped, so a stray byte never makes a file Word or Excel refuses. Written for Chausar from the XML 1.0
// specification; nothing here is learned from an outside source.

/** Characters XML 1.0 cannot carry. */
const NOT_XML = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

/** Text as XML content or an attribute value: escaped, with characters XML cannot carry dropped. */
export function xmlText(value: string): string {
  return value.replace(NOT_XML, '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch]!);
}

/** XML entities back to text: the five named ones and numeric references. */
export function xmlUnescape(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|lt|gt|amp|quot|apos);/g, (_, name: string) => {
    if (name[0] === '#') {
      const point = name[1] === 'x' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
      return point <= 0x10ffff ? String.fromCodePoint(point) : '';
    }
    return ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" } as Record<string, string>)[name]!;
  });
}

/** The XML declaration every part opens with. */
export const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
