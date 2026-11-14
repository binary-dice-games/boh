// MIT License © 2026 Binary Dice Games
// Assembles the GitHub Pages site.
//
//   node scripts/build-site.mjs [outDir] [--base /boh/]
//
// The site holds the page at the root and a 404 page that links back to it.
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWeb } from './build-web.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const siteSrc = join(root, 'web', 'src', 'site');

/**
 * A base path with a slash at both ends (`/boh/`), or `/` for the root.
 * @throws {Error} if `base` is not an absolute path of plain URL segments
 */
export function normalizeBase(base) {
  if (!/^\/([A-Za-z0-9._~-]+\/)*$/.test(base.endsWith('/') ? base : `${base}/`)) {
    throw new Error(`bad base path: ${base}`);
  }
  return base.endsWith('/') ? base : `${base}/`;
}

/**
 * @param {string} out directory to build into (emptied first)
 * @param {{base?: string}} [options] `base` is the path the site is served under
 * @returns {Promise<void>}
 */
export async function buildSite(out, { base = '/' } = {}) {
  const basePath = normalizeBase(base);
  rmSync(out, { recursive: true, force: true });
  await buildWeb(out);
  const page = (name) => readFileSync(join(siteSrc, name), 'utf8').replaceAll('{{base}}', basePath);
  writeFileSync(join(out, '404.html'), page('404.html'));
  writeFileSync(join(out, '.nojekyll'), '');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const baseAt = args.indexOf('--base');
  const base = baseAt >= 0 ? args[baseAt + 1] : '/';
  const outArg = args.find((a, i) => !a.startsWith('--') && i !== baseAt + 1);
  const out = resolve(outArg ?? join(root, 'site'));
  await buildSite(out, { base });
  console.log(`site built in ${out}`);
}
