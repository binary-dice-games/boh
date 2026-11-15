// MIT License © 2026 Binary Dice Games
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { textToBase64Url } from '../../web/src/b64';
import {
  AuthError,
  ConflictError,
  LinkError,
  ProviderError,
  TooLargeError,
} from '../../web/src/errors';
import { createDriveProvider } from '../../web/src/providers/google-drive';
import type { GooglePicker } from '../../web/src/providers/google-picker';
import type { Provider } from '../../web/src/providers/provider';
import { FakeDrive } from '../support/fake-drive';
import { testEnv } from '../support/provider-env';

let fake: FakeDrive;
let base: string;

beforeAll(async () => {
  fake = new FakeDrive();
  base = await fake.start();
});

afterAll(() => fake.close());

/** A picker that grants whatever it is asked for (or a chosen folder). */
function picker(user: () => string, folder?: () => string): GooglePicker {
  return {
    async pick(request) {
      const id = request.kind === 'folder' ? (request.folderId ?? folder?.()) : request.fileId;
      if (!id) {
        return null;
      }
      fake.grant(user(), id);
      return { id, name: fake.files.get(id)?.name ?? '' };
    },
  };
}

function drive(options: { user?: string; signedIn?: boolean; folder?: () => string } = {}) {
  const user = options.user ?? 'alice';
  const env = testEnv({
    google: {
      clientId: 'cid',
      apiKey: fake.apiKey,
      authUrl: `${base}/o/oauth2/v2/auth`,
      apiBase: base,
      revokeUrl: `${base}/revoke`,
    },
  });
  if (options.signedIn !== false) {
    env.tokens.save(
      'gd',
      {
        accessToken: fake.issueToken(user),
        expiresAt: Date.now() + 3600e3,
        account: { id: `perm-${user}`, name: user },
      },
      true,
    );
  }
  return {
    provider: createDriveProvider(
      env,
      picker(() => user, options.folder),
    ),
    env,
  };
}

describe('Google Drive sign-in', () => {
  beforeEach(() => {
    fake.nextUser = 'alice';
  });

  it('signs in through the popup and stores the account where asked', async () => {
    const { provider, env } = drive({ signedIn: false });
    expect(provider.account()).toBeNull();
    const account = await provider.signIn({ stay: false });
    expect(account).toEqual({ id: 'perm-alice', name: 'Alice', email: 'alice@example.com' });
    expect(provider.account()?.name).toBe('Alice');
    expect(env.session.getItem('boh.auth.gd')).not.toBeNull();
    expect(env.local.getItem('boh.auth.gd')).toBeNull();
    provider.setStay(true);
    expect(env.local.getItem('boh.auth.gd')).not.toBeNull();
    expect(env.session.getItem('boh.auth.gd')).toBeNull();
  });

  it('reports a refused sign-in as cancelled', async () => {
    const { provider } = drive({ signedIn: false });
    fake.denyNext = true;
    await expect(provider.signIn({ stay: true })).rejects.toMatchObject({ reason: 'cancelled' });
    expect(provider.account()).toBeNull();
  });

  it('refuses without a client id', async () => {
    const env = testEnv({ google: { clientId: '', apiBase: base } });
    const provider = createDriveProvider(env);
    expect(provider.configured).toBe(false);
    await expect(provider.signIn({ stay: true })).rejects.toMatchObject({
      reason: 'not_configured',
    });
  });

  it('signs out, revoking the token', async () => {
    const { provider, env } = drive();
    const token = env.tokens.load('gd')!.accessToken;
    await provider.signOut();
    expect(provider.account()).toBeNull();
    expect(fake.tokens.has(token)).toBe(false);
  });

  it('turns a dead token into needs_sign_in', async () => {
    const { provider, env } = drive();
    fake.tokens.clear();
    await expect(provider.readConfig()).rejects.toMatchObject({ reason: 'needs_sign_in' });
    expect(env.tokens.load('gd')?.account?.name).toBe('alice');
  });
});

