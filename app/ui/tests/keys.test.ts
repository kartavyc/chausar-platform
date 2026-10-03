import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { nextRegion, readGlobalKey, REGION_ORDER } from '../src/app/keys.ts';
import type { RegionId } from '../src/app/keys.ts';

// The translator reads only element identity, tagName and isContentEditable.
// This is a minimal DOM input target, not a replacement for the app or React.
class InputTarget extends EventTarget {
  readonly tagName: string;
  readonly isContentEditable: boolean;
  constructor(tagName: string, isContentEditable = false) {
    super(); this.tagName = tagName; this.isContentEditable = isContentEditable;
  }
}
const originalElement = Object.getOwnPropertyDescriptor(globalThis, 'HTMLElement');
before(() => { Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: InputTarget }); });
after(() => {
  if (originalElement) Object.defineProperty(globalThis, 'HTMLElement', originalElement);
  else Reflect.deleteProperty(globalThis, 'HTMLElement');
});

function key(key: string, fields: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return { key, code: '', type: 'keydown', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
    repeat: false, isComposing: false, target: null, ...fields } as KeyboardEvent;
}

test('Ctrl/Cmd K and each of the seven place keys emit their exact navigation intent', () => {
  for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) {
    assert.deepEqual(readGlobalKey(key('k', modifier)), { kind: 'ask' });
    for (let n = 1; n <= 7; n++) assert.deepEqual(readGlobalKey(key(String(n), modifier)), { kind: 'place', index: n - 1 });
    assert.equal(readGlobalKey(key('8', modifier)), null);
    assert.equal(readGlobalKey(key('k', { ...modifier, altKey: true })), null);
  }
});

test('ordinary editing and list keys remain with their local input/list controller', () => {
  const target = new InputTarget('TEXTAREA');
  for (const name of ['Enter', ' ', 'ArrowUp', 'ArrowDown', 'Home', 'End']) assert.equal(readGlobalKey(key(name, { target })), null, name);
});

test('Esc closes the sheet even when focus is inside an editable field (design part 11)', () => {
  for (const target of [null, new InputTarget('BUTTON'), new InputTarget('INPUT'), new InputTarget('TEXTAREA'), new InputTarget('DIV', true)]) {
    assert.deepEqual(readGlobalKey(key('Escape', { target })), { kind: 'escape' });
  }
});

test('the translator provides primary intent only for the named Ctrl/Cmd Enter chord', () => {
  assert.deepEqual(readGlobalKey(key('Enter', { ctrlKey: true })), { kind: 'primary' });
  assert.deepEqual(readGlobalKey(key('Enter', { metaKey: true })), { kind: 'primary' });
  assert.equal(readGlobalKey(key('Enter')), null);
  assert.equal(readGlobalKey(key('Enter', { ctrlKey: true, altKey: true })), null);
  assert.equal(readGlobalKey(key('Enter', { ctrlKey: true, shiftKey: true })), null);
});

test('IME composition cannot become a sheet action or global navigation', () => {
  const target = new InputTarget('INPUT');
  assert.equal(readGlobalKey(key('Enter', { ctrlKey: true, isComposing: true, target })), null);
  assert.equal(readGlobalKey(key('k', { ctrlKey: true, isComposing: true, target })), null);
});

test('Alt arrow moves between sheet rows and F6 names the direction of region navigation', () => {
  assert.deepEqual(readGlobalKey(key('ArrowDown', { altKey: true })), { kind: 'adjacent', delta: 1 });
  assert.deepEqual(readGlobalKey(key('ArrowUp', { altKey: true })), { kind: 'adjacent', delta: -1 });
  assert.equal(readGlobalKey(key('ArrowDown', { altKey: true, ctrlKey: true })), null);
  assert.deepEqual(readGlobalKey(key('F6')), { kind: 'region', backwards: false });
  assert.deepEqual(readGlobalKey(key('F6', { shiftKey: true })), { kind: 'region', backwards: true });
});

test('hold-to-talk emits start/end and does not repeat its start', () => {
  assert.deepEqual(readGlobalKey(key(' ', { ctrlKey: true, code: 'Space' })), { kind: 'talk', phase: 'start' });
  assert.equal(readGlobalKey(key(' ', { ctrlKey: true, code: 'Space', repeat: true })), null);
  assert.deepEqual(readGlobalKey(key(' ', { ctrlKey: true, code: 'Space', type: 'keyup' })), { kind: 'talk', phase: 'end' });
});

test('key release never repeats a nonvoice action when Frame handles both keydown and keyup', () => {
  const chords: readonly KeyboardEvent[] = [
    key('Enter', { ctrlKey: true }), key('Enter', { metaKey: true }),
    key('k', { ctrlKey: true }), key('/', { ctrlKey: true }),
    key('Escape'), key('F6'), key('F6', { shiftKey: true }),
    key('ArrowDown', { altKey: true }), key('ArrowUp', { altKey: true }),
    ...Array.from({ length: 7 }, (_, n) => key(String(n + 1), { ctrlKey: true })),
  ];
  for (const chord of chords) {
    assert.equal(readGlobalKey(key(chord.key, { ...chord, type: 'keyup' })), null, `${chord.key} keyup`);
  }
  const pressAndRelease = [key('Enter', { ctrlKey: true }), key('Enter', { ctrlKey: true, type: 'keyup' })];
  assert.equal(pressAndRelease.map(readGlobalKey).filter(intent => intent?.kind === 'primary').length, 1);
});

test('F6 cycles in spec order, skips absent regions and wraps in both directions', () => {
  const all = new Set<RegionId>(REGION_ORDER);
  assert.equal(nextRegion('rail', all, false), 'page');
  assert.equal(nextRegion('ask', all, false), 'rail');
  assert.equal(nextRegion('rail', all, true), 'ask');
  assert.equal(nextRegion('page', new Set<RegionId>(['rail', 'page', 'ask']), false), 'ask');
  assert.equal(nextRegion('rail', new Set<RegionId>(['rail']), true), 'rail');
  assert.equal(nextRegion(null, new Set<RegionId>(), false), null);
});

test('F6 entering from an absent or unrecognized current region starts at the correct end', () => {
  const all = new Set<RegionId>(REGION_ORDER);
  assert.equal(nextRegion(null, all, false), 'rail');
  assert.equal(nextRegion(null, all, true), 'ask');
  const noSheet = new Set<RegionId>(['rail', 'page', 'ask']);
  assert.equal(nextRegion('sheet', noSheet, false), 'rail');
  assert.equal(nextRegion('sheet', noSheet, true), 'ask');
});
