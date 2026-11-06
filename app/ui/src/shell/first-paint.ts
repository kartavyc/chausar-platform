import type { ChausarBridge } from '../engine/client';

type Painter = (callback: () => void) => unknown;

/**
 * C5 task 26: tells the desktop, once, that the page has painted: the frame after the next frame is the first one on
 * screen. The start-up timeline's last step, and half of what clears the update's boot marker. Nothing on the web.
 */
export function reportFirstPaint(
  bridge: Pick<ChausarBridge, 'firstPaint'> | undefined = (window as Window & { chausar?: ChausarBridge }).chausar,
  nextFrame: Painter = (callback) => requestAnimationFrame(callback),
): void {
  if (!bridge?.firstPaint) return;
  nextFrame(() => nextFrame(() => { void bridge.firstPaint!().catch(() => {}); }));
}
