// MIT License © 2026 Binary Dice Games
// Builds the boh page into a directory.
//
//   node scripts/build-web.mjs [outDir]      default: web/dist
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveConfig } from './config.mjs';
import { appCsp, authCsp, renderCsp } from './csp.mjs';

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

/** Images the pages use (the icon), in `web/src/assets/`, copied next to the pages. */
export const ASSET_FILES = ['icon.png'];

/** The pages of the build: the HTML file, its script entry and its policy. */
const PAGES = [
  { html: 'index.html', entry: 'main.ts', out: 'main', csp: appCsp },
  { html: 'render.html', entry: 'render/frame.ts', out: 'render', csp: renderCsp },
  { html: 'auth.html', entry: 'auth.ts', out: 'auth', csp: authCsp },
];

/**
 * Builds the pages (`index.html` + `main.js`, the render frame `render.html` + `render.js`, the
 * sign-in redirect `auth.html` + `auth.js`), the stylesheet `app.css` and the images
 * (`ASSET_FILES`).
 * @param {string} out directory to write into
 * @param {{config?: import('./config.mjs').ConfigOverrides}} [options] `config` overrides the
 *   committed configuration (the tests point the providers at loopback fakes)
 */
export async function buildWeb(out, { config: overrides } = {}) {
  mkdirSync(out, { recursive: true });
  const config = resolveConfig(overrides);
  await build({
    entryPoints: PAGES.map((p) => ({ in: join(src, p.entry), out: p.out })),
    outdir: out,
    bundle: true,
    format: 'iife',
    target: 'es2022',
    platform: 'browser',
    sourcemap: false,
    minify: true,
    legalComments: 'none',
    logLevel: 'warning',
    loader: { '.css': 'text' },
    // One constant per provider, so a provider that is off is dropped from the bundle.
    define: {
      __BOH_CONFIG__: JSON.stringify(config),
      __BOH_GD__: JSON.stringify(config.providers.includes('gd')),
      __BOH_DB__: JSON.stringify(config.providers.includes('db')),
      __BOH_OD__: JSON.stringify(config.providers.includes('od')),
    },
  });
  const version = buildVersion();
  for (const page of PAGES) {
    const html = readFileSync(join(src, page.html), 'utf8');
    writeFileSync(
      join(out, page.html),
      html.replaceAll('{{version}}', version).replaceAll('{{csp}}', page.csp(config)),
    );
  }
  copyFileSync(join(src, 'app.css'), join(out, 'app.css'));
  for (const name of ASSET_FILES) {
    copyFileSync(join(src, 'assets', name), join(out, name));
  }
  writeFileSync(join(out, 'third-party-licenses.txt'), thirdPartyLicenses());
}

/** The packages bundled into the render frame, whose licenses ship with the site. */
const BUNDLED = ['dompurify', 'highlight.js', 'marked'];

/** The license texts of the bundled packages, as one text file. */
export function thirdPartyLicenses() {
  const sections = BUNDLED.map((name) => {
    const dir = join(root, 'node_modules', name);
    const { version, license } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    return `${name} ${version} (${license})\n\n${readFileSync(join(dir, 'LICENSE'), 'utf8').trim()}\n`;
  });
  return `boh includes the following packages in render.js.\n\n${sections.join(`\n${'-'.repeat(72)}\n\n`)}`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = resolve(process.argv[2] ?? join(root, 'web', 'dist'));
  await buildWeb(out);
  console.log(`page built in ${out}`);
}
