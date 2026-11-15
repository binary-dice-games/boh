// MIT License © 2026 Binary Dice Games
/**
 * @file The bins of every connected account (design section 4.3). Each account's configuration
 * file is shown from the browser's cache first, then from the provider; changes are
 * read-modify-write against the file's revision, retried once on a conflict.
 */
import {
  ConfigFileError,
  emptyConfig,
  parseConfig,
  serializeConfig,
  type Bin,
  type ConfigFile,
} from './config-file';
import { BohError, ConflictError } from './errors';
import type { Provider, ProviderId } from './providers/provider';
import type { SafeStore } from './storage';
import type { TagRule } from './tags';

/** One account's configuration as boh holds it. */
export interface AccountConfig {
  provider: ProviderId;
  /**
   * `loading`: only the cached copy (or nothing) yet; `ready`: read from the provider;
   * `broken`: the file cannot be used (shown read-only, see `reset`); `error`: it could not be read.
   */
  status: 'loading' | 'ready' | 'broken' | 'error';
  config: ConfigFile;
  rev: string | null;
  /** Why the file is broken or could not be read. */
  problem?: string;
}

/** A bin and the account it belongs to. */
export interface BinEntry {
  provider: ProviderId;
  bin: Bin;
}

interface Cached {
  text: string;
  rev: string | null;
}

/** The bins of every connected account. */
export class BinStore {
  private readonly states = new Map<ProviderId, AccountConfig>();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly providers: Partial<Record<ProviderId, Provider>>,
    private readonly cache: SafeStore,
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

  private provider(id: ProviderId): Provider {
    const provider = this.providers[id];
    if (!provider) {
      throw new BohError('no_provider', `no provider ${id}`);
    }
    return provider;
  }

  private cacheKey(id: ProviderId): string | undefined {
    const account = this.providers[id]?.account();
    return account ? `boh.config.${id}.${account.id}` : undefined;
  }

  private set(state: AccountConfig, cache = true): void {
    this.states.set(state.provider, state);
    const key = this.cacheKey(state.provider);
    if (cache && key && state.status === 'ready') {
      this.cache.setJson(key, {
        text: serializeConfig(state.config),
        rev: state.rev,
      } satisfies Cached);
    }
    this.emit();
  }

  /** The account's configuration, if loaded or cached. */
  state(id: ProviderId): AccountConfig | undefined {
    return this.states.get(id);
  }

  /** Every bin of every account (cached ones included), in account then file order. */
  bins(): BinEntry[] {
    return [...this.states.values()].flatMap((s) =>
      s.config.bins.map((bin) => ({ provider: s.provider, bin })),
    );
  }

  /** The bin with `id`. */
  find(id: string): BinEntry | undefined {
    return this.bins().find((e) => e.bin.id === id);
  }

  /** The default bin: the first account's `defaultBin` that exists, else the first bin. */
  defaultBin(): BinEntry | undefined {
    for (const s of this.states.values()) {
      const found = s.config.bins.find((b) => b.id === s.config.defaultBin);
      if (found) {
        return { provider: s.provider, bin: found };
      }
    }
    return this.bins()[0];
  }

  private fromText(id: ProviderId, text: string | null, rev: string | null): AccountConfig {
    if (text === null) {
      return { provider: id, status: 'ready', config: emptyConfig(), rev };
    }
    try {
      return { provider: id, status: 'ready', config: parseConfig(text), rev };
    } catch (e) {
      const problem = e instanceof Error ? e.message : String(e);
      return { provider: id, status: 'broken', config: emptyConfig(), rev, problem };
    }
  }

  /** Shows the cached copy, then reads the provider's file. Never throws: failure is a state. */
  async load(id: ProviderId): Promise<void> {
    const key = this.cacheKey(id);
    const cached = key ? this.cache.getJson<Cached>(key) : undefined;
    if (cached && typeof cached.text === 'string' && !this.states.has(id)) {
      const state = this.fromText(id, cached.text, cached.rev ?? null);
      if (state.status === 'ready') {
        this.set({ ...state, status: 'loading' }, false);
      }
    }
    try {
      const { text, rev } = await this.provider(id).readConfig();
      this.set(this.fromText(id, text, rev));
    } catch (e) {
      const old = this.states.get(id);
      this.set(
        {
          provider: id,
          status: 'error',
          config: old?.config ?? emptyConfig(),
          rev: old?.rev ?? null,
          problem: e instanceof Error ? e.message : String(e),
        },
        false,
      );
      throw e;
    }
  }