describe('Google Drive configuration file', () => {
  it('creates, reads and updates it in the app data folder, detecting conflicts', async () => {
    const { provider } = drive({ user: 'carol' });
    expect(await provider.readConfig()).toEqual({ text: null, rev: null });
    const rev1 = await provider.writeConfig('{"a":1}', null);
    await expect(provider.writeConfig('{"a":2}', null)).rejects.toBeInstanceOf(ConflictError);
    expect(await provider.readConfig()).toEqual({ text: '{"a":1}', rev: rev1 });
    const rev2 = await provider.writeConfig('{"a":3}', rev1);
    expect(rev2).not.toBe(rev1);
    await expect(provider.writeConfig('{"a":4}', rev1)).rejects.toBeInstanceOf(ConflictError);
    expect((await provider.readConfig()).text).toBe('{"a":3}');
    expect(fake.configOf('carol')?.appData).toBe(true);
  });
});

describe('Google Drive bins and pastes', () => {
  it('creates a folder, uploads, lists newest first and pages', async () => {
    const { provider } = drive({ user: 'dave' });
    const folder = await provider.createFolder('pastes');
    expect(folder.name).toBe('pastes');
    for (const name of ['a.txt', 'b.txt', 'c.txt']) {
      await provider.upload(folder, name, new Blob([name]));
    }
    const all = await provider.list(folder);
    expect(all.items.map((i) => i.name)).toEqual(['c.txt', 'b.txt', 'a.txt']);
    expect(all.items[0]).toMatchObject({ provider: 'gd', size: 5, access: 'token' });
  });

  it('uploads more than 5 MiB with a resumable upload', async () => {
    const { provider } = drive({ user: 'dave' });
    const folder = await provider.createFolder('big');
    const big = new Uint8Array(6 * 1024 * 1024).fill(65);
    const meta = await provider.upload(folder, 'big.bin', new Blob([big]));
    expect(meta.size).toBe(big.length);
    expect(fake.server.log.some((l) => l.path.startsWith('/upload/session/'))).toBe(true);
  });

  it('picks a folder through the picker', async () => {
    const shared = fake.add({ name: 'team', owner: 'erin', folder: true, members: ['frank'] });
    const { provider } = drive({ user: 'frank', folder: () => shared });
    expect(await provider.pickFolder!()).toEqual({ id: shared, name: 'team' });
    await provider.upload({ id: shared, name: 'team' }, 'note.txt', new Blob(['hi']));
    expect((await provider.list({ id: shared, name: 'team' })).items.map((i) => i.name)).toEqual([
      'note.txt',
    ]);
  });

  it('describes sharing from the folder permissions', async () => {
    const { provider } = drive({ user: 'gina' });
    const priv = await provider.createFolder('private');
    expect((await provider.describeSharing(priv)).kind).toBe('private');
    fake.files.get(priv.id)!.members.add('hank');
    expect(await provider.describeSharing(priv)).toMatchObject({ kind: 'members', members: 1 });
    fake.files.get(priv.id)!.anyone = true;
    expect(await provider.describeSharing(priv)).toMatchObject({
      kind: 'public',
      manageUrl: `https://drive.google.com/drive/folders/${priv.id}`,
    });
    const theirs = fake.add({ name: 'theirs', owner: 'hank', folder: true, members: ['gina'] });
    fake.grant('gina', theirs);
    expect((await provider.describeSharing({ id: theirs, name: 'theirs' })).kind).toBe('unknown');
  });

  it('moves a deleted paste to the trash', async () => {
    const { provider } = drive({ user: 'ivan' });
    const folder = await provider.createFolder('f');
    const meta = await provider.upload(folder, 'x.txt', new Blob(['x']));
    await provider.remove(meta);
    expect(fake.files.get(meta.key)?.trashed).toBe(true);
    expect((await provider.list(folder)).items).toEqual([]);
  });
});

