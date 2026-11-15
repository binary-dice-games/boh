// MIT License © 2026 Binary Dice Games
/** @file Running asynchronous work over many items with a bounded number at once. */

/**
 * Calls `fn` on every item, at most `limit` at a time, in order of `items`. Stops starting new
 * calls once `signal` is aborted; calls already running finish.
 * @returns each item's outcome, in the order of `items`; items never started are `undefined`
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<(PromiseSettledResult<R> | undefined)[]> {
  const results: (PromiseSettledResult<R> | undefined)[] = new Array(items.length).fill(undefined);
  let next = 0;
  const worker = async () => {
    while (next < items.length && !signal?.aborted) {
      const index = next++;
      try {
        results[index] = { status: 'fulfilled', value: await fn(items[index]!, index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}
