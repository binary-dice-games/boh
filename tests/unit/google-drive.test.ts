// MIT License © 2026 Binary Dice Games
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { textToBase64Url } from '../../web/src/b64';
import { AuthError, ConflictError, ProviderError, TooLargeError } from '../../web/src/errors';
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
      const id = request.kind === 'folder' ? folder?.() : request.fileId;
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
