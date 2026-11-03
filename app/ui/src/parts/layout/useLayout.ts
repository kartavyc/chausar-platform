/**
 * W6 6H3 (D40): a place's layout as data. The engine answers venture.layout.get with the blocks in the order the page
 * draws them (locked blocks in their own slots), their names and whether they show; every change is followed by
 * queue.changed, so a change the owner's AI made reaches the open page at once. Until the layout has come, or when the
 * engine cannot answer it, the page draws the library's own layout: every block shown, in its own order, with its own
 * name, so nothing waits on this read and nothing is ever hidden by a failed one.
 */

import { useResource } from '../../engine/context';
import type { LayoutBlockView, LayoutPlace, LayoutView, VentureRunEvent } from '../../engine/types';
import { LAYOUT_LIBRARY } from '../../../../../platform/runtime/venture/views/layout-core';

export const LAYOUT_EVENTS = (event: VentureRunEvent) => event.type === 'queue.changed';

export function useLayout(place: LayoutPlace) {
  return useResource('venture.layout.get', { place }, { refreshOn: LAYOUT_EVENTS });
}

/** A block as the page draws it: in its slot, shown or not, with the name the owner (or their AI) gave it, if any. */
export interface DrawnBlock { id: string; shown: boolean; name: string | undefined }

/**
 * The blocks in slot order. A name is given only when it differs from the block's own, so the page keeps its own words
 * (and their translations) for a block that was never renamed. A block the engine does not list (an older engine)
 * shows in its library slot.
 */
export function drawnBlocks(place: LayoutPlace, view: LayoutView | undefined): DrawnBlock[] {
  const library = LAYOUT_LIBRARY[place].blocks;
  if (!view || view.place !== place || view.blocks.length !== library.length) return library.map((block) => ({ id: block.id, shown: true, name: undefined }));
  return view.blocks.map((block: LayoutBlockView) => ({ id: block.id, shown: block.shown || block.keep !== null, name: block.name !== block.defaultName ? block.name : undefined }));
}
