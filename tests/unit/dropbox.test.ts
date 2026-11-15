// MIT License © 2026 Binary Dice Games
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { base64UrlToText } from '../../web/src/b64';
import { ConflictError } from '../../web/src/errors';
import { createDropboxProvider, dropboxArg, rawLinkUrl } from '../../web/src/providers/dropbox';
import { FakeDropbox } from '../support/fake-dropbox';
import { testEnv } from '../support/provider-env';

let fake: FakeDropbox;
let base: string;

beforeAll(async () => {
  fake = new FakeDropbox();
  base = await fake.start();
});

afterAll(() => fake.close());

function dropbox(options: { user?: string; signedIn?: boolean; now?: () => number } = {}) {
  const user = options.user ?? 'alice';
  const env = testEnv(
    {
      dropbox: {
        appKey: fake.appKey,
        authUrl: `${base}/oauth2/authorize`,
        apiBase: base,
        contentBase: base,
        rawBase: base,
      },
    },
    options.now,
  );
  if (options.signedIn !== false) {
    env.tokens.save(
      'db',
      {
        accessToken: fake.issueToken(user),
        expiresAt: Date.now() + 3600e3,
        refreshToken: fake.issueRefreshToken(user),
        account: { id: `dbid:${user}`, name: user },
      },
      true,
    );
  }
  return { provider: createDropboxProvider(env), env };
}

describe('Dropbox helpers', () => {
  it('escapes non-ASCII in the API argument header', () => {
    expect(dropboxArg({ path: '/día/ü.txt' })).toBe('{"path":"/d\\u00eda/\\u00fc.txt"}');
  });

  it('turns a shared link into its raw download address', () => {
    expect(
      rawLinkUrl(
        'https://www.dropbox.com/scl/fi/abc/n%20a.txt?rlkey=k&dl=0',
        'https://dl.dropboxusercontent.com',
      ),
    ).toBe('https://dl.dropboxusercontent.com/scl/fi/abc/n%20a.txt?rlkey=k');
  });
});

describe('Dropbox sign-in', () => {
  it('signs in with PKCE and gets a refresh token', async () => {
    fake.nextUser = 'bob';
    const { provider, env } = dropbox({ signedIn: false });
    const account = await provider.signIn({ stay: true });
    expect(account).toEqual({ id: 'dbid:bob', name: 'Bob', email: 'bob@example.com' });
    expect(env.tokens.load('db')?.refreshToken).toMatch(/^dbr-bob-/);
  });

  it('renews an expired access token with the refresh token', async () => {
    const { provider, env } = dropbox({ user: 'bob' });
    const record = env.tokens.load('db')!;
    env.tokens.save('db', { ...record, accessToken: 'dead', expiresAt: 0 }, true);
    expect(await provider.readConfig()).toEqual({ text: null, rev: null });
    expect(env.tokens.load('db')!.accessToken).not.toBe('dead');
  });

  it('renews when the service says the token expired before its time', async () => {
    const { provider, env } = dropbox({ user: 'bob' });
    const record = env.tokens.load('db')!;
    env.tokens.save('db', { ...record, accessToken: 'revoked-early' }, true);
    await expect(provider.readConfig()).resolves.toBeDefined();
  });

  it('asks to sign in again when the refresh token is dead, keeping the account', async () => {
    const { provider, env } = dropbox({ user: 'bob' });
    env.tokens.save(
      'db',
      {
        accessToken: 'dead',
        expiresAt: 0,
        refreshToken: 'nope',
        account: { id: 'dbid:bob', name: 'bob' },
      },
      true,
    );
    await expect(provider.readConfig()).rejects.toMatchObject({ reason: 'needs_sign_in' });
    expect(provider.account()?.name).toBe('bob');
  });

  it('revokes on sign-out', async () => {
    const { provider, env } = dropbox({ user: 'bob' });
    const token = env.tokens.load('db')!.accessToken;
    await provider.signOut();
    expect(fake.tokens.has(token)).toBe(false);
    expect(provider.account()).toBeNull();
  });
});

describe('Dropbox configuration file', () => {
  it('creates, reads and updates /Apps/boh/boh-config.json by revision', async () => {
    const { provider } = dropbox({ user: 'carol' });
    const rev1 = await provider.writeConfig('{"v":1}', null);
    await expect(provider.writeConfig('{"v":0}', null)).rejects.toBeInstanceOf(ConflictError);
    expect(await provider.readConfig()).toEqual({ text: '{"v":1}', rev: rev1 });
    const rev2 = await provider.writeConfig('{"v":2}', rev1);
    await expect(provider.writeConfig('{"v":3}', rev1)).rejects.toBeInstanceOf(ConflictError);
    expect(await provider.readConfig()).toEqual({ text: '{"v":2}', rev: rev2 });
    expect(fake.at('carol', '/Apps/boh/boh-config.json')?.content.toString()).toBe('{"v":2}');
  });
});

