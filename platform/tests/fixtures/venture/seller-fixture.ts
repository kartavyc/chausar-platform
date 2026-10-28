// Chausar's worked seller example, from cards2/commerce.md. No source code copied.
export function sellerExample() {
  const known = (value: string) => ({ type: 'fact' as const, value, source: 'Owner fee card and invoices', observedAt: '2026-10-27T10:00:00+05:30' });
  return {
    sellingMinor: known('99900'), gstBps: known('1800'), referralBps: known('1500'), referralBasis: known('gst-inclusive'),
    closingMinor: known('2500'), shippingMinor: known('6500'), feesGstBps: known('1800'),
    stockMinor: known('30000'), stockGstMinor: known('5400'), packagingMinor: known('1200'),
    adsMinor: known('8000'), adsGstMinor: known('1440'), returnBps: known('800'), returnLossMinor: known('12000'),
    inputCredit: known('yes'), tcsRule: { id: 'seller-tcs', rateBps: '50', source: 'Worked example, CA confirmation required', checkedOn: '2026-10-27', confirmedBy: null },
    tdsRule: { id: 'seller-tds', rateBps: '10', source: 'Worked example, CA confirmation required', checkedOn: '2026-10-27', confirmedBy: null },
    tdsBasis: known('taxable'),
  };
}
