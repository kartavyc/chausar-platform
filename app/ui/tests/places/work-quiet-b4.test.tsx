import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { RunSheetView } from '../../src/parts/RunSheet';
import { RUNS } from '../../src/engine/fixtures';
import { assertOnePrimaryPerView } from '../helpers/ink-rules';

const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); };
async function open(empty = false) {
  const client = createFakeClient(new FakeEngine({ now: () => '2026-10-23T13:35:00.000Z' }));
  const request = client.request.bind(client);
  if (empty) client.request = ((method, params) => method === 'venture.runs.list' ? Promise.resolve({ runs: [] }) : method === 'venture.order.list' ? Promise.resolve([]) : request(method, params as never)) as typeof client.request;
  window.location.hash = '#/work';
  render(<App client={client} language="en" />);
  await screen.findByRole('heading', { level: 1, name: 'Work' });
  await settle();
}

describe('B4 task 15: Work', () => {
  it('an empty business has one filled way to add its first order', async () => {
    await open(true);
    const button = screen.getByRole('button', { name: 'Add your first order' });
    expect(button.getAttribute('data-variant')).toBe('primary');
    expect(screen.getByRole('button', { name: 'New order' }).getAttribute('data-variant')).toBe('secondary');
    assertOnePrimaryPerView();
    await act(async () => { fireEvent.click(button); });
    expect(await screen.findByRole('complementary', { name: 'New order' })).toBeTruthy();
  });

  it('Needs you opens Today where the approvals are', async () => {
    await open();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Needs you' })); });
    expect(window.location.hash).toBe('#/today');
  });

  it('the run sheet puts each check in a list inside its counted fold', () => {
    const run = structuredClone(RUNS.find(one => one.runId === '31')!);
    run.steps = [{ id: 'checked', purpose: 'Check the draft', state: 'done', evidence: [
      { kind: 'check', id: 'one', label: 'Passed: Source matched' },
      { kind: 'check', id: 'two', label: 'Passed: Rights recorded' },
    ] }];
    const { container } = render(<RunSheetView run={run} onClose={() => {}} />);
    const fold = [...container.querySelectorAll('details')].find(one => one.querySelector('summary')?.textContent === '2 checks passed')!;
    expect(fold).toBeTruthy();
    expect(within(fold).getAllByRole('listitem', { hidden: true }).map(one => one.textContent)).toEqual(['Passed: Source matched', 'Passed: Rights recorded']);
  });

  it('failed checks lead the list and unsettled checks never get a pass tick', () => {
    const run = structuredClone(RUNS.find(one => one.runId === '31')!);
    run.steps = [{ id: 'checked', purpose: 'Check the draft', state: 'failed', evidence: [
      { kind: 'check', id: 'one', label: 'Passed: Source matched' },
      { kind: 'check', id: 'two', label: 'Failed: Rights missing' },
      { kind: 'check', id: 'rules-judge', label: 'Failed: Not settled: source missing' },
    ] }];
    const { container } = render(<RunSheetView run={run} onClose={() => {}} />);
    const checks = container.querySelector<HTMLElement>('[data-check-evidence]')!;
    expect(checks).toBeTruthy();
    const rows = within(checks).getAllByRole('listitem', { hidden: true });
    expect(rows[0]!.textContent).toBe('Failed: Rights missing');
    expect(rows.find(one => one.textContent?.startsWith('Not checked'))?.getAttribute('data-check-passed')).toBeNull();
  });

  it('never counts skipped or unknown checks as passing', () => {
    const run = structuredClone(RUNS.find(one => one.runId === '31')!);
    run.steps = [{ id: 'checked', purpose: 'Check the draft', state: 'done', evidence: [
      { kind: 'check', id: 'one', label: 'Passed: Source matched' },
      { kind: 'check', id: 'two', label: 'Not run: no check connected' },
      { kind: 'check', id: 'three', label: 'Unknown: no outcome recorded' },
    ] }];
    const { container } = render(<RunSheetView run={run} onClose={() => {}} />);
    expect(container.querySelectorAll('[data-check-passed]')).toHaveLength(1);
    expect([...container.querySelectorAll('summary')].some(item => item.textContent === '1 check passed')).toBe(true);
  });
});
