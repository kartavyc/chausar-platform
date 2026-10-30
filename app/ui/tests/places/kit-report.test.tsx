import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import hiReport from '../../src/text/hi/kit-report.json';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError, type MethodName, type ReportView } from '../../src/engine/types';

// Work, Ink v2 wave 5 package 5A5 (P11): the client report of an accepted draft. "Make the report" asks the engine for
// the files (venture.report.render) and saves each exactly as it came; a PDF the engine did not make says why, worded
// here; "Share with your client" makes a link for the dates picked (venture.report.share), with New link and Turn off.
// Refusals are worded from the engine's codes, in English and Hindi.

type Call = { method: string; params: unknown };
interface StartOptions { language?: 'en' | 'hi'; intercept?: Partial<Record<MethodName, (params: unknown) => unknown>>; saveReport?: (runId: string) => Promise<{ saved: true; folder: string; line: string } | null> }

function start(hash: string, options: StartOptions = {}) {
  window.location.hash = hash;
  const client = createFakeClient(new FakeEngine());
  const calls: Call[] = [];
  const request = client.request.bind(client);
  client.request = ((method: MethodName, params?: unknown) => {
    calls.push({ method, params });
    const own = options.intercept?.[method];
    if (own) return Promise.resolve().then(() => own(params));
    return request(method, params as never);
  }) as typeof client.request;
  if (options.saveReport) client.saveReport = options.saveReport;
  render(<App client={client} language={options.language ?? 'en'} />);
  return { calls };
}

function catchSaves() {
  const saved: { name: string; type: string }[] = [];
  let blob: Blob | null = null;
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: (value: Blob) => { blob = value; return 'blob:chausar/1'; } });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => {} });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
    if (blob) saved.push({ name: this.download, type: blob.type });
  });
  return saved;
}

afterEach(() => {
  Reflect.deleteProperty(URL, 'createObjectURL');
  Reflect.deleteProperty(URL, 'revokeObjectURL');
  vi.restoreAllMocks();
});

/** An accepted draft the fake keeps (fixtures.ts): order o-boat-12's sponsor script. */
const ORDER = '#/work?order=o-boat-12';
const NAME = 'sponsor-script-for-episode-12';
const b64 = (text: string) => btoa(text);
/** A report as the engine sends it on the desktop: every file, no note, one prose line marked a model estimate. */
const MADE: ReportView = {
  id: 'report_1', runId: 'd-ep12-script', title: 'Sponsor script for episode 12', formats: ['html', 'pdf', 'docx', 'xlsx'],
  files: (['html', 'pdf', 'docx', 'xlsx'] as const).map((format) => ({ name: `${NAME}.${format}`, format, bytes: 4, sha256: 'a'.repeat(64), contentBase64: b64('abcd') })),
  manifest: { name: 'manifest.json', bytes: 2, sha256: 'b'.repeat(64), contentBase64: b64('{}') },
  notes: [], channels: [], period: null, estimates: 1,
};
const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const press = async (element: HTMLElement) => { await act(async () => { fireEvent.click(element); }); await settle(); };

