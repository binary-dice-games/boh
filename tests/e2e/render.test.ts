// MIT License © 2026 Binary Dice Games
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { textToBase64Url } from '../../web/src/b64';
import { pasteDocument, startHarness, type AppPage, type Harness } from '../support/app-harness';
import { FakeDrive } from '../support/fake-drive';

// Each renderer on public pastes of a fake Drive, and what a hostile paste cannot do.

let fake: FakeDrive;
let app: Harness;
let folder: string;

/** 1x1 transparent PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/** A short silent WAV. */
function wav(): Buffer {
  const samples = 800;
  const b = Buffer.alloc(44 + samples * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + samples * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(16000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(samples * 2, 40);
  return b;
}

beforeAll(async () => {
  fake = new FakeDrive();
  await fake.start();
  folder = fake.add({ name: 'pub', owner: 'olga', folder: true, anyone: true });
  app = await startHarness({ drive: fake });
}, 120000);

afterAll(async () => {
  await app?.close();
  await fake?.close();
});

/** Opens a new public paste in a fresh, signed-out page. */
async function openPaste(name: string, content: string | Buffer, hint = ''): Promise<AppPage> {
  const id = fake.add({ name, owner: 'olga', parent: folder, content });
  const viewer = await app.open();
  await viewer.page.goto(`${app.url}#v1/gd/${textToBase64Url(id)}${hint}`);
  await viewer.page.locator('#viewer-name', { hasText: name }).waitFor();
  return viewer;
}

const HOSTILE = `<!doctype html><html><head><title>t</title><style>h1{color:red}</style></head><body>
<h1 id="heading">Hostile</h1>
<script>top.document.title = 'pwned-script'</script>
<img src="x.png" onerror="top.document.title = 'pwned-onerror'">
<img id="tracker" src="https://tracker.example/pixel.png">
<a id="out" href="https://example.com/page" target="_self">out</a>
<form action="https://evil.example/"><input name="pw"></form>
<iframe src="https://evil.example/"></iframe>
<svg><a href="javascript:alert(1)"><text>x</text></a></svg>
</body></html>`;

describe('the render frame', () => {
  it('shows HTML without running any of its script and without remote loads', async () => {
    const viewer = await openPaste('hostile.html', HOSTILE);
    const remote: string[] = [];
    await viewer.page.route('https://tracker.example/**', (route) => {
      remote.push(route.request().url());
      void route.fulfill({ body: PNG, contentType: 'image/png' });
    });
    const doc = pasteDocument(viewer.page);
    await doc.locator('#heading', { hasText: 'Hostile' }).waitFor();
    expect(await viewer.page.title()).toBe('boh');
    expect(await doc.locator('script, form, iframe').count()).toBe(0);
    expect(await doc.locator('#tracker').getAttribute('src')).toBeNull();
    expect(await doc.locator('#tracker').getAttribute('data-boh-blocked')).toBe('');
    expect(await doc.locator('#out').getAttribute('target')).toBe('_blank');
    expect(await doc.locator('#out').getAttribute('rel')).toBe('noopener noreferrer');
    expect(await doc.locator('svg a').getAttribute('href')).toBeNull();
    expect(await viewer.page.locator('#viewer-remote').textContent()).toContain('1 blocked');
    expect(remote).toEqual([]);

    await viewer.page.click('#viewer-remote');
    await doc.locator('#tracker[src^="https://tracker.example"]').waitFor();
    await expect.poll(() => remote.length).toBe(1);
    expect(await viewer.page.title()).toBe('boh');
  });

  it('runs in an opaque origin that cannot read the app', async () => {
    const viewer = await openPaste('origin.md', '# origin');
    await pasteDocument(viewer.page).locator('h1').waitFor();
    const frame = viewer.page.frames().find((f) => f.url().endsWith('/render.html'))!;
    expect(await frame.evaluate(() => self.origin)).toBe('null');
    expect(
      await frame.evaluate(() => {
        try {
          return String(window.parent.location.href);
        } catch {
          return 'blocked';
        }
      }),
    ).toBe('blocked');
    expect(
      await frame.evaluate(() => {
        try {
          return String(localStorage.length);
        } catch {
          return 'blocked';
        }
      }),
    ).toBe('blocked');
  });

  it('does nothing when opened outside the sandbox', async () => {
    const page = (await app.open()).page;
    await page.goto(new URL('render.html', app.url).href);
    await page.locator('body', { hasText: 'This page only works inside boh.' }).waitFor();
    // Messages arrive in order: the frame's own listener has seen the request (and any answer it
    // posted has arrived) by the time the marker posted after it comes back.
    const answers = await page.evaluate(
      () =>
        new Promise<string[]>((resolve) => {
          const seen: string[] = [];
          window.addEventListener('message', (e) => {
            const type = String((e.data as { type?: string })?.type);
            if (type === 'render') {
              window.postMessage({ type: 'marker' }, '*');
            } else if (type === 'marker') {
              resolve(seen);
            } else {
              seen.push(type);
            }
          });
          const bytes = new TextEncoder().encode('# x').buffer;
          const options = { remote: false, wrap: false, highlight: false, language: '' };
          const request = {
            type: 'render',
            id: 1,
            renderer: 'markdown',
            name: 'x',
            bytes,
            options,
          };
          window.postMessage(request, '*');
        }),
    );
    expect(answers).toEqual([]);
    expect(await page.locator('iframe').count()).toBe(0);
  });

  it('highlights Markdown code blocks and shows the source on request', async () => {
    const viewer = await openPaste(
      'code.md',
      '# Code\n\n```js\nconst x = 1;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n',
    );
    const doc = pasteDocument(viewer.page);
    await doc.locator('.hljs-keyword', { hasText: 'const' }).waitFor();
    expect(await doc.locator('table td').count()).toBe(2);
    await viewer.page.selectOption('#viewer-renderer', 'text');
    await doc.locator('pre.code', { hasText: '```js' }).waitFor();
  });

  it('shows text with line numbers, highlighting by extension, and wrapping', async () => {
    const viewer = await openPaste('main.py', 'def f():\n    return 1\n\nprint(f())\n');
    const doc = pasteDocument(viewer.page);
    await doc.locator('.hljs-keyword', { hasText: 'def' }).waitFor();
    expect(await doc.locator('pre.gutter').textContent()).toBe('1\n2\n3\n4');
    await viewer.page.check('#viewer-wrap');
    await doc.locator('.text.wrap').waitFor();
  });

  it('honours a renderer hint in the link', async () => {
    const viewer = await openPaste('page.html', '<p id="p">hi</p>', '?r=text');
    await pasteDocument(viewer.page).locator('pre.code', { hasText: '<p id="p">hi</p>' }).waitFor();
  });

  it('shows images, SVG as an image, and audio from blobs', async () => {
    const png = await openPaste('dot.png', PNG);
    await png.page.locator('#viewer-image').waitFor();
    await expect
      .poll(() =>
        png.page.locator('#viewer-image').evaluate((img: HTMLImageElement) => img.naturalWidth),
      )
      .toBe(1);
    expect(await png.page.locator('#viewer-image').getAttribute('src')).toMatch(/^blob:/);

    const svg = await openPaste(
      'evil.svg',
      '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4" onload="top.document.title=\'pwned\'"><script>top.document.title="pwned"</script><rect width="4" height="4"/></svg>',
    );
    await svg.page.locator('#viewer-image').waitFor();
    expect(await svg.page.locator('#viewer-image').getAttribute('src')).toMatch(
      /^data:image\/svg\+xml/,
    );
    expect(await svg.page.title()).toBe('boh');

    const audio = await openPaste('tone.wav', wav());
    await expect
      .poll(() =>
        audio.page.locator('#viewer-media').evaluate((a: HTMLAudioElement) => a.readyState),
      )
      .toBeGreaterThan(0);
    expect([...png.errors, ...svg.errors, ...audio.errors]).toEqual([]);
  });

  it('shows small unknown files as text, and others as a download', async () => {
    const text = await openPaste('notes', 'just text');
    await pasteDocument(text.page).locator('pre.code', { hasText: 'just text' }).waitFor();
    const binary = await openPaste('blob.bin', Buffer.from([0, 1, 2, 255]));
    await binary.page.locator('text=boh cannot show this kind of file').waitFor();
    const download = binary.page.waitForEvent('download');
    await binary.page.click('#viewer-download');
    expect((await download).suggestedFilename()).toBe('blob.bin');
  });

  it('refuses to render text over the limit', async () => {
    const viewer = await openPaste('huge.txt', Buffer.alloc(5 * 1024 * 1024 + 1, 97));
    await viewer.page.locator('text=too large to show here').waitFor();
  });

  it('explains bad, newer and missing links', async () => {
    const viewer = await app.open('#v1/zz/abc');
    await viewer.page.locator('text=not valid').waitFor();
    await viewer.page.goto(`${app.url}#v9/gd/abc`);
    await viewer.page.locator('text=needs a newer version').waitFor();
    await viewer.page.goto(`${app.url}#v1/gd/${textToBase64Url('nosuchfile')}`);
    await viewer.page.locator('#viewer-message', { hasText: 'Sign in to open it' }).waitFor();
  });
});
