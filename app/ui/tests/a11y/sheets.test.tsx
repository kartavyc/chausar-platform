import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PLACES, SHEETS, OPENED, PHONE, settle, violations, timeoutOf, NARROW } from './cases';


describe('axe on every sheet', () => {
  for (const sheet of SHEETS) {
    it(sheet.name, async () => {
      const root = await settle(sheet);
      expect(root.querySelector('aside')).not.toBeNull();
      expect(await violations(root)).toEqual([]);
    }, timeoutOf(sheet));
  }
});
