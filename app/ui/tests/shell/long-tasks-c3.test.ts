import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { watchLongTasks } from '../../src/shell/long-tasks';

/** One-shot C3 task 17: long tasks kept in the window in development, with the address at the time, and nothing else. */
type Holder = { __chausarLongTasks?: { at: number; duration: number; route: string }[] };
afterEach(() => { vi.unstubAllGlobals(); delete (window as unknown as Holder).__chausarLongTasks; });

function stubObserver() {
  let fire: ((list: { getEntries(): { startTime: number; duration: number }[] }) => void) | null = null;
  const observe = vi.fn();
  class Stub {
    constructor(callback: typeof fire) { fire = callback; }
    observe = observe;
    disconnect = vi.fn();
  }
  vi.stubGlobal('PerformanceObserver', Stub);
  return { observe, emit: (entries: { startTime: number; duration: number }[]) => fire!({ getEntries: () => entries }) };
}

describe('long tasks', () => {
  it('keeps each entry with the route at the time, the last 200 only', () => {
    const { observe, emit } = stubObserver();
    window.location.hash = '#/work';
    watchLongTasks();
    expect(observe).toHaveBeenCalledWith(expect.objectContaining({ type: 'longtask' }));
    emit([{ startTime: 10, duration: 80 }]);
    const ring = (window as unknown as Holder).__chausarLongTasks!;
    expect(ring).toEqual([{ at: 10, duration: 80, route: '#/work' }]);
    emit(Array.from({ length: 250 }, (_, index) => ({ startTime: index, duration: 60 })));
    expect(ring).toHaveLength(200);
    expect(ring[0]!.at).toBe(50);
  });

  it('does nothing where the browser has no observer', () => {
    vi.stubGlobal('PerformanceObserver', undefined);
    expect(() => watchLongTasks()()).not.toThrow();
  });

  it('source rule: only development code imports it', () => {
    const src = join(import.meta.dirname, '../../src');
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => { const path = join(dir, name); return statSync(path).isDirectory() ? walk(path) : [path]; });
    const importers = walk(src).filter((file) => /\.tsx?$/.test(file) && !file.endsWith('long-tasks.ts') && /long-tasks/.test(readFileSync(file, 'utf8')));
    expect(importers.map((file) => relative(src, file).split(sep).join('/'))).toEqual(['main.tsx']);
    const main = readFileSync(join(src, 'main.tsx'), 'utf8');
    expect(main).toMatch(/if \(import\.meta\.env\.DEV\)[^\n]*import\('\.\/shell\/long-tasks'\)/);
    expect(main).not.toMatch(/^import .*long-tasks/m);
  });
});
