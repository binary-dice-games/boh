// MIT License © 2026 Binary Dice Games
/** @file Serves a built site over loopback the way GitHub Pages serves a project site. */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
};

/**
 * Serves `dir` under `base` on a free loopback port: unknown paths get `404.html` with status 404.
 * @param dir the built site
 * @param base the path the site is served under, with a slash at both ends (`/boh/`)
 * @returns the site's address (`http://127.0.0.1:<port>/boh/`) and the server, to close
 */
export async function serveSite(dir: string, base = '/'): Promise<{ url: string; server: Server }> {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    const notFound = () =>
      res
        .writeHead(404, { 'content-type': TYPES['.html'] })
        .end(readFileSync(join(dir, '404.html')));
    if (!path.startsWith(base)) {
      notFound();
      return;
    }
    const rel = path.slice(base.length);
    const file = normalize(join(dir, rel === '' || rel.endsWith('/') ? `${rel}index.html` : rel));
    if (!file.startsWith(normalize(dir))) {
      notFound();
      return;
    }
    try {
      const body = readFileSync(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      notFound();
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}${base}`, server };
}
