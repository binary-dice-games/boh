// MIT License © 2026 Binary Dice Games
import { describe, expect, it } from 'vitest';
import { changeFor, runBulk } from '../../web/src/bulk-tags';
import type { Bin } from '../../web/src/config-file';
import { ProviderError } from '../../web/src/errors';
import {
  CACHE_MAX_AGE_MS,
  facets,
  LibraryIndex,
  MAX_PER_BIN,
  MemoryLibraryCache,
  type LibraryBin,
  type LibraryEntry,
} from '../../web/src/library-index';
import type { FolderRef, PasteMeta, Provider } from '../../web/src/providers/provider';
import { parseQuery } from '../../web/src/query';
import { applyTagChange } from '../../web/src/tags';

/** A provider of folders in memory: only `list` and `setTags` are used. */
function memoryProvider(folders: Record<string, PasteMeta[]>, pageSize = 50) {
  const calls: string[] = [];
  const failing = new Set<string>();
  const provider = {
    id: 'gd',
    async list(folder: FolderRef, cursor?: string) {
      calls.push(folder.id);
      if (failing.has(folder.id)) {
        throw new ProviderError('network', 'offline');
      }
      const all = folders[folder.id] ?? [];
      const start = Number(cursor ?? 0);
      const next = start + pageSize;
      return {
        items: all.slice(start, next),
        cursor: next < all.length ? String(next) : undefined,
      };
    },
  } as unknown as Provider;
  return { provider, calls, failing };
}

const paste = (
  key: string,
  name: string,
  tags: string[] = [],
  modified = '2026-01-01',
): PasteMeta => ({ provider: 'gd', key, name, tags, modified }) as PasteMeta;

const bin = (id: string, name = id, shared = false): LibraryBin => ({
  provider: 'gd',
  accountId: 'acct',
  bin: { id, name, folder: { id: `f-${id}`, name }, visibility: 'members', shared } as Bin,
});

