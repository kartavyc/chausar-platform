// C5 task 26: the page says once that it has painted, after the second frame; a browser with no desktop says nothing.
import { describe, expect, it, vi } from 'vitest';
import { reportFirstPaint } from '../../src/shell/first-paint';

describe('reportFirstPaint', () => {
  it('waits for two frames, then tells the desktop once', async () => {
    const frames: (() => void)[] = [];
    const firstPaint = vi.fn(async () => ({ ok: true }));
    reportFirstPaint({ firstPaint }, (callback) => frames.push(callback));
    expect(firstPaint).not.toHaveBeenCalled();
    frames.shift()!();
    expect(firstPaint).not.toHaveBeenCalled();
    frames.shift()!();
    expect(firstPaint).toHaveBeenCalledTimes(1);
    expect(frames).toEqual([]);
  });
  it('asks for no frame on the web, and a refused answer stays quiet', async () => {
    const frame = vi.fn();
    reportFirstPaint({}, frame);
    expect(frame).not.toHaveBeenCalled();
    reportFirstPaint({ firstPaint: () => Promise.reject(new Error('gone')) }, (callback) => callback());
    await Promise.resolve();
  });
});
