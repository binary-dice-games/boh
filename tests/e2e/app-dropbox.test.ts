// MIT License © 2026 Binary Dice Games
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, pasteDocument, startHarness, type Harness } from '../support/app-harness';
import { FakeDropbox } from '../support/fake-dropbox';

// Dropbox in Chrome: PKCE sign-in, the folder browser, a public link opened without signing in,
// a members link opened by a member of the shared folder.

let fake: FakeDropbox;
let app: Harness;

beforeAll(async () => {
  fake = new FakeDropbox();
  await fake.start();
  fake.add('alice', '/Projects/Snippets');
  fake.share('alice', '/Team', ['bob']);
  app = await startHarness({ dropbox: fake });
}, 120000);

afterAll(async () => {
  await app?.close();
  await fake?.close();
});

describe('boh with Dropbox', () => {
  let publicLink = '';
  let membersLink = '';

  it('adds bins through the folder browser and uploads to them', async () => {
    fake.nextUser = 'alice';
    const alice = await app.open();
    expect(await alice.page.locator('button.connect').count()).toBe(1); // only Dropbox is configured
    await connect(alice, 'db', 'Alice');

    await alice.page.click('#add-bin');
    await alice.page.click('button[data-folder="Projects"]');
    await alice.page.click('button[data-folder="Snippets"]');
    await alice.page.click('#use-folder');
    await alice.page.locator('#bin-folder', { hasText: '/Projects/Snippets' }).waitFor();
    await alice.page.locator('#bin-sharing', { hasText: 'Not shared' }).waitFor();
    await alice.page.selectOption('#bin-visibility', 'public');
    await alice.page.locator('.warning', { hasText: 'not shared publicly' }).waitFor();
    await alice.page.click('#bin-save');
    await alice.page.locator('.bin .bin-name', { hasText: 'Snippets' }).waitFor();

    await alice.page.fill('#paste-text', 'echo hello');
    await alice.page.selectOption('#paste-format', 'sh');
    await alice.page.fill('#paste-title', 'Hello script');
    await alice.page.click('#paste-upload');
    await alice.page.locator('#paste-link').waitFor();
    publicLink = await alice.page.inputValue('#paste-link');
    expect(fake.at('alice', '/Projects/Snippets/hello-script.sh')?.content.toString()).toBe(
      'echo hello',
    );

    await alice.page.click('#add-bin');
    await alice.page.click('button[data-folder="Team"]');
    await alice.page.click('#use-folder');
    await alice.page
      .locator('#bin-sharing', { hasText: 'Shared with 1 person or group' })
      .waitFor();
    expect(await alice.page.inputValue('#bin-visibility')).toBe('members');
    await alice.page.click('#bin-save');
    await alice.page.locator('.bin .bin-name', { hasText: 'Team' }).waitFor();
    await alice.page.selectOption('#paste-bin', { label: 'Team (Dropbox, members)' });
    await alice.page.fill('#paste-text', '- [ ] ship it');
    await alice.page.selectOption('#paste-format', 'md');
    await alice.page.click('#paste-upload');
    await alice.page.locator('#paste-result', { hasText: 'Uploaded' }).waitFor();
    membersLink = await alice.page.inputValue('#paste-link');
    expect(fake.at('alice', '/Apps/boh/boh-config.json')?.content.toString()).toContain(
      '"Snippets"',
    );
    expect(alice.errors).toEqual([]);
  });

  it('opens the public link without signing in', async () => {
    const viewer = await app.open();
    await viewer.page.goto(publicLink);
    await viewer.page.locator('#viewer-name', { hasText: 'hello-script.sh' }).waitFor();
    await pasteDocument(viewer.page).locator('.hljs-built_in', { hasText: 'echo' }).waitFor();
    expect(viewer.errors).toEqual([]);
  });

  it('opens the members link for a member after sign-in', async () => {
    const bob = await app.open();
    await bob.page.goto(membersLink);
    await bob.page.locator('#viewer-message', { hasText: 'Sign in to open it' }).waitFor();
    fake.nextUser = 'bob';
    await bob.page.click('#viewer-sign-in');
    await pasteDocument(bob.page).locator('input[type="checkbox"]').waitFor();
    await bob.page.locator('.account[data-provider="db"] .who', { hasText: 'Bob' }).waitFor();
  });

  it('keeps the bins after a reload and lists and deletes in a bin', async () => {
    fake.nextUser = 'alice';
    const alice = await app.open();
    await connect(alice, 'db', 'Alice');
    await alice.page.reload();
    await alice.page.locator('.bin .bin-name', { hasText: 'Snippets' }).waitFor();
    await alice.page.click('.bin-name >> text=Snippets');
    await alice.page.locator('tr[data-paste="hello-script.sh"]').waitFor();
    await alice.page.click('tr[data-paste="hello-script.sh"] >> text=Delete');
    await alice.page.locator('text=No pastes in this bin yet.').waitFor();
    expect(fake.at('alice', '/Projects/Snippets/hello-script.sh')).toBeUndefined();
    const viewer = await app.open();
    await viewer.page.goto(publicLink);
    await viewer.page.locator('#viewer-message', { hasText: 'Sign in to open it' }).waitFor();
  });
});
