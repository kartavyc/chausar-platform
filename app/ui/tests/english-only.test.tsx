import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { CATALOGUES, pickLanguage, TextProvider, useLanguage, useT, type Language } from '../src/text';

it('offers only English even when the computer or an old caller requests Hindi', () => {
  expect(Object.keys(CATALOGUES)).toEqual(['en']);
  expect(pickLanguage(['hi-IN', 'hi'])).toBe('en');
  function Words() { const t = useT(); return <p>{useLanguage()}:{t('place.today')}</p>; }
  render(<TextProvider language={'hi' as Language}><Words /></TextProvider>);
  expect(screen.getByText('en:Today')).toBeTruthy();
});

it('does not ship Hindi catalogues, reviewer queues or Devanagari fonts', () => {
  for (const path of ['app/ui/src/text/hi', 'app/ui/src/text/hi-review.json', 'app/ui/assets/fonts/NotoSansDevanagari-400.woff2', 'app/ui/assets/fonts/NotoSansDevanagari-500.woff2']) {
    expect(existsSync(resolve(path)), path).toBe(false);
  }
});
