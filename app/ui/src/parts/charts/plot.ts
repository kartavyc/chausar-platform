/**
 * The geometry the charts share. Values arrive in per mille and stay in per mille in the markup: an SVG transform
 * turns them into pixels, so no value is ever divided or scaled in code.
 *
 * Column charts draw each column as its own SVG in plain pixels (so words keep their size at any tile width), with
 * the bars placed by percentages of the column and inside a group that maps per mille upwards onto the plot. A value
 * written over a bar is moved to the bar's top in per mille, then drawn through UPRIGHT, which undoes the vertical
 * scale, so the text sits at its real size.
 */

/** The plot's height in pixels: 1000 per mille is 160 px, so 1 per mille is 0.16 px. */
export const PLOT = 160;
/** Room above the plot for the value over the tallest bar. */
export const ROOM = 20;
/** A column's whole height: the room, the plot and the 1 px baseline under it. */
export const COLUMN = 180;
/** Where the bars stand in a column, just above the baseline at 179.5. */
export const BASE = 179;
/** Per mille upwards to pixels downwards in a column: y = 179 - 0.16 x per mille. A bar's 4 px rounded end is
 *  therefore 25 per mille tall (Charts.module.css rounds it with a clip). */
export const COLUMN_UP = 'matrix(1 0 0 -0.16 0 179)';
/** The same in a plot without room (the cash line's level labels): y = 160 - 0.16 x per mille. */
export const PLOT_UP = 'matrix(1 0 0 -0.16 0 160)';
/** Undoes the 0.16 vertical scale and the flip for text placed at a per mille height (6.25 is 1 / 0.16). */
export const UPRIGHT = 'matrix(1 0 0 -6.25 0 0)';
/** Per mille upwards inside a 1000-tall viewBox (the cash line). */
export const FLIP = 'matrix(1 0 0 -1 0 1000)';

/** A per mille height as an SVG translation, for a group that carries text to the top of a bar. */
export function raise(permille: number): string {
  return `translate(0 ${permille})`;
}

/** An id React gave, made safe for `url(#...)` in an SVG paint (React's ids carry punctuation). */
export function svgId(reactId: string, name: string): string {
  return `${name}-${reactId.replace(/[^A-Za-z0-9_-]/g, '')}`;
}

/** A paint that points at a pattern in the same SVG (the goal bar's stripes): a reference, never a colour. */
export function paint(id: string): string {
  return `url(#${id})`;
}