describe('LibraryIndex', () => {
  it('lists every page of each bin and answers queries newest first', async () => {
    const { provider } = memoryProvider(
      {
        'f-a': [
          paste('1', 'one.md', ['work'], '2026-01-01'),
          paste('2', 'two.py', [], '2026-03-01'),
        ],
        'f-b': [paste('3', 'three.png', ['work', 'cats'], '2026-02-01')],
      },
      1,
    );
    const index = new LibraryIndex({ gd: provider }, new MemoryLibraryCache());
    await index.load([bin('a'), bin('b', 'Shared', true)]);
    expect(index.entries()).toHaveLength(3);
    expect(index.status('a')).toMatchObject({ status: 'ready', truncated: false });
    expect(index.query(parseQuery('')).map((e) => e.meta.key)).toEqual(['2', '3', '1']);
    expect(index.query(parseQuery('#work')).map((e) => e.meta.key)).toEqual(['3', '1']);
    expect(index.query(parseQuery('kind:text lang:python')).map((e) => e.meta.key)).toEqual(['2']);
    expect(index.query(parseQuery('from:others')).map((e) => e.meta.key)).toEqual(['3']);
    expect(index.query(parseQuery('bin:shared -#cats'))).toEqual([]);
    expect(index.knownTags()).toEqual(['work', 'cats']);
  });

  it('counts facets over the result', async () => {
    const { provider } = memoryProvider({
      'f-a': [paste('1', 'a.md', ['x', 'y']), paste('2', 'b.md', ['x'])],
    });
    const index = new LibraryIndex({ gd: provider }, new MemoryLibraryCache());
    await index.load([bin('a')]);
    const f = facets(index.entries());
    expect(f.tags).toEqual([
      ['x', 2],
      ['y', 1],
    ]);
    expect(f.derived).toContainEqual(['format:md', 2]);
    expect(f.bins).toEqual([['a', 2]]);
  });

  it('shows the cache first, lists once per page, and again on refresh', async () => {
    const cache = new MemoryLibraryCache();
    const { provider, calls } = memoryProvider({ 'f-a': [paste('1', 'new.txt')] });
    await cache.put('gd:acct:a', {
      at: Date.now(),
      items: [paste('0', 'old.txt')],
      truncated: false,
    });
    const index = new LibraryIndex({ gd: provider }, cache);
    const seen: string[][] = [];
    index.onChange(() => seen.push(index.entries().map((e) => e.meta.name)));
    await index.load([bin('a')]);
    expect(seen).toContainEqual(['old.txt']);
    expect(index.entries().map((e) => e.meta.name)).toEqual(['new.txt']);
    await index.load([bin('a')]);
    expect(calls).toEqual(['f-a']);
    await index.load([bin('a')], { refresh: true });
    expect(calls).toEqual(['f-a', 'f-a']);
    expect((await cache.get('gd:acct:a'))?.items.map((m) => m.name)).toEqual(['new.txt']);
  });

  it('drops a cache older than 30 days', async () => {
    const cache = new MemoryLibraryCache();
    const now = Date.parse('2026-06-01T00:00:00Z');
    await cache.put('gd:acct:a', {
      at: now - CACHE_MAX_AGE_MS - 1,
      items: [paste('0', 'old.txt')],
      truncated: false,
    });
    const { provider, failing } = memoryProvider({});
    failing.add('f-a');
    const index = new LibraryIndex({ gd: provider }, cache, () => now);
    await index.load([bin('a')]);
    expect(index.entries()).toEqual([]);
    expect(cache.map.size).toBe(0);
  });

  it('keeps cached entries of a bin whose listing fails, and the other bins answer', async () => {
    const cache = new MemoryLibraryCache();
    await cache.put('gd:acct:a', {
      at: Date.now(),
      items: [paste('0', 'kept.txt')],
      truncated: false,
    });
    const { provider, failing } = memoryProvider({ 'f-b': [paste('1', 'fine.txt')] });
    failing.add('f-a');
    const index = new LibraryIndex({ gd: provider }, cache);
    await index.load([bin('a'), bin('b')]);
    expect(index.status('a')).toMatchObject({ status: 'error', fromCache: true });
    expect(index.status('b')).toMatchObject({ status: 'ready' });
    expect(
      index
        .entries()
        .map((e) => e.meta.name)
        .sort(),
    ).toEqual(['fine.txt', 'kept.txt']);
  });

  it(`stops at ${MAX_PER_BIN} pastes per bin and says so`, async () => {
    const many = Array.from({ length: MAX_PER_BIN + 10 }, (_, i) => paste(String(i), `p${i}.txt`));
    const { provider } = memoryProvider({ 'f-a': many }, 1000);
    const index = new LibraryIndex({ gd: provider }, new MemoryLibraryCache());
    await index.load([bin('a')]);
    expect(index.entries()).toHaveLength(MAX_PER_BIN);
    expect(index.status('a')?.truncated).toBe(true);
  });

  it('updates, adds and removes entries and keeps the cache in step', async () => {
    const cache = new MemoryLibraryCache();
    const { provider } = memoryProvider({ 'f-a': [paste('1', 'a.txt')] });
    const index = new LibraryIndex({ gd: provider }, cache);
    await index.load([bin('a')]);
    index.update({ ...paste('1', 'a.txt'), tags: ['new'] });
    index.add('a', paste('2', 'b.txt'));
    index.add('not-shown', paste('3', 'c.txt'));
    expect(index.query(parseQuery('#new')).map((e) => e.meta.key)).toEqual(['1']);
    expect(index.entries().map((e) => e.meta.key)).toEqual(['2', '1']);
    index.remove(paste('2', 'b.txt'));
    expect(index.entries().map((e) => e.meta.key)).toEqual(['1']);
    expect((await cache.get('gd:acct:a'))?.items).toEqual([
      { ...paste('1', 'a.txt'), tags: ['new'] },
    ]);
  });

  it('shows only the bins asked for, and forgets a provider with its cache', async () => {
    const cache = new MemoryLibraryCache();
    const { provider } = memoryProvider({
      'f-a': [paste('1', 'a.txt')],
      'f-b': [paste('2', 'b.txt')],
    });
    const index = new LibraryIndex({ gd: provider }, cache);
    await index.load([bin('a'), bin('b')]);
    await index.load([bin('b')]);
    expect(index.entries().map((e) => e.meta.key)).toEqual(['2']);
    await index.forget('gd');
    expect(index.entries()).toEqual([]);
    expect(cache.map.size).toBe(0);
  });

  it('follows a renamed bin in queries', async () => {
    const { provider } = memoryProvider({ 'f-a': [paste('1', 'a.txt')] });
    const index = new LibraryIndex({ gd: provider }, new MemoryLibraryCache());
    await index.load([bin('a', 'Old')]);
    await index.load([bin('a', 'New')]);
    expect(index.query(parseQuery('bin:new'))).toHaveLength(1);
  });
});

