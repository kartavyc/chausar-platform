import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { EngineProvider } from '../../src/engine/context';
import type { EngineClient, VentureRunEvent } from '../../src/engine/types';
import { PrivacyBoundary, useForgetCompletion } from '../../src/shell/PrivacyBoundary';

function setup() {
  window.location.hash = '#/clients/network?sheet=person:private-person';
  const listeners = new Set<(event: VentureRunEvent) => void>();
  const client = { subscribe: (fn: (event: VentureRunEvent) => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; } } as unknown as EngineClient;
  let complete = (_: { line: string; kept: string[] }) => {};
  function Buffer() {
    const [words, setWords] = useState('');
    const receipt = useForgetCompletion();
    return <><input aria-label="Private draft" value={words} onChange={(event) => setWords(event.target.value)} />
      <button onClick={() => { complete = receipt.begin(); }}>Begin</button><output>{receipt.result?.line}</output><span>{receipt.completed ? 'Forgotten' : ''}</span></>;
  }
  const tree = (business: string) => <EngineProvider client={client}><PrivacyBoundary key={business}>{(generation) => <Buffer key={generation} />}</PrivacyBoundary></EngineProvider>;
  const view = render(tree('first'));
  return { ...view, tree, finish: () => act(() => complete({ line: 'Fresh deletion receipt', kept: ['Required record'] })),
    forget: () => act(() => listeners.forEach((fn) => fn({ type: 'privacy.forgotten', businessId: 'business', at: '2026-10-29T10:00:00Z' }))) };
}

it('discards every old buffer, then shows only the fresh completion and clears it at the next Forget', () => {
  const fixture = setup();
  fireEvent.change(screen.getByLabelText('Private draft'), { target: { value: 'Private person and draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Begin' }));
  fixture.forget();
  expect((screen.getByLabelText('Private draft') as HTMLInputElement).value).toBe('');
  fixture.finish();
  expect(screen.getByText('Fresh deletion receipt')).toBeTruthy();
  fixture.forget();
  expect(screen.queryByText('Fresh deletion receipt')).toBeNull();
});

it('discards a late completion after navigation, including navigation away and back', () => {
  const fixture = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Begin' }));
  fixture.forget();
  act(() => { window.location.hash = '#/today'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
  act(() => { window.location.hash = '#/clients/network?sheet=person:private-person'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
  fixture.finish();
  expect(screen.queryByText('Fresh deletion receipt')).toBeNull();
  expect(screen.queryByText('Forgotten')).toBeNull();
});

it('cannot carry a late completion into another business', () => {
  const fixture = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Begin' }));
  fixture.forget();
  fixture.rerender(fixture.tree('second'));
  fixture.finish();
  expect(screen.queryByText('Fresh deletion receipt')).toBeNull();
  expect(screen.queryByText('Forgotten')).toBeNull();
});

it('keeps only a content-free acknowledgement when the privacy event arrives after the reply', () => {
  const fixture = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Begin' }));
  fixture.finish();
  expect(screen.getByText('Fresh deletion receipt')).toBeTruthy();
  fixture.forget();
  expect(screen.queryByText('Fresh deletion receipt')).toBeNull();
  expect(screen.getByText('Forgotten')).toBeTruthy();
});

it('a second privacy reset invalidates the pending receipt before a late reply can restore it', () => {
  const fixture = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Begin' }));
  fixture.forget();
  fixture.forget();
  fixture.finish();
  expect(screen.queryByText('Fresh deletion receipt')).toBeNull();
  expect(screen.queryByText('Forgotten')).toBeNull();
});
