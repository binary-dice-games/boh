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
  it('holds the page, its script, the 404 page and .nojekyll', () => {
    for (const name of ['index.html', 'main.js', '404.html', '.nojekyll']) {
      expect(existsSync(join(out, name)), name).toBe(true);
    }
  });

  it('stamps the version into the page and the base path into the 404 page', () => {
    expect(readFileSync(join(out, 'index.html'), 'utf8')).not.toContain('{{version}}');
    const notFound = readFileSync(join(out, '404.html'), 'utf8');
    expect(notFound).not.toContain('{{base}}');
    expect(notFound).toContain('href="/boh/"');
  });

  it('passes the smoke check when served', async () => {
    expect(await smokeSite(url)).toEqual([]);
  });

  it('fails the smoke check on a site that is not there', async () => {
    const problems = await smokeSite(url, async () => new Response('', { status: 500 }));
    expect(problems).toHaveLength(3);
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
