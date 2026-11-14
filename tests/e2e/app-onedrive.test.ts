// MIT License © 2026 Binary Dice Games
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, pasteDocument, startHarness, type Harness } from '../support/app-harness';
import { FakeGraph } from '../support/fake-graph';

// OneDrive in Chrome: PKCE sign-in, a bin in a folder shared by someone else, a public link that
// any Microsoft account opens, and the settings that follow the user to another browser.

let fake: FakeGraph;
let app: Harness;

beforeAll(async () => {
  fake = new FakeGraph();
  await fake.start();
  fake.add('erin', 'Team', { sharedWith: ['alice'] });
  app = await startHarness({ graph: fake });
}, 120000);

afterAll(async () => {
  await app?.close();
  await fake?.close();
});

describe('boh with OneDrive', () => {
  let link = '';

  it('adds a shared folder as a bin, uploads an image and links it', async () => {
    fake.nextUser = 'alice';
    const alice = await app.open();
    await connect(alice, 'od', 'Alice');
    await alice.page.click('#add-bin');
    await alice.page.click('button[data-folder="Team"]');
    await alice.page.click('#use-folder');
    await alice.page.locator('#bin-sharing', { hasText: 'Sharing unknown' }).waitFor();
    await alice.page.selectOption('#bin-visibility', 'public');
    await alice.page.click('#bin-save');
    await alice.page.locator('.bin .bin-name', { hasText: 'Team' }).waitFor();
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    );
    await alice.page.setInputFiles('#paste-file', {
      name: 'dot.png',
      mimeType: 'image/png',
      buffer: png,
    });
    await alice.page.fill('#paste-title', 'A dot');
    await alice.page.click('#paste-upload');
    await alice.page.locator('#paste-link').waitFor();
    link = await alice.page.inputValue('#paste-link');
    const team = [...fake.items.values()].find((i) => i.name === 'Team')!;
    expect(team.children.map((c) => c.name)).toEqual(['a-dot.png']);
    expect(alice.errors).toEqual([]);
  });

  it('asks a viewer to sign in with any Microsoft account, then shows the image', async () => {
    const zed = await app.open();
    await zed.page.goto(link);
    await zed.page.locator('#viewer-message', { hasText: 'Sign in to open it' }).waitFor();
    fake.nextUser = 'zed';
    await zed.page.click('#viewer-sign-in');
    await expect
      .poll(() =>
        zed.page
          .locator('#viewer-image')
          .evaluate((img: HTMLImageElement) => img.naturalWidth)
          .catch(() => 0),
      )
      .toBe(1);
  });

  it('brings the bins to another browser after sign-in and shows text pastes', async () => {
    fake.nextUser = 'alice';
    const other = await app.open();
    await connect(other, 'od', 'Alice');
    await other.page.locator('.bin .bin-name', { hasText: 'Team' }).waitFor();
    await other.page.fill('#paste-text', '{"a": 1}');
    await other.page.selectOption('#paste-format', 'json');
    await other.page.click('#paste-upload');
    await other.page.locator('#paste-link').waitFor();
    await other.page.goto(await other.page.inputValue('#paste-link'));
    await pasteDocument(other.page).locator('.hljs-attr', { hasText: '"a"' }).waitFor();
    expect(other.errors).toEqual([]);
  });
});
