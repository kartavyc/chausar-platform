import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { assertInkRules } from '../helpers/ink-rules';

// The person sheet beside the Network tab (Ink v2 wave 4, package 4D4; `?sheet=person:<id>`): how you know them with
// the tie receipt, their warm paths, the pipeline card, "Before you write", every kept field with its source row (the
// DPDP notice), Split for a merged person, Hide, and Forget, which asks once more and says what goes and what stays.

type Fake = ReturnType<typeof createFakeClient>;

async function start(id: string, options: { override?: (client: Fake) => void } = {}) {
  window.location.hash = `#/clients/network?sheet=person:${id}`;
  const client = createFakeClient(new FakeEngine({ now: () => '2026-10-23T10:00:00.000Z' }));
  options.override?.(client);
  const spy = vi.spyOn(client, 'request');
  const view = render(<App client={client} language="en" />);
  return { client, spy, ...view };
}
async function click(element: HTMLElement) {
  await act(async () => { fireEvent.click(element); window.dispatchEvent(new HashChangeEvent('hashchange')); });
}
const settle = () => act(async () => { for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const calls = (spy: { mock: { calls: unknown[][] } }, method: string) => spy.mock.calls.filter(([m]) => m === method) as [string, unknown][];
const section = (name: string) => screen.getByRole('heading', { level: 3, name }).closest('section') as HTMLElement;

describe('the person sheet', () => {
  it('names the person with their role, and How you know them lists each signal with the tie receipt', async () => {
    await start('person_tara');
    expect(await screen.findByRole('heading', { level: 2, name: 'Tara Iyer' })).toBeTruthy();
    await settle();
    expect(screen.getAllByText('Brand partnerships lead at Kettle Audio').length).toBeGreaterThan(0);
    const how = section('How you know them');
    expect(within(how).getByText('11 emails both ways, the last on 14 Oct (Mail headers, takeout-mail.mbox)')).toBeTruthy();
    expect(within(how).getByRole('button', { name: /receipt/i }).getAttribute('data-receipt')).toBe('tie_person_tara');
    expect(screen.getByRole('button', { name: /know well, 4 of 5/i })).toBeTruthy();
    assertInkRules();
  });

  it('Paths draws each path, and one Chausar cannot confirm says so', async () => {
    await start('person_nisha');
    await screen.findByRole('heading', { level: 2, name: 'Nisha Rao' });
    await settle();
    const paths = section('Paths');
    expect(paths.querySelectorAll('[data-path]').length).toBe(2);
    expect(within(paths).getByText('possible path, not confirmed')).toBeTruthy();
    expect(within(paths).getByText(/Chausar sees nothing that shows Arjun knows Nisha\./)).toBeTruthy();
  });

  it('What Chausar keeps lists every field with its source row, the file\'s words marked as quoted', async () => {
    await start('person_tara');
    await screen.findByRole('heading', { level: 2, name: 'Tara Iyer' });
    await settle();
    const keeps = section('What Chausar keeps');
    expect(within(keeps).getAllByText('LinkedIn connections, Connections.csv, line 14').length).toBeGreaterThan(0);
    expect(within(keeps).getByText('tara@kettleaudio.example').closest('[data-content]')).toBeTruthy();
    expect(within(keeps).getByRole('link', { name: /Open in LinkedIn/ })).toBeTruthy();
  });

  it('Add to pipeline from the sheet adds them, with you as the trigger', async () => {
    const { spy } = await start('person_arjun');
    await screen.findByRole('heading', { level: 2, name: 'Arjun Kulkarni' });
    await settle();
    await click(within(section('Pipeline')).getByRole('button', { name: 'Add to pipeline' }));
    await settle();
    expect(calls(spy, 'venture.pipeline.add').at(-1)![1]).toEqual({ personId: 'person_arjun', trigger: { kind: 'owner' } });
    expect(within(section('Pipeline')).getByText('In pipeline, Found')).toBeTruthy();
  });

  it('Before you write says plainly that web search is not set up here', async () => {
    const { spy } = await start('person_dev');
    await screen.findByRole('heading', { level: 2, name: 'Dev Malhotra' });
    await settle();
    // No web search here: the line stands in place of the button, and nothing is asked.
    await waitFor(() => expect(within(section('Before you write')).getByText('Web search is not set up here, so nothing can be looked up.')).toBeTruthy());
    expect(within(section('Before you write')).queryByRole('button', { name: 'Look at public pages' })).toBeNull();
    expect(calls(spy, 'venture.network.research')).toHaveLength(0);
  });

  it('Split moves the chosen source rows of a merged person to a new person', async () => {
    const { spy } = await start('person_sana');
    await screen.findByRole('heading', { level: 2, name: 'Sana Qureshi' });
    await settle();
    const split = section('Split');
    fireEvent.click(within(split).getByRole('checkbox', { name: /Phone contacts, contacts\.vcf, line 6/ }));
    await click(within(split).getByRole('button', { name: 'Split into a new person' }));
    await settle();
    expect(calls(spy, 'venture.network.split').at(-1)![1]).toEqual({ personId: 'person_sana', sourceIds: ['netimport_vcf:6'] });
    expect(screen.getByText('Sana Q is now a person of their own.')).toBeTruthy();
  });

  it('a person no file merged offers no Split', async () => {
    await start('person_tara');
    await screen.findByRole('heading', { level: 2, name: 'Tara Iyer' });
    await settle();
    expect(screen.queryByRole('heading', { level: 3, name: 'Split' })).toBeNull();
  });

  it('Hide drops them from search and lists, and Show again brings them back', async () => {
    const { spy } = await start('person_kabir');
    await screen.findByRole('heading', { level: 2, name: 'Kabir Sethi' });
    await settle();
    await click(screen.getByRole('button', { name: 'Hide' }));
    await settle();
    expect(calls(spy, 'venture.network.hide').at(-1)![1]).toEqual({ personId: 'person_kabir', hidden: true });
    expect(screen.getByText('Hidden from search and lists.')).toBeTruthy();
    await click(screen.getByRole('button', { name: 'Show again' }));
    await settle();
    expect(calls(spy, 'venture.network.hide').at(-1)![1]).toEqual({ personId: 'person_kabir', hidden: false });
  });

  it('Forget asks once more, saying what goes and what stays, then shows the engine\'s words', async () => {
    const { spy } = await start('person_pooja');
    await screen.findByRole('heading', { level: 2, name: 'Pooja Nair' });
    await settle();
    await click(screen.getByRole('button', { name: 'Forget' }));
    expect(screen.getByText(/Chausar deletes everything it keeps about them/)).toBeTruthy();
    expect(screen.getByText(/Records the law needs, such as a client's invoices, stay\./)).toBeTruthy();
    expect(screen.getByText(/Backups made before now still hold them until those backups are deleted\./)).toBeTruthy();
    expect(screen.getByText(/it tells you if it couldn't/)).toBeTruthy();
    expect(calls(spy, 'venture.network.forget')).toHaveLength(0);
    await click(screen.getByRole('button', { name: 'Forget Pooja Nair' }));
    await settle();
    expect(calls(spy, 'venture.network.forget').at(-1)![1]).toEqual({ id: 'person_pooja' });
    // The header says Forgotten with the engine's line; nothing of hers is left on the sheet.
    expect(await screen.findByRole('heading', { level: 2, name: 'Forgotten' })).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/Pooja is your client/)).toBeTruthy());
    expect(screen.queryByText('Head of content at Nimbus Mics')).toBeNull();
    expect(screen.getByText(BACKUPS)).toBeTruthy();
  });
});

const BACKUPS = 'Backups made before now still hold this person until those backups are deleted.';
