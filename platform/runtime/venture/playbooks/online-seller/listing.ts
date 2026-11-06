// Chausar listing health: amazon-listing-doctor ideas (MIT), independently implemented.
import { computeListing, readImageDimensions } from './model.ts';
import { sellerCall } from './economics.ts';
export { SELLER_LISTING_RULES } from './model.ts';
/** Coverage-first listing checks, with Chausar's own rubric named on each score. */
export function listingHealth(input: unknown) { return sellerCall(() => computeListing(input)); }
/** Reads image dimensions from PNG, JPEG and extended WebP file headers. */
export function imageDimensions(bytes: Uint8Array) { return sellerCall(() => readImageDimensions(bytes)); }
