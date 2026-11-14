// MIT License © 2026 Binary Dice Games
import { describe, expect, it } from 'vitest';
import { BinStore } from '../../web/src/bin-store';
import { emptyConfig, parseConfig, serializeConfig, type Bin } from '../../web/src/config-file';
import { ConflictError, ProviderError } from '../../web/src/errors';
import type { Provider } from '../../web/src/providers/provider';
import { MemoryStore, SafeStore } from '../../web/src/storage';

/** A provider that only has a configuration file, which tests can change behind boh's back. */
class ConfigOnly {
  text: string | null = null;
  rev = 0;
  reads = 0;
  failReads = false;
  /** Called before each write; lets a test change the file in between. */
  beforeWrite?: () => void;
  readonly provider = {
    id: 'gd',
    account: () => ({ id: 'acct', name: 'A' }),
    readConfig: async () => {
      this.reads++;
      if (this.failReads) {
        throw new ProviderError('network', 'offline');
      }
      return { text: this.text, rev: this.text === null ? null : String(this.rev) };
    },
    writeConfig: async (text: string, rev: string | null) => {
      this.beforeWrite?.();
      const current = this.text === null ? null : String(this.rev);
      if (rev !== current) {
        throw new ConflictError();
      }
      this.text = text;
      this.rev++;
      return String(this.rev);
    },
  } as unknown as Provider;
  /** Writes the file as another device would. */
  external(change: (bins: Bin[]) => void): void {
    const config = this.text === null ? emptyConfig() : parseConfig(this.text);
    change(config.bins);
    this.text = serializeConfig(config);
    this.rev++;
  }
}

const bin = (id: string, name = id): Bin => ({
  id,
  name,
  folder: { id: `f-${id}`, name },
  visibility: 'members',
});

function setup() {
  const fake = new ConfigOnly();
  const cache = new SafeStore(new MemoryStore());
  const store = new BinStore({ gd: fake.provider }, cache);
  return { fake, cache, store };
}

describe('BinStore', () => {
  it('starts empty when there is no file, and creates it on the first change', async () => {
    const { fake, store } = setup();
    await store.load('gd');
    expect(store.state('gd')?.status).toBe('ready');
    expect(store.bins()).toEqual([]);
    await store.addBin('gd', bin('a'));
    expect(parseConfig(fake.text!).bins.map((b) => b.id)).toEqual(['a']);
    expect(store.defaultBin()?.bin.id).toBe('a');
  });

  it('shows the cached copy first, then the provider’s', async () => {
    const { fake, cache, store } = setup();
    fake.external((bins) => bins.push(bin('old')));
    await store.load('gd');
    fake.external((bins) => bins.push(bin('new')));
    const again = new BinStore({ gd: fake.provider }, cache);
    const seen: string[][] = [];
    again.onChange(() => seen.push(again.bins().map((e) => e.bin.id)));
    await again.load('gd');
    expect(seen).toEqual([['old'], ['old', 'new']]);
    expect(again.state('gd')?.status).toBe('ready');
  });

  it('re-reads and reapplies a change after a conflict', async () => {
    const { fake, store } = setup();
    await store.load('gd');
    fake.external((bins) => bins.push(bin('elsewhere')));
    await store.addBin('gd', bin('here'));
    expect(parseConfig(fake.text!).bins.map((b) => b.id)).toEqual(['elsewhere', 'here']);
  });

  it('gives up after a second conflict', async () => {
    const { fake, store } = setup();
    await store.load('gd');
    fake.beforeWrite = () => fake.external((bins) => bins.push(bin(`x${fake.rev}`)));
    await expect(store.addBin('gd', bin('here'))).rejects.toBeInstanceOf(ConflictError);
  });

  it('keeps unknown fields of a later boh', async () => {
    const { fake, store } = setup();
    fake.text = JSON.stringify({
      format: 'boh-config',
      version: 1,
      bins: [{ ...bin('a'), color: 'red' }],
      defaultBin: 'a',
      theme: 'dark',
    });
    await store.load('gd');
    await store.updateBin('a', { name: 'renamed' });
    const saved = JSON.parse(fake.text) as Record<string, unknown> & {
      bins: Record<string, unknown>[];
    };
    expect(saved.theme).toBe('dark');
    expect(saved.bins[0]).toMatchObject({ name: 'renamed', color: 'red' });
  });

  it('never overwrites a broken file, until reset', async () => {
    const { fake, store } = setup();
    fake.text = '{not json';
    await store.load('gd');
    expect(store.state('gd')).toMatchObject({ status: 'broken' });
    await expect(store.addBin('gd', bin('a'))).rejects.toMatchObject({ reason: 'bad_config' });
    expect(fake.text).toBe('{not json');
    await store.reset('gd');
    expect(parseConfig(fake.text!)).toEqual(emptyConfig());
  });

  it('records a failed read and still accepts changes once it can read', async () => {
    const { fake, store } = setup();
    fake.failReads = true;
    await expect(store.load('gd')).rejects.toMatchObject({ reason: 'network' });
    expect(store.state('gd')?.status).toBe('error');
    fake.failReads = false;
    await store.addBin('gd', bin('a'));
    expect(store.bins()).toHaveLength(1);
  });

  it('removes bins, moves the default, and forgets an account with its cache', async () => {
    const { cache, store } = setup();
    await store.load('gd');
    await store.addBin('gd', bin('a'));
    await store.addBin('gd', bin('b'));
    await store.removeBin('a');
    expect(store.bins().map((e) => e.bin.id)).toEqual(['b']);
    expect(store.defaultBin()?.bin.id).toBe('b');
    expect(store.find('b')?.provider).toBe('gd');
    store.forget('gd');
    expect(store.bins()).toEqual([]);
    expect(cache.getItem('boh.config.gd.acct')).toBeNull();
  });
});

describe('config file', () => {
  it.each([
    ['not json', '{', 'bad_config'],
    ['another format', '{"format":"x","version":1,"bins":[]}', 'bad_config'],
    ['a newer version', '{"format":"boh-config","version":2,"bins":[]}', 'newer_config'],
    ['a bad bin', '{"format":"boh-config","version":1,"bins":[{"id":"a"}]}', 'bad_config'],
    [
      'a bad visibility',
      JSON.stringify({
        format: 'boh-config',
        version: 1,
        bins: [{ ...bin('a'), visibility: 'world' }],
      }),
      'bad_config',
    ],
    [
      'duplicate ids',
      JSON.stringify({ format: 'boh-config', version: 1, bins: [bin('a'), bin('a')] }),
      'bad_config',
    ],
  ])('rejects %s', (_what, text, reason) => {
    expect(() => parseConfig(text)).toThrow(expect.objectContaining({ reason }));
  });

  it('drops a default that names no bin', () => {
    expect(
      parseConfig(
        JSON.stringify({ format: 'boh-config', version: 1, bins: [], defaultBin: 'gone' }),
      ).defaultBin,
    ).toBeNull();
  });
});
