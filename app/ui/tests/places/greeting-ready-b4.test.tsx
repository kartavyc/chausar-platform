import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { Greeting } from '../../src/places/today/Greeting';
import { ClockProvider, OwnerZone } from '../../src/shell/clock';
import { EngineProvider } from '../../src/engine/context';
import { EngineError, type EngineClient } from '../../src/engine/types';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { TextProvider } from '../../src/text';

function mount(client: EngineClient) {
  return render(<TextProvider language="en"><EngineProvider client={client}><ClockProvider now={() => new Date('2026-11-03T04:30:00Z')}><OwnerZone>
    <Greeting line="2 things need you" count="2" tools={<button type="button">Arrange Today</button>} />
  </OwnerZone></ClockProvider></EngineProvider></TextProvider>);
}

describe('B2 review: Today header while its zone resolves', () => {
  it('keeps tools and summary visible while holding only the date and greeting', async () => {
    const client = createFakeClient(new FakeEngine());
    const request = client.request.bind(client);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    client.request = (async (method, params) => { if (method === 'venture.get') await gate; return request(method, params as never); }) as typeof client.request;
    const view = mount(client);
    expect(screen.getByRole('button', { name: 'Arrange Today' })).toBeTruthy();
    expect(view.container.querySelector('[data-line-slot]')?.textContent).toBe('2 things need you');
    expect(view.container.querySelector('[data-line-slot] b')?.textContent).toBe('2');
    expect(screen.queryByText(/^Good (morning|afternoon|evening)/)).toBeNull();
    await act(async () => { release(); });
    expect(await screen.findByRole('heading', { name: 'Good morning' })).toBeTruthy();
  });

  it.each(['error', 'closed'])('still greets when the business answer is %s', async state => {
    const client = createFakeClient(new FakeEngine({ closed: state === 'closed' }));
    if (state === 'error') {
      const request = client.request.bind(client);
      client.request = (async (method, params) => { if (method === 'venture.get') throw new EngineError('UNAVAILABLE', 'Try again.'); return request(method, params as never); }) as typeof client.request;
    }
    mount(client);
    expect(await screen.findByRole('heading', { name: /^Good (morning|afternoon|evening)/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Arrange Today' })).toBeTruthy();
  });
});
