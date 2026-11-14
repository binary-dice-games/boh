// MIT License © 2026 Binary Dice Games
import { describe, expect, it } from 'vitest';
import { LocalState, MAX_RECENT } from '../../web/src/local-state';
import { browserStore, MemoryStore, SafeStore } from '../../web/src/storage';
import { TokenStore } from '../../web/src/token-store';

const fresh = () => new SafeStore(new MemoryStore());

describe('LocalState', () => {
  it('keeps recent pastes newest first, without duplicates, at most 50', () => {
    const state = new LocalState(fresh());
    for (let i = 0; i < MAX_RECENT + 5; i++) {
      state.addRecent({ link: `l${i}`, name: `n${i}`, provider: 'gd', at: i, own: false });
    }
    expect(state.recent()).toHaveLength(MAX_RECENT);
    state.addRecent({ link: 'l10', name: 'again', provider: 'gd', at: 99, own: false });
    expect(state.recent()[0]).toMatchObject({ link: 'l10', name: 'again' });
    expect(state.recent().filter((p) => p.link === 'l10')).toHaveLength(1);
    state.removeRecent('l10');
    expect(state.recent().some((p) => p.link === 'l10')).toBe(false);
    state.clearRecent();
    expect(state.recent()).toEqual([]);
  });

  it('remembers that a paste was uploaded here when it is opened later', () => {
    const state = new LocalState(fresh());
    state.addRecent({ link: 'l', name: 'n', provider: 'db', at: 1, own: true });
    state.addRecent({ link: 'l', name: 'n', provider: 'db', at: 2, own: false });
    expect(state.recent()[0]?.own).toBe(true);
  });

  it('ignores damaged entries and has defaults', () => {
    const store = fresh();
    store.setItem(
      'boh.recent',
      JSON.stringify([{ link: 1 }, { link: 'ok', name: 'n', provider: 'xx', at: 1 }]),
    );
    store.setItem('boh.prefs', '{broken');
    const state = new LocalState(store);
    expect(state.recent()).toEqual([]);
    expect(state.prefs()).toEqual({ stay: true, wrap: false, lastBin: undefined });
    state.setPrefs({ wrap: true, lastBin: 'b' });
    expect(state.prefs()).toEqual({ stay: true, wrap: true, lastBin: 'b' });
  });
});

describe('storage', () => {
  it('swallows a store that throws', () => {
    const throwing = new SafeStore({
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });
    expect(throwing.getItem('x')).toBeNull();
    expect(() => throwing.setItem('x', 'y')).not.toThrow();
    expect(() => throwing.removeItem('x')).not.toThrow();
    expect(throwing.getJson('x')).toBeUndefined();
  });

  it('falls back to memory without browser storage', () => {
    const store = browserStore('local');
    store.setItem('k', 'v');
    expect(store.getItem('k')).toBe('v');
  });
});

describe('TokenStore', () => {
  it('keeps a sign-in in the store chosen and moves it', () => {
    const local = fresh();
    const session = fresh();
    const tokens = new TokenStore(local, session);
    tokens.save('db', { accessToken: 't', expiresAt: 1 }, false);
    expect(tokens.stays('db')).toBe(false);
    expect(tokens.load('db')?.accessToken).toBe('t');
    tokens.save('db', { accessToken: 't2', expiresAt: 1 }, true);
    expect(tokens.stays('db')).toBe(true);
    expect(session.getItem('boh.auth.db')).toBeNull();
    tokens.clear('db');
    expect(tokens.load('db')).toBeUndefined();
  });
});