describe('Dropbox bins and pastes', () => {
  it('browses and creates folders, including folders shared with the user', async () => {
    fake.add('dave', '/Work/Notes');
    fake.share('erin', '/Team', ['dave']);
    const { provider } = dropbox({ user: 'dave' });
    const top = await provider.listFolders!(null);
    expect(top.map((f) => f.name)).toEqual(['Team', 'Work']);
    const work = top.find((f) => f.name === 'Work')!;
    expect((await provider.listFolders!(work)).map((f) => f.path)).toEqual(['/Work/Notes']);
    const made = await provider.createFolder('Pastes', work);
    expect(made.path).toBe('/Work/Pastes');
    await expect(provider.createFolder('Pastes', work)).rejects.toMatchObject({ status: 409 });
  });

  it('uploads with a new name on a clash and lists newest first', async () => {
    const { provider } = dropbox({ user: 'dave' });
    const folder = await provider.createFolder('Bin');
    const a = await provider.upload(folder, 'note.txt', new Blob(['1']));
    const b = await provider.upload(folder, 'note.txt', new Blob(['22']));
    expect([a.name, b.name]).toEqual(['note.txt', 'note (1).txt']);
    const listed = await provider.list(folder);
    expect(listed.items.map((i) => i.name)).toEqual(['note (1).txt', 'note.txt']);
    expect(await (await provider.fetch(listed.items[0]!, { maxBytes: 10 })).text()).toBe('22');
  });

  it('has no tag storage: lists without tags and refuses tag writes', async () => {
    const { provider } = dropbox({ user: 'dave' });
    expect(provider.capabilities).toEqual({ tags: false, binLinks: false });
    const folder = await provider.createFolder('NoTags');
    await expect(
      provider.upload(folder, 'x.txt', new Blob(['x']), { tags: ['a'] }),
    ).rejects.toMatchObject({ reason: 'unsupported' });
    const meta = await provider.upload(folder, 'x.txt', new Blob(['x']), { tags: [] });
    expect(meta.tags).toBeUndefined();
    await expect(provider.setTags(meta, { add: ['a'] })).rejects.toMatchObject({
      reason: 'unsupported',
    });
  });

  it('pages a long listing', async () => {
    const { provider } = dropbox({ user: 'dave' });
    const folder = await provider.createFolder('Many');
    for (let i = 0; i < 105; i++) {
      fake.add('dave', `/Many/f${i}.txt`, `${i}`);
    }
    const first = await provider.list(folder);
    expect(first.items).toHaveLength(100);
    const second = await provider.list(folder, first.cursor);
    expect(second.items).toHaveLength(5);
    expect(second.cursor).toBeUndefined();
  });

  it('describes sharing: public link, shared folder with members, private', async () => {
    const owner = dropbox({ user: 'erin' }).provider;
    const team = fake.at('erin', '/Team')!;
    expect(await owner.describeSharing({ id: team.id, name: 'Team' })).toMatchObject({
      kind: 'members',
      members: 1,
    });
    const priv = await owner.createFolder('Mine');
    expect((await owner.describeSharing(priv)).kind).toBe('private');
    await owner.share({ provider: 'db', key: priv.id, name: 'Mine' }, 'public');
    expect(await owner.describeSharing(priv)).toMatchObject({
      kind: 'public',
      manageUrl: 'https://www.dropbox.com/home/Mine',
    });
  });

  it('deletes a paste', async () => {
    const { provider } = dropbox({ user: 'dave' });
    const folder = await provider.createFolder('Gone');
    const meta = await provider.upload(folder, 'x.txt', new Blob(['x']));
    await provider.remove(meta);
    expect((await provider.list(folder)).items).toEqual([]);
  });
});

describe('Dropbox links', () => {
  it('opens a public link without signing in', async () => {
    const owner = dropbox({ user: 'olga' }).provider;
    const folder = await owner.createFolder('Public');
    const meta = await owner.upload(folder, 'hi there.md', new Blob(['# hi']));
    const ref = await owner.share(meta, 'public');
    expect(await owner.share(meta, 'public')).toBe(ref); // the existing link is reused
    const { provider } = dropbox({ signedIn: false });
    const opened = await provider.openRef(ref);
    expect(opened).toMatchObject({ name: 'hi there.md', size: 4, access: 'anonymous' });
    expect(await (await provider.fetch(opened, { maxBytes: 100 })).text()).toBe('# hi');
  });

  it('opens a members-only link for members and refuses others', async () => {
    const owner = dropbox({ user: 'erin' }).provider;
    const team = fake.at('erin', '/Team')!;
    const meta = await owner.upload({ id: team.id, name: 'Team' }, 'plan.txt', new Blob(['plan']));
    const ref = await owner.share(meta, 'members');
    expect(base64UrlToText(ref)).toMatch(/\/scl\/fi\//);
    await expect(dropbox({ signedIn: false }).provider.openRef(ref)).rejects.toMatchObject({
      reason: 'needs_sign_in',
    });
    const member = dropbox({ user: 'dave' }).provider;
    const opened = await member.openRef(ref);
    expect(opened.access).toBe('token');
    expect(await (await member.fetch(opened, { maxBytes: 100 })).text()).toBe('plan');
    await expect(dropbox({ user: 'zed' }).provider.openRef(ref)).rejects.toMatchObject({
      reason: 'forbidden',
    });
  });

  it('falls back to the file id where members-only links are not allowed', async () => {
    fake.basicAccounts.add('erin');
    const owner = dropbox({ user: 'erin' }).provider;
    const team = fake.at('erin', '/Team')!;
    const meta = await owner.upload({ id: team.id, name: 'Team' }, 'basic.txt', new Blob(['b']));
    const ref = await owner.share(meta, 'members');
    expect(base64UrlToText(ref)).toBe(meta.key);
    const member = dropbox({ user: 'dave' }).provider;
    const opened = await member.openRef(ref);
    expect(await (await member.fetch(opened, { maxBytes: 10 })).text()).toBe('b');
    await expect(dropbox({ user: 'zed' }).provider.openRef(ref)).rejects.toMatchObject({
      reason: 'not_found',
    });
    fake.basicAccounts.delete('erin');
  });

  it('reports a deleted paste as not found', async () => {
    const owner = dropbox({ user: 'olga' }).provider;
    const folder = await owner.createFolder('Temp');
    const meta = await owner.upload(folder, 't.txt', new Blob(['t']));
    const ref = await owner.share(meta, 'members');
    await owner.remove(meta);
    await expect(owner.openRef(ref)).rejects.toMatchObject({ reason: 'not_found' });
  });
});
