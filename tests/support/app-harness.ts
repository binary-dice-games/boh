// MIT License © 2026 Binary Dice Games
/**
 * @file The browser tests' app: the site built against the provider fakes (with the test picker),
 * served from loopback, and Chrome pages with their own storage that answer dialogs and collect
 * errors.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import type { ConfigOverrides } from '../../scripts/config.mjs';
import { buildSite } from '../../scripts/build-site.mjs';
import { launchChrome } from './browser';
import type { FakeDrive } from './fake-drive';
import type { FakeDropbox } from './fake-dropbox';
import type { FakeGraph } from './fake-graph';
import { serveSite } from './site-server';

/** A Chrome page of the app. */
export interface AppPage {
  page: Page;
  context: BrowserContext;
  /** Page errors and console errors seen so far. */
  errors: string[];
  /** What the next `window.prompt` is answered with (the test picker asks for a folder id). */
  answers: { prompt?: string; confirm: boolean };
}

/** The served app. */
export interface Harness {
  url: string;
  browser: Browser;
  open(path?: string): Promise<AppPage>;
  close(): Promise<void>;
}

/** Builds and serves the site against the given fakes (started already) and launches Chrome. */
export async function startHarness(fakes: {
  drive?: FakeDrive;
  dropbox?: FakeDropbox;
  graph?: FakeGraph;
}): Promise<Harness> {
  const config: ConfigOverrides = {};
  if (fakes.drive) {
    const d = fakes.drive.server.url;
    config.google = {
      clientId: 'test-google',
      apiKey: fakes.drive.apiKey,
      appId: '1',
      authUrl: `${d}/o/oauth2/v2/auth`,
      apiBase: d,
      revokeUrl: `${d}/revoke`,
      testPicker: true,
    };
  }
  if (fakes.dropbox) {
    const b = fakes.dropbox.server.url;
    config.dropbox = {
      appKey: fakes.dropbox.appKey,
      authUrl: `${b}/oauth2/authorize`,
      apiBase: b,
      contentBase: b,
      rawBase: b,
    };
  }
  if (fakes.graph) {
    const g = fakes.graph.server.url;
    config.microsoft = {
      clientId: fakes.graph.clientId,
      authority: `${g}/common/oauth2/v2.0`,
      graphBase: `${g}/v1.0`,
      downloadHosts: [g],
    };
  }
  const work = mkdtempSync(join(tmpdir(), 'boh-app-'));
  const out = join(work, 'site');
  await buildSite(out, { base: '/boh/', config });
  const served: { url: string; server: Server } = await serveSite(out, '/boh/');
  const browser = await launchChrome();
  const contexts: BrowserContext[] = [];
  return {
    url: served.url,
    browser,
    async open(path = '') {
      const context = await browser.newContext();
      contexts.push(context);
      const page = await context.newPage();
      const errors: string[] = [];
      const answers: AppPage['answers'] = { confirm: true };
      const watch = (p: Page) => {
        p.on('pageerror', (e) => errors.push(e.message));
        // Chrome logs every non-2xx answer; the providers expect some (404 for a missing settings
        // file, 409 for a Dropbox lookup), so only real errors count.
        p.on(
          'console',
          (m) =>
            m.type() === 'error' &&
            !m.text().startsWith('Failed to load resource') &&
            errors.push(m.text()),
        );
        p.on('dialog', (dialog) => {
          if (dialog.type() === 'prompt') {
            void dialog.accept(answers.prompt ?? '');
          } else if (dialog.type() === 'confirm' && !answers.confirm) {
            void dialog.dismiss();
          } else {
            void dialog.accept();
          }
        });
      };
      watch(page);
      context.on('page', watch);
      await page.goto(`${served.url}${path}`);
      return { page, context, errors, answers };
    },
    async close() {
      for (const c of contexts) {
        await c.close().catch(() => undefined);
      }
      await browser.close();
      served.server.close();
      rmSync(work, { recursive: true, force: true });
    },
  };
}

/** Clicks the connect button of `provider` and waits until the header shows the account. */
export async function connect(
  app: AppPage,
  provider: 'gd' | 'db' | 'od',
  name: string,
): Promise<void> {
  await app.page.click(`button.connect[data-provider="${provider}"]`);
  await app.page.locator(`.account[data-provider="${provider}"] .who`, { hasText: name }).waitFor();
}

/** The render frame's nested document (where text, Markdown and HTML pastes are shown). */
export function pasteDocument(page: Page) {
  return page.frameLocator('iframe.render-frame').frameLocator('iframe');
}
