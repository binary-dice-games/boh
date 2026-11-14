// MIT License © 2026 Binary Dice Games
/**
 * @file Entry point of the boh page, bundled into `main.js` by `scripts/build-web.mjs`: builds the
 * providers from the build configuration and starts the app.
 */
import { BinStore } from './bin-store';
import { buildConfig } from './config';
import { LocalState } from './local-state';
import type { PopupEnv } from './oauth';
import { createDriveProvider } from './providers/google-drive';
import { createDropboxProvider } from './providers/dropbox';
import { createOneDriveProvider } from './providers/onedrive';
import type { ProviderEnv } from './providers/provider';
import { browserStore } from './storage';
import { TokenStore } from './token-store';
import { App } from './ui/app';

const local = browserStore('local');
const popup: PopupEnv = {
  openPopup: (url) => window.open(url, 'boh-sign-in', 'popup,width=520,height=680'),
  redirectUri: new URL('auth.html', location.href).href.split('#')[0]!.split('?')[0]!,
};
const env: ProviderEnv = {
  config: buildConfig(),
  fetch: (input, init) => fetch(input, init),
  tokens: new TokenStore(local, browserStore('session')),
  popup,
};
const providers = {
  gd: createDriveProvider(env),
  db: createDropboxProvider(env),
  od: createOneDriveProvider(env),
};
const siteUrl = `${location.origin}${location.pathname}`;
const root = document.getElementById('app');
if (root) {
  new App(providers, new BinStore(providers, local), new LocalState(local), siteUrl, root).start();
}
