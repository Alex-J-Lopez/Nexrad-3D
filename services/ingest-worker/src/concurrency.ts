/**
 * Run `fn` over `items` with at most `concurrency` in-flight promises.
 */
export async function mapWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>
): Promise<void> {
  const limit = Math.max(1, Math.floor(concurrency));
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }
      await fn(items[index], index);
    }
  };

  const workerCount = Math.min(limit, items.length);
  if (workerCount === 0) {
    return;
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}
