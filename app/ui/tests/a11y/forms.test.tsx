import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PLACES, SHEETS, OPENED, PHONE, settle, violations, timeoutOf, NARROW } from './cases';


describe('axe on forms and second asks', () => {
  for (const opened of OPENED) {
    it(opened.name, async () => {
      expect(await violations(await settle(opened))).toEqual([]);
    }, timeoutOf(opened));
  }
});