describe('bulk tag edits', () => {
  const entry = (key: string, tags: string[], canEdit?: boolean): LibraryEntry => ({
    bin: bin('a'),
    meta: { ...paste(key, `${key}.txt`, tags), canEdit },
    derived: ['format:txt', 'kind:text'],
  });

  it('works out each paste’s change', () => {
    const e = entry('1', ['a', 'b']);
    expect(changeFor({ kind: 'add', tags: ['a', 'c'] }, e)).toEqual({ add: ['c'] });
    expect(changeFor({ kind: 'add', tags: ['a'] }, e)).toBeUndefined();
    expect(changeFor({ kind: 'remove', tags: ['b', 'z'] }, e)).toEqual({ remove: ['b'] });
    expect(changeFor({ kind: 'rename', from: 'a', to: 'x' }, e)).toEqual({
      remove: ['a'],
      add: ['x'],
    });
    expect(changeFor({ kind: 'rename', from: 'z', to: 'x' }, e)).toBeUndefined();
    expect(changeFor({ kind: 'rules', tagsFor: () => ['b', 'r'] }, e)).toEqual({ add: ['r'] });
  });

  it('skips pastes it may not change, reports failures, and changes the rest', async () => {
    const entries = [
      entry('1', []),
      entry('2', ['x'], false),
      entry('3', []),
      entry('4', ['x']),
      entry('5', []),
    ];
    const progress: number[] = [];
    const result = await runBulk(
      entries,
      { kind: 'add', tags: ['x'] },
      async (e, change) => {
        if (e.meta.key === '3') {
          throw new ProviderError('forbidden');
        }
        return { ...e.meta, tags: applyTagChange(e.meta.tags ?? [], change) };
      },
      { onProgress: (done) => progress.push(done) },
    );
    expect(result.changed.map((m) => [m.key, m.tags])).toEqual([
      ['1', ['x']],
      ['5', ['x']],
    ]);
    expect(result.unchanged).toBe(2); // 2 and 4 already have it
    expect(result.skipped).toEqual([]);
    expect(result.failed.map((f) => f.entry.meta.key)).toEqual(['3']);
    expect(progress).toEqual([0, 1, 2, 3]);

    const skip = await runBulk([entry('9', [], false)], { kind: 'add', tags: ['y'] }, () => {
      throw new Error('not called');
    });
    expect(skip.skipped.map((e) => e.meta.key)).toEqual(['9']);
  });

  it('stops starting new changes when cancelled', async () => {
    const controller = new AbortController();
    const entries = Array.from({ length: 12 }, (_, i) => entry(String(i), []));
    const result = await runBulk(
      entries,
      { kind: 'add', tags: ['x'] },
      async (e) => {
        controller.abort();
        return e.meta;
      },
      { signal: controller.signal },
    );
    expect(result.changed.length).toBeLessThanOrEqual(4);
    expect(result.changed.length + result.cancelled.length).toBe(12);
  });
});
