// MIT License © 2026 Binary Dice Games
// The build configuration of the page: public client ids and the provider endpoints.
//
// Values come from web/boh.config.json, then the BOH_* environment variables, then the overrides
// a caller passes (the tests point the endpoints at loopback fakes). Everything here is public:
// it ends up in the shipped page.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The providers' real endpoints. */
export const DEFAULT_CONFIG = {
  google: {
    clientId: '',
    apiKey: '',
    appId: '',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    apiBase: 'https://www.googleapis.com',
    revokeUrl: 'https://oauth2.googleapis.com/revoke',
    pickerScript: 'https://apis.google.com/js/api.js',
    testPicker: false,
  },
  dropbox: {
    appKey: '',
    authUrl: 'https://www.dropbox.com/oauth2/authorize',
    apiBase: 'https://api.dropboxapi.com',
    contentBase: 'https://content.dropboxapi.com',
    rawBase: 'https://dl.dropboxusercontent.com',
  },
  microsoft: {
    clientId: '',
    authority: 'https://login.microsoftonline.com/common/oauth2/v2.0',
    graphBase: 'https://graph.microsoft.com/v1.0',
    downloadHosts: [
      'https://*.1drv.com',
      'https://*.sharepoint.com',
      'https://*.livefilestore.com',
    ],
  },
};

const ENV = [
  ['BOH_GOOGLE_CLIENT_ID', 'google', 'clientId'],
  ['BOH_GOOGLE_API_KEY', 'google', 'apiKey'],
  ['BOH_GOOGLE_APP_ID', 'google', 'appId'],
  ['BOH_DROPBOX_APP_KEY', 'dropbox', 'appKey'],
  ['BOH_MS_CLIENT_ID', 'microsoft', 'clientId'],
];

function merge(base, extra) {
  const out = { ...base };
  for (const [key, value] of Object.entries(extra ?? {})) {
    out[key] =
      value && typeof value === 'object' && !Array.isArray(value) && typeof base[key] === 'object'
        ? merge(base[key], value)
        : value;
  }
  return out;
}

/**
 * The full configuration of a build.
 * @param {object} [overrides] partial configuration that wins over the file and the environment
 * @param {Record<string, string | undefined>} [env] the environment (default `process.env`)
 * @param {string} [file] the committed configuration file
 * @returns {typeof DEFAULT_CONFIG}
 */
export function resolveConfig(
  overrides = {},
  env = process.env,
  file = join(root, 'web', 'boh.config.json'),
) {
  let config = merge(DEFAULT_CONFIG, JSON.parse(readFileSync(file, 'utf8')));
  for (const [name, provider, key] of ENV) {
    if (env[name]) {
      config = merge(config, { [provider]: { [key]: env[name] } });
    }
  }
  return merge(config, overrides);
}