describe('Google Drive links', () => {
  let owner: Provider;
  let publicFolder: string;
  let teamFolder: string;

  beforeAll(async () => {
    owner = drive({ user: 'olga' }).provider;
    publicFolder = (await owner.createFolder('public')).id;
    fake.files.get(publicFolder)!.anyone = true;
    teamFolder = (await owner.createFolder('team')).id;
    fake.files.get(teamFolder)!.members.add('paul');
  });

  it('opens a public paste without signing in', async () => {
    const meta = await owner.upload(
      { id: publicFolder, name: 'public' },
      'hello.md',
      new Blob(['# hi']),
    );
    const ref = await owner.share(meta, 'public');
    const { provider } = drive({ signedIn: false });
    const opened = await provider.openRef(ref);
    expect(opened).toMatchObject({ name: 'hello.md', access: 'anonymous', size: 4 });
    expect(await (await provider.fetch(opened, { maxBytes: 100 })).text()).toBe('# hi');
  });

  it('asks a signed-out viewer to sign in, and a member to grant access, then opens', async () => {
    const meta = await owner.upload(
      { id: teamFolder, name: 'team' },
      'secret.txt',
      new Blob(['s3cret']),
    );
    const ref = await owner.share(meta, 'members');
    await expect(drive({ signedIn: false }).provider.openRef(ref)).rejects.toMatchObject({
      reason: 'needs_sign_in',
    });
    const { provider } = drive({ user: 'paul' });
    await expect(provider.openRef(ref)).rejects.toMatchObject({ reason: 'needs_grant' });
    expect(await provider.grantAccess!(ref)).toBe(true);
    const opened = await provider.openRef(ref);
    expect(opened.access).toBe('token');
    expect(await (await provider.fetch(opened, { maxBytes: 100 })).text()).toBe('s3cret');
  });

  it('keeps a stranger out even after the picker', async () => {
    const meta = await owner.upload({ id: teamFolder, name: 'team' }, 'other.txt', new Blob(['x']));
    const ref = await owner.share(meta, 'members');
    const { provider } = drive({ user: 'quinn' });
    await expect(provider.grantAccess!(ref)).resolves.toBe(true); // the fake picker cannot refuse
    await expect(provider.openRef(ref)).rejects.toMatchObject({ reason: 'needs_grant' });
  });

  it('rejects damaged references and limits downloads', async () => {
    const { provider } = drive();
    await expect(provider.openRef('!!')).rejects.toMatchObject({ reason: 'not_found' });
    await expect(provider.openRef(textToBase64Url('../etc'))).rejects.toBeInstanceOf(ProviderError);
    const meta = await owner.upload(
      { id: publicFolder, name: 'public' },
      'big.txt',
      new Blob(['0123456789']),
    );
    const opened = await provider.openRef(await owner.share(meta, 'public'));
    await expect(provider.fetch(opened, { maxBytes: 5 })).rejects.toBeInstanceOf(TooLargeError);
    await expect(
      provider.fetch({ ...opened, size: undefined }, { maxBytes: 5 }),
    ).rejects.toBeInstanceOf(TooLargeError);
  });

  it('retries a rate-limited call', async () => {
    const { provider } = drive({ user: 'olga' });
    fake.server.failNext(429, 1, /\/drive\/v3\/files$/, { 'retry-after': '0.01' });
    await expect(provider.list({ id: publicFolder, name: 'public' })).resolves.toBeDefined();
    fake.server.failNext(429, 3, /\/drive\/v3\/files$/, { 'retry-after': '0.01' });
    await expect(provider.list({ id: publicFolder, name: 'public' })).rejects.toMatchObject({
      reason: 'rate_limited',
    });
  });

  it('reports a missing sign-in on writes', async () => {
    const { provider } = drive({ signedIn: false });
    await expect(provider.createFolder('x')).rejects.toMatchObject({ reason: 'needs_sign_in' });
    expect(new AuthError('cancelled')).toBeInstanceOf(Error);
  });
});

