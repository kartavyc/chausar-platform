// C5 task 10: the Network tab's search chips, browser safe, so the fake engine builds them word for word.

export type ChipPerson = { hidden: boolean; company?: string | null | undefined; title?: string | null | undefined };

/**
 * C5 task 10: up to three search chips from the owner's own network, by code: the company most people work at, the
 * role title most people hold (each only when two or more share it), and the quiet-clients search when the business
 * has clients. Hidden people are never read for a chip.
 */
export function networkChips(people: readonly ChipPerson[], hasClients: boolean): string[] {
  const visible = people.filter(person => !person.hidden);
  const commonest = (values: (string | null | undefined)[]): string | null => {
    const counts = new Map<string, { label: string; count: number }>();
    for (const value of values) {
      const label = value?.replace(/\s+/g, ' ').trim();
      if (!label || label.length > 60) continue;
      const key = label.toLowerCase();
      const known = counts.get(key);
      counts.set(key, { label: known?.label ?? label, count: (known?.count ?? 0) + 1 });
    }
    const best = [...counts.values()].filter(item => item.count >= 2).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))[0];
    return best?.label ?? null;
  };
  const chips: string[] = [];
  const company = commonest(visible.map(person => person.company));
  if (company) chips.push(`Who works at ${company}?`);
  const title = commonest(visible.map(person => person.title));
  if (title) chips.push(`Who is ${/^[aeiou]/i.test(title) ? 'an' : 'a'} ${title.toLowerCase()}?`);
  if (hasClients) chips.push('Clients quiet for 6 months');
  return chips.slice(0, 3);
}

