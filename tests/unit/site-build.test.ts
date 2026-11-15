// MIT License © 2026 Binary Dice Games
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSite, normalizeBase } from '../../scripts/build-site.mjs';
import { smokeSite } from '../../scripts/smoke-site.mjs';
import { serveSite } from '../support/site-server';

let work: string;
let out: string;
let server: Server;
let url: string;

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), 'boh-site-'));
  out = join(work, 'site');
  await buildSite(out, { base: '/boh/' });
  ({ url, server } = await serveSite(out, '/boh/'));
});

afterAll(() => {
  server?.close();
  rmSync(work, { recursive: true, force: true });
});

describe('the Pages site', () => {
  it('holds the pages, their scripts, the stylesheet, the icon, the privacy and 404 pages and .nojekyll', () => {
    for (const name of [
      'index.html',
      'main.js',
      'app.css',
      'icon.png',
      'render.html',
      'render.js',
      'auth.html',
      'auth.js',
      'privacy.html',
      'third-party-licenses.txt',
      '404.html',
      '.nojekyll',
    ]) {
      expect(existsSync(join(out, name)), name).toBe(true);
    }
  });

  it('stamps the version and the policy of each page into the pages', () => {
    for (const name of ['index.html', 'render.html', 'auth.html']) {
      const html = readFileSync(join(out, name), 'utf8');
      expect(html, name).not.toMatch(/\{\{(version|csp)\}\}/);
      expect(html, name).toContain(`content="default-src 'none'`);
    }
    expect(readFileSync(join(out, 'index.html'), 'utf8')).toContain(
      'connect-src https://www.googleapis.com',
    );
    expect(readFileSync(join(out, 'render.html'), 'utf8')).toContain('img-src data: blob: https:');
  });

  it('ships the licenses of the bundled packages', () => {
    const text = readFileSync(join(out, 'third-party-licenses.txt'), 'utf8');
    for (const name of ['dompurify', 'highlight.js', 'marked']) {
      expect(text).toContain(name);
    }
    expect(text).toContain('BSD 3-Clause');
  });

  it('bundles Google Drive only, by default', () => {
    const main = readFileSync(join(out, 'main.js'), 'utf8');
    expect(main).toContain('appDataFolder');
    for (const marker of ['files/list_folder', 'token_access_type', 'sharedWithMe', 'createLink']) {
      expect(main, marker).not.toContain(marker);
    }
  });

  it('puts the build configuration in the app and nothing secret', () => {
    const main = readFileSync(join(out, 'main.js'), 'utf8');
    expect(main).toContain('https://www.googleapis.com');
    expect(main).not.toMatch(/client_secret/);
  });

  it('stamps the base path into the 404 and privacy pages', () => {
    expect(readFileSync(join(out, 'privacy.html'), 'utf8')).toContain('href="/boh/"');
    const notFound = readFileSync(join(out, '404.html'), 'utf8');
    expect(notFound).not.toContain('{{base}}');
    expect(notFound).toContain('href="/boh/"');
  });

  it('passes the smoke check when served', async () => {
    expect(await smokeSite(url)).toEqual([]);
  });

  it('fails the smoke check on a site that is not there', async () => {
    const problems = await smokeSite(url, async () => new Response('', { status: 500 }));
    expect(problems).toHaveLength(9);
  });
});

describe('normalizeBase', () => {
  it('adds the trailing slash and refuses bad paths', () => {
    expect(normalizeBase('/')).toBe('/');
    expect(normalizeBase('/boh')).toBe('/boh/');
    expect(() => normalizeBase('boh/')).toThrow();
    expect(() => normalizeBase('/a b/')).toThrow();
  });
});
