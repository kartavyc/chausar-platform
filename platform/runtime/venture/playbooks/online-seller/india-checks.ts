// Chausar India seller checks, from official Consumer Affairs/PIB source documents; no external code copied.
import { computeIndiaListing, type SellerUse } from './model.ts';
import { sellerCall } from './economics.ts';
/** Packaged-goods MRP, country-of-origin and seller-detail checks; no legal approval is invented. */
export function indiaListingChecks(input: unknown, use: SellerUse & { confirmedBy?: { name: string; on: string } | null }) { return sellerCall(() => computeIndiaListing(input, use)); }
