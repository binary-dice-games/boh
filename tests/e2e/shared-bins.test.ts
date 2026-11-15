// MIT License © 2026 Binary Dice Games
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, startHarness, type Harness } from '../support/app-harness';
import { FakeDrive } from '../support/fake-drive';

// Shared bins with Google Drive: the owner sends a bin link; a writer opens it, adds the bin and
// edits tags; a reader sees the tags but cannot change them; a stranger is kept out; the owner
// sees the writer's tags after a refresh, and their own link opens their bin.

let fake: FakeDrive;
let app: Harness;
let team = '';
let binLink = '';

beforeAll(async () => {
  fake = new FakeDrive();
  await fake.start();
  app = await startHarness({ drive: fake });
  team = fake.add({
    name: 'Team',
    owner: 'alice',
    folder: true,
    members: ['bob'],
    readers: ['carol'],
  });
}, 120000);

afterAll(async () => {
  await app?.close();
  await fake?.close();
});

describe('shared bins', () => {
  it('lets the owner tag a paste and copy the bin link', async () => {
    fake.nextUser = 'alice';
    const alice = await app.open();
    await connect(alice, 'gd', 'Alice');
    await alice.page.click('#add-bin');
    alice.answers.prompt = team;
    await alice.page.click('#pick-folder');
    await alice.page.locator('#bin-folder', { hasText: 'Team' }).waitFor();
    expect(await alice.page.isChecked('#bin-shared')).toBe(false);
    await alice.page.click('#bin-save');
    await alice.page.locator('.bin .bin-name', { hasText: 'Team' }).waitFor();

    await alice.page.fill('#paste-title', 'plan');
    await alice.page.selectOption('#paste-format', 'md');
    await alice.page.fill('#paste-text', '# Plan');
    await alice.page.fill('#paste-tags', 'draft');
    await alice.page.press('#paste-tags', 'Enter');
    await alice.page.click('#paste-upload');
    await alice.page.locator('#paste-link').waitFor();

    await alice.page.click('.bin-name >> text=Team');
    await alice.page.locator('tr[data-paste="plan.md"] .tag', { hasText: 'draft' }).waitFor();
    binLink = (await alice.page.getAttribute('#copy-bin-link', 'data-link')) ?? '';
    expect(binLink).toMatch(/\/boh\/#v1\/bin\/gd\/[A-Za-z0-9_-]+\?n=Team$/);
    expect(alice.errors).toEqual([]);
  });

  it('lets a writer open the link, add the bin and edit tags', async () => {
    const bob = await app.open();
    await bob.page.goto(binLink);
    await bob.page.locator('#binlink-message', { hasText: 'Sign in to open it' }).waitFor();
    fake.nextUser = 'bob';
    await bob.page.click('#binlink-sign-in');
    await bob.page.click('#binlink-grant');
    await bob.page.locator('#binlink-title', { hasText: 'Team' }).waitFor();
    await bob.page.locator('#binlink-owner', { hasText: 'by Alice' }).waitFor();
    await bob.page.locator('#binlink-owner', { hasText: 'You can add pastes' }).waitFor();
    await bob.page.locator('tr[data-paste="plan.md"] .tag', { hasText: 'draft' }).waitFor();
    await bob.page.click('#binlink-add');
    await bob.page.waitForURL(/#library\?q=bin%3ATeam$/);
    await bob.page.locator('tr[data-paste="plan.md"]').waitFor();
    await bob.page.click('#scope-shared');
    await bob.page.locator('tr[data-paste="plan.md"]').waitFor();
    const bins = JSON.parse(fake.configOf('bob')!.content.toString()).bins;
    expect(bins[0]).toMatchObject({
      name: 'Team',
      shared: true,
      owner: { name: 'Alice' },
      visibility: 'members',
    });

    await bob.page.click('tr[data-paste="plan.md"] >> text=plan.md');
    await bob.page.locator('#viewer-name', { hasText: 'plan.md' }).waitFor();
    await bob.page.fill('#viewer-tag-input', 'reviewed');
    await bob.page.press('#viewer-tag-input', 'Enter');
    const plan = [...fake.files.values()].find((f) => f.name === 'plan.md')!.id;
    await expect.poll(() => fake.tagsOf(plan)).toEqual(['draft', 'reviewed']);
    expect(bob.errors).toEqual([]);
  });

  it('shows a reader the tags but no way to change them', async () => {
    const carol = await app.open();
    fake.nextUser = 'carol';
    await connect(carol, 'gd', 'Carol');
    await carol.page.goto(binLink);
    await carol.page.click('#binlink-grant');
    await carol.page.locator('#binlink-owner', { hasText: 'you cannot add pastes' }).waitFor();
    await carol.page.click('#binlink-add');
    await carol.page.locator('tr[data-paste="plan.md"]').waitFor();
    await carol.page.click('tr[data-paste="plan.md"] >> text=plan.md');
    await carol.page.locator('#viewer-tags .chip', { hasText: 'reviewed' }).waitFor();
    expect(await carol.page.isVisible('#viewer-tag-input')).toBe(false);
    expect(await carol.page.locator('#viewer-tags .chip-remove').count()).toBe(0);
    expect(carol.errors).toEqual([]);
  });

  it('keeps someone the folder is not shared with out', async () => {
    const eve = await app.open();
    fake.nextUser = 'eve';
    await connect(eve, 'gd', 'Eve');
    await eve.page.goto(binLink);
    await eve.page.click('#binlink-grant');
    await eve.page.locator('#binlink-message', { hasText: 'cannot open it' }).waitFor();
    expect(fake.configOf('eve')).toBeUndefined();
  });

  it('shows the owner the writer’s tags after a refresh, and opens their own bin link', async () => {
    fake.nextUser = 'alice';
    const alice = await app.open();
    await connect(alice, 'gd', 'Alice');
    await alice.page.click('#nav-library');
    await alice.page.locator('[data-facet-tag="draft"]').waitFor();
    await alice.page.click('#library-refresh');
    await alice.page.locator('tr[data-paste="plan.md"] .tag', { hasText: 'reviewed' }).waitFor();
    await alice.page.goto(binLink);
    await alice.page.waitForURL(/#bin\//);
    await alice.page.locator('h2', { hasText: 'Team' }).waitFor();
    expect(alice.errors).toEqual([]);
  });
});
