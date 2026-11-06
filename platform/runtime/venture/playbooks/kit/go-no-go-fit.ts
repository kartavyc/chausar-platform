// C5 task 14: "What would make it a go?", browser safe, so the fake engine says it word for word. On NO-GO, code works
// out from the card's own inputs the months that fit (limit less upfront, over the monthly cost, rounded down, when at
// least 1) and the monthly cost that fits over the same months (rounded down to the paisa). BigInt paise only.

export type GoNoGoFit = { line: string; months: number | null; monthly: { minor: string; display: string } | null };

export function goNoGoFit(input: { upfront: string; monthly: string; months: string; limit: string }, show: (minor: string) => string): GoNoGoFit {
  const upfront = BigInt(input.upfront), monthly = BigInt(input.monthly), limit = BigInt(input.limit), months = BigInt(input.months);
  if (upfront >= limit) return { line: 'Even with no monthly cost, the upfront cost is over your limit.', months: null, monthly: null };
  const left = limit - upfront;
  const fitMonths = monthly > 0n ? left / monthly : 0n;
  const fitMonthly = left / months;
  const monthsWords = fitMonths >= 1n ? `${fitMonths} ${fitMonths === 1n ? 'month' : 'months'}` : null;
  const monthlyWords = `${show(String(fitMonthly))} a month`;
  return {
    line: `It would be a go at ${monthsWords ? `${monthsWords}, or at ` : ''}${monthlyWords}.`,
    months: fitMonths >= 1n ? Number(fitMonths) : null,
    monthly: { minor: String(fitMonthly), display: show(String(fitMonthly)) },
  };
}
