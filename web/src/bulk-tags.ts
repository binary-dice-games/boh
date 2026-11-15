// MIT License © 2026 Binary Dice Games
/**
 * @file Bulk tag edits from the library (spec/02_tags_and_shared_bins/DESIGN.md section 4.4): one
 * `setTags` per paste, a few at a time, with progress and cancel. There is no transaction across
 * pastes: each paste is consistent on its own, and failures are reported per paste for a retry.
 */
import type { LibraryEntry } from './library-index';
import { mapLimit } from './pool';
import type { PasteMeta } from './providers/provider';
import type { TagChange } from './tags';

/** How many pastes are changed at once. */
export const BULK_CONCURRENCY = 4;

/** What to do to every selected paste. */
export type BulkAction =
  | { kind: 'add'; tags: string[] }
  | { kind: 'remove'; tags: string[] }
  | { kind: 'rename'; from: string; to: string }
  /** Add the tags the account's rules give each paste. */
  | { kind: 'rules'; tagsFor: (entry: LibraryEntry) => string[] };

/** The change `action` makes to `entry`, or `undefined` when it has nothing to do there. */
export function changeFor(action: BulkAction, entry: LibraryEntry): TagChange | undefined {
  const current = entry.meta.tags ?? [];
  switch (action.kind) {
    case 'add': {
      const add = action.tags.filter((t) => !current.includes(t));
      return add.length ? { add } : undefined;
    }
    case 'remove': {
      const remove = action.tags.filter((t) => current.includes(t));
      return remove.length ? { remove } : undefined;
    }
    case 'rename':
      return current.includes(action.from) && action.from !== action.to
        ? { remove: [action.from], add: [action.to] }
        : undefined;
    case 'rules': {
      const add = action.tagsFor(entry).filter((t) => !current.includes(t));
      return add.length ? { add } : undefined;
    }
  }
}

/** The outcome of a bulk edit. */
export interface BulkResult {
  /** Pastes changed, with their new metadata. */
  changed: PasteMeta[];
  /** Pastes the action had nothing to do on. */
  unchanged: number;
  /** Pastes the account may not change, left out up front. */
  skipped: LibraryEntry[];
  /** Pastes whose change failed. */
  failed: { entry: LibraryEntry; error: unknown }[];
  /** Pastes not tried because the edit was cancelled. */
  cancelled: LibraryEntry[];
}

/**
 * Applies `action` to `entries`.
 * @param setTags the provider call for one paste
 * @param onProgress called after each paste with the number done and the number to do
 */
export async function runBulk(
  entries: readonly LibraryEntry[],
  action: BulkAction,
  setTags: (entry: LibraryEntry, change: TagChange, signal?: AbortSignal) => Promise<PasteMeta>,
  options: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<BulkResult> {
  const result: BulkResult = { changed: [], unchanged: 0, skipped: [], failed: [], cancelled: [] };
  const work: { entry: LibraryEntry; change: TagChange }[] = [];
  for (const entry of entries) {
    const change = changeFor(action, entry);
    if (!change) {
      result.unchanged++;
    } else if (entry.meta.canEdit === false) {
      result.skipped.push(entry);
    } else {
      work.push({ entry, change });
    }
  }
  let done = 0;
  options.onProgress?.(0, work.length);
  const outcomes = await mapLimit(
    work,
    BULK_CONCURRENCY,
    async ({ entry, change }) => {
      try {
        return await setTags(entry, change, options.signal);
      } finally {
        options.onProgress?.(++done, work.length);
      }
    },
    options.signal,
  );
  outcomes.forEach((outcome, i) => {
    const { entry } = work[i]!;
    if (!outcome) {
      result.cancelled.push(entry);
    } else if (outcome.status === 'fulfilled') {
      result.changed.push(outcome.value);
    } else {
      result.failed.push({ entry, error: outcome.reason });
    }
  });
  return result;
}
