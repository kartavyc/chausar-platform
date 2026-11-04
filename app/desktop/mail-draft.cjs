'use strict';
// Chausar desktop (one-shot A6, the founder's answer 6): "Email it" without a connected Gmail. A mail link cannot carry
// a file, so the desktop writes a new email as an .eml file, with the invoice attached, and the owner's own mail app
// opens it; the owner checks it and presses send there. X-Unsent marks it as a draft for the mail apps that read it.
// There is no From line: the mail app fills in the owner's own account. Every header is built here from checked fields
// only: one plain address or none, a subject with no control or line-break character (CR, LF, next line, line or
// paragraph separator), encoded when it is not plain ASCII; a file name Chausar made (letters, digits and dashes, then
// .pdf or .html) with the type that goes with it. The text and the file go as base64, so nothing in them can end a part.
const { randomBytes } = require('node:crypto');
const { MAILTO_ADDRESS } = require('./ipc-contract.cjs');

const BREAKS = /[\p{Cc}\u0085\u2028\u2029]/u;
// A6 rounds 1 and 2: hidden format characters (direction marks and overrides like U+200E and U+202E, the byte order mark,
// zero-width spaces, soft hyphens) could make a subject read as something else, so they are taken out of it; a name
// pasted with one still gets its email. The two joiners Indian scripts need (U+200C, U+200D) stay.
const HIDDEN = /(?!\u{200C}|\u{200D})\p{Cf}/gu;
/** The subject as it goes in the draft: hidden marks out, white space folded to one space, as the engine folds a name. */
const cleanSubject = subject => subject.replace(HIDDEN, '').replace(/\s+/g, ' ').trim();
const FILE_NAME = /^[A-Za-z0-9-]{1,80}\.(pdf|html)$/;
const TYPES = Object.freeze({ pdf: 'application/pdf', html: 'text/html' });
const MAX_SUBJECT = 1000;
const MAX_BODY = 200_000;
const MAX_FILE = 20 * 1024 * 1024;
const failure = message => Object.assign(new Error(message), { code: 'MAIL_DRAFT_INVALID' });

/** Base64 in lines of 76, as mail expects. */
function base64Lines(bytes) {
  const text = Buffer.from(bytes).toString('base64');
  const lines = [];
  for (let at = 0; at < text.length; at += 76) lines.push(text.slice(at, at + 76));
  return lines.join('\r\n');
}

/**
 * A subject header value: short plain ASCII as it is (never with "=?", which a mail app could read as an encoded word),
 * otherwise RFC 2047 encoded words that never split a character, folded. Every line stays within 76 characters: the
 * first word carries at most 36 bytes after "Subject: " (69 characters), the others at most 45 bytes after a space (73).
 */
function subjectValue(subject) {
  if (/^[\x20-\x7e]*$/.test(subject) && subject.length <= 76 - 'Subject: '.length && !subject.includes('=?')) return subject;
  const words = [];
  let chunk = '';
  for (const character of subject) {
    if (Buffer.byteLength(chunk + character, 'utf8') > (words.length === 0 ? 36 : 45)) { words.push(chunk); chunk = ''; }
    chunk += character;
  }
  if (chunk) words.push(chunk);
  return words.map(word => `=?UTF-8?B?${Buffer.from(word, 'utf8').toString('base64')}?=`).join('\r\n ');
}

/**
 * The draft as text with CRLF line ends: { to: '' or one plain address, subject, body, attachment: { name, mimeType,
 * bytes } }. Throws MAIL_DRAFT_INVALID when any field is off; nothing is written then.
 */
function buildEml(input) {
  const { to, subject, body, attachment } = input ?? {};
  if (typeof to !== 'string' || (to !== '' && (BREAKS.test(to) || !MAILTO_ADDRESS.test(to)))) throw failure('The client\'s email address cannot go in a draft.');
  // Line breaks are refused, never folded: a subject with one is not what the engine wrote.
  if (typeof subject !== 'string' || subject.length > MAX_SUBJECT || BREAKS.test(subject)) throw failure('The subject cannot go in a draft.');
  if (typeof body !== 'string' || body.length > MAX_BODY) throw failure('The message cannot go in a draft.');
  const name = attachment?.name, match = typeof name === 'string' ? FILE_NAME.exec(name) : null;
  if (!match || attachment.mimeType !== TYPES[match[1]]) throw failure('The file cannot go in a draft.');
  if (!Buffer.isBuffer(attachment.bytes) || attachment.bytes.length === 0 || attachment.bytes.length > MAX_FILE) throw failure('The file cannot go in a draft.');
  const boundary = `chausar-${randomBytes(12).toString('hex')}`;
  const text = body.replace(/\r\n|\r|\n/g, '\r\n');
  return [
    ...(to ? [`To: ${to}`] : []),
    `Subject: ${subjectValue(cleanSubject(subject))}`,
    'X-Unsent: 1',
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(Buffer.from(text, 'utf8')),
    `--${boundary}`,
    `Content-Type: ${attachment.mimeType}; name="${name}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${name}"`,
    '',
    base64Lines(attachment.bytes),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

module.exports = Object.freeze({ buildEml, FILE_NAME, TYPES });
