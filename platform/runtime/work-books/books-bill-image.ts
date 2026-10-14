/**
 * A bill photo (JPEG or PNG) wrapped as a one-page PDF in memory, so the installed local
 * reader (`pdf.ocr` in the Python helper: render the page, then tesseract) can read it. The
 * image bytes are never interpreted beyond their headers and pixel rows; nothing is written to
 * disk. A layout this file cannot carry refuses `IMAGE_OCR_NOT_AVAILABLE`.
 */
import { inflateSync, deflateSync } from 'node:zlib';
import { check } from '../contracts.ts';

const MAX_PIXELS = 25_000_000;
/** Page size in points for the image's pixels: the image is treated as a 150 dpi scan. */
const POINTS_PER_PIXEL = 72 / 150;
type Raster = { width: number; height: number; colorSpace: string; bits: number; filter: string; parms: string | null; data: Buffer };
const refuse = (): never => { check(false, 'IMAGE_OCR_NOT_AVAILABLE', 'This picture cannot be read by the local reader. Save it as a JPEG or PNG, or as a PDF.'); throw new Error('unreachable'); };

function jpeg(bytes: Buffer): Raster {
  check(bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8, 'INVALID_BILL_FILE', 'This file is not a JPEG picture.');
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) break;
    const marker = bytes[at + 1]; const length = bytes.readUInt16BE(at + 2);
    // Baseline, extended and progressive frames carry the size and the number of colour components.
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      const height = bytes.readUInt16BE(at + 5), width = bytes.readUInt16BE(at + 7), components = bytes[at + 9];
      check(width > 0 && height > 0 && width * height <= MAX_PIXELS && [1, 3].includes(components), 'IMAGE_OCR_NOT_AVAILABLE', 'This picture cannot be read by the local reader.');
      return { width, height, colorSpace: components === 1 ? '/DeviceGray' : '/DeviceRGB', bits: 8, filter: '/DCTDecode', parms: null, data: bytes };
    }
    at += 2 + length;
  }
  return refuse();
}

function paeth(a: number, b: number, c: number) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
function png(bytes: Buffer): Raster {
  check(bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'INVALID_BILL_FILE', 'This file is not a PNG picture.');
  let at = 8; let header: Buffer | null = null; let palette: Buffer | null = null; const chunks: Buffer[] = [];
  while (at + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(at); const type = bytes.toString('latin1', at + 4, at + 8); const body = bytes.subarray(at + 8, at + 8 + length);
    check(body.length === length, 'INVALID_BILL_FILE', 'This PNG picture is cut short.');
    if (type === 'IHDR') header = body; else if (type === 'PLTE') palette = body; else if (type === 'IDAT') chunks.push(body); else if (type === 'IEND') break;
    at += 12 + length;
  }
  check(header && header.length === 13 && chunks.length > 0, 'INVALID_BILL_FILE', 'This PNG picture has no image data.');
  const width = header.readUInt32BE(0), height = header.readUInt32BE(4), depth = header[8], type = header[9], interlace = header[12];
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[type] ?? 0;
  if (!(depth === 8 && channels && interlace === 0 && width > 0 && height > 0 && width * height <= MAX_PIXELS && (type !== 3 || palette))) refuse();
  let raw: Buffer;
  try { raw = inflateSync(Buffer.concat(chunks), { maxOutputLength: (width * channels + 1) * height }); } catch { return refuse(); }
  const stride = width * channels; check(raw.length === (stride + 1) * height, 'INVALID_BILL_FILE', 'This PNG picture is cut short.');
  // Undo the per-row filters, then drop any alpha channel; the colour of each pixel is kept.
  const keep = type === 4 ? 1 : type === 6 ? 3 : channels; const out = Buffer.alloc(width * keep * height); let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]; const row = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? row[x - channels] : 0, b = previous[x], c = x >= channels ? previous[x - channels] : 0;
      row[x] = (row[x] + (filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : filter === 4 ? paeth(a, b, c) : 0)) & 0xff;
    }
    if (filter > 4) refuse();
    for (let p = 0; p < width; p++) for (let k = 0; k < keep; k++) out[(y * width + p) * keep + k] = row[p * channels + k];
    previous = row;
  }
  const colorSpace = type === 3 ? `[/Indexed /DeviceRGB ${palette!.length / 3 - 1} <${palette!.toString('hex')}>]` : keep === 1 ? '/DeviceGray' : '/DeviceRGB';
  return { width, height, colorSpace, bits: 8, filter: '/FlateDecode', parms: null, data: deflateSync(out) };
}

/** One page, one image filling it. Offsets in the cross-reference table are exact. */
export function imageAsPdf(bytes: Buffer, mime: 'image/png' | 'image/jpeg'): Buffer {
  const image = mime === 'image/jpeg' ? jpeg(bytes) : png(bytes);
  const w = Math.max(1, Math.round(image.width * POINTS_PER_PIXEL)), h = Math.max(1, Math.round(image.height * POINTS_PER_PIXEL));
  const content = Buffer.from(`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q\n`, 'latin1');
  const objects: Buffer[] = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'latin1'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>', 'latin1'),
    Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`, 'latin1'),
    Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace ${image.colorSpace} /BitsPerComponent ${image.bits} /Filter ${image.filter}${image.parms ?? ''} /Length ${image.data.length} >>\nstream\n`, 'latin1'), image.data, Buffer.from('\nendstream', 'latin1')]),
    Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`, 'latin1'), content, Buffer.from('endstream', 'latin1')]),
  ];
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')]; const offsets: number[] = []; let length = parts[0].length;
  objects.forEach((body, i) => { offsets.push(length); const part = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), body, Buffer.from('\nendobj\n', 'latin1')]); parts.push(part); length += part.length; });
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`;
  parts.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(parts);
}
