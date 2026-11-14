// MIT License © 2026 Binary Dice Games
// Builds the boh page into a directory.
//
//   node scripts/build-web.mjs [outDir]      default: web/dist
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'web', 'src');

/**
 * The version of this build: the package version, plus the short commit when the build runs in
 * a git checkout (`0.1.0 (5ac03b7)`), or the package version alone.
 */
export function buildVersion() {
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  let commit = process.env.GITHUB_SHA?.slice(0, 7);
  if (!commit) {
    try {
      commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      commit = undefined; // not a git checkout, or git is missing
    }
  }
  return commit ? `${version} (${commit})` : version;
}

/**
 * Builds the page (`index.html`, `main.js`).
 * @param {string} out directory to write into
 */
export async function buildWeb(out) {
  mkdirSync(out, { recursive: true });
  await build({
    entryPoints: [{ in: join(src, 'main.ts'), out: 'main' }],
    outdir: out,
    bundle: true,
    format: 'iife',
    target: 'es2022',
    platform: 'browser',
    sourcemap: false,
    minify: true,
    legalComments: 'none',
    logLevel: 'warning',
  });
  const html = readFileSync(join(src, 'index.html'), 'utf8');
  writeFileSync(join(out, 'index.html'), html.replace('{{version}}', buildVersion()));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = resolve(process.argv[2] ?? join(root, 'web', 'dist'));
  await buildWeb(out);
  console.log(`page built in ${out}`);
}
