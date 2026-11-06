import type { GalleryWay } from '../../parts/Gallery';

/**
 * One way to earn on Start, in the shape the Gallery part draws (D-Start's `.way`). Every string in it is the
 * engine's: W4 4J21 maps `venture.playbooks.list` onto it (one tile per registered playbook, W5 adds the rest), and
 * the price range always reads "model estimate". Wave 3 sends none, so Start shows no gallery; board sample ways
 * never stand in for it.
 */
export type WayData = GalleryWay;

/** The gallery's slot on Start: the ways, the one featured tile (the good fit, W4 4C), and what a tile's Start does
 *  (W4 4J21). */
export interface WaysSlot {
  ways: readonly WayData[];
  featured?: string | undefined;
  onStart: (id: string) => void;
}

/** The slot when it holds at least one way; an empty list is no gallery. */
export function waysToShow(slot: WaysSlot | undefined): WaysSlot | undefined {
  return slot && slot.ways.length > 0 ? slot : undefined;
}