describe('Work: the client report', () => {
  it('makes the files, saves each as the engine sent it, says why there is no PDF, and marks model estimates', async () => {
    const saved = catchSaves();
    const { calls } = start(ORDER, { intercept: { 'venture.report.render': () => MADE } });
    const region = await screen.findByRole('region', { name: 'Client report' }, { timeout: 5000 });
    const make = within(region).getByRole('button', { name: 'Make the report' });
    expect(make.getAttribute('data-variant')).toBe('primary');
    await press(make);
    expect(calls.filter((call) => call.method === 'venture.report.render').map((call) => call.params)).toEqual([{ runId: 'd-ep12-script', formats: ['html', 'pdf', 'docx', 'xlsx'] }]);
    const files = within(region).getByRole('list', { name: 'Files of Sponsor script for episode 12' });
    expect(within(files).getAllByRole('listitem').map((item) => item.getAttribute('data-report-file'))).toEqual(['html', 'pdf', 'docx', 'xlsx', null]);
    expect(region.querySelector('[data-report-estimates] [data-estimate]')).toBeTruthy();
    await press(within(files).getByRole('button', { name: `Save ${NAME}.docx` }));
    await press(within(files).getByRole('button', { name: 'Save manifest.json' }));
    expect(saved).toEqual([{ name: `${NAME}.docx`, type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }, { name: 'manifest.json', type: 'application/json' }]);
    expect(within(region).getByRole('button', { name: 'Make it again' }).getAttribute('data-variant')).toBe('quiet');
  });

  it('on the fake (as the local web app): no PDF and why; shares for the dates picked, then turns the link off', async () => {
    const { calls } = start(ORDER);
    const region = await screen.findByRole('region', { name: 'Client report' }, { timeout: 5000 });
    await press(within(region).getByRole('button', { name: 'Make the report' }));
    expect(within(region).getAllByRole('listitem').map((item) => item.getAttribute('data-report-file'))).toEqual(['html', 'docx', 'xlsx', null]);
    expect(within(region).getByText('A PDF needs the desktop app.')).toBeTruthy();
    await press(within(region).getByRole('button', { name: 'Share with your client' }));
    const form = within(region).getByRole('form', { name: 'Share the report' });
    // The sample report covers August and September on Instagram and LinkedIn: the dates start there, both channels ticked.
    expect((within(form).getByLabelText('From') as HTMLInputElement).value).toBe('2026-08-01');
    expect(within(form).getAllByRole('checkbox').map((box) => (box as HTMLInputElement).checked)).toEqual([true, true]);
    fireEvent.change(within(form).getByLabelText('From'), { target: { value: '2026-09-01' } });
    fireEvent.change(within(form).getByLabelText('To'), { target: { value: '2026-09-30' } });
    await press(within(form).getByRole('button', { name: 'Make the link' }));
    const shared = calls.filter((call) => call.method === 'venture.report.share').map((call) => call.params as Record<string, unknown>);
    expect(shared).toHaveLength(1);
    expect(shared[0]).toEqual({ reportId: expect.any(String), from: '2026-09-01', to: '2026-09-30', channels: ['instagram', 'linkedin'] });
    const links = within(region).getByRole('list', { name: 'Links to this report' });
    expect(within(links).getByText(/open only on the hosted Chausar/)).toBeTruthy();
    expect(within(links).getByText('Not opened yet')).toBeTruthy();
    // Leave the order and come back: the link is read from the engine (venture.report.list), so it can still be turned off.
    await act(async () => { window.location.hash = '#/work'; });
    await settle();
    await act(async () => { window.location.hash = ORDER; });
    const back = await screen.findByRole('region', { name: 'Client report' }, { timeout: 5000 });
    const kept = await within(back).findByRole('list', { name: 'Links to this report' });
    expect(within(kept).getByText('Not opened yet')).toBeTruthy();
    await press(within(kept).getByRole('button', { name: 'Turn off' }));
    expect(within(back).getByText('You turned this link off. It no longer opens.')).toBeTruthy();
    expect(within(back).queryByRole('button', { name: 'New link' })).toBeNull();
  });

  it('on the desktop, Save all files has the desktop make and save the report in a folder, and says where', async () => {
    const saveReport = vi.fn(async () => ({ saved: true as const, folder: NAME, line: 'Saved.' }));
    start(ORDER, { saveReport });
    const region = await screen.findByRole('region', { name: 'Client report' }, { timeout: 5000 });
    await press(within(region).getByRole('button', { name: 'Make the report' }));
    expect(within(region).queryByRole('button', { name: /^Save sponsor/ })).toBeNull();
    await press(within(region).getByRole('button', { name: 'Save all files' }));
    expect(saveReport).toHaveBeenCalledWith('d-ep12-script');
    expect(within(region).getByText(`Saved the report in the folder ${NAME}. Chausar did not send it anywhere.`)).toBeTruthy();
  });

  it("words the engine's refusal in Hindi", async () => {
    start(ORDER, {
      language: 'hi',
      intercept: { 'venture.report.render': () => { throw new EngineError('REPORT_BLOCK_UNSOURCED', 'A figure in this report has no receipt, so the report was not made. Every number a report shows comes from a receipt.'); } },
    });
    const region = await screen.findByRole('region', { name: 'क्लाइंट के लिए रिपोर्ट' }, { timeout: 5000 });
    await press(within(region).getByRole('button', { name: 'रिपोर्ट बनाएं' }));
    expect(within(region).getByRole('alert').textContent).toContain('इस ड्राफ़्ट के एक आंकड़े की रसीद नहीं है');
  });
});


it('words a desktop save failure in Hindi instead of showing its English fallback', async () => {
  const saveReport = vi.fn(async () => { throw new EngineError('EXPORT_NOT_SAVED', 'Chausar could not write there. Choose another folder.'); });
  start(ORDER, { language: 'hi', saveReport });
  const region = await screen.findByRole('region', { name: hiReport['kit-report.heading'] }, { timeout: 5000 });
  await press(within(region).getByRole('button', { name: hiReport['kit-report.make'] }));
  await press(within(region).getByRole('button', { name: hiReport['kit-report.saveAll'] }));
  expect(within(region).getByRole('alert').textContent).toContain('फ़ाइलें सेव नहीं हो सकीं। कोई दूसरा फ़ोल्डर चुनें या जगह खाली करके फिर कोशिश करें।');
  expect(within(region).getByRole('alert').textContent).not.toContain('Choose another folder');
});
