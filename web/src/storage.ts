// MIT License © 2026 Binary Dice Games
/**
 * @file Browser storage that never throws: private windows, blocked site data and sandboxed
 * frames make `localStorage` throw or vanish, and boh must work without it.
 */

/** The subset of `Storage` boh uses. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** A store kept in memory: used when the browser's is unavailable, and by the tests. */
export class MemoryStore implements KeyValueStore {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

/** Wraps a store so every access swallows errors (a failed write is simply not remembered). */
export class SafeStore implements KeyValueStore {
  constructor(private readonly inner: KeyValueStore) {}
  getItem(key: string): string | null {
    try {
      return this.inner.getItem(key);
    } catch {
      return null;
    }
  }
  setItem(key: string, value: string): void {
    try {
      this.inner.setItem(key, value);
    } catch {
      // full or blocked: not remembered
    }
  }
  removeItem(key: string): void {
    try {
      this.inner.removeItem(key);
    } catch {
      // blocked: nothing stored anyway
    }
  }
  /** Reads JSON, or `undefined` when missing or unparsable. */
  getJson<T>(key: string): T | undefined {
    const text = this.getItem(key);
    if (text === null) {
      return undefined;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      return undefined;
    }
  }
  setJson(key: string, value: unknown): void {
    this.setItem(key, JSON.stringify(value));
  }
}

/** The browser's `localStorage` or `sessionStorage`, or a memory store when it is unavailable. */
export function browserStore(kind: 'local' | 'session'): SafeStore {
  try {
    const store = kind === 'local' ? globalThis.localStorage : globalThis.sessionStorage;
    if (store) {
      return new SafeStore(store);
    }
  } catch {
    // the accessor throws when site data is blocked
  }
  return new SafeStore(new MemoryStore());
}