  /** Forgets the account's configuration and its cached copy (on disconnect). */
  forget(id: ProviderId): void {
    const key = this.cacheKey(id);
    if (key) {
      this.cache.removeItem(key);
    }
    this.states.delete(id);
    this.emit();
  }

  /**
   * Applies `change` to the account's configuration and writes it. On a conflict it re-reads,
   * applies `change` to the newer file and writes once more.
   * @throws {ConflictError} when the second write conflicts too
   * @throws {ConfigFileError} when the file is broken
   */
  async mutate(id: ProviderId, change: (config: ConfigFile) => void): Promise<void> {
    const provider = this.provider(id);
    let state = this.states.get(id);
    if (!state || state.status === 'loading' || state.status === 'error') {
      const { text, rev } = await provider.readConfig();
      state = this.fromText(id, text, rev);
      this.set(state);
    }
    for (let attempt = 0; ; attempt++) {
      if (state.status === 'broken') {
        throw new ConfigFileError('bad_config', state.problem);
      }
      const next = structuredClone(state.config);
      change(next);
      try {
        const rev = await provider.writeConfig(serializeConfig(next), state.rev);
        this.set({ provider: id, status: 'ready', config: next, rev });
        return;
      } catch (e) {
        if (!(e instanceof ConflictError) || attempt > 0) {
          throw e;
        }
      }
      const { text, rev } = await provider.readConfig();
      state = this.fromText(id, text, rev);
      this.set(state);
    }
  }

  /** Adds a bin to its account's configuration. */
  addBin(id: ProviderId, bin: Bin): Promise<void> {
    return this.mutate(id, (config) => {
      config.bins.push(bin);
      config.defaultBin ??= bin.id;
    });
  }

  /** The tag rules of the account `id`. */
  rules(id: ProviderId): TagRule[] {
    return this.states.get(id)?.config.rules ?? [];
  }

  /** The bin with the same provider and folder as given, if one is registered. */
  findFolder(provider: ProviderId, folderId: string): BinEntry | undefined {
    return this.bins().find((e) => e.provider === provider && e.bin.folder.id === folderId);
  }

  /** Adds a tag rule to the account `id`. */
  addRule(id: ProviderId, rule: TagRule): Promise<void> {
    return this.mutate(id, (config) => {
      config.rules = [...(config.rules ?? []), rule];
    });
  }

  /** Replaces the tag rule with `rule.id` in the account `id` (no change when it is gone). */
  updateRule(id: ProviderId, rule: TagRule): Promise<void> {
    return this.mutate(id, (config) => {
      config.rules = (config.rules ?? []).map((r) => (r.id === rule.id ? rule : r));
    });
  }

  /** Removes the tag rule `ruleId` from the account `id`. */
  removeRule(id: ProviderId, ruleId: string): Promise<void> {
    return this.mutate(id, (config) => {
      config.rules = (config.rules ?? []).filter((r) => r.id !== ruleId);
    });
  }

  /** Changes a bin's name, visibility, default format, default tags or shared mark. */
  updateBin(
    binId: string,
    patch: Partial<
      Pick<Bin, 'name' | 'visibility' | 'defaultFormat' | 'defaultTags' | 'shared' | 'owner'>
    >,
  ): Promise<void> {
    const entry = this.find(binId);
    if (!entry) {
      return Promise.reject(new BohError('no_bin', 'the bin no longer exists'));
    }
    return this.mutate(entry.provider, (config) => {
      const bin = config.bins.find((b) => b.id === binId);
      if (bin) {
        Object.assign(bin, patch);
      }
    });
  }

  /**
   * Removes a bin from boh (the folder and its files stay). Rules naming it lose it; a rule left
   * with no bin is removed rather than turned into a rule for every bin.
   */
  removeBin(binId: string): Promise<void> {
    const entry = this.find(binId);
    if (!entry) {
      return Promise.resolve();
    }
    return this.mutate(entry.provider, (config) => {
      config.bins = config.bins.filter((b) => b.id !== binId);
      if (config.defaultBin === binId) {
        config.defaultBin = config.bins[0]?.id ?? null;
      }
      if (config.rules) {
        config.rules = config.rules.flatMap((r) => {
          if (!r.bins.includes(binId)) {
            return [r];
          }
          const bins = r.bins.filter((b) => b !== binId);
          return bins.length ? [{ ...r, bins }] : [];
        });
      }
    });
  }

  /** Overwrites a broken file with an empty configuration. */
  async reset(id: ProviderId): Promise<void> {
    const state = this.states.get(id);
    const rev = await this.provider(id).writeConfig(
      serializeConfig(emptyConfig()),
      state?.rev ?? null,
    );
    this.set({ provider: id, status: 'ready', config: emptyConfig(), rev });
  }
}
