// MIT License © 2026 Binary Dice Games
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from 'playwright-core';
import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSite } from '../../scripts/build-site.mjs';
import { launchChrome } from '../support/browser';
import { serveSite } from '../support/site-server';

// The built site in Chrome, served like GitHub Pages serves a project site: under /boh/.

let browser: Browser;
let server: Server;
let work: string;
let url: string;

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), 'boh-site-e2e-'));
  const out = join(work, 'site');
  await buildSite(out, { base: '/boh/' });
  ({ url, server } = await serveSite(out, '/boh/'));
  browser = await launchChrome();
}, 60000);

afterAll(async () => {
  await browser?.close();
  server?.close();
  rmSync(work, { recursive: true, force: true });
});

describe('the site in Chrome', () => {
  it('loads the page without errors', async () => {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(url);
    expect(await page.title()).toBe('boh');
    await expect(page.locator('#app').count()).resolves.toBe(1);
    expect(errors).toEqual([]);
    await page.close();
  });

  it('shows the icon beside the boh name and as the favicon', async () => {
    const page = await browser.newPage();
    await page.goto(url);
    const logo = page.locator('.top .logo');
    await expect(logo.textContent()).resolves.toBe('boh');
    const icon = logo.locator('img');
    await expect
      .poll(() => icon.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
      .toBeGreaterThan(0);
    expect(await page.locator('link[rel="icon"]').getAttribute('href')).toBe('icon.png');
    await page.close();
  });

  it('offers only Google Drive, and refuses Dropbox and OneDrive links', async () => {
    const page = await browser.newPage();
    await page.goto(url);
    // Only Google Drive is enabled in web/boh.config.json.
    await page.locator('button.connect[data-provider="gd"]').waitFor();
    expect(await page.locator('button.connect').count()).toBe(1);
    for (const [code, label] of [
      ['db', 'Dropbox'],
      ['od', 'OneDrive'],
    ]) {
      await page.goto(`${url}#v1/${code}/aWQ6eA`);
      await page
        .locator('#viewer-message', {
          hasText: `in ${label}, which this boh site does not support`,
        })
        .waitFor();
      expect(await page.locator('#viewer-sign-in').count()).toBe(0);
    }
    await page.close();
  });

  it('answers an unknown path with the 404 page, which links home', async () => {
    const page = await browser.newPage();
    const res = await page.goto(`${url}no/such/page`);
    expect(res?.status()).toBe(404);
    await page.click('#home');
    await page.waitForURL(url);
    await page.close();
  });
});
