// MIT License © 2026 Binary Dice Games
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { base64UrlToText } from '../../web/src/b64';
import { ConflictError } from '../../web/src/errors';
import { createOneDriveProvider, shareIdOf } from '../../web/src/providers/onedrive';
import { FakeGraph } from '../support/fake-graph';
import { testEnv } from '../support/provider-env';

let fake: FakeGraph;
let base: string;

beforeAll(async () => {
  fake = new FakeGraph();
  base = await fake.start();
});

afterAll(() => fake.close());

function onedrive(options: { user?: string; signedIn?: boolean } = {}) {
  const user = options.user ?? 'alice';
  const env = testEnv({
    microsoft: {
      clientId: fake.clientId,
      authority: `${base}/common/oauth2/v2.0`,
      graphBase: `${base}/v1.0`,
    },
  });
  if (options.signedIn !== false) {
    env.tokens.save(
      'od',
      {
        accessToken: fake.issueToken(user),
        expiresAt: Date.now() + 3600e3,
        account: { id: `ms-${user}`, name: user },
      },
      true,
    );
  }
  return { provider: createOneDriveProvider(env), env };
}

describe('OneDrive helpers', () => {
  it('encodes a sharing URL as a Graph share id', () => {
    expect(shareIdOf('https://1drv.ms/x')).toBe('u!aHR0cHM6Ly8xZHJ2Lm1zL3g');
  });
});

describe('OneDrive sign-in', () => {
  it('signs in with PKCE, then renews with the rotated refresh token', async () => {
    fake.nextUser = 'bob';
    const { provider, env } = onedrive({ signedIn: false });
    expect(await provider.signIn({ stay: true })).toEqual({
      id: 'ms-bob',
      name: 'Bob',
      email: 'bob@example.com',
    });
    const first = env.tokens.load('od')!;
    env.tokens.save('od', { ...first, expiresAt: 0 }, true);
    await provider.readConfig();
    const second = env.tokens.load('od')!;
    expect(second.accessToken).not.toBe(first.accessToken);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    await provider.signOut();
    expect(provider.account()).toBeNull();
  });
});

describe('OneDrive configuration file', () => {
  it('uses the app folder with If-Match and If-None-Match', async () => {
    const { provider } = onedrive({ user: 'carol' });
    expect(await provider.readConfig()).toEqual({ text: null, rev: null });
    const rev1 = await provider.writeConfig('{"v":1}', null);
    await expect(provider.writeConfig('{"v":0}', null)).rejects.toBeInstanceOf(ConflictError);
    expect(await provider.readConfig()).toEqual({ text: '{"v":1}', rev: rev1 });
    await provider.writeConfig('{"v":2}', rev1);
    await expect(provider.writeConfig('{"v":3}', rev1)).rejects.toBeInstanceOf(ConflictError);
    expect(fake.appFile('carol')?.content.toString()).toBe('{"v":2}');
  });
});