describe('Google Drive tags', () => {
  it('uploads with tags, lists them, and sets them together with the file', async () => {
    const { provider } = drive({ user: 'tara' });
    const folder = await provider.createFolder('tagged');
    const meta = await provider.upload(folder, 'a.md', new Blob(['# a']), {
      tags: ['Work', 'canción', 'work'],
    });
    expect(meta).toMatchObject({ tags: ['canción', 'work'], canEdit: true, ownedByMe: true });
    expect(fake.tagsOf(meta.key)).toEqual(['canción', 'work']);
    const listed = (await provider.list(folder)).items[0]!;
    expect(listed.tags).toEqual(['canción', 'work']);
    const big = new Uint8Array(6 * 1024 * 1024);
    const resumable = await provider.upload(folder, 'big.bin', new Blob([big]), { tags: ['big'] });
    expect(fake.tagsOf(resumable.key)).toEqual(['big']);
  });

  it('refuses invalid tags and more than 25 before uploading', async () => {
    const { provider } = drive({ user: 'tara' });
    const folder = await provider.createFolder('refused');
    await expect(
      provider.upload(folder, 'x.txt', new Blob(['x']), { tags: ['a:b'] }),
    ).rejects.toMatchObject({ reason: 'invalid_tag' });
    const many = Array.from({ length: 26 }, (_, i) => `t${i}`);
    await expect(
      provider.upload(folder, 'x.txt', new Blob(['x']), { tags: many }),
    ).rejects.toMatchObject({ reason: 'too_many_tags' });
    expect((await provider.list(folder)).items).toEqual([]);
  });

  it('adds and removes only the tags given, leaving other properties alone', async () => {
    const { provider } = drive({ user: 'tara' });
    const folder = await provider.createFolder('edits');
    const meta = await provider.upload(folder, 'a.txt', new Blob(['a']), { tags: ['one'] });
    fake.files.get(meta.key)!.appProperties.set('other', 'kept');
    const after = await provider.setTags(meta, { add: ['two', 'Three'], remove: ['one'] });
    expect(after.tags).toEqual(['three', 'two']);
    expect(fake.files.get(meta.key)!.appProperties.get('other')).toBe('kept');
    const same = await provider.setTags(after, { add: ['two'] });
    expect(same.tags).toEqual(['three', 'two']);
  });

  it('merges edits made from two places at once', async () => {
    const { provider: a } = drive({ user: 'tara' });
    const { provider: b } = drive({ user: 'tara' });
    const folder = await a.createFolder('merge');
    const meta = await a.upload(folder, 'a.txt', new Blob(['a']));
    await Promise.all([a.setTags(meta, { add: ['from-a'] }), b.setTags(meta, { add: ['from-b'] })]);
    expect(fake.tagsOf(meta.key)).toEqual(['from-a', 'from-b']);
  });

  it('checks the limit against the file’s current tags', async () => {
    const { provider } = drive({ user: 'tara' });
    const folder = await provider.createFolder('limit');
    const tags = Array.from({ length: 25 }, (_, i) => `t${i}`);
    const meta = await provider.upload(folder, 'a.txt', new Blob(['a']), { tags: tags.slice(1) });
    await provider.setTags(meta, { add: ['t0'] }); // 25, behind the stale `meta`'s back
    await expect(provider.setTags(meta, { add: ['extra'] })).rejects.toMatchObject({
      reason: 'too_many_tags',
    });
  });

  it('drops stored keys that are not valid tags', async () => {
    const id = fake.add({
      name: 'odd.txt',
      owner: 'tara',
      createdByApp: true,
      appProperties: { 't.QUJD': '1', 't.!!': '1', 't.d29yaw': '1' },
    });
    const { provider } = drive({ user: 'tara' });
    const opened = await provider.openRef(textToBase64Url(id));
    expect(opened.tags).toEqual(['work']); // "ABC" is not lower case; "!!" is not base64
  });

  it('lets writers edit tags of a shared paste and refuses readers', async () => {
    const team = fake.add({
      name: 'team-tags',
      owner: 'uma',
      folder: true,
      members: ['vic'],
      readers: ['wes'],
    });
    const { provider: owner } = drive({ user: 'uma' });
    fake.grant('uma', team);
    const meta = await owner.upload({ id: team, name: 'team-tags' }, 'p.txt', new Blob(['p']), {
      tags: ['draft'],
    });
    for (const user of ['vic', 'wes']) {
      fake.grant(user, team);
    }
    const { provider: vic } = drive({ user: 'vic' });
    const seen = (await vic.list({ id: team, name: 'team-tags' })).items[0]!;
    expect(seen).toMatchObject({ tags: ['draft'], canEdit: true, ownedByMe: false });
    expect((await vic.setTags(seen, { add: ['reviewed'] })).tags).toEqual(['draft', 'reviewed']);

    const { provider: wes } = drive({ user: 'wes' });
    const read = (await wes.list({ id: team, name: 'team-tags' })).items[0]!;
    expect(read).toMatchObject({ tags: ['draft', 'reviewed'], canEdit: false });
    await expect(wes.setTags(read, { add: ['nope'] })).rejects.toMatchObject({
      reason: 'forbidden',
    });
    expect(fake.tagsOf(meta.key)).toEqual(['draft', 'reviewed']);
  });

  it('marks anonymously opened pastes as not editable', async () => {
    const { provider: owner } = drive({ user: 'uma' });
    const folder = await owner.createFolder('open');
    fake.files.get(folder.id)!.anyone = true;
    const meta = await owner.upload(folder, 'o.txt', new Blob(['o']), { tags: ['pub'] });
    const opened = await drive({ signedIn: false }).provider.openRef(
      await owner.share(meta, 'public'),
    );
    expect(opened).toMatchObject({ access: 'anonymous', canEdit: false, ownedByMe: false });
  });
});

