// MIT License © 2026 Binary Dice Games
import { describe, expect, it } from 'vitest';
import { createDisabledProvider } from '../../web/src/providers/disabled';

describe('a provider the build leaves out', () => {
  it('is not configured, never signed in, and refuses every call', async () => {
    const p = createDisabledProvider('db');
    expect(p).toMatchObject({ id: 'db', label: 'Dropbox', configured: false });
    expect(p.account()).toBeNull();
    expect(p.pickFolder).toBeUndefined();
    expect(p.listFolders).toBeUndefined();
    for (const call of [
      () => p.signIn({ stay: true }),
      () => p.readConfig(),
      () => p.openRef('abc'),
      () => p.upload({ id: 'f', name: 'f' }, 'a.txt', new Blob(['a'])),
    ]) {
      await expect(call()).rejects.toMatchObject({ reason: 'not_configured' });
    }
    await expect(p.signOut()).resolves.toBeUndefined();
  });
});
