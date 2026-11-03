import { describe, expect, it } from 'vitest';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';

// One-shot A4 (hands-on row 9), as the engine's core/about.ts: a resume PDF is read by Chausar's own PDF reader, so
// About you no longer says it needs a PDF reader set up. A PDF with no text says so plainly.
function onePagePdf(line: string): string {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>'];
  const content = `BT /F1 11 Tf 72 720 Td (${line}) Tj ET`;
  objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let text = '%PDF-1.4\n';
  objects.forEach((body, index) => { text += `${index + 1} 0 obj\n${body}\nendobj\n`; });
  return btoa(`${text}trailer\n<< /Root 1 0 R >>\n%%EOF\n`);
}

describe('fake About you: a resume PDF', () => {
  it('is read, and its words pick the field', async () => {
    const client = createFakeClient(new FakeEngine({ fresh: true }));
    const read = await client.request('venture.about.read', { attachment: { name: 'resume.pdf', kind: 'resume-pdf', contentBase64: onePagePdf('Freelance photographer in Pune. Birthday parties and shop product photos.') } });
    expect(read.family?.id).toBe('creative');
    expect(read.file).toEqual({ name: 'resume.pdf', included: true, line: null });
  });

  it('with no text in it is refused in the engine words', async () => {
    const client = createFakeClient(new FakeEngine({ fresh: true }));
    await expect(client.request('venture.about.read', { attachment: { name: 'scan.pdf', kind: 'resume-pdf', contentBase64: onePagePdf('') } }))
      .rejects.toMatchObject({ code: 'TOOL_FAILED', message: 'That PDF has no text Chausar can read. Paste a few lines about your work instead.' });
  });
});
