// MIT License © 2026 Binary Dice Games
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tagKey } from '../../web/src/tags';
import { connect, startHarness, type AppPage, type Harness } from '../support/app-harness';
import { FakeDrive } from '../support/fake-drive';

// Tags and the library with Google Drive: a tag rule and a bin's default tags preselect tags at
// upload, the viewer edits them, the library filters and searches them (the query survives a
// reload), and bulk edits skip what the account may not change.

let fake: FakeDrive;
let app: Harness;
let notes = '';
let alice: AppPage;

beforeAll(async () => {
  fake = new FakeDrive();
  await fake.start();
  app = await startHarness({ drive: fake });
  notes = fake.add({ name: 'Notes', owner: 'alice', folder: true });
  const theirs = fake.add({ name: 'Bob shares', owner: 'bob', folder: true, readers: ['alice'] });
  fake.add({
    name: '<b>bold</b>.txt',
    owner: 'bob',
    parent: theirs,
    content: 'from bob',
    appProperties: { [tagKey('draft')]: '1' },
  });
  fake.nextUser = 'alice';
  alice = await app.open();
  await connect(alice, 'gd', 'Alice', { stay: true });
}, 120000);

afterAll(async () => {
  await app?.close();
  await fake?.close();
});

const chips = (page: AppPage['page'], selector: string) =>
  page.locator(`${selector} .chip`).allTextContents();

