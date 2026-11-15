// MIT License © 2026 Binary Dice Games
/**
 * @file The library index (spec/02_tags_and_shared_bins/DESIGN.md section 3.5): the listed pastes
 * of many bins with their tags, cached per account in IndexedDB so the library shows before the
 * network answers, and searched in the browser. It never fetches paste contents and never polls:
 * bins are listed when the library asks and after boh's own writes.
 */
import type { Bin } from './config-file';
import { mapLimit } from './pool';
import type { PasteMeta, Provider, ProviderId } from './providers/provider';
import { matches, type Query } from './query';
import { derivedTags } from './tags';

/** The most pastes listed per bin. */
export const MAX_PER_BIN = 5000;
/** How many bins are listed at once. */
export const CONCURRENT_BINS = 3;
/** Cached listings older than this are dropped. */
export const CACHE_MAX_AGE_MS = 30 * 24 * 3600 * 1000;

/** A bin as the library sees it: with its provider and the account that registered it. */
export interface LibraryBin {
  provider: ProviderId;
  accountId: string;
  bin: Bin;
}

/** One paste of the library. */
export interface LibraryEntry {
  bin: LibraryBin;
  meta: PasteMeta;
  /** Derived tags (`format:md`, `kind:image`, ...). */
  derived: string[];
}

/** How far a bin's listing got. */
export interface BinLoad {
  /** `loading`: a listing runs (cached entries may show); `ready`: listed; `error`: it failed. */
  status: 'loading' | 'ready' | 'error';
  /** The entries come from the cache and were not listed on this page yet. */
  fromCache: boolean;
  /** The bin has more than `MAX_PER_BIN` pastes; the newest are shown. */
  truncated: boolean;
  error?: unknown;
}

/** A cached listing. */
export interface CachedBin {
  /** When it was listed, epoch ms. */
  at: number;
  items: PasteMeta[];
  truncated: boolean;
}

/** Where listings are cached. Every method resolves; failures read as "nothing cached". */
export interface LibraryCache {
  get(key: string): Promise<CachedBin | undefined>;
  put(key: string, value: CachedBin): Promise<void>;
  /** Deletes every key that starts with `prefix`. */
  deletePrefix(prefix: string): Promise<void>;
}

/** A cache in memory (tests, and browsers without IndexedDB). */
export class MemoryLibraryCache implements LibraryCache {
  readonly map = new Map<string, CachedBin>();

  async get(key: string): Promise<CachedBin | undefined> {
    const value = this.map.get(key);
    return value && structuredClone(value);
  }

  async put(key: string, value: CachedBin): Promise<void> {
    this.map.set(key, structuredClone(value));
  }

  async deletePrefix(prefix: string): Promise<void> {
    for (const key of [...this.map.keys()]) {
      if (key.startsWith(prefix)) {
        this.map.delete(key);
      }
    }
  }
}

