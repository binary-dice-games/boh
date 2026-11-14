// MIT License © 2026 Binary Dice Games
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, pasteDocument, startHarness, type Harness } from '../support/app-harness';
import { FakeDrive } from '../support/fake-drive';

// The whole cycle with Google Drive: connect, add bins (picked and created), upload, link, open
// as a signed-out viewer and as a member who grants access, list, delete, disconnect.

let fake: FakeDrive;
let app: Harness;

beforeAll(async () => {
  fake = new FakeDrive();
  await fake.start();
  app = await startHarness({ drive: fake });
}, 120000);

afterAll(async () => {
  await app?.close();
  await fake?.close();
});

describe('boh with Google Drive', () => {
  let publicLink = '';
  let membersLink = '';
  let teamFolder = '';

  it('connects, adds a picked public folder as a bin, uploads and gives a link', async () => {
    const pub = fake.add({ name: 'Public pastes', owner: 'alice', folder: true, anyone: true });
    fake.nextUser = 'alice';
    const alice = await app.open();
    await expect(alice.page.locator('.new-paste .muted').first().textContent()).resolves.toContain(
      'Connect a cloud account',
    );
    await connect(alice, 'gd', 'Alice');

    await alice.page.click('#add-bin');
    alice.answers.prompt = pub;
    await alice.page.click('#pick-folder');
    await alice.page.locator('#bin-folder', { hasText: 'Public pastes' }).waitFor();
    await alice.page.locator('#bin-sharing', { hasText: 'Shared publicly' }).waitFor();
    expect(await alice.page.inputValue('#bin-visibility')).toBe('public');
    expect(await alice.page.inputValue('#bin-name')).toBe('Public pastes');
    await alice.page.click('#bin-save');
    await alice.page.locator('.bin .bin-name', { hasText: 'Public pastes' }).waitFor();

    await alice.page.fill('#paste-title', 'Greeting');
    await alice.page.selectOption('#paste-format', 'md');
    await alice.page.fill('#paste-text', '# Hello\n\nfrom **boh**');
    await alice.page.click('#paste-upload');
    await alice.page.locator('#paste-link').waitFor();
    publicLink = await alice.page.inputValue('#paste-link');
    expect(publicLink).toMatch(/\/boh\/#v1\/gd\/[A-Za-z0-9_-]+\?n=greeting\.md$/);
    expect(
      [...fake.files.values()].some((f) => f.name === 'greeting.md' && f.parents[0] === pub),
    ).toBe(true);
    await alice.page.locator('.recent-list a', { hasText: 'greeting.md' }).waitFor();
    expect(alice.errors).toEqual([]);
  });

  it('opens the public paste for someone who is not signed in', async () => {
    const viewer = await app.open();
    await viewer.page.goto(publicLink);
    await viewer.page.locator('#viewer-name', { hasText: 'greeting.md' }).waitFor();
    await pasteDocument(viewer.page).locator('h1', { hasText: 'Hello' }).waitFor();
    expect(await pasteDocument(viewer.page).locator('strong').textContent()).toBe('boh');
    await viewer.page.selectOption('#viewer-renderer', 'text');
    await pasteDocument(viewer.page).locator('pre.code', { hasText: '# Hello' }).waitFor();
    expect(viewer.errors).toEqual([]);
  });

  it('creates a members bin and uploads a file to it', async () => {
    fake.nextUser = 'alice';
    const alice = await app.open();
    await connect(alice, 'gd', 'Alice');
    await alice.page.locator('.bin .bin-name', { hasText: 'Public pastes' }).waitFor(); // the config followed
    await alice.page.click('#add-bin');
    await alice.page.fill('#new-folder-name', 'Team pastes');
    await alice.page.click('#create-folder');
    await alice.page.locator('#bin-sharing', { hasText: 'Not shared' }).waitFor();
    await alice.page.selectOption('#bin-visibility', 'members');
    await alice.page.locator('.warning', { hasText: 'Nobody else has access' }).waitFor();
    await alice.page.click('#bin-save');
    await alice.page.locator('.bin .bin-name', { hasText: 'Team pastes' }).waitFor();
    teamFolder = [...fake.files.values()].find((f) => f.name === 'Team pastes')!.id;
    fake.files.get(teamFolder)!.members.add('bob');

    await alice.page.selectOption('#paste-bin', { label: 'Team pastes (Google Drive, members)' });
    await alice.page.setInputFiles('#paste-file', {
      name: 'plan.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('line one\nline two\n'),
    });
    await alice.page.locator('.file-chip', { hasText: 'plan.txt' }).waitFor();
    await alice.page.click('#paste-upload');
    await alice.page.locator('#paste-link').waitFor();
    membersLink = await alice.page.inputValue('#paste-link');
    expect(alice.errors).toEqual([]);
  });

  it('lets a member sign in and grant access, and keeps others out', async () => {
    const bob = await app.open();
    await bob.page.goto(membersLink);
    await bob.page.locator('#viewer-message', { hasText: 'Sign in to open it' }).waitFor();
    fake.nextUser = 'bob';
    await bob.page.click('#viewer-sign-in');
    await bob.page
      .locator('#viewer-message', { hasText: 'confirm that boh may open this file' })
      .waitFor();
    await bob.page.click('#viewer-grant');
    await bob.page.locator('#viewer-name', { hasText: 'plan.txt' }).waitFor();
    await pasteDocument(bob.page).locator('pre.gutter', { hasText: '2' }).waitFor();
    expect(await pasteDocument(bob.page).locator('pre.code').textContent()).toBe(
      'line one\nline two\n',
    );

    const eve = await app.open();
    fake.nextUser = 'eve';
    await eve.page.goto(membersLink);
    await eve.page.click('#viewer-sign-in');
    await eve.page.click('#viewer-grant');
    await eve.page.locator('#viewer-message', { hasText: 'cannot open it' }).waitFor();
  });

  it('lists a bin and deletes a paste; disconnecting hides the bins', async () => {
    fake.nextUser = 'alice';
    const alice = await app.open();
    await connect(alice, 'gd', 'Alice');
    await alice.page.click('.bin-name >> text=Team pastes');
    await alice.page.locator('tr[data-paste="plan.txt"]').waitFor();
    await alice.page.click('tr[data-paste="plan.txt"] >> text=Delete');
    await alice.page.locator('tr[data-paste="plan.txt"]').waitFor({ state: 'detached' });
    expect([...fake.files.values()].find((f) => f.name === 'plan.txt')?.trashed).toBe(true);

    await alice.page.click('.logo');
    await alice.page.click('.account[data-provider="gd"] >> text=Disconnect');
    await alice.page.locator('button.connect[data-provider="gd"]').waitFor();
    expect(await alice.page.locator('.bin').count()).toBe(0);
    expect(alice.errors).toEqual([]);
  });

  it('opens the bin view from a fresh tab once the bins are loaded', async () => {
    fake.nextUser = 'alice';
    const alice = await app.open();
    await connect(alice, 'gd', 'Alice');
    const id = await alice.page.locator('.bin').first().getAttribute('data-bin');
    const tab = await alice.context.newPage();
    await tab.goto(`${app.url}#bin/${id}`);
    await tab.locator('h2', { hasText: 'Public pastes' }).waitFor();
    await tab.locator('tr[data-paste="greeting.md"]').waitFor();
  });
});
