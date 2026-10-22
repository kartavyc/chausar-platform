import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom has no layout and no media queries; the app only reads them, so a quiet stand-in is enough.
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
    }),
  });
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = function scrollIntoView() {};

afterEach(() => {
  cleanup();
  window.location.hash = '';
});
