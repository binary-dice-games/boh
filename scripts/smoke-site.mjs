// MIT License © 2026 Binary Dice Games
// Checks that a deployed (or locally served) site works.
//
//   node scripts/smoke-site.mjs <site url, ending with />
//
// Fetches the pages and their scripts, the privacy policy and a missing page (which must be the 404 page). Exits 1 with
// the reasons if anything is wrong. The check is meant to run right after a deploy.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/**
 * @param {string} base the site's address, ending with `/`
 * @param {(url: string) => Promise<Response>} [get] how to fetch (tests pass their own)
 * @returns {Promise<string[]>} the problems found; empty when the site is fine
 */
export async function smokeSite(base, get = (url) => fetch(url, { redirect: 'manual' })) {
  const problems = [];
  const check = async (path, { status = 200, contains, label = path } = {}) => {
    let res;
    try {
      res = await get(new URL(path, base).toString());
    } catch (e) {
      problems.push(`${label}: cannot fetch (${e instanceof Error ? e.message : e})`);
      return;
    }
    if (res.status !== status) {
      problems.push(`${label}: status ${res.status}, expected ${status}`);
      return;
    }
    if (contains) {
      const text = await res.text();
      for (const needle of [contains].flat()) {
        if (!text.includes(needle)) {
          problems.push(`${label}: does not contain ${JSON.stringify(needle)}`);
        }
      }
    }
  };
  await check('', { contains: ['<title>boh</title>', 'main.js'], label: 'page' });
  await check('main.js', { label: 'page script' });
  await check('app.css', { label: 'stylesheet' });
  await check('render.html', { contains: 'render.js', label: 'render frame' });
  await check('render.js', { label: 'render frame script' });
  await check('auth.html', { contains: 'auth.js', label: 'sign-in page' });
  await check('auth.js', { label: 'sign-in page script' });
  await check('privacy.html', { contains: 'Privacy', label: 'privacy policy' });
  await check('no-such-page-for-smoke-test', {
    status: 404,
    contains: 'This page does not exist',
    label: '404 page',
  });
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const base = process.argv[2];
  if (!base || !/^https?:\/\/.+\/$/.test(base)) {
    console.error('usage: node scripts/smoke-site.mjs <site url ending with />');
    process.exit(2);
  }
  const problems = await smokeSite(base);
  if (problems.length) {
    console.error(`site check failed:\n- ${problems.join('\n- ')}`);
    process.exit(1);
  }
  console.log(`site ok: ${base}`);
}