describe('Google Drive shared folders and bin links', () => {
  it('describes a folder: owner, ownership and the right to add', async () => {
    const theirs = fake.add({
      name: 'theirs',
      owner: 'xena',
      folder: true,
      members: ['yuri'],
      readers: ['zoe'],
    });
    const { provider: yuri } = drive({ user: 'yuri', folder: () => theirs });
    await expect(yuri.describeFolder!({ id: theirs, name: '' })).rejects.toMatchObject({
      reason: 'needs_grant',
    });
    expect(await yuri.pickFolder!({ shared: true })).toEqual({ id: theirs, name: 'theirs' });
    expect(await yuri.describeFolder!({ id: theirs, name: '' })).toEqual({
      name: 'theirs',
      owner: { name: 'Xena', email: 'xena@example.com' },
      ownedByMe: false,
      canAdd: true,
    });
    const { provider: zoe } = drive({ user: 'zoe' });
    expect(await zoe.pickFolder!({ folderId: theirs })).toEqual({ id: theirs, name: 'theirs' });
    expect(await zoe.describeFolder!({ id: theirs, name: '' })).toMatchObject({ canAdd: false });
    const { provider: xena } = drive({ user: 'xena' });
    fake.grant('xena', theirs);
    expect(await xena.describeFolder!({ id: theirs, name: '' })).toMatchObject({ ownedByMe: true });
  });

  it('encodes and decodes folder references', () => {
    const { provider } = drive();
    const ref = provider.refOfFolder!({ id: 'abc_DEF-1', name: 'x' });
    expect(provider.folderRef!(ref)).toEqual({ id: 'abc_DEF-1', name: '' });
    expect(() => provider.folderRef!('!!')).toThrow(LinkError);
    expect(() => provider.folderRef!(textToBase64Url('../x'))).toThrow(LinkError);
    expect(provider.capabilities).toEqual({ tags: true, binLinks: true });
  });
});
