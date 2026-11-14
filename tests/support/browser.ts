// MIT License © 2026 Binary Dice Games
/** @file Launches the Chrome the browser tests drive. */
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import type { Browser } from 'playwright-core';

/** Where to find Chrome: BOH_CHROME, else a well known install path, else Playwright's channel. */
function chromePath(): string | undefined {
  const candidates = [
    process.env.BOH_CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  return candidates.find((p) => p && existsSync(p));
}

/** Launches headless Chrome. */
export async function launchChrome(): Promise<Browser> {
  const executablePath = chromePath();
  return chromium.launch({
    ...(executablePath ? { executablePath } : { channel: 'chrome' }),
    headless: true,
  });
}
