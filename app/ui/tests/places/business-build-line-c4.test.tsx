import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { APP_VERSION, BUILT_AT } from '../../src/parts/build-info';
import pack from '../../../../package.json';

/** One-shot C4 task 41 (A5's handover): the version and the build date, from the build's own constants, in the owner's format. */

describe('the build line', () => {
  it('the constants come from package.json and the build clock', () => {
    expect(APP_VERSION).toBe(pack.version);
    expect(Number.isNaN(new Date(BUILT_AT).getTime())).toBe(false);
  });

  it('Settings, This app says the version and the day it was built', async () => {
    window.location.hash = '#/business/app';
    render(<App client={createFakeClient(new FakeEngine())} language="en" />);
    const line = await screen.findByText(/^Chausar .+, built /);
    expect(line.textContent).toMatch(new RegExp(`^Chausar ${pack.version.replace(/\./g, '\\.')}, built \\d{1,2} [A-Z][a-z]{2} \\d{4}$`));
  });
});