/** The browser's cache: IndexedDB database `boh-library`, or memory when it cannot be opened. */
export function browserLibraryCache(): LibraryCache {
  if (typeof indexedDB === 'undefined') {
    return new MemoryLibraryCache();
  }
  let db: Promise<IDBDatabase | undefined> | undefined;
  const open = () =>
    (db ??= new Promise((resolve) => {
      try {
        const req = indexedDB.open('boh-library', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('bins');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(undefined);
        req.onblocked = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    }));
  const run = async <T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T | undefined> => {
    const d = await open();
    if (!d) {
      return undefined;
    }
    return new Promise((resolve) => {
      try {
        const tx = d.transaction('bins', mode);
        const req = fn(tx.objectStore('bins'));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => resolve(undefined);
        tx.onabort = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    });
  };
  return {
    get: (key) => run('readonly', (s) => s.get(key) as IDBRequest<CachedBin | undefined>),
    put: async (key, value) => {
      await run('readwrite', (s) => s.put(value, key));
    },
    deletePrefix: async (prefix) => {
      await run('readwrite', (s) => s.delete(IDBKeyRange.bound(prefix, `${prefix}￿`)));
    },
  };
}

interface Slot {
  def: LibraryBin;
  entries: LibraryEntry[];
  load: BinLoad;
  /** Listed from the provider on this page. */
  listed: boolean;
  running?: Promise<void>;
}

/** Counts of tags over some entries, most used first. */
export interface Facets {
  tags: [string, number][];
  derived: [string, number][];
  bins: [string, number][];
}

const byCount = (map: Map<string, number>): [string, number][] =>
  [...map].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

/** Tag, derived tag and bin counts over `entries`. */
export function facets(entries: readonly LibraryEntry[]): Facets {
  const tags = new Map<string, number>();
  const derived = new Map<string, number>();
  const bins = new Map<string, number>();
  for (const e of entries) {
    for (const t of e.meta.tags ?? []) {
      tags.set(t, (tags.get(t) ?? 0) + 1);
    }
    for (const t of e.derived) {
      derived.set(t, (derived.get(t) ?? 0) + 1);
    }
    bins.set(e.bin.bin.id, (bins.get(e.bin.bin.id) ?? 0) + 1);
  }
  return { tags: byCount(tags), derived: byCount(derived), bins: byCount(bins) };
}

const cacheKey = (b: LibraryBin) => `${b.provider}:${b.accountId}:${b.bin.id}`;

/** The pastes of the bins the library shows. */
export class LibraryIndex {
  private readonly slots = new Map<string, Slot>();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly providers: Partial<Record<ProviderId, Provider>>,
    private readonly cache: LibraryCache,
    private readonly now: () => number = Date.now,
  ) {}

  /** Calls `listener` after every change; returns the unsubscribe function. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private entry(def: LibraryBin, meta: PasteMeta): LibraryEntry {
    return { bin: def, meta, derived: derivedTags(meta) };
  }

  /**
   * Shows `bins` (and only those): each from the cache first, then listed from its provider when
   * it was not listed on this page yet or `refresh` is set. Bins are listed `CONCURRENT_BINS` at a
   * time. Never throws: a failed listing keeps the cached entries and is reported in `load`.
   */
  async load(
    bins: readonly LibraryBin[],
    options: { refresh?: boolean; signal?: AbortSignal } = {},
  ): Promise<void> {
    const wanted = new Set(bins.map((b) => b.bin.id));
    for (const id of [...this.slots.keys()]) {
      if (!wanted.has(id)) {
        this.slots.delete(id);
      }
    }
    for (const def of bins) {
      const slot = this.slots.get(def.bin.id);
      if (slot) {
        slot.def = def;
        slot.entries = slot.entries.map((e) => ({ ...e, bin: def }));
      }
    }
    this.emit();
    await mapLimit(
      bins,
      CONCURRENT_BINS,
      (def) => this.loadBin(def, options.refresh ?? false, options.signal),
      options.signal,
    );
  }

  private async loadBin(def: LibraryBin, refresh: boolean, signal?: AbortSignal): Promise<void> {
    let slot = this.slots.get(def.bin.id);
    if (!slot) {
      slot = {
        def,
        entries: [],
        load: { status: 'loading', fromCache: false, truncated: false },
        listed: false,
      };
      this.slots.set(def.bin.id, slot);
      const cached = await this.cache.get(cacheKey(def));
      if (cached && this.now() - cached.at <= CACHE_MAX_AGE_MS && slot.entries.length === 0) {
        slot.entries = cached.items.map((m) => this.entry(slot!.def, m));
        slot.load = { status: 'loading', fromCache: true, truncated: cached.truncated };
      } else if (cached) {
        void this.cache.deletePrefix(cacheKey(def));
      }
      this.emit();
    }
    if (slot.running) {
      return slot.running;
    }
    if (slot.listed && !refresh) {
      return;
    }
    const current = slot;
    current.running = this.list(current, signal).finally(() => {
      current.running = undefined;
    });
    return current.running;
  }

  private async list(slot: Slot, signal?: AbortSignal): Promise<void> {
    const provider = this.providers[slot.def.provider];
    slot.load = { ...slot.load, status: 'loading', error: undefined };
    this.emit();
    try {
      if (!provider) {
        throw new Error(`no provider ${slot.def.provider}`);
      }
      const items: PasteMeta[] = [];
      let cursor: string | undefined;
      do {
        signal?.throwIfAborted();
        const page = await provider.list(slot.def.bin.folder, cursor);
        items.push(...page.items);
        cursor = page.cursor;
      } while (cursor && items.length < MAX_PER_BIN);
      const truncated = Boolean(cursor) || items.length > MAX_PER_BIN;
      const kept = items.slice(0, MAX_PER_BIN);
      if (this.slots.get(slot.def.bin.id) !== slot) {
        return; // the bin was dropped meanwhile
      }
      slot.entries = kept.map((m) => this.entry(slot.def, m));
      slot.load = { status: 'ready', fromCache: false, truncated };
      slot.listed = true;
      await this.cache.put(cacheKey(slot.def), { at: this.now(), items: kept, truncated });
    } catch (error) {
      slot.load = { ...slot.load, status: 'error', error };
    }
    this.emit();
  }

  /** How far the listing of `binId` got, if the library shows it. */
  status(binId: string): BinLoad | undefined {
    return this.slots.get(binId)?.load;
  }

  /** Every entry of the bins shown. */
  entries(): LibraryEntry[] {
    return [...this.slots.values()].flatMap((s) => s.entries);
  }

  /** The entries matching `query`, newest first. */
  query(query: Query): LibraryEntry[] {
    return this.entries()
      .filter((e) =>
        matches(query, {
          name: e.meta.name,
          tags: e.meta.tags ?? [],
          derived: e.derived,
          binName: e.bin.bin.name,
          own: !e.bin.bin.shared,
        }),
      )
      .sort((a, b) => (b.meta.modified ?? '').localeCompare(a.meta.modified ?? ''));
  }

  /** Every manual tag in the library, for completion. */
  knownTags(): string[] {
    return facets(this.entries()).tags.map(([t]) => t);
  }

  private save(slot: Slot): void {
    if (slot.listed || slot.load.fromCache) {
      void this.cache.put(cacheKey(slot.def), {
        at: this.now(),
        items: slot.entries.map((e) => e.meta),
        truncated: slot.load.truncated,
      });
    }
  }

  /** Replaces a paste's metadata wherever the library shows it (after a tag change). */
  update(meta: PasteMeta): void {
    for (const slot of this.slots.values()) {
      const at = slot.entries.findIndex(
        (e) => e.meta.provider === meta.provider && e.meta.key === meta.key,
      );
      if (at >= 0) {
        slot.entries[at] = this.entry(slot.def, { ...slot.entries[at]!.meta, ...meta });
        this.save(slot);
      }
    }
    this.emit();
  }

  /** Adds a new paste of the bin `binId` (after an upload), if the library shows that bin. */
  add(binId: string, meta: PasteMeta): void {
    const slot = this.slots.get(binId);
    if (!slot) {
      return;
    }
    slot.entries = [
      this.entry(slot.def, meta),
      ...slot.entries.filter((e) => e.meta.key !== meta.key),
    ];
    this.save(slot);
    this.emit();
  }

  /** Drops a deleted paste. */
  remove(meta: PasteMeta): void {
    for (const slot of this.slots.values()) {
      const before = slot.entries.length;
      slot.entries = slot.entries.filter(
        (e) => !(e.meta.provider === meta.provider && e.meta.key === meta.key),
      );
      if (slot.entries.length !== before) {
        this.save(slot);
      }
    }
    this.emit();
  }

  /** Forgets the bins of `provider` and deletes its cached listings (on disconnect). */
  async forget(provider: ProviderId): Promise<void> {
    for (const [id, slot] of [...this.slots]) {
      if (slot.def.provider === provider) {
        this.slots.delete(id);
      }
    }
    this.emit();
    await this.cache.deletePrefix(`${provider}:`);
  }
}
