// C5 task 1: the introduction line, browser safe, so the fake engine says it word for word.

/** "Reader reads enquiries and lists what is missing." from the name and the role's job line. */
export function introLine(name: string, job: string): string {
  const lower = job.length > 1 && job[1] !== job[1]!.toUpperCase() ? job[0]!.toLowerCase() + job.slice(1) : job;
  return `${name} ${lower}`;
}
