/** Read-only custody leaves. Callers must reserve the complete count/byte budget
 * and supply exact per-file read caps before dispatching any work. */
export async function mapCustodyFiles<T, R>(items: readonly T[], work: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0, failed = false, failure: unknown;
  const worker = async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try { results[index] = await work(items[index], index); }
      catch (error) { if (!failed) { failed = true; failure = error; } }
    }
  };
  // Workers catch their failures so all started reads (and their finally/close
  // clauses) finish before the surrounding snapshot/native lease can unwind.
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, worker));
  if (failed) throw failure;
  return results;
}