describe('OneDrive bins and pastes', () => {
  it('browses own and shared folders and creates folders', async () => {
    const work = fake.add('dave', 'Work');
    fake.add('dave', 'Inner', { parent: work });
    fake.add('dave', 'loose.txt', { content: 'x' });
    fake.add('erin', 'Team', { sharedWith: ['dave'] });
    const { provider } = onedrive({ user: 'dave' });
    const top = await provider.listFolders!(null);
    expect(top.map((f) => f.name)).toEqual(['boh', 'Team', 'Work']);
    expect(top.find((f) => f.name === 'Team')?.driveId).toBe('drive-erin');
    const workRef = top.find((f) => f.name === 'Work')!;
    expect((await provider.listFolders!(workRef)).map((f) => f.name)).toEqual(['Inner']);
    const made = await provider.createFolder('Pastes', workRef);
    expect(made).toMatchObject({ name: 'Pastes', driveId: 'drive-dave' });
    await expect(provider.createFolder('Pastes', workRef)).rejects.toMatchObject({ status: 409 });
  });

  it('has no tag storage: refuses tag writes', async () => {
    const { provider } = onedrive({ user: 'dave' });
    expect(provider.capabilities).toEqual({ tags: false, binLinks: false });
    const team = (await provider.listFolders!(null)).find((f) => f.name === 'Team')!;
    await expect(
      provider.upload(team, 'x.txt', new Blob(['x']), { tags: ['a'] }),
    ).rejects.toMatchObject({ reason: 'unsupported' });
    await expect(
      provider.setTags({ provider: 'od', key: 'k', name: 'x.txt' }, { add: ['a'] }),
    ).rejects.toMatchObject({ reason: 'unsupported' });
  });

  it('uploads into a folder shared by someone else, renaming on a clash', async () => {
    const { provider } = onedrive({ user: 'dave' });
    const team = (await provider.listFolders!(null)).find((f) => f.name === 'Team')!;
    const a = await provider.upload(team, 'n.txt', new Blob(['1']));
    const b = await provider.upload(team, 'n.txt', new Blob(['22']));
    expect([a.name, b.name]).toEqual(['n.txt', 'n 1.txt']);
    expect(a.key.startsWith('drive-erin/')).toBe(true);
    const listed = await provider.list(team);
    expect(listed.items.map((i) => i.name)).toEqual(['n 1.txt', 'n.txt']);
    expect(await (await provider.fetch(listed.items[0]!, { maxBytes: 10 })).text()).toBe('22');
  });

  it('pages a listing with nextLink', async () => {
    const { provider } = onedrive({ user: 'dave' });
    const folder = await provider.createFolder('Many');
    const parent = [...fake.items.values()].find((i) => i.id === folder.id)!;
    for (let i = 0; i < 55; i++) {
      fake.add('dave', `f${i}.txt`, { parent, content: 'x' });
    }
    const first = await provider.list(folder);
    expect(first.items).toHaveLength(50);
    const second = await provider.list(folder, first.cursor);
    expect(second.items).toHaveLength(5);
    await expect(provider.list(folder, 'https://evil.example/next')).rejects.toMatchObject({
      reason: 'failed',
    });
  });

  it('describes sharing', async () => {
    const { provider } = onedrive({ user: 'erin' });
    const team = (await provider.listFolders!(null)).find((f) => f.name === 'Team')!;
    expect(await provider.describeSharing(team)).toMatchObject({ kind: 'members', members: 1 });
    const mine = await provider.createFolder('Mine');
    expect((await provider.describeSharing(mine)).kind).toBe('private');
    const dave = onedrive({ user: 'dave' }).provider;
    expect((await dave.describeSharing(team)).kind).toBe('unknown');
  });

  it('refetches an expired download address', async () => {
    const { provider } = onedrive({ user: 'dave' });
    const folder = await provider.createFolder('Exp');
    const meta = await provider.upload(folder, 'e.txt', new Blob(['fresh']));
    fake.expireDownloads();
    expect(await (await provider.fetch(meta, { maxBytes: 10 })).text()).toBe('fresh');
  });

  it('deletes a paste', async () => {
    const { provider } = onedrive({ user: 'dave' });
    const folder = await provider.createFolder('Gone');
    const meta = await provider.upload(folder, 'x.txt', new Blob(['x']));
    await provider.remove(meta);
    expect((await provider.list(folder)).items).toEqual([]);
  });
});

describe('OneDrive links', () => {
  it('makes an anonymous link for a public paste, which any signed-in viewer opens', async () => {
    const owner = onedrive({ user: 'olga' }).provider;
    const folder = await owner.createFolder('Public');
    const meta = await owner.upload(folder, 'p.md', new Blob(['# p']));
    const ref = await owner.share(meta, 'public');
    expect(base64UrlToText(ref)).toMatch(/^u:http/);
    await expect(onedrive({ signedIn: false }).provider.openRef(ref)).rejects.toMatchObject({
      reason: 'needs_sign_in',
    });
    const viewer = onedrive({ user: 'zed' }).provider;
    const opened = await viewer.openRef(ref);
    expect(opened.name).toBe('p.md');
    expect(await (await viewer.fetch(opened, { maxBytes: 10 })).text()).toBe('# p');
  });

  it('links a members paste by id: members open it, others do not', async () => {
    const owner = onedrive({ user: 'erin' }).provider;
    const team = (await owner.listFolders!(null)).find((f) => f.name === 'Team')!;
    const meta = await owner.upload(team, 'm.txt', new Blob(['m']));
    const ref = await owner.share(meta, 'members');
    expect(base64UrlToText(ref)).toBe(`i:${meta.key}`);
    const member = onedrive({ user: 'dave' }).provider;
    expect(await (await member.fetch(await member.openRef(ref), { maxBytes: 10 })).text()).toBe(
      'm',
    );
    await expect(onedrive({ user: 'zed' }).provider.openRef(ref)).rejects.toMatchObject({
      reason: 'not_found',
    });
  });

  it('reports accounts that forbid anonymous links', async () => {
    fake.noAnonymousLinks.add('olga');
    const owner = onedrive({ user: 'olga' }).provider;
    const folder = await owner.createFolder('Corp');
    const meta = await owner.upload(folder, 'c.txt', new Blob(['c']));
    await expect(owner.share(meta, 'public')).rejects.toMatchObject({ reason: 'unsupported' });
    fake.noAnonymousLinks.delete('olga');
  });

  it('rejects damaged references', async () => {
    const { provider } = onedrive();
    await expect(provider.openRef('eHg')).rejects.toMatchObject({ reason: 'not_found' });
  });
});