describe('tags and the library', () => {
  it('adds a bin with default tags and a tag rule', async () => {
    const page = alice.page;
    await page.click('#add-bin');
    alice.answers.prompt = notes;
    await page.click('#pick-folder');
    await page.locator('#bin-folder', { hasText: 'Notes' }).waitFor();
    await page.fill('#bin-default-tags', 'Notes');
    await page.press('#bin-default-tags', 'Enter');
    await page.locator('[data-tags-for="bin-default-tags"] .chip', { hasText: 'notes' }).waitFor();
    await page.click('#bin-save');
    await page.locator('.bin .bin-name', { hasText: 'Notes' }).waitFor();
    expect(JSON.parse(fake.configOf('alice')!.content.toString()).bins[0].defaultTags).toEqual([
      'notes',
    ]);

    await page.click('#nav-library');
    await page.click('#library-rules');
    await page.fill('#rule-formats', 'log');
    await page.fill('#rule-tags', 'logs, Server');
    await page.click('#rule-add');
    await page.locator('#rules-list li', { hasText: 'format log: add logs, server' }).waitFor();
    await page.click('#rules-close');
    expect(alice.errors).toEqual([]);
  });

  it('preselects tags at upload; removed ones stay removed and typed ones are added', async () => {
    const page = alice.page;
    await page.click('.logo');
    await page.selectOption('#paste-format', 'log');
    await page.fill('#paste-title', 'server');
    await expect
      .poll(() => chips(page, '[data-tags-for="paste-tags"]'))
      .toEqual(['logs×', 'notes×', 'server×']);
    await page.click('[aria-label="Remove tag server"]');
    await page.fill('#paste-tags', 'Urgent, a:b');
    await page.press('#paste-tags', 'Enter');
    await page.locator('[data-tags-for="paste-tags"] .problem', { hasText: 'a:b' }).waitFor();
    await page.fill('#paste-tags', '');
    await page.selectOption('#paste-format', 'txt'); // the rule no longer applies
    await expect
      .poll(() => chips(page, '[data-tags-for="paste-tags"]'))
      .toEqual(['notes×', 'urgent×']);
    await page.selectOption('#paste-format', 'log');
    await page.fill('#paste-text', 'boot ok');
    await page.click('#paste-upload');
    await page.locator('#paste-link').waitFor();
    const log = [...fake.files.values()].find((f) => f.name === 'server.log')!;
    expect(fake.tagsOf(log.id)).toEqual(['logs', 'notes', 'urgent']);
    // The form starts over for the next paste: what was removed or added is forgotten.
    await expect
      .poll(() => chips(page, '[data-tags-for="paste-tags"]'))
      .toEqual(['logs×', 'notes×', 'server×']);

    await page.fill('#paste-title', 'readme');
    await page.selectOption('#paste-format', 'md');
    await page.fill('#paste-text', '# Read me');
    await page.click('#paste-upload');
    await expect.poll(() => page.inputValue('#paste-link')).toContain('readme.md');
    expect(alice.errors).toEqual([]);
  });

  it('edits tags in the viewer', async () => {
    const page = alice.page;
    await page.goto(await page.inputValue('#paste-link'));
    await page.locator('#viewer-name', { hasText: 'readme.md' }).waitFor();
    await page.locator('#viewer-tags .tag.derived', { hasText: 'kind:markdown' }).waitFor();
    await page.fill('#viewer-tag-input', 'docs');
    await page.press('#viewer-tag-input', 'Enter');
    await page.locator('#viewer-tags .chip', { hasText: 'docs' }).waitFor();
    const readme = [...fake.files.values()].find((f) => f.name === 'readme.md')!;
    await expect.poll(() => fake.tagsOf(readme.id)).toEqual(['docs', 'notes']);
    await page.click('[aria-label="Remove tag notes"]');
    await expect.poll(() => fake.tagsOf(readme.id)).toEqual(['docs']);
    expect(alice.errors).toEqual([]);
  });

  it('adds a folder shared with the user, read-only', async () => {
    const page = alice.page;
    await page.click('.logo');
    await page.click('#add-bin');
    alice.answers.prompt = [...fake.files.values()].find((f) => f.name === 'Bob shares')!.id;
    await page.click('#pick-shared-folder');
    await page.locator('#bin-owner', { hasText: 'Owned by Bob' }).waitFor();
    await page.locator('#bin-owner', { hasText: 'You can only read it' }).waitFor();
    expect(await page.isChecked('#bin-shared')).toBe(true);
    await page.click('#bin-save');
    await page.locator('.bin .badge.shared', { hasText: 'Shared by Bob' }).waitFor();
    const bins = JSON.parse(fake.configOf('alice')!.content.toString()).bins;
    expect(bins[1]).toMatchObject({ name: 'Bob shares', shared: true, owner: { name: 'Bob' } });
  });

  it('filters by tag, type, bin and owner, and searches names; the query survives a reload', async () => {
    const page = alice.page;
    await page.click('#nav-library');
    await page.locator('#library-count', { hasText: /^3 pastes$/ }).waitFor();
    // A name from someone else stays text.
    await page.locator('tr[data-paste="<b>bold</b>.txt"]').waitFor();
    expect(await page.locator('.library-table b').count()).toBe(0);

    await page.click('[data-facet-tag="urgent"]');
    await page.locator('#library-count', { hasText: '1 of 3' }).waitFor();
    await page.locator('tr[data-paste="server.log"]').waitFor();
    expect(page.url()).toContain('#library?q=%23urgent');

    await page.fill('#library-search', 'kind:markdown');
    await page.locator('#library-count', { hasText: '1 of 3' }).waitFor();
    await page.locator('tr[data-paste="readme.md"]').waitFor();

    await page.fill('#library-search', '');
    await page.click('#scope-shared');
    await page.locator('tr[data-paste="<b>bold</b>.txt"]').waitFor();
    await page.locator('#library-count', { hasText: '1 of 3' }).waitFor();
    await page.click('#scope-mine');
    await page.locator('#library-count', { hasText: '2 of 3' }).waitFor();

    await page.fill('#library-search', 'READ -#nothing');
    await page.locator('#library-count', { hasText: '1 of 3' }).waitFor();
    await page.locator('tr[data-paste="readme.md"]').waitFor();

    await page.fill('#library-search', '#draft');
    await page.locator('tr[data-paste="<b>bold</b>.txt"]').waitFor();
    await page.reload();
    await page.locator('tr[data-paste="<b>bold</b>.txt"]').waitFor();
    expect(await page.inputValue('#library-search')).toBe('#draft');
    await page.locator('#library-count', { hasText: '1 of 3' }).waitFor();
    expect(alice.errors).toEqual([]);
  });

  it('bulk adds and renames tags, skipping pastes it may not change', async () => {
    const page = alice.page;
    await page.fill('#library-search', '');
    await page.locator('#library-count', { hasText: /^3 pastes$/ }).waitFor();
    await page.check('#select-all');
    await page.locator('#bulk-count', { hasText: '3' }).waitFor();
    await page.fill('#bulk-tags', 'reviewed');
    await page.click('#bulk-add');
    await page
      .locator('#bulk-progress', { hasText: 'Changed 2. 1 skipped: you may not change them.' })
      .waitFor();
    const byName = (name: string) => [...fake.files.values()].find((f) => f.name === name)!.id;
    expect(fake.tagsOf(byName('server.log'))).toContain('reviewed');
    expect(fake.tagsOf(byName('<b>bold</b>.txt'))).toEqual(['draft']);
    await page.locator('[data-facet-tag="reviewed"]', { hasText: '(2)' }).waitFor();

    await page.fill('#bulk-from', 'reviewed');
    await page.fill('#bulk-to', 'Checked');
    await page.click('#bulk-rename');
    await page.locator('#bulk-progress', { hasText: 'Changed 2.' }).waitFor();
    expect(fake.tagsOf(byName('readme.md'))).toEqual(['checked', 'docs']);
    expect(fake.tagsOf(byName('server.log'))).toEqual(['checked', 'logs', 'notes', 'urgent']);
    await page.locator('[data-facet-tag="checked"]').waitFor();
    expect(await page.locator('[data-facet-tag="reviewed"]').count()).toBe(0);

    // Apply rules: the log rule adds "logs" and "server" where they are missing.
    await page.click('[data-facet-derived="format:log"]');
    await page.locator('#library-count', { hasText: '1 of 3' }).waitFor();
    await page.check('#select-all');
    await page.click('#bulk-rules');
    await page.locator('#bulk-progress', { hasText: 'Changed 1.' }).waitFor();
    expect(fake.tagsOf(byName('server.log'))).toContain('server');
    expect(alice.errors).toEqual([]);
  });

  it('shows the cached library at once in a new tab, and forgets it on disconnect', async () => {
    const tab = await alice.context.newPage();
    fake.server.failNext(503, 50, /\/drive\/v3\/files$/);
    await tab.goto(`${app.url}#library`);
    await tab.locator('tr[data-paste="readme.md"]').waitFor();
    await tab.locator('#facet-bins .problem').first().waitFor();
    fake.server.clearFailures();
    await tab.close();

    const page = alice.page;
    await page.click('.account[data-provider="gd"] >> text=Disconnect');
    await page.locator('button.connect[data-provider="gd"]').waitFor();
    const stored = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const req = indexedDB.open('boh-library', 1);
          req.onsuccess = () => {
            const count = req.result.transaction('bins').objectStore('bins').count();
            count.onsuccess = () => resolve(count.result);
          };
        }),
    );
    expect(stored).toBe(0);
  });
});
