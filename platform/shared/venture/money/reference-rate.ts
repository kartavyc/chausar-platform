// C5 task 15: day-one margins from a dated reference rate. One figure shipped with each release: the USD/INR reference
// rate FBIL publishes on business days (RBI shows it), with its date and where it came from. Using it is the owner's
// choice (venture.spend.policy.set { useReference: true }); it is never a live rate and never updates by itself. A test
// (reference-rate-fresh-c5) fails when the figure is more than 45 days older than the release's build date in
// package.json, so a release never ships a stale rate silently. Browser safe, so the fake engine says the same.

export type ReferenceRate = {
  /** Rupees per US dollar, as published (at most four decimals). */
  perUsd: string;
  /** The day the figure was published for. */
  on: string;
  citation: { source: string; url: string; checkedOn: string; note: string };
};

export const REFERENCE_RATE: ReferenceRate = Object.freeze({
  perUsd: '94.3996',
  on: '2026-11-05',
  citation: Object.freeze({
    source: 'FBIL USD/INR reference rate, as shown on the RBI site',
    url: 'https://www.rbi.org.in/scripts/ReferenceRateArchive.aspx',
    checkedOn: '2026-11-06',
    note: 'Read through lawnut.com/usd-inr-reference-rate-today, which copies it from the RBI site; the RBI and FBIL pages need a browser to show the figure.',
  }),
});

/** What the owner's rate says it is, kept on the stored rate. */
export const REFERENCE_SOURCE = 'FBIL reference rate';
